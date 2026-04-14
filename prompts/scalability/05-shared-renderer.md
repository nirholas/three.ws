# Task: Shared WebGLRenderer across multiple viewer instances

> **Status: Defer.** This task is speculative. Today this project has a single `Viewer` instance per page ([src/app.js:96-98](../../src/app.js#L96-L98)). Implementing a shared renderer provides zero benefit until multiple viewers must coexist on one page — e.g., a gallery of `<mv-viewer>` thumbnails, a side-by-side comparison view, or a documentation site with many inline embeds. **Do not execute this task until that use case is a real requirement.** The rest of this document is the spec for when that day comes.

## Context

Browsers limit the number of active WebGL contexts per page (typically 8–16 on desktop, fewer on mobile). Creating a `WebGLRenderer` per viewer instance hits this ceiling fast.

Google's `<model-viewer>` solves this with one shared `WebGLRenderer` drawing into a single offscreen canvas, then blitting the result to each instance's 2D canvas via `drawImage` (or via `HTMLCanvasElement.transferControlToOffscreen` in newer versions). A scheduler picks which scene to render each frame based on visibility, animation state, and priority.

## Goal

Introduce a `Renderer` singleton that:
- Owns the only `WebGLRenderer` in the application.
- Lets each viewer instance request renders via `renderer.render(scene, camera, targetCanvas)`.
- Schedules frames across instances based on visibility and animation state.
- Stays correct with the per-instance off-screen pause ([viewer.js lines ~144–185](../../src/viewer.js#L144-L185)) and render-on-demand invalidation ([02-render-on-demand.md](./02-render-on-demand.md)).

## Deliverable

1. `src/viewer/Renderer.js` exporting a singleton:
   ```js
   export class Renderer {
     static singleton;
     constructor();
     registerScene(scene);       // returns handle
     unregisterScene(handle);
     render(scene, camera, targetCanvas2D);   // synchronous blit
     invalidate(scene);          // mark dirty for next frame
     dispose();
   }
   ```
2. Refactor [src/viewer.js](../../src/viewer.js) to:
   - No longer create its own `WebGLRenderer`.
   - Own a 2D canvas (`CanvasRenderingContext2D`) that it mounts into `this.el`.
   - Register with the shared `Renderer` on construct, unregister on dispose.
   - Route all `this.renderer.render(...)` calls through the shared renderer.
3. Update all places that read from `this.renderer` directly — e.g., PMREM generator creation, screenshot export via `this.renderer.domElement.toBlob()`, `pixelRatio` setting, shadow map config, tone mapping. These need to be rerouted either to the shared renderer (shared config) or computed differently (screenshots need an explicit render-to-target-canvas step).

## Architecture notes

**Compositing path.** Each viewer mounts a 2D `<canvas>` sized to its element. The shared WebGL canvas is sized to the largest visible viewer's pixel dimensions (or a configured max). On render:
1. Set WebGL renderer size to the target viewer's pixel size.
2. `renderer.render(scene, camera)`.
3. `target2dCtx.drawImage(webglCanvas, 0, 0, w, h)`.

This adds a copy per frame but saves N–1 WebGL contexts.

Alternative (more modern, less broadly supported): `renderer.domElement.transferControlToOffscreen()` and assign as OffscreenCanvas — but requires a totally different pipeline. Prefer the drawImage path.

**Scheduler.**
- Maintain a list of registered scenes + their visibility/dirty state.
- Each frame: pick visible + (dirty OR animating) scenes, render each in priority order.
- Budget: a max of e.g. 4 renders per frame, defer the rest.
- If all registered scenes are idle, don't schedule RAF.

**Shared config.**
- Tone mapping, exposure, pixel ratio — these are per-render settings, applied just before each `renderer.render`. Store them per-scene in the viewer, apply on render.

**PMREM.**
- Move PMREM generator to the shared renderer (it also needs a GL context). Expose a `Renderer.singleton.pmrem` or similar. Environment textures become globally cached by URL.

**Screenshot.**
- `takeScreenshot()` currently uses `this.renderer.domElement.toBlob()`. After this refactor, capture from the per-viewer 2D canvas (which mirrors the last frame) or force a fresh render to a RenderTarget → readPixels → canvas → toBlob.

## Risks / things that bite

- **Z-fighting across compositing**: not an issue because each viewer has its own 2D canvas — they don't overlap unless the page stacks them. Fine.
- **Resize storms**: resizing WebGL canvas per render is cheap but not free. Consider keeping the shared WebGL canvas at max-of-visible-sizes and letting drawImage scale.
- **Pixel ratio per instance**: viewers on displays with different DPR are rare, but handle consistently.
- **OrbitControls event targets**: controls attach listeners to the renderer's canvas DOM element. After refactor, each viewer's controls must attach to its own 2D canvas. Confirm OrbitControls works with a 2D canvas as event target (it should — it only needs DOM event hooks).
- **Mouse/touch coords**: projections, raycasting, and controls all use canvas-relative coordinates. Keep these relative to the 2D canvas, not the WebGL canvas.
- **Context loss**: if the WebGL context is lost, every viewer must recover. Centralized in the shared renderer, which is actually an upside.

## Dependencies

- [01-dispose.md](./01-dispose.md) — disposal must cleanly unregister from the shared renderer.
- [02-render-on-demand.md](./02-render-on-demand.md) — invalidation API hooks straight into the scheduler.
- [03-module-split.md](./03-module-split.md) — much easier to do after the viewer is modularised.
- [04-web-component.md](./04-web-component.md) — the actual multi-instance consumer.

**Execute in order 01 → 02 → 03 → 04 → validate multi-instance demand → 05.**

## Verification (when executed)

1. Single-instance regressions: everything that worked before still works, no visual or perf diff.
2. Multi-instance: place 10 `<mv-viewer>` elements on a page. All render. No WebGL context loss warning. Scrolling through the page renders only those in the viewport.
3. DevTools GPU counters: one WebGL canvas, N 2D canvases.
4. Screenshot still works.

## Scope boundaries — do NOT do these

- Do not implement OffscreenCanvas path.
- Do not do 10-instance stress tests unless the multi-instance demo page is actually authored.
- Do not refactor PMREM caching beyond moving the generator to the shared renderer.
- Do not add worker offload.

## Reporting (when executed)

- What compositing path you chose (drawImage vs OffscreenCanvas).
- Scheduler policy (priority, per-frame budget).
- Which `this.renderer.*` call sites changed and how.
- Multi-instance demo page URL / path.
