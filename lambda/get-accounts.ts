import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE, json, userIdFrom } from "./shared/respond";

/**
 * GET /accounts — the authenticated user's accounts. Replaces lib/accounts.ts
 * MOCK_ACCOUNTS. Single Query on the USER partition (begins_with ACCOUNT#).
 */
export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  const userId = userIdFrom(event);
  if (!userId) return json(401, { error: "unauthorized" });

  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: { ":pk": `USER#${userId}`, ":sk": "ACCOUNT#" },
    })
  );

  return json(200, { accounts: res.Items ?? [] });
};
