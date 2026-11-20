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

## 09 Grok eval and routing by evidence (2026-11-20)

Built: five 50-input task sets from production traffic (data/evals/llm-*.jsonl, provenance in data/evals/README.md), objective graders that run production's own post-checks (finishDirectorReply, cleanModelText + checkReply, parseSpec), a blind position-swapped pairwise judge, seeded bootstrap CIs, the resumable `npm run grok:eval-llm` harness (scripts/grok-eval-llm.mjs, results in data/evals/llm-results/), the generated report docs/evals/grok-4-7-on-three-ws.md (linked from docs/grok.md), per-task LLM_ROUTE_FORGE_DIRECTOR / LLM_ROUTE_X_REPLY / LLM_ROUTE_AGENT_SPEC in api/_lib/llm.js and LLM_ROUTE_AGENT_CHAT in api/chat.js (signed-in only), all off by default. Commits: fb7c60a90, 5244e4837, 5e0444420, 7ca96e42e, d9c4e0bba, 19e7be5ec, cb3a0bc47, 3fbe93419, 393ce3cf4.
Measured baseline (current lane = NVIDIA Nemotron 3 Ultra on NIM, the top production rung on every task; 50/50 answered per task, 95% bootstrap CI): forge director 48% (34 to 62; 23 rewrites exceed the 1,000-char guard, so production forwards the raw prompt), agent tools 100% (100 to 100), agent chat 96% (90 to 100), X replies 80% (68 to 90; 8 too long), agent spec 76% (64 to 88; 9 greetings over bounds). p95 latency: 11,971 / 2,286 / 5,400 / 3,531 / 10,058 ms. Live Grok probe: HTTP 401 "No credentials presented.".
Owner steps remaining: after order 927 installs GROK_API_KEY, run `npm run grok:eval-llm -- --prod-env --lanes grok,grok_budget`, set only the LLM_ROUTE_<TASK> flags the regenerated report recommends, approve `git push threews main`.

## 03 official Grok Bot marketplace (2026-11-20)

Built: section 0 and row 0 of docs/partners/grok-bot-listings.md with every field of the official form (x.ai/bot/marketplace/submit-a-plugin) in form order, Brief Description (566 chars) and Testing Instructions (577 chars) ready to paste; opaque 1:1 logos public/brand/three-ws-app-icon-1024.png and -512.png; scripts/grok-connector-review-check.mjs (OAuth discovery, DCR, PKCE authorize to the sign-in form, forged-code refusal, tools/list with 0 financial tools, catalog hit, a finished free model) with its test; four measured Grok Bot task templates and a Marketplace review section in docs/grok-bot.md, the same four as copyable cards on /grok (2x2, one column on phones). Commits: 6156ec071, 205ff62ed, 8d5a249b4, 4ce69c2a0, 048ba8874, e3e7d6cfe.
Measured (production): review check 10/10 PASS; sign-in to first generated model 195.8 s (forge_free 194.8 s over 9 check_job polls, catalog search 0.6 s, two-view look 14.9 s). Templates: scene kit 3.0 s, prop pack 194.0 s, photo to 3D 301.6 s, rigged mascot 455.4 s. Production runs 35440977b, which lacks the sign-up consent fix (4654a704e) and the 1:1 PNGs.
Owner steps remaining: approve `git push threews main` and `npm run deploy:gcp:full`, rerun `node scripts/grok-connector-review-check.mjs`, create the `three-ws` org handle, test the connector in Grok Bot, submit the form, record it in the listings doc Submission log.

## 12 co-marketing kit (2026-11-20)

Built: docs/partners/xai-comarketing-kit.md (who reshares what with verified public handles, two token-free startups-team emails with one ask each, a 581-word case study with no quote and an appendix tracing every number, one post draft per build for 871 to 877, 883 and 884 with tag rationale and evidence, asset commands, timing rules, UTM tracking), nine `draft` items in data/x-content/queue.json (order number in `note`, notBefore from 2026-11-24 one per day), a distinct-prompt count in scripts/grok-comarketing-numbers.mjs that never prints prompt text, links from section D of the plan and docs/partners.md.
Measured (production, 2026-10-08 to 2026-11-20, `node scripts/grok-comarketing-numbers.mjs`): 718 distinct prompts from callers turned into generation calls on /api/mcp-grok (734 distinct, 16 found in our own repo; 962 calls carried a caller's prompt). 5,547 tool calls, 2 errors, active 44 of 44 days; 1,243 generation calls; search_catalog p50 292 ms, p95 630 ms. Campaign landings and X signups: none yet (nothing posted).
Owner steps remaining: send email 1 from the kit, approve each queued draft (930 first, then the listings, then the builds), push and deploy so the build links resolve, attach head media per the asset checklist.
