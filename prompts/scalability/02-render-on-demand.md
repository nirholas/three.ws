# Task: Convert the Viewer render loop to render-on-demand

> **Note:** The maintainer plans to execute this task personally rather than delegate — the hunt for state-mutation sites benefits from a warm context of the whole file. This document exists so the spec is written down and a subagent **could** execute it if needed.

## Context

Repo: `/workspaces/3D`. Main file: [src/viewer.js](../../src/viewer.js).

Today the `animate()` method (around lines 186–196) schedules a new `requestAnimationFrame` every single frame, rendering at ~60 fps whether or not anything has changed. A prior change added off-screen + tab-hidden pausing (see `_updateRenderLoop`, roughly lines 144–185). The next scalability step — which this task covers — is to only render when something has **actually changed**.

Goal: idle viewer with no animation, no camera movement, no GUI interaction → stats panel reports 0 fps within a couple of seconds of load.

## Goal

Replace the continuous RAF loop with an invalidation-driven scheduler:

- `invalidate()` requests a single future frame.
- RAF runs only when `_needsRender` is true, or when a glTF animation is active.
- Every state mutation that can change the rendered pixels must call `invalidate()`.

## Deliverable

Modified [src/viewer.js](../../src/viewer.js) with:

1. `invalidate()` method on `Viewer`.
2. Reworked `animate()`:
   - If any animation mixer action is active (`this._animating === true`) → keep looping (`requestAnimationFrame(this.animate)`) and updating mixer.
   - Else → render once if `_needsRender`, then stop scheduling.
3. `_needsRender` flag set by `invalidate()`, cleared in `animate()` after rendering.
4. `_animating` flag maintained when animation clips play/pause/finish.
5. Invalidation wired into every mutation site — see list below.

## Mutation sites that must call `invalidate()`

Audit the full file. At minimum:

- **OrbitControls**: `this.controls.addEventListener('change', () => this.invalidate())` — this is the single most important hook; without it the user dragging the camera does nothing.
- **Resize**: `this.resize()` → invalidate after resizing renderer/camera.
- **GUI controls (dat.gui)**: every `.onChange` in `addGUI()` — environment, background toggle, bgColor, exposure, tone mapping, wireframe, skeleton, grid, autoRotate (autoRotate itself keeps the loop animated — see below), point size, camera select, animation play/pause, morph targets, light toggles, etc.
- **Model load**: after `setContent()` / `setCamera()` / `updateLights()` / `updateEnvironment()` — anywhere state changes post-load.
- **Screenshot**: `takeScreenshot()` already forces one render, but should also invalidate after, since `flashScreenshotFeedback` may paint an overlay.
- **Annotation projection**: only call `projectAnnotations()` inside `render()` — no extra invalidate required since it piggybacks on render.
- **Visibility re-entry**: in `_updateRenderLoop()` when the viewer comes back on-screen, call `invalidate()` so it repaints once (camera/env may have been changed while hidden).
- **Clear**: when the current model is removed, invalidate to repaint the empty scene.

## Animation handling

- When a clip action starts → set `this._animating = true`, invalidate.
- When all clip actions stop/finish → set `this._animating = false`. The next `animate()` tick will naturally stop scheduling.
- AutoRotate (OrbitControls `autoRotate`) is effectively an animation — treat it the same: while `state.autoRotate === true`, set `_animating = true`; toggling it off → `_animating = false`.
- For morph target scrubbing via GUI sliders, the per-slider `.onChange` → `invalidate()` is enough (no continuous rendering).

## Compatibility with existing pause mechanism

- `invalidate()` should be a no-op scheduling-wise if `_visible === false` or `_tabVisible === false`. Just set `_needsRender = true` — the RAF will start once `_updateRenderLoop` flips back on.
- Conversely, `_updateRenderLoop()` should only start RAF if (`_needsRender` || `_animating`). If neither is true on resume, don't start a loop.

## Edge cases to get right

- First frame: after construction, invalidate once so the empty-scene frame paints.
- After `setContent` returns, invalidate — otherwise the newly loaded model won't appear until the user drags.
- After env texture finishes loading (async), invalidate.
- Camera `.updateProjectionMatrix()` callers → invalidate.
- `controls.update()` currently runs every frame inside `animate()`; it still needs to run when auto-rotate is active (which is why auto-rotate sets `_animating = true`). When not animating, `controls.update()` only needs to run when user interacts — but OrbitControls' damping also needs `update()` called each frame until damping settles. **If `controls.enableDamping === true`, treat user interaction as short-lived animation**: on `start` event begin animating, on `end` event stop after damping settles (a few RAF ticks). Simpler alternative: on `change` event, invalidate and always call `controls.update()` inside the render path whether animating or not.

Recommended simplest correct approach:
- Every `change` event → invalidate.
- `animate()` always calls `controls.update()` before `renderer.render()`.
- If damping is on, also call `invalidate()` for one extra frame after `change` to let damping settle — in practice OrbitControls keeps firing `change` during damping, so this is self-sustaining.

## Constraints

- Do not break existing features: camera drag, autorotate, animation playback, env switch, model load, screenshot, resize, annotations.
- Do not introduce new dependencies.
- No behavior change for active sessions — only idle CPU/GPU cost should drop.

## Verification

1. `node --check src/viewer.js`.
2. Load a static model (no animations). Wait 2 seconds. Stats panel FPS should read 0.
3. Drag the camera. FPS should spike while dragging, then return to 0 within ~1 second.
4. Load a model with a playing animation. FPS should be ~60 continuously.
5. Toggle a GUI option. One frame should render, then idle.
6. Switch environment. The frame after env loads should render, then idle.
7. Scroll the viewer off-screen → no rendering (off-screen pause handles this). Scroll back → one frame renders.
8. Chrome DevTools Performance → record 5s while idle on a static model → there should be essentially no JS/GPU work.

## Scope boundaries — do NOT do these

- Do not refactor into multiple files.
- Do not add a Custom Element.
- Do not change the disposal path (assume [01-dispose.md](./01-dispose.md) is landing separately — just make sure `dispose()` cancels the RAF as it already does).
- Do not implement shared-renderer pooling.

## Reporting

- List every call site where you added `invalidate()`.
- Describe how you handled OrbitControls damping.
- Note any state-mutation site you found that previously relied on continuous rendering and now requires explicit invalidation.
