---
name: pbr-materials-and-lighting
description: >-
  Make three.js PBR materials look right: color management (sRGB output, which textures are sRGB and which are linear), tone mapping (AgX, Neutral, ACES Filmic) and exposure, image-based lighting from RoomEnvironment or an HDR file through PMREMGenerator, and how roughness and metalness actually respond. Use when a model looks washed out, too dark, flat, plasticky, over-saturated or black; when colors do not match the reference or Blender; when metal looks black; or when the user asks how to light a scene, add an HDRI or environment map, or pick a tone mapper.
when_to_use: Setting up any lit three.js scene with MeshStandardMaterial or MeshPhysicalMaterial, or debugging why one looks wrong.
license: Apache-2.0
metadata:
  author: three.ws
  short-description: Color management, tone mapping, IBL and PBR parameters that look right
---

# PBR materials and lighting in three.js

Targets three.js r187 (`three@0.187.0`). Every runnable block is executed in Chromium before
this plugin ships.

Most "my model looks wrong" reports come from four settings, in this order of frequency:

1. **No environment.** PBR materials reflect their surroundings. With only a
   `DirectionalLight`, metal has nothing to reflect and renders black, and everything looks
   flat. Set `scene.environment`.
2. **A color texture tagged as linear.** Base color and emissive maps are sRGB. Normal,
   roughness, metalness and AO maps are linear data. `GLTFLoader` tags them for you; textures
   you load yourself must be tagged by hand.
3. **No tone mapping.** Lit scenes produce values above 1.0. Without a tone mapper they clip
   to white. `ACESFilmicToneMapping`, `AgXToneMapping` and `NeutralToneMapping` roll them off.
4. **Exposure left at the default** after switching tone mapper or environment.

Color management is on by default since r152 (`THREE.ColorManagement.enabled === true`) and
`renderer.outputColorSpace` defaults to `THREE.SRGBColorSpace`. Leave both alone. The old
names were `renderer.outputEncoding = THREE.sRGBEncoding` and `texture.encoding`; both were
removed in r162. `renderer.useLegacyLights` (physically incorrect light units) was removed in
r165, so intensities are physical: a `DirectionalLight` intensity is in lux-like units and a
`PointLight` is in candela with real distance falloff.

## 1. A correct lit scene, and how roughness and metalness respond

The grid below sweeps roughness left to right and metalness bottom to top under a
`RoomEnvironment`. Use it to calibrate expectations before blaming a model.

```js
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x202124);

// Image-based lighting: PMREMGenerator prefilters the environment once so every
// roughness level samples a correctly blurred reflection.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();

// A color texture you build or load yourself must be tagged as sRGB.
const canvas = document.createElement('canvas');
canvas.width = canvas.height = 256;
const ctx = canvas.getContext('2d');
for (let i = 0; i < 8; i++) {
	for (let j = 0; j < 8; j++) {
		ctx.fillStyle = (i + j) % 2 ? '#d94f30' : '#f2e8cf';
		ctx.fillRect(i * 32, j * 32, 32, 32);
	}
}
const checker = new THREE.CanvasTexture(canvas);
checker.colorSpace = THREE.SRGBColorSpace;
checker.anisotropy = renderer.capabilities.getMaxAnisotropy();

const geometry = new THREE.SphereGeometry(0.4, 64, 32);
const steps = 5;
for (let m = 0; m < 3; m++) {
	for (let r = 0; r < steps; r++) {
		const material = new THREE.MeshStandardMaterial({
			color: m === 2 ? 0xffffff : 0xc9a227,
			map: m === 2 ? checker : null,
			metalness: m === 1 ? 1 : 0,
			roughness: r / (steps - 1),
		});
		const sphere = new THREE.Mesh(geometry, material);
		sphere.position.set((r - (steps - 1) / 2) * 1, (m - 1) * 1, 0);
		scene.add(sphere);
	}
}

const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 8);

window.addEventListener('resize', () => {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
});
renderer.setAnimationLoop(() => renderer.render(scene, camera));
```

