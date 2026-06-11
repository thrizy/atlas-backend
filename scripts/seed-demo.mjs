// ─────────────────────────────────────────────────────────────────────────────
// Seed the demo trader's data into DynamoDB, against a real Cognito user.
//
// Usage:
//   node scripts/seed-demo.mjs --sub <cognitoSub> --email <email> \
//        --table atlas-dev --region us-east-2
//
// Idempotent — PutRequests overwrite by key, so re-running is safe.
// Mirrors the dashboard's mock lib/* data so the wired endpoints (/profile,
// /accounts) return a fully-populated dashboard; the rest sits ready for the
// phases that wire them (orders, payouts, certs, rewards).
// ─────────────────────────────────────────────────────────────────────────────
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";

// ── args ─────────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);
const SUB = args.sub;
const EMAIL = args.email;
const TABLE = args.table ?? "atlas-dev";
const REGION = args.region ?? "us-east-2";
if (!SUB || !EMAIL) {
  console.error("Missing --sub and/or --email. See header for usage.");
  process.exit(1);
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});
const U = `USER#${SUB}`;

// ── plan reference (for derived metrics) ─────────────────────────────────────
const PLANS = {
  "25k": { size: 25000, target: 26250, mll: 24000 },
  "50k": { size: 50000, target: 53000, mll: 48000 },
  "100k": { size: 100000, target: 106000, mll: 97000 },
  "150k": { size: 150000, target: 159000, mll: 145500 },
};
const DEF_PLATFORMS = ["NinjaTrader", "Tradovate", "TradingView"];

// ── accounts (mirror MOCK_ACCOUNTS) ──────────────────────────────────────────
const ACCOUNTS = [
  { id: "50640021", planId: "50k", type: "eval", status: "active", balance: 51420, tradingDays: 3, consistency: 64 },
  { id: "100640027", planId: "100k", type: "eval", status: "passed", balance: 106240, tradingDays: 4, consistency: 72 },
  { id: "50640024", planId: "50k", type: "funded", status: "active", balance: 54800, tradingDays: 6, consistency: 71 },
  { id: "50640022", planId: "50k", type: "eval", status: "active", balance: 50890, tradingDays: 2, consistency: 81 },
  { id: "100640023", planId: "100k", type: "eval", status: "active", balance: 103120, tradingDays: 5, consistency: 47, platforms: ["Tradovate", "TradingView"] },
  { id: "25640025", planId: "25k", type: "eval", status: "breached", balance: 23910, tradingDays: 1, consistency: 100 },
  { id: "150640026", planId: "150k", type: "eval", status: "breached", balance: 145110, tradingDays: 2, consistency: 100, platforms: ["NinjaTrader", "Quantower"] },
];

// ── orders (mirror ORDERS) ───────────────────────────────────────────────────
const ORDERS = [
  { id: "ATL-50640024", date: "2026-05-18", product: "ATLAS 50K — Activation", total: 74, method: "Visa •••• 4242", status: "completed" },
  { id: "ATL-50640024E", date: "2026-04-30", product: "ATLAS 50K Evaluation", total: 119, method: "Visa •••• 4242", status: "completed" },
  { id: "ATL-100640027", date: "2026-05-12", product: "ATLAS 100K Evaluation", total: 238, method: "Visa •••• 4242", status: "completed" },
  { id: "ATL-ADD-0098", date: "2026-05-12", product: "Daily Payouts Add-on", total: 52, method: "Visa •••• 4242", status: "completed" },
  { id: "ATL-100640023", date: "2026-05-02", product: "ATLAS 100K Evaluation", total: 238, method: "Mastercard •••• 5577", status: "completed" },
  { id: "ATL-RST-0451", date: "2026-04-21", product: "Eval Reset — ATLAS 100K", total: 89, method: "Visa •••• 4242", status: "completed" },
  { id: "ATL-25640025", date: "2026-04-09", product: "ATLAS 25K Evaluation", total: 77, method: "Visa •••• 4242", status: "refunded" },
  { id: "ATL-150640026", date: "2026-03-27", product: "ATLAS 150K Evaluation", total: 279, method: "Visa •••• 4242", status: "failed" },
  { id: "ATL-150640026R", date: "2026-03-27", product: "ATLAS 150K Evaluation", total: 279, method: "Mastercard •••• 5577", status: "completed" },
  { id: "ATL-50640021", date: "2026-02-14", product: "ATLAS 50K Evaluation", total: 119, method: "Visa •••• 4242", status: "completed" },
  { id: "ATL-50640022", date: "2026-01-28", product: "ATLAS 50K Evaluation", total: 119, method: "Visa •••• 4242", status: "completed" },
  { id: "ATL-WEL-0001", date: "2026-01-20", product: "ATLAS 25K Evaluation", total: 77, method: "Visa •••• 4242", status: "completed" },
];

