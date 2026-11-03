# Close the open page-load costs on /forge, /marketplace and /discover (thumbnail bytes, composer CLS, marketplace hero weight, brand mark)

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/713-plan-perf-forge-marketplace-thumbs-cls.md`.

**Priority:** P2, new capability with clear value (score 58 of 100 inside the tier). **Area:** performance. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

`docs/site-performance.md` records the site's load numbers and lists items it measured and left open. `/marketplace` is the worst page on the site (Lighthouse desktop 38, 11,790 KiB transferred, 22.5 s of blocking time, measured 2026-09-04), `/forge` carries a CLS of about 0.23 from a composer that grows 95 px after first paint, and `/forge` and `/discover` still download full-size 768 px PNG thumbnails (about 520 KB each) into 200 to 293 px boxes. These are first-visit costs on the three highest-traffic creation and browse surfaces, so every new visitor pays them. The doc names the fix shape for each; none has been built.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Caching half of thumbnails shipped: `thumbnailUrl()` in `api/_lib/r2.js` returns same-origin `/cdn/<key>` URLs (tests `tests/thumbnail-url-guard.test.js`, `tests/r2-normalize-stored-url.test.js`). Sizing half open: `api/_lib/forge-thumbs.js` still has `THUMB_SIZE = 768` and writes PNG at `forge/thumb/<id>.png` via `forgeThumbKeyFor()`.
- `src/home-live-agents.js` has `HERO_GLB_BUDGET_BYTES = 2_500_000` (rule 7). `src/marketplace.js` has no equivalent: `renderHero()` consumes `state.featured` (set around line 919) with no size awareness, and it shows several avatars at once, so the budget must be shared.
- `/forge` coach half is fixed (`tests/forge-prompt-coach.test.js`). The engine pill half is open: `.engine-pill:empty { min-height: 50px }` in `pages/forge.html` (about line 631) is under-sized, and `buildEngineButtons()` in `src/forge.js` (line ~833) fills the pill only after the catalog loads.
- `public/three.svg` and `public/favicon.svg` are byte-identical 85,257-byte SVGs wrapping two 800x436 PNGs; 545 files reference them; the doc measured that an exact half-resolution re-encode (36,913 bytes) is visually identical at 22 and 64 px but diverges at 192 px.
- `/chat` and the other items in the doc are closed.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
grep -n "THUMB_SIZE\|toFormat\|webp\|png" api/_lib/forge-thumbs.js | head -20
grep -n "HERO_GLB_BUDGET\|size_bytes" src/marketplace.js | head
grep -n "engine-pill" pages/forge.html | head
ls -l public/three.svg public/favicon.svg
grep -rl '/three\.svg\|/favicon\.svg' pages/ public/ src/ | wc -l
ls tests | grep -E "forge-thumbs|forge-prompt-coach|thumbnail-url"
# baseline, one page at a time, desktop, idle machine (benchmarkIndex must be >= 800):
export CHROME_PATH="$HOME/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome"
for p in forge marketplace discover; do
  npx lighthouse https://three.ws/$p --preset=desktop --only-categories=performance --output=json \
    --output-path=/tmp/$p-before.json --chrome-flags="--headless=new --no-sandbox --disable-dev-shm-usage --disable-gpu" \
    --quiet --max-wait-for-load=90000
  node -e "const r=require('/tmp/$p-before.json');console.log('$p',r.categories.performance.score*100,r.audits['cumulative-layout-shift'].displayValue,r.audits['total-byte-weight'].displayValue,r.environment.benchmarkIndex)"
done
```

