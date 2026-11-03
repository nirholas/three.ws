# Hold 60fps on /agora with the full 200-citizen fleet by budgeting which avatars animate

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/707-plan-agora-fleet-render-animation-budget.md`.

**Priority:** P2, new capability with clear value (score 61 of 100 inside the tier). **Area:** agora. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

`/agora` is the flagship living-economy surface, and its production-hardening pass left exactly one unmet Definition-of-Done box: the Commons dropped to about 1 fps once the full fleet loaded (measured in headless Chromium on SwiftShader: 60 fps for 50 s, then 0.5 to 2 fps with 900 to 1400 ms per frame). The cause points to per-object cost of about 200 skinned meshes: every frame each citizen runs `mixer.update(dt)`, recomputes bone matrices, uploads a bone texture, and issues its own draw call. The honest real-hardware number is unknown. Until the fleet is budgeted, the page cannot claim a smooth busy-board experience, and low-end phones will stall.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `src/agora/citizen-avatar.js` `CitizenPopulation.update(dt)` (around line 486) calls `_advanceMotion` and `inst.mixer?.update(dt)` for every instance every frame, with no visibility, distance or priority filter. Comment on the method says "Cheap: one mixer.update per citizen", which the task 12 measurement disproved.
- Since 2026-08-16 citizens stand up on one shared default rig and only the `MAX_PERSONAL_AVATARS` (24 desktop, 8 coarse pointer, line 50) most recently active upgrade to personal models (`_wearOwnAvatar`, `_swapModel`); `MAX_CONCURRENT_LOADS = 4`; the world places the crowd ten per frame (`src/agora/agora-world.js` `loadCitizens`, 200 requested). The 50 s cliff in the original numbers no longer applies, the per-frame cost does.
- Ruled out in task 12: JS heap leak, fill rate, a hot JS function. 92.7 percent of samples were native `(program)` time with `texSubImage2D`.
- Existing agora tests are Node-side (`agora-*.test.js` under `src/agora/` and `tests/`); there is no frame-time or fps test for the world, and `docs/agora/tasks/12-fleet-render-performance.md` has no recorded post-fix measurement.
- Reproduction snippet (rAF counter in 10 s buckets) is in the task 12 doc; Playwright specs live in `tests/e2e/`.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
sed -n 470,500p src/agora/citizen-avatar.js
grep -n "MAX_PERSONAL_AVATARS\|MAX_CONCURRENT_LOADS\|LOD\|frustum\|visible" src/agora/citizen-avatar.js src/agora/agora-world.js | head -30
ls tests/e2e | grep -i agora
curl -s https://three.ws/api/agora/citizens 2>/dev/null | head -c 300   # confirm the real fleet size
npx vite --port 3211 --strictPort &   # then drive /agora with the reproduction snippet, record fps per 10 s
```

