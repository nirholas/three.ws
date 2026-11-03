---
slug: avatar-parametric-garment-morph-conform
title: Worn hair and garments follow the body's identity morphs on the Parametric base, in the editor and in the bake
tier: P2
score: 55
area: avatar
sources: specs/PARAMETRIC_AVATAR.md, specs/AVATAR_PARAMETERS.md, specs/GARMENT_MANIFEST.md, docs/avatar-studio.md, workers/garment-forge/README.md
---

## Why this matters

The Parametric base lets a user drive 306 identity sliders (jaw, chest, hips, limbs) and the proportions solver. Catalog garments and hair (58 live: 8 hair, 6 tops, 9 bottoms and more, in `gs://three-ws-garments/garments/catalog.json`) are rebound by skin weights, which follows bones and proportions but not the body's morph deltas. A user who widens the chest or jaw sees the shirt or hair stay at the default silhouette and either clip through skin or float. The spec's Reserved table calls this "conforming" garments, and `docs/avatar-studio.md` still tells users the base "ships bare" and conforming is the next phase, which is stale text in either case.

## Current state (measured by the reviewer on 2026-11-03)

- Shipped: additive garments in `appearance.garments`, rebound by `src/avatar-garment.js` (editor) and `api/_lib/bake-garments.js` (server bake), catalog and closet (`src/garment-closet.js`, `src/garment-catalog.js`), region mask (`src/garment-region-mask.js`, `public/avatars/parametric-base.regions.png`), garment-forge deployed on Cloud Run with proximity skin transfer.
- Tests that exist: `tests/avatar-garment.test.js`, `tests/bake-garments.test.js`, `tests/garment-forge-skin-transfer.test.js`, `tests/garment-region-mask.test.js`, `tests/garment-closet-export.test.js`, `tests/bake-proportions.test.js`, `tests/parametric-base.test.js`.
- Not found: any code that transfers body morph deltas onto a worn garment (`grep -n morph src/avatar-garment.js api/_lib/bake-garments.js` shows no morph-target handling).
- `docs/avatar-studio.md` line 72 ("The Parametric base ships bare ... conforming hair and garments are the next phase") contradicts the live garments feature.
- The reviewer did not measure penetration; Step 0 does.

## Step 0: re-derive the current state

```bash
cd /home/user/three.ws
grep -n -iE "morph|conform" src/avatar-garment.js api/_lib/bake-garments.js | head
sed -n 66,80p docs/avatar-studio.md
curl -s https://storage.googleapis.com/three-ws-garments/garments/catalog.json | python3 -c "import json,sys; d=json.load(sys.stdin); d=d if isinstance(d,list) else d['garments']; print(len(d))"
npx vitest run tests/avatar-garment.test.js tests/bake-garments.test.js tests/parametric-base.test.js 2>&1 | tail -6
```

Then measure the defect: write a throwaway script under `scripts/` that loads `public/avatars/parametric-base.glb`, applies a strong chest and jaw morph via `appearance.morphs`, wears one top and one hair piece through the real bake (`bakeAppearance`), and reports the percentage of garment vertices that fall inside the morphed body surface (signed distance via nearest-triangle test). If under 0.5 percent of vertices penetrate by more than 2 mm across a representative morph set, record that and reduce Task 2 to the docs fix and a regression test only.

## Tasks

1. Test-first: add `tests/avatar-garment-morph-conform.test.js`. Build the real parametric base, apply a fixed table of morph and proportion settings, wear a real catalog top, bottom and hair piece, and assert a penetration ceiling and a maximum standoff (garment never farther than a tolerance from the body where the rest pose had contact). Confirm it fails for the penetration reason before any fix.
2. Implement morph conform in one shared pure module `src/garment-conform.js` (dependency-free, like `src/avatar-proportions.js`): for each garment vertex, find its nearest body triangle in the rest pose, store barycentric coordinates and offset along the normal, and at apply time move the vertex by the interpolated body morph delta (identity morphs and `sculpt` deltas), with a falloff so loose cloth stays loose (use the garment manifest `fit` or region metadata; read `specs/GARMENT_MANIFEST.md`).
3. Wire it into the editor path in `src/avatar-garment.js` (re-run on morph slider change, throttled with `requestAnimationFrame`, no per-frame allocation) and into `api/_lib/bake-garments.js` so the baked GLB is identical to what the editor shows. Both import the same module; add a parity test asserting editor and bake vertex positions agree within 0.1 mm.
4. Performance: assert in a test that conform for a 20k-vertex garment completes in under a budget you measure and record (use a precomputed binding cached on the garment instance), and that no extra morph targets are added (the 96 MB VRAM budget in `tests/parametric-base.test.js` must still pass).
5. Rigid garments (glasses, headwear flagged rigid in the manifest) must follow a bone, not deform: test that they are skipped.
6. Browser verification on `/avatar-studio`: pick the Parametric base, wear a top and hair, drag a chest, jaw and hip slider, and confirm the garment tracks with no clipping, no console errors, and the Wardrobe tab keeps its hover, focus, empty and loading states.
7. Fix `docs/avatar-studio.md` (line 72 and the Parametric section), `specs/PARAMETRIC_AVATAR.md` Reserved table (mark `slots` as delivered as `garments`, with conform noted), and `specs/AVATAR_PARAMETERS.md`. Add a `data/changelog.json` entry and run `npm run build:pages`.

## Definition of done

- [ ] `npx vitest run tests/avatar-garment-morph-conform.test.js tests/avatar-garment.test.js tests/bake-garments.test.js tests/parametric-base.test.js` passes, and the new test was observed failing before the fix.
- [ ] Editor and bake parity test passes (garment vertices within 0.1 mm).
- [ ] `grep -n "ships bare" docs/avatar-studio.md` returns nothing.
- [ ] In a real browser at `/avatar-studio`, a worn top follows a chest slider with zero visible clipping and zero console errors (note the morph values used in the report).

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Penetration already below threshold | Record the measurement, keep the regression test and docs fix, skip the algorithm |
| Catalog fetch blocked in tests | Use garment GLBs from the catalog downloaded once into a gitignored cache, or `workers/garment-forge` test fixtures |
| swiftshader stalls the 3D page | Use the light-page harness in memory note play-browser-verify-without-world, or verify through the bake output and a rendered thumbnail |
