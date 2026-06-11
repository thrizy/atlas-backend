import type { PostConfirmationTriggerHandler } from "aws-lambda";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE } from "./shared/respond";

/**
 * Fires after a user confirms signup in Cognito. Creates the canonical
 * USER#<sub> PROFILE item (idempotent — safe on retries / re-confirmations).
 */
export const handler: PostConfirmationTriggerHandler = async (event) => {
  const sub = event.request.userAttributes.sub;
  const email = (event.request.userAttributes.email ?? "").toLowerCase();
  if (!sub || !email) return event;

  const handle = email.split("@")[0];
  const now = new Date().toISOString();

  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          PK: `USER#${sub}`,
          SK: "PROFILE",
          type: "PROFILE",
          email,
          username: handle,
          nickname: handle,
          firstName: "",
          lastName: "",
          phone: "",
          company: "",
          kycStatus: "unverified",
          memberSince: now,
          // GSI3 — email → user lookup (recovery / dedupe)
          GSI3PK: `EMAIL#${email}`,
          GSI3SK: `USER#${sub}`,
        },
        ConditionExpression: "attribute_not_exists(PK)",
      })
    );
  } catch (err: unknown) {
    // ConditionalCheckFailed = profile already exists → fine. Re-throw anything else.
    const name = (err as { name?: string })?.name;
    if (name !== "ConditionalCheckFailedException") throw err;
  }

  return event;
};
