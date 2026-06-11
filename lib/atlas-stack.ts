import * as path from "path";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { HttpUserPoolAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";

export interface AtlasStackProps extends cdk.StackProps {
  stage: string;
}

export class AtlasStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AtlasStackProps) {
    super(scope, id, props);
    const { stage } = props;
    const isProd = stage === "prod";
    const removalPolicy = isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    // ── DynamoDB single table ───────────────────────────────────────────────
    const table = new dynamodb.Table(this, "AtlasTable", {
      tableName: `atlas-${stage}`,
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES, // audit/analytics later
      pointInTimeRecovery: true,
      removalPolicy,
    });

    // GSI1 affiliate attribution · GSI2 payout queue · GSI3 email lookup
    for (const i of [1, 2, 3]) {
      table.addGlobalSecondaryIndex({
        indexName: `GSI${i}`,
        partitionKey: { name: `GSI${i}PK`, type: dynamodb.AttributeType.STRING },
        sortKey: { name: `GSI${i}SK`, type: dynamodb.AttributeType.STRING },
        projectionType: dynamodb.ProjectionType.ALL,
      });
    }

    // ── Cognito post-confirmation trigger (creates the PROFILE item) ─────────
    const postConfirmation = this.fn("PostConfirmationFn", "post-confirmation.ts", {
      TABLE_NAME: table.tableName,
    });
    table.grantWriteData(postConfirmation);

    // ── Cognito user pool ───────────────────────────────────────────────────
    const userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: `atlas-${stage}`,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: false } },
      passwordPolicy: {
        minLength: 8,
        requireDigits: true,
        requireLowercase: true,
        requireUppercase: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      lambdaTriggers: { postConfirmation },
      removalPolicy,
    });

    const userPoolClient = userPool.addClient("DashboardClient", {
      userPoolClientName: `atlas-dashboard-${stage}`,
      authFlows: { userSrp: true },
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // ── API Lambdas (read) ──────────────────────────────────────────────────
    const env = { TABLE_NAME: table.tableName };
    const getProfile = this.fn("GetProfileFn", "get-profile.ts", env);
    const getAccounts = this.fn("GetAccountsFn", "get-accounts.ts", env);
    table.grantReadData(getProfile);
    table.grantReadData(getAccounts);

    // ── HTTP API + Cognito JWT authorizer ───────────────────────────────────
    const authorizer = new HttpUserPoolAuthorizer("Authorizer", userPool, {
      userPoolClients: [userPoolClient],
    });

    const api = new apigwv2.HttpApi(this, "HttpApi", {
      apiName: `atlas-${stage}`,
      corsPreflight: {
        allowOrigins: ["*"], // tighten to the dashboard origin before prod
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ["authorization", "content-type"],
      },
    });

    api.addRoutes({
      path: "/profile",
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration("GetProfileInt", getProfile),
      authorizer,
    });
    api.addRoutes({
      path: "/accounts",
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration("GetAccountsInt", getAccounts),
      authorizer,
    });

    // ── Outputs (feed these into the dashboard's Amplify env) ───────────────
    new cdk.CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
    new cdk.CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new cdk.CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, "TableName", { value: table.tableName });
    new cdk.CfnOutput(this, "Region", { value: this.region });
  }

  /** Helper: a bundled Node 20 Lambda from lambda/<file>. */
  private fn(id: string, file: string, environment: Record<string, string>): NodejsFunction {
    return new NodejsFunction(this, id, {
      entry: path.join(__dirname, "..", "lambda", file),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment,
      bundling: { minify: true, sourceMap: false },
    });
  }
}
