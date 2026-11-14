# plan-PROGRESS, archive 4 (2026-09-29 to 2026-11-10)

Older entries moved verbatim out of [plan-PROGRESS.md](plan-PROGRESS.md) on 2026-11-14 so every file stays under the 50,000-character limit. Read-only record: append new entries to [plan-PROGRESS.md](plan-PROGRESS.md), never here.

2026-11-04 | 971 | 181dd8f32, 400673414 | autopilot VM provisioned no-ship, dry-run tick verified; owner: push, github token secret, telegram chat id

2026-11-04 | 731 | 242be8471 | diorama microgames shipped and e2e-verified locally; owner: live compose-with-goal check on the deployed API, device touch check, deploy
- 972 | DONE-PENDING-OWNER | ca8d16f8f | reseal tooling, tests (26 pass), runbook; owner runs --apply and key swap
- 973 | DONE-PENDING-OWNER | beb1ab428 | buyback, launch-plan, e2e script, reconcile cron, runbook; devnet run waits on devnet SOL for G57Hd6u...

- 974 | DONE-PENDING-OWNER | see git log human-tasks | routes, pages, MCP tools, cron, docs, 41 tests; owner: apply migrations, deploy, fund devnet wallet and run scripts/qa-human-task-devnet.mjs

2026-11-06 | 735 | cb9c71287 | verified complete in the md audit (actions-hire tests pass, actions.json, route, sweep cron, share button, docs, changelog); archived to prompts/archive/

2026-11-06 | 749 | 015de971b | verified complete in the md audit (x:content check exits 0, check:announce passes, no new approvals, intel-globe paused); archived to prompts/archive/

2026-11-06 | 779 | 3eeee3faf | verified complete in the md audit (agent-name-claims tests pass, spec updated); archived to prompts/archive/

2026-11-10 | 251-plan-play-meetup3-event-day-runbook.md | 6583b63cf, f9458b1d7 | closed as moot: Meetup #3 ran 2026-11-06 on the deployed event build (prod 1d47bc51d, three-ws-api-00529-gdk), no next event is scheduled in public/event.json, and check:live-ops and check:event both pass in the no-event state.

2026-11-10 | 256-plan-play-meetup3-client-ux-audit.md | bfeed1d70, 1ff4c6cbf, e5cc6ba26, cf923968c | closed as moot: Meetup #3 ran 2026-11-06 with every fix from this audit deployed (prod 1d47bc51d), no next event is scheduled in public/event.json, and the reusable gate (npm run audit:event-client, 17 verdict tests pass) stays documented in docs/event-readiness/README.md for the next event; its GPU-host frame/heap run, keyboard-only and 200% zoom pass carry over to that event's order.

2026-11-10 | 252-plan-play-meetup3-net-economy-audit.md | 5944e12c5 (last code), this commit | closed: Meetup #3 ran 2026-11-06 and no next event is scheduled; the owner-side multiplayer deploy landed (three-ws-multiplayer-00013-qor, 2026-11-06) and play-economy-audit --qa now passes 27/27 against production; the optional paid boutique purchase stays owner-gated and was not run.

2026-11-10 | 258-plan-mcp-unified-endpoint-serve-and-publish.md | (see git log prompts/finish/258) | re-verified live: prod /mcp and /api/mcp/all serve the unified server (403 tools, 22 groups) matching tools.json and check:mcp-tools; owner: npm publish @three-ws/mcp and MCP registry plus plugin marketplace submission

2026-11-10 | 986-plan-microsoft-distribution-offers.md | (status commit) | kept open: prod deploy and SaaS migration verified live, 116 Microsoft tests and all packagers pass; remaining is owner-only from checklist step 4 (Entra registrations, MS_* env vars, Partner Center offers, preview purchase, store/Edge/connector submissions).

- 2026-11-10 984-plan-evm-agentpayments-create2-deploy-readiness.md re-verified (forge, plan table, SDK, vitest, Base and BSC fork proofs all green); still owner-gated on choosing the owner, funding the deployer and the per-chain broadcasts.

