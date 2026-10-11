# Trenches Pulse

Live market intelligence for the Solana and Robinhood Chain trenches: every pump.fun launch and graduation as it happens, hottest tokens by trade flow, runner and death tracking, tech-vs-meme classification, scored smart-money wallets, a daily Telegram newsletter and a Postgres archive. The engine is [Pulse](https://github.com/nirholas/pulse) (MIT), vendored unchanged except for one fix at [services/pulse](../services/pulse).

## Pieces

| Piece | Path | Role |
|---|---|---|
| Pulse service | [services/pulse](../services/pulse) | Always-on Node process: Solana firehose over WebSocket, scheduler, Hono API, its own dashboard on one port. PGlite by default, Postgres/Timescale via `DATABASE_URL`. |
| Proxy | [api/trenches.js](../api/trenches.js) `-> /api/trenches?view=overview\|health\|tokens\|launches\|wallets` | Allowlisted read-only proxy. Unset or failing upstream is `503 pulse_offline`, never fabricated data. Env: `PULSE_URL`. |
| Page | [pages/trenches.html](../pages/trenches.html) + [src/trenches.js](../src/trenches.js) `-> /trenches` | Counters, hottest tokens, launch feed, wallet scores, 15 s polling that pauses on hidden tabs, designed offline state. Token text is untrusted and is written with `textContent`. |

## Run locally

```bash
cd services/pulse && npm ci && npm run build && PORT=8799 node dist/pulse.js
PULSE_URL=http://localhost:8799 PORT=3018 node --env-file=.env.local server/index.mjs
DEV_API_PROXY=http://localhost:3018 npx vite --port 3055   # then open /trenches
```

## Deploy (owner-gated)

Build [services/pulse/Dockerfile](../services/pulse/Dockerfile) and run it on Cloud Run with `min-instances=1` and CPU always allocated (the firehose is a long-lived WebSocket). Use a durable `DATABASE_URL` (Cloud SQL) because the embedded PGlite directory is ephemeral on Cloud Run, set `SOLANA_WS_URLS` to a dedicated endpoint for a steady firehose, then add `PULSE_URL` to `three-ws-api` with `--update-env-vars`.

Tests: [tests/trenches-api.test.js](../tests/trenches-api.test.js), plus the service suite (`cd services/pulse && npm test`), which includes the regression test for the embedded database starting on a fresh clone.
