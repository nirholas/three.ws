# prompts/archive/

Finished work orders. Each file here was moved out of [../finish/](../finish/) after every line of
its definition of done was verified against the code (tests run, deliverables present, any live or
manual check evidenced). They are a read-only record of what shipped: never paste one into a chat
to run it, and never treat its "Current state" section as current.

Orders retired before 2026-11-06 were deleted instead of archived and remain readable only in git
history (`git log --diff-filter=D -- prompts/finish/`).

| Order | Shipped in | Verified (2026-11-06 unless dated) |
|---|---|---|
| 735 hire-agent Blink and actions.json discovery | `cb9c71287`, `dbbb45f42` | `tests/actions-hire.test.js` passes; `public/.well-known/solana/actions.json` rules, `vercel.json` route and sweep cron, share-hire button on the agent page, `docs/solana-actions.md`, changelog |
| 749 X content queue validator errors | `015de971b`, `90a2f5c02` and the 2026-11-04 queue refreshes | `npm run x:content -- check` exits 0, `check:announce` passes, both named test files pass, no item newly approved since 2026-11-03, `intel-globe` still paused |
| 779 ENS and DNS name-claim verification | `3eeee3faf` | `tests/agent-name-claims.test.js` passes (the order allows unit coverage for the live curl); `specs/ENS_AGENT_CLAIM.md` no longer says "does not yet verify" |
| 772 credibility files and crawlable locale heads | `bf9e1b38b` | 2026-11-16: `funding.json` parses and `/.well-known/funding-manifest-urls` returns 200 on production; `/?lang=ja` serves `<html lang="ja">`; `.zenodo.json` parses; `funding-manifest`, `locale-head` and `image-lane-credit` tests pass; README language line and changelog entry present |
| 778 standalone chain-package re-verify | `a22399c77` | 2026-11-16: `node scripts/verify-robinhood-repos.mjs` exits 0 (17 package rows built and tested, 2 RPC probes, 0 failing) |

Microsoft campaign orders below were archived on 2026-11-16 with every agent-side definition-of-done line verified; the steps that need the owner (push, deploy, Partner Center, Entra, store submissions, gallery PRs) are tracked in [../finish/_context/microsoft-OWNER-ACTIONS.md](../finish/_context/microsoft-OWNER-ACTIONS.md). Commit SHAs per order are in [microsoft-PROGRESS.md](../finish/_context/microsoft-PROGRESS.md).

