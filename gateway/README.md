# Atlas market-data gateway

Holds the **Databento** API key server-side and proxies CME (GLBX.MDP3) data to
Waves. Waves never talks to Databento directly. Implements the contract in
`atlas-waves/src/lib/marketdata/README-gateway.md`.

- `GET /bars?symbol=&res=&from=&to=&limit=` → `{ bars: [...] }` (real Databento history)
- `WSS /ws` → subscribe `{type:"sub",symbol,res}` → receive `{type:"bar",symbol,res,bar}`
- `GET /health` → `{ ok, configured }`

## Run locally

```bash
cd gateway
cp .env.example .env         # paste your DATABENTO_API_KEY
npm install
npm run dev                  # tsx watch on :8080
# test history:
curl "http://localhost:8080/bars?symbol=ESM6&res=60&from=$(($(date +%s)-3600))&to=$(date +%s)&limit=60"
```

Then point Waves at it (`atlas-waves/.env.local`):
```
VITE_MARKETDATA_HTTP=http://localhost:8080
VITE_MARKETDATA_WSS=ws://localhost:8080/ws
```
`marketdata/index.ts` auto-switches from mock → Databento. Rebuild Waves.

## Deploy

It needs a **persistent process** (not Lambda) because the live feed holds an
open connection. Good targets: **AWS App Runner** or **ECS/Fargate** (Docker
provided). Set env: `DATABENTO_API_KEY`, `GATEWAY_ALLOWED_ORIGIN=https://waves.myatlasfund.com`.
Front it with a domain, e.g. `md.myatlasfund.com`, then set the Waves env to the
`https://` / `wss://` URLs.

## ⚠️ Verify on first live test (Databento specifics)

These are coded to Databento's documented v0 API but must be confirmed with a
real key, since they're the usual gotchas:

1. **Symbology** — `DATABENTO_STYPE_IN=raw_symbol` with `ESM6`-style symbols.
   Confirm the exact symbol format for GLBX.MDP3 (or use `continuous` + `ES.c.0`).
2. **Price scale** — `PRICE_SCALE=1e-9` (fixed-point). Confirm on the ohlcv schema.
3. **Response format** — assumes newline-delimited JSON (`encoding=json`). Confirm.
4. **OHLCV schemas** — only 1s/1m/1h/1d exist; 5m/15m/4h are aggregated here.

## ⚠️ Live source is a placeholder

`live.ts` currently **polls history** to emit forming bars — fine for building,
NOT low-latency. For production, swap `PollingLiveSource` for a `DatabentoLiveSource`
backed by the Databento **Live** client (raw binary feed; official Python/Rust/C++
client as a sidecar, or a Node port). Same emit shape → no downstream changes.

## ⚠️ Licensing

Serving live data to real Waves users = **redistribution** → requires the CME
redistribution/sub-vendor license (ILA) + per-user fees. Single-dev build phase on
`raw_symbol` history is fine under personal/non-pro. Switch before the first
external user. See atlas-backend BACKEND_PLAN + partnerships playbook.

## Add real auth before production

`/bars` and `/ws` are currently open (CORS-gated only). Before real users, verify
the **Cognito JWT** on connect so only signed-in Waves users reach the gateway.
