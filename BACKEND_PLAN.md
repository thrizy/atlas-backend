# Atlas — Backend & Database Plan

> Living engineering doc. The dashboard (`app/`, `components/`, `lib/`) is the spec:
> every mock file under `lib/*` is effectively a table definition. The backend's
> job is to make those real without rewriting the UI — each phase swaps a mock
> read for a live API call behind the same data shape.

---

## 0. Locked decisions

| Area | Decision | Why |
|---|---|---|
| **Trading platform** | **Tradovate** (turnkey) | Owns execution, accounts, balances, fills. We sync **read-only** and run the Atlas lifecycle on top. No custom real-time risk engine. |
| **Transactional DB** | **DynamoDB** single-table | AWS-native (IAM, Streams, EventBridge), zero-ops, free-tier at launch. OLTP key-access matches our patterns. |
| **AI / vector DB** | **DataStax Astra** (vector) | Reserved for AI/RAG only (marketing chat, future trader assistant). Not the money core. |
| **Payments** | **Stripe + Flick** | Stripe = global cards (PCI offloaded). Flick = African local rails + payouts. |
| **Auth** | **Amazon Cognito** | Native to Amplify + API Gateway/Lambda. `sub` = canonical user id. |
| **Compute** | **Lambda** + API Gateway (HTTP API) | Pay-per-use, scales to zero. Next.js route handlers may proxy where convenient. |
| **Hosting** | **Amplify** (already live) | Dashboard at `dashboard.myatlasfund.com`. |

**Non-negotiables**
- Ledgers (rewards points, affiliate commission) are **append-only**; balances are derived aggregates updated atomically with the entry.
- **No client-initiated money movement.** Trader *requests*; admin approves; a server Lambda executes.
- **PCI**: only payment-provider tokens are stored — never card numbers.
- All discount / affiliate / points / payout enforcement is **server-side**. The UI's values are display-only until wired.

---

## 1. Architecture

```
                         Cognito (auth, JWT)
                                │
   Browser (dashboard) ──► API Gateway (HTTP API) ──► Lambda ──► DynamoDB  (atlas, single table)
                                                        │            │
                                                        │            └─► Streams ─► S3 (audit + analytics → Athena)
                                                        │
              ┌─────────────────────────────────────────┼───────────────────────────────┐
              │                       │                  │                                │
       Stripe + Flick          Tradovate API       EventBridge (cron)              S3 + CloudFront
   (Checkout / webhooks /   (accounts, cashBalance,  ├─ econ-feed sync (hourly)     (generated certs,
    payout execution)        fills — read-only sync) └─ tradovate sync (1–5 min)     PDF/PNG)

       Astra (vector)  ── AI/RAG only (marketing chat, future trader assistant)
       Secrets Manager ── Stripe/Flick keys, Tradovate creds, Astra token
```

---

## 2. Domain model (mock → real)

| Entity | Mock today | Real owner |
|---|---|---|
| Trader / User | `lib/profile.ts` | identity, KYC, billing, contact |
| Account | `lib/accounts.ts` | size, type (eval/funded), status — **synced from Tradovate** |
| Plan / Product | `lib/pricing.ts`, `PLANS` | size, target, MLL, contracts, fees, add-ons |
| Order (+ line items) | `lib/profile.ts`, add-account cart | purchases, discount, **affiliate attribution** |
| Payment method | `lib/profile.ts` | tokenized cards (provider-held) |
| Payout | `lib/payouts.ts` | request → approve → paid, split, KYC/method state |
| Certificate | `lib/certificates.ts` | issued on lifecycle events |
| Rewards | `lib/rewards.ts` | **points ledger** + redemptions + catalog |
| Affiliate | marketing `lib/site.ts` | codes, attribution, **commission ledger** |
| Trade data / equity / daily P&L | `lib/account-detail.ts` | **synced from Tradovate** |
| Economic calendar | `lib/economic-calendar.ts` | external feed → scheduled sync into DynamoDB |

---

## 3. DynamoDB single-table design

One table: **`atlas`**. Keys: `PK`, `SK`. GSIs: `GSI1`, `GSI2`, `GSI3`.
On-demand billing. DynamoDB Streams enabled (→ audit/analytics).

### 3.1 Items

**User-owned** — `PK = USER#<sub>` (`sub` = Cognito user id):

