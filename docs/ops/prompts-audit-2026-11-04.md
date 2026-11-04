# Work-order audit: prompts/finish, 2026-11-04

Audit of all 175 work orders in `prompts/finish/` against the codebase (HEAD `ba2e95998`, production `three-ws-api` revision 00524 serving `0a913e8a7`). Read-only: eight agents checked each order's definition of done against files, routes, tests, changelog, git history and public production endpoints. Status text inside the orders was not trusted. Orders 924 and 925 were checked more lightly (the audit agent skipped them; the owner-gate text and library presence were verified by hand).

| Status | Count |
|---|---|
| COMPLETE (safe to delete the order) | 7 |
| SHIPPED-PENDING-OWNER (built; only an owner action remains) | 58 |
| PARTIAL | 27 |
| NOT-STARTED | 83 |

## COMPLETE (7)

| Order | Evidence |
|---|---|
| 273 forge image-lane licence and model currency | Resolver in place, orphan endpoints deleted, scan copy fixed (5810e7721), test passes. |
| 549 hookforge catalog | 22a5a1f49; `gen-hookforge-catalog.mjs --check` passes, 39 hooks = 39 doc rows. |
| 610 hire-escrow evaluator and disputes | Machine, ledger, evaluation, sweep cron, docs; labor tests pass. |
| 614 orders engine with ratcheting exits | 592273a4e; `exit-ratchet` test passes. No docker-build evidence; `workers/agent-orders/cloudbuild.verify.yaml` has an uncommitted edit. |
| 627 launch-fee and holder-reward features | cb1743ee0; fee-config endpoint, validation, docs, test. |
| 727 play chat scrollback and community bridge | 21196cae9, 71573c802, 354e46272; 35 tests pass, docs and changelog present. |
| 926 owner X API tier | Moot: mentions probe returned 200 with read-write access on current credentials. |

## SHIPPED-PENDING-OWNER (58)

Everything buildable is done; the named owner step remains.

- **Deploy needed (code on main, not live):** 024, 251, 252, 261, 265, 268, 271, 281, 726, 735 (also needs changelog and docs), 748 (then `SEED_VISION_PHASE=1`), 965, 986 (also Partner Center, Entra apps, `MS_*` env, store submissions), 958 (then review held distributions and set `CREATOR_PAYOUTS_LIVE`), 626 (`/v1/models` returned HTML), 742 (no `agent-screen-pool` service, secret not attached).
- **Env, key or credential:** 282 (`THREE_TREASURY_WALLET`, `PAYMENT_RECIPIENT_SOLANA`), 283 (Cloud Build, `GCP_VIDEO2SCENE_URL`, L4 quota), 954 (Google OAuth client), 927 and 941 (xAI key), 936 (Tripo reply and `TRIPO_API_KEY`), 961 (Apple and Windows signing), 962 (throwaway Telegram bot token), 920 (`COMMUNITY_SKILL_SOURCES`), 548 (`ROBINHOOD_FEED_URL`, paid `RH_RPC_URL`), 512 (mainnet curve config), 506 (production migration and service deploy), 530 (`publish-mcp-servers.mjs` publish then `--deprecate --apply`).
- **Funding or on-chain proof:** 902 (sponsor wallet, about 1.48 SOL), 605, 606 and 622 (devnet proofs blocked by closed faucets), 913 (buyer wallet funding, real payment gauntlet).
- **Session, approval or submission:** 907 (one real inbound OKX buyer message), 911 and 914 (`onchainos` login), 917 and 918 (arm Risk Officer, refill sniper capital, program decisions), 919 (`npm publish`), 921, 929, 931, 935, 938, 939, 946 (listings, PRs, store and PyPI submissions), 922 (competitor-name approval under the commit gate), 923 (apply migration, parameters, prize approval), 924 (pricing and `THREE_CREDIT_BONUS_BPS` yes or no), 925 (dry-run tick evidence, then `X_MENTION_BOT_LIVE=1`), 932 (prices and `FORGE_PAY_TO_KEEP`), 933 (SAM License, weights, `MODEL_SAM3D_URL`), 934 (wording and `noindex`), 937 (sponsorship decisions), 940 (`--apply`), 764 (commit approval for the agenc error conversion, which names another crypto project).
- **Verification only the owner can supply:** 540 (one real mainnet multi-part signature), 545 (500-node 60fps on a real GPU).

## PARTIAL (27)

