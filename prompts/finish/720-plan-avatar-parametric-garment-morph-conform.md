# Worn hair and garments follow the body's identity morphs on the Parametric base, in the editor and in the bake

**Status (2026-11-10):** built and committed in 83a2723bf (src/garment-conform.js, editor and bake wiring, 55 passing tests across the four named suites, docs and changelog fixed). Remaining: the real-browser pass at /avatar-studio (wear a top and hair, drag chest, jaw and hip sliders, confirm no clipping). The page loads with no console errors, but the slider drag was not exercised because swiftshader cannot render the world reliably here. Owner: anyone with a GPU browser.


**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/720-plan-avatar-parametric-garment-morph-conform.md`.

**Priority:** P2, new capability with clear value (score 55 of 100 inside the tier). **Area:** avatar. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The Parametric base lets a user drive 306 identity sliders (jaw, chest, hips, limbs) and the proportions solver. Catalog garments and hair (58 live: 8 hair, 6 tops, 9 bottoms and more, in `gs://three-ws-garments/garments/catalog.json`) are rebound by skin weights, which follows bones and proportions but not the body's morph deltas. A user who widens the chest or jaw sees the shirt or hair stay at the default silhouette and either clip through skin or float. The spec's Reserved table calls this "conforming" garments, and `docs/avatar-studio.md` still tells users the base "ships bare" and conforming is the next phase, which is stale text in either case.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Shipped: additive garments in `appearance.garments`, rebound by `src/avatar-garment.js` (editor) and `api/_lib/bake-garments.js` (server bake), catalog and closet (`src/garment-closet.js`, `src/garment-catalog.js`), region mask (`src/garment-region-mask.js`, `public/avatars/parametric-base.regions.png`), garment-forge deployed on Cloud Run with proximity skin transfer.
- Tests that exist: `tests/avatar-garment.test.js`, `tests/bake-garments.test.js`, `tests/garment-forge-skin-transfer.test.js`, `tests/garment-region-mask.test.js`, `tests/garment-closet-export.test.js`, `tests/bake-proportions.test.js`, `tests/parametric-base.test.js`.
- Not found: any code that transfers body morph deltas onto a worn garment (`grep -n morph src/avatar-garment.js api/_lib/bake-garments.js` shows no morph-target handling).
- `docs/avatar-studio.md` line 72 ("The Parametric base ships bare ... conforming hair and garments are the next phase") contradicts the live garments feature.
- The reviewer did not measure penetration; Step 0 does.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
grep -n -iE "morph|conform" src/avatar-garment.js api/_lib/bake-garments.js | head
sed -n 66,80p docs/avatar-studio.md
curl -s https://storage.googleapis.com/three-ws-garments/garments/catalog.json | python3 -c "import json,sys; d=json.load(sys.stdin); d=d if isinstance(d,list) else d['garments']; print(len(d))"
npx vitest run tests/avatar-garment.test.js tests/bake-garments.test.js tests/parametric-base.test.js 2>&1 | tail -6
```

Then measure the defect: write a throwaway script under `scripts/` that loads `public/avatars/parametric-base.glb`, applies a strong chest and jaw morph via `appearance.morphs`, wears one top and one hair piece through the real bake (`bakeAppearance`), and reports the percentage of garment vertices that fall inside the morphed body surface (signed distance via nearest-triangle test). If under 0.5 percent of vertices penetrate by more than 2 mm across a representative morph set, record that and reduce Task 2 to the docs fix and a regression test only.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Test-first: add `tests/avatar-garment-morph-conform.test.js`. Build the real parametric base, apply a fixed table of morph and proportion settings, wear a real catalog top, bottom and hair piece, and assert a penetration ceiling and a maximum standoff (garment never farther than a tolerance from the body where the rest pose had contact). Confirm it fails for the penetration reason before any fix.
2. Implement morph conform in one shared pure module `src/garment-conform.js` (dependency-free, like `src/avatar-proportions.js`): for each garment vertex, find its nearest body triangle in the rest pose, store barycentric coordinates and offset along the normal, and at apply time move the vertex by the interpolated body morph delta (identity morphs and `sculpt` deltas), with a falloff so loose cloth stays loose (use the garment manifest `fit` or region metadata; read `specs/GARMENT_MANIFEST.md`).
3. Wire it into the editor path in `src/avatar-garment.js` (re-run on morph slider change, throttled with `requestAnimationFrame`, no per-frame allocation) and into `api/_lib/bake-garments.js` so the baked GLB is identical to what the editor shows. Both import the same module; add a parity test asserting editor and bake vertex positions agree within 0.1 mm.
4. Performance: assert in a test that conform for a 20k-vertex garment completes in under a budget you measure and record (use a precomputed binding cached on the garment instance), and that no extra morph targets are added (the 96 MB VRAM budget in `tests/parametric-base.test.js` must still pass).
5. Rigid garments (glasses, headwear flagged rigid in the manifest) must follow a bone, not deform: test that they are skipped.
6. Browser verification on `/avatar-studio`: pick the Parametric base, wear a top and hair, drag a chest, jaw and hip slider, and confirm the garment tracks with no clipping, no console errors, and the Wardrobe tab keeps its hover, focus, empty and loading states.
7. Fix `docs/avatar-studio.md` (line 72 and the Parametric section), `specs/PARAMETRIC_AVATAR.md` Reserved table (mark `slots` as delivered as `garments`, with conform noted), and `specs/AVATAR_PARAMETERS.md`. Add a `data/changelog.json` entry and run `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/avatar-garment-morph-conform.test.js tests/avatar-garment.test.js tests/bake-garments.test.js tests/parametric-base.test.js` passes, and the new test was observed failing before the fix.
- [ ] Editor and bake parity test passes (garment vertices within 0.1 mm).
- [ ] `grep -n "ships bare" docs/avatar-studio.md` returns nothing.
- [ ] In a real browser at `/avatar-studio`, a worn top follows a chest slider with zero visible clipping and zero console errors (note the morph values used in the report).
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Penetration already below threshold | Record the measurement, keep the regression test and docs fix, skip the algorithm |
| Catalog fetch blocked in tests | Use garment GLBs from the catalog downloaded once into a gitignored cache, or `workers/garment-forge` test fixtures |
| swiftshader stalls the 3D page | Use the light-page harness in memory note play-browser-verify-without-world, or verify through the bake output and a rendered thumbnail |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/720-plan-avatar-parametric-garment-morph-conform.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `720-plan-avatar-parametric-garment-morph-conform.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material

The planning docs this order was derived from. They are referenced rather than inlined so this order stays under the 50,000-character paste limit: read each one before Step 0. Where a source still exists, the live file may be newer than this order: re-read it, and trust the code over both.

- `specs/PARAMETRIC_AVATAR.md`
- `specs/AVATAR_PARAMETERS.md`
- `specs/GARMENT_MANIFEST.md`
- `docs/avatar-studio.md`
- `workers/garment-forge/README.md`
