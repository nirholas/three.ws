# grok-startups: progress log

Handoff log for the `grok-startups-` work orders (871 to 886). Context: [grok-startups-00-CONTEXT.md](grok-startups-00-CONTEXT.md). Plan: [docs/partners/xai-grok-startups-plan.md](../../../docs/partners/xai-grok-startups-plan.md). Append one dated entry per finished order at the end of this file; never edit an earlier entry.

## 2026-11-20: campaign filed

Fifteen independent orders filed the day three.ws was admitted to Grok for Startups. No xAI key exists yet (order 927). The official Grok Bot marketplace form (x.ai/bot/marketplace/submit-a-plugin) was missing from order 929's directory table; order 873 owns it.

## 08 xai credit usage ledger (2026-11-20)

Built: xai_usage table, xai-pricing, xai-usage recorder, xai-credit-health (healthz advisory), `npm run grok:usage` (--prod-env, --reconcile), docs/ops/xai-credits.md.
Measured: 5 runtime api.x.ai call sites instrumented (llm.js, llm-tool-chain.js, chat.js, widgets/[id]/[action].js, x-search.js). 7-day spend: 0 recorded (ledger has no production rows until the migration is applied and the code deployed).
Owner steps remaining: apply migration 20261120150000_xai_usage.sql to production, set the XAI_CREDIT_* env vars on Cloud Run, create an xAI management key for --reconcile, approve push and deploy.

## 08 xai credit usage ledger: re-verification (2026-11-20)

Applied 20261120150000_xai_usage.sql to production (with the two other pending additive migrations, 20261120203000_share_funnel_x_surfaces.sql and 20261120205747_mcp_probe_results.sql); `npm run db:status` shows it applied and `npm run grok:usage -- --prod-env` reads the live table.
Measured: 7 runtime api.x.ai call sites instrumented (the 5 above plus xai-image.js and xai-video.js from sibling orders, both already calling recordXaiUsage). 7-day production spend: $0.00 (recording code not yet deployed). scripts/xai-mcp-e2e.mjs is a manual smoke test with no DB and stays unrecorded; --reconcile drift covers it.
Owner steps remaining: set the XAI_CREDIT_* env vars on Cloud Run, create an xAI management key for --reconcile, approve push and deploy.

## 10 connector reliability probe (2026-11-20)

Built: api/_lib/mcp-probe.js (initialize, notifications/initialized, tools/list, one read-only tools/call, the ?auth=oauth 401 challenge and its protected-resource metadata, each timed, 10s per step), mcp_probe_results ledger (90-day retention), api/cron/mcp-probe.js every 5 minutes reading the deployed /.well-known/mcp.json, healthz subsystem `mcp_probe`, public GET /api/status/mcp (24h/7d/30d success rate, handshake and tool-call p50/p95, cached 60s) rendered on /status under "Connector uptime", `npm run grok:mcp-probe`, docs/ops/mcp-probe.md, a Reliability section in docs/grok-bot.md. Commits: b4c86c4d8, 65982e7a0, 50d7ae37c, c8e49cb19, 6bea11649, 7f900b409.
Measured (production, 20 runs from the dev machine, `npm run grok:mcp-probe -- --runs 20`): both servers 20/20 PASS. p95 initialize-to-tools/list: /api/mcp-grok 478 ms (p50 284), /api/mcp-studio 428 ms (p50 276). Production still answers notifications/initialized with 200 and a null body; b4c86c4d8 fixes it to 202 and goes live with the deploy (the local real server already answers 202, zero warnings).
Migration 20261120205747_mcp_probe_results.sql: applied in production (db:status).
Owner steps remaining: approve `git push threews main` and `npm run deploy:gcp:full` (its sync-crons step creates cron--api-cron-mcp-probe). Until then /api/status/mcp is 404 in production and healthz has no mcp_probe entry.