| Order | Done | Missing |
|---|---|---|
| 256 meetup3 client UX audit | Fixes and audit script | Mobile harness numbers, keyboard and zoom pass, locale renders, signed-in sweep |
| 258 unified MCP endpoint | Endpoint, registry, page, tests | `public/tools.json` stale (371 vs 375 tools): run `npm run build:mcp-catalog`; 2 tests fail on it; publish |
| 259 wallet self-custody routes | Routes, export, cron, tools, tests | Devnet proof run; `/api/tx/submit` 404 in prod |
| 262 i18n language picker | Task 1 of 8 | 84 locales behind `en.json`; manifest lists only `en` |
| 266 MCP external integrations | Code, page, docs, lifecycle test | Five-state browser pass, live end-to-end proof |
| 275 console resweep | Baseline and README | November resweep report |
| 279 IBM Granite Guardian lane | Health subsystem, cloudbuild fix, docs | GPU build and `GRANITE_GUARDIAN_URL` (endpoint returns 503) |
| 401 restore green vitest | Down from 52 files and 108 tests failing | 15 files still red: agent-screen-caster, chat-proxy-ratelimit, mcp-agent-catalog, mcp-agent-challenge, asset-host-liveness, audit-guards, dismiss-button-tooltips, docs-search, mcp-unified-endpoint, open-source-credits, publishable-package-deps, solana-8004, world-pa, x-content-queue-health, x-content |
| 701 sandbox tools runner | Sandbox libs, tools, 7 test files | `workers/sandbox-runner`, `/settings/sandbox`, docs |
| 703 tool gateway | `api/_lib/tool-gateway/*` | Tests, routes, MCP tools, docs (nothing references the libs) |
| 705 agent evals CLI | `api/_lib/evals/*`, two suites | Runner, CLI, routes, Evaluate tab, docs |
| 706 bounties build program | Source modules, store | Feed tests, cron, routes, pages, tools, docs |
| 725 python OSV residual bumps | Pillow pins, anigen and partcrafter bumps | rembg, other workers' transformers and diffusers, `basicsr`; 194 advisories vs target below 84 |
| 735 hire-agent blink | Endpoint, cron, tests, migration | Changelog, docs, deploy (listed above under owner too) |
| 738 site demo defaults and hygiene | Default stage avatar, pose spec, `is_test` exclusion | `animations-live-preview.js` still loads `cz.glb`, rankings exclusion, UI fixes, empty states, changelog |
| 749 x-content queue validator errors | Work in progress, uncommitted in the working tree | Commit; queue still holds review, approved and draft items |
| 786 Android Automotive flavor | Flavor, overlay, overlay test | Compile and emulator evidence, doc updates |
| 789 UI lint policy tuning | Script, tests, tuned policy | `docs/ui-lint.md` update, `lint:ui:core` exit-0 evidence |
| 928 mention bot go-live | Bot live in dry run | Go-live packet; `X_MENTION_BOT_LIVE` unset |
| 930 launch announcement | Draft story | Thread and site article (wait on 928) |
| 942 TRELLIS.2 default lane | Worker, registry default, docs | `MODEL_TRELLIS2_URL`, real generation, Hunyuan decision |
| 943 Pixal3D multi-view | Worker deployed, URL set, API, UI | Real 3-image generation record |
| 944 non-humanoid rigging | Workers deployed | `RIG_NONHUMAN_URL`, `MODEL_ANIGEN_URL`, real quadruped rig |
| 945 editable parts | PartCrafter and HoloPart code | No Cloud Run services, `MODEL_PARTCRAFTER_URL` unset |
| 947 GPU worker images redeploy | `check:worker-drift` built | hunyuan3d, rembg, triposr, garment-forge, avatar-reconstruction, asl, video2motion, agent-sniper still drifted |
| 949 launch funnel default coin path | Tests, events, report route, migration applied | Not in prod (`/funnel-report` 404), baseline re-run, browser check |
| 957 Uniswap lane and launch status | Lane config, API, docs, Solidity tests | No Uniswap launcher deploy script |

Orders 942 to 945 and 947 may have moved since the audit: concurrent sessions deployed workers on 2026-11-04.

## NOT-STARTED (83)

None of the deliverables each order names exist.

- 700, 702, 704, 707, 708, 709
- 710, 711, 712, 713, 714, 715, 716, 718, 719, 720, 721, 722, 723, 724, 728, 730, 731, 732
- 733, 734, 736, 737, 739, 740, 741, 743, 744, 745, 746, 747, 750, 751, 754
- 755, 756, 757, 758, 759, 760, 761, 762, 763, 765, 766, 767, 768, 770, 771, 772, 773, 774, 775
- 777, 778, 779, 781, 782, 783, 784
- 966, 968, 969, 970, 971, 972, 973, 974, 975, 976, 977, 978, 979, 980, 981, 982, 983, 984

Orders 969, 973, 974, 975, 976 and 977 have pre-existing baseline code (program source, libs, migrations, read-only routes) but none of their own deliverables.

## Housekeeping findings

- Seven orders are safe to delete per the README convention (finished orders are deleted): the COMPLETE list above.
- `prompts/README.md` and `prompts/RUN-ORDER.md` carry counts and measurements from 2026-10-25 and 2026-11-03 (for example "82 open orders" and the P0 healthz table) and are stale.
- Not verified by the audit: Playwright and other browser checks, any `gcloud` write, any real spend. Each order's Step 0 should still be re-run before acting on it.
