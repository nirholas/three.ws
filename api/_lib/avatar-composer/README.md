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

## Parametric mode (default for new surprises)

`api/_lib/avatar-composer/parametric.js` draws a seeded **appearance record** for
`public/avatars/parametric-base.glb` instead of grafting parts between RPM bases,
which is what gives real body and face variety (the RPM bases carry no body
morphs). The record is the same format the avatar editor saves
(`avatarAppearance` in `api/_lib/validate.js`) and bakes with `bakeAppearance()`:

- `morphs`: 7 to 12 identity sliders. Groups come from the base's own morph names
  (`deriveSliders`), so a rebuilt base needs no list edits. Opposing sliders
  (`headWider`/`headNarrower`) are never taken together, left/right pairs move
  together, and gender, ethnicity blend and age macros are placed first.
- `proportions`: height plus 2 to 4 skeleton ratios, each at most 70% of the way
  to its limit in `src/avatar-proportions.js`.
- `colors.skin`: a tone along the profile's ethnicity range.
- `garments`: top, bottom, footwear, hair and sometimes outerwear from the live
  catalog.
- `accessories`: 0 to 2 bone presets (one hat, glasses or earrings each).
- `base`: `'parametric-base-v1'`.

```js
import { composeParametricAvatar } from './index.js';
const { bytes, appearance } = await composeParametricAvatar({ profile, seed, loadBase, loadCatalog });
```

`/api/avatars/surprise` uses parametric by default; `?base=rpm` selects the
legacy lane, and `?format=json` returns just the record.

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

`tests/avatar-composer-parametric.test.js`: 200 seeds produce valid, bakeable,
deterministic records with a real spread of builds, and 10 seeds bake end to end.

`tests/avatar-composer.test.js`: selection determinism, the rest-pose-group
rule, and a full compose validated with `gltf-validator` (0 errors) that checks
the output is rigged and carries ARKit blendshapes.

## Limits

- **Part mixing across rest-pose groups** (legacy RPM mode) still needs vertex
  rebinding, so it stays restricted to same-group. Parametric mode does not have
  this limit: every garment binds to the one Parametric skeleton.
- **Garments are not tintable.** The catalog's wearables carry baked palettes
  (`materials.tintable: false`), so a parametric record varies skin tone but not
  garment color.
- **Hair is a garment.** Hair styles are the 8 catalog hair pieces, so hair colour
  variety is whatever the catalog ships.
- **Catalog outage degrades, not fails.** If the garment catalog cannot be
  fetched, the avatar composes without garments (bare body plus morphs,
  proportions, skin and accessories).
- **Bake cost.** A parametric compose fetches up to five garment GLBs (2 to 4 MB
  each, cached by the CDN) and runs the full bake, so it is slower than the
  legacy path. `format=json` on the surprise endpoint skips the bake.
