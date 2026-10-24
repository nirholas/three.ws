# 426. Find and fix the unhandled "Failed to fetch" rejection firing from the three-addons chunk site-wide

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate, no owner action required.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan.
- This order's root cause is narrowed but not pinned to an exact line yet (see "What is already ruled out" below). That is not a reason to stop: Step 0 gives a fast, mechanical way to pin it exactly (enable sourcemaps, resolve the stack trace). Finish the investigation, then fix, in this same session.
- Bug fixes are test-first: reproduce with a failing test before touching the fix, confirm it fails for the stated reason, then fix, then confirm green. Commit the test with the fix.
- The only permitted stops are the CLAUDE.md stop-and-ask gates (spend/on-chain writes, push/deploy, posting externally, committing content referencing a crypto project other than `$THREE`, destroying unrecoverable data). This order touches none of them.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- The em-dash and en-dash characters are banned in everything you write.

## Step 0: re-derive the current state

Confirm the alert is still live and measure its current volume:

    gcloud logging read 'resource.type="cloud_run_revision" resource.labels.service_name="three-ws-api" textPayload:"three-addons" textPayload:"Failed to fetch"' --freshness=24h --format='value(textPayload)' --project=aerial-vehicle-466722-p5 | wc -l
    gcloud logging read 'resource.type="cloud_run_revision" resource.labels.service_name="three-ws-api" textPayload:"three-addons" textPayload:"Failed to fetch"' --freshness=30d --format='value(textPayload)' --project=aerial-vehicle-466722-p5 | wc -l
    gcloud logging read 'resource.type="cloud_run_revision" resource.labels.service_name="three-ws-api" textPayload:"three-addons" textPayload:"Failed to fetch"' --freshness=24h --format='value(textPayload)' --project=aerial-vehicle-466722-p5 | head -3

As measured 2026-10-24: **9 occurrences in 24h, 109 in 7d, 952 in 30d**, all a client-reported `unhandledrejection` with `name: "TypeError"`, `message: "Failed to fetch"`, and the SAME stack every time: `at https://three.ws/assets/three-addons-CXp-0JmD.js:4325:98926` (the hashed filename will differ after any rebuild; match on the `three-addons-` prefix and the "Failed to fetch" message instead of the exact hash). It fires across real, diverse page types in the same 30-day window, not one page: `https://three.ws/` (homepage), `/airdrops`, `/markets/digest`, and dozens of distinct `/markets/news/<date>/<slug>` article pages. Most (not all) samples carry a `HeadlessChrome` UA from Microsoft/Bing crawler IP ranges (`40.77.x.x`, `65.55.x.x`, `199.30.25.x`), but at least one real non-bot UA (`SEBot-WA`) also hit it on the bare homepage, so this is not purely a bot-traffic artifact.

Pin the exact source line with a sourcemap instead of guessing from grep (this is the fast path; do this first):

    grep -n "sourcemap" vite.config.js || echo "confirmed: no sourcemap config, production build emits none today"

