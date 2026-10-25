# Run order: which work order to paste next

Everything open lives in [finish/](finish/) as 82 work orders, and since 2026-09-07 the
filenames carry the ranking: sort the folder by name and you are reading it in priority order,
so you can open one, run it, and open the next without consulting anything. Every file in
`finish/` is runnable; the context and log files that must never be run were moved out to
[finish/_context/](finish/_context/).

| Band | What it is | Count |
|---|---|---|
| `023` to `039` | The `x-grok-` campaign. Runnable, no gate. | 3 |
| `067` to `095` | The `best3d-` and `partners-` campaigns. Runnable, no gate. | 14 |
| `401` to `434` | Written by the evolve scout lane ([docs/ops/evolve.md](../docs/ops/evolve.md)), each from a dated measurement. Runnable, no gate. | 5 |
| `506` to `549` | The `integrate-` campaign: bringing the owner's other GitHub repositories into three.ws. Runnable; gated steps are named per order. | 13 |
| `605` to `627` | The `beat-` campaign: closing gaps found in the open-source crypto and agent landscape survey. Runnable; on-chain steps are devnet or simulation only. | 12 |
| `902` and up | Blocked: the last step is an owner action or an outside party. Read before running. | 35 |

The number is a position, not an identity. When an order retires its file is deleted and a gap
is left rather than renumbering the folder, so a link to a numbered order keeps meaning the same
thing. This file explains WHY that order is where it is; the tiers below are the reasoning
behind the numbers.

**Measured 2026-10-25**, not copied from any pack's status text:

| Probe | Result |
|---|---|
| `curl -s https://three.ws/api/version` | `660b5ad97` on revision `three-ws-api-00504-xnh` (built 2026-10-24 05:10 UTC) |
| `git rev-parse --short main` | `b51a3f102` |
| commits on `main`, not yet in production | **74** (`git log --oneline 660b5ad97..main \| wc -l`) |
| `curl -s https://three.ws/api/healthz` | `subsystems.status: down` (8 ok, 3 degraded, 4 down, 2 unknown) |
| down | `x402_settle` **0.0%** (0 of 128 paid attempts, 3h; 128 `http_402` rail faults, 22 settles refused at the fee-wallet floor); `object_storage` (R2 bucket unreachable: "Please enable R2 through the Cloudflare Dashboard"); `agent_index` (56m median Solana lag across 1,971 agents, 216 erroring; EVM Base cursor 66h40m stale with a 120,131-block backlog); `three_token_rail` (`THREE_TREASURY_WALLET`/`THREE_REWARDS_WALLET` unset, every $THREE-priced purchase fails closed) |
| degraded | `rate_limiter` (Redis circuit open, serving from Postgres), `rpc_lanes` (both paid Solana lanes exhausted, 0 free lanes left), `sniper` (6 of 11 wallets tradeable, needs 0.2827 SOL, funding master holds 0.0250 SOL) |
| changed since the last map (2026-09-06) | Production itself caught up: `three-ws-api` is now 0 commits behind `threews/main` (was 17 behind on 2026-09-06), confirmed 2026-10-24 by the triage-lane deep sweep. But the queue under it turned over almost completely: the route-audit swarm (149 orders), the Home campaign (14 orders), and the `fix-queue-`, `gcp-credits-`, `quality-bar-`, `openai-pr-`, `store-submissions-`, `materialize-` and `event-` campaigns all now carry zero files in `finish/`. Six new campaigns were filed since then (`integrate-`, `beat-`, `best3d-`, `partners-`, `x-grok-`, `parity-`) plus the evolve scout lane's `auto-` orders and six standalone owner-gated closeouts. Two new live defects surfaced that did not exist on 2026-09-06: `three_token_rail` down (OWNER-ACTIONS row 23, the $THREE receiver wallets were never set) and `remesh-service` running a 2026-07-16 revision that predates a crash fix already on `main` (row 69). |

Re-run those four commands before trusting this file. Ranking rule used throughout: a live
production defect outranks an unshipped fix, an unshipped fix outranks a new feature, and
anything that unblocks many other orders outranks anything that unblocks one.

