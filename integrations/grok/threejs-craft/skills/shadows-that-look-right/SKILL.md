---
name: shadows-that-look-right
description: >-
  Get crisp, stable, correctly placed shadows in three.js: enable the shadow map, fit the directional light's shadow camera to the scene bounds, pick a map size, tune bias and normalBias against shadow acne and peter-panning, soften with shadow.radius, catch shadows on an invisible ground with ShadowMaterial, and freeze the shadow map for static scenes. Use when shadows are missing, blocky, pixelated, striped (acne), detached from the object (peter-panning), cut off at an edge, flickering, too dark, or too slow on mobile, or when the user asks how to add shadows or a ground shadow under a model.
when_to_use: Adding shadows to any three.js scene, or fixing shadows that are missing, aliased, striped, clipped or expensive.
license: Apache-2.0
metadata:
  author: three.ws
  short-description: Shadow camera fitting, bias, softness, ground catchers and static shadow maps
---

# Shadows that look right in three.js

Targets three.js r187 (`three@0.187.0`). Every runnable block is executed in Chromium against
a real CC0 model before this plugin ships.

A shadow needs four switches on, and missing any one gives no shadow and no error:

1. `renderer.shadowMap.enabled = true`
2. `light.castShadow = true` (only `DirectionalLight`, `SpotLight` and `PointLight` cast)
3. `mesh.castShadow = true` on every caster. A glTF model is a tree, so traverse it.
4. `mesh.receiveShadow = true` on every receiver, including the ground.

After that, almost every ugly shadow is the **shadow camera** being the wrong size. A
`DirectionalLight` renders its shadow through an orthographic camera that defaults to a
10 x 10 unit box. Larger scenes get clipped shadows; smaller ones waste resolution and look
blocky. Fit it to what casts.

## 1. A complete, fitted setup

`fitShadowCamera` sizes the light's orthographic shadow camera to a bounding sphere of the
casters, so the shadow is as sharp as the map size allows and never clipped. Re-run it when
the scene's extent changes.

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.AgXToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // the default; soft edges come from shadow.radius
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xd9dde3);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5; // fill light; the sun below draws the shadow

const gltf = await new GLTFLoader().loadAsync('model.glb');
const model = gltf.scene;
model.traverse((obj) => {
	if (obj.isMesh) {
		obj.castShadow = true;
		obj.receiveShadow = true; // self-shadowing: arms shade the seat
	}
});
scene.add(model);

// Stand the model on y = 0 whatever its authored origin.
const box = new THREE.Box3().setFromObject(model);
model.position.y -= box.min.y;
box.setFromObject(model);
const sphere = box.getBoundingSphere(new THREE.Sphere());

