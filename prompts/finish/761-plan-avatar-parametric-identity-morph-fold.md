# Bake folds applied identity morphs into vertex positions so served avatars carry only expression targets

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/761-plan-avatar-parametric-identity-morph-fold.md`.

**Priority:** P3, polish, developer experience, or exploratory (score 36 of 100 inside the tier). **Area:** avatar. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

three.js allocates one dense float layer per morph target, so every viewer of every Parametric avatar pays 68 MB of VRAM for the 306 identity sliders even when the avatar's saved sliders were baked long ago. That blocks growing past 306 sliders (the baker caps at 96 MB, `MORPH_VRAM_BUDGET_MB`) and hurts low-end phones, AR quick-look and /play where many avatars load at once. Folding the user's applied identity morphs into POSITION at bake time and shipping only the 52 ARKit expression targets removes the cost for all consumers.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `scripts/build-parametric-base.mjs` bakes the base with 306 identity morphs; `tests/parametric-base.test.js` asserts the 96 MB ceiling and 12 MB file ceiling.
- `api/_lib/bake.js` applies morphs as node weights in the bake and proportions via `api/_lib/bake-proportions.js` and sculpt via `api/_lib/bake-sculpt.js`; no fold step exists (the spec says it was deferred because normal recomputation on a skinned mesh is hard).
- Related tests: `tests/avatar-bake.test.js`, `tests/bake-proportions.test.js`, `tests/avatar-sculpt-brush.test.js`.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
grep -n -iE "fold|MORPH_VRAM" api/_lib/bake*.js scripts/build-parametric-base.mjs | head
npx vitest run tests/parametric-base.test.js tests/avatar-bake.test.js 2>&1 | tail -6
node -e "const {NodeIO}=require('@gltf-transform/core');(async()=>{const d=await new NodeIO().read('public/avatars/parametric-base.glb');for(const p of d.getRoot().listMeshes().flatMap(m=>m.listPrimitives()))console.log(p.listTargets().length,p.getAttribute('POSITION').getCount())})()"
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Test-first: `tests/bake-morph-fold.test.js`. Using the real base, bake a fixed appearance (several identity morphs, one proportion, one sculpt delta) twice: with the current weights-as-node path and with the fold. Assert folded POSITION equals the weighted sum within 1e-5 per vertex, only ARKit targets remain, and normals match a reference recompute.
2. Implement `api/_lib/bake-morph-fold.js`: apply identity morph weights to POSITION (and TANGENT if present), then recompute normals. Because the mesh is skinned, compute normals in bind pose (rest, unskinned), area-weighted with angle weighting, respecting UV seams and the base's hard-edge splits so seams do not crack (weld by position for the normal calculation, write back per vertex). Delete the identity targets from the primitive and from `mesh.extras.targetNames`.
3. Order the pipeline in `bakeAppearance`: fold morphs, then proportions, then sculpt, then garments, and prove in a test that `bake-proportions` and sculpt still compose (proportions rewrite the rest skeleton and inverse bind matrices, so folding must happen on the original bind geometry first).
4. Keep a non-folded path for the editor (the editor still needs live sliders); the fold applies only to served bakes. Add the flag to the bake cache key so old and new bakes do not collide, and add a one-off re-bake script `scripts/rebake-avatars.mjs` (dry run by default, `--apply` flag) reusing the existing bulk re-bake route or helper if one exists.
5. Measurement: record VRAM before and after (targets x vertices x 16 bytes) and file size for the base with a typical appearance; assert in the test that VRAM drops below 10 MB.
6. Only after the fold lands, evaluate raising the slider ceiling: do not add sliders in this order; just document the new headroom in `specs/PARAMETRIC_AVATAR.md` and remove the "not in v1" wording.
7. Docs and `data/changelog.json`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/bake-morph-fold.test.js tests/parametric-base.test.js tests/avatar-bake.test.js tests/bake-proportions.test.js` passes; the fold test was seen failing first.
- [ ] A folded bake of the base with a fixed appearance reports under 10 MB of morph VRAM and only expression targets.
- [ ] A rendered thumbnail of folded versus unfolded bake differs by under 1 percent mean pixel error (script in `scripts/`, output recorded in the report).
- [ ] `node scripts/rebake-avatars.mjs` (dry run) lists the candidate avatars without writing.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Visible seam cracks after normal recompute | Weld by position for the accumulation pass, write back per vertex; test with the base's UV seam vertex pairs |
| Garments baked after the fold look off | Order is fold first, garment rebinding after; garments use bone binding so they are unaffected |
| Existing avatars would change appearance | The fold is bake-only and cache-keyed; do not run `--apply` without checking the dry-run diff count |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/761-plan-avatar-parametric-identity-morph-fold.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `761-plan-avatar-parametric-identity-morph-fold.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

Code and config the reviewer cited alongside these docs (read them in the repo; they are not copied here): `scripts/build-parametric-base.mjs`.

### `specs/PARAMETRIC_AVATAR.md` (section "The VRAM budget (the real ceiling on slider count)")

~~~~markdown
### The VRAM budget (the real ceiling on slider count)

three.js uploads morph targets as an RGBA32F `DataArrayTexture` with **one dense layer per target**, allocated whether a slider sits at zero or not (`node_modules/three/src/renderers/webgl/WebGLMorphtargets.js`). The cost is therefore `targets x vertices x 16 bytes`, and it is paid by every viewer of every avatar built on this base, not only by the editor.

Sparse glTF accessors keep the *download* small (306 sliders cost 6.5 MB on disk, up from 4.1 MB at 122) and do nothing at all for VRAM. At 306 targets the base needs **68.0 MB**. The baker enforces a **96 MB** ceiling (`MORPH_VRAM_BUDGET_MB`) and a 12 MB file ceiling, and fails the bake rather than shipping past them. `tests/parametric-base.test.js` asserts the same number independently.

Growing well past 306 sliders therefore needs the identity-morph fold described under **Reserved** below, not a bigger budget.
~~~~

### `specs/PARAMETRIC_AVATAR.md` (section "Reserved")

~~~~markdown
## Reserved

| Item | For |
|---|---|
| Identity-morph fold | Folding applied identity morphs into `POSITION` at bake time, with recomputed normals, so a served avatar carries only the ARKit expression targets. That is what lifts the 96 MB budget and unblocks 400+ sliders. It needs correct normal recomputation on a skinned mesh, which is why it is not in v1. |
| `slots` | Conforming hair and garments auto-fitted to the canonical body (phase 3, `workers/garment-forge`) |
| `layers` | Texture layers over the canonical UVs: complexion, makeup, tattoos, decals, age maps (phase 6) |
| `animation` | Per-avatar animation identity: default idle and walk, gesture intensity, mood blend, emote loadout (phase 7) |
~~~~

