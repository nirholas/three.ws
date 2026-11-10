---
name: viewer-presets
description: Style a three.js or three.ws avatar viewer with the @three-ws/viewer-presets library. Use when adding a studio light rig, bloom, floor reflection, or swapping a model's materials for presets like chrome, gold or glass.
---

# @three-ws/viewer-presets

ESM library of tuned visual presets. `three` is an optional peer dependency (`>=0.150.0`): functions that touch scene objects take the `THREE` namespace as their first argument, so the library never imports it.

Install: `npm install @three-ws/viewer-presets three`

## API

Root import `@three-ws/viewer-presets`, or subpaths `/lights`, `/floor`, `/bloom`, `/materials`.

- `LIGHT_CONFIG`, `buildLightRig(THREE, overrides?)`: returns `{ group, headTarget, shoeTarget }`. Add `group` to the scene. Overrides: `keyLightIntensity`, `keyLightColor`, `fillLightIntensity`, `fillLightColor`, `fillLightPosition`, `backLightIntensity`, `backLightColor`, `backLightPosition`, `lightTarget`.
- `FLOOR_REFLECTION_DEFAULTS`, `floorReflectionConfig({ color, ...overrides })`: returns props for a reflective floor (resolution, mixBlur, mixStrength, roughness, planeSize, fogNear, fogFar and more). `color` is required.
- `BLOOM_DEFAULTS`, `bloomConfig(overrides?)`: returns `{ luminanceThreshold, luminanceSmoothing, mipmapBlur, intensity, kernelSize }` for a postprocessing bloom pass.
- `MATERIAL_PRESETS`, `MATERIAL_PRESET_NAMES`: chrome, gold, copper, brushedSteel, gunmetal, matte, glossy, rubber, ceramic, glass, realGlass, wood, stone, fabric, skin, carPaint, neon, holographic.
- `materialPreset(nameOrConfig, overrides?)`: resolve to a plain material config.
- `applyMaterialPreset(THREE, root, nameOrConfig, { overrides }?)`: apply to every mesh material under `root`. Returns `{ restore, count }`; call `restore()` to undo.
- `materialVariants(base, { seed, count, hueSpread, jitter }?)`: deterministic seeded variants, each `{ label, seed, config }`.

TypeScript types ship in `src/index.d.ts`.

## Worked example

```js
import * as THREE from 'three';
import { buildLightRig, applyMaterialPreset, materialVariants } from '@three-ws/viewer-presets';

const rig = buildLightRig(THREE, { keyLightIntensity: 2 });
scene.add(rig.group);

const { restore, count } = applyMaterialPreset(THREE, model, 'gold');
console.log(`restyled ${count} materials`);

const options = materialVariants('chrome', { seed: 7, count: 4 }); // same seed, same variants
restore(); // back to the original materials
```

Pick a preset name from `MATERIAL_PRESET_NAMES`; an unknown name throws rather than silently doing nothing.