| SK | Attributes |
|---|---|
| `PROFILE` | email, username, nickname, firstName, lastName, phone, company, billing{…}, kycStatus, memberSince |
| `ACCOUNT#<accountId>` | planId, type (eval\|funded), status (active\|breached\|passed), tradovateAccountId, env (demo\|live), accountNo (ATLEF/ATLFF…) |
| `ORDER#<ts>#<id>` | productId, lineItems[], subtotal, discountCode, affiliateCode, total, provider (stripe\|flick), status |
| `PAYMENT#<pmId>` | provider, brand, last4, exp, isDefault, providerToken (ref only) |
| `PAYOUT#<ts>#<id>` | accountId, amount, split, method, status (requested→approved→paid→failed), idempotencyKey |
| `CERT#<id>` | type (funded\|eval\|payout\|pro), accountId, amount?, issuedAt, assetKey (S3) |
| `RWD#LEDGER#<ts>#<id>` | delta (+/-), reason, refId | (append-only) |
| `RWD#BALANCE` | balance | (aggregate; updated in same tx as ledger) |

**Account-owned, synced from Tradovate** — `PK = ACCT#<accountId>`:

| SK | Attributes |
|---|---|
| `METRICS#LATEST` | balance, netPnl, drawdown, consistency, tradingDays, syncedAt |
| `EQUITY#<date>` | balance, mll (daily equity point → chart) |
| `PNL#<date>` | pnl, trades, winRate (→ trading calendar) |
| `TRADE#<ts>#<id>` | symbol, net, qty, commission, durations, … (→ trade history) |

**Global / reference:**

| PK | SK | Attributes |
|---|---|---|
| `CODE` | `<code>` | type (house\|affiliate), discountPct, affiliateId?, active, expiresAt |
| `AFF#<affId>` | `PROFILE` / `COMMISSION#<ts>` | affiliate profile; commission ledger entries |
| `ECON#<yyyy-mm>` | `<date>#<time>#<id>` | event, currency, impact, forecast, previous |
| `PLAN` | `<planId>` | size, target, mll, contracts, baseFee, activation |
| `IDEMPOTENCY#<key>` | `LOCK` | guards payment/payout retries (conditional write) |

### 3.2 Global secondary indexes

| Index | Keys | Serves |
|---|---|---|
| **GSI1** affiliate | `GSI1PK = AFF#<code>`, `GSI1SK = ORDER#<ts>` | an affiliate's referred orders + commission |
| **GSI2** payout queue | `GSI2PK = PAYOUTQ#<status>`, `GSI2SK = <ts>` | admin approval queue across all users |
| **GSI3** email lookup | `GSI3PK = EMAIL#<email>` | recovery / dedupe → userId |

### 3.3 Access patterns (all satisfied by Query, no Scan)

| Screen / action | Query |
|---|---|
| Account summary (KPIs + cards) | `PK = USER#<sub>` begins_with `ACCOUNT#` |
| Account detail metrics/chart/calendar | `PK = ACCT#<accountId>` begins_with `METRICS#`/`EQUITY#`/`PNL#`/`TRADE#` |
| Order history | `PK = USER#<sub>` begins_with `ORDER#` (SK desc) |
| Payment methods | `PK = USER#<sub>` begins_with `PAYMENT#` |
| Payouts (history + eligible) | `PK = USER#<sub>` begins_with `PAYOUT#` |
| Certificates | `PK = USER#<sub>` begins_with `CERT#` |
| Rewards balance + ledger | `PK = USER#<sub>` `SK = RWD#BALANCE` / begins_with `RWD#LEDGER#` |
| Validate discount/affiliate code | `PK = CODE` `SK = <code>` |
| Admin payout queue | GSI2 `PAYOUTQ#requested` |
| Affiliate dashboard | GSI1 `AFF#<code>` |
| Economic calendar (month) | `PK = ECON#<yyyy-mm>` |

---

## 4. Tradovate integration (read-only sync)

> Confirm specifics against the current Tradovate API docs and your firm's API
> entitlement before building — endpoints/expiry below are the working assumptions.

**Environments**
- Eval accounts → **demo** (`https://demo.tradovateapi.com/v1`) → number prefix `ATLEF`.
- Funded accounts → **live** (`https://live.tradovateapi.com/v1`) → prefix `ATLFF`.

