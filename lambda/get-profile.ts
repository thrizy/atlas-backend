import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE, json, userIdFrom } from "./shared/respond";

/** GET /profile — the authenticated user's profile. Replaces lib/profile.ts. */
export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  const userId = userIdFrom(event);
  if (!userId) return json(401, { error: "unauthorized" });

  const res = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { PK: `USER#${userId}`, SK: "PROFILE" } })
  );
  if (!res.Item) return json(404, { error: "profile_not_found" });

  return json(200, res.Item);
};