Keep `--disable-gpu`. Do not swap in SwiftShader (the doc explains why). Skip any task whose Step 0 result shows it already shipped.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. **Thumbnail sizing (test-first).** In `tests/forge-thumbs.test.js` add tests asserting the generator emits WebP at a display-appropriate size (decide the tier sizes from the real boxes: 200 px card height on `/forge`, 293 px on `/discover`; serve 2x, so a 512 px WebP max, plus a 256 px variant if both boxes can share one asset). Run, confirm they fail on the current 768 px PNG. Change `THUMB_SIZE`/encoding in `api/_lib/forge-thumbs.js`, update `forgeThumbKeyFor()` to the new extension, and keep reading the old `forge/thumb/<id>.png` keys and stored `preview_image_url` values (`normalizeStoredUrl()` in `api/_lib/r2.js` must map both). Extend `api/cron/forge-thumbnail-backfill.js` (and `api/cron/avatar-thumbnail-backfill.js` if `/discover` avatar thumbs share the problem) to regenerate existing rows idempotently in bounded batches, then run it to completion against production data via the cron endpoint and confirm the 2,358 KiB untouched-original outlier row is also converted. Never delete originals.
2. **Marketplace hero byte budget.** Apply rule 7 in `src/marketplace.js`: pick the hero set from `size_bytes` using one shared constant (lift `HERO_GLB_BUDGET_BYTES` into `src/shared/` and import it from both `src/home-live-agents.js` and `src/marketplace.js`), sharing the budget across the avatars shown together (total, not per model), smallest-first fallback when nothing fits. Extend `/api/avatars/featured` only if `size_bytes` is not already reported. Test in a new `tests/marketplace-hero-budget.test.js` (pure selection function exported from the module).
3. **Marketplace remaining weight.** Re-run the Lighthouse trace for `/marketplace`; for the top three transfer and TBT contributors that remain after tasks 1 and 2, fix them under the doc's rules (below-the-fold sections load below the fold, thumbnails sized per tier, no layout-property animation). Record before/after in the doc's table.
4. **`/forge` composer CLS.** Render the settled composer into the first frame: (a) the engine-pill lane set the server already knows about must be in `pages/forge.html` markup (generated at build time from the same catalog source `buildEngineButtons()` uses, with a test that reads both so the two copies cannot drift, like `tests/forge-prompt-gen.test.js`); (b) re-measure the settled heights at 320, 390, 480, 768, 900, 1024, 1200, 1440 px with a Playwright per-frame trace (the method in the doc) and require total composer growth after first paint to be under 8 px at every width. Do NOT use a fixed min-height constant or the rejected `flex: 1 0 100%` coach fix.
5. **Brand mark.** Audit every call site's rendered size. Keep `public/favicon.svg` byte-for-byte (it is used at 192 px and above). Replace the contents of `public/three.svg` with the exact-half-resolution re-encode (lanczos3, no palette quantization) ONLY if the audit shows no call site renders it above 64 CSS px; if any does, change those call sites to `favicon.svg` first. Verify visually at 22 and 64 px with before/after screenshots and a max channel delta under 10. Judgment call to state in the report: the owner flagged this as a brand decision, so the original raster stays preserved in the repo (`public/brand/three-full.svg`) and in git history.
6. **Verify.** Re-run the Step 0 Lighthouse loop on the same machine class; require `/forge` CLS below 0.05, `/discover` transferred bytes under 3,500 KiB, `/marketplace` transferred under 6,000 KiB and score at least 70 desktop. Real browser check (`npm run dev`, port 3000) of `/forge`, `/discover`, `/marketplace`: images crisp at 2x, no console errors, thumbnails served as `image/webp` with a long cache header via `/cdn/`.
7. **Docs.** Update `docs/site-performance.md`: move closed items out of the Open sections with the new measurements, add the new sweep row to "Where the numbers are". Changelog entry and `npm run build:pages` per the standard close-out.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `curl -sI https://three.ws/cdn/<a forge/thumb key from /api/explore>` (after deploy) shows `content-type: image/webp` and a byte length under 60 KB; locally the same via the dev server.
- [ ] `npx vitest run tests/forge-thumbs.test.js tests/marketplace-hero-budget.test.js tests/forge-prompt-coach.test.js tests/thumbnail-url-guard.test.js tests/r2-normalize-stored-url.test.js` passes, including the new tests that failed before the change.
- [ ] Per-frame Playwright trace of `/forge` at the eight widths reports composer growth under 8 px after first paint at each width.
- [ ] `ls -l public/three.svg` is under 40,000 bytes and `cmp public/favicon.svg <(git show HEAD:public/favicon.svg)` is identical.
- [ ] Lighthouse desktop (benchmarkIndex at least 800) records `/forge` CLS below 0.05 and `/marketplace` score at least 70, numbers pasted into `docs/site-performance.md`.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Lighthouse run aborts with PAGE_HUNG or low benchmarkIndex | Keep `--disable-gpu`; repeat on an idle machine or run on a Cloud Build/GCE worker; never record a reading under benchmarkIndex 800 |
| Backfill cron cannot be triggered locally | Call the cron handler through its `requireCron` auth using the pattern in `docs/ops/` or run the script form against the production DB env from `scripts/read-service-env.mjs`; it is idempotent and bounded |
| Unsure whether 512 px is enough | Measure the real box sizes on 1x and 2x in the browser and pick the smallest size that stays sharp at 2x |
| Brand mark looks different at a call site | Move that call site to `favicon.svg`; the original is preserved |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/713-plan-perf-forge-marketplace-thumbs-cls.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `713-plan-perf-forge-marketplace-thumbs-cls.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/site-performance.md` (section "How to measure")

