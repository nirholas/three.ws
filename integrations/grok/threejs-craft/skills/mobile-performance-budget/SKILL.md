---
name: mobile-performance-budget
description: >-
  Make a three.js scene hold frame rate on phones: measure draw calls, triangles, texture memory and frame time with renderer.info and THREE.Timer, cut draw calls with InstancedMesh and BatchedMesh, cap the pixel ratio and scale resolution adaptively, shrink texture memory with KTX2 and smaller maps, and stay inside a concrete per-frame budget. Use when a scene is slow, janky, hot, drains battery, crashes or reloads on iOS Safari, stutters on Android, has too many draw calls, repeats the same object many times, or when the user asks how to profile or optimize three.js performance.
when_to_use: Profiling or optimizing three.js frame time and memory, especially for mobile browsers, or rendering many copies of one model.
license: Apache-2.0
metadata:
  author: three.ws
  short-description: Measure, then cut draw calls, pixels and texture memory to a mobile budget
---

# A mobile performance budget for three.js

Targets three.js r187 (`three@0.187.0`). Every runnable block is executed in Chromium against
a real CC0 model before this plugin ships.

Measure first. Phones are usually limited by one of four things, and each has a different fix:

| Limit | Measure with | Typical mid-range phone budget | Main fixes |
| --- | --- | --- | --- |
| Draw calls (CPU) | `renderer.info.render.calls` | under 100 to 150 per frame | `InstancedMesh`, `BatchedMesh`, merging, fewer materials |
| Pixels (GPU fill rate) | frame time vs pixel ratio | pixel ratio 1.5 to 2 at most | `setPixelRatio(Math.min(devicePixelRatio, 2))`, adaptive resolution, fewer full-screen passes |
| Triangles (GPU vertex work) | `renderer.info.render.triangles` | 100k to 500k visible | LOD, simplify, cull |
| Texture memory (crashes on iOS) | estimate below; `renderer.info.memory.textures` | under 100 to 200 MB of GPU texture | KTX2/Basis, 1024 or 2048 maps, share textures |

Phones run at 60 or 120 Hz, so the frame budget is 16.7 ms or 8.3 ms, and a phone that
throttles under heat loses a third of that. Target your heaviest view at well under budget on
a mid-range Android device, not your laptop.

## 1. A measuring HUD, and instancing a glTF model

This builds 100 copies of the model two ways, as clones and as one `InstancedMesh` per mesh
in the model, measures both, and leaves the instanced version running with a live HUD.
`renderer.info` resets on every `render()`, so read it right after rendering. Press `C` to
switch to the clones and watch the draw calls jump.

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const MAX_PIXEL_RATIO = Math.min(window.devicePixelRatio, 2);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(MAX_PIXEL_RATIO);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.AgXToneMapping;
document.body.appendChild(renderer.domElement);

const hud = document.createElement('pre');
hud.style.cssText = 'position:fixed;left:8px;top:8px;margin:0;padding:8px 10px;font:12px/1.4 ui-monospace,monospace;color:#e8eaed;background:rgba(0,0,0,.6);border-radius:6px;pointer-events:none';
document.body.appendChild(hud);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x24272e);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

const gltf = await new GLTFLoader().loadAsync('model.glb');
const model = gltf.scene;
model.updateMatrixWorld(true);
const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
const spacing = Math.max(size.x, size.z) * 1.4;

const GRID = 10; // 100 copies
const placements = [];
for (let x = 0; x < GRID; x++) {
	for (let z = 0; z < GRID; z++) {
		const m = new THREE.Matrix4().makeRotationY(((x * 7 + z * 13) % 8) * (Math.PI / 4));
		m.setPosition((x - (GRID - 1) / 2) * spacing, 0, (z - (GRID - 1) / 2) * spacing);
		placements.push(m);
	}
}

// Slow path: every clone is its own set of draw calls.
const clones = new THREE.Group();
for (const m of placements) {
	const copy = model.clone(); // shares geometry and materials, still one draw call per mesh per copy
	copy.applyMatrix4(m);
	clones.add(copy);
}

