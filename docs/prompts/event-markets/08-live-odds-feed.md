# 08. Live odds feed and ticker

Read `docs/prompts/event-markets/README.md` first.

## The problem

The reason people watch a market is that it moves. Static pages that refresh on reload lose the live feeling, and the platform's activity surfaces (pulse, trending) say nothing about markets.

## Build

Check for the contract in `api/_lib/event-markets/`. If absent, create the minimal seam from the README first. Read `api/pulse.js`, `api/trending.js` and `api/sniper/stream.js` for how this repo already streams and aggregates.

1. `GET /api/event-markets/stream` (server-sent events, same pattern as the existing streams): per-market odds updates, new picks (anonymous count, never who, unless the picker opted to be public), lock and resolve events. Supports `?slug=` for one market and no param for the global feed. Reconnect with `Last-Event-ID`. Works on Cloud Run with its timeout limits: send heartbeats and document the reconnect behavior.
2. Odds-move detector: define "a notable move" (a threshold on share change within a window, in `data/` config) and emit a `move` event once per crossing. The announcement brief can later read these, so write them to a table too.
3. Pulse and trending: add markets to the platform pulse (live count, biggest mover, closing soon) and to trending (most picks in the last hour). Reuse each endpoint's existing shape.
4. Ticker component: a compact live strip ("Name 41% (+6)", "closes in 2h") usable on the home page and market pages, with reduced-motion support and a pause control. Add it to the home page when at least one market is live and hide it when none are.
5. Client: the market page subscribes to the stream and animates odds changes. Falls back to polling the REST read if SSE fails, and says when it is offline.
6. Load: cap connections per IP, coalesce updates (max one per market per second), and show the measured fan-out cost of 1000 simulated listeners in your report.

## Docs and wiring

`docs/event-markets.md` section "Live feed" with the event schema, `STRUCTURE.md`, changelog entry tagged `feature`.

## Acceptance

- Two browsers: a pick in one moves the odds in the other within a second.
- Killing the connection recovers without a page reload and without duplicate events.
- No console errors. `npm test` green.
