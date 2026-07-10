export const API_KEY = process.env.DATABENTO_API_KEY ?? "";
export const DATASET = process.env.DATABENTO_DATASET ?? "GLBX.MDP3";
// "continuous" maps Waves symbols (ESM6) → front-month continuous (ES.c.0), which
// auto-rolls — correct for a live terminal. "raw_symbol" passes ESM6 through as-is
// (only useful for a specific non-expired contract).
export const STYPE_IN = process.env.DATABENTO_STYPE_IN ?? "continuous";
export const PORT = Number(process.env.PORT ?? 8080);
export const ALLOWED_ORIGIN = process.env.GATEWAY_ALLOWED_ORIGIN ?? "*";
export const LIVE_POLL_SECONDS = Number(process.env.LIVE_POLL_SECONDS ?? 3);

// Databento encodes prices as fixed-point int64 in units of 1e-9.
// VERIFY against the ohlcv schema docs on first live test.
export const PRICE_SCALE = 1e-9;

export const configured = Boolean(API_KEY);
