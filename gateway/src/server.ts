import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { PORT, ALLOWED_ORIGIN, configured } from "./config.js";
import { fetchHistory, type Bar } from "./databento.js";
import { PollingLiveSource, type BarHandler } from "./live.js";

const live = new PollingLiveSource();

function cors(res: http.ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "authorization, accept");
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, configured }));
    return;
  }

  // GET /bars?symbol=ESM6&res=60&from=<sec>&to=<sec>&limit=320
  if (url.pathname === "/bars" && req.method === "GET") {
    const symbol = url.searchParams.get("symbol") ?? "";
    const resSec = Number(url.searchParams.get("res") ?? 60);
    const from = Number(url.searchParams.get("from") ?? 0);
    const to = Number(url.searchParams.get("to") ?? Math.floor(Date.now() / 1000));
    const limit = Number(url.searchParams.get("limit") ?? 500);
    if (!symbol || !resSec) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "symbol and res required" }));
      return;
    }
    try {
      const bars = await fetchHistory(symbol, resSec, from, to, limit);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ bars }));
    } catch (e) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: (e as Error).message }));
    }
    return;
  }

  res.writeHead(404);
  res.end();
});

// --- live bars over WSS: /ws ---
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws: WebSocket) => {
  const subs = new Map<string, BarHandler>();
  const keyOf = (symbol: string, res: number) => `${symbol}|${res}`;

  ws.on("message", (raw) => {
    let msg: { type?: string; symbol?: string; res?: number };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const symbol = String(msg.symbol ?? "");
    const resSec = Number(msg.res ?? 0);
    if (!symbol || !resSec) return;
    const k = keyOf(symbol, resSec);

    if (msg.type === "sub" && !subs.has(k)) {
      const handler: BarHandler = (bar: Bar) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "bar", symbol, res: resSec, bar }));
        }
      };
      subs.set(k, handler);
      live.subscribe(symbol, resSec, handler);
    } else if (msg.type === "unsub") {
      const handler = subs.get(k);
      if (handler) {
        live.unsubscribe(symbol, resSec, handler);
        subs.delete(k);
      }
    }
  });

  ws.on("close", () => {
    for (const [k, handler] of subs) {
      const [symbol, resSec] = k.split("|");
      live.unsubscribe(symbol, Number(resSec), handler);
    }
    subs.clear();
  });
});

server.listen(PORT, () => {
  console.log(
    `[gateway] listening on :${PORT}  databento=${configured ? "configured" : "NOT configured (set DATABENTO_API_KEY)"}`
  );
});
