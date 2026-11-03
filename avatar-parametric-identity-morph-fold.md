---
slug: avatar-parametric-identity-morph-fold
title: Bake folds applied identity morphs into vertex positions so served avatars carry only expression targets
tier: P3
score: 36
area: avatar
sources: specs/PARAMETRIC_AVATAR.md#The VRAM budget (the real ceiling on slider count), specs/PARAMETRIC_AVATAR.md#Reserved, scripts/build-parametric-base.mjs
---

## Why this matters

three.js allocates one dense float layer per morph target, so every viewer of every Parametric avatar pays 68 MB of VRAM for the 306 identity sliders even when the avatar's saved sliders were baked long ago. That blocks growing past 306 sliders (the baker caps at 96 MB, `MORPH_VRAM_BUDGET_MB`) and hurts low-end phones, AR quick-look and /play where many avatars load at once. Folding the user's applied identity morphs into POSITION at bake time and shipping only the 52 ARKit expression targets removes the cost for all consumers.

## Current state (measured by the reviewer on 2026-11-03)

- `scripts/build-parametric-base.mjs` bakes the base with 306 identity morphs; `tests/parametric-base.test.js` asserts the 96 MB ceiling and 12 MB file ceiling.
- `api/_lib/bake.js` applies morphs as node weights in the bake and proportions via `api/_lib/bake-proportions.js` and sculpt via `api/_lib/bake-sculpt.js`; no fold step exists (the spec says it was deferred because normal recomputation on a skinned mesh is hard).
- Related tests: `tests/avatar-bake.test.js`, `tests/bake-proportions.test.js`, `tests/avatar-sculpt-brush.test.js`.

## Step 0: re-derive the current state

```bash
cd /home/user/three.ws
grep -n -iE "fold|MORPH_VRAM" api/_lib/bake*.js scripts/build-parametric-base.mjs | head
npx vitest run tests/parametric-base.test.js tests/avatar-bake.test.js 2>&1 | tail -6
node -e "const {NodeIO}=require('@gltf-transform/core');(async()=>{const d=await new NodeIO().read('public/avatars/parametric-base.glb');for(const p of d.getRoot().listMeshes().flatMap(m=>m.listPrimitives()))console.log(p.listTargets().length,p.getAttribute('POSITION').getCount())})()"
```

## Tasks

1. Test-first: `tests/bake-morph-fold.test.js`. Using the real base, bake a fixed appearance (several identity morphs, one proportion, one sculpt delta) twice: with the current weights-as-node path and with the fold. Assert folded POSITION equals the weighted sum within 1e-5 per vertex, only ARKit targets remain, and normals match a reference recompute.
2. Implement `api/_lib/bake-morph-fold.js`: apply identity morph weights to POSITION (and TANGENT if present), then recompute normals. Because the mesh is skinned, compute normals in bind pose (rest, unskinned), area-weighted with angle weighting, respecting UV seams and the base's hard-edge splits so seams do not crack (weld by position for the normal calculation, write back per vertex). Delete the identity targets from the primitive and from `mesh.extras.targetNames`.
3. Order the pipeline in `bakeAppearance`: fold morphs, then proportions, then sculpt, then garments, and prove in a test that `bake-proportions` and sculpt still compose (proportions rewrite the rest skeleton and inverse bind matrices, so folding must happen on the original bind geometry first).
4. Keep a non-folded path for the editor (the editor still needs live sliders); the fold applies only to served bakes. Add the flag to the bake cache key so old and new bakes do not collide, and add a one-off re-bake script `scripts/rebake-avatars.mjs` (dry run by default, `--apply` flag) reusing the existing bulk re-bake route or helper if one exists.
5. Measurement: record VRAM before and after (targets x vertices x 16 bytes) and file size for the base with a typical appearance; assert in the test that VRAM drops below 10 MB.
6. Only after the fold lands, evaluate raising the slider ceiling: do not add sliders in this order; just document the new headroom in `specs/PARAMETRIC_AVATAR.md` and remove the "not in v1" wording.
7. Docs and `data/changelog.json`.

## Definition of done

- [ ] `npx vitest run tests/bake-morph-fold.test.js tests/parametric-base.test.js tests/avatar-bake.test.js tests/bake-proportions.test.js` passes; the fold test was seen failing first.
- [ ] A folded bake of the base with a fixed appearance reports under 10 MB of morph VRAM and only expression targets.
- [ ] A rendered thumbnail of folded versus unfolded bake differs by under 1 percent mean pixel error (script in `scripts/`, output recorded in the report).
- [ ] `node scripts/rebake-avatars.mjs` (dry run) lists the candidate avatars without writing.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Visible seam cracks after normal recompute | Weld by position for the accumulation pass, write back per vertex; test with the base's UV seam vertex pairs |
| Garments baked after the fold look off | Order is fold first, garment rebinding after; garments use bone binding so they are unaffected |
| Existing avatars would change appearance | The fold is bake-only and cache-keyed; do not run `--apply` without checking the dry-run diff count |
