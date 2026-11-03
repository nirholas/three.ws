---
slug: avatar-parametric-texture-layers
title: Parametric avatars carry texture layers (complexion, makeup, tattoos, decals) over the canonical UVs
tier: P2
score: 44
area: avatar
sources: specs/PARAMETRIC_AVATAR.md, specs/AVATAR_PARAMETERS.md, docs/avatar-studio.md
---

## Why this matters

Parametric avatars can change shape in 306 ways but not surface: the only skin control is a flat tint. Complexion variation, makeup, freckles, scars and tattoos are the most requested personalization on any character creator, and the base already ships canonical UVs plus a baked region mask (`public/avatars/parametric-base.regions.png`) that make a layer system tractable. The `layers` key is reserved in the appearance schema so nothing else may claim it; the feature itself does not exist.

## Current state (measured by the reviewer on 2026-11-03)

- Spec: `specs/AVATAR_PARAMETERS.md` Reserved table lists `layers` ("texture layers over the canonical UVs"); `specs/PARAMETRIC_AVATAR.md` calls it phase 6.
- Appearance schema: `avatarAppearance` in `api/_lib/validate.js` (line ~22); bake in `api/_lib/bake.js` (`bakeAppearance`, `isBakeable`); editor in `src/avatar-studio.js`; region mask helper `src/garment-region-mask.js`.
- No `layers` handling in `src/avatar-studio.js`, `api/_lib/bake.js` or the schema (the Studio's "Layers block" refers to garment visibility, a different thing).
- Sculpt and proportions already show the pattern for adding a parameter class: `src/avatar-sculpt.js` + `api/_lib/bake-sculpt.js`, `src/avatar-proportions.js` + `api/_lib/bake-proportions.js`, each with a test.

## Step 0: re-derive the current state

```bash
cd /home/user/three.ws
grep -n "layers" api/_lib/validate.js api/_lib/bake.js src/avatar-studio.js | head
sed -n 15,45p specs/AVATAR_PARAMETERS.md
ls api/_lib/bake-*.js tests/bake-*.test.js
node -e "const {NodeIO}=require('@gltf-transform/core');(async()=>{const d=await new NodeIO().read('public/avatars/parametric-base.glb');for(const m of d.getRoot().listMaterials())console.log(m.getName(),!!m.getBaseColorTexture())})()"
```

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

- [ ] `npx vitest run tests/bake-layers.test.js tests/avatar-layers.test.js tests/avatar-bake.test.js tests/parametric-base.test.js` passes.
- [ ] Baking the same appearance twice yields identical texture hashes (test asserts it).
- [ ] A saved avatar with a tattoo and makeup layer returns a GLB from the avatar's public URL whose skin material references the composited texture (check with `@gltf-transform` in a test).
- [ ] In the browser the Skin tab adds, reorders and removes layers with live preview and zero console errors.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No art assets | Generate the starter set procedurally with a committed script, or use CC0 packs with recorded licences |
| Server image compositing library missing | Use `sharp` if present in dependencies; otherwise gltf-transform plus a pure JS PNG codec already in node_modules |
| Texture size bloats GLB past 12 MB | Compress to WebP or KTX2 using existing glTF-transform extensions and assert the ceiling in a test |