Measure first. If the fleet holds 60 fps on a real GPU, this becomes a low-end-device budget task rather than a bug; record the numbers either way. Skip any budgeting step already present.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Measure on the available hardware (and on SwiftShader as a worst case) with the reproduction snippet; commit the numbers to the task 12 doc under "Measurements" with date, GPU string, viewport and citizen count. If a real GPU is not available in this session, say so and keep the SwiftShader numbers labelled as software-rasterizer figures.
2. Extract a pure, testable budget function `src/agora/animation-budget.js`: given citizen world positions, the camera position and frustum, a hard cap (`MAX_ANIMATED`, 40 desktop, 16 coarse pointer), and a per-frame rotation, return the set of citizens whose mixers run this frame. Rules: citizens on screen and nearest first; a citizen mid-walk or `busy` outranks an idle one; off-screen and far citizens update their mixer at a low rate (every 8th frame, with accumulated dt) so poses do not freeze visibly when they re-enter; reduced motion keeps its existing no-mixer behavior. Selection must be stable frame to frame (hysteresis) so avatars do not flicker between animated and frozen.
3. Wire it into `CitizenPopulation.update(dt)`: skip `mixer.update` for non-selected citizens, and set `skinnedMesh.visible = false` or `frustumCulled = true` appropriately for off-screen ones so they cost no draw call. Keep locomotion (`_advanceMotion`) running for all citizens because it is cheap and keeps positions honest.
4. Consider a render cap distinct from the fetch cap: when the animated cap hides citizens, `loadCitizens` already shows an honest "more citizens exist than are shown" message at 200; extend the copy only if the animated cap is user-visible (far citizens render as static idle poses, which should be indistinguishable at distance; if not, say so in the UI copy).
5. Tests: `tests/agora-animation-budget.test.js` for the pure function (cap respected, nearest-first, busy priority, hysteresis, low-rate round robin visits every citizen within N frames, reduced motion). Browser test `tests/e2e/agora-fleet-fps.spec.js` that loads `/agora`, waits for the fleet, and asserts the median fps of the last three 10 s buckets is above a floor appropriate to the environment (state the floor and why; on SwiftShader use a relative floor against a baseline captured in the same run, for example no collapse below 25 percent of the first bucket).
6. Re-run the reproduction, record the before and after table in the task 12 doc, change its status line from "open" to "shipped" and update the Status column of row 12 in `docs/agora/tasks/00-INDEX.md` and the unchecked box in `11-production-hardening.md`.
7. Verify in a real browser at desktop and a 390x844 viewport: citizens still walk, idle, celebrate and show the busy ring; hovering or tapping a citizen still opens the passport panel; empty (no citizens) and error (citizens request fails) states still render their designed messages; no console errors.
8. Changelog entry (`data/changelog.json`, community language, `improvement` tag), then `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/agora-animation-budget.test.js` passes; the e2e fps spec passes with `npx playwright test tests/e2e/agora-fleet-fps.spec.js --retries=0`.
- [ ] `docs/agora/tasks/12-fleet-render-performance.md` contains a before and after fps table and a status of shipped; `00-INDEX.md` row 12 matches.
- [ ] A scripted check in the e2e spec asserts at most `MAX_ANIMATED` mixers advance per frame (expose a debug counter only under a test flag, not in production UI).
- [ ] No console errors or warnings from `/agora` on desktop or mobile viewport.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No physical GPU in the session | Measure on SwiftShader as the worst case, label it as such, and make the budget correct by construction (cap on animated and drawn skinned meshes). |
| `/agora` needs a live API and wallet | Use the dev proxy to `https://three.ws`; the fleet read is public. Humans-first actions need auth but the fps test does not. |
| Headless runs time out at 90 s | Use shorter buckets or `--retries=0 --timeout=180000`; the goal is the shape of the fps curve. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/707-plan-agora-fleet-render-animation-budget.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `707-plan-agora-fleet-render-animation-budget.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/agora/tasks/12-fleet-render-performance.md` (whole file)

~~~~markdown
# Task 12: the Commons collapses to ~1fps once the full fleet loads

**Status:** open. Found during Task 11's performance pass (2026-08-06); it is the
one Definition-of-Done box in [11-production-hardening.md](11-production-hardening.md)
that could NOT be verified, so it is carved out here rather than quietly passed.

## The symptom

`/agora` holds a solid 60fps while its citizen avatars stream in, then falls off
a cliff and never recovers. Measured against the Vite dev server with Playwright,
counting real `requestAnimationFrame` callbacks in 10-second buckets:

```
frames per 10s: 597, 600, 600, 599, 596, 20, 12, 13, 6, 7, 5, 4, 4, 9, 5, 7, 3
fps:           59.7, 60.0, 60.0, 59.9, 59.6, 2.0, 1.2, 1.3, 0.6, 0.7, 0.5, ...
```

The cliff lands at ~50s, which is exactly when the avatar loader finishes: the
world requests 200 citizens (`src/agora/agora-world.js`, `loadCitizens`) and
`CitizenPopulation` streams them in `MAX_CONCURRENT_LOADS = 4` at a time
(`src/agora/citizen-avatar.js`). Steady-state frame cost is **~900-1400ms**.

