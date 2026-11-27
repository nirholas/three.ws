# Open queue completion audit, 2026-11-27

Every open order in `prompts/finish/` (234 files) checked against the committed code, tests, docs, git history and the live site. The `**Status (date):**` lines in the orders were treated as claims to check, not as evidence.

- **Production** serves `f0eed584f` (built 2026-11-26, confirmed with `GET https://three.ws/api/version`).
- **Local `main`** was at `541f35ec3` when this was written. "In production" below means the commit is an ancestor of `f0eed584f`.
- **Method:** 10 read-only audit passes, one per batch of orders. Each pass read the order's tasks and Definition of done, then looked for real evidence:
  - the code that implements each item
  - the commits each order cites, and whether they exist
  - the required tests (running one targeted file when that settled it)
  - changelog, doc and STRUCTURE rows
  - plain GETs against public `https://three.ws` routes
- **Re-check:** the main session re-checked the deciding points:
  - the two failing test files
  - the DONE commits being in production
  - the live CSP
  - the TRELLIS worker history
  - the six Forge commits that landed after the audit passes ran
- **Not checked:** the production database and the GCP console, because no session here had them open. Every verdict that depends on a migration being applied or a service existing says so.
- **Where the orders went (2026-11-27):**
  - The 13 DONE orders are archived in [prompts/archive/](../../archive/README.md).
  - All 103 CODE-DONE/OWNER orders moved to [prompts/awaiting-owner/](../../awaiting-owner/README.md). Thirteen of them (902, 911, 913, 914, 917, 954, 957, 958, 961, 962, 965, 970, 978) moved in a second commit after the owner approved it under the commit gate, because their links sit on lines that name other crypto projects.
  - PARTIAL and NOT-STARTED orders stay in `finish/`.

## Verdict meanings

- **DONE**: every Definition of done line that code can satisfy is verified in committed code, and anything that needs production is live. Ready to `git mv` to `prompts/archive/`.
- **CODE-DONE/OWNER**: code, tests and docs are committed. What remains is an owner action:
  - push or deploy
  - funding
  - a key or OAuth app
  - a listing or store submission
  - a licence or pricing decision
  - paid capacity or a billing hold
- **PARTIAL**: some tasks are built, and work an agent can do is still missing. The missing pieces are listed.
- **NOT-STARTED**: no meaningful implementation of the order's core task exists.
- **MOOT**: the order's premise is gone. None were found.

## Totals

- DONE: 13
- CODE-DONE/OWNER: 103
- PARTIAL: 44
- NOT-STARTED: 74
- MOOT: 0

The completion rate differs a lot by campaign:

- **Plan, owner-gated and campaign orders (259 to 982):** mostly built. 99 of their 116 non-DONE verdicts are CODE-DONE/OWNER, waiting on a deploy, funding, a credential or a decision.
- **Forge hardening (105 to 187):** mostly not started. 54 of its 79 orders have no implementation yet. Most of the built ones wait on one production deploy.
- **NVIDIA design orders (870 to 879) and realism orders (887 to 899):** all not started.

## Fix these first (defects found while auditing)

1. **Two Forge test files fail at HEAD (6 tests).** Rechecked after the latest Forge commits; they still fail.
   - `tests/forge-error-copy.test.js` fails because `FORGE_ERROR_COPY` in `src/forge-errors.js` has no copy for four codes that committed endpoints return:
     - `content_refused` and `provider_unavailable` (both from `api/_lib/forge-byok-guard.js`)
     - `invalid_image_dimensions` and `invalid_image_type` (both from `api/_lib/forge-input-guard.js`)
   - `tests/forge-product-name.test.js` fails because the `es`, `ar`, `bn`, `da` and `sk` catalogs have no `forge.product_name`.
   - These belong to orders 113 and 166.
