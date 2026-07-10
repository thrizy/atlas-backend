import { fetchHistory, type Bar } from "./databento.js";
import { LIVE_POLL_SECONDS } from "./config.js";

export type BarHandler = (bar: Bar) => void;

/**
 * PLACEHOLDER live source. Polls the latest OHLCV bar from Databento history and
 * emits it as the forming bar. Good enough to build/verify the pipe, but it is
 * NOT low-latency (history lags, and polling ≠ streaming).
 *
 * For production real-time: replace with a DatabentoLiveSource backed by the
 * Databento **Live** client (raw binary feed — official Python/Rust/C++ client,
 * run as a sidecar, or a Node port when available). Keep the same
 * subscribe/unsubscribe + emit(bar) shape and nothing downstream changes.
 */
export class PollingLiveSource {
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private handlers = new Map<string, Set<BarHandler>>();

  private key(symbol: string, res: number) {
    return `${symbol}|${res}`;
  }

  subscribe(symbol: string, res: number, onBar: BarHandler): void {
    const k = this.key(symbol, res);
    if (!this.handlers.has(k)) this.handlers.set(k, new Set());
    this.handlers.get(k)!.add(onBar);

    if (!this.timers.has(k)) {
      const poll = async () => {
        try {
          const to = Math.floor(Date.now() / 1000);
          const from = to - res * 2;
          const bars = await fetchHistory(symbol, res, from, to, 1);
          const last = bars[bars.length - 1];
          if (last) for (const h of this.handlers.get(k) ?? []) h(last);
        } catch (e) {
          console.error("[live] poll failed", k, (e as Error).message);
        }
      };
      void poll();
      this.timers.set(k, setInterval(poll, Math.max(1, LIVE_POLL_SECONDS) * 1000));
    }
  }

  unsubscribe(symbol: string, res: number, onBar: BarHandler): void {
    const k = this.key(symbol, res);
    const set = this.handlers.get(k);
    set?.delete(onBar);
    if (set && set.size === 0) {
      clearInterval(this.timers.get(k));
      this.timers.delete(k);
      this.handlers.delete(k);
    }
  }
}
