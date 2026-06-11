#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { AtlasStack } from "../lib/atlas-stack";

const app = new cdk.App();

// Stage: `cdk deploy --context stage=prod` (defaults to dev).
const stage = (app.node.tryGetContext("stage") as string) ?? process.env.STAGE ?? "dev";

new AtlasStack(app, `Atlas-${stage}`, {
  stage,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
  },
  description: `Atlas backend (${stage}) — DynamoDB single-table, Cognito, HTTP API. Phase 1.`,
});
