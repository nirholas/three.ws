# Task: Implement proper `dispose()` for the Viewer

## Context

Repo: `/workspaces/3D`. A glTF/GLB viewer built on three.js. Main file is [src/viewer.js](../../src/viewer.js), class `Viewer`.

Today the class only has `clear()` at roughly lines 800–828, which disposes **model-level** resources (geometries, textures) when a new model is loaded. The constructor creates many more resources — renderer, PMREM generator, controls, GUI, stats, IntersectionObserver, event listeners, RAF — none of which are cleaned up if the viewer is destroyed. This leaks WebGL contexts, RAM, and leaves dangling listeners every time the viewer is recreated.

Recent context: a `_updateRenderLoop` / RAF pause mechanism was just added around lines 144–185 (IntersectionObserver + visibilitychange). Your dispose must tear that down too.

## Goal

Add a `dispose()` method on `Viewer` that fully tears down the instance, so `viewer.dispose(); viewer = new Viewer(el, opts);` works with zero leaks and zero stale listeners.

## Deliverable

1. Modified [src/viewer.js](../../src/viewer.js) with:
   - A new `dispose()` method
   - All listener callbacks stored on `this._…` fields during construction so they can be removed
   - The existing `window.addEventListener('resize', …)` and `window.addEventListener('keydown', …)` — currently anonymous/bound inline — refactored to stored bound handlers
2. Updated callers (check [src/app.js](../../src/app.js), [src/avatar-creator.js](../../src/avatar-creator.js)) that destroy or recreate viewers — call `dispose()` before discarding.

## Audit checklist — must handle all of these

**three.js resources (constructor)**
- `this.renderer` → `renderer.dispose()`, then remove `renderer.domElement` from `this.el`, then `renderer.forceContextLoss()` is optional but recommended
- `this.pmremGenerator` → `.dispose()`
- `this.neutralEnvironment` (texture from PMREMGenerator) → `.dispose()`
- `this.controls` (OrbitControls) → `.dispose()`
- `this.scene` → traverse and dispose geometries/materials/textures. Also clear `this.scene.environment` (may hold a loaded env texture from `setEnvironment`)
- Any env texture currently applied (not the neutral one) → dispose if it was allocated by the viewer
- `this.axesRenderer` / `this.axesScene` / `this.axesCamera` / `this.axesCorner` if present → dispose renderer, remove DOM
- Lights added to the scene are cleaned up by scene disposal, but clear `this.lights = []`
- `this.mixer` → `.stopAllAction()` and release; clear `this.clips`
- `this.skeletonHelpers`, `this.gridHelper` → remove from scene; dispose geometry/material
- `this.content` → reuse existing `clear()` logic

**UI resources**
- `this.stats` → `stats.dom.remove()`
- `this.gui` (dat.gui) → `gui.destroy()`
- `this.annotationEls` → `.forEach((a) => a.el.remove())`
- `this.modelInfo` → has `.remove()`
- Any canvas overlays for annotations (see [src/annotations.js](../../src/annotations.js))

**Listeners / observers / RAF**
- `cancelAnimationFrame(this._rafId)` and null it
- `document.removeEventListener('visibilitychange', this._onVisibilityChange)`
- `this._intersectionObserver?.disconnect()`
- `window.removeEventListener('resize', this._onResize)` — **you must refactor the current inline binding** at roughly line 181 to store `this._onResize = this.resize.bind(this)` in the constructor
- `window.removeEventListener('keydown', this._onKeyDown)` — **refactor the current anonymous `(e) => …` handler** at roughly lines 182–184 to a stored bound handler

**State**
- Null out `this.content`, `this.mixer`, `this.clips`, `this.scene`, `this.renderer`, `this.controls`, `this.gui` at the end of dispose, so accidental reuse fails loudly rather than silently.

## Constraints

- **Do not change behavior** for a live viewer. Only add teardown.
- Must be safe to call twice — second call is a no-op.
- Do not introduce new dependencies.
- Keep the existing `clear()` method; your `dispose()` should call `clear()` internally for model teardown, not duplicate it.

## Verification

1. `node --check src/viewer.js` — parses.
2. Manually in a browser console after the app loads:
   ```js
   window.app.viewer.dispose();
   // Check: no errors in console
   // Check: renderer.domElement no longer in DOM
   // Check: GUI panel gone
   // Check: stats panel gone
   // Call it again — should not throw
   ```
3. Create a second viewer (`window.app.createViewer()` or equivalent) and confirm it works.
4. Load a scene, toggle env, load another scene, dispose, recreate, repeat — observe memory does not grow in DevTools Memory tab across several cycles.

## Scope boundaries — do NOT do these

- Do not add a Custom Element wrapper. That is a separate task.
- Do not change the render loop (beyond cancelling RAF in dispose).
- Do not refactor viewer.js into multiple files. That is a separate task.
- Do not implement shared-renderer pooling.

## Reporting

At the end, summarise:
- What was disposed
- Which listeners were refactored to stored handlers
- Any resource you found that had no cleanup path and that you added
- Any call site in `app.js` / `avatar-creator.js` you updated