## What changed since the measurement

The load path the numbers above describe no longer exists, so the ~50s cliff
timing has to be re-measured before anything is concluded from it. Since
2026-08-16 every citizen stands up on the shared default rig first (one small
GLB for the whole crowd) and only the most recently active `MAX_PERSONAL_AVATARS`
(24 on desktop, 8 on a coarse pointer) upgrade to their own model
(`src/agora/citizen-avatar.js`, `_wearOwnAvatar`); the crowd is placed ten
citizens per frame and the citizens request is prefetched in parallel with the
map (`src/agora/agora-world.js`). The full 200 are therefore standing in
seconds rather than minutes, which moves the cliff earlier, and the per-frame
cost this task is about is unchanged: `CitizenPopulation.update` still runs
`mixer.update(dt)` for every instance every frame, so the suspected per-object
cost below applies to 200 skinned meshes exactly as before.

## What was ruled out

| Hypothesis | Evidence against |
|---|---|
| JS heap leak | Heap flat at 48.1 MB over 90s (forced GC before each sample). |
| Fill-rate / rasterization | Shrinking the viewport 1280x800 → 120x90 (1% of the pixels) left fps unchanged (0.7 → 0.8). Not pixel-bound. |
| A hot JS function | CPU profile attributes only ~4% of samples to JS. The named frames (`applyBoneTransform`, `getVertexPosition`, `fromBufferAttribute`) come from `Box3.setFromObject(obj, true)` in `scaleToHeight`/`groundFeet`, which run **once per avatar at load**, not per frame. |

## What the evidence points to

92.7% of profile samples land in native `(program)` time, and `texSubImage2D`
appears in the profile. That is the per-object cost of ~200 `SkinnedMesh`
avatars: every frame each one updates an `AnimationMixer`, recomputes its
skeleton's bone matrices, and uploads a bone texture, then issues its own draw
call. `CitizenPopulation.update` updates all of them unconditionally:

```js
for (const inst of this.instances) {
    this._advanceMotion(inst, dt);
    if (!this.reducedMotion) inst.mixer?.update(dt);   // all ~200, every frame
    ...
}
```

**Caveat, stated plainly:** the test browser is headless Chromium on
`ANGLE (SwiftShader driver)`, a software rasterizer. Per-object driver overhead
(bone-texture uploads, draw calls) is dramatically more expensive there than on
real GPU hardware. The viewport test proves the cost is per-object rather than
per-pixel, but it does **not** prove a real GPU would also stall. The honest
position is that the real-device number is **unknown** and must be measured on
hardware before `/agora` can claim "60fps with a busy board and a fleet".

## The work

1. **Measure on real hardware first.** Load `/agora` on a real GPU (desktop
   Chrome, then a mid-range phone) with the full fleet and record fps. If it
   holds 60, this becomes a low-end-device budget question rather than a bug.
2. **Budget the animated fleet regardless.** 200 individually-animated skinned
   meshes is not a budget any low-end device will meet. Update mixers only for
   avatars that are on-screen and near the camera, and idle the rest. The world
   already tracks positions and has a camera focus to measure against.
3. **Consider a render cap distinct from the fetch cap.** `loadCitizens` already
   surfaces an honest "more citizens exist than are shown" message when it hits
   200; the same honesty can cover a lower *animated* cap.
4. Re-run the Task 11 measurement and record the numbers here.

## Reproduce

```js
// tests/e2e/, then: npx playwright test <file> --retries=0
await page.goto('/agora'); await page.waitForTimeout(8_000);
await page.evaluate(() => { window.__b = []; let n = 0;
  setInterval(() => { window.__b.push(n); n = 0; }, 10_000);
  (function l() { n++; requestAnimationFrame(l); })(); });
await page.waitForTimeout(90_000);
console.log(await page.evaluate(() => window.__b));
```

## Guardrails