What to notice: the top row (metalness 0 with a texture) keeps its colors under AgX; the
middle row (metalness 1) is pure reflection, so it is only as interesting as the environment;
roughness 0 spheres show a sharp room, roughness 1 shows a soft gradient. If your model's
metal looks black, it is the middle row without an environment.

Rules of thumb for authored values:

- Metalness is binary in nature: 0 for dielectrics (wood, plastic, skin, stone), 1 for bare
  metal. Values in between are for blending masks, not for "a bit shiny".
- Pure black or pure white base colors do not occur in nature. Keep albedo between about
  `0x1e1e1e` and `0xf0f0f0`.
- Need clear coat, sheen (fabric), transmission (glass), iridescence or physical IOR? Use
  `MeshPhysicalMaterial`. It costs more per pixel, so use it only on the meshes that need it.

## 2. Light with a real HDR environment

`RoomEnvironment` is a neutral studio built in code. For a specific mood, load an
equirectangular `.hdr`. This one is CC0 from Poly Haven and served with open CORS.

```js
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.1;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.01, 100);

const [hdr, gltf] = await Promise.all([
	new HDRLoader().loadAsync('https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr'),
	new GLTFLoader().loadAsync('model.glb'),
]);

// An equirectangular texture assigned to scene.environment is converted to a
// prefiltered PMREM by the renderer on first use.
hdr.mapping = THREE.EquirectangularReflectionMapping;
scene.environment = hdr;
scene.environmentIntensity = 1;
scene.background = hdr;
scene.backgroundBlurriness = 0.35; // keeps a 1k HDR from looking pixelated behind the model
scene.backgroundIntensity = 0.6; // darker backdrop, same lighting on the model
scene.add(gltf.scene);

const box = new THREE.Box3().setFromObject(gltf.scene);
const center = box.getCenter(new THREE.Vector3());
const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
camera.position.copy(center).add(new THREE.Vector3(0.5, 0.25, 1).normalize().multiplyScalar(radius * 2.6));
camera.near = radius / 50;
camera.far = radius * 50;
camera.updateProjectionMatrix();
camera.lookAt(center);

window.addEventListener('resize', () => {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
});
renderer.setAnimationLoop(() => renderer.render(scene, camera));
```

`HDRLoader` was called `RGBELoader` until r180; the old name still exists as an alias but has
no docs page. For `.exr` files use `EXRLoader`; for large environments prefer a prefiltered
`.ktx2` or a smaller (1k or 2k) HDR, since a 4k HDR is about 50 MB of float data.

Rotate the environment instead of the model with `scene.environmentRotation.y` and
`scene.backgroundRotation.y` (both Euler, radians).

## 3. Pick a tone mapper by comparing, not guessing

The block renders one scene four times side by side with `setScissor`, one tone mapper per
quarter: none, ACES Filmic, AgX, Neutral.

```js
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODES = [
	['None', THREE.NoToneMapping],
	['ACES Filmic', THREE.ACESFilmicToneMapping],
	['AgX', THREE.AgXToneMapping],
	['Neutral', THREE.NeutralToneMapping],
];

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setScissorTest(true);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x30343b);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

// A bright key light pushes highlights past 1.0 so the tone mappers differ visibly.
const sun = new THREE.DirectionalLight(0xffffff, 4);
sun.position.set(2, 3, 2);
scene.add(sun);

const gltf = await new GLTFLoader().loadAsync('model.glb');
scene.add(gltf.scene);

const box = new THREE.Box3().setFromObject(gltf.scene);
const center = box.getCenter(new THREE.Vector3());
const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
const camera = new THREE.PerspectiveCamera(30, 1, radius / 50, radius * 50);
camera.position.copy(center).add(new THREE.Vector3(0.6, 0.3, 1).normalize().multiplyScalar(radius * 3.2));
camera.lookAt(center);

for (const [i, [name]] of MODES.entries()) {
	const label = document.createElement('div');
	label.textContent = name;
	label.style.cssText = `position:fixed;top:8px;left:${i * 25 + 1}%;color:#fff;font:600 13px system-ui`;
	document.body.appendChild(label);
}