- 2026-11-10 974-plan-human-tasks-escrow-marketplace-routes-pages.md re-verified live (migrations applied, /tasks and /api/human-tasks serving in prod, 44 tests green); owner: fund devnet wallet via captcha faucets and run scripts/qa-human-task-devnet.mjs, one browser pass of the pages, mainnet escrow gate.

2026-11-10 | 976-plan-x402-paid-intel-sniper-arm.md | see commit | provisioning script fixed (wallet module now gets the prod DB and key and fails closed); arm provisioned disabled with wallet FsTbcQevoR5o5d4ynFwRjw5odd8UmPUsgzZifsQotN5D; owner must fund it (explicit yes), --enable, and deploy the sniper worker

2026-11-10 | 978-plan-drops-onchain-core-collection-mint.md | re-verify | Migration now applied and drop mint tests pass; devnet e2e still needs an owner-funded throwaway key (RPC faucet returns 410), mainnet owner-gated.

2026-11-10 | 980-plan-sniper-moonbag-manager-and-latency-telemetry.md | 6da99bc86 + this commit | Migration confirmed applied, read-only moon-bag dry-run script added and run over 25 live bags (all hold); only the owner-gated agent-sniper redeploy remains (running image is from 2026-09-29).

2026-11-10 | 982-plan-glasses-native-wearables-toolkit-lane.md (kept) | 5cc9201af, d7173f33f, 5d8945c58 | re-localization now tested on JPEG camera frame fixtures decoded through sharp and jsqr (25 JS tests); owner: Meta enrollment, Mac xcodebuild test and package link, vfov calibration, hardware demo that records real glasses frames, Android shell decision.

2026-11-10 | 971 | 48d082425, 79d40c2b1, 635deb515 + logWriter commit | fixed 203/EXEC that blocked every timer tick since 11-04, repaired VM in place, first timer tick ran; Claude blocked by Vertex billing 403; owner: billing, push, github token, telegram chat id

2026-11-10 | 975-plan-robinhood-crypto-connector-spend-capped.md (deleted, complete) | 1d73b580e, 1a1d5a71e, b92b3ba3b, 8c611095c, c663ea1ff, 254a74461 | connector, caps ledger, routes, MCP tools, settings page, docs shipped; 45 robinhood tests pass, live Robinhood rejection path verified; owner: paste own key at /settings/robinhood, then approve a live order table for the first real order.

2026-11-10 | 258-plan-mcp-unified-endpoint-serve-and-publish.md | 653de3cbc + this commit | order closed: unified /mcp live in prod (403 tools, 22 groups); still owner-only: cd packages/mcp && npm publish --access public, then submit server.json to the MCP registry and .claude-plugin/marketplace.json to the Claude plugin marketplace

- 2026-11-10 983-plan-vscode-3d-marketplace-publish-ready.md: re-verified cca451801 (78/78 tests, no-token release exits 0, file list matches); order retired, remaining owner step is VSCE_PAT/OVSX_PAT then npm run release in packages/vscode-3d.

2026-11-10 | 986-plan-microsoft-distribution-offers.md | 9de3370d5, this commit | deleted on owner instruction: every in-repo surface is built, validated and live in production; the remaining Entra, Partner Center, preview-purchase and store submission steps are owner-only and tracked in the docs/microsoft-marketplace-offer-plan.md owner checklist.

- 2026-11-10 984-plan-evm-agentpayments-create2-deploy-readiness.md closed (636fcf942 re-verified, 928a36aa3 shipped); agent-side work complete, the owner's per-chain broadcasts are tracked in contracts/DEPLOYMENTS.md.

2026-11-10 | 980-plan-sniper-moonbag-manager-and-latency-telemetry.md | 52757bdac, 6da99bc86, 6097d8569 | Closed: every Definition of done line verified; the agent-sniper redeploy (npm run deploy:sniper) remains an owner-gated ship step outside the order.

2026-11-10 | 976-plan-x402-paid-intel-sniper-arm.md | de856d6ec 341484bde 5d8945c58 + this commit | agent work complete, order deleted; owner-only steps remain: fund FsTbcQevoR5o5d4ynFwRjw5odd8UmPUsgzZifsQotN5D (SOL + USDC, explicit yes), node scripts/sniper-paid-intel-arm.mjs --enable, deploy the agent-sniper worker, changelog entry when it trades

