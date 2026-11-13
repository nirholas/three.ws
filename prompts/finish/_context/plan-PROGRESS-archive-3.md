# plan-PROGRESS, archive 3 (2026-09-17 to 2026-11-04)

Older entries moved verbatim out of [plan-PROGRESS.md](plan-PROGRESS.md) on 2026-11-13 so every file stays under the 50,000-character limit. Read-only record: append new entries to [plan-PROGRESS.md](plan-PROGRESS.md), never here.

2026-11-04 260-plan-security-close-oct25-audit-and-sweep-gaps.md DONE: b028ef815 c1aa21db4 7a39eee75 47483da0b 151101978 + this commit. All 17 needs_validation records, 15 fingerprints and 7 surfaces are closed in docs/security/audit-2026-10-25/CLOSURE.md with commit and test (no row unknown); all 55 cited test files pass (studio-room with the real colyseus install, a2a-mandate-currency-pin 9/9), the marketplace publish-filter test fails 2/2 on the pre-fix handlers and passes after, the A2A Intent Mandate currency pin landed test-first, audit:guards and audit:mcp-safety are clean, and no contract was touched so forge test does not apply. Owner decision outstanding: the A2A platform-payer spend ceilings (25/50/500 USD) are a design choice, not a defect.

2026-11-04 776-plan-docs-architecture-known-gaps-truth-pass.md DONE: b75543e0a 62bcd56db + this commit. LiveKit and QStash credentials read through trimmed, per-request env.js getters (test-first), the master wallet endpoint issues no DDL now that its migration is applied in production, and ARCHITECTURE.md Known Gaps is re-measured against code and Cloud Run with an evidence path per row.

2026-11-04 788-plan-growth-kits-stale-claims-refresh.md DONE: this commit. Re-measured every claim in the Quicknode kit, field note and spotlight ask (Quicknode lane removed from production 2026-10-08, recovery probe live by 2026-09-17, dead /startup-program link, past proposal dates), corrected them in place with dated re-verification tables, and added scripts/check-kit-links.mjs with its extraction test.

2026-11-04 727-plan-play-chat-scrollback-community-bridge.md PARTIAL: eb20c70fb 71573c802 354e46272 + this commit. Capped per-world chat scrollback (200 lines, 3 days, 60-line tail in one join message, mid dedupe, privacy-trimmed) and a read-only community Board tab in the /play chat panel, verified in two browsers against a local multiplayer server with zero console errors. Remaining, owner: set CC_API_KEY on three-ws-api so the Board shows real posts, push, deploy:gcp:full and the multiplayer deploy.

