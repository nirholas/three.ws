# Task: Split `src/viewer.js` into focused modules

> **Note:** The maintainer plans to execute this task personally rather than delegate — splitting a monolith without behavior drift is unforgiving of missed references. This document exists so the plan is written down and a subagent **could** execute it if needed.

## Context

[src/viewer.js](../../src/viewer.js) is ~885 lines and holds one `Viewer` class with responsibilities for: renderer setup, loading, lights, environments/IBL, GUI (dat.gui), OrbitControls, animation mixer, model info, annotations, screenshot, helpers (grid/axes/skeleton), background, screenshot flash, render loop, visibility pausing, and (pending) dispose.

Adding the next set of features — AR, variants, poster/reveal, Web Component — on top of this monolith compounds the problem. Split first, then build.

model-viewer's pattern (for reference) is a chain of class mixins: `LoadingMixin`, `AnimationMixin`, `ControlsMixin`, `EnvironmentMixin`, `SceneGraphMixin`, `AnnotationMixin`, `ARMixin`, `StagingMixin`.

## Goal

Split viewer.js into multiple modules **without behavior change**, while preserving the `Viewer` public API consumed by [src/app.js](../../src/app.js).

## Deliverable

New folder `src/viewer/` with the Viewer class plus extracted modules:

```
src/viewer/
  Viewer.js          # core class: state, constructor, render loop, public API
  loading.js         # GLTFLoader + DRACO/KTX2/Meshopt setup, load(), setContent()
  environment.js     # updateEnvironment(), getCubeMapTexture(), tone mapping, exposure
  lights.js          # addLights(), removeLights(), updateLights()
  animation.js       # mixer, clips, playAllClips(), playAnimation()
  controls.js        # OrbitControls setup, auto-rotate, camera presets
  helpers.js         # addAxesHelper(), addGridHelper(), setSkeleton(), setWireframe()
  screenshot.js      # takeScreenshot(), flashScreenshotFeedback()
  gui.js             # addGUI() and all dat.gui wiring
  dispose.js         # dispose() if it exists (task 01)
  index.js           # re-exports the Viewer class so consumers don't see the split
```

Each non-core module exports pure functions that take the `viewer` instance as their first argument, e.g.:

```js
// src/viewer/environment.js
export function updateEnvironment(viewer) { … }
export function getCubeMapTexture(viewer, environment) { … }
```

The `Viewer` class itself keeps the state (`this.scene`, `this.renderer`, `this.state`, etc.) and delegates:

```js
// src/viewer/Viewer.js
import { load, setContent, clear } from './loading.js';
import { updateEnvironment } from './environment.js';
…
class Viewer {
  load(url, rootPath, assetMap) { return load(this, url, rootPath, assetMap); }
  updateEnvironment() { return updateEnvironment(this); }
  …
}
```

This is the pragmatic option over true class mixins — it preserves `this` semantics, avoids TypeScript-style mixin gymnastics in plain JS, and is trivially testable.

## Import-path compatibility

[src/app.js](../../src/app.js) currently does:

```js
import { Viewer } from './viewer.js';
```

Preserve this. Options:

- **Recommended:** keep `src/viewer.js` as a thin re-export — `export { Viewer } from './viewer/index.js';`
- Or: update `app.js` to import from `./viewer/index.js` and delete the old file.

Pick one, document it in your summary.

## Rules

1. **Zero behavior change.** Before starting, run the app, load a model, toggle env, play an animation, screenshot, resize the window — note the behavior. After refactor, repeat all checks, they must match.
2. **Zero new dependencies.**
3. **All state lives on `this` in the `Viewer` class.** Extracted functions mutate `viewer.*` fields. No global state, no hidden singletons.
4. **Bindings:** any method still consumed externally (e.g., `viewer.animate`, `viewer.resize`) must remain a method on the Viewer class so binding works. Extracted functions can be called from methods.
5. **GUI module (gui.js) is the largest extraction.** Be careful: all the `.onChange` callbacks touch `this.state`, re-render, rebuild lights/env, etc. When you move `addGUI()` to a function `setupGui(viewer)`, every callback needs access to viewer methods — just reference `viewer.updateEnvironment()`, `viewer.updateLights()`, etc.
6. **Constants** at module top (e.g., `DEFAULT_CAMERA`, `Preset`, `THREE_PATH`, `MANAGER`, `DRACO_LOADER`, `KTX2_LOADER`, `IS_IOS`) — keep those that multiple modules need in a shared `src/viewer/constants.js`. Don't duplicate.
7. **Private helper functions** (`traverseMaterials`, `isIOS`) — move next to their only caller. `traverseMaterials` is used in clear/dispose; move to loading.js or a util.
8. **Imports from three.js** — each module imports only what it uses. Don't keep the mega-import at the top of Viewer.js.

## Order of operations (suggested)

Do one module per commit-sized step. Verify the app still runs between each.

1. Create `src/viewer/` folder and `index.js` re-export.
2. Move helpers (`traverseMaterials`, `isIOS`) to utils.
3. Move `takeScreenshot` + `flashScreenshotFeedback` → `screenshot.js`.
4. Move lights → `lights.js`.
5. Move helpers (axes/grid/skeleton/wireframe) → `helpers.js`.
6. Move environment logic → `environment.js`.
7. Move controls setup → `controls.js`.
8. Move animation → `animation.js`.
9. Move loading → `loading.js`.
10. Move GUI → `gui.js` (largest, do last).
11. Replace original `src/viewer.js` with re-export from `src/viewer/index.js`.

After each step: `node --check` and (if possible) load the app and smoke-test.

## Do NOT

- Do not split into separate classes or use actual ES mixins. Functions + shared state on the Viewer instance is simpler.
- Do not rename public methods (`load`, `clear`, `dispose`, `setCamera`, `printGraph`, `resize`, `animate`, `updateEnvironment`, `updateLights`, `updateDisplay`, etc.).
- Do not re-order the constructor's side-effect sequence — order matters (renderer before PMREM, lights before env, etc.).
- Do not fix unrelated bugs during the split. If you notice something, note it in the reporting section; don't touch it here.
- Do not introduce async where it wasn't async before.

## Verification

1. `node --check` each new file.
2. Run `npx vite build` — must succeed or fail only on the known pre-existing `@avaturn/sdk` error in `avatar-creator.js`, which is unrelated.
3. Manual smoke test:
   - App loads, drop a GLB, model appears
   - Change environment from the GUI — IBL updates
   - Toggle background, wireframe, skeleton, grid
   - Play animations from the GUI
   - Resize the window — camera aspect updates
   - Press `p` — screenshot downloads
   - Open the model info panel — fields populated
4. Compare the network tab / memory before and after — should be identical.

## Reporting

- List every file created and its responsibility.
- List every public method on Viewer — confirm none were renamed.
- Which path did you choose for import compatibility (re-export shim vs. update app.js)?
- Any dead code or small bug you noticed but deliberately did not fix.