Same as every Agora task: `$THREE` only, real data, no mocks in app code, stage
explicit paths, push to `threews` only.
~~~~

### `docs/agora/tasks/11-production-hardening.md` (whole file)

~~~~markdown
# Task 11 - Production hardening + launch

> **Status: shipped, except the fleet-render performance box**, which is carved
> out as [task 12](12-fleet-render-performance.md). `/agora` is live and pushed;
> the boundary checks in step 5 are covered by `tests/agora-act-validation.test.js`
> and the read model's 429 now carries `retry-after`
> (`tests/agora-read-model.test.js`).

**Goal:** Take Agora from "works on my machine" to **100% production-ready** and
launch it: tests across every new surface, all UI states audited, accessibility +
performance verified, security/spend review, real deploy verification, the
changelog + docs, and the push to `threews`. This is the gate - nothing ships
until every box here is true.

**Depends on:** all prior tasks (run last, or run incrementally as slices land).

## Context to read first
- `CLAUDE.md` (§ Definition of done, § Self-review protocol) and `docs/agora.md`
  (§ Invariants).
- `00-INDEX.md` (global guardrails).
- Everything Agora shipped: `api/agora/*`, `workers/agora-citizens/*`,
  `src/agora/*`, `pages/agora.html`, `packages/agora-mcp/*`, the migration.
- `tests/` (house test style), `data/changelog.json` + `npm run build:pages`,
  `data/pages.json`.
- The `completionist` agent and `/code-review` - use them.

## Build (scope)
1. **Tests.** Vitest coverage (`npm test` is `vitest run && playwright test`) for: the economy API shapes + empty/error
   paths (mock the DB/bazaar at the boundary only - never ship mocks in app code);
   the engine's loop transitions, idempotency (no double-projection), and failure
   isolation; each profession module's proof derivation; `agora-mcp` tools;
   migration sanity. Add to the existing suite so `npm test` covers Agora.
2. **Every state, audited.** Walk each surface for loading / empty / error /
   populated / overflow (0, 1, 1000 citizens; very long names; mid-op network
   failure; expired session; insufficient funds; slashed stake). Fix any blank
   void, dead button, or unreachable state. Confirm the empty economy renders
   honestly end-to-end (no fabricated anything).
3. **Accessibility.** Semantic HTML, ARIA on interactive elements, keyboard nav +
   focus traps in panels, visible focus rings, color contrast, `prefers-reduced-
   motion` honored in all 3D FX. Run an a11y pass (axe/Lighthouse).
4. **Performance.** Lazy-load heavy modules + GLBs; paginate `citizens`; debounce
   polls; pause render on hidden tab; **dispose** Three.js resources (no leak over
   30 min); code-split the Agora bundle. Lighthouse perf budget met; 60fps with a
   busy board + a fleet.
5. **Security + spend review.** `/api/agora/act` (and any mutating path):
   authenticated, input-validated at the boundary, idempotent, rate-limited,
   spend-capped; secrets never logged; mainnet $THREE behind explicit env +
   confirmation. Run `/security-review` on the branch. Confirm the bundler trap
   didn't bloat `api/*.js` (`head -1` check).
6. **Deploy verification.** Build clean (`npm run build`, `npm run build:pages`);
   confirm the worker image builds (`workers/agora-citizens` Docker/cloudbuild);
   smoke the deployed `/api/agora/*` + `/agora` against real data; the life engine
   runs on devnet in the deployed environment.
7. **Docs + changelog + index.** Update `docs/agora.md` roadmap checkboxes to
   reflect reality; mark task status in `00-INDEX.md`; ensure `data/pages.json`
   has `/agora`; add the launch `data/changelog.json` entry (feature) and run
   `npm run build:pages` (it validates the entry). Community delivery (the
   Telegram channel; the X lane is retired and the cron never calls it) happens
   automatically via the `/api/cron/changelog-push` cron after deploy.
8. **Final self-review.** Run the `completionist` agent on the changed files and
   `/code-review` on the diff; resolve findings. Then the CLAUDE.md pride check.

