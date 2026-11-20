# grok-startups: progress log

Handoff log for the `grok-startups-` work orders (871 to 886). Context: [grok-startups-00-CONTEXT.md](grok-startups-00-CONTEXT.md). Plan: [docs/partners/xai-grok-startups-plan.md](../../../docs/partners/xai-grok-startups-plan.md). Append one dated entry per finished order at the end of this file; never edit an earlier entry.

## 2026-11-20: campaign filed

Fifteen independent orders filed the day three.ws was admitted to Grok for Startups. No xAI key exists yet (order 927). The official Grok Bot marketplace form (x.ai/bot/marketplace/submit-a-plugin) was missing from order 929's directory table; order 873 owns it.

## 08 xai credit usage ledger (2026-11-20)

Built: xai_usage table, xai-pricing, xai-usage recorder, xai-credit-health (healthz advisory), `npm run grok:usage` (--prod-env, --reconcile), docs/ops/xai-credits.md.
Measured: 5 runtime api.x.ai call sites instrumented (llm.js, llm-tool-chain.js, chat.js, widgets/[id]/[action].js, x-search.js). 7-day spend: 0 recorded (ledger has no production rows until the migration is applied and the code deployed).
Owner steps remaining: apply migration 20261120150000_xai_usage.sql to production, set the XAI_CREDIT_* env vars on Cloud Run, create an xAI management key for --reconcile, approve push and deploy.