~~~~markdown
## How to measure

Lighthouse CLI, one page at a time, performance category only:

```bash
export CHROME_PATH="$HOME/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome"
npx lighthouse https://three.ws/marketplace \
  --preset=desktop \
  --only-categories=performance \
  --output=json --output-path=./marketplace.json \
  --chrome-flags="--headless=new --no-sandbox --disable-dev-shm-usage --disable-gpu" \
  --quiet --max-wait-for-load=90000
```

Drop `--preset=desktop` for the mobile form factor, which is Lighthouse's default and applies a 4x CPU slowdown plus a throttled connection. The same page always scores far lower on mobile; compare a page against its own history, never against another page or another form factor.

Two things to know before reading a report:

- **The score is not the byte count.** Performance is weighted Total Blocking Time 30%, Largest Contentful Paint 25%, Cumulative Layout Shift 25%, First Contentful Paint 10%, Speed Index 10%. A page can ship 4 MB and score well if none of it blocks; a page can ship 900 KB and score badly if all of it runs at once.
- **Lighthouse 13 removed the audits everyone quotes.** `offscreen-images`, `uses-responsive-images`, `modern-image-formats` and `dom-size` are gone, replaced by the insight family: `image-delivery-insight`, `render-blocking-insight`, `cache-insight`, `legacy-javascript-insight`, `cls-culprits-insight`. A script that reads the old audit names throws on `undefined`.
- **Keep `--disable-gpu`. Do not "improve" it to software WebGL.** Swapping it for `--use-gl=angle --use-angle=swiftshader` looks more faithful, since the 3D pages then really run their renderers, and it does not survive contact with this site: in the 2026-08-15 sweep that flag set made `/` and `/marketplace` abort with `PAGE_HUNG`, `/play` report `NO_FCP`, and `/marketplace` still fail with `PROTOCOL_TIMEOUT` at a 90s `--max-wait-for-load` on a completely idle machine. The same pages complete in about two minutes each with `--disable-gpu`. Software rasterization of our own WebGL is slower than the throttling Lighthouse is trying to apply, so the run measures the rasterizer rather than the page.
- **Check `environment.benchmarkIndex` in every report before quoting its score.** A shared build machine swings it wildly: the 2026-08-15 sweep saw 108 on one `/create` run and 2,398 on a `/` run twenty minutes later, and the low reading inflates every CPU-bound metric in that report. A run under roughly 800 is worth repeating on an idle machine rather than recording.
~~~~

### `docs/site-performance.md` (section "Open: three costs the 2026-08-15 sweep measured and did not fix")

~~~~markdown
## Open: three costs the 2026-08-15 sweep measured and did not fix

Each of these is the largest remaining number on the page it belongs to, and each one lands in a surface the sweep that found it had no business rewriting. They are recorded here with the measurement so the next pass starts from a number rather than a hunch.

**`/chat` is one 4,277 KiB JavaScript chunk. Closed on 2026-09-04:** the page now transfers **747 KiB**, blocks for 2ms and scores 99 desktop. The measurement that follows is kept as the record of what it cost. The page made 23 requests and `chat/assets/index-*.js` was 4,277 KiB of them; nothing renders until it has parsed, which is the entire story of its FCP (3,901ms desktop, 23,105ms mobile) and of an LCP that lands 140ms later. Blocking time is *one millisecond*, so no amount of deferring helps: the work is a single parse of a single chunk. [chat/vite.config.js](../chat/vite.config.js) sets no `manualChunks` and no `inlineDynamicImports`; the app simply imports everything statically from its entry, so Vite has nothing to split on. The fix is dynamic imports at the route and feature boundaries inside `chat/src`, which is a refactor of the sub-app rather than a build-config change.

