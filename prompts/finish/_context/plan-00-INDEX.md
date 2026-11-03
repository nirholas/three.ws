# plan- campaign: the planning corpus, turned into work orders

On 2026-11-03 every tracked markdown file in this repository (2969 of them) was swept. Twenty reviewers read the plans, roadmaps, research, audits, specs, old prompt packs, campaign logs and READMEs, checked each against the code, and turned every piece of outstanding work into a self-contained work order. 149 orders came out of it. The per-file record of what happened to each doc is [plan-COVERAGE.md](plan-COVERAGE.md).

## How to use them

- **Each order is one paste.** Open any `prompts/finish/NNN-plan-*.md`, copy the whole file into a fresh Claude Code chat in this repo, and send it. It carries its own operating rules, its Step 0 measurements, tasks, definition of done, blocker answers, close-out protocol, and a verbatim copy of the docs it came from. It needs nothing else.
- **None depends on another.** Run one at a time, or paste hundreds into parallel chats. Every order stages explicit paths, re-reads files before editing, and uses its own dev-server port, so concurrent sessions in one worktree do not trample each other.
- **The number is the priority.** Lower runs first. P0 and P1 orders take never-used numbers in `249` to `399`, so they sort ahead of most of the older queue; P2 and P3 take `700` to `899`; gated orders take `966` and up. Inside a tier, higher impact comes first.
- **A finished order deletes itself** in its closing commit and logs one line to [plan-PROGRESS.md](plan-PROGRESS.md). An order whose last step is the owner's stays, with a dated status paragraph saying exactly what remains.

| Tier | Orders | Numbers |
|---|---:|---|
| P0. Live defects, security, broken money rails | 9 | `249` to `257` |
| P1. Unshipped fixes and half-built user-visible features | 29 | `258` to `286` |
| P2. New capabilities with clear value | 57 | `700` to `756` |
| P3. Polish, developer experience, exploratory | 34 | `757` to `790` |
| Gated. The last step needs an owner action or an outside party | 20 | `966` to `985` |

## P0. Live defects, security, broken money rails

| # | Order | Area | Score |
|---|---|---|---:|
| 249 | [Production database is past its storage mark again, so archive the big history tables to cold storage, prune them, and alarm before the cap](../249-plan-ops-db-storage-cap-archive-and-reclaim.md) | ops | 94 |
| 250 | [Withdrawal payouts become idempotent so a failed-after-broadcast send can never be paid twice](../250-plan-payments-withdrawal-send-idempotency.md) | payments | 92 |
| 251 | [Production health sweep, platform smoke battery and a refreshed live-ops sheet for the 2026-11-06 meetup](../251-plan-play-meetup3-event-day-runbook.md) | play | 90 |
| 252 | [Audit and fix /play multiplayer resilience and every economy loop (price truth, payouts, double-spend) before the 2026-11-06 meetup](../252-plan-play-meetup3-net-economy-audit.md) | play | 88 |
| 253 | [Forge-in-world props get a hard triangle and file-size ceiling, server-side abuse limits and a placement-first hologram](../253-plan-play-forge-props-hologram-size-limits.md) | play | 87 |
| 254 | [The operator can extend, rename or end the live event through an authed override without a redeploy](../254-plan-play-event-config-live-override.md) | play | 86 |
| 255 | [The $THREE balance gate fails closed when the RPC is down instead of waving everyone through](../255-plan-three-gate-fail-closed-on-rpc-failure.md) | three-token | 85 |
| 256 | [Audit and fix the /play client for the 2026-11-06 meetup across first impression, mobile, performance, auth failures and accessibility](../256-plan-play-meetup3-client-ux-audit.md) | play | 84 |
| 257 | [x402 payment audit ledger becomes durable, unique per transaction, and dead-lettered](../257-plan-payments-x402-audit-ledger-durability.md) | payments | 80 |

## P1. Unshipped fixes and half-built user-visible features

