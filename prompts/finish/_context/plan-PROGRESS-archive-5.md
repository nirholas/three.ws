# plan-PROGRESS, archive 5 (2026-11-10 to 2026-11-12)

Older entries moved verbatim out of [plan-PROGRESS.md](plan-PROGRESS.md) on 2026-11-15 so every file stays under the 50,000-character limit. Read-only record: append new entries to [plan-PROGRESS.md](plan-PROGRESS.md), never here.

2026-11-10 720-plan-avatar-parametric-garment-morph-conform.md (kept, browser slider pass outstanding) built in 83a2723bf: garment morph conform shared by editor and bake.

2026-11-10 784 (update): audit:buttons --strict is in gate and guard-registered (1491d6eff); remaining: states/tokens gates blocked by other sessions' files, agent-detail browser check, generated changelog files.

2026-11-10 | 782-plan-platform-dead-code-and-secret-history-scans.md | e0fc84e59 637ed2c73 + this commit | kept: scans wired and run (1,079 gitleaks findings triaged, one owner GCP key check); dead-code deletions and allowlist tuning remain.

2026-11-10 | 738-plan-site-demo-defaults-tpose-and-account-hygiene.md (done, deleted) | 62023f152, 5ec2bdfa0, 8ad49d745, b58d683d1, 8a102cff4 + this commit | every demo surface defaults to the house avatar, no src or pages file references cz.glb, retarget rest pose now generated from a skeleton-only data file, QA accounts off public boards.

2026-11-10 784 (update 2): agent detail and alpha-drip verified in a real browser; only the other sessions' states/tokens gate failures and unstaged generated changelog files remain.

2026-11-10 | 722-plan-payments-accounting-export-and-durable-ledgers.md (kept open) | c7eb4290e + this commit | Postgres bounty ledger, export script and admin route shipped and verified; live backfill and admin-200 check remain with the owner.

2026-11-10 720-plan-avatar-parametric-garment-morph-conform.md closed: browser pass verified on /avatar-studio (chestPectorals=1, jawWider=1, hipsCircNarrower=1; top vertices track, return exactly at 0, no console errors); code in 83a2723bf.

2026-11-10 | 789-plan-tooling-ui-lint-policy-tuning.md (kept open) | this commit | Built and unit-tested; full lint:ui:core exit 0 unverified because machine load (70-98) made lintapple time out; rerun on idle machine.

2026-11-10 | 705-plan-agent-evals-cli-replay-evaluate-tab.md | 9e936ff6d | kept: fixed prod evals catalog 500 (evals/ missing from build context); browser pass done; owner deploys, full smoke blocked by OVH 429 and Vertex 403 scopes.

2026-11-10 | 722-plan-payments-accounting-export-and-durable-ledgers.md (update) | this commit | Redis backfill applied from a Cloud Run job (2 bounties, row count verified); only the owner's admin-200 check and the deploy remain.

2026-11-10 724-plan-play-multiplayer-redis-scale-out.md (kept, live deploy owner-gated): Memorystore and secret provisioned, Redis socket tunnel added so Cloud Run instances serve any room, two-instance test fleet load test 100 percent delivery; promote the live service with USE_REDIS_SECRET=1 ./deploy-cloudrun.sh.

2026-11-10 | 782-plan-platform-dead-code-and-secret-history-scans.md | adds allowlist commit | Google key item closed, scan allowlisted to exactly 1 real finding (old EVM test payer key, owner to retire); order kept.

2026-11-10 707-plan-agora-fleet-render-animation-budget.md (kept open) | see commit | real L4 GPU measured 12.6 fps unbudgeted vs 31.2 fps budgeted; remaining skinned draw-call cost keeps it below 60.

2026-11-12 | 271-plan-ops-world-health-retired-state.md (kept, DNS owner-gated) | status update | verified live: healthz shows world retired, flag migration applied, 0 open world-health alerts, mapping deleted; only the world.three.ws DNS record (owner) remains.

2026-11-12 282-plan-wallet-token2022-checkout-rails-honest-config.md RE-VERIFIED: no code change needed; production serves checkout_ready (all false) and the not-ready /pricing state, 74 targeted tests pass, mainnet simulation err: null for both builders. Remaining, owner only: THREE_TREASURY_WALLET and PAYMENT_RECIPIENT_SOLANA on three-ws-api via --update-env-vars.

