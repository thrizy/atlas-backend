import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

/** Shared DynamoDB document client (reused across warm invocations). */
export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export const TABLE = process.env.TABLE_NAME as string;

export function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** Pull the Cognito user id (`sub`) out of the JWT authorizer claims. */
export function userIdFrom(event: {
  requestContext: { authorizer?: { jwt?: { claims?: Record<string, unknown> } } };
}): string | null {
  const sub = event.requestContext.authorizer?.jwt?.claims?.sub;
  return typeof sub === "string" ? sub : null;
}
