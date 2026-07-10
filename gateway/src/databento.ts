import { API_KEY, DATASET, STYPE_IN, PRICE_SCALE } from "./config.js";

export type Bar = {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

// resolution (seconds) → Databento OHLCV base schema + aggregation factor.
// Databento provides ohlcv-1s / 1m / 1h / 1d; 5m/15m/4h are aggregated here.
export function planFor(resSec: number): { schema: string; baseSec: number } {
  if (resSec % 86_400 === 0) return { schema: "ohlcv-1d", baseSec: 86_400 };
  if (resSec % 3_600 === 0) return { schema: "ohlcv-1h", baseSec: 3_600 };
  if (resSec % 60 === 0) return { schema: "ohlcv-1m", baseSec: 60 };
  return { schema: "ohlcv-1s", baseSec: 1 };
}

type OhlcvRecord = {
  hd?: { ts_event?: string | number };
  ts_event?: string | number;
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
  volume: string | number;
};

function toBar(rec: OhlcvRecord): Bar {
  const tsNs = Number(rec.hd?.ts_event ?? rec.ts_event ?? 0);
  return {
    time: Math.floor(tsNs / 1e9), // ns → seconds
    open: Number(rec.open) * PRICE_SCALE,
    high: Number(rec.high) * PRICE_SCALE,
    low: Number(rec.low) * PRICE_SCALE,
    close: Number(rec.close) * PRICE_SCALE,
    volume: Number(rec.volume),
  };
}

// Aggregate base bars up to `resSec` buckets (e.g. 1m → 5m).
export function aggregate(bars: Bar[], resSec: number, baseSec: number): Bar[] {
  if (resSec === baseSec) return bars;
  const out: Bar[] = [];
  let cur: Bar | null = null;
  for (const b of bars) {
    const bucket = Math.floor(b.time / resSec) * resSec;
    if (!cur || cur.time !== bucket) {
      if (cur) out.push(cur);
      cur = { time: bucket, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Fetch OHLCV history from the Databento HTTP API and return bars at `resSec`.
 * Docs: https://databento.com/docs/api-reference-historical/timeseries/timeseries-get-range
 *
 * VERIFY on first live test: symbology (STYPE_IN / symbol format), price scale,
 * and that JSON comes back newline-delimited (NDJSON).
 */
export async function fetchHistory(
  symbol: string,
  resSec: number,
  fromSec: number,
  toSec: number,
  limit: number
): Promise<Bar[]> {
  const { schema, baseSec } = planFor(resSec);
  const url = new URL("https://hist.databento.com/v0/timeseries.get_range");
  url.searchParams.set("dataset", DATASET);
  url.searchParams.set("symbols", symbol);
  url.searchParams.set("schema", schema);
  url.searchParams.set("stype_in", STYPE_IN);
  url.searchParams.set("start", new Date(fromSec * 1000).toISOString());
  url.searchParams.set("end", new Date(toSec * 1000).toISOString());
  url.searchParams.set("encoding", "json");

  const auth = Buffer.from(`${API_KEY}:`).toString("base64"); // key as username, empty password
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) {
    throw new Error(`databento ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const text = (await res.text()).trim();
  if (!text) return [];
  const records: OhlcvRecord[] = text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as OhlcvRecord);

  const bars = aggregate(records.map(toBar), resSec, baseSec);
  return limit > 0 ? bars.slice(-limit) : bars;
}