2026-11-12 281-plan-x402-clean-challenge-no-zero-amount-accepts.md DONE: code shipped in 86b348b16 and is live; production agent-reputation and agent-bouncer 402s carry no amount-0 accepts or auth-hints extension, /openapi.json and /.well-known/x402.json list auth methods, agentcash discover exit 0, verify-x402-discovery 4544 clean 0 dropped, 402index now answers 'registered and live (domain verified)' for both URLs.

2026-11-12 283-plan-capture-video2scene-worker-live.md RE-VERIFIED (kept, deploy owner-gated): state unchanged; image now proven to build via build-only Cloud Build 8285bb39 (SUCCESS, in-image tests OK). us-central1 L4 quota 3 still fully held (model-rig 1, model-trellis 2). Remaining, owner only: the cloudbuild.yaml deploy, GCP_VIDEO2SCENE_URL via --update-env-vars, and the /capture end-to-end check.

2026-11-12 | 706-plan-bounties-build-program-routes-and-pages.md | b88d7c228 | Re-verified live: feed serves 3 sources, both crons enabled in Cloud Scheduler, 45 tests pass; only the owner's first program_rounds row remains.

2026-11-12 265-plan-custody-proof-anchor-restore.md PARTIAL: deployed and live (35/560 epochs anchored on mainnet, /integrity 200, memo root verified); 8af6203bb + 6380c1a9b fix the browser verifier's 403 RPC, the phone-width history table and the snapshot that attested only 400 of 1,063 wallets per epoch; owner deploys the batched snapshot, then a signed-in /proof pass.

2026-11-12 | 704-plan-play-plaza-live-show-mount-and-client.md | (this commit) | Re-verified: mount and 36 tests pass, multiplayer now boots locally and two real clients share one stage room with identical utterances, distinct seats and clean leave; order kept for the owner's production plaza claim and live-tip check.

2026-11-12 506-integrate-07-pump-claims-listener.md RE-VERIFIED (kept, owner-gated): 21/21 service tests pass, docs and STRUCTURE row present, code in c2b38c27c. Remaining, owner only: production migration apply, first Cloud Run deploy, 7-day backfill (row 62).

2026-11-12 275-plan-site-console-resweep-and-fix.md RE-VERIFIED (kept, blocked on box load): load 286 on 32 cores so the sweep cannot be trusted; baseline gate and README rule already shipped; remaining is the sweep, classify and fix on a quiet box (load below 32).

2026-11-12 702-plan-mcp-oracle-and-agent-trader-servers.md RE-VERIFIED (kept, owner-gated): remote live in prod, 402 discovery example fixed test-first (c47ab4a4b), packages and audits pass for Oracle and agent-trader; remaining is npm publish, publish:mcp, smoke:mcp and the X post, which is also blocked on the 100 percent win-rate labeler outage.

2026-11-12 282-plan-wallet-token2022-checkout-rails-honest-config.md RE-VERIFIED (kept, owner-gated): code shipped earlier and live, plans still report checkout_ready all false and token config treasury_configured false; remaining, owner only: choose wallets and set THREE_TREASURY_WALLET and PAYMENT_RECIPIENT_SOLANA on three-ws-api (row 23); a real $THREE purchase after that is an owner-approved spend.

2026-11-12 706-plan-bounties-build-program-routes-and-pages.md RE-VERIFIED (kept, owner-gated): shipped in b88d7c228; /build, /build/leaderboard, /bounties return 200, live feed serves listings, 28 tests pass in bounties-feed and build-program suites; remaining, owner only: insert the first program_rounds row (dates, tracks, prize pool) so /build shows an open round.

2026-11-12 | 707-plan-agora-fleet-render-animation-budget.md | (this commit) | Re-verified: animation budget, e2e spec, docs, index and changelog all shipped (9 unit tests pass, L4 GPU 12.6 to 31.2 fps with 200 citizens); the 60 fps stretch needs instancing or a far-crowd rig and is a new follow-up, not this order.

2026-11-12 709-plan-marketplace-bundle-buyer-storefront.md RE-VERIFIED (kept, owner-gated): shipped in 7d1fe6dda, storefront test 10/10 passes; remaining are a real-bundle browser check, full vitest baseline, and push plus deploy

