# HQ

Real-time DeFi and crypto market intelligence dashboard, a [three.ws](https://three.ws) app: a 3D globe, 90+ live data panels, and AI-powered analysis in one command center. Runs as a web app, a PWA, and can be embedded in a host page via iframe. Source: <https://github.com/nirholas/three.ws> (`apps/hq`). Updates: [@trythreews](https://x.com/trythreews).

## What it does

- **$THREE panel**: live $THREE price, 24h change, market cap, liquidity, volume, signal headline and a sparkline, fetched every 3 minutes from the three.ws API (`/api/three-signal`). The mint is `FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump` ([Solscan](https://solscan.io/token/FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump)). Set `VITE_THREE_API_ORIGIN` to point at another API origin (default `https://three.ws`).
- **DeFi market data**: prices, DeFi yields, chain TVL, DEX volume and trending, funding rates, open interest, long/short ratios, liquidations, gas across 7 chains, BTC ETF flows, stablecoin health, token unlocks, protocol revenue, Bitcoin network health, sector rotation
- **Analytics**: protocol health scores, cross-chain fee comparison, cross-venue price divergence, DeFi opportunity scanner, market movers, morning AI briefing, wallet tracker, exploit alerts and ledger, MEV monitoring, governance tracking
- **Real-time**: Binance WebSocket price streaming, 30+ RSS news lanes with NLP topic extraction
- **3D globe**: 27+ deck.gl map layers (validator distribution, bridge flows, plus legacy geopolitical layers)
- **Resilient by design**: every API route has keyless fallback lanes (CoinPaprika, DeFiLlama, OKX) and optional Upstash Redis caching, so the dashboard degrades gracefully instead of breaking

## Run it

```bash
cd apps/hq
npm install
npm run dev        # Vite dev server on :5173
```

The dashboard works with zero configuration. Optional keys in `.env` unlock more lanes (see `.env.example`): `GROQ_API_KEY` (AI summaries), `FINNHUB_API_KEY` (stocks), `ACLED_API_KEY` (world events), `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (shared cache).

Production-style local run (static build plus API sidecar, the same server the container uses):

```bash
npm run build:full
PORT=8811 NODE_ENV=production node scripts/cloudrun-server.mjs   # http://localhost:8811
```

## Commands

```bash
npm run dev              # Dev server (full DeFi variant)
npm run dev:tech         # Dev server (tech/AI variant)
npm run typecheck        # tsc --noEmit
npm run build:full       # Production build
npm run test:e2e         # Playwright E2E tests
npm run test:sidecar     # API/sidecar unit tests
```

## Architecture

- Vite 6 + vanilla TypeScript, no framework. Components are TS classes that build DOM directly.
- `src/App.ts` orchestrates everything; `src/components/` holds the panels; `src/services/` fetches data.
- `api/` holds 95+ serverless-style routes (plain JS) that proxy and cache upstream sources, served in-process by `src-tauri/sidecar/local-api-server.mjs`.
- deck.gl 9 + MapLibre GL for the globe, d3 for charts.
- Two build variants: `full` (DeFi command center) and `tech` (AI/startups).

See [CLAUDE.md](CLAUDE.md) for the contributor guide and [ROADMAP.md](ROADMAP.md) for direction.

## Deployment (Google Cloud Run)

The `Dockerfile` builds the Vite bundle and serves it with `scripts/cloudrun-server.mjs`, which also hosts the API routes in-process on port 8080. `GET /api/health` reports service status and upstream reachability. Deploys are owner-gated; the full runbook is [docs/deploy-cloud-run.md](docs/deploy-cloud-run.md).

```bash
docker build -t hq .
docker run --rm -p 8080:8080 hq
```

## Acknowledgements

HQ began as a fork of [worldmonitor](https://github.com/koala73/worldmonitor) (MIT) and has since been rebuilt around DeFi and crypto intelligence.

## License

MIT
