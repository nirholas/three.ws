# Trenches Pulse

Live market intelligence for the Solana and Robinhood Chain trenches: every pump.fun launch and graduation as it happens, hottest tokens by trade flow, runner and death tracking, tech-vs-meme classification, scored smart-money wallets, a daily Telegram newsletter and a Postgres archive. The engine is [Pulse](https://github.com/nirholas/pulse) (MIT), vendored unchanged except for one fix at [services/pulse](../services/pulse).

## Pieces

| Piece | Path | Role |
|---|---|---|
| Pulse service | [services/pulse](../services/pulse) | Always-on Node process: Solana firehose over WebSocket, scheduler, Hono API, its own dashboard on one port. PGlite by default, Postgres/Timescale via `DATABASE_URL`. |
| Proxy | [api/trenches.js](../api/trenches.js) `-> /api/trenches?view=overview\|health\|tokens\|launches\|wallets` | Allowlisted read-only proxy. Unset or failing upstream is `503 pulse_offline`, never fabricated data. Env: `PULSE_URL`. |
| Page | [pages/trenches.html](../pages/trenches.html) + [src/trenches.js](../src/trenches.js) `-> /trenches` | Counters, hottest tokens, launch feed, wallet scores, 15 s polling that pauses on hidden tabs and backs off (30 s, 60 s, then every 2 min) while Pulse is failing, probing `health` alone first so an offline upstream costs one request per cycle, designed offline state. Token text is untrusted and is written with `textContent`. |

## Run locally

```bash
cd services/pulse && npm ci && npm run build && PORT=8799 node dist/pulse.js
PULSE_URL=http://localhost:8799 PORT=3018 node --env-file=.env.local server/index.mjs
DEV_API_PROXY=http://localhost:3018 npx vite --port 3055   # then open /trenches
```

## Deploy

Pulse runs as the Cloud Run service `pulse` (us-central1, runtime SA `three-ws@`), live since 2026-11-02. `three-ws-api` reaches it through `PULSE_URL`.

| Setting | Value | Why |
|---|---|---|
| Instances | min 1, max 1, CPU always allocated | The firehose is a long-lived WebSocket, and a second instance would double-write the archive |
| `DATABASE_URL` | secret `pulse-database-url`: a dedicated `pulse` database on the main Neon endpoint | Durable archive. Pulse's `tokens`/`wallets`/`trades` tables must never share `neondb` with the app schema |
| `SOLANA_RPC_URLS`, `SOLANA_WS_URLS` | secrets `pulse-solana-rpc-urls`, `pulse-solana-ws-urls`: public endpoints first, Helius last | HTTP calls fail over across the list (quota text, 429 and JSON-RPC errors included); the stream rotates on disconnect |
| `PUBLIC_URL` | `https://three.ws/trenches` | Links in the newsletter |

Redeploy after a change under `services/pulse` (production deploy, so owner-gated):

```bash
cd services/pulse
gcloud builds submit --project aerial-vehicle-466722-p5 --region us-central1 \
  --service-account=projects/aerial-vehicle-466722-p5/serviceAccounts/three-ws-build@aerial-vehicle-466722-p5.iam.gserviceaccount.com \
  --default-buckets-behavior=regional-user-owned-bucket \
  --tag us-central1-docker.pkg.dev/aerial-vehicle-466722-p5/cloud-run-source-deploy/pulse:latest .
gcloud run deploy pulse --project aerial-vehicle-466722-p5 --region us-central1 \
  --image us-central1-docker.pkg.dev/aerial-vehicle-466722-p5/cloud-run-source-deploy/pulse:latest
```

Health: `curl https://three.ws/api/trenches?view=health` (stream endpoint, trades in the last hour, last collection cycle). Known upstream limits: pump.fun's frontend API answers 403 (Cloudflare) to every non-browser client and Jupiter's lite API rate-limits shared IPs; the on-chain firehose, DexScreener, GeckoTerminal and the Robinhood Chain walker carry the page without them.

Tests: [tests/trenches-api.test.js](../tests/trenches-api.test.js), plus the service suite (`cd services/pulse && npm test`), which includes the regression test for the embedded database starting on a fresh clone.