| # | Order | Area | Score |
|---|---|---|---:|
| 258 | [Serve the unified MCP endpoint at /mcp and /api/mcp/all and make it the default install target](../258-plan-mcp-unified-endpoint-serve-and-publish.md) | mcp | 88 |
| 259 | [Expose self-custody signing, session keys, key export and balance history as routes, tools and wallet UI](../259-plan-wallet-self-custody-routes-export-history.md) | wallet | 84 |
| 260 | [Close the 2026-10-25 security audit (32 unvalidated findings) and sweep the seven surfaces it never reached](../260-plan-security-close-oct25-audit-and-sweep-gaps.md) | security | 82 |
| 261 | [Give the learning loop its owner surface: /settings/memory, memory and user-model routes, learned-skill review](../261-plan-agent-memory-settings-page-and-api.md) | agent | 78 |
| 262 | [Restore the 85-language picker by closing the missing keys, draining the lint backlog and republishing the locale manifest](../262-plan-i18n-restore-language-picker-manifest.md) | i18n | 78 |
| 263 | [Redeploy the stale GPU worker images that carry already-shipped fixes, and add a drift check so a worker fix cannot sit unbuilt again](../263-plan-ops-gpu-worker-images-redeploy-and-drift-check.md) | ops | 78 |
| 264 | [Deleted accounts are permanently purged after 30 days, as the privacy policy promises](../264-plan-auth-purge-deleted-accounts-after-30-days.md) | auth | 74 |
| 265 | [Proof of custody anchors on Solana again: 522 epochs, zero anchored, public integrity page down](../265-plan-custody-proof-anchor-restore.md) | custody | 74 |
| 266 | [Let an agent connect third-party MCP servers: connection routes, OAuth, runtime mounting and a catalog page](../266-plan-mcp-external-integrations-agent-connections.md) | mcp | 74 |
| 267 | [Re-measure the x402 autonomous loop's failure classes against current code and fix every one still above 1 percent](../267-plan-x402-loop-failure-classes-remeasure-fix.md) | x402 | 74 |
| 268 | [Cut Solana RPC call volume with per-route accounting, request coalescing and a short fresh-read cache](../268-plan-solana-rpc-call-volume-budget-and-read-cache.md) | solana | 72 |
| 269 | [Agent screen caster refuses private-network targets at the request level, not just the typed hostname](../269-plan-agent-screen-pool-egress-guard.md) | agent-screen | 70 |
| 270 | [Chat gateway worker passes a build-verify and a live Telegram round trip, ready to ship in one command](../270-plan-gateway-chat-worker-ship-readiness.md) | gateway | 68 |
| 271 | [Retire the deleted world.three.ws surface with a reversible "retired" health state so healthz, alerts, links and docs match reality](../271-plan-ops-world-health-retired-state.md) | ops | 68 |
| 272 | [Ship the three-ws-agent command, terminal UI, slash commands, subagents, local cron and gateway on top of the finished agent-cli runtime core](../272-plan-agent-cli-tui-slash-commands-and-entrypoints.md) | agent-cli | 66 |
| 273 | [Forge image lanes drop the non-commercial RMBG-1.4 matte and move off the retired Gemini image model](../273-plan-forge-image-lane-licence-and-model-currency.md) | forge | 66 |
| 274 | [Platform fee events table records every fee taken, reconcilable against revenue and chain](../274-plan-payments-platform-fee-events-ledger.md) | payments | 66 |
| 275 | [Re-run the full console sweep on a quiet box, fix every real error, and gate the result with a baseline](../275-plan-site-console-resweep-and-fix.md) | site | 66 |
| 276 | [Fix the agent launch funnel by auto-drafting a coin plan and instrumenting each step](../276-plan-launch-funnel-default-coin-path.md) | launch | 64 |
| 277 | [Fix the functional defects filming found on concierge, agent-identities, embed-doctor, tty, herald, stream, validation and labs](../277-plan-site-announced-surfaces-defect-sweep.md) | site | 64 |
| 278 | [Make every @three-ws/agents SDK method hit a real mounted /api/v1 route, add the missing test suite, and leave the package one command from npm](../278-plan-agents-sdk-route-parity-and-release-readiness.md) | agents-sdk | 58 |
| 279 | [Bring the Granite Guardian lane live on Cloud Run so every IBM claim is true](../279-plan-ibm-granite-guardian-lane-live.md) | ibm | 58 |
| 280 | [Build the wallet ownership proof tool support needs before releasing a stranded balance](../280-plan-wallet-recovery-ownership-proof-verifier.md) | wallet | 58 |
| 281 | [Paid endpoint 402 challenges stop advertising amount-0 accepts that external x402 validators reject](../281-plan-x402-clean-challenge-no-zero-amount-accepts.md) | x402 | 58 |
| 282 | [Every $THREE purchase and checkout builder handles Token-2022, and /pricing says plainly when a payment rail is not switched on](../282-plan-wallet-token2022-checkout-rails-honest-config.md) | wallet | 56 |
| 283 | [Scene Capture (/capture) runs on a live video2scene GPU worker instead of its 503 sample-cloud state](../283-plan-capture-video2scene-worker-live.md) | capture | 55 |
| 284 | [A paid agent-skill call whose response was lost replays the stored result instead of asking the buyer to pay again](../284-plan-x402-skill-invoke-idempotent-replay.md) | x402 | 52 |
| 285 | [Autodesk HumanIK rigs animate after three.js load, and the rig gates and Rig Doctor agree with the runtime](../285-plan-avatar-humanik-sanitized-bone-names.md) | avatar | 47 |
| 286 | [Notifications page tabs and type map follow the server category list](../286-plan-notifications-page-category-tab-parity.md) | notifications | 14 |

## P2. New capabilities with clear value

| # | Order | Area | Score |
|---|---|---|---:|
| 700 | [Extract the production Solana x402 facilitator into @three-ws/x402-server/facilitator with sponsor guards and an attack suite](../700-plan-x402-self-hostable-solana-facilitator.md) | x402 | 71 |
| 701 | [Give agents sandboxed code execution: runner worker, execute_code and file tools, settings page](../701-plan-agent-sandbox-code-execution-tools-runner.md) | agent | 70 |
| 702 | [Oracle and the autonomous trading agents ship as two focused MCP servers in the official registry](../702-plan-mcp-oracle-and-agent-trader-servers.md) | mcp | 68 |
| 703 | [Expose the tool gateway bundle: metered web, document, speech and gemini routes plus agent tools](../703-plan-mcp-tool-gateway-metered-routes-tools.md) | mcp | 66 |
| 704 | [Mount the plaza stage in /play and write the show client so a crowd can attend a live hosted show in the world](../704-plan-play-plaza-live-show-mount-and-client.md) | play | 66 |
| 705 | [Ship agent evals: CLI, npm run evals, replay and trajectory export, Evaluate tab, gate wiring](../705-plan-agent-evals-cli-replay-evaluate-tab.md) | agent | 64 |
| 706 | [Ship the bounty feed and Build program: routes, /build and /build/leaderboard pages, submissions](../706-plan-bounties-build-program-routes-and-pages.md) | bounties | 62 |
| 707 | [Hold 60fps on /agora with the full 200-citizen fleet by budgeting which avatars animate](../707-plan-agora-fleet-render-animation-budget.md) | agora | 61 |
| 708 | [Add Slack, WhatsApp and voice-call adapters to the agent gateway](../708-plan-gateway-slack-whatsapp-voice-adapters.md) | gateway | 60 |
| 709 | [Buyers can see and purchase published skill bundles from the marketplace and agent profile](../709-plan-marketplace-bundle-buyer-storefront.md) | marketplace | 60 |
| 710 | [Add a Follow button with a spend cap on agent pages and narrate each copied trade with the 3D agent](../710-plan-agent-follow-button-capped-copy-trading.md) | trading | 58 |
| 711 | [Agora Commons shows a living economy again by deploying the citizens daemon, adding a liveness alarm, and deriving trust grades from the vouch graph](../711-plan-agora-citizens-daemon-deploy-and-liveness.md) | agora | 58 |
| 712 | [Selfie reconstruction fits onto the owned parametric body and body_type becomes real sliders](../712-plan-avatar-parametric-body-type-reconstruction.md) | avatar | 58 |
| 713 | [Close the open page-load costs on /forge, /marketplace and /discover (thumbnail bytes, composer CLS, marketplace hero weight, brand mark)](../713-plan-perf-forge-marketplace-thumbs-cls.md) | performance | 58 |
| 714 | [Remove 'unsafe-eval' from the site-wide CSP and keep it only on the scene-studio route](../714-plan-security-csp-drop-unsafe-eval.md) | security | 58 |
| 715 | [Private worlds become a real Silver-tier $THREE perk with a visibility column, invitees and an enforced read gate](../715-plan-three-hold-activate-worlds-private.md) | three | 58 |
| 716 | [Count AR opens, oEmbed unfurls and shared-creation views so the revenue readout can say whether shares convert](../716-plan-forge-share-distribution-funnel-metrics.md) | forge | 57 |
| 717 | [An invite sheet in /play with the canonical world link, live QR and share, backed by a verified OG unfurl card](../717-plan-play-invite-sheet-qr-og.md) | play | 57 |
| 718 | [Native $THREE launchpad gets a coin page and one-click buy from SOL](../718-plan-launchpad-native-coin-page-and-sol-buy.md) | launchpad | 56 |
| 719 | [Add account status and dashboard URL tools, GET /me/status, and per-agent X posting tools](../719-plan-mcp-account-status-dashboard-url-tools.md) | mcp | 56 |
| 720 | [Worn hair and garments follow the body's identity morphs on the Parametric base, in the editor and in the bake](../720-plan-avatar-parametric-garment-morph-conform.md) | avatar | 55 |
| 721 | [Evaluate and add UltraTex as a Forge texture rung behind the existing texture worker contract](../721-plan-forge-ultratex-texture-rung.md) | forge | 55 |
| 722 | [Move Redis-only money ledgers to Postgres and ship an accounting export](../722-plan-payments-accounting-export-and-durable-ledgers.md) | payments | 55 |
| 723 | [A welcome concierge NPC greets first-time visitors in /play, answers questions from real features, and leads a skippable tour](../723-plan-play-concierge-greeter-tour.md) | play | 55 |
| 724 | [Multiplayer rooms survive more than one Cloud Run instance by turning on the Redis presence and driver, with a two-instance load test](../724-plan-play-multiplayer-redis-scale-out.md) | play | 55 |
| 725 | [Clear the last 84 OSV advisories in the Python worker pins (transformers, diffusers, rembg, basicsr)](../725-plan-workers-python-osv-residual-bumps.md) | workers | 55 |
| 726 | [Ops alerts get an email push channel next to Telegram, with severity routing and a delivery self-test](../726-plan-ops-alerts-email-push-channel.md) | ops | 54 |
| 727 | [World chat keeps a capped per-world scrollback for late joiners and surfaces the persisted community feed in-world](../727-plan-play-chat-scrollback-community-bridge.md) | play | 54 |
| 728 | [Gold holders enter drops early and Genesis holders get first dibs on rare threews.sol names](../728-plan-three-hold-activate-early-drops-and-name-dibs.md) | three | 54 |
| 729 | [Make the public A2A Agent Card spec-compliant and generate a separate enterprise Marketplace card](../729-plan-a2a-agent-card-compliance-marketplace.md) | a2a | 52 |
| 730 | [Dense per-subject face geometry by differentiable fit on the RTX PRO 6000](../730-plan-avatar-dense-identity-fit-rtx.md) | avatar | 52 |
| 731 | [Turn a diorama sentence into a shareable microgame with win conditions, spawn rules and the walk controller](../731-plan-diorama-text-to-microgame-win-rules.md) | diorama | 52 |
| 732 | [Let an agent drive the screen browser autonomously with the owner lease as instant interrupt](../732-plan-screen-autonomous-browser-agent-owner-lease.md) | screen | 52 |
| 733 | [Re-measure mobile performance on the worst pages and cut LCP, blocking time and layout shift to budget](../733-plan-web-mobile-core-vitals-remeasure-and-fix.md) | web | 52 |
| 734 | [One command reports which workers are live versus built-only, with verify builds and tests for each undeployed worker](../734-plan-workers-fleet-status-and-ship-readiness.md) | workers | 52 |
| 735 | [Add a hire-this-agent Solana Blink and cover all agent Blinks in actions.json discovery](../735-plan-actions-hire-agent-blink-discovery.md) | actions | 50 |
| 736 | [Texture the unseen 60 percent of the head from identity-gated synthesised views](../736-plan-avatar-unseen-head-texture-synthesis.md) | avatar | 50 |
| 737 | [Connect HQ to three.ws agents: context bridge, DeFi query tools, compound alert rules and alert-to-action](../737-plan-hq-agent-defi-tools-and-context-bridge.md) | hq | 49 |
| 738 | [Demo pages stop shipping T-pose avatars, QA accounts and real-person likenesses as defaults](../738-plan-site-demo-defaults-tpose-and-account-hygiene.md) | site | 48 |
| 739 | [Build /glass, the 600x600 Meta Ray-Ban Display lens app, on the existing IRL rail](../739-plan-glasses-meta-display-lens-web-app.md) | glasses | 47 |
| 740 | [Distributed traces from the API through every GPU worker land in Google Cloud Trace](../740-plan-platform-opentelemetry-gcp-traces.md) | platform | 46 |
| 741 | [/play world moderation with host mute, kick, ban and player reports](../741-plan-play-world-moderation-mute-kick-report.md) | play | 46 |
| 742 | [The Agent Screen casting pool is deployed, wired to the API secret, and proven end to end](../742-plan-agent-screen-pool-deploy-and-verify.md) | agent-screen | 45 |
| 743 | [The GLB editor reaches 1.0: <agent-3d editor> works, every edit survives export, and hosts get DOM events](../743-plan-avatar-editor-attribute-and-export-fidelity.md) | avatar | 44 |
| 744 | [One selfie to a photoreal animatable avatar through a new LHM GPU lane that renders as splats](../744-plan-avatar-lhm-photoreal-selfie-lane.md) | avatar | 44 |
| 745 | [Parametric avatars carry texture layers (complexion, makeup, tattoos, decals) over the canonical UVs](../745-plan-avatar-parametric-texture-layers.md) | avatar | 44 |
| 746 | [HQ gets data-driven protocol dashboards (Solana first), an oracle deviation monitor and a DeFi risk heatmap](../746-plan-hq-protocol-dashboards-and-risk-heatmap.md) | hq | 44 |
| 747 | [Memory file layer gets real semantic recall instead of substring matching](../747-plan-memory-file-layer-semantic-recall.md) | memory | 44 |
| 748 | [Run the catalog vision gate on its own cron so seeded models are judged on appearance, not just structure](../748-plan-seed-vision-gate-own-cron.md) | forge | 44 |
| 749 | [Clear every X content queue validator error and refilm the stale approved posts, stopping before approve](../749-plan-x-content-queue-clear-validator-errors.md) | x-content | 44 |
| 750 | [x402 batch-settlement on Solana with a Postgres voucher store and a scheduled redemption worker](../750-plan-x402-batch-settlement-durable-vouchers.md) | x402 | 44 |
| 751 | [Re-measure Forge model quality and rig coverage on the live fleet and record the ceilings that gate backend choice](../751-plan-forge-quality-bench-fleet-ceilings-remeasure.md) | forge | 42 |
| 752 | [@three-ws/naming-mcp can be npm-published again, with a guard so no published package depends on a private one](../752-plan-mcp-naming-publish-without-private-dependency.md) | mcp | 42 |
| 753 | [Add a "Holders only" control to Widget Studio so token-gated embeds can be created without the API](../753-plan-embed-widget-studio-holder-gate-control.md) | embed | 40 |
| 754 | [Fact-checker benchmark ranks evidence by source quality, runs on its cron against live sources, and publishes a verifiable accuracy score](../754-plan-factcheck-benchmark-evidence-ranking-and-publish.md) | factcheck | 40 |
| 755 | [Open inference network gets a paid buyer endpoint and a node earnings ledger](../755-plan-inference-network-buyer-endpoint-and-earnings.md) | inference | 38 |
| 756 | [Robinhood Chain USDG becomes an accepted x402 rail through hood402, behind an env flag](../756-plan-robinhood-hood402-x402-payment-rail.md) | robinhood | 30 |

## P3. Polish, developer experience, exploratory

| # | Order | Area | Score |
|---|---|---|---:|
| 757 | [Replace nvdiffrast in Forge workers with a permissively licensed rasteriser behind one bake interface](../757-plan-forge-replace-nvdiffrast-bake-rasteriser.md) | forge | 40 |
| 758 | [Money-rail kill switch and anomaly alerting from the financial controls register](../758-plan-payments-retention-kill-switch-and-alerting.md) | payments | 40 |
| 759 | [Add temporal validity and provenance to agent memory and score it on LoCoMo and LongMemEval](../759-plan-memory-temporal-facts-benchmark-scores.md) | memory | 38 |
| 760 | [Emit AG-UI protocol events from the agent run stream](../760-plan-agent-ag-ui-event-stream.md) | agent | 36 |
| 761 | [Bake folds applied identity morphs into vertex positions so served avatars carry only expression targets](../761-plan-avatar-parametric-identity-morph-fold.md) | avatar | 36 |
| 762 | [Build the Zed, Raycast, Poe and Gradio MCP Space packages (and an n8n node) that the listing sweep says are accepted elsewhere](../762-plan-growth-zed-raycast-gradio-poe-listing-packages.md) | growth | 36 |
| 763 | [Record LLM judge cost per verdict and measure trailing-stop giveback in the sniper experiment](../763-plan-sniper-experiment-judge-cost-and-exit-giveback.md) | sniper | 35 |
| 764 | [The Solana agent SDK throws its typed errors everywhere it should and every shipped action has tests](../764-plan-solana-sdk-typed-errors-and-test-coverage.md) | solana | 35 |
| 765 | [First-party campaign attribution so each marketing kit's results can be measured without a third-party tool](../765-plan-growth-campaign-attribution-ledger.md) | growth | 34 |
| 766 | [Give /play NPCs an observation, reflection and planning loop with real wallets](../766-plan-play-generative-npc-loop.md) | play | 34 |
| 767 | [Finished Coin Wars results echo into the world activity ticker and the chart-screen jumbotron](../767-plan-play-war-results-ticker-jumbotron.md) | play | 32 |
| 768 | [Webcam ASL recognition understands 250 everyday signs, not only fingerspelling](../768-plan-sign-asl-word-level-recognition.md) | sign | 32 |
| 769 | [Let embedders supply the skill-trust allowlist on the agent-3d element](../769-plan-agent-skill-trust-allowlist-attributes.md) | agent | 30 |
| 770 | [Agora citizens work as cartographers again, with diorama compose running inside the job budget](../770-plan-agora-cartographer-profession-reactivation.md) | agora | 30 |
| 771 | [Forge-Off themed event boards with daily windows and a landing page](../771-plan-forge-off-themed-event-boards-landing.md) | forge | 30 |
| 772 | [Ship the free credibility files and crawlable-locale fixes that funding and listing programs check for](../772-plan-growth-credibility-files-translations-credits.md) | growth | 30 |
| 773 | [Sign outbound agent HTTP requests with Web Bot Auth and publish the key directory](../773-plan-identity-web-bot-auth-signed-requests.md) | identity | 30 |
| 774 | [Avatar surprise composer produces body-shape variety and bone accessories on the parametric base](../774-plan-avatar-composer-parametric-variety.md) | avatar | 28 |
| 775 | [Avatars carry a saved animation identity (idle, walk, gesture intensity, emote loadout) honored everywhere](../775-plan-avatar-animation-identity.md) | avatar | 26 |
| 776 | [ARCHITECTURE.md Known Gaps is rewritten to match the code, and the two real env-hygiene gaps are fixed](../776-plan-docs-architecture-known-gaps-truth-pass.md) | docs | 26 |
| 777 | [Playwright covers the agent on-chain deploy and token-launch buttons with an injected wallet, devnet only](../777-plan-onchain-deploy-wallet-flow-e2e.md) | onchain | 25 |
| 778 | [Re-verify every Robinhood Chain standalone repo builds and tests green against the current chain endpoints](../778-plan-robinhood-standalone-repos-reverify.md) | robinhood | 25 |
| 779 | [The agent resolver verifies ENS and DNS name claims in both directions and reports a trust state](../779-plan-agent-ens-dns-claim-verification.md) | agent | 24 |
| 780 | [ROADMAP.md is repaired (invalid UTF-8) and its phase statuses are re-measured and synced with the README roadmap](../780-plan-docs-roadmap-phase-status-truth-pass.md) | docs | 24 |
| 781 | [Add a drift check for the UX Flow Atlas and trace the highest-traffic routes it never covered](../781-plan-docs-ux-flows-atlas-route-coverage.md) | docs | 24 |
| 782 | [Knip dead-code report and a gitleaks full-history secret scan wired into local gates](../782-plan-platform-dead-code-and-secret-history-scans.md) | platform | 24 |
| 783 | [Sign vocabulary packs per language with a native-signer review flow, so a second sign language can ship only when reviewed](../783-plan-sign-language-packs-and-signer-review.md) | sign-language | 24 |
| 784 | [Retire the legacy button and pill class families in favour of .btn and .pill](../784-plan-ui-button-pill-migration-long-tail.md) | ui | 24 |
| 785 | [packages/README.md lists every package and a check keeps it that way](../785-plan-docs-packages-index-complete-and-checked.md) | docs | 22 |
| 786 | [three.ws Drive on Android Automotive OS as its own build flavor](../786-plan-drive-android-automotive-build-flavor.md) | drive | 22 |
| 787 | [Multi-agent stage serialises speech so agents never talk over each other](../787-plan-stage-agent-speaking-queue.md) | stage | 22 |
| 788 | [Re-verify and correct the measured claims inside the November partner kits before they are sent](../788-plan-growth-kits-stale-claims-refresh.md) | growth | 18 |
| 789 | [Tune the lintapple UI policy to the real design tokens and lint the core pages in one command](../789-plan-tooling-ui-lint-policy-tuning.md) | tooling | 18 |
| 790 | [Rewrite api/avatars/REGENERATE.md to describe the shipped regeneration pipeline, not a stub provider](../790-plan-docs-avatar-regenerate-api-reference-refresh.md) | docs | 12 |

## Gated. The last step needs an owner action or an outside party

| # | Order | Area | Score |
|---|---|---|---:|
| 966 | [$THREE receiver wallets preflight, signer-conflict guard and one-command wiring](../966-plan-token-rail-receiver-wallets-preflight.md) | token | 92 |
| 967 | [Refresh the GTC 2027 poster evidence and ship a form-ready submission pack](../967-plan-nvidia-gtc-poster-submission-pack-refresh.md) | nvidia | 85 |
| 968 | [Autopilot gets a guarded trade action and a trading MCP server (quote, positions, execute)](../968-plan-autopilot-trade-action-and-trading-mcp.md) | autopilot | 66 |
| 969 | [Deploy the four built Solana programs to devnet, smoke-test them, and ship a one-command mainnet runbook](../969-plan-solana-programs-devnet-deploy-and-mainnet-runbook.md) | solana | 66 |
| 970 | [Wire the Kamino lending venue into agent routes, lend tools and an Earn panel, up to the mainnet gate](../970-plan-lending-agent-earn-venue-routes-ui.md) | lending | 60 |
| 971 | [The production autopilot gets its missing systemd units and provision script, and is stood up on its VM up to the push credential](../971-plan-ops-autopilot-write-units-and-provision-vm.md) | ops | 58 |
| 972 | [Custodial wallet encryption key becomes truly dedicated via a verified, reversible re-seal](../972-plan-wallet-key-dedicated-reseal-rotation.md) | wallet | 58 |
| 973 | [Staked Event Markets proven end to end on devnet, with a $THREE buyback executor and a one-command mainnet launch kit](../973-plan-event-markets-staking-devnet-proof-and-launch-kit.md) | event-markets | 57 |
| 974 | [Ship the human-task marketplace: routes, pages, agent tools, devnet escrow settlement up to the mainnet gate](../974-plan-human-tasks-escrow-marketplace-routes-pages.md) | tasks | 54 |
| 975 | [Build the Robinhood Crypto trading connector with spend caps, simulation and owner-pasted keys](../975-plan-robinhood-crypto-connector-spend-capped.md) | robinhood | 52 |
| 976 | [A new "paid-intel" sniper arm that buys its entry signals over x402 and logs the payment signature in every decision](../976-plan-x402-paid-intel-sniper-arm.md) | x402 | 52 |
| 977 | [LongCat video avatar worker runs on an 80GB GPU host with staged weights, an idle-stop lifecycle and API wiring](../977-plan-avatar-longcat-gpu-host-bringup.md) | avatar | 40 |
| 978 | [3D Drops mint on Solana: one Metaplex Core collection per drop, each revealed item minted into it](../978-plan-drops-onchain-core-collection-mint.md) | drops | 40 |
| 979 | [The Seeker app 1.1.0 (Agent glance widget) is built, signed, verified and staged so the owner's only step is the portal upload](../979-plan-mobile-seeker-v1-1-widget-release-prep.md) | mobile | 40 |
| 980 | [Sniper manages retained moon bags and records latency and per-second price telemetry](../980-plan-sniper-moonbag-manager-and-latency-telemetry.md) | sniper | 38 |
| 981 | [The TRELLIS NGC container passes real Ampere and Hopper inference and a CVE-clean two-stage build](../981-plan-nvidia-ngc-trellis-image-validation.md) | nvidia | 30 |
| 982 | [Add the native Meta Wearables toolkit lane to the iOS app for hands-free voice and camera re-localization](../982-plan-glasses-native-wearables-toolkit-lane.md) | glasses | 28 |
| 983 | [three.ws 3D extension verified and staged so publishing to the VS Code Marketplace and Open VSX is one command](../983-plan-vscode-3d-marketplace-publish-ready.md) | vscode | 26 |
| 984 | [EVM AgentPayments gets a CREATE2 deploy tool, fork proof, address wiring and the pending Basescan verification](../984-plan-evm-agentpayments-create2-deploy-readiness.md) | contracts | 22 |
| 985 | [Drive lane D, the agent beside a projected CarPlay or Android Auto session on an open head unit](../985-plan-drive-open-head-unit-carplay-lane.md) | drive | 12 |
