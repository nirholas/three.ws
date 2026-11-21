---
name: zz-debug
description: debug
---

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

function gl0(){return renderer.getContext();}
function measure(group) {
	scene.add(group);
	renderer.render(scene, camera);
	const { calls, triangles } = renderer.info.render;
	scene.remove(group);
	return { calls, triangles };
}
let M0=performance.now(); const cloneCost = measure(clones); gl0().finish(); console.info('measure clones', (performance.now()-M0).toFixed(0));
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
let fr=0; const gl=renderer.getContext(); renderer.setAnimationLoop((time) => {
	fr++;
	timer.update(time);
	const ms = timer.getDelta() * 1000;
	if (ms > 0) {
		frames.push(ms);
		if (frames.length > 120) frames.shift();
	}
	const T1=performance.now(); renderer.render(scene, camera); gl.finish(); const T2=performance.now();
	if (fr<12) console.info('fr',fr,'gpu',(T2-T1).toFixed(0),'mode',showClones?'clones':'inst','calls',renderer.info.render.calls,'tris',renderer.info.render.triangles);
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