## Out of scope
New features. This task only hardens, verifies, documents, and launches what
exists. If you find a missing feature, file it as a new task file, don't scope-creep.

## Definition of Done (the launch gate - all must be true)
- [ ] `npm test` green, including new Agora tests; meaningful coverage of API,
  engine, professions, MCP.
- [ ] Every surface's loading/empty/error/populated/overflow states designed and
  reachable; no blank voids, no dead paths.
- [ ] Accessibility pass clean (keyboard, ARIA, contrast, focus, reduced-motion).
- [ ] Performance: lazy-load + pagination + dispose verified; no leak over 30 min;
  60fps busy; Lighthouse budget met.
- [ ] Security: mutating endpoints authed/validated/idempotent/rate-limited/spend-
  capped; `/security-review` findings resolved; no secret logging; mainnet gated.
- [ ] Deployed `/api/agora/*`, `/agora`, the worker, and `agora-mcp` all verified
  against real data (paste evidence: URLs, tx signatures, screenshots).
- [ ] `docs/agora.md` + `00-INDEX.md` statuses current; `data/changelog.json`
  entry added + `build:pages` passes; `/agora` in `data/pages.json`.
- [ ] `git diff` reviewed line-by-line; `completionist` + `/code-review` clean.
- [ ] Pushed to `threews` (the canonical remote).
- [ ] You would proudly demo Agora to a room of senior engineers.

## Verification
```bash
npm test
npm run build && npm run build:pages
head -1 api/agora/*.js api/agenc/*.js        # ensure no esbuild bundle bloat
# a11y + perf: Lighthouse on /agora
# deploy smoke: curl the live /api/agora/* ; load /agora ; run the engine on devnet
```
Then `completionist` on changed files + `/code-review` on the diff.

## Guardrails
- Do not relax any DoD box to "good enough." If something can't be verified, say so
  explicitly and don't claim done.
- `$THREE` only; no other coin anywhere (code, tests, fixtures, copy, changelog).
- Stage explicit paths; re-check `git status`/`--staged` (concurrent agents share
  the worktree). Push to `threews` only; **never** pull/fetch from the retired `threeD` mirror.
~~~~

### `docs/agora/tasks/00-INDEX.md` (whole file)

~~~~markdown
# Agora - build tasks (read this first)

This directory decomposes **Agora - the living agent + human economy** into
self-contained task prompts. Each `NN-*.md` file is **one chat's worth of work**:
open it in a fresh session, follow it, and ship that slice production-ready.

> **Status (2026-08-06): tasks 01-10 have shipped; task 11 is complete except
> for one box.** `/agora` is live in production with a populated economy, and
> every deliverable in the table below exists in the tree (see the per-task
> Status column). Task 11's performance pass found the Commons dropping to ~1fps
> once its full 200-avatar fleet finishes loading; that is carved out as
> **[task 12](12-fleet-render-performance.md)** rather than counted as passed, so
> nobody reads this index as claiming a perf bar that has not been met. These
> files remain the build record and the pattern for future Agora slices. The
> other remaining roadmap rung is the mainnet $THREE launch, built and gated
> behind `AGORA_MAINNET_ENABLED` (see `api/_lib/agora-policy.js` and the Roadmap
> in [docs/agora.md](../../agora.md)).

> **What Agora is:** a persistent economy where AI agents *and* humans go about
> their daily lives - posting work, doing it, getting paid in **$THREE**, building
> on-chain reputation (via **AgenC**, the Solana coordination protocol by Tetsuo
> Corp), and producing real artifacts - rendered as a world you can watch, built
> as the **life layer over the existing City**. Full vision: **[docs/agora.md](../../agora.md).**

## How to run a task

1. Read **[docs/agora.md](../../agora.md)** (the spec) and **this file** (shared
   context + guardrails) first. Every task assumes both.
2. Open the task file. Read its *Context to read first* list - those are the real
   files you build against; don't re-explore the whole repo.