| Order | Shipped in | Verified 2026-11-16 |
|---|---|---|
| 813 VS Code Copilot Chat tools | `942762176`, `2a9909f46`, `eb2b59a5d`, `b1b5cd419` | vscode-3d 0.3.0 suite passes except the live @threews /forge call, which fails only on the production free-lane outage (r2.dev reference URL 404) whose fix `c3ec82891` is pushed and awaits deploy |
| 814 Semantic Kernel and Agent Framework | `0a670d97a`, `3b37f68c6`, `cb56fdcb9` | .NET 18/18; Python 17 pass, 1 skip, 1 live generation test fails on the same undeployed outage; Agent Framework samples, wheel and nupkg built |
| 806 Minecraft Bedrock export | `bfaa8f6f7`, `3f1094c01`, `331aab947`, `9c9c66912`, `cc0b01f64` | `tests/minecraft-export.test.js` passes; three sample .mcpack files list clean; POST /api/minecraft-export live (400 on empty body); docs, STRUCTURE, pages, changelog present |
| 807 Office files as agent knowledge | 807 commits (`8f3d5864d` to `3d70fab98`) | agent-knowledge API, chunker and chat suites pass; /api/agents/:id/knowledge live; docs, worker README, STRUCTURE, changelog present |
| 801 /microsoft partner hub | `60bf0fba8`, `e7d208609`, `072f53106` | production `/microsoft` 200 with no overflow or console errors at 1280 and 400 px; `tests/microsoft-hub.test.js` passes |
| 802 Forge to PowerPoint | `f56b7a70c` and siblings | production export-pptx 200 (2,008,205 bytes); office tests pass; add-in manifest valid |
| 803 Teams Live Share review | `9fc26fc7d` to `6d3311b0d`, `5cbf4f6f4` | `tests/microsoft-teams-stage*` pass; package check confirms meeting tab and Live Share permissions |
| 804 Teams Adaptive Card generation | `1f77a2fc4`, `72af30501` | `tests/teams-forge.test.js` passes; live e2e produced a valid AC 1.5 card |
| 805 Windows and Edge native app | `21e1d7c2d`, `e7537366d` | live `package:microsoft-store --check` passes (23 URLs, 0 warnings); PWA tests pass |
| 816 M365 Copilot connector | `a866d6bc5`, `658760381`, `0108c1ce9` | `tests/m365-connector.test.js` passes; production settings and docs 200, status 401 signed out |
| 817 Power Platform certification and templates | `8af4a7341`, `de4a5051c` | `package:power-platform-connector --check` passes (5 operations, 5 templates) |
| 818 Phi brain lane | `ea5df33ab` and the 818 entries | `tests/phi-lane.test.js` passes; GCP L4 run and 91-task evaluation recorded |
| 819 Florence-2 captions and alt text | 819 entries | creation-describe tests pass; production model page serves a Florence-2 caption |
| 820 TRELLIS.2 lab | 820 entries | lab and benchmark tests pass; production `/lab/trellis2` 200 |
| 821 partnership ops dashboard | `aafe8b5b3`, `49f48f142` | 35 tests pass; `npm run microsoft:dashboard-check` 6/6 on an isolated DB with the browser page |
| 822 Marketplace leads | `f0f0985ac`, `98d3aebcb` | leads tests pass; production 401 without token |
| 823 Bing and Copilot search | `e58e6a2b1`, `dd2b311d2` | sitemap and SEO tests pass; production sitemap, robots, IndexNow key 200 |
| 824 listing media kit | `801d4d88b`, `539f02262` | 23 images match the manifest; video 200 with matching sha256 |
| 826 SaaS emulator e2e | `0851176ba` | `npm run microsoft:saas-e2e` PASS 23/23 |
| 827 one-command Azure provisioning | `91c978f5d`, `5cd199afc` | `tests/microsoft-provision.test.js` 34/34; `--plan` prints 27 to create |
| 828 billing self-service | `b42521386`, `cec549549` | 144 tests pass; billing live check plus browser at 1280 and 400 px |
| 829 SaaS free trial | `fdeb8fef3`, `10d5fbc1a`, stale-shadow fix | trial live check (reminder sent once); banner served in dev after removing the stale `public/notifications.js` (`tests/vite-dev-rewrite-shadows.test.js`) |
| 830 /enterprise procurement page | `43c762cac`, `293a2a853` | `tests/enterprise.test.js` passes; browser at 1280 and 400 px; leads filed on an isolated DB |
| 831 Copilot declarative agent | `e1118645e`, `c3ec82891` | `package:microsoft-app --check` passes; 3 production starters pass, forge starters wait on deploy |
| 832 Outlook and Microsoft 365 hosts | 832 commits, `12dc1cd65` | Teams suites 261 tests pass; tab host check renders standalone, simulated Outlook and Teams high contrast with no console errors |
| 833 Teams Store validation preflight | `12dc1cd65`, `14a05e1e5` | `tests/microsoft-store-rules.test.js` 25/25; `--check --store --offline` 0 failures; `atk validate` passes |
| 834 Teams bot Responsible AI | `bbe47936e`, `a38b16e84` | Responsible AI suites pass; live check wrote feedback and report rows on an isolated DB |
| 835 SharePoint web part | `7075f49ae`, `704446f67`, `10771e967` | package validates 53/53; `tests/agents-public-read-cors.test.js` 3/3; guide, listing, STRUCTURE, changelog, pages rows |
| 836 OneDrive file picker | `22630f29b`, `31ea71bda` | `tests/onedrive-core.test.js` 33/33; Forge verifier passes disabled and enabled (reaches Microsoft sign-in) at 400 px, no console errors; docs and changelog |
| 838 Share to Teams and LinkedIn | `7e0da777b`, `3eee5d850` | share tests pass; Teams and LinkedIn targets exercised in a browser; `docs/sharing.md`, changelog |
| 839 Microsoft 365 Certification evidence | `4ff1a7cc1`, `985ea3cea` | ten policies and risk register R1 to R10; 70-row control matrix; `tests/m365-evidence.test.js` passes; evidence collector secret scan clean |
| 840 Defender for Cloud Apps catalog | `d8a87bf47`, `5acc9b76b` | catalog matrix and owner pack re-verified |
| 841 Entra app gallery | `64116d19c` | `tests/scim-entra-conformance.test.js` passes; `/sso/microsoft` launch traced locally; submission pack complete |
| 842 A2A for Copilot Studio and Foundry | `662d8e46d` | conformance and card tests pass; real Agent Framework client streamed a GLB and cancelled a task locally |
| 843 PnP community samples | `6062e3b43` and the pnp-samples commits | sample JSON 3/3, secret scan clean, `verify-live.mjs` 22/23 (the last needs a real key) |
| 844 IT admin deployment kit | `474878e38` | `tests/microsoft-admin-kit.test.js` passes; consent page in Playwright; PSScriptAnalyzer 1.25.0 0 findings |
| 845 OData usage feed | 845 commits | OData tests pass; CSDL valid; feed read with Basic auth on an isolated DB |
| 846 Teams activity feed | 846 commits | `tests/teams-activity.test.js` and `tests/teams-identity.test.js` pass |
| 847 Teams approvals | 847 commits | `tests/teams-approvals.test.js` 30/30; all card states validate against AC 1.5 |