// Fast path: one InstancedMesh per mesh in the model, one draw call each for all 100 copies.
const instanced = new THREE.Group();
model.traverse((mesh) => {
	if (!mesh.isMesh) return;
	const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, placements.length);
	const local = mesh.matrixWorld; // the mesh's transform inside the model
	placements.forEach((m, i) => inst.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(m, local)));
	inst.instanceMatrix.needsUpdate = true;
	inst.computeBoundingSphere(); // covers all instances, so frustum culling stays correct
	instanced.add(inst);
});

const extent = spacing * GRID;
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, spacing / 20, extent * 4);
camera.position.set(extent * 0.55, extent * 0.4, extent * 0.75);
camera.lookAt(0, 0, 0);

function measure(group) {
	scene.add(group);
	renderer.render(scene, camera);
	const { calls, triangles } = renderer.info.render;
	scene.remove(group);
	return { calls, triangles };
}
const cloneCost = measure(clones);
const instancedCost = measure(instanced);

// Upper bound for uncompressed RGBA8 textures with mipmaps. KTX2 textures are 4 to 8 times smaller.
function textureMegabytes(root) {
	const seen = new Set();
	let bytes = 0;
	root.traverse((obj) => {
		for (const material of [].concat(obj.material || [])) {
			for (const value of Object.values(material)) {
				if (!value?.isTexture || seen.has(value)) continue;
				seen.add(value);
				const { width = 0, height = 0 } = value.image || {};
				bytes += width * height * 4 * (value.generateMipmaps ? 4 / 3 : 1);
			}
		}
	});
	return bytes / 1048576;
}
const textureMB = textureMegabytes(model);

let showClones = false;
scene.add(instanced);
window.addEventListener('keydown', (e) => {
	if (e.key.toLowerCase() !== 'c') return;
	showClones = !showClones;
	scene.remove(showClones ? instanced : clones);
	scene.add(showClones ? clones : instanced);
});

// Adaptive resolution: drop the pixel ratio when the 90th percentile frame is over budget,
// raise it back when there is headroom. Checked twice a second, never per frame.
const BUDGET_MS = 1000 / 60;
const frames = [];
let pixelRatio = MAX_PIXEL_RATIO;
let lastCheck = 0;
function adaptResolution(now) {
	if (now - lastCheck < 500 || frames.length < 20) return;
	lastCheck = now;
	const p90 = [...frames].sort((a, b) => a - b)[Math.floor(frames.length * 0.9)];
	const next = p90 > BUDGET_MS * 1.2 ? Math.max(0.75, pixelRatio - 0.25) : p90 < BUDGET_MS * 0.7 ? Math.min(MAX_PIXEL_RATIO, pixelRatio + 0.25) : pixelRatio;
	if (next !== pixelRatio) {
		pixelRatio = next;
		renderer.setPixelRatio(pixelRatio);
		renderer.setSize(window.innerWidth, window.innerHeight);
	}
}

window.addEventListener('resize', () => {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
});