2026-11-04 282-plan-wallet-token2022-checkout-rails-honest-config.md PARTIAL: 9a2902923 c567f8ee0 380e6d6ff 5b56da949 73839ad0b (with 19fae3449 7abcd1a2b e6e96d72a bfa7fbfdc and other sessions' fa2d32f0c 980066cfe c28282f06 3632ff266 9bfc680fd) + this commit. Every $THREE checkout builder, server and browser, plus the agent-payments SDK and skills and the governance buyback update, now build on Token-2022, proven by mainnet simulation (err: null for gasless purchase and Premium quote). Remaining, owner: THREE_TREASURY_WALLET and PAYMENT_RECIPIENT_SOLANA on three-ws-api, push, deploy:gcp:full.

2026-11-04 787-plan-stage-agent-speaking-queue.md DONE: 527a9253d. Per-stage speaking queue (user > broadcast > ambient, no interruption, dedupe, depth cap, timeout) with stage.speak/cancelSpeech/speaking/speechQueue and stage:speaking-change; agents register on runtime boot and say() returns the reply so say_to_agent works; two-agents demo verified in Chromium (floor mira 63476-64290ms, leo 64290-65425ms, no overlap).

2026-11-04 753-plan-embed-widget-studio-holder-gate-control.md DONE: 77e807b18 7c6a49cc4 68cc47c04 dab0b2228 (changelog in 5b56da949). Widget Studio Holders only panel: GET/DELETE on /api/embed/gate-create (owner-only, rate-limited), switch, live $THREE tier shortcuts, create/change/remove with confirm, snippet + preview, signed-out and demo-avatar empty states; verified end to end in Chromium against the production DB (201 create, reload shows active gate, locked preview for a signed-out visitor, 200 remove, 0 overflow at 400px). Remaining, owner: push and deploy:gcp:full so /studio shows the panel; confirm unlock with a wallet that holds the threshold (read-only balance check, no funds move).

2026-11-04 729-plan-a2a-agent-card-compliance-marketplace.md DONE: cd791e63b + this commit. The public Agent Card is generated whole and validated against the A2A 0.3 and 1.0 rules (url on /api/agents/a2a-paid, bearer securitySchemes with anonymous allowed, package version, optional a2a-x402 extension, no legacy authentication block), a separate Google Cloud Marketplace card builds from it with only the three 3D skills and no payment extension, validate:a2a-card runs both under npm test, and docs/a2a-agent.md plus the owner-run upload runbook docs/ops/google-marketplace-agent-card.md are published. Remaining, owner: the Cloud Storage upload, Producer Portal Save and validate, ScoreCard, and the Vertex billing hold.

2026-11-04 | 966-plan-token-rail-receiver-wallets-preflight.md | pending commit | guard, health signature and preflight shipped; owner must name receiver addresses and run the printed apply command

2026-11-04 | 976-plan-x402-paid-intel-sniper-arm.md | pending commit | paid-intel arm built and tested; owner must apply the migration, fund the arm wallet (explicit yes), enable it and deploy the sniper worker

2026-11-04 | 723-plan-play-concierge-greeter-tour.md | see git log (feat(play): concierge) | Welcome concierge NPC with one-time greeting, free-model chat, skippable 4-stop tour and event line.

2026-11-04 771-plan-forge-off-themed-event-boards-landing.md: shipped themed Forge-Off events (config, day windows, event endpoint, event crown cron, /forge-off page); migration unapplied.

2026-11-04 | 703-plan-mcp-tool-gateway-metered-routes-tools.md | 15e5852a9 | Six metered gateway tools (web_search, web_fetch, parse_document, tts, transcribe, image_generate) now have REST routes, MCP tools, a pricing section, docs and tests; browser and video are not built and were removed from the price list.

2026-11-04 | 759-plan-memory-temporal-facts-benchmark-scores.md | (this commit) | Agent memory has temporal validity, provenance, supersession and as-of recall (server, Memory Studio, SDK 0.2.0, tools) with a LoCoMo/LongMemEval harness; migration unapplied and bench scores pending an unthrottled LLM chain (order kept).

2026-11-04 | 758-plan-payments-retention-kill-switch-and-alerting.md | (this commit) | Runtime payouts_paused kill switch (admin endpoint with audit rows) halts the withdrawal, coin, club and growth payout crons, plus an hourly payout anomaly alert; documented in financial-controls.

2026-11-04 | 704-plan-play-plaza-live-show-mount-and-client.md | (this commit) | The plaza stage is mounted in every coin world and PlazaStageShow exists (proximity join and leave, spatial voice, captions, seats, chat-bar questions, confirm-gated $THREE tips); order kept because the two-browser live-show and live-tip verification is still owed.

2026-11-04 | 760-plan-agent-ag-ui-event-stream.md | (this commit) | POST /api/agent/run?protocol=ag-ui streams AG-UI 1.0 events (run, text, tool call, embodiment CUSTOM cues) from the same agent loop; default stream unchanged; verified live with curl -N.

2026-11-04 | 786-plan-drive-android-automotive-build-flavor.md | see git log | automotive flavor in the Android overlay compiles (assembleAutomotiveDebug and phone assembleDebug both succeed); on-device run unverified.

2026-11-04 | 724-plan-play-multiplayer-redis-scale-out.md | see git log (multiplayer scale-out) | Redis presence fan-out, health presence/instance, fail-fast boot, secret-bound deploy, tests and load test; Memorystore provisioning and live numbers pending owner.

2026-11-04 | 773-plan-identity-web-bot-auth-signed-requests.md | see git log | Web Bot Auth signing, key directory route, gateway and screen-pool hooks shipped; owner provisions WEB_BOT_AUTH_PRIVATE_KEY and deploys.

2026-11-04 | 747-plan-memory-file-layer-semantic-recall.md | 70423f326 | Memory file layer recall is semantic via POST /api/memory/rank with a substring fallback.

2026-11-04 | 740-plan-platform-opentelemetry-gcp-traces.md | 112812796 | Tracing shipped and verified in Cloud Trace; worker redeploy and real Forge-path trace pending owner deploy.

2026-11-04 | 739-plan-glasses-meta-display-lens-web-app.md | dad3b0b4d | /glass lens app shipped; hardware verification, portrait, push lane pending.

2026-11-04 | 978-plan-drops-onchain-core-collection-mint.md | 11c47fa75 | Drop mint code, routes, UI, docs shipped; migration unapplied, devnet e2e awaits a funded key, mainnet owner-gated.

2026-11-04 | 977-plan-avatar-longcat-gpu-host-bringup.md | see git log | LongCat GPU host scripts, quota requests, staging job, wake path shipped; quota grant, weights checksum and deploy pending.

2026-11-04 | 979-plan-mobile-seeker-v1-1-widget-release-prep.md | see git log | 1.1.0 APK built and verified, docs corrected, release runbook written; portal publish and device checks pending owner.

2026-11-04 | 705-plan-agent-evals-cli-replay-evaluate-tab.md | 7d1879425 | Evals API, replay, trajectory export, CLI and Evaluate tab shipped; migration unapplied, live browser pass pending.

2026-11-04 | 736-plan-avatar-unseen-head-texture-synthesis.md | f10302b3d | Gated synthesised-view texture built, flag off; billing hold blocks real Vertex fixture, calibration and held-out numbers.

2026-11-04 | 725-plan-workers-python-osv-residual-bumps.md | see git log (worker pins) | accelerate 1.15.0 on partcrafter, rembg 2.0.69 across the Python 3.10 workers, scan 194 to 184 advisories, residue documented.

2026-11-04 | 980-plan-sniper-moonbag-manager-and-latency-telemetry.md | see git log | Moon-bag manager, price ticks, stage latency stamps and report shipped; migration unapplied, worker redeploy pending owner.

2026-11-04 | 728-plan-three-hold-activate-early-drops-and-name-dibs.md | see git log (drops early window) | drops.early and names.first_dibs enforced with tests, countdown UI and docs; migration unapplied and browser check pending owner.

2026-11-04 | 706-plan-bounties-build-program-routes-and-pages.md | b88d7c228 | Feed and Build APIs, crons, /build and /build/leaderboard, MCP tools shipped; scheduler sync on next deploy, first program round row still to insert.

2026-11-04 | 737-plan-hq-agent-defi-tools-and-context-bridge.md | 678adff27 | Bridge, agent-tools, risk, compound alerts, Autopilot hand-off and hq-mcp shipped; HQ deploy and browser check pending.
- 983 vscode-3d publish-ready: release script + tests done 2026-11-04; owner sets VSCE_PAT/OVSX_PAT and runs npm run release.

2026-11-04 | 700-plan-x402-self-hostable-solana-facilitator.md | 1d3496b3c, 353058202 | Facilitator extracted into @three-ws/x402-server/facilitator with attack suite, CLI, guards tests and metrics; npm publish, upstream issue, deploy and devnet settle remain with the owner.

2026-11-04 | 970-plan-lending-agent-earn-venue-routes-ui.md | 50e2ae4bc (rpc chunking only) | Lending service, v1 routes, lend_* MCP tools, Lend tab, docs built and simulated on mainnet; held uncommitted by the commit gate (names Kamino); owner approves commit and runs the first real deposit.

2026-11-04 | 762-plan-growth-zed-raycast-gradio-poe-listing-packages.md | see git log | Zed, Raycast, Gradio Space, Poe and n8n packages built and verified with live Forge GLBs; owner creates the Raycast account/author and submits listings (order 938).
- 984 EVM AgentPayments CREATE2 readiness done 2026-11-04 (fork-proven, Basescan verified); owner broadcasts per chain after choosing the owner and funding the deployer.

2026-11-04 | 730-plan-avatar-dense-identity-fit-rtx.md (kept) | see git log | Dense photometric head fit, RTX image and routing built and shipped disabled; owner runs the GPU image build, staging healthz and 40-face eval.

- 982 (2026-11-04): glasses wearables lane code and docs landed; Mac build, Meta enrollment and hardware demo remain with the owner.
- 981 (2026-11-04): image hardening committed; scan/A100 validation pending the c4fb8f6d build; NGC push is owner-held.
- 977 (2026-11-04): weights build a7a81ea6 failed on an incomplete HF download; rerun scripts for longcat weights, then commit weights.sha256.