Grok campaign orders below (`grok-startups-` 871 to 886, and the `x-grok-` owner orders 927 to 931 and 941) were archived on 2026-11-21 at the owner's instruction, with every agent-side definition-of-done line verified. The steps that need the owner (the xAI key and the disclosure that ships with it, the deploy, public plugin repositories, marketplace and directory submissions, the co-marketing email, X posts, player-card submission) are tracked in [../finish/_context/grok-OWNER-ACTIONS.md](../finish/_context/grok-OWNER-ACTIONS.md). Per-order evidence is in [grok-startups-PROGRESS.md](../finish/_context/grok-startups-PROGRESS.md) and [x-grok-PROGRESS.md](../finish/_context/x-grok-PROGRESS.md). Scoped suites were run for this archive; the full `npm test` was not.

| Order | Shipped in | Verified 2026-11-21 |
|---|---|---|
| 871 Cursor plugin marketplace-ready | `cbe4b45a5`, `be2a97e73`, `ebecc3483`, `ce1e67760`, `d11aac253` | `validate-cursor-plugin.mjs` 0 errors, 0 warnings; cursor-plugin validate, export, tool-surface and plugin suites pass |
| 872 Grok Build plugin | `182eccbb7`, `054e7be6a`, `0bd303e5c` | `tests/grok-build-plugin-copy.test.js` and `-tools.test.js` pass; Grok Build 1.0.45 install and `grok mcp doctor` recorded 2026-11-20 |
| 873 official Grok Bot marketplace package | `4ce69c2a0`, `048ba8874`, `e3e7d6cfe` | `tests/grok-connector-review-check.test.js` passes; production review check 10/10 recorded 2026-11-20 |
| 874 Grok Imagine reference-image lane | `f642f9c52`, `1a18446c2`, `d0f104eb6`, `fcc20516f` | `xai-image` and the three `forge-reference-image*` suites pass; no-key baseline committed in `docs/evals/grok-imagine-ref-image.md` |
| 875 Grok Imagine Video hero clips | `67fd74d28`, `10f55e76e`, `03abe41f2`, `9fe17b758` | `xai-video`, `glb-turntable-refs` and the three `hero-clip*` suites pass; six angle renders and UI state screenshots in `docs/img/hero-clips/`; `/docs/hero-clips` added to `data/pages.json` in `9fe17b758` |
| 876 Grok Voice realtime avatar | `5ce30d2b5`, `f2ec59253`, `a05b976d4`, `877620ae2`, `13d41fa2b` | the three `grok-voice*` suites pass; `/docs/voice-grok` in the page index |
| 877 examples pack | `7c53e0fc3`, `38bd97fa9`, `90b164be3`, `a8619ebe8` | `grok:examples-smoke` 6/6 recorded 2026-11-20 |
| 878 xAI credit usage ledger | `3d52de561`, `d7a1f28e5`, `9d6af8ca9` | `xai-usage`, `xai-pricing` and `xai-credit-health` suites pass; migration applied in production |
| 879 Grok eval and routing | `19e7be5ec`, `3fbe93419`, `393ce3cf4`, `662af1690` | `llm-route-override` and `llm-eval-graders` suites pass; Nemotron baseline report committed |
| 880 connector reliability probe | `7f900b409`, `de58ba434`, `b4c86c4d8` | `mcp-probe*` suites pass; production probe 20/20 recorded 2026-11-20; migration applied |
| 881 /grok hub | `95428f20d`, `08caeedd0` | `tests/grok-stats.test.js` passes; `pages/grok.html` claim and token grep empty |
| 882 co-marketing kit | `16d63f526` | kit and nine `draft` queue items committed |
| 883 rocket engine anatomy | `58bf8efe3`, `e8f265bb5`, `573bab188`, `b674e58b5` | `anatomy-featured` and `anatomy-narrate` suites pass (38 tests, every figure sourced); sources and review docs in `docs/anatomy/` |
| 884 Share on X and Ask @grok | `cae78aad1`, `ef98d1e47`, `258fe6e7a`, `75814aaef` | `x-intent` and `share-cards` suites pass after `75814aaef` removed the last hand-built intent (the share verifier) |
| 885 three.js craft plugin | `d97cbe857`, `fcc20516f`, `9fe17b758` | `node scripts/grok-craft-verify.mjs` exits 0: 12/12 JS blocks and 2/2 glTF Transform blocks; `grok:craft-verify` npm script added in `9fe17b758`; token grep empty |
| 886 grok-3d-starter | `268e6dc50`, `7db8595c2` | `satellites/grok-3d-starter` `npm test` 0 failures and `npm run check` all passed; token grep empty |
| 927 production xAI key | `d7f107201` | `npm run setup:xai-key` installer and its test shipped; no key exists yet (owner step 2) |
| 928 mention bot go-live | `5c4e37a5c` | status endpoint and health shipped; go-live is the owner's |
| 929 connector directory listings | `bf3028ddf` | `docs/partners/grok-bot-listings.md` committed; submissions are the owner's |
| 930 launch announcement | `bbce29792` | drafts queued in `data/x-content/queue.json`; posting is the owner's |
| 931 X player card | `bbce29792` | `docs/partners/x-player-card-submission.md`; production `/forge/embed` sends `frame-ancestors *` |
| 941 xAI remote MCP e2e | `150c5c4ec` | dry run matches the xAI remote MCP docs; the live run comes with the key (owner step 2) |