The tier is the priority. Inside a tier, the order of the rows is the order to run them.

---

## P0. Owner actions (collect, do not run as agent sessions)

`finish/_context/production-100-OWNER-ACTIONS.md` carries roughly 35 open rows; nothing here
multiplies the other tiers because none of it is unblocked by writing code. Row 1 (ship
production) cleared 2026-10-24: `three-ws-api` is fully current. The rows below are the ones
today's `healthz` directly corroborates as live, so they are worth batching into one owner
message before starting P1.

| Row | Why now (measured) | Who clears it |
|---|---|---|
| OWNER-ACTIONS row 2 | Fund the x402 settle sponsor wallet `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW`. `x402_settle` reads down at **0.0%** (0 of 128 paid attempts in 3 hours), 22 settles refused at the fee-wallet floor. Needs about 1 SOL. | Owner (~1 SOL) |
| OWNER-ACTIONS row 23 | Name `THREE_TREASURY_WALLET` and `THREE_REWARDS_WALLET` on the `three-ws-api` Cloud Run service. `three_token_rail` reads down; every $THREE-priced purchase (Forge paid tiers, spins, scarcity mints, marketplace sales, copy-trading fees) fails closed. Setting the two vars moves no funds by itself. | Owner (two addresses, one `gcloud run services update --update-env-vars`) |
| OWNER-ACTIONS row 36 | Check Cloudflare's own R2 dashboard for the bucket behind `S3_BUCKET`. `object_storage` reads down: "Please enable R2 through the Cloudflare Dashboard," reproduced live with production's own credentials, 135ms latency so the bucket itself answers fine. Flapping since 2026-09-08. | Owner (Cloudflare dashboard) |
| OWNER-ACTIONS row 24 | Top up the paid Solana RPC plans (Helius and the second paid lane). `rpc_lanes` reads degraded with both paid lanes exhausted and 0 free lanes left; this is the root cause feeding `agent_index` down (56m median lag, 216 of 1,971 agents erroring). | Owner (billing) |
| OWNER-ACTIONS row 19 | Refill the sniper fleet's trading capital (0.2827 SOL; the funding master holds only 0.0250 SOL and cannot self-refill) and decide when to arm `SNIPER_RISK_OFFICER=enforce` once shadow evidence justifies it. 6 of 11 armed wallets can still trade. | Owner (~0.28 SOL, then a later decision) |
| OWNER-ACTIONS row 69 | Redeploy `remesh-service` (`gcloud builds submit --config workers/remesh/cloudbuild.yaml .`). It is running a 2026-07-16 revision, five weeks older than the crash fix (`59d9aa9cd`) already on `main`, and is segfaulting in production as a result. No code change needed, just a rebuild. | Owner (one `gcloud builds submit`) |

Everything else in `production-100-OWNER-ACTIONS.md` (credential rotations, stranded-fund
decisions, GitHub org creation, Apple/Play signing, marketplace-listing OTPs, and more) is real
but not corroborated by today's `healthz`; read the file directly before batching the owner
message, since a row can clear itself between sweeps.

## P1. Runnable now, no gate

Grouped by campaign; inside a campaign, file order is run order unless the campaign's own
context file says otherwise.

