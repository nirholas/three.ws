# Re-measure mobile performance on the worst pages and cut LCP, blocking time and layout shift to budget

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/733-plan-web-mobile-core-vitals-remeasure-and-fix.md`.

**Priority:** P2, new capability with clear value (score 52 of 100 inside the tier). **Area:** web. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

## Operating clause (binding)

- Read `CLAUDE.md` at the repo root before anything else. It overrides this file wherever they disagree.
- Finish 100% in this session. Do not end the turn with a question, an option list, a plan, or "let me know". Make reasonable judgment calls, act on them, and note each in one line in the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: signing or sending a transaction, spending or moving funds, paying an x402 endpoint, minting or launching a coin; `git push`, production deploys, publishing or posting externally; committing content that references a crypto project other than $THREE; destroying data that cannot be regenerated. Do every other part of the work around a gate, and batch every such ask into one message at the end.
- Enterprise grade, no shortcuts. No mocks, no fake data, no placeholders, no sample arrays, no fake loading or progress, no unfinished-work markers, no stub functions, no commented-out code. Real APIs, real endpoints, real data. Errors are handled at the boundaries (network, user input) with a real recovery path.
- Bug fixes are test-first: write the test that reproduces the bug, watch it fail for the reported reason, fix the code, watch it pass, and commit the test with the fix.
- UI work meets the bar a senior design review would pass: hover, focus and active states on every interactive element, designed empty, error and loading (skeleton) states, keyboard accessible, works at phone width, and verified in a real browser.
- Solana is the home chain and leads every design. Robinhood means Robinhood Crypto only. $THREE (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) is the only promoted coin; tests and fixtures use it or a clearly synthetic placeholder, never a real third-party mint.
- Never write the em-dash or en-dash characters anywhere (code, docs, UI copy, commit messages). Use a period, comma, colon, parentheses, or a plain hyphen.
- Before writing any non-trivial feature or UI, load `.claude/skills/engineering-standards/SKILL.md`. Before claiming done, load `.claude/skills/changelog-and-docs/SKILL.md`.

## Running alongside other sessions

Many sessions may be working in this same worktree at once. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Start dev servers on a free port (`npx vite --port <free port> --strictPort`), not the default 3000, so you do not collide with another session.

## Why this matters

The only baseline (2026-07-29, Pixel 5, slow 4G, 4x CPU) shows mobile pages in bad shape: `/play` LCP 37.7s and TBT 45.9s, `/marketplace` LCP 30.4s with CLS 0.42, `/` LCP 27.4s with TBT 34.5s, an agent profile CLS 0.954, `/coin/<THREE>` CLS 0.536, `/forge` TBT 56s. Most traffic is mobile. The baseline is three months old and many perf fixes have shipped since, so the first task is to re-measure; the order then fixes what is still over budget.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Tooling exists: `scripts/mobile-perf.mjs` (Playwright PerformanceObserver metrics, not Lighthouse), `scripts/glb-mobile-payload.mjs` (GLB payload audit), `tests/hdri-mobile-tier.test.js` (HDRI tiering already shipped).
- Baseline file `prompts/quality-bar/_generated/08/baseline.md` lists 12 or more pages with transfer, requests and GL context counts (home creates 3 GL contexts, 2 live).
- No fresh measurement since 2026-07-29 is recorded.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
sed -n 1,40p scripts/mobile-perf.mjs
node scripts/mobile-perf.mjs --help 2>&1 | head -20
node scripts/mobile-perf.mjs 2>&1 | tail -30   # against https://three.ws; write the table to docs/audit/
node scripts/glb-mobile-payload.mjs 2>&1 | tail -20
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Re-run the measurement against production and save `docs/audit/mobile-perf-2026-11-03.md` in the same table format. Budgets: LCP under 4000 ms, CLS under 0.1, TBT* under 600 ms on the listed pages.
2. For each page over budget, profile with Playwright traces, find the dominant cause (GLB payload, second/third GL context, unsplit bundle, font swap, image without dimensions, late-injected banner), and fix at the root: lazy-load the 3D scene behind visibility/interaction on mobile, reuse a single renderer, reserve space for late content (explicit aspect-ratio/skeletons), defer non-critical scripts, compress or tier GLB/textures for mobile. No fake loading states.
3. Write regression tests where testable: CLS reservations and mobile-tier selection in `tests/*.test.js`; extend `scripts/mobile-perf.mjs` with a `--budget` mode that exits non-zero over budget.
4. Re-run and append before/after to the audit doc. Verify in a real mobile-emulated browser: no console errors, hover/focus states intact, skeleton and error states present.
5. Changelog entry; `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `node scripts/mobile-perf.mjs --budget` (after deploy, or against the local build) exits 0 on home, play, marketplace, agent profile, coin, forge.
- [ ] `docs/audit/mobile-perf-2026-11-03.md` shows before and after tables.
- [ ] New tests pass; `npm test` still green.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Swiftshader stalls the 3D world | Use the light-page harness in memory note "play-browser-verify-without-world"; measure non-GL pages normally. |
| Production only measurable after deploy | Measure the local `npm run build && npm run preview` for the after numbers and state it. |
| Lighthouse unavailable | Keep the PerformanceObserver approach; do not add Lighthouse as a dependency. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/733-plan-web-mobile-core-vitals-remeasure-and-fix.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `733-plan-web-mobile-core-vitals-remeasure-and-fix.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

Code and config the reviewer cited alongside these docs (read them in the repo; they are not copied here): `scripts/mobile-perf.mjs`, `scripts/glb-mobile-payload.mjs`, `tests/hdri-mobile-tier.test.js`.

### `prompts/quality-bar/_generated/08/baseline.md` (whole file)

~~~~markdown
# Mobile performance measurement - baseline

**These are Playwright-measured field-style metrics, not Lighthouse scores.** Lighthouse is not
installed in this workspace and may not be added as a dependency, so `scripts/mobile-perf.mjs`
measures the underlying web-vitals primitives directly in the page with `PerformanceObserver`
under emulated mobile hardware and network. `TBT*` is a long-task blocking-time proxy
(`sum(max(0, longtask.duration - 50))`), not Lighthouse's simulated TBT.

- Origin: https://three.ws
- Device: Pixel 5 (Playwright descriptor, Chromium)
- Network: slow 4G (1.6 Mbps down / 750 Kbps up / 150 ms RTT) via CDP `Network.emulateNetworkConditions`
- CPU: 4x throttling via CDP `Emulation.setCPUThrottlingRate`
- Runs per page: 3 (median reported), settle window 5000 ms after `load`
- Measured: 2026-07-29T05:33:36.902Z

Sorted worst LCP first.

| page | path | LCP ms | CLS | TBT* ms | FCP ms | DCL ms | load ms | transfer | reqs | GL made/live/visible | HTTP |
|---|---|---|---|---|---|---|---|---|---|---|---|
| play | `/play` | 37736 | 0.000 | 45855 | 4704 | 37621 | 44255 | 4772 KB | 84 | 3 / 1 / 1 | 200 |
| marketplace | `/marketplace` | 30432 | 0.420 | 28539 | 3760 | 11764 | 0 | 4669 KB | 126 | 1 / 0 / 0 | 200 |
| home | `/` | 27412 | 0.068 | 34540 | 2736 | 23427 | 0 | 2313 KB | 89 | 3 / 2 / 1 | 200 |
| agent profile | `/agents/d94d2a50-86fa-4d2e-b87b-580f7517aa4c` | 21792 | 0.954 | 25118 | 3012 | 10644 | 0 | 3859 KB | 164 | 2 / 2 / 2 | 200 |
| walk | `/walk` | 17488 | 0.010 | 37031 | 10180 | 15525 | 0 | 3699 KB | 87 | 1 / 1 / 1 | 200 |
| coin ($THREE) | `/coin/FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump` | 10316 | 0.536 | 43025 | 1796 | 2120 | 52465 | 1809 KB | 67 | 1 / 1 / 1 | 200 |
| dashboard | `/dashboard` | 6408 | 0.000 | 14222 | 4964 | 18073 | 0 | 1609 KB | 66 | 1 / 0 / 0 | 200 |
| forge | `/forge` | 4540 | 0.308 | 56126 | 4484 | 15850 | 65212 | 2286 KB | 82 | 2 / 1 / 1 | 200 |
| irl | `/irl` | 4464 | 0.001 | 11006 | 2284 | 6299 | 7958 | 1715 KB | 61 | 2 / 1 / 1 | 200 |
| news | `/news` | 3672 | 0.000 | 6470 | 3672 | 4475 | 4477 | 534 KB | 5 | 0 / 0 / 0 | 200 |
| docs start | `/docs/start-here` | 3652 | 0.000 | 3786 | 2388 | 2468 | 4299 | 551 KB | 20 | 1 / 0 / 0 | 200 |
| markets | `/markets` | 3220 | 0.529 | 17549 | 3220 | 4583 | 0 | 1778 KB | 68 | 0 / 0 / 0 | 200 |
| launches | `/launches` | 2820 | 0.081 | 28526 | 2820 | 3619 | 35249 | 2362 KB | 106 | 1 / 1 / 1 | 200 |
| ar | `/ar` | 1316 | 0.000 | 5842 | 1316 | 7008 | 7130 | 718 KB | 7 | 1 / 0 / 0 | 200 |
| changelog | `/changelog` | 1276 | 0.113 | 15833 | 1276 | 1319 | 0 | 1547 KB | 45 | 1 / 0 / 0 | 200 |

## Per-page detail

### play - `/play`

- LCP 37736 ms (element: `p.pi-body`)
- CLS 0.0000, TBT* 45855 ms over 18 long tasks (longest 19392 ms)
- transfer 4772 KB across 84 requests - Script 1935 KB, Image 1174 KB, Other 33 KB, Fetch 27 KB, Stylesheet 25 KB, Document 8 KB
- window `load` fired within the wait window: NO (long-lived requests still open)
- DOM nodes 811, img elements 7
- WebGL contexts: created 3, live 1, visible 1, lost -
  - 393x727 visible=true `kx-canvas`
- heaviest resources:
  - 774 KB `/assets/world-hud-CRVwJCC0.js` (Script)
  - 567 KB `/api/img?url=https%3A%2F%2Fipfs.io%2Fipfs%2Fbafybeihe22b5sxr3ihnxt7pregfieyteqvubqhik3j3y4bbx243xlqjw3q&seed=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump` (Image)
  - 327 KB `/assets/three-core-B6YxbEni.js` (Script)
  - 289 KB `/assets/three-addons-C_o9ZiOy.js` (Script)
  - 146 KB `/assets/play-CgDwUSls.js` (Script)

### marketplace - `/marketplace`

- LCP 30432 ms (element: `https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/thumb/836fad74-689e-44ba-9eeb-bbdd63f01820.png`)
- CLS 0.4196, TBT* 28539 ms over 45 long tasks (longest 5830 ms)
- transfer 4669 KB across 126 requests - Image 2215 KB, Script 1559 KB, Fetch 492 KB, Stylesheet 108 KB, Font 69 KB, Document 37 KB
- window `load` fired within the wait window: NO (long-lived requests still open)
- DOM nodes 6559, img elements 204
- WebGL contexts: created 1, live 0, visible 0, lost -
- heaviest resources:
  - 979 KB `/agent-3d/latest/agent-3d.js` (Script)
  - 448 KB `/locales/en.json` (Fetch)
  - 344 KB `https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/forge/e69a25bf85e8/e121501c-7224-4685-8238-50cd57a7c86d.png` (Image)
  - 253 KB `https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js` (Script)
  - 155 KB `https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/thumb/215905d7-f311-46d8-9036-2ee8cc7f5279.png` (Image)
- layout shifts:
  - 0.0684 at 3875 ms from `main#main-content`
  - 0.1727 at 11557 ms from `main#main-content`
  - 0.0155 at 14486 ms from `section#mkt-top-section`
  - 0.0478 at 21097 ms from `section#mkt-top-section`
  - 0.0488 at 28964 ms from `div#market-theme-picks`
  - 0.0114 at 30880 ms from `div`
  - 0.01 at 32571 ms from `main#main-content`
  - 0.0599 at 36728 ms from `div#tws-corner-stack`

### home - `/`

- LCP 27412 ms (element: `h1.hero-h`)
- CLS 0.0680, TBT* 34540 ms over 60 long tasks (longest 5836 ms)
- transfer 2313 KB across 89 requests - Script 1474 KB, Fetch 546 KB, Font 173 KB, Document 91 KB, Stylesheet 25 KB, Image 5 KB
- window `load` fired within the wait window: NO (long-lived requests still open)
- DOM nodes 2669, img elements 19
- WebGL contexts: created 3, live 2, visible 1, lost -
  - 351x340 visible=true `tws-viewer-canvas`
- heaviest resources:
  - 979 KB `/agent-3d/latest/agent-3d.js` (Script)
  - 448 KB `/locales/en.json` (Fetch)
  - 253 KB `https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js` (Script)
  - 91 KB `/` (Document)
  - 83 KB `/fonts/inter-latin-ext.woff2` (Font)
- layout shifts:
  - 0.01 at 47809 ms from `section`

### agent profile - `/agents/d94d2a50-86fa-4d2e-b87b-580f7517aa4c`

- LCP 21792 ms (element: `p#ad-desc.ad-hero-desc`)
- CLS 0.9538, TBT* 25118 ms over 36 long tasks (longest 9196 ms)
- transfer 3859 KB across 164 requests - Fetch 2033 KB, Script 1527 KB, Font 152 KB, Image 50 KB, Stylesheet 39 KB, Other 33 KB, Document 25 KB
- window `load` fired within the wait window: NO (long-lived requests still open)
- DOM nodes 2159, img elements 4
- WebGL contexts: created 2, live 2, visible 2, lost -
  - 238x278 visible=true `tws-viewer-canvas`
  - 90x90 visible=true `footer-bot-canvas`
- heaviest resources:
  - 1510 KB `https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/forge/9b86c6f92389/3c37961e-d733-42b6-9ca4-f0b0d574ed90.glb` (Fetch)
  - 448 KB `/locales/en.json` (Fetch)
  - 327 KB `/assets/three-core-B6YxbEni.js` (Script)
  - 289 KB `/assets/three-addons-C_o9ZiOy.js` (Script)
  - 145 KB `/assets/solana-wLzkomb4.js` (Script)
- layout shifts:
  - 0.01 at 11812 ms from `main`
  - 0.8405 at 15176 ms from `section`
  - 0.0505 at 22200 ms from `div#tws-corner-stack`
  - 0.0167 at 23223 ms from `div#tws-corner-stack`
- console errors: 2 (first: `Failed to load resource: the server responded with a status of 404 ()`)

### walk - `/walk`

- LCP 17488 ms (element: `p.wl-hero-sub`)
- CLS 0.0096, TBT* 37031 ms over 49 long tasks (longest 21126 ms)
- transfer 3699 KB across 87 requests - Fetch 2349 KB, Script 1034 KB, Font 173 KB, Stylesheet 77 KB, Image 62 KB, Other 33 KB, Document 22 KB
- window `load` fired within the wait window: NO (long-lived requests still open)
- DOM nodes 1143, img elements 7
- WebGL contexts: created 1, live 1, visible 1, lost -
  - 90x90 visible=true `footer-bot-canvas`
- heaviest resources:
  - 1402 KB `/hdri/outdoor.hdr` (Fetch)
  - 490 KB `/avatars/default.glb` (Fetch)
  - 448 KB `/locales/en.json` (Fetch)
  - 327 KB `/assets/three-core-B6YxbEni.js` (Script)
  - 289 KB `/assets/three-addons-C_o9ZiOy.js` (Script)
- layout shifts:
  - 0.0556 at 33503 ms from `div#tws-corner-stack`

### coin ($THREE) - `/coin/FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`

- LCP 10316 ms (element: `(unknown)`)
- CLS 0.5362, TBT* 43025 ms over 38 long tasks (longest 28339 ms)
- transfer 1809 KB across 67 requests - Script 1010 KB, Fetch 466 KB, Font 173 KB, Image 118 KB, Stylesheet 33 KB, Other 33 KB, Document 9 KB
- window `load` fired within the wait window: NO (long-lived requests still open)
- DOM nodes 1263, img elements 11
- WebGL contexts: created 1, live 1, visible 1, lost -
  - 90x90 visible=true `footer-bot-canvas`
- heaviest resources:
  - 448 KB `/locales/en.json` (Fetch)
  - 327 KB `/assets/three-core-B6YxbEni.js` (Script)
  - 289 KB `/assets/three-addons-C_o9ZiOy.js` (Script)
  - 145 KB `/assets/solana-wLzkomb4.js` (Script)
  - 83 KB `/fonts/inter-latin-ext.woff2` (Font)
- layout shifts:
  - 0.4462 at 5673 ms from `section#cv-chart`
  - 0.01 at 9680 ms from `main#cv-main`
  - 0.0705 at 15781 ms from `div#tws-corner-stack`

### dashboard - `/dashboard`

- LCP 6408 ms (element: `img`)
- CLS 0.0000, TBT* 14222 ms over 21 long tasks (longest 5187 ms)
- transfer 1609 KB across 66 requests - Script 1458 KB, Image 62 KB, Font 47 KB, Stylesheet 36 KB, Other 33 KB, Document 24 KB, Fetch 3 KB
- window `load` fired within the wait window: NO (long-lived requests still open)
- DOM nodes 226, img elements 2
- WebGL contexts: created 1, live 0, visible 0, lost -
  - 393x727 visible=true `avatar-canvas`
- heaviest resources:
  - 327 KB `/assets/three-core-B6YxbEni.js` (Script)
  - 289 KB `/assets/three-addons-C_o9ZiOy.js` (Script)
  - 253 KB `https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js` (Script)
  - 145 KB `/assets/solana-wLzkomb4.js` (Script)
  - 75 KB `/assets/http-BN82FX_8.js` (Script)

### forge - `/forge`

- LCP 4540 ms (element: `(unknown)`)
- CLS 0.3085, TBT* 56126 ms over 42 long tasks (longest 29969 ms)
- transfer 2286 KB across 82 requests - Script 1342 KB, Fetch 462 KB, Font 173 KB, Stylesheet 77 KB, Image 62 KB, Other 33 KB, Document 31 KB
- window `load` fired within the wait window: NO (long-lived requests still open)
- DOM nodes 1882, img elements 22
- WebGL contexts: created 2, live 1, visible 1, lost -
  - 90x90 visible=true `footer-bot-canvas`
- heaviest resources:
  - 448 KB `/locales/en.json` (Fetch)
  - 327 KB `/assets/three-core-B6YxbEni.js` (Script)
  - 289 KB `/assets/three-addons-C_o9ZiOy.js` (Script)
  - 253 KB `https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js` (Script)
  - 145 KB `/assets/solana-wLzkomb4.js` (Script)
- layout shifts:
  - 0.0689 at 15385 ms from `div#forge-quality`
  - 0.0356 at 15545 ms from `main`
  - 0.0519 at 16404 ms from `main`
  - 0.0425 at 24618 ms from `div#engine`
  - 0.01 at 26126 ms from `main`
  - 0.0979 at 32275 ms from `div#tws-corner-stack`

### irl - `/irl`

- LCP 4464 ms (element: `p#irl-subtitle.irl-subtitle`)
- CLS 0.0012, TBT* 11006 ms over 14 long tasks (longest 6148 ms)
- transfer 1715 KB across 61 requests - Script 507 KB, Font 69 KB, Document 35 KB, Fetch 1 KB, Stylesheet 1 KB
- window `load` fired within the wait window: yes
- DOM nodes 612, img elements 1
- WebGL contexts: created 2, live 1, visible 1, lost -
- heaviest resources:
  - 145 KB `/assets/solana-wLzkomb4.js` (Script)
  - 82 KB `/assets/irl-BVYQ2DZX.js` (Script)
  - 73 KB `/ingest/static/array.js` (Script)
  - 47 KB `/fonts/inter-latin.woff2` (Font)
  - 41 KB `/assets/colyseus-connect-DyQw5MR0.js` (Script)

### news - `/news`

- LCP 3672 ms (element: `p.post-summary`)
- CLS 0.0000, TBT* 6470 ms over 7 long tasks (longest 2516 ms)
- transfer 534 KB across 5 requests - Fetch 449 KB, Image 62 KB, Document 20 KB, Script 3 KB
- window `load` fired within the wait window: yes
- DOM nodes 1025, img elements 1
- WebGL contexts: created 0, live 0, visible 0, lost -
- heaviest resources:
  - 448 KB `/locales/en.json` (Fetch)
  - 62 KB `/three.svg` (Image)
  - 20 KB `/news` (Document)
  - 3 KB `/i18n.js` (Script)
  - 1 KB `/locales/manifest.json` (Fetch)

### docs start - `/docs/start-here`

- LCP 3652 ms (element: `p`)
- CLS 0.0000, TBT* 3786 ms over 14 long tasks (longest 1467 ms)
- transfer 551 KB across 20 requests - Script 313 KB, Font 90 KB, Stylesheet 65 KB, Image 62 KB, Document 12 KB, Fetch 10 KB
- window `load` fired within the wait window: yes
- DOM nodes 621, img elements 3
- WebGL contexts: created 1, live 0, visible 0, lost -
- heaviest resources:
  - 253 KB `https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js` (Script)
  - 62 KB `/three.svg` (Image)
  - 50 KB `/style.css` (Stylesheet)
  - 47 KB `/fonts/inter-latin.woff2` (Font)
  - 35 KB `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js` (Script)

### markets - `/markets`

- LCP 3220 ms (element: `p.cv-sub`)
- CLS 0.5286, TBT* 17549 ms over 42 long tasks (longest 3344 ms)
- transfer 1778 KB across 68 requests - Fetch 495 KB, Script 214 KB, Font 90 KB, Image 62 KB, Stylesheet 34 KB, Document 7 KB
- window `load` fired within the wait window: NO (long-lived requests still open)
- DOM nodes 3084, img elements 108
- WebGL contexts: created 0, live 0, visible 0, lost -
- heaviest resources:
  - 448 KB `/locales/en.json` (Fetch)
  - 73 KB `/ingest/static/array.js` (Script)
  - 62 KB `/three.svg` (Image)
  - 47 KB `/fonts/inter-latin.woff2` (Font)
  - 33 KB `/api/coin/markets?page=1&per_page=100` (Fetch)
- layout shifts:
  - 0.0181 at 7143 ms from `div`
  - 0.5228 at 7561 ms from `div`
  - 0.0174 at 14390 ms from `section`

### launches - `/launches`

- LCP 2820 ms (element: `p.lx-sub`)
- CLS 0.0809, TBT* 28526 ms over 35 long tasks (longest 14136 ms)
- transfer 2362 KB across 106 requests - Image 611 KB, Fetch 488 KB, Script 436 KB, Font 173 KB, Stylesheet 28 KB, Document 8 KB
- window `load` fired within the wait window: NO (long-lived requests still open)
- DOM nodes 2719, img elements 51
- WebGL contexts: created 1, live 1, visible 1, lost -
- heaviest resources:
  - 448 KB `/locales/en.json` (Fetch)
  - 145 KB `/assets/solana-wLzkomb4.js` (Script)
  - 100 KB `https://ipfs.io/ipfs/QmfNs7QrktxRJG2aV6rFhhDpEnWStqa7AYocjYH6oJ4swY` (Image)
  - 96 KB `https://ipfs.io/ipfs/QmWdMFQHbSHJSJPR6bdM5buSpCTiFtu7zpNVFTiVuQpeoQ` (Image)
  - 95 KB `https://ipfs.io/ipfs/QmcA2QYRp3ndPr8dFmLbXyS5NU99WfYFnyuReMV3y2inXj` (Image)
- layout shifts:
  - 0.01 at 12676 ms from `main`
  - 0.0505 at 16542 ms from `div#tws-corner-stack`
  - 0.0167 at 21592 ms from `div#tws-corner-stack`

### ar - `/ar`

- LCP 1316 ms (element: `p`)
- CLS 0.0000, TBT* 5842 ms over 17 long tasks (longest 4357 ms)
- transfer 718 KB across 7 requests - Fetch 449 KB, Script 257 KB, Document 11 KB
- window `load` fired within the wait window: yes
- DOM nodes 181, img elements 0
- WebGL contexts: created 1, live 0, visible 0, lost -
- heaviest resources:
  - 448 KB `/locales/en.json` (Fetch)
  - 244 KB `https://cdn.jsdelivr.net/npm/@google/model-viewer@3.5.0/dist/model-viewer.min.js` (Script)
  - 11 KB `/ar` (Document)
  - 7 KB `https://cdn.jsdelivr.net/npm/meshoptimizer@0.22.0/meshopt_decoder.js` (Script)
  - 3 KB `/model-viewer-meshopt.js` (Script)

### changelog - `/changelog`

- LCP 1276 ms (element: `p`)
- CLS 0.1132, TBT* 15833 ms over 24 long tasks (longest 12330 ms)
- transfer 1547 KB across 45 requests - Fetch 935 KB, Script 524 KB, Image 67 KB, Stylesheet 23 KB, Document 5 KB
- window `load` fired within the wait window: NO (long-lived requests still open)
- DOM nodes 13279, img elements 3
- WebGL contexts: created 1, live 0, visible 0, lost -
- heaviest resources:
  - 479 KB `/changelog.json` (Fetch)
  - 448 KB `/locales/en.json` (Fetch)
  - 253 KB `https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js` (Script)
  - 145 KB `/assets/solana-wLzkomb4.js` (Script)
  - 62 KB `/three.svg` (Image)
- layout shifts:
  - 0.0276 at 2835 ms from `main`
  - 0.0857 at 13452 ms from `div#tws-corner-stack`
~~~~

