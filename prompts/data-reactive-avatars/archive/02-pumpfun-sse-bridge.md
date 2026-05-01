# 02 — Server-Sent Events bridge for the pump.fun live feed

## Why

`api/_lib/pumpfun-ws-feed.js` already maintains a real connection to `wss://pumpportal.fun/api/data` with reconnect, SOL-price enrichment, and metadata fetch. But the browser cannot consume that helper directly — and we don't want every visitor's tab opening its own raw WS to PumpPortal (rate limits, CORS, duplicate metadata fetches).

Add a real SSE endpoint that fans out the existing feed to browsers so `<agent-3d>` skills can subscribe with a single `new EventSource(...)` and receive enriched, normalized events.

## Real, no-mock requirements

- The endpoint connects to the actual PumpPortal WebSocket via `connectPumpFunFeed` from `api/_lib/pumpfun-ws-feed.js`. No synthetic event generation, no fixture replay.
- If the upstream is down at the moment of a request, the endpoint returns the SSE stream anyway and forwards events as they arrive (the helper already reconnects). Do not fabricate events to "warm" the stream.

## Scope

Add a new action `live-stream` to `api/pump/[action].js` (the consolidated dispatcher), following the same conventions as the existing `strategy-run` SSE handler (which already bypasses `wrap()`):

1. Method: `GET`. CORS allowed (`cors(req, res, { methods: 'GET,OPTIONS' })`); no auth required (public read-only firehose, same as the upstream); rate-limited via `limits.mcpIp(clientIp(req))`.
2. Query params: `kind` ∈ `all` | `mint` | `graduation` (default `all`). Validate with zod.
3. Set headers: `content-type: text/event-stream; charset=utf-8`, `cache-control: no-cache, no-transform`, `connection: keep-alive`, `x-accel-buffering: no`.
4. Send a `: ping` comment every 15 s to keep proxies from killing the stream.
5. For each event from `connectPumpFunFeed({ onEvent, kind })`, write `event: <kind>\ndata: <JSON>\n\n` where `<kind>` is `mint` or `graduation` and `<JSON>` is the normalized payload from the helper.
6. Wire the upstream `stop` to `req.on('close', stop)` so dropped clients release the WS subscription. If this is the last subscriber, the helper's `ws.close()` already runs — do not add reference counting unless you measure it's actually needed.
7. Cap a single connection at 60 minutes server-side (write a final `event: end\ndata: {"reason":"max-duration"}\n\n` then `res.end()`); the browser is expected to reconnect — `EventSource` does this automatically.

Update the dispatcher header comment block and the SSE-bypass guard near the top of `api/pump/[action].js` so `live-stream` is routed before `wrap()` (same pattern as `strategy-run`).

## Out of scope

- Database persistence of events.
- Per-user filtering or auth.
- A polling fallback — `EventSource` is universally supported in evergreen browsers.

## Verification (must all pass before archiving)

- Add `tests/pump-live-stream.test.mjs` (or matching style of existing pump tests) that:
  - Spawns the handler with a real `req`/`res` mock that captures written chunks.
  - Calls the handler, waits up to 30 s for at least one real `event: mint` chunk arriving via PumpPortal.
  - If `process.env.SKIP_NETWORK_TESTS === '1'`, **skip** the test (do not substitute fake data).
- Manual smoke: run `vercel dev` (or `npm run dev` if that's the script), open `curl -N "http://localhost:3000/api/pump/live-stream?kind=all"` — within 60 s real `mint` events stream in.
- `npm run lint` clean.

## When done

1. Note the new action in the dispatcher's top-of-file action map comment.
2. `git mv prompts/data-reactive-avatars/02-pumpfun-sse-bridge.md prompts/data-reactive-avatars/archive/02-pumpfun-sse-bridge.md`.