**`/forge` showcase thumbnails are full-size renders.** Twelve images (served from `pub-*.r2.dev` when measured, from the same-origin `/cdn/` proxy since 2026-10-24) account for **6,273 KiB of the page's 8,339 KiB**, averaging 520 KB each. They are the 768x768 PNGs that [api/\_lib/forge-thumbs.js](../api/_lib/forge-thumbs.js) generates (`THUMB_SIZE = 768`), painted into a 200px-tall box. `loading="lazy"` and `decoding="async"` are already set per rule 5, so this is not a scheduling problem, it is a format and size problem: the same renders as WebP at a display-appropriate size are roughly a tenth of the bytes. The fix has to change the generator, re-run the backfill cron over existing rows, and handle the `forge/thumb/<id>.png` key extension that `forgeThumbKeyFor()` and the stored `preview_image_url` values both encode. One outlier in the same trace is a data-freshness artifact rather than a bug: a 2,358 KiB `forge/<clientKey>/<id>.png` is the untouched original for a row the backfill has not reached yet.

**The brand mark is an 85 KB SVG rendered at 22 pixels.** `public/three.svg` and the byte-identical `public/favicon.svg` are 85,257-byte SVGs wrapping two 800x436 PNGs behind `feColorMatrix` filters. They are referenced from 545 files as of 2026-09-17 (446 of them HTML: `grep -rl '/three\.svg\|/favicon\.svg' pages/ public/ src/ | wc -l`, up from 171 when this item was first measured), cost 62 KiB over the wire per page, and no call site in the repo renders the mark above 64 CSS px. Re-encoding the embedded rasters at exactly half resolution (800 to 400, lanczos3, no palette quantization) takes the file to 36,913 bytes and is visually indistinguishable at every size the site uses, with a maximum channel delta of 4 at 22px and 10 at 64px. It is not free above that: at 192px, which some platforms use for an SVG favicon, the delta reaches 105. Fractional downscales are much worse than the exact half (320px wide measured a delta of 78 at 22px), so this is a brand-asset decision with a measured cost attached, not a mechanical resize, and it needs the owner rather than a sweep.

**`/marketplace`'s hero was the site's worst CLS, and is closed as of 2026-09-08.**
Not through the GLB budget guessed at below, which is still worth doing: through
the meta column. The hero rotates every 6.5s and `updateHeroMeta()` writes each
avatar's name and blurb into the same two boxes, which are different lengths for
every slide, so the actions row, the dots and the whole grid below moved on every
rotation, forever. Measured on a Pixel 5 against production, `section#market-hero`
was **0.1094 + 0.2045 of the page's 0.4381 CLS**. Both boxes are now clamped AND
floored to the same line count, so every slide occupies identical space; the
"Start an agent" button ships in the markup at its final label instead of being
revealed into a `flex-wrap` row after first paint. Clamping without a floor is
only half a fix: it caps the tall case and lets the short case collapse.

**`/marketplace` was not touched by the 2026-09-04 sweep and is the worst page on the list.** It measured **38 desktop at a `benchmarkIndex` of 1,183**, with 22,560ms of blocking time, an LCP of 3,272ms and **11,790 KiB transferred**, which is more than the other seven pages put together. Its viewers already obey rule 4's `data-src` contract and its podium already obeys rule 5, and the page still mounts a hero carousel, a six-item themed strip and a card grid, all of them above the fold at 1350x940, so the contract has nothing left to defer. A single hero GLB was 3,341 KiB in that trace, which is rule 7's problem in a second place: `renderHero()` in [src/marketplace.js](../src/marketplace.js) takes whatever `state.featured` returns without asking how heavy it is. Applying rule 7's budget there is the obvious next move and it needs its own measurement, because unlike the homepage this page shows three avatars at once and the budget has to be shared.
~~~~