2. **Status lines that contradict the code.** Each needs its status corrected or its claim made true.
   - 113: says the error copy is complete; the guard test is red.
   - 262: says the 85-language picker is restored:
     - the i18n lint reports 1339 problems
     - about 1141 keys are behind
     - the production manifest lists 62 locales against 84 committed
   - 337: commit `03e39acc4` says the 360 lanes run end to end on real GPU workers. No worker is deployed, and `GET /api/pano-scene` reports both lanes false.
   - 714: says the CSP change is waiting to ship. It is already live: production `script-src` has `'wasm-unsafe-eval'` and no `'unsafe-eval'`.
   - 770: says the cartographer is not reactivated. It is committed and in production.
   - 943: says multi-view is working. 5 of the 6 recorded jobs fail.
   - 970: its status paragraph says the Earn venue is pending. It is committed and in production.
3. **Stale status text, harmless but misleading.**
   - These say "push and deploy remaining" for work that is already in `f0eed584f`: 713, 748, 858, 864.
   - These cite commits that no longer exist after a history rewrite:
     - 965 cites `1344caa62`; the real fix is `bc2d776ae`, which is in production.
     - 782 cites `bbfb92759`.
4. **The 360 landing page shows four "Live" badges** (commit `03e39acc4`) while `GET https://three.ws/api/pano-scene` returns `{"lanes":{"equirect_image":false,"insp":false}}`. Either deploy the workers or make the badges read the lane state (order 346).
5. **Wrong doc link in the gateway docs (order 708).** It points to `/settings/connections`, which redirects to `/dashboard/settings#x-posting`. The Slack, WhatsApp and voice cards live at `/settings#connections`.
6. **`docs/forge.md:267` still says Forge needs no login.** Forge now asks for an account before a photo upload (order 176).
7. **`npm run audit:mcp-golden` fails** on `export_openusd` drift, and the fixture has no oracle tools (order 702).
8. **Order 751 conflicts with the Forge protected-lanes rule.** Its task reorders the lane registry in `api/_lib/forge-tiers.js`, which `docs/ops/forge-protected-lanes.md` now forbids for a working lane. The owner should rescope it to measuring only, or close it.
9. **Order 764's last piece is gone from the tree.** Its status says the conversion of the 15 bare `Error` throws in the third-party adapter under `solana-agent-sdk/src/actions/` is "written and tested" and waits on the commit gate. That change is not in the working tree or a stash: the bare throws are still in four files. After the owner says yes, an agent has to redo it.

## DONE (13): archivable now

Each one's code is committed and in production.

