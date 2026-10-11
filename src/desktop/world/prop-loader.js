// Streams the campus props (props.js) in from the object library: one
// download per model, a clone per placement, nearest to the visitor first, a
// few at a time, each one growing in where it stands. Everything it creates
// it can dispose.

import { Box3, Group, Vector3 } from 'three';
import { gltfLoader } from '../../loaders/gltf.js';
import { log } from '../../shared/log.js';

const CONCURRENCY = 3;
const GROW_SECONDS = 0.35;

/**
 * @param {import('three').WebGLRenderer} renderer
 * @param {import('three').Scene} scene
 * @param {Array<object>} placements from props.js placeProps()
 * @param {{ shadows: boolean, from: {x:number, z:number}, reducedMotion?: boolean, hitFor?: (placement) => object|null }} o
 */
export function createPropLoader(renderer, scene, placements, { shadows, from, reducedMotion = false, hitFor }) {
	const loader = gltfLoader(renderer);
	const byModel = new Map();
	for (const p of placements) {
		if (!byModel.has(p.model)) byModel.set(p.model, []);
		byModel.get(p.model).push(p);
	}
	const order = [...byModel.entries()].map(([model, list]) => ({ model, list, d: Math.min(...list.map((p) => Math.hypot(p.x - from.x, p.z - from.z))) })).sort((a, b) => a.d - b.d);
	const templates = [];
	const growing = [];
	const placed = [];
	let disposed = false;
	let loaded = 0;
	let failed = 0;
	const box = new Box3();
	const size = new Vector3();
	const centre = new Vector3();

	async function loadOne({ model, list }) {
		let gltf;
		try {
			gltf = await loader.loadAsync(list[0].url);
		} catch (err) {
			failed++;
			log.warn('world/props', `${model} did not load`, err?.message || err);
			return;
		}
		if (disposed) {
			disposeObject(gltf.scene);
			return;
		}
		const template = gltf.scene;
		template.traverse((o) => {
			if (!o.isMesh) return;
			o.castShadow = shadows;
			o.receiveShadow = true;
			if (o.material?.map) o.material.map.anisotropy = 4;
		});
		templates.push(template);
		box.setFromObject(template);
		box.getSize(size);
		box.getCenter(centre);
		for (const p of list) {
			const holder = new Group();
			holder.position.set(p.x, p.y, p.z);
			holder.rotation.y = p.yaw;
			const inner = template.clone();
			inner.scale.setScalar(p.scale);
			if (p.anchor === 'floor') inner.position.set(-centre.x * p.scale, -box.min.y * p.scale, -centre.z * p.scale);
			holder.add(inner);
			const hit = hitFor?.(p);
			if (hit) holder.traverse((o) => { o.userData.hit = hit; });
			holder.userData.prop = p.model;
			scene.add(holder);
			placed.push(holder);
			if (reducedMotion) continue;
			holder.scale.setScalar(0.001);
			growing.push({ holder, t: 0 });
		}
		loaded++;
	}

	let started = false;
	async function start() {
		if (started) return;
		started = true;
		const queue = order.slice();
		const workers = Array.from({ length: CONCURRENCY }, async () => {
			while (queue.length && !disposed) await loadOne(queue.shift());
		});
		await Promise.all(workers);
	}

	function tick(dt) {
		for (let i = growing.length - 1; i >= 0; i--) {
			const g = growing[i];
			g.t = Math.min(1, g.t + dt / GROW_SECONDS);
			const e = 1 - (1 - g.t) * (1 - g.t);
			g.holder.scale.setScalar(Math.max(0.001, e));
			if (g.t >= 1) growing.splice(i, 1);
		}
	}

	function dispose() {
		disposed = true;
		for (const h of placed) scene.remove(h);
		for (const t of templates) disposeObject(t);
		placed.length = 0;
		templates.length = 0;
		growing.length = 0;
	}

	return {
		start,
		tick,
		dispose,
		get models() { return order.length; },
		get loaded() { return loaded; },
		get failed() { return failed; },
	};
}

function disposeObject(root) {
	root.traverse((o) => {
		o.geometry?.dispose?.();
		const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
		for (const m of mats) {
			for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap']) m[k]?.dispose?.();
			m.dispose?.();
		}
	});
}