### `docs/site-performance.md` (section "Half-closed on 2026-10-13: directory thumbnails had no cache headers")

~~~~markdown
## Half-closed on 2026-10-13: directory thumbnails had no cache headers

The caching half is fixed; the sizing half is still open.

The measurement, kept as the record: `/discover` downloaded **28 images totalling 9,360 KiB**, of which 27 were avatar thumbnails at roughly 280 KB each. Every one came from the Cloudflare `pub-*.r2.dev` public endpoint, which answers with **no `Cache-Control` header at all**: Lighthouse's `cache-insight` reported a cache lifetime of 0 for 29 resources, so a returning visitor re-downloaded all of it. `/cdn/<key>` ([api/cdn-object.js](../api/cdn-object.js)) proxies the same bucket and answers `public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800` for `thumb/` keys (other keys get `max-age=86400, s-maxage=2592000`).

What shipped: `thumbnailUrl()` in [api/\_lib/r2.js](../api/_lib/r2.js) now resolves a stored key (or a legacy raw-bucket URL, via `keyFromPublicUrl()`) to an absolute `<APP_ORIGIN>/cdn/<key>` URL through `cdnUrlOrNull()`, so every first-party feed and the documented `GET /api/explore` `image` field carry the cached, same-origin URL. It is absolute rather than relative because `/api/explore` has third-party consumers and `draft-mint.js` bakes the URL into on-chain metadata. Stored `forge_creations` URL columns written before the change are rewritten on read by `normalizeStoredUrl()`, and the forge thumbnail writer ([api/\_lib/forge-thumbs.js](../api/_lib/forge-thumbs.js)) now writes the `/cdn/` form. Serving through `/cdn/` also removes the cross-origin `r2.dev` reads that Chrome's Opaque Response Blocking was rejecting. [tests/thumbnail-url-guard.test.js](../tests/thumbnail-url-guard.test.js) and `tests/r2-normalize-stored-url.test.js` hold the split.

Still open: the thumbnails are stored at 768x768 and painted into a 293px box, so the byte cost per card is unchanged on a first visit.
~~~~

### `docs/site-performance.md` (section "Half-closed on 2026-09-08: `/forge`'s composer growth")

~~~~markdown
## Half-closed on 2026-09-08: `/forge`'s composer growth

The coach half is fixed. `.prompt-coach` shipped EMPTY at `min-height: 1.2em` and
`updateCoach()` wrote `grade('')`'s message into it, which does not fit beside
its neighbours in the `flex-wrap` `.prompt-tools` row, so the row wrapped onto a
second line and grew. `pages/forge.html` now ships that exact message, with
`data-no-i18n` per rule 6, and
[tests/forge-prompt-coach.test.js](../tests/forge-prompt-coach.test.js) reads
both `pages/forge.html` and `src/forge-prompt-studio.js` so the two copies cannot
drift back apart.

The engine-pill half below is unchanged and still open. It is the harder one:
the settled height is a function of how many lanes the catalog returns and how
they wrap, which is between 29px and 219px across viewport widths, so there is no
constant to reserve. The shape that would work is the one rule 5 used on the
podium, rendering the lane set the server already knows about into the markup.
~~~~

### `docs/site-performance.md` (section "Open: `/forge`'s composer grows 95px after first paint, and rule 6 does not cover it")

~~~~markdown
## Open: `/forge`'s composer grows 95px after first paint, and rule 6 does not cover it

Rule 6 fixed the example-prompt row. The 2026-09-04 sweep measured `/forge` at **CLS 0.226 on a `benchmarkIndex` of 1,196**, with `<div class="chips" id="examples">` still named as the largest shift, and a per-frame trace of the live page shows why: `#examples` is not growing, it is being *pushed*. Two containers above it in `.forge-rail` grow after first paint, and the chips row is simply the biggest thing that moves as a result.

Sampled every frame against production at 1350x940:

| Time | What changes | Composer height |
|---|---|---|
| 247ms | first paint | 547px |
| 625ms | `.prompt-tools` 26px to 64px, as `#prompt-coach` receives its first message and wraps onto its own line | 585px |
| 684ms | `.fq-row--engine` 50px to 86px and `.estimate` 11px to 32px, as `buildEngineButtons()` fills the pill | 642px |