const PAYMENTS = [
  { id: "pm_1", brand: "Visa", last4: "4242", exp: "08/29", isDefault: true },
  { id: "pm_2", brand: "Mastercard", last4: "5577", exp: "02/27", isDefault: false },
];

const PAYOUTS = [
  { id: "ATLFF50640024", ts: "2026-03-12T00:00:00Z", requestDate: "2026-03-12", approvalDate: "2026-03-12", amount: 502.75, status: "paid" },
  { id: "ATLFF50640024", ts: "2026-02-20T00:00:00Z", requestDate: "2026-02-20", approvalDate: "2026-02-21", amount: 815.4, status: "paid" },
];

const CERTS = [
  { id: "cert-funded-50640024", type: "funded", date: "2026-05-25", accountNo: "ATLFF50640024", planLabel: "ATLAS 50K" },
  { id: "cert-eval-100640027", type: "eval", date: "2026-05-22", accountNo: "ATLEF100640027", planLabel: "ATLAS 100K" },
  { id: "cert-payout-0312", type: "payout", date: "2026-03-13", accountNo: "ATLFF50640024", amount: 503 },
  { id: "cert-pro-2026", type: "pro", date: "2026-03-04", accountNo: "ATLFF50640024", planLabel: "ATLAS 50K", note: "Atlas Pro Trader" },
];

const REWARD_LEDGER = [
  { ts: "2026-05-25T10:00:00Z", delta: 2000, reason: "Eval passed — ATLAS 100K" },
  { ts: "2026-05-18T10:00:00Z", delta: 3000, reason: "Funded activation — ATLAS 50K" },
  { ts: "2026-03-12T10:00:00Z", delta: 2250, reason: "Payout milestone" },
];
const POINTS_BALANCE = 7250;

// ── build items ──────────────────────────────────────────────────────────────
const items = [];

// Profile
items.push({
  PK: U, SK: "PROFILE", type: "PROFILE",
  email: EMAIL, username: "dipo.olojede", nickname: "dipo.olojede",
  firstName: "Dipo", lastName: "Olojede", phone: "+1 437 575 3075", company: "",
  kycStatus: "verified", memberSince: "2026-01-20T00:00:00Z",
  GSI3PK: `EMAIL#${EMAIL.toLowerCase()}`, GSI3SK: U,
});

// Accounts + per-account metrics snapshot
for (const a of ACCOUNTS) {
  const plan = PLANS[a.planId];
  items.push({
    PK: U, SK: `ACCOUNT#${a.id}`,
    id: a.id, planId: a.planId, type: a.type, status: a.status,
    platforms: a.platforms ?? DEF_PLATFORMS, balance: a.balance,
    tradingDays: a.tradingDays, minTradingDays: 2, consistency: a.consistency,
    accountNo: `ATL${a.type === "funded" ? "FF" : "EF"}${a.id}`,
  });
  items.push({
    PK: `ACCT#${a.id}`, SK: "METRICS#LATEST",
    balance: a.balance, netPnl: a.balance - plan.size, drawdown: a.balance - plan.mll,
    consistency: a.consistency, tradingDays: a.tradingDays, syncedAt: "2026-06-10T00:00:00Z",
  });
}

// Orders
for (const o of ORDERS) {
  items.push({
    PK: U, SK: `ORDER#${o.date}T00:00:00Z#${o.id}`,
    id: o.id, date: o.date, product: o.product, total: o.total, method: o.method, status: o.status,
  });
}

// Payment methods
for (const p of PAYMENTS) {
  items.push({ PK: U, SK: `PAYMENT#${p.id}`, ...p });
}

// Payouts
for (const p of PAYOUTS) {
  items.push({ PK: U, SK: `PAYOUT#${p.ts}#${p.id}`, ...p });
}

// Certificates
for (const c of CERTS) {
  items.push({ PK: U, SK: `CERT#${c.id}`, ...c });
}

// Rewards — ledger + balance aggregate
for (const l of REWARD_LEDGER) {
  items.push({ PK: U, SK: `RWD#LEDGER#${l.ts}`, delta: l.delta, reason: l.reason });
}
items.push({ PK: U, SK: "RWD#BALANCE", balance: POINTS_BALANCE });

// ── write (chunks of 25) ─────────────────────────────────────────────────────
async function run() {
  for (let i = 0; i < items.length; i += 25) {
    const chunk = items.slice(i, i + 25);
    await ddb.send(
      new BatchWriteCommand({
        RequestItems: { [TABLE]: chunk.map((Item) => ({ PutRequest: { Item } })) },
      })
    );
  }
  console.log(`Seeded ${items.length} items into ${TABLE} for ${EMAIL} (sub ${SUB}).`);
  console.log(`  accounts=${ACCOUNTS.length} orders=${ORDERS.length} payouts=${PAYOUTS.length} certs=${CERTS.length}`);
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
