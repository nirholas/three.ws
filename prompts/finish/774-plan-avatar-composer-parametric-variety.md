# Avatar surprise composer produces body-shape variety and bone accessories on the parametric base

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/774-plan-avatar-composer-parametric-variety.md`.

**Priority:** P3, polish, developer experience, or exploratory (score 28 of 100 inside the tier). **Area:** avatar. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The "surprise me" composer (`api/avatars/surprise.js`, `api/_lib/avatar-composer/`) mixes parts only within the same group of the RPM bases, so every result has the same body build, and it cannot add hats, glasses or earrings. The Parametric base now has 306 morphs and a proportions solver, so the README's stated roadmap ("a parametric-body backbone") is already available: a seeded random appearance record on `parametric-base-v1` yields real variety, and bone-attached accessories already bake via `api/_lib/bake.js`. The composer should use them.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `api/_lib/avatar-composer/` has `select.js`, `parts.js`, `compose.js`; tests in `tests/avatar-composer.test.js`.
- README roadmap: cross-group mixing needs vertex rebinding; body shape needs real morphs "which the RPM bases don't carry"; bone-attached accessories are "a clean next add via the existing `api/_lib/bake.js` merge".
- Parametric base: `public/avatars/parametric-base.glb` (306 morphs), `src/avatar-proportions.js`, `api/_lib/bake-proportions.js`, `api/_lib/accessories.js`, garments catalog (58 items incl. 8 hair) at `gs://three-ws-garments/garments/catalog.json`.
- The README's roadmap text predates the parametric base and is stale.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
sed -n 1,80p api/_lib/avatar-composer/README.md
grep -n "parametric\|accessor\|proportion" api/_lib/avatar-composer/*.js api/avatars/surprise.js | head
npx vitest run tests/avatar-composer.test.js 2>&1 | tail -5
grep -n "export" api/_lib/accessories.js | head
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Test-first: extend `tests/avatar-composer.test.js` (or add `tests/avatar-composer-parametric.test.js`): for 200 seeds the composer must produce valid `avatarAppearance` records (validated by `api/_lib/validate.js`), be deterministic per seed, and cover a spread of builds (assert the distribution of proportion values has a spread above a threshold).
2. Add a parametric mode in `api/_lib/avatar-composer/select.js`: a seeded generator choosing a coherent set of identity morphs (use slider group metadata from the base build, not hand-listed names), a proportions preset within safe ranges from `src/avatar-proportions.js`, skin tone, hair and outfit garments from the live catalog (fetch with the existing catalog cache in `api/_lib/bake-garments.js`), and 0 to 2 accessories from `api/_lib/accessories.js`.
3. Keep the legacy RPM mixing path behind an explicit `base` choice and make parametric the default for new surprises once the tests prove validity and bakeability (`isBakeable`).
4. Bake every generated record through `bakeAppearance` in the test for a sample of 10 seeds to prove none fails the VRAM and file ceilings.
5. Surface the choice in the UI where surprise is triggered (grep `surprise` in `src/` and `pages/`): a seed display so a result can be reproduced and shared, with empty, error and loading states.
6. Replace the stale roadmap in the README with the real remaining limits; update docs and changelog.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/avatar-composer.test.js tests/avatar-composer-parametric.test.js` passes.
- [ ] 200-seed test shows determinism and spread; 10 sampled seeds bake successfully.
- [ ] `POST /api/avatars/surprise` (authenticated, locally) returns an appearance with `base: 'parametric-base-v1'` or the documented base field.
- [ ] README roadmap no longer claims body-shape variety needs an external backbone.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Catalog unreachable in CI | Read it once into a gitignored cache the same way the bake tests do |
| Random morphs look grotesque | Constrain sampling to per-slider safe ranges derived from the base metadata and add a regression test with the extremes |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/774-plan-avatar-composer-parametric-variety.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `774-plan-avatar-composer-parametric-variety.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `api/_lib/avatar-composer/README.md` (whole file)

~~~~markdown
# Avatar Composer

A modular avatar generation engine. It assembles a rigged, expression-ready GLB
by mixing skinned body parts across the platform's Ready-Player-Me / Wolf3D base
bodies onto **one shared skeleton**, then recolors each part and scales the rig.
This is the same "one skeleton, many swappable parts" architecture Ready Player
Me and Avaturn use for customization: built here in pure JavaScript on
`@gltf-transform`, with no GPU, no external service, and no per-avatar cost.

## Why it exists

The old studio lane (`api/_lib/studio-avatar.js`) could only **recolor one of
five fixed base bodies**. Every "East Asian senior woman" and "Nordic young
woman" was the same mesh with a different tint, so the gallery filled with
people who looked alike. The composer instead treats those base bodies as a
**parts kit**: each one ships its hair, top, bottom, footwear, and glasses as
separate skinned meshes on a byte-identical 67-joint skeleton, so a hairstyle
from one body and an outfit from another compose onto a third body's face and
skin. Combined with per-part recolor and height scaling, one diversity profile
now yields tens of thousands of genuinely distinct avatars.

## How it works

1. **Identity**: one base provides the face, body, eyes, teeth (and their 60+
   ARKit expression blendshapes). This matches the requested gender.
2. **Swappable slots**: hair, top, bottom, footwear, glasses are each sourced
   independently from any base in the identity's **rest-pose group** (see below).
   A borrowed part keeps its **own** inverse-bind matrices (the only ones correct
   for that part's region) but has its skin's joints remapped onto the identity
   skeleton, so the whole avatar animates as one rig.
3. **Recolor**: each part's material `baseColorFactor` is multiplied by the
   colorway channel (skin / hair / top / bottom / footwear).
4. **Scale**: a uniform height multiplier on the rig root.
5. **Optimize**: `dedup` → `prune` → `meshopt`, written as a single-buffer GLB.

### Rest-pose groups

A part is authored to fit one body's proportions. Grafted onto a body with a
different skeleton *rest pose*, it keeps its own vertices and can float or misfit
(measured: the feet detach across groups). Bases are therefore grouped by rest
pose, and the composer only mixes parts **within a group**, where the fit is
exact:

| Group | Bases | Hips bind height |
|---|---|---|
| `a` | `realistic-male`, `realistic-female` | 0.967, 1.009 |
| `b` | `default`, `selfie-girl` | 1.037 |

Cross-group mixing (which needs true vertex rebinding) is the planned v2.

## Public API

```js
import { composeStudioAvatar } from './index.js';
```

- `composeStudioAvatar({ profile, seed, loadBase })` → `{ bytes, recipe, descriptor, meshes, recolored }`
  End-to-end: selects a recipe from the profile + seed, loads the needed bases via
  your `loadBase(id)`, and returns the composed GLB bytes. Deterministic on `seed`.
- `selectRecipe(profile, seed)` → recipe `{ identity, slots, colorway, scale, descriptor }`
- `basesNeeded(recipe)` → `string[]` of base ids the recipe requires bytes for
- `composeAvatar(recipe, bytesByBase)` → `{ bytes, meshes, recolored }` (the pure core)
- `combinationCount()` → rough count of distinct part-mesh combinations
- `BASES`, `BASE_BY_ID`: the parts catalog

`profile` fields (all optional): `gender` (`'male'|'female'`), `ethnicityKey`,
`ageKey`, `grayBias`, `build`. These come from `pickDiversityProfile()` in
`api/_lib/avaturn-seed.js`; the colorway and scale reuse `api/_lib/studio-avatar.js`.

## Example

```js
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { composeStudioAvatar } from './index.js';

// loadBase returns a base body's GLB bytes by id. On disk here; in the seed cron
// it fetches https://three.ws/avatars/<id>.glb.
const loadBase = async (id) =>
  new Uint8Array(readFileSync(resolve('public/avatars', `${id}.glb`)));

const { bytes, descriptor } = await composeStudioAvatar({
  profile: { gender: 'female', ethnicityKey: 'east-asian', ageKey: 'young-adult', build: 'slim' },
  seed: 'demo-seed-1',
  loadBase,
});

console.log(descriptor.identity, descriptor.parts); // e.g. selfie-girl { hair:'default', top:'selfie-girl', ... }
// `bytes` is a valid, rigged, ARKit-expression-ready GLB: write it to R2, etc.
```

## Consumers

- `api/cron/avaturn-seed-cron.js`: the studio seed lane composes each avatar
  here (falling back to the legacy single-base recolor if composition fails).

## Tests

`tests/avatar-composer.test.js`: selection determinism, the rest-pose-group
rule, and a full compose validated with `gltf-validator` (0 errors) that checks
the output is rigged and carries ARKit blendshapes.

## Limits / roadmap

- **Cross-group part mixing** needs vertex rebinding (deform a part to the target
  rest pose); today it is restricted to same-group for an exact fit.
- **Body-shape variety** (weight, height, proportions) needs real body morphs,
  which the RPM bases don't carry: a parametric-body backbone (MakeHuman CC0 /
  Google GHUM Apache-2.0) is the path.
- **Bone-attached accessories** (`public/accessories/` hats, glasses, earrings)
  ride a bone, not the skin, so they compose cross-base safely: a clean next add
  via the existing `api/_lib/bake.js` merge.
~~~~

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

