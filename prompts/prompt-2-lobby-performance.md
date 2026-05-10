# Task: Marketplace Lobby 3D Performance

## Project overview

This is a Three.js / Vite app at `/workspaces/3D-Agent`. It renders an AI agent marketplace with a 3D lobby scene showing 3–5 featured avatars on circular podiums with mouse-parallax and click-to-select. The frontend is vanilla JS modules + Vite (`npm run dev` on port 3000).

## File to modify

**`src/marketplace-lobby.js`** — the entire lobby is self-contained in this one file (275 lines). Read it fully before making changes.

## Current problems

1. **No decoder support**: The lobby uses a bare `new GLTFLoader()` with no Draco, KTX2, or meshopt decoders. After asset compression (a separate task), the avatar GLBs will use EXT_meshopt_compression. Without the decoder wired in, compressed GLBs will fail to load silently.

2. **Naive raycasting**: The `onClick` handler calls `raycaster.intersectObjects(slotsRoot.children, true)` which walks every triangle of every avatar mesh on every click. On complex skinned meshes (2–5 avatars, each 5k–20k triangles), this is expensive.

3. **No `powerPreference`**: The WebGLRenderer is constructed without `powerPreference: 'high-performance'` — on laptops with discrete GPUs this defaults to the integrated GPU.

4. **PMREMGenerator not disposed after setup**: `pmrem.fromScene(...)` is called once for the environment, but `pmrem` is only disposed inside `dispose()`. This is correct but `pmremGenerator.dispose()` should also be called right after the environment texture is generated (the PMREMGenerator is not needed after that point — keeping it alive wastes GPU memory).

5. **No animation loop visibility guard**: The RAF loop runs even when the canvas is off-screen (e.g. user scrolls down on the marketplace page). This wastes CPU/GPU on invisible frames.

## Existing decoder infrastructure to reuse

The project has a shared `getDecoders()` function in `src/viewer/internal.js` that lazily initialises DRACOLoader + KTX2Loader + MeshoptDecoder (all memoised — calling it multiple times returns the same Promise). Import and use this instead of setting up decoders from scratch.

```js
// src/viewer/internal.js exports:
export function getDecoders() {
  // Returns Promise<{ dracoLoader, ktx2Loader, meshoptDecoder }>
}
```

## What to implement

### 1. Install three-mesh-bvh

```bash
npm install three-mesh-bvh
```

### 2. Wire decoders into the lobby's GLTFLoader

Replace the current loader setup in `mountLobby`:

**Before** (line 106–107):
```js
const loader = new GLTFLoader();
slots.forEach((avatar, i) => {
```

**After**: call `getDecoders()` before starting the avatar load loop, then create the loader with all three decoders. The load loop must not start until the decoders are ready:

```js
import { getDecoders } from './viewer/internal.js';

// Inside mountLobby, after the podium/slot setup:
const { dracoLoader, ktx2Loader, meshoptDecoder } = await getDecoders();
const loader = new GLTFLoader()
  .setDRACOLoader(dracoLoader)
  .setKTX2Loader(ktx2Loader.detectSupport(renderer))
  .setMeshoptDecoder(meshoptDecoder);

slots.forEach((avatar, i) => {
  // ... load loop unchanged ...
});
```

`mountLobby` is already `async` so the `await` is fine.

### 3. Add BVH-accelerated raycasting

Install and use `three-mesh-bvh` to accelerate the click raycaster.

When each avatar GLB finishes loading, compute a BVH for every mesh geometry in it:

```js
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { Mesh } from 'three';

// Patch Three.js Mesh prototype once (at module top level, outside mountLobby):
Mesh.prototype.raycast = acceleratedRaycast;

// Inside the GLTFLoader onLoad callback, after fitToHeight():
root.traverse((node) => {
  if (node.isMesh && node.geometry) {
    node.geometry.computeBoundsTree();
  }
});
```

Update the `dispose()` function to also clean up BVH data:

```js
scene.traverse((obj) => {
  if (obj.geometry) {
    obj.geometry.disposeBoundsTree?.();
    obj.geometry.dispose?.();
  }
  // ... existing material dispose ...
});
```

### 4. Fix PMREMGenerator disposal

Right after generating the environment texture, dispose the PMREMGenerator immediately:

```js
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose(); // done — GPU memory freed
```

Remove `pmrem.dispose()` from the `dispose()` function at the bottom (it will already be disposed).

### 5. Add `powerPreference` to the renderer

```js
const renderer = new WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: 'high-performance',
});
```

### 6. Add IntersectionObserver visibility guard

Pause the render loop when the canvas is not visible in the viewport (saves GPU on scroll):

```js
let visible = true;
const io = new IntersectionObserver(
  ([entry]) => { visible = entry.isIntersecting; },
  { threshold: 0.01 }
);
io.observe(canvas);

function tick() {
  if (!alive) return;
  rafId = requestAnimationFrame(tick);
  if (!visible) return; // skip render, keep RAF alive for when it returns
  // ... rest of tick ...
}
```

In `dispose()`, add `io.disconnect()`.

### 7. Antialias decision based on DPR

On high-DPR displays (≥ 2×), MSAA antialias is nearly free because the display already downsamples. On low-DPR displays it's expensive. The lobby already caps DPR at 2, which is correct. No change needed — just verify the existing cap is kept.

## Import additions required at top of file

```js
import { getDecoders } from './viewer/internal.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { Mesh } from 'three'; // Mesh is already imported — just add to existing import
```

`Mesh` is already in the import block — add `acceleratedRaycast` patch at module top level.

## Constraints

- Do not break the existing `onSelect` callback contract — click-to-select must still fire `onSelect(avatar, index)`.
- Do not change the visual appearance of the scene (lighting, fog, podium geometry, camera angles).
- The `dispose()` function must remain complete — no GPU resource leaks. All new resources (BVH data, IntersectionObserver) must be cleaned up there.
- `mountLobby` signature stays identical: `async function mountLobby(canvas, avatars, options = {})`.
- Do not add any loading spinner or placeholder UI — the podiums already render before GLBs resolve.
- All imports must resolve correctly with the Vite bundler (no CommonJS `require`).

## Definition of done

- `npm install` runs without errors (three-mesh-bvh added to package.json).
- `npm run dev` starts on port 3000 with no console errors.
- Navigate to the marketplace page — the 3D lobby loads, avatars appear on podiums.
- Clicking an avatar still fires `onSelect`.
- Network tab shows: if compressed GLBs are present, they load successfully (meshopt decoder wired). If uncompressed, they load as before.
- `git diff src/marketplace-lobby.js` shows only the changes described above — no unrelated modifications.
- No TypeErrors or import errors in the browser console.
