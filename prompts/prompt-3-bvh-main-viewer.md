# Task: BVH-Accelerated Raycasting in Main Viewer

## Project overview

This is a Three.js / Vite app at `/workspaces/3D-Agent`. The frontend is vanilla JS modules + Vite (`npm run dev` on port 3000). The main 3D viewer is `src/viewer.js` (~1,720 lines). It loads GLB/GLTF avatars and 3D models, handles OrbitControls, animation playback, morph targets, and environment setup.

## Problem

All raycasting in the viewer (hit-testing for click interactions, AR placement, annotation picking) uses Three.js's default brute-force triangle intersection — it checks every triangle of every mesh in the scene on every raycast. On a complex avatar (5k–20k triangles, skinned mesh) this is slow, especially when:

- The user clicks to inspect model annotations
- The avatar page does hover hit-testing for interactive zones
- The validator page raycast-samples mesh surface for quality checks

`three-mesh-bvh` wraps Three.js's raycasting system with a Bounding Volume Hierarchy, cutting raycast time from O(n triangles) to O(log n). The integration is a drop-in patch — no call sites change.

## Current raycasting call sites in `src/viewer.js`

Search for `Raycaster` and `intersectObject` in the file to confirm locations. The viewer uses `THREE.Raycaster` through OrbitControls (which calls it internally) and potentially through `_onDblClick`. The BVH patch operates at the `Mesh.prototype.raycast` level so it accelerates **all** raycasting site-wide without touching individual call sites.

## What to implement

### 1. Install three-mesh-bvh

```bash
npm install three-mesh-bvh
```

(If it was already installed by a prior task, `npm install` is a no-op — check `package.json` first.)

### 2. Patch Mesh.prototype.raycast at module top level in `src/viewer.js`

At the top of `src/viewer.js`, after the existing Three.js imports, add:

```js
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { Mesh } from 'three';

// Accelerate all Three.js raycasting site-wide — must run before any Mesh is created.
Mesh.prototype.raycast = acceleratedRaycast;
```

This is the recommended integration pattern from the three-mesh-bvh README. It patches the prototype once; every `Mesh` in the scene automatically uses BVH raycasting after this.

### 3. Compute BVH after model content is set

In `src/viewer.js`, find the `setContent(object, clips)` method. After the content is added to the scene and before the method returns, traverse the object and compute BVH for every geometry:

```js
// After scene.add(object) and before the final state updates in setContent():
object.traverse((node) => {
  if (node.isMesh && node.geometry) {
    // computeBoundsTree mutates geometry in place; safe to call every load
    node.geometry.computeBoundsTree();
  }
});
```

The exact location: find the line where `this.content` is assigned and the object is added to the scene (around line 750–800 in `setContent`). Place the traversal immediately after `this.scene.add(object)` (or wherever the content is attached).

### 4. Dispose BVH data when content is cleared

In `src/viewer.js`, find the `clear()` method (or wherever `this.content` is removed from the scene and disposed). Add BVH disposal:

```js
// Inside the content disposal block — wherever geometry.dispose() is called:
this.content?.traverse((node) => {
  if (node.isMesh && node.geometry) {
    node.geometry.disposeBoundsTree?.();
  }
});
```

This must run **before** `geometry.dispose()` is called, because `disposeBoundsTree` references the geometry's internal arrays.

### 5. Handle skinned meshes correctly

Skinned meshes (avatars with bone animation) use `SkinnedMesh`, which extends `Mesh`. BVH works on the **rest-pose geometry** — it does not account for bone deformation. This is acceptable for click/hover hit-testing on avatars because:
- The bounding volume of the rest pose is a conservative approximation of the animated pose
- False negatives are rare (slightly missing a click near the edge of an animated limb)
- The alternative (brute-force) is much slower

No special handling required — the patch applies equally to `Mesh` and `SkinnedMesh`.

### 6. Handle non-indexed geometries

`computeBoundsTree()` works on both indexed and non-indexed geometries. If a geometry has no index, three-mesh-bvh handles it correctly. No special casing needed.

## Files to modify

- `src/viewer.js` — three changes: import patch at top, `computeBoundsTree` call in `setContent`, `disposeBoundsTree` call in content clear.

## Files to read before editing

Read `src/viewer.js` fully before making changes, particularly:
- The import block at the top (to insert the new import correctly)
- The `setContent(object, clips)` method — find where `this.content` is assigned and `this.scene.add(object)` happens
- The content disposal / `clear()` logic — find where `geometry.dispose()` is called for old content

## Constraints

- Do not modify any call sites — the prototype patch handles everything globally.
- Do not add BVH to the skybox, environment meshes, or helper meshes (AxesHelper, GridHelper, SkeletonHelper). These are not raycasted by user interaction. To avoid wasting memory, only compute BVH for `node.isMesh && node.geometry && !node.isHelper`.
  - Check: `AxesHelper`, `GridHelper`, `SkeletonHelper` set `isHelper = true` on their child objects — use that flag.
  - Simplest safe check: only process nodes where `node.geometry.attributes.position` exists and `node.geometry.attributes.position.count > 0`.
- Do not change OrbitControls, camera, lighting, animation, or any other viewer behaviour.
- The patch must not break the existing morph-target system (`src/agent-avatar.js` drives morph targets every frame — BVH does not touch morph target influences, so there is no conflict).

## Definition of done

- `npm install` completes without errors (three-mesh-bvh in package.json).
- `npm run dev` starts on port 3000.
- Load an avatar in the viewer — no console errors, avatar renders and animates.
- Click the avatar — the interaction fires (if there is one). No raycasting errors.
- `git diff src/viewer.js` shows only the three changes described: import, computeBoundsTree traversal, disposeBoundsTree traversal.
- No other files modified.
