---
name: load-and-optimize-gltf
description: >-
  Load glTF/GLB models in three.js with GLTFLoader wired to the Meshopt, KTX2 and Draco decoders, shrink the file first with glTF Transform (`gltf-transform optimize`), and measure what changed (bytes over the wire, decode time, draw calls, triangles, texture memory). Use when a model will not load, loads slowly, is too big for the web, throws a decoder error ("setMeshoptDecoder must be called", "No DRACOLoader instance provided", "KTX2Loader"), or when the user asks how to compress, optimize or load a GLB.
when_to_use: Any time a .glb or .gltf goes into a three.js page, and before shipping a model larger than about 2 MB.
license: Apache-2.0
metadata:
  author: three.ws
  short-description: GLTFLoader with every decoder, gltf-transform optimize, and how to measure
---

# Load and optimize glTF in three.js

Targets three.js r187 (`three@0.187.0`). Every runnable block below is executed in Chromium
against a real CC0 model before this plugin ships.

The order that works: **optimize the file, then load it with one loader that knows every
decoder, then measure.** A loader without the decoders fails on compressed files, and a
compressed file without measurement is a guess.

## 1. Optimize the file

[glTF Transform](https://gltf-transform.dev/cli) does it in one command. `model.glb` is your
source file; nothing to install beyond Node.

```bash
npx @gltf-transform/cli@4.5.1 inspect model.glb
npx @gltf-transform/cli@4.5.1 optimize model.glb model-optimized.glb --compress meshopt --texture-compress ktx2 --texture-size 2048
```

- `--compress meshopt` compresses geometry and animation. It decodes faster than Draco and
  is the default.
- `--texture-compress ktx2` writes GPU-compressed Basis Universal textures: they stay
  compressed in GPU memory (4 to 8 times smaller than a decoded JPEG or PNG). It needs the
  `ktx` CLI from [KTX-Software](https://github.com/KhronosGroup/KTX-Software/releases) on
  `PATH`. Without it, use `--texture-compress webp`: smaller downloads, same GPU memory as
  the original.
- `--texture-size 2048` caps every texture. Use 1024 for props on mobile.

KTX2 and WebP win on different axes. Measured on a CC0 armchair from the three.ws catalog
(three 1024x1024 JPEG textures), with the `gpuSize` column of `inspect`:

| File | Download | Texture VRAM |
| --- | --- | --- |
| `model.glb` (source) | 1.70 MB | 16.8 MB |
| `model-optimized.glb` (Meshopt + KTX2) | 2.05 MB | 3.5 MB |
| `model-draco.glb` (Draco + WebP, below) | 0.20 MB | 16.8 MB |

`optimize` encodes normal and roughness maps as UASTC (high quality, large on disk) and base
color as ETC1S (small), so the KTX2 file can be bigger than the JPEG source while using a
fifth of the GPU memory. Pick KTX2 when many textures must stay resident (scenes, mobile,
WebXR). Pick WebP when one model must arrive fast and VRAM is not the limit.

If an existing pipeline already standardizes on Draco, this variant keeps it:

```bash
npx @gltf-transform/cli@4.5.1 optimize model.glb model-draco.glb --compress draco --texture-compress webp
```

**Check what `optimize` changes before you ship it.** By default it flattens the scene graph
and joins meshes to cut draw calls. That renames and merges nodes, so code that calls
`getObjectByName('Door')` or animates a single part breaks. Keep named parts with
`--join-named false`, or keep the hierarchy with `--flatten false --join false`. It also
simplifies geometry (`--simplify-error 0.0001` of the mesh extent); pass `--simplify false`
for CAD or anything with hard silhouettes.

## 2. Load with one loader that knows every decoder

Create the loader once and reuse it for every model. The decoders run in workers and
spinning them up per file wastes time.

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Decoder files ship inside the three package. Pin the CDN path to the same version
// you import, or copy examples/jsm/libs/{draco,basis} into your static folder.
const LIBS = 'https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/libs/';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1d2026);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.01, 100);