2026-11-10 | 981-plan-nvidia-ngc-trellis-image-validation.md | cf5b484cd 3befd2ae9 fbe536e9d + this commit | agent work complete, order kept for the owner gates: A100 and L4 inference validated on sha256:f6634a81, 0 CRITICAL, image 31% smaller; H100 quota denied; owner signs the NGC partner agreement, submits intake, runs scripts/ngc-stage-trellis.sh --yes-push.

2026-11-10 | 726-plan-ops-alerts-email-push-channel.md | 34e039010, ddab2cfca + this commit | feature already shipped and re-verified; order kept: owner sets OPS_ALERT_EMAILS and deploys, then confirms alerts_push ok in healthz

2026-11-10 | 701-plan-agent-sandbox-code-execution-tools-runner.md | (this commit) | order kept: runner, tools and settings page were already shipped; added inline sandbox steps on the agent Runs tab and re-verified the runner and page; remaining is API-level and full-suite proof once node_modules has viem/@smithy, plus the owner-gated runner deploy

2026-11-10 | 705-plan-agent-evals-cli-replay-evaluate-tab.md | no new code | kept: evals shipped and re-verified (migration applied, 22+11 tests, CLI report schema); owner owes a signed-in browser pass of the Evaluate tab.

- 2026-11-10 974 second pass: pages browser-verified on prod in every state, escrow legs proven by the unmodified QA script on a local validator seeded with the devnet USDC mint; owner: captcha-gated devnet faucet funding for the literal devnet run, mainnet gate.

2026-11-10 | 971-plan-ops-autopilot-write-units-and-provision-vm.md (done, deleted) | 48d082425, 79d40c2b1, 635deb515, 0bd66333b + this commit | autopilot live in ship mode: push secret created, no-ship cleared and made reboot-proof, failed installs now retried; only the owner's GCP billing balance keeps Claude from starting (Vertex 403).

2026-11-10 | 715-plan-three-hold-activate-worlds-private.md | 8c99983e0 | Code shipped and migration applied; awaiting push and deploy (owner).

2026-11-10 | 781-plan-docs-ux-flows-atlas-route-coverage.md | 92c537829 + this commit | Drift check, tests and cluster 13 were already shipped; restored the lost audit:ux-flows npm script and closed the order.

2026-11-10 714-plan-security-csp-drop-unsafe-eval.md (kept open) | see commit | eval already scoped to /scene; local soak and header audit re-verified; owner deploy and live header check remain.

2026-11-10 709-plan-marketplace-bundle-buyer-storefront.md: storefront and checkout fix committed; order kept, real-bundle browser check and deploy remain (owner).

2026-11-10 713-plan-perf-forge-marketplace-thumbs-cls.md (kept open) f15a3ddb5, 5e224dac4 | thumbnails, hero budget and brand mark shipped in code; owner must push and deploy, then run the backfill cron and Lighthouse; first-visit /forge engine-pill CLS and marketplace weight pass remain.

2026-11-10 719-plan-mcp-account-status-dashboard-url-tools.md 61276fb39 bea97a622: account status, dashboard URL and X posting tools shipped; follow-up fixed the missing /me/status route and the settings panel envelope, verified live over MCP and in a browser.

2026-11-10 716-plan-forge-share-distribution-funnel-metrics.md 67ffcfa62 (verified live: migration applied, share_funnel_daily has real counts, report and readout print the share section). Share counters, beacon, from=share attribution and funnel surfaces shipped.

2026-11-10 738-plan-site-demo-defaults-tpose-and-account-hygiene.md (kept open) built and verified; owner decides whether non-demo surfaces still defaulting to cz.glb (the retarget reference rig) should move to the house default; push and deploy pending.

2026-11-10 707-plan-agora-fleet-render-animation-budget.md (kept open) | see commit | budget, tests and e2e already shipped and re-verified (spec passes, 40 of 200 full-rate); real-GPU fps and 390x844 console check remain.

2026-11-10 784-plan-ui-button-pill-migration-long-tail.md (partial): migrated br/fm/as/ad/bento button families to canonical .btn, audit:buttons --strict is green; states/tokens gates and screenshots remain.