2026-11-12 741-plan-play-world-moderation-mute-kick-report.md 5944e12c5 re-verified (21 tests pass); open owner steps: redeploy multiplayer service, set Upstash env on it, run i18n:translate after Vertex billing.

2026-11-12 283-plan-capture-video2scene-worker-live.md RE-VERIFIED (kept, owner-gated): still no model-video2scene service, GCP_VIDEO2SCENE_URL unset, weights staged, fusion tests OK (19 ran, 2 skipped), check:vendored clean, /api/scene-capture empty body 400; remaining, owner only: the production Cloud Build deploy, then update-env-vars GCP_VIDEO2SCENE_URL, then a real-clip check on /capture.

2026-11-12 724-plan-play-multiplayer-redis-scale-out.md (kept, GATED): live /health still shows presence local; owner runs cd multiplayer && USE_REDIS_SECRET=1 ./deploy-cloudrun.sh, then checks /health shows presence redis and maxScale 10.

2026-11-12 721-plan-forge-ultratex-texture-rung.md RE-VERIFIED (kept, owner-gated): 8 worker contract tests and routing test pass, default tier unchanged; remaining, owner only: BFL commercial license or approve a 4B LoRA training run, then the 20-mesh A/B and the flag.

2026-11-12 262-plan-i18n-restore-language-picker-manifest.md OWNER-GATED: manifest lists 7 locales, ~78 still up to 1114 keys behind; Vertex probe 403 on unpaid GCP billing and no API key exists; owner pays billing or adds GOOGLE_API_KEY, then runs i18n:translate shards.

2026-11-12 737-plan-hq-agent-defi-tools-and-context-bridge.md RE-VERIFIED (kept, owner-gated): 37 hq node tests and 7 hq-host tests pass; remaining is the real-browser check, live agent-tools check and HQ deploy

2026-11-12 750-plan-x402-batch-settlement-durable-vouchers.md no commit: Step 0 only, package API mapped (BatchOperationStore + ChannelState stores); build not started.

2026-11-12 740-plan-platform-opentelemetry-gcp-traces.md GATED: tracing shipped in 112812796; worker redeploy and live Forge trace remain owner-gated (deploy).

2026-11-12 718-plan-launchpad-native-coin-page-and-sol-buy.md RE-VERIFIED (kept): feature shipped in 15e43adba, 58 vitest tests pass; remaining is the real-browser devnet proof (needs devnet signer env and a working dev server)

2026-11-12 743-plan-avatar-editor-attribute-and-export-fidelity.md RE-VERIFIED (kept): shipped in 1fed88375, 17 editor tests pass; remaining are full vitest baseline, build:pages and a /viewer re-open check.

2026-11-12 732-plan-screen-autonomous-browser-agent-owner-lease.md RE-VERIFIED (kept, owner-gated): shipped in 478f431b2, 13 tests pass, real-model run and lease yield verified with llama-3.3-70b; remaining: default gpt-oss-120b route down (GCP billing, owner) and live-pool Take over browser check.

2026-11-12 | 745-plan-avatar-parametric-texture-layers.md | a690ecfa7 | Verified already shipped: appearance.layers schema, compositor, bake-layers, Skin tab, catalog and upload route, 54 targeted tests pass.

2026-11-12 | 722-plan-payments-accounting-export-and-durable-ledgers.md (gated) | this commit | Re-verified 13 tests pass; only owner push, deploy and live admin-200 check remain.

2026-11-12 763-plan-sniper-experiment-judge-cost-and-exit-giveback.md shipped in e8abd8182 (judge cost columns, report script, giveback); re-verified: migration applied, 9 tests pass, report prints net PnL and giveback on real data; pricing of new verdicts starts when the owner redeploys the sniper worker.

2026-11-12 736-plan-avatar-unseen-head-texture-synthesis.md (gated) | this commit | Re-verified 42 tests pass; only the owner Vertex billing restore plus fixture capture, held-out eval and flag decision remain.

2026-11-12 705-plan-agent-evals-cli-replay-evaluate-tab.md shipped in 7d1879425 and 9e936ff6d (eval service, REST with SSE, replay, NDJSON trajectory, CLI, Evaluate tab, evals:gate); re-verified in production: smoke suite 7/7 on nvidia/nemotron-3.5-lightning-30b-a3b and nemotron-3-ultra-550b-a55b (three-ws/eval-report@1), replay byte-identical with receipt chain verified, catalog no longer 500s.