const draco = new DRACOLoader().setDecoderPath(`${LIBS}draco/gltf/`);
const ktx2 = new KTX2Loader().setTranscoderPath(`${LIBS}basis/`).detectSupport(renderer);
const loader = new GLTFLoader().setDRACOLoader(draco).setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);

// Both outputs from step 1, side by side: Meshopt + KTX2 on the left, Draco + WebP on the right.
const [meshopt, dracoModel] = await Promise.all([
	loader.loadAsync('model-optimized.glb'),
	loader.loadAsync('model-draco.glb'),
]);
const group = new THREE.Group();
for (const [i, gltf] of [meshopt, dracoModel].entries()) {
	const size = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
	gltf.scene.position.x = (i - 0.5) * size.x * 1.3;
	group.add(gltf.scene);
}
scene.add(group);
frameObject(camera, group);

window.addEventListener('resize', () => {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
});
renderer.setAnimationLoop(() => renderer.render(scene, camera));

// Points the camera at any object, whatever its scale or origin.
function frameObject(cam, object) {
	const box = new THREE.Box3().setFromObject(object);
	const center = box.getCenter(new THREE.Vector3());
	const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
	const distance = radius / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2));
	cam.position.copy(center).add(new THREE.Vector3(0.4, 0.3, 1).normalize().multiplyScalar(distance));
	cam.near = distance / 100;
	cam.far = distance * 100;
	cam.updateProjectionMatrix();
	cam.lookAt(center);
}
```

Things that commonly go wrong here:

| Symptom | Cause | Fix |
| --- | --- | --- |
| `THREE.GLTFLoader: setMeshoptDecoder must be called before loading compressed files` | File uses `EXT_meshopt_compression` | `loader.setMeshoptDecoder(MeshoptDecoder)` |
| `THREE.GLTFLoader: No DRACOLoader instance provided` | File uses `KHR_draco_mesh_compression` | `loader.setDRACOLoader(draco)` |
| `THREE.GLTFLoader: setKTX2Loader must be called before loading KTX2 textures` | File uses `KHR_texture_basisu` | `loader.setKTX2Loader(ktx2.detectSupport(renderer))` |
| 404 on `draco_wasm_wrapper.js` or `basis_transcoder.js` | Decoder path points at the wrong folder | The path must end in `draco/gltf/` or `basis/` with a trailing slash |
| `Multiple instances of Three.js being imported` | A CDN import plus an npm import, or two versions | Import `three` from one place; pin the decoder path to the same version |
| Model loads but renders black | No light and no environment | Set `scene.environment` (see `pbr-materials-and-lighting`) |

To see which extensions a file needs without loading it, run
`npx @gltf-transform/cli@4.5.1 inspect model.glb` and read the `extensionsUsed` line.

## 3. Measure

Never claim an optimization without numbers. This block loads the original and the
optimized file with the same loader and prints download size, load-plus-decode time, draw
calls, triangles and estimated texture memory for each.

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.background = new THREE.Color(0x1d2026);
const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.01, 100);

const ktx2 = new KTX2Loader()
	.setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/libs/basis/')
	.detectSupport(renderer);
const loader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);

async function measure(url) {
	const t0 = performance.now();
	const gltf = await loader.loadAsync(url);
	const loadMs = performance.now() - t0;
	const entry = performance.getEntriesByName(new URL(url, location.href).href).pop();

	const probe = new THREE.Scene();
	probe.environment = scene.environment;
	probe.add(gltf.scene);
	renderer.info.reset();
	renderer.render(probe, camera);
	const { calls, triangles } = renderer.info.render;
	scene.add(gltf.scene);

	return {
		file: url,
		downloadKB: Math.round((entry?.encodedBodySize ?? 0) / 1024),
		loadAndDecodeMs: Math.round(loadMs),
		drawCalls: calls,
		triangles,
		textureMB: +(textureBytes(gltf.scene) / 1048576).toFixed(1),
		root: gltf.scene,
	};
}

// GPU bytes for every unique texture: compressed mip data as stored, or
// width x height x 4 bytes plus a third for the mip chain.
function textureBytes(root) {
	const seen = new Set();
	let bytes = 0;
	root.traverse((obj) => {
		for (const material of [obj.material].flat().filter(Boolean)) {
			for (const value of Object.values(material)) {
				if (!value?.isTexture || seen.has(value)) continue;
				seen.add(value);
				bytes += value.isCompressedTexture
					? value.mipmaps.reduce((sum, mip) => sum + mip.data.byteLength, 0)
					: value.image.width * value.image.height * 4 * (4 / 3);
			}
		}
	});
	return bytes;
}

const rows = [await measure('model.glb'), await measure('model-optimized.glb')];
console.table(rows.map(({ root, ...row }) => row));

const width = new THREE.Box3().setFromObject(rows[0].root).getSize(new THREE.Vector3()).x;
rows[1].root.position.x = width * 1.3;
const box = new THREE.Box3().setFromObject(scene);
const center = box.getCenter(new THREE.Vector3());
const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
camera.position.copy(center).add(new THREE.Vector3(0, 0.3, 1).normalize().multiplyScalar(radius * 2.6));
camera.near = radius / 50;
camera.far = radius * 50;
camera.updateProjectionMatrix();
camera.lookAt(center);
renderer.setAnimationLoop(() => renderer.render(scene, camera));
```

