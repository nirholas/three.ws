# Parametric avatars carry texture layers (complexion, makeup, tattoos, decals) over the canonical UVs

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/745-plan-avatar-parametric-texture-layers.md`.

**Priority:** P2, new capability with clear value (score 44 of 100 inside the tier). **Area:** avatar. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Parametric avatars can change shape in 306 ways but not surface: the only skin control is a flat tint. Complexion variation, makeup, freckles, scars and tattoos are the most requested personalization on any character creator, and the base already ships canonical UVs plus a baked region mask (`public/avatars/parametric-base.regions.png`) that make a layer system tractable. The `layers` key is reserved in the appearance schema so nothing else may claim it; the feature itself does not exist.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Spec: `specs/AVATAR_PARAMETERS.md` Reserved table lists `layers` ("texture layers over the canonical UVs"); `specs/PARAMETRIC_AVATAR.md` calls it phase 6.
- Appearance schema: `avatarAppearance` in `api/_lib/validate.js` (line ~22); bake in `api/_lib/bake.js` (`bakeAppearance`, `isBakeable`); editor in `src/avatar-studio.js`; region mask helper `src/garment-region-mask.js`.
- No `layers` handling in `src/avatar-studio.js`, `api/_lib/bake.js` or the schema (the Studio's "Layers block" refers to garment visibility, a different thing).
- Sculpt and proportions already show the pattern for adding a parameter class: `src/avatar-sculpt.js` + `api/_lib/bake-sculpt.js`, `src/avatar-proportions.js` + `api/_lib/bake-proportions.js`, each with a test.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
grep -n "layers" api/_lib/validate.js api/_lib/bake.js src/avatar-studio.js | head
sed -n 15,45p specs/AVATAR_PARAMETERS.md
ls api/_lib/bake-*.js tests/bake-*.test.js
node -e "const {NodeIO}=require('@gltf-transform/core');(async()=>{const d=await new NodeIO().read('public/avatars/parametric-base.glb');for(const m of d.getRoot().listMaterials())console.log(m.getName(),!!m.getBaseColorTexture())})()"
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Spec first: extend `specs/AVATAR_PARAMETERS.md` with the `layers` contract: ordered array of `{ id, kind: 'complexion'|'makeup'|'tattoo'|'decal', source, region, opacity, blend: 'multiply'|'normal'|'overlay', uv: {offset, scale, rotation}, tint }`, size caps, and the maximum number of layers. `source` references an immutable catalog asset or an uploaded image id, never raw data URLs.
2. Add the schema to `avatarAppearance` in `api/_lib/validate.js` with strict caps and `tests` rejecting oversize, unknown kinds, and external URLs.
3. Pure compositor `src/avatar-layers.js` (dependency-free, usable in browser and Node via an injected canvas or `sharp`-style raster adapter): composites layers into one base-color texture at a fixed resolution (2048 default), clipping to the named region from the region mask so a tattoo cannot spill onto lips or eyes. Deterministic output so the bake is cacheable by hash.
4. Bake: `api/_lib/bake-layers.js` composites server-side and replaces the skin material's base color texture in `bakeAppearance`, wired into `isBakeable`. Cache by layer-stack hash. `tests/bake-layers.test.js` asserts determinism (same input, same sha256 PNG), region clipping, and that the GLB stays within the 12 MB file ceiling.
5. Catalog: ship a real starter set of CC0 or self-authored layers (complexion ramps, 6 to 10 makeup looks, freckles, a tattoo/decal set) produced with a script in `scripts/` from procedural generation or CC0 sources recorded in a `LICENSES` file; host in `gs://three-ws-garments/layers/` or the repo `public/avatars/layers/`. No placeholder art.
6. Editor UI in `src/avatar-studio.js`: a "Skin" tab with layer list, add, reorder, opacity, region, tint, remove; thumbnails, hover/focus/active states, empty state ("no layers yet, add a complexion or makeup look"), error state for failed uploads, skeleton while the catalog loads. Live preview updates the material texture without rebuilding the scene.
7. Upload path for custom decals reuses the existing avatar asset upload routes (grep `api/avatars` for upload handlers), with size/type validation and moderation hook if one exists.
8. Verify in a real browser; docs in `docs/avatar-studio.md`, `specs/PARAMETRIC_AVATAR.md` (phase 6 delivered), `data/changelog.json`, `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/bake-layers.test.js tests/avatar-layers.test.js tests/avatar-bake.test.js tests/parametric-base.test.js` passes.
- [ ] Baking the same appearance twice yields identical texture hashes (test asserts it).
- [ ] A saved avatar with a tattoo and makeup layer returns a GLB from the avatar's public URL whose skin material references the composited texture (check with `@gltf-transform` in a test).
- [ ] In the browser the Skin tab adds, reorders and removes layers with live preview and zero console errors.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No art assets | Generate the starter set procedurally with a committed script, or use CC0 packs with recorded licences |
| Server image compositing library missing | Use `sharp` if present in dependencies; otherwise gltf-transform plus a pure JS PNG codec already in node_modules |
| Texture size bloats GLB past 12 MB | Compress to WebP or KTX2 using existing glTF-transform extensions and assert the ceiling in a test |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/745-plan-avatar-parametric-texture-layers.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `745-plan-avatar-parametric-texture-layers.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material

The planning docs this order was derived from. They are referenced rather than inlined so this order stays under the 50,000-character paste limit: read each one before Step 0. Where a source still exists, the live file may be newer than this order: re-read it, and trust the code over both.

- `specs/PARAMETRIC_AVATAR.md`
- `specs/AVATAR_PARAMETERS.md`
- `docs/avatar-studio.md`