renderer.setAnimationLoop(() => {
	const width = window.innerWidth / MODES.length;
	const height = window.innerHeight;
	camera.aspect = width / height;
	camera.updateProjectionMatrix();
	for (const [i, [, mode]] of MODES.entries()) {
		renderer.toneMapping = mode;
		renderer.setViewport(i * width, 0, width, height);
		renderer.setScissor(i * width, 0, width, height);
		renderer.render(scene, camera);
	}
});
window.addEventListener('resize', () => renderer.setSize(window.innerWidth, window.innerHeight));
```

How they differ:

- **ACES Filmic**: contrasty and filmic, shifts saturated colors (bright reds go orange,
  blues go purple). Good for moody scenes, wrong for product color.
- **AgX**: desaturates highlights gracefully instead of clipping hues. The default choice for
  scenes with bright lights and emissive materials.
- **Neutral** (Khronos PBR Neutral): keeps base colors close to their authored sRGB values
  under normal lighting. The choice for e-commerce, configurators and anywhere the color must
  match a swatch.
- **None**: only for unlit or already tone-mapped content (UI, video, baked lighting).

Tone mapping applies when rendering to the screen. With an `EffectComposer` it moves to
`OutputPass`; see the `postprocessing-pipeline` skill.

## 4. Direct lights alongside the environment

Environment light gives soft fill. Add a direct light only for a defined highlight or
shadows:

```js
// partial: adds to a scene that already has scene.environment
const key = new THREE.DirectionalLight(0xffffff, 2.5);
key.position.set(3, 4, 2);
scene.add(key);
scene.environmentIntensity = 0.6; // lower the fill so the key reads
```

`HemisphereLight` is a cheap substitute for an environment on low-end devices, but it gives
no reflections, so metals still look dead under it.

## References

- Color management (manual): https://threejs.org/manual/#en/color-management
- ColorManagement (no docs page; the module is the reference): https://github.com/mrdoob/three.js/blob/r187/src/math/ColorManagement.js
- WebGLRenderer (`toneMapping`, `toneMappingExposure`, `outputColorSpace`, `setScissor`): https://threejs.org/docs/pages/WebGLRenderer.html
- PMREMGenerator: https://threejs.org/docs/pages/PMREMGenerator.html
- RoomEnvironment: https://threejs.org/docs/pages/RoomEnvironment.html
- HDRLoader: https://threejs.org/docs/pages/HDRLoader.html
- GLTFLoader: https://threejs.org/docs/pages/GLTFLoader.html
- Scene (`environment`, `environmentIntensity`, `backgroundBlurriness`): https://threejs.org/docs/pages/Scene.html
- MeshStandardMaterial: https://threejs.org/docs/pages/MeshStandardMaterial.html
- MeshPhysicalMaterial: https://threejs.org/docs/pages/MeshPhysicalMaterial.html
- CanvasTexture: https://threejs.org/docs/pages/CanvasTexture.html
- Texture (`colorSpace`, `anisotropy`, `mapping`): https://threejs.org/docs/pages/Texture.html
- DirectionalLight: https://threejs.org/docs/pages/DirectionalLight.html
- HemisphereLight: https://threejs.org/docs/pages/HemisphereLight.html
- SphereGeometry: https://threejs.org/docs/pages/SphereGeometry.html
- Mesh: https://threejs.org/docs/pages/Mesh.html
- Color: https://threejs.org/docs/pages/Color.html
- Scene: https://threejs.org/docs/pages/Scene.html
- PerspectiveCamera: https://threejs.org/docs/pages/PerspectiveCamera.html
- Box3: https://threejs.org/docs/pages/Box3.html
- Sphere: https://threejs.org/docs/pages/Sphere.html
- Vector3: https://threejs.org/docs/pages/Vector3.html
- Poly Haven studio_small_09 HDRI (CC0): https://polyhaven.com/a/studio_small_09
