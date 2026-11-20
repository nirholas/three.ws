---
name: postprocessing-pipeline
description: >-
  Build a correct three.js post-processing chain: EffectComposer with RenderPass, ambient occlusion (GTAOPass), bloom (UnrealBloomPass), OutputPass for tone mapping and sRGB, and antialiasing with an MSAA render target or SMAAPass, plus the WebGPU equivalent with RenderPipeline and TSL nodes (pass, bloom). Use when adding bloom, glow, ambient occlusion, SSAO, antialiasing or any screen effect, or when a scene gets washed out, too dark, banded, jagged or loses its colors after adding EffectComposer, or when porting post-processing to WebGPURenderer.
when_to_use: Adding or fixing screen-space effects (bloom, AO, antialiasing, tone mapping in a composer) in WebGLRenderer or WebGPURenderer.
license: Apache-2.0
metadata:
  author: three.ws
  short-description: EffectComposer and RenderPipeline chains with correct color, AA and resize
---

# Post-processing pipelines in three.js

Targets three.js r187 (`three@0.187.0`). Every runnable block is executed in Chromium against
a real CC0 model before this plugin ships.

The rule that prevents most composer bugs: **once you use a composer, tone mapping and the
sRGB conversion happen in `OutputPass`, not in the renderer.** `renderer.toneMapping` is
still where you choose the curve, and `OutputPass` reads it. Without `OutputPass` the image
comes out dark and flat (linear values on an sRGB screen). With `OutputPass` in the wrong
place, effects after it run on already tone-mapped colors.

The order that works:

1. `RenderPass` draws the scene into a half-float buffer (linear, HDR).
2. Effects that need linear HDR values: AO, bloom, depth of field.
3. `OutputPass`: tone mapping plus linear to sRGB.
4. Effects that want display colors: `SMAAPass`, FXAA, film grain, vignette.

## 1. WebGLRenderer: bloom, output and MSAA

A composer renders into its own target, so the canvas `antialias: true` flag no longer
helps. Give the composer a multisampled render target instead (WebGL2 MSAA, cheap and sharp).

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const renderer = new THREE.WebGLRenderer(); // antialias does nothing once a composer owns the frame
const pixelRatio = Math.min(window.devicePixelRatio, 2);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.AgXToneMapping; // OutputPass applies this
renderer.toneMappingExposure = 1;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1d2026);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

const gltf = await new GLTFLoader().loadAsync('model.glb');
scene.add(gltf.scene);
const { center, radius } = new THREE.Box3().setFromObject(gltf.scene).getBoundingSphere(new THREE.Sphere());

// A bright emissive ring gives bloom something above 1.0 to catch.
const ring = new THREE.Mesh(
	new THREE.TorusGeometry(radius * 1.15, radius * 0.02, 16, 128),
	new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x66ccff, emissiveIntensity: 6 }),
);
ring.position.copy(center);
ring.rotation.x = Math.PI / 2;
scene.add(ring);

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, radius / 50, radius * 50);
camera.position.copy(center).add(new THREE.Vector3(0.8, 0.5, 1).normalize().multiplyScalar(radius * 3.4));
camera.lookAt(center);

// HalfFloat keeps values above 1.0 so bloom and tone mapping have HDR to work with.
const target = new THREE.WebGLRenderTarget(window.innerWidth * pixelRatio, window.innerHeight * pixelRatio, {
	type: THREE.HalfFloatType,
	samples: 4,
});
const composer = new EffectComposer(renderer, target);
composer.setPixelRatio(pixelRatio);
composer.setSize(window.innerWidth, window.innerHeight);

composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.6, 0.4, 1.0);
composer.addPass(bloom); // threshold 1.0: only HDR highlights glow, not white walls
composer.addPass(new OutputPass());

window.addEventListener('resize', () => {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
	composer.setSize(window.innerWidth, window.innerHeight); // resizes every pass
});

const timer = new THREE.Timer();
renderer.setAnimationLoop((time) => {
	timer.update(time);
	ring.rotation.z = timer.getElapsed() * 0.4;
	composer.render(timer.getDelta());
});
```

- `UnrealBloomPass(resolution, strength, radius, threshold)`. Keep `threshold` near 1 with
  HDR emissive materials so only genuine highlights bloom. A threshold of 0 blooms everything
  and reads as fog.
- `composer.render(delta)` passes the frame delta to time-based passes.
- `THREE.Clock` is deprecated since r183 and logs a warning; use `THREE.Timer` as above.

## 2. Ambient occlusion with GTAOPass, antialiased by SMAA

`GTAOPass` renders the scene again for depth and normals, so it is the most expensive common
pass. Pair it with `SMAAPass` rather than a multisampled target: MSAA would multiply the cost
of every full-screen pass. `SMAAPass` goes **after** `OutputPass` because it finds edges in
display colors.

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

const renderer = new THREE.WebGLRenderer();
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.NeutralToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe8e6e1);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

const gltf = await new GLTFLoader().loadAsync('model.glb');
scene.add(gltf.scene);
const box = new THREE.Box3().setFromObject(gltf.scene);
gltf.scene.position.y -= box.min.y;
const { center, radius } = new THREE.Box3().setFromObject(gltf.scene).getBoundingSphere(new THREE.Sphere());

const floor = new THREE.Mesh(new THREE.CircleGeometry(radius * 4, 64), new THREE.MeshStandardMaterial({ color: 0xd6d2ca }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor); // AO darkens where the legs meet the floor, with no shadow map at all

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, radius / 50, radius * 50);
camera.position.copy(center).add(new THREE.Vector3(-0.7, 0.45, 1).normalize().multiplyScalar(radius * 3.2));
camera.lookAt(center);

const composer = new EffectComposer(renderer); // default half-float target, no MSAA
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera, window.innerWidth, window.innerHeight);
gtao.updateGtaoMaterial({ radius: radius * 0.25 }); // AO radius is in world units
composer.addPass(gtao);
composer.addPass(new OutputPass());
composer.addPass(new SMAAPass()); // r187 takes no constructor arguments; setSize sets resolution

window.addEventListener('resize', () => {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
	composer.setSize(window.innerWidth, window.innerHeight);
});
renderer.setAnimationLoop(() => composer.render());
```