- 331 Pano environment (a user's 360 photo as the world): `cbe317633`, `5625e6be0`.
- 626 Metered OpenAI-compatible router: `fbb235df5`, plus the rate fix `b24e4b077`.
- 714 Drop unsafe-eval from the site-wide CSP. Verified live. Its status line is wrong (see above).
- 767 War results ticker and jumbotron: `72202b0f2`.
- 851 Live /nvidia lane health and benchmarks.
- 852 Nemotron vision lane.
- 854 NVIDIA reranker revived. The stage is opt-in on purpose, through `KNOWLEDGE_RERANK_ENABLED=1`.
- 855 Day-zero NIM adoption autopilot.
- 856 NemoGuard agent chat guardrails.
- 858 NeMo Retriever PDF knowledge. The code is complete, and migration `20261116182500_agent_knowledge_pdf_jobs.sql` is applied in production (checked with `db:status` on 2026-11-27).
- 860 /cosmos world lane on current Cosmos models.
- 864 OpenUSD simulation-ready export.
- 869 Audio2Face emotion expression.

## CODE-DONE/OWNER (103), grouped by the owner step that clears them

Each order is listed once, under the step that clears most of it. After that step, the order still needs its own live check before it is archived.

### A. One production deploy (`npm run deploy:gcp:full`), code not yet live

These all sit in the 185+ commits between `f0eed584f` and HEAD.

- 105 Live walkthrough script. Then run `npm run forge:walkthrough`. Today it fails on production with `rate_limited` because `b41786cd6` is not deployed.
- 108 Director LLM fail open.
- 109 Photo to 3D intake. Then run `node scripts/forge-intake-verify.mjs --base https://three.ws`.
- 111 Job lifecycle, poll and resume. Then do a live reload, tab-close and offline test.
- 116 TRELLIS.2 lane diagnosis. Also deploy the `model-trellis2` image and decide the explicit-only gate.
- 117 Match my photo. Then make one recorded live run. The root-cause write-up exists only in the commit message.
- 119 Hunyuan, HF lanes and regions. Also set the load balancer request header `X-Client-Region:{client_region}` and confirm the reconstruct model env.
- 120 NVIDIA-hosted TRELLIS lane. Then make one live call. The failure breakdown needs DB access.
- 121 BYOK geometry lanes. Then do a browser pass of the key field.
- 122 Multi-view inputs. Then do one live post-deploy check.
- 167 Input security for uploads and URLs. First needs the owner's yes to pin the validated IP in the vendored `worker_security.py` across 36 workers. One of them is the protected `workers/model-trellis/`, which is why it needs the yes.
- 169 Content safety and takedown. Then do a takedown plan run without `--apply`.

### B. Worker or service deploys

- 283 Scene Capture video2scene. Deploy `model-video2scene` and set `GCP_VIDEO2SCENE_URL`. The L4 GPU quota is full.
- 332 panodepth worker, 339 pano capture job API and 341 video2motion equirect. All three are cleared by `npm run ship:insta360`. That script stops today because `deploy/insta360/images.json` holds no image digests, so record the verified digests from the progress log there first. 339 also needs the R2 credential from group C.
- 701 Agent sandbox code execution. Deploy the sandbox runner and set its env vars. The API, tools and `/settings/sandbox` are already live.
- 711 Agora citizens daemon and 766 generative NPC loop. One agora-citizens deploy covers both. 711 also needs a funded devnet funder.
- 715 $THREE hold activates private worlds and 724 multiplayer Redis scale-out. One `three-ws-multiplayer` redeploy covers both, with `USE_REDIS_SECRET=1` for 724.
- 737 HQ agent tools and context bridge, and 746 HQ protocol dashboards. Both need the HQ Cloud Run deploy (`apps/hq/docs/deploy-cloud-run.md`).
  - 737 also needs `HQ_BASE` set for `packages/hq-mcp`. The host demo section (`src/hq-host.js`) is not wired into any page.
  - 746 adds its changelog entry at that deploy.
- 742 Agent screen pool. Deploy the worker. The API side and the secret are live.
- 944 Rig anything and 945 editable parts. Deploy the GPU services. Forge health reports `anigen` and `partcrafter` as unconfigured.
- 947 GPU worker redeploy and drift check. Roll out the drifted workers. The tooling is done.

### C. Credentials, env vars and OAuth apps

- 266 MCP external integrations. Register a GitHub OAuth app with callback `https://three.ws/api/mcp-connections/callback`, then set `MCP_OAUTH_GITHUB_CLIENT_ID` and `MCP_OAUTH_GITHUB_CLIENT_SECRET` with `--update-env-vars`.
- 282 Token-2022 checkout rails and 966 token rail receiver wallets. Set `THREE_TREASURY_WALLET`, `THREE_REWARDS_WALLET` and `PAYMENT_RECIPIENT_SOLANA`. Live `/api/healthz` reports `three_token_rail` down, and `/api/payments/solana/plans` reports `checkout_ready` false.
- 338 Multipart upload API and 713 page-load costs. Rotate the rejected production R2 credential on `three-ws-api` (`S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`).
  - 713 then needs one Lighthouse run of `/discover` on an idle host, to confirm it stays under 3,500 KiB.
- 708 Gateway Slack, WhatsApp and voice adapters. Create the Slack, WhatsApp and Twilio apps and set their secrets. The three webhooks answer 503 (not configured). Also fix the doc link above.
- 726 Ops alerts email channel. Set `OPS_ALERT_EMAILS`.
- 925 Mention to launch. Link the X account and set `X_MENTION_BOT_LIVE`.
- 954 Google OAuth connector. Create the Google OAuth client. Live `/api/config` reports `googleEnabled:false`.
- 962 Approvals inbox over Telegram. Set the bot token, then do one live check.
- 972 Wallet key dedicated reseal. Follow runbook steps 2 to 6:
  - add the new key to Secret Manager for `three-ws-api` and `agent-sniper`
  - run `scripts/reseal-custodial-wallets.mjs --apply --hold-mismatched`
  - swap the key
- 782 Dead-code and secret-history scans. Retire the leaked dust-balance EVM key (prefix `0x5e306b`, listed under "Unresolved" in `docs/ops/secrets-history-audit.md`), then allowlist its fingerprint so the scan exits 0.

### D. Funding and on-chain actions (spend gate: owner yes every time)

- **Devnet SOL for the QA payer `G57Hd6u15bnvt1iNH9HW7DmgJ6Sq1hkZuxgdMFp9R5N3`.** Every faucet is captcha-gated or capped, so a human has to claim it. Once funded, it clears:
  - 259 self-custody routes (run `scripts/qa-self-custody-devnet.mjs`)
  - 605 on-chain allowance budgets
  - 606 burner wallet
  - 622 Solana agent registry
  - 718 native launchpad buy and sell proof
  - 770 cartographer funded devnet run
  - 969 Solana programs devnet deploy (`scripts/deploy-solana-programs.mjs --cluster devnet`)
  - 973 event market staking proof
  - 974 human tasks escrow
  - 978 drops Core collection mint
- 902 x402 settle runway. Fund the ring payer and the sponsor fee wallet.
- 512 Anti-snipe native lane. Create the mainnet curve config (about 0.0082 SOL, `scripts/native-launchpad-create-config.mjs --network mainnet`), then pin its key env var.
- 540 Memo inscription reader. One small mainnet inscription write, or an existing inscription id for a read-only proof.
- 704 Plaza stage show. Claim the production plaza, then do a two-browser check with one confirmed live $THREE tip.
- 968 Autopilot trade action. The first funded trade.
- 970 Lending agent Earn venue. The first real mainnet deposit and withdraw.
- 957 EVM DEX launch lane. Deploy the launcher contract on the EVM chain. Live `/api/launches/lanes` lists it `available: false` as designed.
- 917 Launchpad trading roadmap. Arm the $THREE and X reward programs (`docs/growth-programs.md`), then decide or drop the copy vault and the wagering variant.
- 937 Sponsorships. Decide which sponsorships to pay for. Each one is a spend.
- 958 Creator fee payouts. A decision on how claims start: extend the claimer to agent coins, or start minting with the global launcher. Nothing has minted yet, so nothing can be distributed.

### E. Migrations already applied, follow-up check remaining

Checked 2026-11-27 with `db:status` against production: every migration in `api/_lib/migrations/` is applied, including the ones these four orders need (`20261105050000_inference_node_earnings`, `20261105110000_campaign_attribution_ledger`, `20261023200000_competition_entries`, `20261104120000_agent_launch_funnel`). What remains is the check after each.

- 755 Inference network buyer endpoint. Run `packages/node-operator/scripts/e2e-local.mjs` and one real paid call.
- 765 Growth campaign attribution. `campaign_touches` and `campaign_conversions` are still empty. Open one tagged `/forge` URL and confirm the row with `scripts/campaign-report.mjs`.
- 923 Builder competition. The owner supplies the competition parameters, and prize payouts need spend approval.
- 949 Launch funnel default coin path. Rerun the appendix queries and do a browser check of the Next step card.

### F. Publishing, listings, store submissions and outreach

- 177 NVIDIA catalog reply readiness. Rename the Inception record and send the reply.
- 343 Blender 360 extension. Upload it to Blender Extensions.
- 344 Premiere UXP panel. Submit it to Adobe Exchange.
- 345 Agent surfaces. Run `npm publish` for `@three-ws/cli`, refresh the MCP registry listing, and set the worker env vars so the tools stop answering `unconfigured`.
- 346 360 landing page and tutorial. Post the launch drafts. `docs/marketing/insta360-launch.md` still holds four `[RESULT: ...]` markers that need real numbers from order 347. Also fix the Live badges above.
- 530 MCP registry cleanup. Run the deprecate commands.
- 709 Marketplace bundle storefront. Publish one real bundle, then confirm the Bundles section on that agent's page.
- 762 Editor and workflow packages (Zed, Raycast, Gradio, Poe, n8n). Submit the listings, tracked by 938. Poe also needs a public deploy of `forge_bot.py`.
- 865 Omniverse Kit extension. Submit it to the Omniverse Exchange and add the GitHub topic.
- 919 Parity ship and publish. Run the npm publish.
- 921 Parity directory listings. The external submissions.
- 934 Orphaned avatar campaign. Post the outreach posts.
- 935 Engine store publishing. Submit to the asset stores.
- 936 3D vendor reply and house key. Send the reply.
- 938 Listings, PRs and sends. HACS waits on the GitHub billing lock.
- 939 Program applications. Submit them.
- 946 LiveKit and Pipecat avatar. Publish to PyPI and open the upstream PRs.
- 961 Desktop agent runtime. Get the code-signing certificates.
- 979 Mobile Seeker widget release. Publish the APK.
- 981 NVIDIA NGC TRELLIS image validation. The NGC legal step, then push the image.
- 982 Glasses native wearables lane. The Meta developer preview, plus a Mac build.
- 911, 913 and 914: the partner exchange Forge relisting, end-to-end payment test, and final audit. All three need the owner's partner-console login and the small test spends.

### G. Owner decisions and licences

- 721 Forge UltraTex texture rung. Either buy a commercial licence for the FLUX base and set `ULTRATEX_BASE_MODEL_LICENSE_ACK`, or approve training on the FLUX.2-klein base. The rung stays off until then.
- 933 SAM 3D Objects. Accept the SAM licence, stage the gated weights, then deploy the worker.
- 924 Pricing levers. Pick the tiers and bonus values. The levers are config-only and default to current behavior.
- 932 Pricing preview and pay-to-keep. Set the price points and decide whether pay-to-keep ships.
- 922 Why three.ws. Name the platforms to compare against. The category comparison that is live is complete on its own.
- 764 Solana agent SDK typed errors and tests. Approve the commit-gated adapter conversion (see defect 9). An agent then redoes it.

### H. GCP billing hold (Vertex and the LLM chain return "pay your outstanding balance")

- 731 Diorama microgame win rules. Then do one live compose-to-win check. Production compose returned 503 `composer_unavailable`.
- 736 Avatar unseen-head texture synthesis. Then run the texture eval set. The flag `RECON_VIEW_SYNTHESIS` stays off until then.
- 741 Play world moderation. Then run `npm run i18n:translate` for the 13 moderation keys.

### I. Owner checks, hardware and third-party inputs

- 271 World health retired state. Drop the `world.three.ws` CNAME.
- 336 Insv stitch stage. Needs real third-party footage: a raw `.insp` photo, plus X4, X6 and ONE X2 samples. The parsers exist but are unverified on real files.
- 706 Bounties and Build program. Insert the first `program_rounds` row. `/build` shows its designed "no round open" state until then.
- 722 Payments accounting export. The admin opens `/api/admin/accounting-export?from=2026-10-01&to=2026-10-31&format=csv` and sees the 200.
- 739 Glasses lens app. The on-lens check needs the physical display glasses.
- 748 Seed vision gate cron. Confirmed 2026-11-27: 101 `forge_seed_jobs` rows carry a `judged` vision verdict, the latest on 2026-11-26. 23 of them were accepted (23%, below the 30% the order expected). The owner decides whether that rate is acceptable.
- 965 Revenue ledger and reinvest.
  - Confirm the scheduler tick fires the two new crons.
  - Create the first live reinvest rule (spend gate).
  - Correct the stale commit SHA.

## PARTIAL (44): what is missing

### Forge hardening

- 110 Lane failover and breakers.
  - No failover truth table anywhere in the repo.
  - No failover tests for these rows:
    - invalid-model result
    - accepted then never finishes
    - cold start over allowance
    - service unreachable
  - Task 6 (a specific counted error when every lane fails) is only partly done.
- 112 Limits and daily caps.
  - No test that Forge keeps working when the rate-limit store is down (task 5).
  - No limiter inventory (task 1) and no limit-size report against one GPU (task 7).
- 113 Error copy taxonomy (contradicts its status).
  - Add the four missing codes; the guard test then passes.
  - The server still puts raw provider text in `message` for `generation_failed`, `rig_failed`, `invalid_key` and `insufficient_credits`.
- 114 NVIDIA FLUX rung and NVIDIA text lane.
  - No browser walk of `pages/forge-nim.html` and `pages/nim-forge.html`.
  - `docs/nvidia-models.md:96` still names the old FLUX.1-dev rung.
- 123 Background removal photo prep. The doc and the verify script landed in `541f35ec3` and `4703b3690`. Still missing:
  - the four-photo walkthrough report with timings
  - a changelog entry for the removal fixes
- 124 Quality gate and retry.
  - The retry stage (`api/_lib/forge-quality-stage.js`, `bd7229f61`) and the fail-open gate (`0771a80c9`) are committed, but the stage is not called by the API yet.
  - Still missing: wiring it into the pipeline, the changelog and the docs.
- 125 Cache correctness.
  - `api/_lib/forge-cache-guard.js` and `forge-request-identity.js` are committed (`2983fc709`), but no cache imports them yet.
  - Still missing:
    - wiring them into the handlers
    - proof under a store outage and under a stampede
    - the changelog and the docs
- 126 Progress and wait experience.
  - The UI work is committed in `b64a0effb`: estimates from measured lane timings, an indeterminate bar, and job state in the tab title.
  - Still missing:
    - the second-by-second live run record (before and after)
    - the Step 0 output
    - a changelog entry
    - doc updates
- 144 My creations management. Untouched beyond earlier work:
  - a UI walk of the creations view
  - an undo and confirmation audit
  - truthful failed and in-progress rows with retry
  - lazy thumbnails and paging performance
  - claiming of anonymous models
  - a changelog entry
- 166 Search presence and product name.
  - The `/forge` JSON-LD is a plain `WebPage`, not a `SoftwareApplication`, and no test pins its shape.
  - The name test is red for 5 locales.
  - No report of hits on the old name.
  - No sitemap, canonical, robots or social-image checks.
  - The title and H1 rename is live; `93be25f0d` and the docs are not.
- 170 Stats and health truth.
  - No definitions of ok, degraded and down with reasons, and no test for them.
  - The generic provider label still needs the lane-id fix.
  - Configured-but-idle lanes are not reported honestly.
  - The freshness, cache and DB-error states are missing.
  - The contract-pinning tests are missing.
- 173 Background completion. Missing:
  - per-lane tests for completions nobody is watching
  - a user-poll versus cron race test
  - a per-lane maximum from measured numbers
  - completion parity: thumbnail, stats, gate and notify
  - a cross-device return check
- 176 Documentation truth.
  - No ledger of false claims.
  - The sign-in claim is uncorrected (`docs/forge.md:267`).
  - No executed examples, no link check and no dedupe.
  - No `npm run audit:docs` run for the Forge docs.
- 179 Prompt help and enhancement.
  - No rule-based built-in rewrite. Its first DoD line asks for one, instead of passing the prompt through unchanged.
  - `tests/api/forge-enhance-fallback.test.js` is absent.
  - No quality-rule tests on terse prompts.
- 185 Region-restricted engines.
  - `tests/api/forge-territory-coverage.test.js` is absent.
  - No test that fails when a restricted lane is added without a recorded decision.
  - The output-restriction claim is unsettled.
- 186 Duplicate submits and retries.
  - `tests/api/forge-idempotency-race.test.js` is absent.
  - No test for account-scoped idempotency keys.
  - No proof that a replay never spends the allowance twice.
  - `withForgeIdempotency` wraps only `api/forge.js`. The ChatGPT Forge, rig, batch, iterate and developer API paths are unwrapped.
- 942 TRELLIS.2 default lane. The 1024 OOM fix is in progress. Forge health reports `trellis2` unconfigured.
- 943 Pixal3D multi-view (contradicts its status). 5 of the 6 recorded jobs fail.

### Platform and plan orders

- 262 85-language picker and manifest (contradicts its status).
  - The i18n lint shows 1339 problems, and about 1141 keys are behind.
  - The production manifest lists 62 locales against 84 committed.
- 275 Console resweep. The sweep needs an idle host and has not been recorded.
- 702 Oracle and agent-trader MCP servers.
  - `audit:mcp-golden` fails on `export_openusd` drift, and the fixture has no oracle tools.
  - Both packages are unpublished.
- 733 Mobile core vitals. The fixes shipped, but the mobile budget is still not met.
- 744 LHM photoreal selfie lane.
  - Missing its STRUCTURE row and doc.
  - The rest is blocked on the licence.
- 754 Fact-check benchmark. No citation validity check and no trend UI. The 40-claim report is live.
- 756 Crypto venue x402 rail. The core rail module does not exist; only the surrounding pieces are there.
- 759 Memory temporal facts. No benchmark scores yet; run `scripts/memory-bench.mjs`.
- 761 Avatar identity morph fold. Near done; the pixel-error script is missing.
- 768 ASL word-level sign recognition.
  - No trained word-level model; the endpoints answer 503 until the weights exist.
  - The UI mode switch is not shipped.
- 789 UI lint policy tuning. `npm run lint:ui:core` was never run to verify it.
- 809 ONNX on-device photo prep.
  - A `MEASUREMENT_SECTION` placeholder is still in the doc.
  - Only 2 of the 10 photos are benchmarked.
  - The hardening commit `8cdfd8c5d` is not deployed.
- 837 winget CLI package. Nothing is released.

### NVIDIA program

- 857 NVIDIA translation lane. i18n parity still fails (`am` is 622 keys behind).
- 859 Cosmos Reason Forge judge.
  - No eval report.
  - Whether `COSMOS_REASON_URL` is set in production is unverified.
- 861 TensorRT worker. No result table and no doc. TRT is off by default (`TRT_MODE=off`).
- 862 Triton small-model serving.
  - No result table and no doc.
  - The forward share defaults to 0, and the deploy state is unverified.
- 863 Run:ai Model Streamer cold starts. No result table and no doc. The loader defaults to runai, with a fallback.
- 866 Digital human demo. The booth doc, the monitor cron and the service worker are missing.
- 867 Talking avatar clip export. No changelog entry.
- 868 NVIDIA Brev Launchable. No Brev doc.

### 360 capture campaign

- 337 pano2splat service (contradicts its commit message). Not deployed, and no verify run is recorded.
- 347 Integration and ship. The ship blockers are open and the audits are missing. Also see the empty `deploy/insta360/images.json` (group B).

### Other campaigns

- 907 Partner exchange chat bot always-on. Live healthz shows the bot down, likely because of the 2026-11-25 spend cut that set services to min 0. Confirm before restoring any floor, since restoring a floor needs the owner's yes.
- 918 Launchpad trading arena. "Backtest battle" and "Clone the champ" are missing.
- 977 Avatar LongCat GPU host. `weights.sha256` is missing and the quota request is pending. `LONGCAT_WORKER_URL` is unset, so `videoAvatarEnabled` is false.

## NOT-STARTED (74)

### Forge hardening (54)

- 127 Auth gating and sign-in
- 128 Generation controls honored
- 129 Paid tier quote and keep
- 130 Rig tool
- 131 Motion tool
- 132 Remesh and optimize tool
- 133 Stylize and materials tool
- 134 Segment and parts tool
- 135 Iterate and refine
- 136 Texture lanes
- 137 Game-ready export
- 138 Splat generation and viewer
- 139 Core export formats
- 140 Office and engine exports
- 141 Print pipeline
- 142 AR viewing
- 143 Share, embed and previews
- 145 Community gallery
- 146 Batch generation
- 147 Compare view
- 148 Reel and showcase
- 149 Workflows editor
- 150 Studio page parity
- 151 Home and alternate entry points
- 152 MCP 3D tools
- 153 Programmatic API
- 154 ChatGPT Forge parity
- 155 Teams and Copilot bot
- 156 NVIDIA NIM demo pages
- 157 Audio2Face facial animation fallback
- 158 Garment generation fit
- 159 Photo to scene objects
- 160 Page states and clean console
- 161 Accessibility
- 162 Mobile experience
- 163 Page speed
- 164 Viewer correctness
- 165 Translations and RTL
- 171 Daily smoke test coverage
- 172 Storage, thumbnails and retention
- 174 Notifications and webhooks
- 175 Forge test suite health. It would catch the two red files above.
- 178 Concurrency and queue honesty
- 180 Forge Off events
- 181 Desktop app and local generation
- 182 Background jobs must not starve users
- 183 Worker fleet truth
- 184 Undeployed fixes and deploy readiness
- 187 Operator reports

### Plan orders (2)

- 750 x402 batch settlement with durable vouchers.
- 751 Forge quality bench and fleet ceilings re-measure. Rescope before starting (see defect 8).

### NVIDIA design orders (10)

- 870 Self-hosted image engine
- 871 Self-hosted Audio2Face worker
- 872 Kimodo motion engine
- 873 Scene kit from one prompt
- 874 NemoClaw and OpenShell integration
- 875 Physics-validated SimReady
- 876 Voice agent blueprint face
- 877 NVIDIA contest and event watch
- 878 Multilingual talking avatar
- 879 Open SimReady prop dataset

### Realism orders (13)

- 887 Licence record and engine catalog
- 888 Skin SSS on WebGL2
- 889 Skin SSS on WebGPU
- 890 Skin micro-detail
- 891 Eye shading
- 892 Hair shading
- 893 MHR template GLB
- 894 `RECON_TEMPLATE=mhr` in reconstruction
- 895 SAM 3D Body worker
- 896 Identity shape fit
- 897 Skinned splat runtime
- 898 Splat scan to avatar
- 899 Integrate, measure, ship

## Owner steps that clear the most orders

1. **One production deploy (`npm run deploy:gcp:full`).** Puts 12 CODE-DONE Forge orders live (group A) and starts the clock on the PARTIAL Forge orders that wait on a deploy.
2. **Devnet SOL for the QA payer.** One human faucet claim, then the scripted proofs, clears 10 orders: 259, 605, 606, 622, 718, 770, 969, 973, 974, 978.
3. **Clear the GCP billing hold.** Clears 731, 736 and 741 and unblocks the translation runs behind 262 and 857.
4. **Rotate the production R2 credential.** Clears 338 and 713, and is half of 339.
5. **Record the image digests in `deploy/insta360/images.json`, then run `npm run ship:insta360`.** Clears 332, 339 and 341, and feeds the numbers that 337, 346 and 347 need.
6. **Run the follow-up checks for 755, 765, 923 and 949.** Their migrations are already applied (checked 2026-11-27).
