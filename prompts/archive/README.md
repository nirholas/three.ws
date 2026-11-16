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
| 842 A2A for Copilot Studio and Foundry | `662d8e46d` | conformance and card tests pass; real Agent Framework client streamed a GLB and cancelled a task locally |
| 843 PnP community samples | `6062e3b43` and the pnp-samples commits | sample JSON 3/3, secret scan clean, `verify-live.mjs` 22/23 (the last needs a real key) |
| 844 IT admin deployment kit | `474878e38` | `tests/microsoft-admin-kit.test.js` passes; consent page in Playwright; PSScriptAnalyzer 1.25.0 0 findings |
| 845 OData usage feed | 845 commits | OData tests pass; CSDL valid; feed read with Basic auth on an isolated DB |
| 846 Teams activity feed | 846 commits | `tests/teams-activity.test.js` and `tests/teams-identity.test.js` pass |
| 847 Teams approvals | 847 commits | `tests/teams-approvals.test.js` 30/30; all card states validate against AC 1.5 |
