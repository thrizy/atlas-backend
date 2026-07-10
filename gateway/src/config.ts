export const API_KEY = process.env.DATABENTO_API_KEY ?? "";
export const DATASET = process.env.DATABENTO_DATASET ?? "GLBX.MDP3";
// "continuous" maps Waves symbols (ESM6) → front-month continuous (ES.c.0), which
// auto-rolls — correct for a live terminal. "raw_symbol" passes ESM6 through as-is
// (only useful for a specific non-expired contract).
export const STYPE_IN = process.env.DATABENTO_STYPE_IN ?? "continuous";
export const PORT = Number(process.env.PORT ?? 8080);
export const ALLOWED_ORIGIN = process.env.GATEWAY_ALLOWED_ORIGIN ?? "*";
export const LIVE_POLL_SECONDS = Number(process.env.LIVE_POLL_SECONDS ?? 3);

// Databento HISTORICAL lags real-time by ~15-20 min, and it errors a request whose
// end is beyond available data. So clamp every history `to` to now - this delay.
// (The true recent gap is filled only by the Databento LIVE client — not wired yet.)
export const HISTORY_DELAY_SEC = Number(process.env.HISTORY_DELAY_SEC ?? 480);

// Shared bearer token gating /bars + /ws. When set, only callers presenting it
// (i.e. the gated Waves app) can reach the gateway — so the endpoint isn't open
// to the public pulling data through your Databento key. Empty = open (local dev).
// (Upgrade to Cognito JWT verification when Waves opens to multiple users.)
export const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN ?? "";

// Databento encodes prices as fixed-point int64 in units of 1e-9.
// VERIFY against the ohlcv schema docs on first live test.
export const PRICE_SCALE = 1e-9;

export const configured = Boolean(API_KEY);