That is 95px of growth, and the two shifts it produces measure **0.1957 and 0.0081**, which is the page's entire CLS. Both are the same defect rule 5 names: a placeholder smaller than the thing that replaces it. `.engine-pill:empty { min-height: 50px }` is already an attempt at the second one and is now under-sized, because the catalog wraps onto two rows at desktop widths.

**Neither has a reservation that holds across viewport widths, which is why this is recorded rather than fixed.** Measured settled heights at ten widths, the growth is not a constant and not monotonic: `.prompt-tools` grows 38px at 1200 to 1440, **0px at 768 to 1024**, 38px at 480, and 12px at 320 to 390, because whether the coach fits inline depends on the column width. The engine row settles at 29px, 61px, 86px, 127px, 173px and 219px across the same widths as the pill wraps onto more rows. Reserving a fixed number over-reserves somewhere, and over-reserving shifts the page exactly as surely as under-reserving.

One candidate fix was built and measured and is recorded here so the next pass does not repeat it. Giving `.prompt-coach` its own row unconditionally (`flex: 1 0 100%`) cuts the growth from 38px to 2px at six of the ten widths, and it fails on the other four: 50px at 900px, 15px at 320px and 390px where the filled message wraps to a second line the empty one did not reserve, and it costs a permanent 48px of empty space under the prompt box on first paint at every width. Trading a shift for a visible gap plus a residual shift is not a fix.

The shape that would work is the one rule 5 used on the podium: ship the settled content in the HTML so the box exists in the first frame. For the coach that means the `grade('')` message living in `pages/forge.html` with `data-no-i18n`, plus a test that reads both files so the two copies cannot drift, the way [tests/forge-prompt-gen.test.js](../tests/forge-prompt-gen.test.js) already does for the chips. For the engine pill it means rendering the lane set the server already knows about into the markup instead of only into `buildEngineButtons()`. Both are edits to the creation surface's own contract, which is more than a measurement sweep should decide on its own.
~~~~

### `docs/site-performance.md` (section "7. The hero's model is chosen inside a byte budget")

~~~~markdown
## 7. The hero's model is chosen inside a byte budget

**Invariant: code that picks a GLB for a fixed slot picks it by size, not by whatever the feed returns first.**

The homepage hero calls `/api/avatars/featured` and rendered the first entry that resolved. That list is curated by editorial flag and view count, and its members range from a **90 KB prop to a 10.7 MB scan**. On 2026-09-04 the first entry was a 4.6 MB model, which is 4.6 MB of download, parse and GPU upload landing on the critical path of every homepage visit, while the page is still trying to become interactive. A Lighthouse desktop trace measured **29,660ms of total blocking time**, against **9,649ms** for the same page with only `*.glb` withheld. The hero was two thirds of the page's blocking time and 4.6 MB of its 6.9 MB.

Nothing about that was a scheduling problem. The hero is the above-the-fold LCP element and is correctly eager (see rule 4's exception); the defect was that no one chose how heavy it was allowed to be.

[api/avatars/featured.js](../api/avatars/featured.js) now reports each candidate's `size_bytes`, the column the detail endpoint already returned, so the choice is made from one response instead of a detail fetch per candidate. `resolveFeaturedGlb()` in [src/home-live-agents.js](../src/home-live-agents.js) takes the **largest** candidate inside a 2.5 MB budget, which is the richest model the page can afford, and falls back to the smallest when nothing fits, because an over-budget hero that renders beats an empty stage. Candidates the API reports no size for keep their curated order behind the sized ones; over-budget candidates stay in the list as fallbacks, so an outage of the affordable ones still fills the stage.

Verified against the live featured list: the old code took a 3.71 MB model, the new code takes a 2.06 MB rigged, textured, animated humanoid, and every one of the twelve candidates is still reachable in order with no duplicates.

**The budget is a product lever, not just a performance one.** It is `HERO_GLB_BUDGET_BYTES`, one named constant, and raising it is a decision about how much of the first visit the hero is allowed to spend. Curating a heavier avatar into the featured list no longer silently makes that decision for everyone.
~~~~