| Order | Why now |
|---|---|
| [401](finish/401-auto-restore-green-vitest.md) | `npm run test:core` has 52 failing files and 108 failing tests on `evolve`. Every other order's "tests pass" line is unverifiable until this is green. |
| [433](finish/433-auto-fix-account-link-codes-schema-collision.md) | A table-name collision in `account_link_codes` is breaking every phone/desktop/CLI/Telegram account-link call in production right now. |
| [403](finish/403-auto-drain-docs-freshness.md) | 127 docs describe code that has since moved; the remainder of order 402's partial drain. |
| [434](finish/434-auto-fix-stale-structure-status-claims.md) | STRUCTURE.md still claims some shipped surfaces as "not yet applied / not yet deployed." Cheap, mechanical, no owner action. |
| [023](finish/023-x-grok-01-connector-compat-probe.md), [024](finish/024-x-grok-02-cloud-agent-rate-limits.md), [039](finish/039-x-grok-17-xai-remote-mcp-e2e.md) | The `x-grok-` campaign's runnable orders: the connector compatibility probe, cloud-agent rate limits, and the xAI MCP end-to-end proof. Shared facts: [finish/_context/x-grok-00-CONTEXT.md](finish/_context/x-grok-00-CONTEXT.md). |
| [067](finish/067-best3d-01-trellis2-default-lane.md) through [081](finish/081-best3d-15-splat-parity.md) | The `best3d-` campaign's six runnable orders (067, 068, 069, 070, 074, 081): TRELLIS.2 default lane, Pixal3D multi-view, non-humanoid rigging, editable parts, the WebGPU TSL path, splat parity. Run 067 first, 068 and 069 after it, 070 before any later part work. Shared facts: [finish/_context/best3d-00-CONTEXT.md](finish/_context/best3d-00-CONTEXT.md). |
| [085](finish/085-partners-02-animation-library-license.md) through [095](finish/095-partners-12-home-assistant-hacs.md) | The `partners-` campaign's eight runnable orders (085, 087, 088, 091 to 095): the Mixamo-clip animation library license, LiveKit and Pipecat avatar plugins, a Discord Activity, a Shopify product-media app, VRoid Hub import, agent-framework tool packages, site-builder embeds, the HACS package. Shared facts: [finish/_context/partners-00-CONTEXT.md](finish/_context/partners-00-CONTEXT.md). |
| [506](finish/506-integrate-07-pump-claims-listener.md) through [549](finish/549-integrate-50-hookforge-catalog.md) | The `integrate-` campaign's 13 runnable orders (506, 510, 512, 525, 530, 534, 536, 539, 540, 544, 545, 548, 549): pump.fun claims listener, per-coin earnings source, native-lane anti-snipe fee, skill import from Anchor IDL, MCP registry cleanup, news reader lanes, $THREE-post impact, coin intel signals, memo/inscription reader, chains turnover, 3D funder graph, Robinhood Chain launch venues, hookforge catalog. Shared facts: [finish/_context/integrate-00-CONTEXT.md](finish/_context/integrate-00-CONTEXT.md). |
| [605](finish/605-beat-05-onchain-allowance-budgets.md) through [627](finish/627-beat-27-launch-fee-and-holder-reward-features.md) | The `beat-` campaign's 12 runnable orders (605, 606, 610, 614, 615, 616, 619, 621, 622, 623, 626, 627): on-chain allowance budgets, a burner wallet with owner confirmation, hire-escrow evaluator and disputes, orders engine with ratcheting exits, perps venues, Solana prediction markets in shadow mode, token due diligence and funding graph, agent CLI automation and HTML reports, Solana agent registry registration, skill supply-chain scanner, metered OpenAI-compatible router, launch-fee/holder-reward features. On-chain steps are devnet or simulation only. Shared facts: [finish/_context/beat-00-CONTEXT.md](finish/_context/beat-00-CONTEXT.md). |

## P2. Owner-gated distribution, listings and closeouts (batch the human touchpoints)

Every row here stalls on an owner action, so run them as a batch and collect the asks in one
message rather than one per session. Some reference third-party projects and carry the CLAUDE.md
commit gate; that content stays uncommitted (a named stash) until the owner approves it.