3. Build to the task's **Definition of Done**. Verify with its **Verification**
   steps. Do not report complete until every DoD box is true (CLAUDE.md rule).
4. Commit when the user says so. **Push to `threews` only** (`git push threews main`).
   Add a `data/changelog.json` entry for any user-visible change.

## Task order & dependencies

```
01 verify foundation ─┬─► 02 life engine ─┬─► 03 task supply ──┐
                      │                    └─► 04 professions ──┤
                      │                                          ▼
                      └────────────────────────► 05 commons ─► 06 economy visuals ─► 07 verify + passport
                                                                                          │
                                              08 humans first-class ◄──────────────────────┤
                                              09 arena + guilds      ◄──────────────────────┤
                                              10 agora MCP           ◄──────────────────────┘
                                                          ▼
                                              11 production hardening + launch
```

| # | Task | Depends on | One chat delivers | Status |
|---|---|---|---|---|
| 01 | [Verify foundation](01-verify-foundation.md) | none | Migration applied, economy API smoke-tested green, SDK build unblocked | shipped |
| 02 | [Life engine](02-life-engine.md) | 01 | `workers/agora-citizens`: N real devnet agents living the daily loop (Fetcher) | shipped |
| 03 | [Task supply](03-task-supply.md) | 02 | Citizens post $THREE bounties + hire each other → board AgenC lane goes real | shipped (`workers/agora-citizens/post.js`) |
| 04 | [Professions](04-professions.md) | 02 | Sculptor (forge), Scribe (brain), Verifier (re-hash), remaining bits | shipped (Cartographer deferred, see `work/index.js`) |
| 05 | [Commons scaffold](05-commons-scaffold.md) | 01 (02 ideal) | `/agora` page on the City: render citizens, passport panel, empty states | shipped |
| 06 | [Economy visuals](06-economy-visuals.md) | 05 | Job board, claim-walk, busy ring, deliverable plinth, $THREE flow, ticker | shipped (`src/agora/economy-layer.js`) |
| 07 | [Verify + passport UI](07-verify-and-passport.md) | 06 | Re-hash-to-verify, living passport, cross-chain identity handshake | shipped (`src/agora/trust-surface.js`) |
| 08 | [Humans first-class](08-humans-first-class.md) | 05 | Wallet-auth: post/hire/complete/verify/vouch from the UI; your avatar joins | shipped (`api/agora/act.js`) |
| 09 | [Arena + guilds](09-arena-and-guilds.md) | 03, 06 | Competitive race + Collaborative guild visualizations | shipped + verified on devnet 2026-08-06 (`src/agora/arena.js`, `guild.js`) |
| 10 | [Agora MCP](10-agora-mcp.md) | 03 | `packages/agora-mcp`: external agents join the workforce over MCP | shipped |
| 11 | [Production hardening](11-production-hardening.md) | all | Tests, a11y, perf, all states, changelog, deploy verify, push threews | shipped, except the fleet-render perf box (see 12) |
| 12 | [Fleet render performance](12-fleet-render-performance.md) | 11 | Restore 60fps with the full avatar fleet on `/agora` | open |

Tasks on different branches of the DAG can run in parallel chats (e.g. 03 ∥ 04;
08 ∥ 09 ∥ 10). Respect the dependency column.

## Shared context - the real surfaces you build on

Agora assembles surfaces that already exist. **Do not rebuild them.** Paths are
from repo root `/workspaces/three.ws`.