const timer = new THREE.Timer();
renderer.setAnimationLoop((time) => {
	timer.update(time);
	const ms = timer.getDelta() * 1000;
	if (ms > 0) {
		frames.push(ms);
		if (frames.length > 120) frames.shift();
	}
	renderer.render(scene, camera);
	const { calls, triangles } = renderer.info.render;
	const sorted = [...frames].sort((a, b) => a - b);
	hud.textContent = [
		`mode         ${showClones ? 'clones (press C)' : 'instanced (press C)'}`,
		`draw calls   ${calls}   (clones ${cloneCost.calls}, instanced ${instancedCost.calls})`,
		`triangles    ${triangles.toLocaleString()}`,
		`geometries   ${renderer.info.memory.geometries}   textures ${renderer.info.memory.textures}`,
		`texture mem  ~${textureMB.toFixed(1)} MB (uncompressed estimate)`,
		`frame        p50 ${(sorted[sorted.length >> 1] || 0).toFixed(1)} ms   p90 ${(sorted[Math.floor(sorted.length * 0.9)] || 0).toFixed(1)} ms`,
		`pixel ratio  ${pixelRatio.toFixed(2)} of ${MAX_PIXEL_RATIO}`,
	].join('\n');
	adaptResolution(time);
});
```

What the numbers mean:

- **Draw calls** scale with meshes times materials times copies. 100 clones of a 3-mesh model
  is 300 calls; instanced it is 3. Same triangles, a fraction of the CPU cost.
- **Frame time** from `THREE.Timer` is the time between frames, which is what the user feels.
  Use the 90th percentile, not the average: one 50 ms hitch per second reads as stutter even
  when the average is fine. `THREE.Clock` is deprecated since r183; use `Timer`.
- **Texture memory** is what crashes iOS Safari: the tab reloads with no error when GPU memory
  runs out. A single 4096 x 4096 RGBA texture with mipmaps is about 85 MB uncompressed and about
  11 to 21 MB as KTX2. See the `load-and-optimize-gltf` skill for the conversion command.

## 2. Many different objects: BatchedMesh

`InstancedMesh` needs one geometry. When the copies differ (a room of different props sharing
one material or texture atlas), `BatchedMesh` draws them all in one call with per-instance
geometry and per-instance frustum culling.

```js
// partial: assumes geometries[] share one material and placements[] holds Matrix4s
const maxVertices = geometries.reduce((n, g) => n + g.attributes.position.count, 0);
const maxIndices = geometries.reduce((n, g) => n + (g.index ? g.index.count : 0), 0);
const batch = new THREE.BatchedMesh(placements.length, maxVertices, maxIndices, material);
const ids = geometries.map((g) => batch.addGeometry(g));
placements.forEach((matrix, i) => {
	const instance = batch.addInstance(ids[i % ids.length]);
	batch.setMatrixAt(instance, matrix);
});
scene.add(batch);
```

All geometries in a batch need the same attributes, so normalize them first (for example
with `BufferGeometryUtils.mergeVertices` and by adding missing `uv` or `normal` attributes).

## 3. The checklist, in order of payoff

1. `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))`. A 3x phone screen renders
   2.25 times the pixels of 2x for no visible gain.
2. Instance or batch anything repeated. Merge static meshes that share a material
   (`BufferGeometryUtils.mergeGeometries`).
3. Compress textures to KTX2 and cap them at 2048 (1024 for props). Share one texture across
   materials instead of loading copies.
4. Fewer lights and shadows: each shadow-casting light renders the scene again. Freeze the
   shadow map for static scenes (`shadows-that-look-right` skill).
5. Drop or halve full-screen post-processing on phones; each pass touches every pixel.
6. Render on demand for static viewers: draw only when the camera or scene changes
   (`controls.addEventListener('change', render)`) instead of every frame.
7. Dispose what you remove: `geometry.dispose()`, `material.dispose()`, `texture.dispose()`.
   `renderer.info.memory` climbing over time is a leak.
8. Measure on a real phone with remote debugging (Chrome `chrome://inspect`, Safari Web
   Inspector), with the device warm.

When post-processing renders the scene several times per frame, set
`renderer.info.autoReset = false` and call `renderer.info.reset()` once per frame, so the
counts cover every pass.

## References

- WebGLRenderer (`info`, `setPixelRatio`, `powerPreference`): https://threejs.org/docs/pages/WebGLRenderer.html
- Info (`render.calls`, `render.triangles`, `memory`, `autoReset`, `reset`): https://threejs.org/docs/pages/Info.html
- InstancedMesh (`setMatrixAt`, `instanceMatrix`, `computeBoundingSphere`): https://threejs.org/docs/pages/InstancedMesh.html
- BatchedMesh (`addGeometry`, `addInstance`, `setMatrixAt`): https://threejs.org/docs/pages/BatchedMesh.html
- BufferGeometryUtils (`mergeGeometries`, `mergeVertices`): https://threejs.org/docs/pages/module-BufferGeometryUtils.html
- Timer: https://threejs.org/docs/pages/Timer.html
- Object3D (`clone`, `applyMatrix4`, `updateMatrixWorld`): https://threejs.org/docs/pages/Object3D.html
- Matrix4: https://threejs.org/docs/pages/Matrix4.html
- Texture (`generateMipmaps`, `dispose`): https://threejs.org/docs/pages/Texture.html
- KTX2Loader: https://threejs.org/docs/pages/KTX2Loader.html
- GLTFLoader: https://threejs.org/docs/pages/GLTFLoader.html
- Box3: https://threejs.org/docs/pages/Box3.html
- How to dispose of objects (manual): https://threejs.org/manual/#en/how-to-dispose-of-objects
- Optimize lots of objects (manual): https://threejs.org/manual/#en/optimize-lots-of-objects
- Rendering on demand (manual): https://threejs.org/manual/#en/rendering-on-demand
