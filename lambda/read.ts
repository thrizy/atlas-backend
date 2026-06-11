import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE, json, userIdFrom } from "./shared/respond";

// Per-user read endpoints. One Lambda, dispatched by routeKey. Every query is
// scoped to USER#<sub> from the JWT, so users only ever see their own data.

const PLAN_SIZE: Record<string, number> = {
  "25k": 25000,
  "50k": 50000,
  "100k": 100000,
  "150k": 150000,
};
const PLAN_LABEL: Record<string, string> = {
  "25k": "ATLAS 25K",
  "50k": "ATLAS 50K",
  "100k": "ATLAS 100K",
  "150k": "ATLAS 150K",
};

async function listByPrefix(userId: string, prefix: string) {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: { ":pk": `USER#${userId}`, ":sk": prefix },
    })
  );
  return res.Items ?? [];
}

const getItem = (userId: string, sk: string) =>
  ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: `USER#${userId}`, SK: sk } }));

export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  const userId = userIdFrom(event);
  if (!userId) return json(401, { error: "unauthorized" });
  const routeKey = event.routeKey;

  switch (routeKey) {
    case "GET /orders":
      return json(200, { orders: await listByPrefix(userId, "ORDER#") });

    case "GET /payments":
      return json(200, { paymentMethods: await listByPrefix(userId, "PAYMENT#") });

    case "GET /certificates":
      return json(200, { certificates: await listByPrefix(userId, "CERT#") });

    case "GET /rewards": {
      const [bal, ledger] = await Promise.all([
        getItem(userId, "RWD#BALANCE"),
        listByPrefix(userId, "RWD#LEDGER#"),
      ]);
      return json(200, { balance: (bal.Item?.balance as number) ?? 0, ledger });
    }

    case "GET /payouts": {
      const [history, accounts, profile, payments] = await Promise.all([
        listByPrefix(userId, "PAYOUT#"),
        listByPrefix(userId, "ACCOUNT#"),
        getItem(userId, "PROFILE"),
        listByPrefix(userId, "PAYMENT#"),
      ]);
      const eligible = accounts
        .filter((a) => a.type === "funded" && a.status === "active")
        .map((a) => ({
          accountNo: a.accountNo,
          planLabel: PLAN_LABEL[a.planId] ?? a.planId,
          available: Math.max(0, (a.balance ?? 0) - (PLAN_SIZE[a.planId] ?? 0)),
          split: "90/10",
          minPayout: 250,
        }));
      const card = payments[0];
      return json(200, {
        history,
        eligible,
        status: {
          kycVerified: profile.Item?.kycStatus === "verified",
          method: {
            connected: payments.length > 0,
            label: card ? `${card.brand} •••• ${card.last4}` : "",
          },
          provider: { connected: true, label: "Flick Payouts" },
        },
      });
    }

    default: {
      // GET /accounts/{id}
      if (routeKey?.startsWith("GET /accounts/")) {
        const id = event.pathParameters?.id;
        if (!id) return json(400, { error: "missing_id" });
        const res = await getItem(userId, `ACCOUNT#${id}`);
        if (!res.Item) return json(404, { error: "account_not_found" });
        return json(200, { account: res.Item });
      }
      return json(404, { error: "not_found" });
    }
  }
};