const ground = new THREE.Mesh(
	new THREE.CircleGeometry(sphere.radius * 4, 64),
	new THREE.MeshStandardMaterial({ color: 0xbfc5cc, roughness: 0.9 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.radius = 4; // blur in shadow-map texels
scene.add(sun, sun.target); // the target must be in the scene for its position to count

function fitShadowCamera(light, bounds, direction) {
	const { center, radius } = bounds;
	light.target.position.copy(center);
	light.position.copy(center).addScaledVector(direction.clone().normalize(), radius * 3);
	const cam = light.shadow.camera;
	cam.left = cam.bottom = -radius;
	cam.right = cam.top = radius;
	cam.near = radius; // the light sits 3 radii away, so the casters span 2r to 4r
	cam.far = radius * 5;
	cam.updateProjectionMatrix();
	// Bias in world units scales with the scene, so derive it from the texel size.
	const texel = (2 * radius) / light.shadow.mapSize.x;
	light.shadow.bias = -0.0005;
	light.shadow.normalBias = texel * 1.5;
}
fitShadowCamera(sun, sphere, new THREE.Vector3(1, 2, 1.2));

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, sphere.radius / 50, sphere.radius * 50);
camera.position.copy(sphere.center).add(new THREE.Vector3(-0.6, 0.45, 1).normalize().multiplyScalar(sphere.radius * 3.2));
camera.lookAt(sphere.center);

// Press H to see the shadow camera's box; everything that casts must sit inside it.
const helper = new THREE.CameraHelper(sun.shadow.camera);
helper.visible = false;
scene.add(helper);
window.addEventListener('keydown', (e) => {
	if (e.key.toLowerCase() === 'h') helper.visible = !helper.visible;
});

window.addEventListener('resize', () => {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
});
renderer.setAnimationLoop(() => renderer.render(scene, camera));
```

`PCFSoftShadowMap` was removed in r187: setting it logs a warning and falls back to
`PCFShadowMap`, which now samples a rotated disk and softens with `shadow.radius`. Code that
used `PCFSoftShadowMap` for soft edges should switch to `PCFShadowMap` plus `radius`.

## 2. Diagnose by symptom

| Symptom | Cause | Fix |
| --- | --- | --- |
| No shadow at all | One of the four switches is off, or the light is a `HemisphereLight`/`AmbientLight` (they cannot cast) | Check all four; traverse glTF scenes for `castShadow` |
| Shadow cut off with a straight edge | Caster outside the shadow camera box | `fitShadowCamera`, or enlarge `left/right/top/bottom` |
| Blocky, stair-stepped edges | Shadow box far larger than the casters, or a small map | Tighten the box first, then raise `mapSize` (1024 mobile, 2048 desktop, 4096 hero shots) |
| Stripes or moire on lit surfaces (acne) | Surface shadows itself at depth precision limits | Raise `normalBias` (about 1 to 2 shadow texels in world units), then a small negative `bias` |
| Shadow detached from the object's feet (peter-panning) | Bias too large | Lower `bias`/`normalBias`; give thin parts real thickness |
| Shadow moves or swims as the camera moves | Shadow camera follows the view without snapping | Keep the box fixed for a bounded scene, or use cascaded shadow maps (`CSM` addon) for large worlds |
| Shadow too dark | Nothing fills the shadowed side | Add `scene.environment` or lower `light.shadow.intensity` (0 to 1) |
| Shadows stop when the model is far away | Shadow camera `far` too short | Recompute `near`/`far` from the bounds |
| Slow on phones | Every shadow-casting light re-renders the scene each frame | Fewer casting lights, smaller maps, or a frozen map (section 4) |

`SpotLight` uses a perspective shadow camera driven by its `angle` and `distance`; keep the
cone tight. `PointLight` renders six maps per frame, so avoid shadowed point lights on mobile.

## 3. A shadow on nothing: ShadowMaterial ground catchers

For a product or model viewer you usually want the model floating on the page background with
only its shadow on the floor. `ShadowMaterial` is transparent everywhere except where a shadow
falls.

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
// The page shows through the transparent canvas.
document.body.style.background = 'linear-gradient(#f4efe6, #d8cfc0)';
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

const gltf = await new GLTFLoader().loadAsync('model.glb');
gltf.scene.traverse((obj) => {
	if (obj.isMesh) obj.castShadow = true;
});
scene.add(gltf.scene);
const box = new THREE.Box3().setFromObject(gltf.scene);
gltf.scene.position.y -= box.min.y;
const { center, radius } = new THREE.Box3().setFromObject(gltf.scene).getBoundingSphere(new THREE.Sphere());

const catcher = new THREE.Mesh(
	new THREE.PlaneGeometry(radius * 6, radius * 6),
	new THREE.ShadowMaterial({ color: 0x3a2f22, opacity: 0.35 }),
);
catcher.rotation.x = -Math.PI / 2;
catcher.receiveShadow = true;
scene.add(catcher);

// Light from almost straight above gives the soft "sitting on the floor" look.
const top = new THREE.DirectionalLight(0xffffff, 2);
top.position.set(center.x + radius * 0.3, center.y + radius * 3, center.z + radius * 0.2);
top.target.position.copy(center);
top.castShadow = true;
top.shadow.mapSize.set(1024, 1024);
top.shadow.radius = 8;
Object.assign(top.shadow.camera, { left: -radius * 1.5, right: radius * 1.5, top: radius * 1.5, bottom: -radius * 1.5, near: radius, far: radius * 6 });
top.shadow.camera.updateProjectionMatrix();
top.shadow.normalBias = (3 * radius) / 1024;
scene.add(top, top.target);

const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, radius / 50, radius * 50);
camera.position.copy(center).add(new THREE.Vector3(0.7, 0.5, 1).normalize().multiplyScalar(radius * 3.4));
camera.lookAt(center);

window.addEventListener('resize', () => {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
});
renderer.setAnimationLoop(() => renderer.render(scene, camera));
```

`ShadowMaterial` only darkens; it cannot show reflections or ambient occlusion. For a soft
contact shadow with no light at all, bake one: render the model from below into a small
render target, blur it, and put that texture on a plane (the three.js "contact shadows"
example does exactly this). A baked shadow costs nothing per frame.

## 4. Static scenes: render the shadow map once

When nothing that casts a shadow moves, stop re-rendering the shadow map every frame. This
is the single biggest shadow saving on mobile.

```js
// partial: continues the scene from section 1 after the model has loaded
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true; // render it once on the next frame

// Call this whenever a caster or the light moves.
function shadowsChanged() {
	renderer.shadowMap.needsUpdate = true;
}
```

For moving characters in a static world, keep `autoUpdate` on but limit `castShadow` to the
character and the few large static objects whose shadows matter.

## References

- Shadows (manual): https://threejs.org/manual/#en/shadows
- WebGLRenderer (`shadowMap.enabled`, `shadowMap.type`, `shadowMap.autoUpdate`, `shadowMap.needsUpdate`): https://threejs.org/docs/pages/WebGLRenderer.html
- Shadow map type constants (`PCFShadowMap`, `VSMShadowMap`, `BasicShadowMap`): https://threejs.org/docs/pages/global.html
- LightShadow (`mapSize`, `bias`, `normalBias`, `radius`, `intensity`, `camera`): https://threejs.org/docs/pages/LightShadow.html
- DirectionalLightShadow: https://threejs.org/docs/pages/DirectionalLightShadow.html
- DirectionalLight (`target`): https://threejs.org/docs/pages/DirectionalLight.html
- SpotLightShadow: https://threejs.org/docs/pages/SpotLightShadow.html
- PointLightShadow: https://threejs.org/docs/pages/PointLightShadow.html
- OrthographicCamera: https://threejs.org/docs/pages/OrthographicCamera.html
- CameraHelper: https://threejs.org/docs/pages/CameraHelper.html
- ShadowMaterial: https://threejs.org/docs/pages/ShadowMaterial.html
- Object3D (`castShadow`, `receiveShadow`, `traverse`): https://threejs.org/docs/pages/Object3D.html
- CSM (cascaded shadow maps addon): https://threejs.org/docs/pages/CSM.html
- GLTFLoader: https://threejs.org/docs/pages/GLTFLoader.html
- RoomEnvironment: https://threejs.org/docs/pages/RoomEnvironment.html
- PMREMGenerator: https://threejs.org/docs/pages/PMREMGenerator.html
- MeshStandardMaterial: https://threejs.org/docs/pages/MeshStandardMaterial.html
- CircleGeometry: https://threejs.org/docs/pages/CircleGeometry.html
- PlaneGeometry: https://threejs.org/docs/pages/PlaneGeometry.html
- Box3: https://threejs.org/docs/pages/Box3.html
- Sphere: https://threejs.org/docs/pages/Sphere.html
- PerspectiveCamera: https://threejs.org/docs/pages/PerspectiveCamera.html
- Contact shadows example: https://threejs.org/examples/#webgl_shadow_contact
