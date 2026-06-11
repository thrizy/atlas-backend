# Atlas Backend (CDK)

AWS backend for the Atlas trader dashboard — DynamoDB single-table, Cognito,
API Gateway, and Lambda. Deploys independently of the dashboard (Amplify) and
marketing site.

See [`BACKEND_PLAN.md`](./BACKEND_PLAN.md) for the full architecture and roadmap.

## Phase 1 (this stack)

- **DynamoDB** table `atlas-<stage>` (PK/SK, GSI1/2/3, streams, PITR, on-demand).
- **Cognito** user pool + dashboard app client, with a **post-confirmation**
  Lambda that writes the `USER#<sub>` `PROFILE` item on signup.
- **HTTP API** (API Gateway v2) with a Cognito JWT authorizer.
- Lambdas: `GET /profile`, `GET /accounts` (read the user's own partition).

- **DynamoDB** table `atlas-<stage>` (PK/SK, GSI1/2/3, streams, PITR, on-demand).
- **Cognito** user pool + dashboard app client, with a **post-confirmation**
  Lambda that writes the `USER#<sub>` `PROFILE` item on signup.
- **HTTP API** (API Gateway v2) with a Cognito JWT authorizer.
- Lambdas: `GET /profile`, `GET /accounts` (read the user's own partition).

## Prerequisites

- AWS credentials configured (`aws sts get-caller-identity` works).
- Node 20, and Docker **not** required (esbuild bundles locally).

## Deploy

```bash
cd infra
npm install

# one-time per account+region
npx cdk bootstrap

# dev (default)
npx cdk deploy --context stage=dev

# prod (RETAIN removal policy)
npx cdk deploy --context stage=prod
```

## Outputs → wire into the dashboard

After deploy, CDK prints:

| Output | Use in dashboard |
|---|---|
| `ApiUrl` | `NEXT_PUBLIC_API_URL` |
| `UserPoolId` | `NEXT_PUBLIC_COGNITO_USER_POOL_ID` |
| `UserPoolClientId` | `NEXT_PUBLIC_COGNITO_CLIENT_ID` |
| `Region` | `NEXT_PUBLIC_AWS_REGION` |
| `TableName` | (backend only) |

Set these as **Amplify environment variables** on the dashboard app (not
committed). The dashboard's Amplify Auth config + a small API client then
replace the mock reads in `lib/profile.ts` and `lib/accounts.ts`.

## Smoke test (after deploy)

1. Create a user in the Cognito console (or via the dashboard signup) → confirm.
2. Verify the `PROFILE` item exists in the `atlas-dev` table.
3. Grab an ID token for that user and call:
   ```bash
   curl -H "Authorization: Bearer <ID_TOKEN>" <ApiUrl>/profile
   curl -H "Authorization: Bearer <ID_TOKEN>" <ApiUrl>/accounts
   ```

## Notes

- CORS is `*` for dev — tighten to `https://dashboard.myatlasfund.com` before prod.
- Seed a couple of `ACCOUNT#` items manually to see `/accounts` return data
  until the Tradovate sync (Phase 3) populates them.
- Next phases (commerce, Tradovate sync, payouts) add Lambdas + EventBridge +
  Stripe/Flick webhooks to this same stack.