### On-chain AgenC (the economy's truth)
- **Write SDK** - `solana-agent-sdk/src/actions/agenc/` → imported as
  `@three-ws/solana-agent`. Functions: `createAgenCClient`, `registerAgenCAgent`,
  `createAgenCTask`, `claimAgenCTask`, `completeAgenCTask`, `cancelAgenCTask`
  (refunds an expired posting's escrow to its creator), `getAgenCAgent`,
  `getAgenCTask`, `getAgenCTaskLifecycle`, `listAgenCTasksByCreator`, identity bridge
  (`getCanonicalThreewsAgenCId`, `buildThreewsMetadataUri`, `toAgenCAgentId`).
- **Read bridge (HTTP, free, no key)** - `api/agenc/[action].js`:
  `/api/agenc/list-tasks`, `/get-task` (`&lifecycle=1`), `/get-agent`,
  `/x402-services`, `/link`.
- **Proven end-to-end reference** - `examples/agenc-task-roundtrip/run.mjs`
  (devnet register→post→claim→complete with a real proof; keypair caching +
  airdrop backoff). **Model the life engine on this.**
- **Devnet program** `6UcJzbTEemBz3aY5wK5qKHGMD7bdRsmR4smND29gB2ab`.
  Task states: Open/Claimed/Completed/Cancelled/Disputed/Expired. Agent status:
  Inactive/Active/Busy/Suspended. Task types: Exclusive/Collaborative/Competitive.

### Agora's own layer (already built - Phase 1)
- **Spec** - `docs/agora.md`.
- **Data model** - `api/_lib/migrations/20260629020000_agora_world.sql`
  (`agora_citizens`, `agora_activity`). Read it for exact columns. It's a
  **projection** over the chain: every `agora_activity` row must cite a real
  `tx_signature` / `task_pda` / feed id.
- **Economy read API**: `api/agora/[action].js`: `citizens`, `board`, `pulse`,
  `passport`, and `task` (the live Arena/Guild roster + lifecycle,
  `GET /api/agora/task?taskPda=`). The 3D Commons and dashboards consume these.
- **Profession ↔ capability-bit map** lives in both `docs/agora.md` and the
  `PROFESSIONS` array in `api/agora/[action].js`. Keep them in sync. Open
  registry - add a bit + a real backing skill, never a hardcoded allowlist.

### Platform plumbing (match these patterns exactly)
- **DB** - `api/_lib/db.js` exports `sql` (tagged template; fragments compose -   see the file header). Migrations are timestamped SQL in
  `api/_lib/migrations/`; apply with `npm run db:migrate`, inspect with
  `npm run db:status` (`npm run db:check` is the deploy gate, `npm run db:restamp`
  re-records a comment-only edit to an applied file). An unconfigured or
  unreachable database answers a retryable 503, not a 500. **Workers run outside
  `api/`**: give them their own
  `neon(process.env.DATABASE_URL)` client (don't import `api/_lib/db.js` across
  the boundary).
- **Live feed**: `api/_lib/feed.js` exports `publishFeedEvent({ type, actor, … })`
  and `readFeedEvents`. `ALLOWED_TYPES` is a closed set; the thirteen `agora-*`
  event types (`agora-registered`, `agora-task-posted`, `agora-hired`,
  `agora-task-claimed`, `agora-task-completed`, `agora-earned`,
  `agora-arena-entered`, `agora-arena-won`, `agora-arena-lost`,
  `agora-guild-joined`, `agora-guild-contributed`, `agora-vouched`,
  `agora-flagged`) are already registered there. Any NEW event type must be
  added to that set before publishing it.
- **HTTP handlers** - `api/_lib/http.js`: `wrap`, `json`, `error`, `method`,
  `cors`, `readJson`, `rateLimited`; rate-limit via `api/_lib/rate-limit.js`
  (`limits.publicIp(clientIp(req))`, 240/min per IP). A denied limit answers with
  `rateLimited(res, rl)` so the 429 carries `retry-after` and the limiter's
  reason. Copy the shape of `api/agora/[action].js`.
- **The City (3D substrate)** - `pages/city.html` + `src/city/city-world.js`
  (scene/renderer/loop), `city-map.js`, `city-player.js`, `city-camera.js`,
  `city.css`. **Avatars**: `src/glb-canonicalize.js`, `src/animation-manager.js`,
  `src/animation-retarget.js`, `src/agent-avatar.js`; clips in
  `public/animations/`.
- **3D generation** - `@three-ws/forge` (`packages/forge/`), backing
  `api/forge*.js` + `api/mcp-3d.js`. Text/image → rig-ready GLB.
- **x402 payments** - `api/_lib/x402/bazaar-client.js` (`Bazaar`), `api/x402/*`,
  `api/_lib/x402-spec.js`. Micro-payments in USDC, and in $THREE on the Solana
  rail when `X402_ACCEPT_THREE_SOLANA` is on (a resource quoting both renders a
  token chooser in checkout; agent wallets stay USDC-only), plus the bazaar
  service directory.
- **Pages/routing** - register new pages in `data/pages.json`; HTML in `pages/`,
  JS in `src/`, CSS co-located or in `public/`. Vite multi-entry
  (`vite.config.js`), dev server `npm run dev` (port 3000).

## Global guardrails (every task)

These come from **[CLAUDE.md](../../../CLAUDE.md)** - the repo operating rules.
The ones that bite hardest in Agora:

1. **The only coin is `$THREE`** (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`).
   The economy is denominated in $THREE. Devnet plumbing uses native SOL or a
   clearly-synthetic placeholder mint (e.g. `THREEsynthetic1111…`) - **never**
   another real token, anywhere (code, tests, fixtures, copy, commits).
2. **No mocks, no fake data, no stubs, no `setTimeout` fake progress, no TODOs.**
   Real AgenC, real forge output, real x402 calls, real signed-in humans. An
   empty economy renders an honest empty state; it never fabricates citizens or
   trades.
3. **On-chain is truth; `agora_*` is projection.** Never let the world layer
   invent an economic fact. Every activity row cites a real action. Re-read the
   chain on conflict.
4. **Every state is designed** - loading (skeletons), empty (with a next action),
   error (actionable), populated, overflow (0/1/1000 citizens, very long names,
   mid-operation network failure). Accessibility + keyboard nav + focus states
   are not optional.
5. **Verify before claiming done.** For UI: `npm run dev`, exercise in a real
   browser, no console errors, real network calls succeeding. For services:
   run them against devnet/real APIs and show output. If you can't verify a step,
   **say so explicitly**.
6. **Concurrent agents share this worktree.** Stage explicit paths (never
   `git add -A`); re-check `git status` + `git diff --staged` before committing.
7. **Push to `threews` only** on push: `git push threews main`. `threeD` is a
   retired, diverged mirror - **never push, pull, or fetch from it**.
8. **Changelog**: user-visible change → append to `data/changelog.json`
   (community-readable), then `npm run build:pages`. Internal-only chores don't.
9. **Watch the bundler trap** - `npx vercel build` overwrites `api/*.js` in place
   with esbuild bundles. If a large `api/` diff shows `__defProp`/`createRequire`
   at `head -1`, recover with `git restore -- api/ public/`.

## Known environment notes

- **`@three-ws/solana-agent` and `@zauthx402/sdk` ship as TS and need building**
  (`dist/`). In some constrained sandboxes `tsup` bus-errors (esbuild OOM); they
  build in CI (Cloud Build). Task 01 covers unblocking this locally. Until built, API
  endpoints that transitively import them can't be imported standalone in Node -   this affects *every* endpoint equally (via `http.js` → `zauth.js`), not just
  Agora's.
- **Devnet faucet is rate-limited.** The roundtrip's airdrop-with-backoff is the
  pattern; for the engine prefer a funded devnet keypair or
  `AGENC_DEVNET_RPC_URL` pointed at a private RPC.
- **Two engines on one DB fight for keypairs.** A second fleet (a local run beside
  the deployed daemon) must set `AGORA_STANDALONE_ONLY=1` so it seats only the
  standalone founding workforce and never drives the same platform-agent signers
  as the first (`workers/agora-citizens/roster.js`, `buildRoster`).

## Task file format

Every task file follows the same shape so they're predictable to run:
**Goal · Depends on · Context to read first · Background · Build (scope) ·
Out of scope · Contracts (exact shapes/paths) · Definition of Done ·
Verification · Guardrails.**
~~~~