**Auth & tokens**
- Firm-level API credentials (`name`, `password`, `appId`, `appVersion`, `cid`, `sec`) in **Secrets Manager**.
- `POST /auth/accessTokenRequest` → `accessToken` (+ `mdAccessToken`), **~short expiry (~60–90 min)**.
- Cache the token in DynamoDB (`PK=SYS#TRADOVATE, SK=TOKEN`) or SSM; renew via `/auth/renewAccessToken` before expiry. One token-manager Lambda.

**Sync model (polling, EventBridge every 1–5 min)** — `tradovate-sync` Lambda:
1. List active Atlas accounts (those needing sync).
2. Per account, pull from Tradovate: `cashBalance` snapshot, recent `fill`s, `position`s.
3. Upsert `ACCT#<id>` items: `METRICS#LATEST`, today's `EQUITY#`/`PNL#`, new `TRADE#`s.
4. **Compute Atlas lifecycle** from PLAN config (target, MLL, trailing drawdown, min days, consistency) → set `ACCOUNT#` `status`. On transition:
   - `passed` → issue eval cert, surface "Move to Funded".
   - `breached` → lock, issue nothing.
   - funded activation → flip env demo→live, re-number `ATLEF→ATLFF`.

**Hard real-time limits** stay on the platform: set Tradovate **account risk parameters** (trailing max drawdown, daily loss limit) so breaches auto-liquidate in real time. Our sync **mirrors + drives lifecycle** (certs, payouts, UI) — it is not the millisecond stop.

**Why polling, not webhooks:** Tradovate pushes via WebSocket, not arbitrary webhooks. Polling is cheapest/simplest for launch. A later Fargate WebSocket consumer can add true real-time if needed.

---

## 5. Payments — Stripe + Flick

**Buy flow (Add Account, add-ons, reset):**
1. Client → `POST /checkout` with cart + optional code. Lambda **recomputes price server-side** (never trusts client), validates the code (`CODE` item), creates a **Stripe PaymentIntent** (cards) or **Flick** charge (African rails). Returns client secret / redirect.
2. Provider **webhook** (`payment_intent.succeeded` / Flick equivalent) → `payments-webhook` Lambda:
   - Guard with `IDEMPOTENCY#<eventId>` (conditional put).
   - `TransactWriteItems`: write `ORDER#`, apply `affiliateCode` → append `AFF#<affId> COMMISSION#`, credit rewards `RWD#LEDGER#` + bump `RWD#BALANCE`.
   - Trigger Tradovate account provisioning (eval account on demo).
3. **Payment methods**: created via Stripe SetupIntent; we store only `brand/last4/exp/token-ref`.

**Discount / affiliate enforcement** lives entirely here — the dashboard's ATLAS40 / affiliate codes become real only at this step.

---

## 6. Payouts — request → approve → execute

1. **Request** (trader): `POST /payouts` → conditional write, requires `kycStatus=verified` **and** account eligible (funded, in profit, cycle open). Creates `PAYOUT#` status `requested` + GSI2 `PAYOUTQ#requested`.
2. **Approve** (admin/ops): transitions `requested→approved`. Audit entry.
3. **Execute** (server): `payout-execute` Lambda calls **Flick** (African rails) or **Stripe** payout, with an idempotency key; on success `approved→paid`, issue payout cert, append ledger. On failure `→failed`, no money moved twice.

KYC/AML status gates everything. Never executed from the client.

---

## 7. Rewards, Certificates, Affiliate

- **Rewards**: every earn/redeem = `RWD#LEDGER#` row; `RWD#BALANCE` updated in the **same transaction**. Redeem = conditional tx (`balance ≥ cost`) that also creates the entitlement (free reset / eval / add-on).
- **Certificates**: issued by sync/payment/payout Lambdas on events. A `cert-render` Lambda generates PNG/PDF (e.g. `@vercel/og` / headless) → **S3**, served via **CloudFront**; share link is a public verify URL backed by the `CERT#` item.
- **Affiliate**: orders tagged with `affiliateCode` accrue to `AFF#<affId> COMMISSION#` (the 20% recurring model from marketing). Affiliate payouts reuse the §6 workflow.

---

## 8. Auth — Cognito

- User pool; `sub` is the canonical `userId` used in every `USER#<sub>` partition.
- **Post-confirmation trigger** → create `PROFILE` item + `GSI3 EMAIL#`.
- API Gateway **JWT authorizer** validates the Cognito token; Lambdas read `userId` from claims — **never from the request body**.
- Dashboard uses Amplify Auth / Cognito Hosted UI (the marketing login/signup pages already exist as the front door).

