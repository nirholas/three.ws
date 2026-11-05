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

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `specs/PARAMETRIC_AVATAR.md` (whole file)

~~~~markdown
# Parametric Avatar v1

**Status:** live. Base body, morph library, skeleton proportions and free sculpt all ship. Conforming assets (phase 3), identity capture into parameters (phase 5), texture layers (phase 6) and animation identity (phase 7) are reserved and named at the bottom.

This spec describes the **base body and the editing pipeline over it**: what `parametric-base-v1` is, what a consumer is allowed to assume about it, and which of its capabilities every downstream surface must honour. The serialized record that describes one avatar built on it is [`AVATAR_PARAMETERS.md`](./AVATAR_PARAMETERS.md); the two are read together.

## The architectural decision

**One canonical parametric body. Everything else is a parameter over it.**

Shape is morph targets. Build is skeleton parameters. Anything neither can express is free-sculpt vertex deltas. Garments and hair are conforming attachments that inherit the same skinning. Identity capture (a selfie, a text prompt) is a solver whose *output* is a parameter vector, not a mesh.

Fixed topology is what makes all of that tractable. Because every avatar on this base has the same vertex ordering, the same UVs and the same 52-bone skeleton, a delta recorded on one body is meaningful on another, a garment fitted once fits every variant, and the whole pre-baked animation library retargets by construction.

## `parametric-base-v1`

| Property | Value | Source of truth |
|---|---|---|
| Asset | `public/avatars/parametric-base.glb` | `scripts/build-parametric-base.mjs` |
| Source data | CC0 MakeHuman / MPFB2 | `avatar-sources/anny/README.md` |
| Skeleton | 52 joints, `mixamorig:*`, Y-up metres, feet on the floor, facing +Z | `avatar-sources/anny/rigs/rig.mixamo.json` |
| Submeshes | `Body`, `Eyes`, `Teeth`, `Tongue`, one primitive each | `SUBMESHES` in the baker |
| Body topology | 14517 vertices, 26756 triangles | the GLB |
| Morph sliders | 306, all sparse glTF morph targets | `MORPHS` in the baker |
| Hips rest height | 0.912 m | the GLB |

The bone names canonicalize through `src/glb-canonicalize.js`, which is what makes every clip in `public/animations/clips/` play on this rig with no per-rig authoring. `tests/parametric-base.test.js` asserts that, plus geometry validity, morph localization and the budget below.

### Selecting it

Avatar Studio at `/create/studio?base=parametric`. Any surface that loads the GLB directly gets the same body; there is nothing else to opt into.

### Morph inventory

The sculpt panel renders one slider per morph target the loaded GLB exposes, so **the base defines the editor**. Adding a slider is an entry in the baker's `MORPHS` table plus a rebake; no UI change. Current grouping (`CATEGORIES` in `src/avatar-sculpt.js`):

| Group | Sliders | Group | Sliders |
|---|---|---|---|
| Eyes | 42 | Neck | 10 |
| Nose | 36 | Torso | 22 |
| Mouth | 35 | Hips & Midsection | 17 |
| Ears | 32 | Arms | 15 |
| Head Shape | 27 | Legs | 22 |
| Cheeks | 16 | Body | 12 |
| Jaw | 14 | Brows | 6 |

Naming rules, because the group a slider lands in is derived from its name and nothing else:

- Face regions keep **per-side** sliders (`earTriangleLeft` / `earTriangleRight`). Facial asymmetry is an identity feature, and the panel's mirror lock already collapses a pair to one control for users who do not want it.
- Limbs use **one symmetric slider** driving both sides (`armsUpperWider`). A one-armed width edit reads as a defect, not a look.
- A `decr` / `incr` source pair becomes two `0..1` sliders, because the panel has no negative range.
- Every name MUST match one category regex. `tests/parametric-base.test.js` fails the build's test stage if a slider would fall into the "Other" drawer.

### The VRAM budget (the real ceiling on slider count)

three.js uploads morph targets as an RGBA32F `DataArrayTexture` with **one dense layer per target**, allocated whether a slider sits at zero or not (`node_modules/three/src/renderers/webgl/WebGLMorphtargets.js`). The cost is therefore `targets x vertices x 16 bytes`, and it is paid by every viewer of every avatar built on this base, not only by the editor.

Sparse glTF accessors keep the *download* small (306 sliders cost 6.5 MB on disk, up from 4.1 MB at 122) and do nothing at all for VRAM. At 306 targets the base needs **68.0 MB**. The baker enforces a **96 MB** ceiling (`MORPH_VRAM_BUDGET_MB`) and a 12 MB file ceiling, and fails the bake rather than shipping past them. `tests/parametric-base.test.js` asserts the same number independently.

Growing well past 306 sliders therefore needs the identity-morph fold described under **Reserved** below, not a bigger budget.