On phones, drop `GTAOPass` or bake AO into the model's `aoMap`; baked AO costs nothing per
frame.

## 3. WebGPURenderer: RenderPipeline with TSL nodes

`WebGPURenderer` replaces the pass list with a node graph. `pass(scene, camera)` renders the
scene to a texture node; effects are functions over nodes; `RenderPipeline` renders the
result and applies tone mapping and color space conversion at the end (its
`outputColorTransform` defaults to `true`). `RenderPipeline` was called `PostProcessing`
before r183; the old name is a deprecated alias. The same code runs on WebGL2 when WebGPU is
not available.

```js
import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.AgXToneMapping;
document.body.appendChild(renderer.domElement);
await renderer.init();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1d2026);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

const gltf = await new GLTFLoader().loadAsync('model.glb');
scene.add(gltf.scene);
const { center, radius } = new THREE.Box3().setFromObject(gltf.scene).getBoundingSphere(new THREE.Sphere());

const ring = new THREE.Mesh(
	new THREE.TorusGeometry(radius * 1.15, radius * 0.02, 16, 128),
	new THREE.MeshStandardNodeMaterial({ color: 0x000000, emissive: 0xffaa55, emissiveIntensity: 6 }),
);
ring.position.copy(center);
ring.rotation.x = Math.PI / 2;
scene.add(ring);

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, radius / 50, radius * 50);
camera.position.copy(center).add(new THREE.Vector3(0.8, 0.5, 1).normalize().multiplyScalar(radius * 3.4));
camera.lookAt(center);

const scenePass = pass(scene, camera);
const sceneColor = scenePass.getTextureNode('output');
const pipeline = new THREE.RenderPipeline(renderer);
pipeline.outputNode = sceneColor.add(bloom(sceneColor, 0.6, 0.4, 1.0)); // strength, radius, threshold

window.addEventListener('resize', () => {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight); // pass nodes follow the renderer size
});
renderer.setAnimationLoop(() => {
	ring.rotation.z += 0.005;
	pipeline.render();
});
```

To add ambient occlusion on WebGPU, render normals with `mrt` and feed them to `ao()` from
`three/addons/tsl/display/GTAONode.js`; the three.js `webgpu_postprocessing_ao` example is
the reference wiring.

## 4. Diagnose by symptom

| Symptom | Cause | Fix |
| --- | --- | --- |
| Image darker and flatter after adding a composer | No `OutputPass`, so linear values reach the screen | Add `OutputPass` as the last color pass |
| Colors double tone-mapped, washed out | A custom `ShaderPass` that also converts to sRGB, or `OutputPass` twice | One `OutputPass` only |
| Jagged edges came back | Canvas MSAA does not apply to composer targets | `samples: 4` on the composer target, or `SMAAPass` after `OutputPass` |
| Banding in dark gradients | 8-bit intermediate target | `type: THREE.HalfFloatType` on the target |
| Whole scene glows | Bloom threshold too low | Threshold near 1; push highlights with `emissiveIntensity` above 1 |
| Effects blurry or offset after resizing | Composer not resized | `composer.setSize` in the resize handler |
| Blurry on retina screens | Composer pixel ratio left at 1 | `composer.setPixelRatio(renderer.getPixelRatio())` |
| `PostProcessing is deprecated` warning | Pre-r183 WebGPU name | Rename to `RenderPipeline` |

## References

- How to use post-processing (manual): https://threejs.org/manual/#en/post-processing
- EffectComposer: https://threejs.org/docs/pages/EffectComposer.html
- RenderPass: https://threejs.org/docs/pages/RenderPass.html
- GTAOPass: https://threejs.org/docs/pages/GTAOPass.html
- UnrealBloomPass: https://threejs.org/docs/pages/UnrealBloomPass.html
- OutputPass: https://threejs.org/docs/pages/OutputPass.html
- SMAAPass: https://threejs.org/docs/pages/SMAAPass.html
- WebGLRenderTarget (`samples`, `type`): https://threejs.org/docs/pages/WebGLRenderTarget.html
- Timer: https://threejs.org/docs/pages/Timer.html
- WebGPURenderer: https://threejs.org/docs/pages/WebGPURenderer.html
- RenderPipeline: https://threejs.org/docs/pages/RenderPipeline.html
- PassNode (`pass`, `getTextureNode`): https://threejs.org/docs/pages/PassNode.html
- BloomNode (`bloom`): https://threejs.org/docs/pages/BloomNode.html
- GTAONode (`ao`): https://threejs.org/docs/pages/GTAONode.html
- MeshStandardNodeMaterial: https://threejs.org/docs/pages/MeshStandardNodeMaterial.html
- TorusGeometry: https://threejs.org/docs/pages/TorusGeometry.html
- CircleGeometry: https://threejs.org/docs/pages/CircleGeometry.html
- MeshStandardMaterial (`aoMap`, `emissiveIntensity`): https://threejs.org/docs/pages/MeshStandardMaterial.html
- Tone mapping constants: https://threejs.org/docs/pages/global.html
- WebGPU AO example: https://threejs.org/examples/#webgpu_postprocessing_ao