| Order(s) | Owner gate |
|---|---|
| [902-backlog-01-x402-settle-runway.md](finish/902-backlog-01-x402-settle-runway.md) | Code half done; the sponsor-wallet funding is P0 row 2 above. |
| [907-backlog-08-okx-chat-bot-always-on.md](finish/907-backlog-08-okx-chat-bot-always-on.md) | Getting the bot off this codespace onto a durable host; owner decides the host. |
| [911](finish/911-okx-ai-08-forge-relisting.md), [913](finish/913-okx-ai-04-e2e-real-payment-test.md), [914](finish/914-okx-ai-07-final-audit-and-watch.md) | OKX.AI listing pack: relisting, the real-payment gauntlet (real spend, a CLAUDE.md stop-and-ask gate by definition), then the final audit. Run 913 before 914; 911 is independent. Runbook: [finish/_context/okx-ai-RUNBOOK.md](finish/_context/okx-ai-RUNBOOK.md). |
| [917](finish/917-roadmap-pumpfun-trading.md), [918](finish/918-roadmap-pumpfun-trading-arena.md) | Pump.fun trading and the trading arena; the sniper's `enforce` arming and capital refill are P0 row 19. |
| [919](finish/919-parity-09-ship-and-publish.md) through [925](finish/925-parity-15-mention-to-launch.md) | Shipping and publishing, a community skill registry, directory listings, a "why three.ws" page, a builder competition, pricing levers, a mention-to-launch flow. Each needs a listing account, npm publish approval, or an X mention-bot go-live. Shared facts: [finish/_context/parity-00-CONTEXT.md](finish/_context/parity-00-CONTEXT.md). |
| [926](finish/926-x-grok-45-owner-x-api-tier.md) through [931](finish/931-x-grok-50-player-card-approval.md) | The owner's X API tier, the owner's Grok API key, going live with the mention bot, connector directory listings, the launch announcement, player-card approval. Shared facts: [finish/_context/x-grok-00-CONTEXT.md](finish/_context/x-grok-00-CONTEXT.md). |
| [932](finish/932-best3d-05-pricing-preview-pay-to-keep.md) through [935](finish/935-best3d-08-engine-store-publishing.md) | Pricing preview and pay-to-keep, SAM 3D Objects, the orphaned-avatar campaign, engine store publishing. Shared facts: [finish/_context/best3d-00-CONTEXT.md](finish/_context/best3d-00-CONTEXT.md). |
| [936](finish/936-partners-13-tripo-reply-and-house-key.md) through [940](finish/940-partners-17-sketchfab-retag.md) | The Tripo reply and house key, sponsorships, third-party submissions, program applications, a Sketchfab re-tag. Shared facts: [finish/_context/partners-00-CONTEXT.md](finish/_context/partners-00-CONTEXT.md). |
| [954-oauth-connector-google.md](finish/954-oauth-connector-google.md) | Create a Google Cloud OAuth client and store its secret. Code and tests already ship. |
| [957-uniswap-lane-and-launch-status.md](finish/957-uniswap-lane-and-launch-status.md) | Owner deploys the launcher contract on Base, then runs the first real launch through the confirmation table. An irreversible on-chain action. |
| [958-creator-fee-payouts.md](finish/958-creator-fee-payouts.md) | Deploy, a real-browser check, then flip `CREATOR_PAYOUTS_LIVE=true` only after reviewing the first recorded distributions. A real spend path. |
| [961-desktop-agent-runtime.md](finish/961-desktop-agent-runtime.md) | Apple Developer ID certificate and a Windows code-signing certificate to produce signed installers. |
| [962-approvals-inbox-telegram.md](finish/962-approvals-inbox-telegram.md) | A throwaway Telegram bot token from @BotFather to exercise the approve/deny flow live. |
| [965-revenue-ledger-reinvest.md](finish/965-revenue-ledger-reinvest.md) | A real-browser check, a deploy, then the first live reinvest rule confirmed in the browser (a CLAUDE.md spend gate). |

---

## Not tasks

- [masters/](masters/): nine reusable master prompts. They take a supplied TARGET and never retire.
- [finish/_context/](finish/_context/): the campaign indexes, briefs, runbooks and progress
  logs (`-00-INDEX.md`, `-00-CONTEXT.md`, `-README.md`, `-PROGRESS.md`, `-RUNBOOK.md`,
  `quality-bar-_shared.md`, `roadmap-REUSE-MAP.md`, `production-100-OWNER-ACTIONS.md`). They are
  unnumbered and live outside the queue precisely so they are never opened as the next task.
  Read the one your order names; never run one.
- [finish/_context/production-100-00-INDEX.md](finish/_context/production-100-00-INDEX.md) is the campaign map this
  file ranks. It carries the per-order evidence; this file carries the sequence.

## Keeping this file true

It is a ranking of measurements, so it rots the moment the measurements change. Re-run the four
probes at the top before using it, and rewrite the tiers when a P0 row clears. A finished order is
deleted in its own closing commit, so its row here goes with it.