## Editing pipeline

Three parameter classes, in the order they are applied. Each is independent: changing one never invalidates another.

### 1. Morphs (shape)

`appearance.morphs`, `{ name: weight }`. Applied to `morphTargetInfluences` in the browser and to node weights in the bake. Full contract in [`AVATAR_PARAMETERS.md`](./AVATAR_PARAMETERS.md#morphs-shape).

### 2. Proportions (build)

`appearance.proportions`, `{ id: ratio }` around 1.0. A morph cannot lengthen a limb (its deltas are fixed in bind space, so the skin tears off the bone that drives it), so length, width and stature rewrite the rest `position` / `scale` of canonical bones instead.

The maths lives once, in `src/avatar-proportions.js`, and is dependency-free precisely so all three consumers run the identical solver:

| Consumer | Adapter |
|---|---|
| Browser live preview | `applyProportionsToRoot` in `src/avatar-proportions.js` |
| Server bake | `applyProportions` in `api/_lib/bake-proportions.js` |
| Tests | `computeProportionTransforms` directly |

`tests/bake-proportions.test.js` asserts the browser and server adapters produce bit-comparable bone locals on the real base. Invariants (rotations never written, feet stay grounded, root motion re-measured) are specified in [`AVATAR_PARAMETERS.md`](./AVATAR_PARAMETERS.md#proportions-build).

**The server pass is what lands a build, on every path, including the one that looks like it does not need it.** Avatar Studio saves by exporting the live scene, which reads like proportions come along for free. They do not: `exportSceneGlb` calls `poseSkeletonsToBind` first so a clip caught mid-frame cannot be frozen into the file, and that resets every bone from the skin's inverse bind matrices, which a proportion edit deliberately never touches. The build is therefore absent from the exported GLB and is restored by the bake that follows the appearance PATCH. Same on `/avatars/:id/edit`, which never exports at all. If the export neutraliser changes, `tests/bake-proportions.test.js` is the test that says so.

### 3. Free sculpt (everything else)

`appearance.sculpt`. A radius-and-falloff brush that pushes vertices along their own surface normal, recorded as **one extra morph target per mesh**, named `customSculpt`, pinned at weight 1.

Recording it as a morph target rather than editing `POSITION` is the load-bearing choice: the edit stays additive with every library slider, survives `GLTFExporter` with no special case, can be re-applied to the pristine base from the serialized document, and is reversible by clearing one target.

**Space.** Morph deltas live in bind space; the user is pointing at a skinned, morphed, proportion-edited body on screen. Every stroke builds the exact per-vertex bind-to-world map (`bindMatrixInverse x blended bone matrices x bindMatrix`, then the mesh world matrix), displaces in world space, and maps the result back through that map's inverse. The map is sampled once per drag, at pointer-down, so the host freezes clip playback and the procedural idle while the brush is on (`TalkScene.setRigPaused`, `IdleAnimation.getChannels`).

**Symmetry** mirrors the *brush*, not the vertices: the stroke is applied a second time at the point reflected across the avatar's own X = 0 plane, with the direction reflected too. Turning it off is what makes asymmetry reachable.

**Wire format** (`src/avatar-sculpt-doc.js`, dependency-free so browser, server and tests share it):

```json
{
  "version": 1,
  "meshes": {
    "Body": {
      "count": 812,
      "vertexCount": 14517,
      "scale": 3.1e-6,
      "indices": "<base64 Uint32Array[count], little-endian>",
      "deltas":  "<base64 Int16Array[count * 3], little-endian>"
    }
  }
}
```

| Field | Meaning |
|---|---|
| `version` | Document version. A reader MUST reject a version it does not know rather than guess. |
| `meshes` | Keyed by the three.js mesh name, which equals the glTF mesh name on this base. |
| `count` | Recorded vertices for this mesh. Capped at `SCULPT_MAX_VERTS` (20000). |
| `vertexCount` | The mesh's vertex count when the sculpt was recorded. A mismatch means a different topology and the entry MUST be skipped, never force-fitted. |
| `scale` | Metres per quantisation step. `delta_metres = int16 * scale`. |
| `indices` | Vertex indices into the mesh's `POSITION`, ascending. |
| `deltas` | `[dx, dy, dz]` per index, in bind space, clamped to `SCULPT_MAX_DISPLACEMENT` (0.12 m). |

Quantisation is int16 over the recorded peak, which resolves a 0.12 m range to under 4 micrometres: four orders of magnitude finer than anything a viewer can see, and it turns a megabyte of floats into tens of KB of JSON-safe text.

| Consumer | Adapter |
|---|---|
| Browser brush + replay | `src/avatar-sculpt-brush.js` |
| Server bake | `api/_lib/bake-sculpt.js` |
| Record validation | `sanitizeSculptDoc` in `src/avatar-sculpt-doc.js` |

## Versioning

`base` in the appearance record names the body a document was authored against. **Nothing writes it yet** and it is listed as reserved in [`AVATAR_PARAMETERS.md`](./AVATAR_PARAMETERS.md#reserved), because one parametric base ships and a field with one possible value is noise. Until a second base exists, absence means `parametric-v1` for a document that carries `sculpt` or parametric morph names, and "whatever GLB this avatar points at" otherwise, which is the pre-parametric behaviour and stays supported. The rule below is what the field will mean when it lands.

- **Morph names are permanent.** Once a slider ships, its name is a public identifier: it is a key in stored records. Renaming one silently drops a user's edit. Add a new slider instead, and leave the old one baked.
- **Adding sliders is a minor change.** Consumers ignore names they do not have, so an older viewer loading a newer base is a body with fewer controls, never an error.
- **Changing topology is a major change** and mints a new base id. Vertex ordering is the contract free sculpt, garment fitting and skin-weight transfer all depend on; a body that renumbers its vertices is a different body. Existing avatars keep their old base.
- **The document versions are independent.** `sculpt.version` describes the delta encoding, not the body.

## What each consumer may ignore

Every consumer MUST **skip what it cannot apply and still render**, never fail the whole avatar. Beyond that:

| Consumer | MUST honour | MAY ignore |
|---|---|---|
| Avatar Studio / avatar editor | everything it offers a control for | nothing; an unrenderable field still round-trips untouched on save |
| Server bake (`api/_lib/bake.js`) | `morphs`, `proportions`, `sculpt`, `colors`, `hidden`, `outfit`, `accessories`, `garments` | `attachments` (never fetched server-side, applied at runtime) |
| Embeds / `<agent-3d>` | the baked GLB as served | the whole record; it consumes geometry, not parameters |
| External engines (Blender, Unreal, model-viewer) | the baked GLB | the record entirely |
| Identity solvers (phase 5) | the named slider set as their output space | any slider the base does not expose |

The rule behind the table: **the record is authoritative for editors, the baked GLB is authoritative for viewers.** A viewer must never need the parameter document to render correctly, and an editor must never need the baked GLB to reconstruct the parameters.

## Reserved

| Item | For |
|---|---|
| Identity-morph fold | Folding applied identity morphs into `POSITION` at bake time, with recomputed normals, so a served avatar carries only the ARKit expression targets. That is what lifts the 96 MB budget and unblocks 400+ sliders. It needs correct normal recomputation on a skinned mesh, which is why it is not in v1. |
| `slots` | Conforming hair and garments auto-fitted to the canonical body (phase 3, `workers/garment-forge`) |
| `layers` | Texture layers over the canonical UVs: complexion, makeup, tattoos, decals, age maps (phase 6) |
| `animation` | Per-avatar animation identity: default idle and walk, gesture intensity, mood blend, emote loadout (phase 7) |

## Related

- [`AVATAR_PARAMETERS.md`](./AVATAR_PARAMETERS.md): the serialized appearance record.
- [`GARMENT_MANIFEST.md`](./GARMENT_MANIFEST.md): the wearables that conform to this body.
- [`EDITOR_SPEC.md`](./EDITOR_SPEC.md): the authoring surface.
- [`../docs/avatar-studio.md`](../docs/avatar-studio.md): the user-facing guide.
- [`../avatar-sources/anny/README.md`](../avatar-sources/anny/README.md): source data and licence.
~~~~

### `specs/AVATAR_PARAMETERS.md` (whole file)

~~~~markdown
# Avatar Parameter Model v0.1

**Status:** partial (morphs, colors, layers, garments, accessories, proportions and free-sculpt deltas are live; texture layers and animation identity are reserved).

The parameter model is the serialized description of a three.ws avatar's body: one JSON document that says what the character *is*, independent of any particular GLB. It is what saves, what re-opens in the editor, what the server bakes, and what a fork or a share link carries.

The document is stored on `avatars.appearance` and is the single input to both the client-side live preview and the server-side bake. Producers and consumers of it MUST treat it as the contract described here.

## Why a parameter document and not a mesh

An avatar could be stored as its baked GLB alone. That is what a scan-based pipeline does, and it is why a scanned head is not editable afterwards: the parameters that produced it are gone.

Every three.ws avatar keeps its parameters. The GLB is a *render* of the document, regenerable at any time. That is what makes the whole editor composable: a face captured from a photo, a body sculpted with sliders, and a garment generated from a prompt all resolve into fields of the same record, so all three remain editable after the fact and any one of them can be changed without disturbing the others.

## Document

```json
{
  "outfit": "preset-id",
  "accessories": ["preset-id", "..."],
  "morphs": { "noseWider": 0.3, "earPointedLeft": 0.8 },
  "proportions": { "legLength": 1.06, "shoulderWidth": 0.94 },
  "sculpt": { "version": 1, "meshes": { "Body": { "count": 812, "vertexCount": 14517, "scale": 3.1e-6, "indices": "…", "deltas": "…" } } },
  "colors": { "skin": "#c99a70", "hair": "#241a12" },
  "hidden": ["hair"],
  "garments": [{ "slot": "top", "id": "garment-id" }],
  "attachments": [{ "bone": "mixamorig:Head", "url": "https://…/crown.glb", "name": "Horned crown" }]
}
```

Every field is optional. An absent field means "default", and a document with no fields at all is stored as `null` (`isBakeable()` in `api/_lib/bake.js` treats it as nothing to render). Producers MUST omit rather than emit empty values, so that two identical bodies hash identically: the appearance hash is the cache key for the baked GLB.

| Field | Type | Meaning | Implementation |
|---|---|---|---|
| `outfit` | preset id | Baked outfit preset | `api/_lib/accessories.js` |
| `accessories` | preset id[] | Bone-mounted props (hat, glasses, earrings) | `src/agent-accessories.js` |
| `morphs` | name → weight | Shape. Any morph target the loaded GLB exposes, by name | `src/avatar-sculpt.js` |
| `proportions` | id → ratio | Build. Skeleton-space length, width and stature | `src/avatar-proportions.js` |
| `sculpt` | delta document | Free-brush vertex deltas, sparse and quantised | `specs/PARAMETRIC_AVATAR.md` |
| `colors` | slot → hex | Per-slot material tint | `src/avatar-studio.js` |
| `hidden` | slot[] | Garment layers to drop | `src/avatar-wardrobe.js` |
| `garments` | {slot, id}[] | Additive catalog wearables | `specs/GARMENT_MANIFEST.md` |
| `attachments` | {bone, url, name?}[] | Custom bone-mounted props that are in no catalog | `src/agent-accessories.js` |

## `morphs`: shape

`{ morphTargetName: weight }`, weights clamped to `[-1, 1]` (`[0, 1]` in the UI). Names are matched against whatever the loaded GLB actually carries: an unknown name is skipped, never an error, because the same document may be applied to a rig that exposes fewer shapes.

There is no fixed slider list. The parametric base (`public/avatars/parametric-base.glb`) ships 306 identity morphs and the panel renders one slider per morph it finds, so growing the base grows the editor with no UI change. The morph name `customSculpt` is reserved: it carries the `sculpt` field's deltas and is deliberately not offered as a slider, because its weight is pinned at 1.

## `proportions`: build

`{ parameterId: ratio }`. Each value is a ratio around `1.0`, where `1.0` is the base body. Morph targets cannot express this: a morph is a fixed set of vertex deltas in bind space, so it can reshape a limb but not lengthen one without tearing the skin off the bone that drives it. Length, width and stature are therefore skeleton-space parameters.

Parameters (declared in `PROPORTION_PARAMS`, which is the authoritative table):

| id | Range | Operation |
|---|---|---|
| `height` | 0.85 to 1.15 | Uniform scale of the armature node |
| `legLength` | 0.85 to 1.15 | Shin + ankle rest offsets |
| `torsoLength` | 0.85 to 1.15 | Spine chain rest offsets |
| `neckLength` | 0.80 to 1.25 | Neck + head rest offsets |
| `armLength` | 0.85 to 1.15 | Forearm + hand rest offsets |
| `shoulderWidth` | 0.85 to 1.20 | Clavicle + upper-arm lateral offset |
| `hipWidth` | 0.85 to 1.20 | Thigh lateral offset |
| `headSize` | 0.85 to 1.15 | Head joint scale |
| `handSize` | 0.85 to 1.20 | Hand joint scale |
| `footSize` | 0.85 to 1.20 | Foot joint scale |

Three invariants any implementation MUST hold:

1. **Rotations are never written.** Only a joint's rest `position` and `scale` change. This is what keeps proportions composable with everything else: the animation retargeter captures each rig's rest *rotations* at bind time to replay a clip in the target's own frame (`src/animation-retarget.js`), and morph deltas apply in bind space before skinning. Writing a rotation would invalidate both.
2. **The feet stay on the floor.** Lengthening the legs pushes the feet through the ground, so the hips move by the distance the ground bones actually moved, measured on the rig rather than derived from the ratios. Left and right deltas are averaged, which cancels the symmetric spread a width edit produces while preserving the vertical correction a length edit needs.
3. **Root motion is re-measured.** A clip's hip translation is authored around one hip height and rescaled onto the rig at bind time. After a proportion edit that factor is stale and the avatar foot-slides, so consumers call `AnimationManager.remeasureRigProportions()` with the rig at rest.

Values outside a parameter's range are clamped, unknown ids are dropped, and a value within `1e-4` of `1.0` is removed entirely (`normalizeProportions`). A rig missing a parameter's bones simply does not offer that slider (`availableProportionParams`), so the panel never shows a dead control.

## `sculpt`: free-brush deltas

Everything the morph library and the proportion table cannot reach: a dent in one temple, a crooked bridge, a brow ridge in no catalogue. A radius-and-falloff brush pushes vertices along their own surface normal and records the result as one extra morph target per mesh, named `customSculpt` and pinned at weight 1, so the edit stays additive with every library slider and reversible by clearing that one target.

The document is sparse (only vertices that moved) and quantised to int16 over the recorded peak, which resolves the 0.12 m displacement cap to under 4 micrometres. Its field-by-field contract, the bind-space maths and the symmetry rule are specified in [`PARAMETRIC_AVATAR.md`](./PARAMETRIC_AVATAR.md#3-free-sculpt-everything-else); validation is `sanitizeSculptDoc` in `src/avatar-sculpt-doc.js`, applied on both read and write like every other field.

A sculpt is tied to a topology. `vertexCount` records the mesh it was authored against, and a consumer whose mesh disagrees MUST skip that entry rather than force-fit it: a delta applied to the wrong vertices is a disfigured avatar, which is worse than an un-sculpted one.

## `attachments`: custom bone-mounted props

`accessories` names entries in the curated preset catalog, which is what makes a hat portable: the id resolves to a GLB the platform ships. A prop generated on demand (Scene Composer forges one from a text prompt and parents it to a bone) is in no catalog, so it carries its own reference instead:

```json
{ "bone": "mixamorig:Head", "url": "https://…/crown.glb", "name": "Horned crown" }
```

- `bone` is matched the way every other bone lookup is: exact name first, then the canonical form with the rig prefix stripped (`mixamorig:`, `CC_Base_`, `rig_`), so an outfit saved on one rig lands on another rig's equivalent joint. A bone the loaded rig does not have is skipped, per the processing rules below.
- `url` MUST be https on a three.ws asset host, or a same-origin path. Producers and consumers BOTH enforce this (`isTrustedAttachmentUrl` in `api/_lib/accessories.js`, `isSafeQueryModelUrl` in `src/shared/safe-model-url.js`), because a stored attachment is fetched by every browser that renders the avatar, including viewers who do not own it. An unrestricted URL would make one owner's public avatar a relay for arbitrary third-party bytes.
- At most 8 per document, matching `accessories`.
- Attachments are applied at runtime rather than baked: `bakeAppearance()` merges catalog GLBs it can resolve from the pack it ships with, and does not fetch remote URLs server-side. `isBakeable()` therefore ignores this field, and an avatar whose only appearance is attachments keeps serving its base GLB.

## Reserved

Named here so implementations do not claim the keys for anything else:

| Field | For |
|---|---|
| `layers` | Texture layers over the canonical UVs (tattoos, makeup, complexion) |
| `animation` | Per-avatar animation identity (default idle/walk, gesture intensity, mood) |
| `base` | Explicit base-body id, once more than one parametric base ships |

## Processing rules

- **Normalize on read and on write.** Every field is validated at both boundaries. A hand-edited or hostile record must never reach the rig.
- **Skip, do not fail.** An unresolvable morph name, preset id, garment or bone is dropped with a warning. A document that half-applies still produces a usable avatar; one that throws produces none.
- **Order-independent.** The rendered body is a function of the document alone, never of the order fields were applied in.
- **Idempotent.** Applying the same document twice to the same rig yields the same result. Implementations re-apply from a captured bind pose rather than compounding onto the current state.

## Related

- [`PARAMETRIC_AVATAR.md`](./PARAMETRIC_AVATAR.md): the base body these parameters describe, its morph inventory, and the free-sculpt wire format.
- [`GARMENT_MANIFEST.md`](./GARMENT_MANIFEST.md): the wearables `garments` references.
- [`EDITOR_SPEC.md`](./EDITOR_SPEC.md): the authoring surface these parameters are edited in.
- [`docs/avatar-studio.md`](../docs/avatar-studio.md): the user-facing guide to the editor.
~~~~

### `docs/avatar-studio.md` (whole file)

~~~~markdown
# Avatar Studio: build a custom avatar from scratch, no selfie

Avatar Studio builds a fully rigged 3D avatar without a photo. You start from a base body and shape it into your own character: tint skin, hair, and outfit; sculpt the face and body with morph sliders; put on catalog garments from a closet; add hats, glasses, and earrings; hide or show the body's own garment layers to strip back to the base and build a look up; drive the rig live with a library of emotes; and walk the finished avatar around the stage. When you save, the live scene is exported to a GLB exactly as you see it and stored to your account, ready to animate, dress, and use anywhere on the platform.

Page: [/avatar-studio](https://three.ws/avatar-studio) (also reachable at [/create/studio](https://three.ws/create/studio))

## Why it exists

The selfie-to-avatar path is great when you want to look like yourself, but it is a wall when you want to be someone, or something, else. Avatar Studio is the from-scratch path: no camera, no upload, just a base humanoid and the tools to make it yours. It reuses the same building blocks as the platform's avatar editor, the `TalkScene` viewport, the accessory manager, the sculpt panel, and the shared GLB optimize-and-validate path, so an avatar built here is a first-class avatar everywhere, not a lesser one. And because the customization is stored both as a validated GLB (so it always renders right) and as re-editable appearance metadata, you can come back and change it later.

## How it works

The studio mounts a `TalkScene` around a base body and layers a tabbed customization panel over it. A **Base** switcher at the top of the panel picks the starting template (create mode only; a saved avatar always reloads its own model):

- **Stylized** (`/avatars/default.glb`): the dressed feminine stylized body with hair, outfit, and garment layers. The default.
- **Parametric** (`/avatars/parametric-base.glb`): a bare humanoid built from the CC0 MakeHuman/MPFB2 body, baked with **306 identity morph sliders** by [scripts/build-parametric-base.mjs](../scripts/build-parametric-base.mjs). On this base the Sculpt tab becomes a full character creator, grouped into Eyes (42), Nose (36), Mouth (35), Ears (32), Head Shape (27), Torso (22), Legs (22), Cheeks (16), Hips & Midsection (17), Arms (15), Jaw (14), Body (12), Neck (10) and Brows (6). Face regions keep separate left and right sliders because facial asymmetry is part of a face; limbs get one symmetric slider, because a one-armed width edit reads as a defect rather than a look. It rides the same 52-bone Mixamo-named skeleton conventions as everything else, so the entire animation library retargets onto any slider combination. Source data and license provenance: [avatar-sources/anny/README.md](../avatar-sources/anny/README.md); the full contract for the base is [specs/PARAMETRIC_AVATAR.md](../specs/PARAMETRIC_AVATAR.md).

Every edit updates the live scene graph, and a working "appearance" object tracks the whole configuration: chosen colors, morph values, skeleton proportions, accessories, and hidden layers. That record is the avatar's parameter document, specified in [specs/AVATAR_PARAMETERS.md](../specs/AVATAR_PARAMETERS.md).

- **Color.** Material slots (skin, hair, outfit) each offer a curated swatch palette plus a full-spectrum picker (an `iro.js` wheel with hex entry and eyedropper, falling back to the native OS color dialog). Slots the loaded base has no materials for are hidden rather than rendered dead, and "Default" restores the base's authored color. Above them sit **Looks**: one-tap palettes (Noir, Sunset, Arctic, Cyber, Rosé, Forest, Mono, Ember) that theme skin, hair, and outfit together in a single history step, always landing on real, coherent material colors.
- **Face and body sculpt.** The sculpt panel renders grouped morph sliders against whatever morph targets the base carries, organized into Eyes, Brows, Nose, Mouth, Jaw, Cheeks, Ears, Head Shape, Neck, Torso, Hips & Midsection, Arms, Legs and Body, plus a MetaHuman-style 2-D face-type blend wheel over six archetypes and advanced visemes. Left/right paired morphs collapse into one mirrored slider unless you unlock Mirror L/R for asymmetry. It drives real morph targets, so the change is baked into the saved mesh.
- **Finding a slider among hundreds.** Past 80 sliders a filter box appears above the groups. Type `calf`, `cupids bow` or a raw morph name and the panel hides everything else, opening the groups that still have a match; clear it (or press Escape) and every group snaps back to exactly the open/closed state it had. Body-region groups start collapsed and each carries an "N edited" pill on its header, so a group you have already touched is obvious without opening it.
- **Free sculpt.** Above everything else sits a brush for the shapes no catalogue has: a dent in one temple, a crooked bridge, a brow ridge that is simply yours. Turn **Brush on**, then drag on the avatar to pull the surface out or push it in; dragging the background still orbits the camera, so you never lose the view. Size and Strength are real world measurements (centimetres and millimetres per stroke), the on-screen ring shows the brush's actual footprint at the current zoom, and Symmetry mirrors each stroke across the body's own centre line until you turn it off. Playback pauses while the brush is on so the mesh holds still under your cursor. The edit is recorded as its own morph target, which means it adds to the library sliders instead of fighting them, exports with the mesh, and comes back untouched when you re-open the avatar. **Clear sculpt** returns the body to exactly the catalogue shape.
- **Proportions.** Above the morph sliders sits a bone-level build panel: Height, Leg Length, Torso Length, Neck Length, Arm Length, Shoulder Width, Hip Width, Head Size, Hand Size, Foot Size. Morphs reshape a limb; these re-proportion the skeleton, which is the only way to actually lengthen one (a morph is a fixed set of vertex deltas, so pulling the hand further from the elbow would drag the skin off the bone driving it). Each slider is a ratio around the base body, shown as a signed percentage, and double-clicking resets it. Lengthen the legs and the hips ride up so the feet stay on the floor, and the animation library re-measures itself against the new hip height so the walk does not foot-slide. Only parameters the loaded rig has bones for are offered.
- **Accessories.** Hats, glasses, and earrings load from a preset catalog (`/accessories/presets.json`). Hovering a tile previews it live on the avatar; clicking commits it. Hats and glasses are single-slot; earrings stack. A chip row shows everything applied, each removable.
- **Wardrobe.** Two things stacked in one tab. The top half is the body's own garment layers (outfit, glasses, hair): recolour them, toggle each visible or hidden, or use the bulk "Start minimal" and "Dress fully" actions to strip to the base body and rebuild a look deliberately. The layers are resolved from whatever the loaded GLB actually contains rather than a hardcoded material list, so a third-party body still gets real controls. Beneath them is the **Closet**: catalog garments (tops, bottoms, footwear, outerwear, hair, headwear, glasses, accessories) that are downloaded and re-bound to *this* avatar's skeleton at runtime, so they move with every animation. Worn pieces occlude the skin underneath (pixel-exact on the Parametric base, which ships a baked UV region mask; bone-cull elsewhere), appear as removable chips beside the accessory chips, and are stored as `appearance.garments`. The garment contract is [specs/GARMENT_MANIFEST.md](../specs/GARMENT_MANIFEST.md).
- **Animate.** Load the shared canonical clip library and drive the rig live with 17 emotes (idle, waiting, chill, wave, cheer, celebrate, flex, jump, pray, blow kiss, taunt, dance, shuffle, rumba, thriller, capoeira). A looping emote becomes the avatar's resting idle and is baked in on save; one-shots play once and settle back to the current idle. This doubles as proof the avatar is fully rigged.
- **Walk.** Take the avatar for a walk without leaving the editor. It auto-walks a circle around the stage and you can drive it with WASD or the arrow keys, in any of the runtime's environments. Every sculpt, colour, garment and accessory edit shows up in motion immediately, which is where foot-slide, clipping and a garment that does not follow the hips actually become visible. In edit mode, **Open in Walk page** stashes the *unsaved* look as a short-lived draft and opens the full [/walk](https://three.ws/walk) page on it, so you review exactly what is on the stage rather than the last save. In create mode there is no saved record to build that draft from, so the panel says so instead of offering a button that would fail.
- **Rig** (edit mode only). Rig status for the loaded avatar plus one-click auto-rigging for a static mesh that has no skeleton and therefore cannot walk, wave, or emote. Rigging is non-destructive: it mints a new sibling avatar and opens the studio on it, leaving the original mesh untouched.
- **Randomize.** One button rolls a random swatch per color slot, a gentle draw on every proportion parameter, and a random hat and glasses, as a starting point. The proportion draw stays near neutral on purpose: two random avatars should read as different people, not different species.

The studio has 50-deep undo/redo, a dirty-state indicator in the title bar, and a draft autosave to local storage that is offered back if you leave and return (in create mode).

### Save

Saving takes one of two paths, and which one it takes matters.

**Creating a new avatar** exports the live Three.js scene via `GLTFExporter`, with colors, morphs and accessories already applied to the scene graph, so the resulting GLB is exactly what you saw. It runs through the shared optimize-and-validate path (geometry compression, `gltf-validator`), uploads to your account, and creates the avatar record. The appearance JSON is stored alongside as metadata so the avatar stays re-editable. Closet garments are the one exception: they are taken off the rig for the duration of the export and put straight back afterwards, because the appearance record carries them and the server bake replays them onto the base. Exporting a dressed body would apply every garment twice, onto a base you could never get back.

**Editing a saved avatar** does not export geometry at all. The record keeps its original, pristine base model and the server bakes the appearance onto it, so this is a metadata-only `PATCH` of `{ name, appearance }`. That is also why the base body cannot be switched while editing: a saved avatar owns its base.

## Walkthrough

1. Open [/avatar-studio](https://three.ws/avatar-studio). The base avatar loads and settles into an idle animation.
2. On the Color tab, tap a Look (say, Cyber) for an instant coherent palette, then fine-tune skin, hair, and outfit with the swatches or the rainbow chip's full picker.
3. Open the Face tab and sculpt: widen the jaw, adjust the nose, nudge body shape. Use the face-type wheel to blend archetypes.
4. Add a hat and glasses from their tabs; hover to preview, click to keep. Add earrings if you want.
5. On the Wardrobe tab, hide the base outfit and put on a shirt and boots from the closet, or leave the avatar in what it came with.
6. On the Animate tab, pick a looping emote (for example, Dance) to set the avatar's resting idle.
7. Open the Walk tab and drive the avatar around with WASD to check the outfit moves with it.
8. Name it and click Save. The studio exports, optimizes, uploads, and lands you with a saved avatar you can animate and dress elsewhere.

## Examples

Avatar Studio is an interactive builder; its examples are its entry points and the account API it saves through.

- **Create a new avatar:** [https://three.ws/avatar-studio](https://three.ws/avatar-studio) or [https://three.ws/create/studio](https://three.ws/create/studio)
- **Edit a saved avatar:** `https://three.ws/avatar-studio?edit=<avatarId>`: reloads that avatar's appearance and updates the existing record on save. Edit mode also adds the Rig tab and a **Play as this** button that saves and drops you into [/play](https://three.ws/play) wearing the avatar.
- **Arrive wearing something:** `https://three.ws/avatar-studio?edit=<avatarId>&equip-glb=<url>&equip-kind=hat&equip-name=Top%20hat` pre-applies an accessory GLB that is not in the preset catalog and marks the avatar unsaved, so a gallery "Equip" tile can hand off straight into the studio. `equip-kind` is `hat`, `glasses` or `earrings` (default `hat`); `equip-bone` overrides the attach bone (default `Head`). The avatar editor at `/avatars/<avatarId>/edit` accepts the identical parameters.

Fetching an avatar record (the same call the studio makes to load edit mode):

```bash
curl 'https://three.ws/api/avatars/<avatarId>' -H 'cookie: <session>'
# → { "avatar": { "id": "…", "name": "…", "model_url": "…", "appearance": { … } } }
```

## States & limits

- **No selfie, no camera.** This is the from-scratch path. To build an avatar from a photo, use the platform's selfie-to-avatar flow under [/create](https://three.ws/create) instead.
- **Two base bodies.** Create mode starts from the Stylized feminine base or the bare Parametric base (which covers masculine, feminine, and everything between via its body sliders). Switching base reloads the studio, so it asks before discarding unsaved changes. The posable primitive with a build toggle lives in [Animation Studio](./animation-studio.md).
- **The Parametric base ships bare.** No hair or outfit meshes yet, so the hair/outfit color slots and the Layers block do not appear on it; hats, glasses, and earrings attach normally. Conforming hair and garments are the next phase (`slots` under Reserved in [specs/PARAMETRIC_AVATAR.md](../specs/PARAMETRIC_AVATAR.md)).
- **Free sculpt is tied to the body it was painted on.** Strokes are stored as vertex deltas against a specific topology, so a sculpt made on the Parametric base does not transfer to a differently built mesh; the record notes which mesh it belongs to and is skipped rather than force-fitted anywhere else.
- **Sculpt depends on the base's morphs.** The face/body sliders render against whatever morph targets the base GLB exposes; a slot with no matching morph simply does not appear. Proportions are independent of morphs: they need only a canonical humanoid skeleton, so they work on a rig with no blendshapes at all. Height is the one parameter that needs an armature node above the hips, and is hidden on rigs whose hips sit directly in the scene.
- **Save requires an account.** Export happens client-side, but persisting the avatar to your library needs sign-in. Optimization is best-effort: if compression fails, the original export is saved untouched so the save always completes.
- **What you see is what you save.** Because the save exports the live scene graph, the stored GLB matches the viewport exactly, colors, morphs, accessories, and the chosen idle included.
- **The Rig and Play tabs need a saved avatar.** Auto-rigging posts the avatar's id to the regenerate backend and the /walk handoff presigns that avatar's private base GLB, so neither exists for an unsaved draft. The Rig tab is hidden in create mode and the Walk tab swaps its handoff button for the reason.
- **A garment needs a humanoid skeleton to bind to.** The closet refuses a piece it cannot rebind rather than attaching it mangled, and a retired catalog id degrades to "not worn" on load instead of failing the whole avatar. Re-dressing a saved outfit runs alongside the boot rather than blocking it, so the avatar is live and animating while the pieces land.
- **Drafts are local.** Unsaved work autosaves to local storage in create mode and is offered back on return; edit mode does not autosave a draft over the saved avatar.

## Related

- [Animation Studio](./animation-studio.md): pose and keyframe the avatar you build here.
- [Scene Composer](./compose.md): forge props and attach them to the avatar's bones as a saved outfit.
- [Mocap Studio](./mocap-studio.md): drive the avatar's face live from your webcam.
- [Restyle Studio](./restyle.md): shares the same GLB optimize-and-validate path.
- [Trait-based avatar builder](./character-studio.md): the separate VRM studio embedded in the agent editor; a deep dive into its internals.
- [/create](https://three.ws/create): the hub for every avatar-creation path, including selfie-to-avatar.
~~~~

