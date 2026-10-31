// Halloween dressing for the /play world: a scatter of glowing jack-o'-lanterns.
//
// Self-attaching like ambient-crowd.js (reads window.__CC__, zero edits to the
// world code). The lanterns are the Pumpkin Cap model from the drop, scaled up
// and set on the ground. Each of the model's meshes becomes ONE InstancedMesh2
// (@three.ez/instanced-mesh, MIT), so the whole patch is a handful of draw calls
// with per-instance frustum culling, however many lanterns there are. The carved
// face is emissive, so with the post-fx bloom on the high tier it genuinely
// glows; on lower tiers it is simply a bright orange face.
//
// It exists only while the Halloween weekend is live and the visitor has not
// switched the Halloween look off, and it removes itself (and frees the GPU
// buffers) when the player leaves the world or the weekend ends.

import { Matrix4, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { InstancedMesh2 } from '@three.ez/instanced-mesh';
import { getMeshoptDecoder } from '../viewer/internal.js';
import { isHalloweenLive, seasonalLookEnabled } from '../shared/seasonal-drops.js';

const MODEL = '/accessories/pumpkin-cap-halloween-2026.glb';
const COUNT_BY_TIER = { high: 36, medium: 24, low: 12 };
const INNER_CLEAR = 9;   // keep the spawn plaza open
const OUTER = 50;        // inside the walkable disc
const LANTERN_SCALE = [2.2, 3.4];

// Deterministic so every player sees the same patch in the same place.
function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Lantern placements: [{x, z, yaw, scale}]. Pure, so it can be tested. */
export function lanternPlacements(count, seed = 0x31031) {
	const rand = rng(seed);
	const out = [];
	for (let i = 0; i < count; i++) {
		const a = rand() * Math.PI * 2;
		const r = INNER_CLEAR + Math.sqrt(rand()) * (OUTER - INNER_CLEAR);
		out.push({
			x: Math.cos(a) * r,
			z: Math.sin(a) * r,
			yaw: rand() * Math.PI * 2,
			scale: LANTERN_SCALE[0] + rand() * (LANTERN_SCALE[1] - LANTERN_SCALE[0]),
		});
	}
	return out;
}

class LanternPatch {
	constructor(scene, gltfScene, placements) {
		this.scene = scene;
		this.meshes = [];
		gltfScene.updateMatrixWorld(true);
		const instanceMatrix = new Matrix4();
		const local = new Matrix4();
		const pos = new Vector3();
		const quat = new Quaternion();
		const scl = new Vector3();
		const yAxis = new Vector3(0, 1, 0);
		gltfScene.traverse((n) => {
			if (!n.isMesh) return;
			const inst = new InstancedMesh2(n.geometry, n.material, { capacity: placements.length });
			inst.castShadow = true;
			inst.addInstances(placements.length, (obj, i) => {
				const p = placements[i];
				pos.set(p.x, 0, p.z);
				quat.setFromAxisAngle(yAxis, p.yaw);
				scl.setScalar(p.scale);
				instanceMatrix.compose(pos, quat, scl);
				local.multiplyMatrices(instanceMatrix, n.matrixWorld);
				local.decompose(obj.position, obj.quaternion, obj.scale);
			});
			scene.add(inst);
			this.meshes.push(inst);
		});
	}

	dispose() {
		for (const m of this.meshes) {
			this.scene.remove(m);
			m.dispose?.();
		}
		this.meshes = [];
	}
}

let template = null;
async function loadTemplate() {
	if (!template) {
		template = (async () => {
			const loader = new GLTFLoader();
			loader.setMeshoptDecoder(await getMeshoptDecoder());
			const gltf = await loader.loadAsync(MODEL);
			return gltf.scene;
		})();
		template.catch(() => { template = null; });
	}
	return template;
}

function attach(attempt = 0) {
	const cc = window.__CC__;
	if (!cc || !cc.scene) {
		if (attempt < 300) setTimeout(() => attach(attempt + 1), 300);
		return;
	}
	let patch = null;
	let building = false;
	const tick = () => {
		const want = cc.phase === 'world' && isHalloweenLive() && seasonalLookEnabled();
		if (want && !patch && !building) {
			building = true;
			const tier = COUNT_BY_TIER[cc._perfTier] ? cc._perfTier : 'medium';
			loadTemplate()
				.then((tpl) => {
					if (cc.phase === 'world' && isHalloweenLive() && seasonalLookEnabled()) {
						patch = new LanternPatch(cc.scene, tpl, lanternPlacements(COUNT_BY_TIER[tier]));
					}
				})
				.catch((err) => console.warn('[play] Halloween lanterns unavailable:', err?.message || err))
				.finally(() => { building = false; });
		} else if (!want && patch) {
			patch.dispose();
			patch = null;
		}
	};
	setInterval(tick, 1000);
	tick();
}

if (typeof window !== 'undefined' && isHalloweenLive()) attach();