---

## 9. Economic feed — scheduled sync

- **EventBridge hourly** → `econ-sync` Lambda: fetch FairEconomy feed (USD), upsert `ECON#<yyyy-mm>` items.
- Both apps then read the **economic calendar from our API**, not ForexFactory directly → removes the two-apps-polling-upstream problem and centralizes the licensing/attribution decision.
- The current `/api/economic-calendar` route handlers become thin readers of DynamoDB (seed stays as fallback).

---

## 10. AI / Astra vector (separate track)

- Astra (vector) powers **RAG only**: marketing AI chat knowledge base (`lib/knowledge.ts`) as embeddings, and a future trader-facing assistant.
- Kept fully separate from the transactional core — no orders/payouts in Cassandra.

---

## 11. Security & compliance

- **PCI**: provider tokens only; raw PANs never touch our systems (mirrors the UI rule — "Add card" goes through the provider).
- **KYC/AML**: `kycStatus` on `PROFILE`; gates payouts and funded activation.
- **Idempotency**: `IDEMPOTENCY#<key>` conditional writes on all payment/payout ops (webhooks retry).
- **Secrets**: Stripe/Flick keys, Tradovate creds, Astra token in **Secrets Manager / SSM** — never committed (the dashboard ships with **no** `.env`).
- **IAM**: least-privilege per Lambda (scoped table actions + specific secrets).
- **Audit**: DynamoDB **Streams → S3** = immutable audit log + analytics source (Athena for reporting, covering Dynamo's weak ad-hoc query story).
- **Tenant isolation**: a Lambda may only touch `USER#<sub>` for the authenticated `sub` (enforced in code + IAM where possible).

---

## 12. Infrastructure as code & environments

- **IaC**: AWS **CDK** (or SAM) for the table, GSIs, Lambdas, API, Cognito, EventBridge, S3/CloudFront, Secrets.
- **Envs**: `dev` and `prod` stacks (separate tables, separate Tradovate demo/live creds, separate Stripe/Flick keys).
- **CI/CD**: dashboard already auto-deploys via Amplify on push to `main`; backend deploys via CDK pipeline (or `cdk deploy` per env).

---

## 13. Phased rollout

Each phase replaces a mock `lib/*` read with a live API call behind the **same data shape** — no UI rewrites.

| Phase | Deliverable | Replaces |
|---|---|---|
| **1. Auth + read APIs** | Cognito pool + triggers; `atlas` table (CDK); `GET /profile`, `GET /accounts`, `GET /accounts/:id` | `lib/profile.ts`, `lib/accounts.ts` reads |
| **2. Commerce** | `POST /checkout` (Stripe), webhook, server-side discount/affiliate enforcement, payment methods | add-account, `pricing.ts`, `ORDERS` |
| **3. Tradovate sync** | token manager + `tradovate-sync` (EventBridge); lifecycle status, metrics/chart/calendar/trades | `lib/account-detail.ts`, account `status`/`balance` |
| **4. Payouts** | request → approve → execute (Flick/Stripe), KYC gating, admin queue | `lib/payouts.ts` |
| **5. Rewards + Certs + Affiliate** | points ledger + redemptions; cert render to S3/CloudFront; commission ledger + affiliate dashboard | `lib/rewards.ts`, `lib/certificates.ts`, affiliate |
| **6. Econ feed + AI** | EventBridge econ-sync into DynamoDB; Astra vector RAG | `lib/economic-calendar.ts`, marketing chat |

---

## 14. Open questions / TODO

- [ ] Confirm Tradovate **API entitlement** (API access add-on) and current auth/expiry specifics.
- [ ] Tradovate **account provisioning**: programmatic on purchase, or manual/ops step at launch?
- [ ] Eval = Tradovate **demo/sim**; funded = **live** vs **sim-funded**? (affects env + numbering flip)
- [ ] Flick payout API contract (auth, idempotency, supported corridors) for §6.
- [ ] Stripe vs Flick routing rule (by country / currency).
- [ ] Admin surface: where ops approves payouts / KYC (separate admin app vs protected dashboard routes).
- [ ] Reporting needs → confirm DynamoDB→S3→Athena is enough, or add an OLAP mirror later.

---

_Decisions locked: Tradovate · DynamoDB (core) + Astra (vector/AI) · Stripe + Flick · Cognito._