Temporarily set `build.sourcemap: true` in `vite.config.js` (`build:` block, alongside `reportCompressedSize: false` around line 595), run `npm run build`, then locate the emitted `dist/assets/three-addons-*.js.map` (or wherever `vite.config.js`'s `build.outDir` points) and resolve line 4325, column 98926 to a real source file and line using Node's `source-map` package (already a transitive dependency via Vite/Rollup) or any installed source-map CLI. Revert the `build.sourcemap` line before committing (this order's diff must not permanently turn on sourcemaps as a side effect, unless you decide to propose that separately and justify it, which is out of scope here).

## What is already ruled out (do not re-walk this ground)

The obvious suspect is the site-wide "Walk Companion" first-visit auto-summon in `public/nav.js` (`initCompanionAutoStart()` around line 937, gated by `WALK_AUTO_SKIP` which excludes `/play`, `/walk`, `/club`, `/tour`, `/world`, `/scan`, `/arena`, `/pose`, `/splat`, `/capture`, `/timeline`, `/create/selfie`, `/create/video`, none of which match the failing pages): it auto-injects `/walk-companion.js` (built from `src/walk-companion.js`) for any first-time visitor (no `walk:companion:enabled` key in `localStorage`) after the page goes quiet, which matches a bot crawling with fresh storage on every page and a real first-time human visitor on `/`. That module imports `createWalkCompanion` from `walk-sdk/src/companion.js`, which loads an avatar GLB via `GLTFLoader` (`walk-sdk/src/internal/load-avatar.js`), the exact kind of code that bundles into the `three-addons` manualChunk (`vite.config.js` around line 625).

Already read and confirmed properly wrapped, so do NOT assume these are the leak without new evidence:
- `walk-sdk/src/internal/load-avatar.js`'s `loadWalkAvatar()`: both `loader.loadAsync()` calls (primary and fallback entry) are inside a `try/catch` (lines ~96-109), and `buildSharedController()`'s animation-manifest `fetch()` is inside its own `try/catch` (lines ~340-369).
- `walk-sdk/src/companion.js`'s two call sites of `loadWalkAvatar()`: `mount()` wraps `await this._buildScene()` (which calls `_loadInto()` which calls `loadWalkAvatar()`) in `try/catch` (lines ~186-193); `setAvatar()` wraps its own call in `try/catch` (lines ~383-416).
- `walk-sdk/src/internal/load-avatar.js`'s `makeLoader()` (lines ~64-75): its `await getMeshoptDecoder()` has no local `try/catch`, but a rejection here still propagates up through `loadWalkAvatar()` into the SAME `_buildScene()` try block `mount()` already catches, so this path is also covered.

So the unhandled rejection is NOT the straightforward "avatar GLB failed to load" path. It is either (a) a different file bundled into the same `three-addons` chunk by `manualChunks` (OrbitControls, DecalGeometry, RoomEnvironment, HDRLoader, GLTFExporter, SkeletonUtils, WebGL capabilities, KTX2Loader, used by completely unrelated features like `agent-trade.js`, `assembly.js`, `walk-trails.js`, `animations-live-preview.js`, `app.js`), or (b) a page-navigation/teardown race (crawler tears down the page while a fetch this code starts is still in flight, and the specific promise that rejects is not the one any `.catch` is actually attached to, e.g. a detached timer callback or an event listener closure that re-enters after `unmount()` already ran). The sourcemap resolution in Step 0 settles which.

## Task

1. Resolve the exact source file and line via the sourcemap technique in Step 0.
2. Read that file's surrounding code and identify the unguarded promise (a `fetch()`, `.load()`/`loadAsync()`, or `import()` whose rejection has no attached `.catch()` and whose caller's `await` is not inside a `try/catch`).
3. Add a test-first regression that exercises this exact call path and asserts the rejection is caught (not left to propagate). Match the existing test style in `tests/` for whichever module this turns out to be (if it is anywhere under `walk-sdk/`, check `walk-sdk/src/**/*.test.js` or `walk-sdk/tests/` for its own test convention instead). Run it and confirm it fails against today's code for the identified reason.
4. Fix the gap: wrap the call in `try/catch` (or attach `.catch()`), following the same recovery pattern already used elsewhere in the same file (log a warning via the existing `log.warn`/`log.debug` helper if one is imported, degrade gracefully, never let the exception reach the window as an unhandled rejection). Do not change behavior for the success path.
5. Re-run the new test and confirm it passes. Run the full test suite for whatever module/package was touched (e.g. `npx vitest run` scoped to the relevant file(s), plus `walk-sdk`'s own test command if it has one, check its `package.json`) and confirm no regression.
6. Revert the temporary `build.sourcemap: true` edit in `vite.config.js` if you made one for Step 0, confirming `git diff vite.config.js` is empty before committing (unless resolving the trace genuinely required a permanent change there, which is not expected).
7. Run `npm run check:rules -- --paths <files touched>` and fix anything it flags.

## Done when

- The sourcemap-resolved source file and line are named in the report.
- A regression test for that exact call path exists, failed before the fix for the stated reason, and passes after.
- The fix wraps the previously-unguarded promise so its rejection can never reach `window`'s `unhandledrejection` handler; it degrades the same way sibling failure paths in the same file already do.
- `vite.config.js` carries no leftover sourcemap change.
- No regression in the touched module's existing test suite.
- `npm run check:rules` passes on the touched paths.
- `git diff` reviewed; every changed line is accounted for by this fix and its test.
- The fix and its test are committed together on `evolve` with an explicit-path commit.
- This file is removed, with a dated entry added to `prompts/finish/_context/production-100-PROGRESS.md` citing the fix commit SHA and today's measured 952-occurrences/30-day baseline so a future sweep can confirm the count stops climbing after deploy.

## Never blocked

| Looks like a blocker | It is not | Do this |
|---|---|---|
| The exact source line is still unclear after reading this file's "already ruled out" section | The sourcemap technique in Step 0 resolves it mechanically in minutes; grepping the minified bundle by hand (what produced the "already ruled out" list above) is the slow path, not the only path | Do the `build.sourcemap: true` + rebuild + resolve step before falling back to manual grepping |
| The failure correlates heavily with `HeadlessChrome`/bot UAs, making it feel like a non-issue (bots don't matter) | At least one real non-bot UA (`SEBot-WA`) hit it on the bare homepage, and a crawler that can't execute three.ws's JS cleanly is itself an SEO/indexing risk worth fixing regardless of the end-user share | Fix it as a real defect; do not deprioritize on the assumption it is bot-only noise |
| The root cause turns out to be in a shared Three.js addon file used by many unrelated features (not the walk companion at all) | That is an expected possible outcome per the "already ruled out" section; the fix is still narrowly scoped to that one file's call site | Fix only the identified unguarded call; do not refactor the broader `three-addons` chunk or change `manualChunks` as part of this order |
| The root cause looks like a page-navigation/teardown race rather than a plain missing catch | Still fixable: guard against acting on a stale/detached instance (check an `this.mounted`-style flag, or an `AbortController` tied to the component's lifecycle, before the promise resolves/rejects) rather than declaring it unfixable | Add the same kind of mounted-check guard this codebase already uses elsewhere (e.g. `if (!this.mounted) return;` appears in `walk-sdk/src/companion.js`'s `setAvatar()`) around the resolved/rejected continuation |
| No test convention exists yet for the exact file the bug lives in | `walk-sdk/` and `tests/` both have other precedent to follow; picking the closer one and matching its mocking style is enough | Do not invent a new testing framework or pattern; copy the nearest existing file's approach |

## Report format

State: the Step-0 log counts and sample, the sourcemap-resolved file/line, the diff, the failing-test confirmation before the fix and the passing-test output after, confirmation `vite.config.js` has no leftover diff, and the commit SHA.