Read the table this way: `downloadKB` is what the user waits for, `loadAndDecodeMs` is the
main-thread and worker cost, `drawCalls` is the per-frame CPU cost, and `textureMB` is what
decides whether a phone keeps the tab alive. KTX2 is the only lever that moves `textureMB`;
WebP and smaller JPEGs only move `downloadKB`.

Measure in the field too: Chrome DevTools, Network tab, with "Disable cache" and a
throttling profile shows real transfer time, and the Performance tab shows decode work on
the worker threads.

## 4. Free memory when a model leaves

Removing a model from the scene does not free GPU memory. Dispose what it owned:

```js
// partial: needs a loaded gltf and the scene it was added to
scene.remove(gltf.scene);
gltf.scene.traverse((obj) => {
	obj.geometry?.dispose();
	for (const material of [obj.material].flat().filter(Boolean)) {
		for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
		material.dispose();
	}
});
```

When the page is done with loading entirely, `draco.dispose()` and `ktx2.dispose()` stop
their workers.

## References

- GLTFLoader: https://threejs.org/docs/pages/GLTFLoader.html
- DRACOLoader: https://threejs.org/docs/pages/DRACOLoader.html
- KTX2Loader: https://threejs.org/docs/pages/KTX2Loader.html
- MeshoptDecoder (no docs page; the module is the reference): https://github.com/mrdoob/three.js/blob/r187/examples/jsm/libs/meshopt_decoder.module.js
- RoomEnvironment: https://threejs.org/docs/pages/RoomEnvironment.html
- PMREMGenerator: https://threejs.org/docs/pages/PMREMGenerator.html
- WebGLRenderer (including `info`, `setPixelRatio`, `setAnimationLoop`): https://threejs.org/docs/pages/WebGLRenderer.html
- Scene: https://threejs.org/docs/pages/Scene.html
- PerspectiveCamera: https://threejs.org/docs/pages/PerspectiveCamera.html
- Group: https://threejs.org/docs/pages/Group.html
- Box3: https://threejs.org/docs/pages/Box3.html
- Sphere: https://threejs.org/docs/pages/Sphere.html
- Vector3: https://threejs.org/docs/pages/Vector3.html
- Color: https://threejs.org/docs/pages/Color.html
- MathUtils: https://threejs.org/docs/pages/MathUtils.html
- glTF Transform CLI: https://gltf-transform.dev/cli
- Disposing of things: https://threejs.org/manual/#en/how-to-dispose-of-objects
