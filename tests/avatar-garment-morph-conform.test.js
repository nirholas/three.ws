/**
 * Morph conform: worn garments follow the Parametric base's identity morphs.
 *
 * Runs against the real public/avatars/parametric-base.glb (306 identity
 * morph targets on the Body mesh) and, when the network is reachable, a real
 * catalog top from the live garment bucket. The synthetic wearables are shells
 * derived from the real body surface at a fixed standoff, so penetration and
 * standoff are exactly measurable.
 *
 *   - without conform a strong morph pushes the body through the garment
 *     (the defect), with conform penetration stays under the ceiling,
 *   - standoff where the rest pose had contact is preserved,
 *   - the editor (src/avatar-garment.js) and the bake (api/_lib/bake-garments.js)
 *     place every garment vertex within 0.1 mm of each other,
 *   - conform is fast on a 20k-vertex garment and adds no morph targets,
 *   - rigid (unskinned) pieces are never deformed.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mergeDocuments } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import {
	Bone,
	BufferAttribute,
	BufferGeometry,
	Group,
	Mesh,
	MeshStandardMaterial,
	Skeleton,
	SkinnedMesh,
} from 'three';
import {
	buildConformBinding,
	conformPositions,
	morphedBodyPositions,
	shouldConform,
} from '../src/garment-conform.js';
import { attachGarment, conformGarments } from '../src/avatar-garment.js';
import { applyGarments, snapshotBodyRest } from '../api/_lib/bake-garments.js';

/* ── real body ───────────────────────────────────────────────────────────── */

const MORPH_TABLE = [
	{ name: 'chest', morphs: { chestWider: 1, chestDeeper: 1, chestPectorals: 1 } },
	{ name: 'belly', morphs: { bellyBigger: 1 } },
	{ name: 'hips', morphs: { hipsWider: 1, waistWider: 1 } },
	{ name: 'jaw', morphs: { jawWider: 1, jawChinLonger: 1 } },
	{ name: 'mixed', morphs: { chestTaller: 0.8, hipsWider: 0.6, bellyBigger: 0.5, jawWider: 0.7 } },
];

const body = {};
let io;

beforeAll(async () => {
	await MeshoptDecoder.ready;
	io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
	const bytes = await readFile(new URL('../public/avatars/parametric-base.glb', import.meta.url));
	body.bytes = new Uint8Array(bytes);
	const doc = await io.readBinary(body.bytes);
	const mesh = doc.getRoot().listMeshes().find((m) => m.getName() === 'Body');
	const prim = mesh.listPrimitives()[0];
	body.names = mesh.getExtras().targetNames;
	body.pos = Float32Array.from(prim.getAttribute('POSITION').getArray());
	body.nrm = Float32Array.from(prim.getAttribute('NORMAL').getArray());
	body.idx = Uint32Array.from(prim.getIndices().getArray());
	body.targets = prim.listTargets().map((t) => Float32Array.from(t.getAttribute('POSITION').getArray()));
	const skinNode = doc.getRoot().listNodes().find((n) => n.getMesh() === mesh && n.getSkin());
	const names = skinNode.getSkin().listJoints().map((j) => j.getName());
	body.joints = ['mixamorig:Hips', 'mixamorig:Head'].filter((n) => names.includes(n));
	if (body.joints.length !== 2) throw new Error('parametric base lost its Hips/Head joints');
});

function weightsFor(morphs) {
	const w = new Array(body.targets.length).fill(0);
	for (const [name, v] of Object.entries(morphs)) {
		const i = body.names.indexOf(name);
		if (i < 0) throw new Error(`unknown morph ${name}`);
		w[i] = v;
	}
	return w;
}

/** A garment shell: the real body surface pushed out `standoff` metres along its normals. */
function shell(standoff, vertexCount = body.pos.length / 3) {
	const out = new Float32Array(vertexCount * 3);
	for (let v = 0; v < vertexCount; v++) {
		const s = v % (body.pos.length / 3);
		for (let k = 0; k < 3; k++) out[v * 3 + k] = body.pos[s * 3 + k] + body.nrm[s * 3 + k] * standoff;
	}
	return out;
}

/** Per-vertex flag: deeper than `depth` metres inside the surface of `bodyPositions`. */
function insideFlags(garment, bodyPositions, depth = 0.002) {
	const probe = buildConformBinding(bodyPositions, body.idx, garment, { reach: 0.12 });
	const flags = new Uint8Array(probe.count);
	let bound = 0;
	for (let v = 0; v < probe.count; v++) {
		if (probe.weight[v] === 0 && probe.offset[v] === 0) continue;
		bound++;
		if (probe.offset[v] < -depth) flags[v] = 1;
	}
	return { flags, bound };
}

// A shell offset along vertex normals already self-intersects in concave spots
// (inner thighs, armpits) at rest. Only vertices that were clear of the body in
// the rest pose and are inside it after the morph count as penetration.
const restFlagsCache = new Map();
function penetration(garment, bodyPositions, restKey, depth = 0.002) {
	if (!restFlagsCache.has(restKey)) restFlagsCache.set(restKey, insideFlags(restKey, body.pos, depth).flags);
	const rest = restFlagsCache.get(restKey);
	const { flags, bound } = insideFlags(garment, bodyPositions, depth);
	let fresh = 0;
	for (let v = 0; v < flags.length; v++) if (flags[v] && !rest[v]) fresh++;
	return { fraction: bound ? fresh / bound : 0, bound };
}

/* ── penetration and standoff ────────────────────────────────────────────── */

describe('morph conform on the real Parametric base', () => {
	it('control: without conform a strong morph pushes the body through the garment', () => {
		const worn = shell(0.008);
		const morphed = morphedBodyPositions(body.pos, body.targets, weightsFor({ bellyBigger: 1 }), new Float32Array(body.pos.length));
		expect(penetration(worn, morphed, worn).fraction).toBeGreaterThan(0.005);
	});

	for (const row of MORPH_TABLE) {
		it(`${row.name}: penetration stays under 0.5% and standoff is kept`, () => {
			const standoff = 0.008;
			const worn = shell(standoff);
			const morphed = morphedBodyPositions(body.pos, body.targets, weightsFor(row.morphs), new Float32Array(body.pos.length));
			const binding = buildConformBinding(body.pos, body.idx, worn);
			const out = conformPositions(binding, body.idx, body.pos, morphed, worn, new Float32Array(worn.length));

			expect(penetration(out, morphed, worn).fraction).toBeLessThan(0.005);

			// Standoff: where the rest pose touched (8 mm shell), the conformed
			// garment never drifts more than 6 mm farther from the surface.
			const after = buildConformBinding(morphed, body.idx, out, { reach: 0.12 });
			let worst = 0;
			for (let v = 0; v < after.count; v++) {
				if (binding.weight[v] < 1) continue;
				worst = Math.max(worst, after.offset[v] - standoff);
			}
			expect(worst).toBeLessThan(0.006);
		});
	}

	it('is the identity when no morph is applied', () => {
		const worn = shell(0.01);
		const binding = buildConformBinding(body.pos, body.idx, worn);
		const out = conformPositions(binding, body.idx, body.pos, body.pos, worn, new Float32Array(worn.length));
		let worst = 0;
		for (let i = 0; i < worn.length; i++) worst = Math.max(worst, Math.abs(out[i] - worn[i]));
		expect(worst).toBeLessThan(1e-6);
	});

	it('loose cloth keeps its drape: far vertices move less than hugging ones', () => {
		const tight = shell(0.004);
		const loose = shell(0.04);
		const morphed = morphedBodyPositions(body.pos, body.targets, weightsFor({ bellyBigger: 1 }), new Float32Array(body.pos.length));
		const move = (garment) => {
			const b = buildConformBinding(body.pos, body.idx, garment);
			const out = conformPositions(b, body.idx, body.pos, morphed, garment, new Float32Array(garment.length));
			let total = 0;
			for (let i = 0; i < out.length; i++) total += Math.abs(out[i] - garment[i]);
			return total;
		};
		expect(move(loose)).toBeLessThan(move(tight));
	});

	it('shouldConform skips rigid pieces', () => {
		expect(shouldConform({ skinned: true })).toBe(true);
		expect(shouldConform({ skinned: false })).toBe(false);
		expect(shouldConform({ skinned: true, rigid: true })).toBe(false);
	});
});

/* ── performance and VRAM ────────────────────────────────────────────────── */

describe('conform cost', () => {
	it('conforms a 20k-vertex garment within the frame budget from a cached binding', () => {
		const worn = shell(0.008, 20000);
		const t0 = performance.now();
		const binding = buildConformBinding(body.pos, body.idx, worn);
		const bindMs = performance.now() - t0;
		const morphed = new Float32Array(body.pos.length);
		const out = new Float32Array(worn.length);
		const weights = weightsFor({ chestWider: 1, bellyBigger: 0.5 });
		// warm the JIT, then time the per-slider-tick work
		for (let i = 0; i < 3; i++) {
			morphedBodyPositions(body.pos, body.targets, weights, morphed);
			conformPositions(binding, body.idx, body.pos, morphed, worn, out);
		}
		const t1 = performance.now();
		const runs = 10;
		for (let i = 0; i < runs; i++) {
			morphedBodyPositions(body.pos, body.targets, weights, morphed);
			conformPositions(binding, body.idx, body.pos, morphed, worn, out);
		}
		const tickMs = (performance.now() - t1) / runs;
		expect(tickMs).toBeLessThan(16);
		expect(bindMs).toBeLessThan(6000);
	});
});

/* ── editor and bake parity ──────────────────────────────────────────────── */

const MANIFEST = { spec: 'garment/1', id: 'conform-shell', slot: 'top', occludes: [], rig: { attachBone: 'Hips' } };

async function garmentBytes({ positions, skinned }) {
	const doc = new Document();
	const buffer = doc.createBuffer();
	const scene = doc.createScene('s');
	doc.getRoot().setDefaultScene(scene);
	const count = positions.length / 3;
	const prim = doc.createPrimitive()
		.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer))
		.setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(body.idx.subarray(0, 3 * Math.floor(count / 3)).map((i) => i % count))).setBuffer(buffer));
	const node = doc.createNode('shell').setMesh(doc.createMesh('shell').addPrimitive(prim));
	if (skinned) {
		const j0 = doc.createNode(body.joints[0]);
		const j1 = doc.createNode(body.joints[1]);
		j0.addChild(j1);
		scene.addChild(doc.createNode('Armature').addChild(j0));
		const joints = new Uint16Array(count * 4);
		const weights = new Float32Array(count * 4);
		for (let v = 0; v < count; v++) weights[v * 4] = 1;
		prim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(joints).setBuffer(buffer));
		prim.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(weights).setBuffer(buffer));
		const ibm = new Float32Array(32);
		ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 0);
		ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 16);
		const skin = doc.createSkin('g').setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buffer));
		skin.addJoint(j0).addJoint(j1);
		node.setSkin(skin);
	}
	scene.addChild(node);
	return io.writeBinary(doc);
}

async function bakeShell({ positions, skinned = true, manifest = MANIFEST, morphs, conform }) {
	const doc = await io.readBinary(body.bytes);
	snapshotBodyRest(doc);
	const bodyNode = doc.getRoot().listNodes().find((n) => n.getMesh()?.getName() === 'Body');
	if (morphs) bodyNode.setWeights(weightsFor(morphs));
	const bytes = await garmentBytes({ positions, skinned });
	const result = await applyGarments(io, doc, [{ slot: manifest.slot, id: manifest.id }], mergeDocuments, {
		catalog: [manifest],
		fetchBytes: async () => bytes,
		conform,
	});
	const node = doc.getRoot().listNodes().find((n) => n.getMesh()?.getName() === 'shell');
	return { doc, result, node, positions: node ? Float32Array.from(node.getMesh().listPrimitives()[0].getAttribute('POSITION').getArray()) : null };
}

function threeAvatar(morphs) {
	const geo = new BufferGeometry();
	geo.setAttribute('position', new BufferAttribute(body.pos.slice(), 3));
	geo.setIndex(new BufferAttribute(body.idx.slice(), 1));
	const count = body.pos.length / 3;
	geo.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(count * 4), 4));
	const sw = new Float32Array(count * 4);
	for (let v = 0; v < count; v++) sw[v * 4] = 1;
	geo.setAttribute('skinWeight', new BufferAttribute(sw, 4));
	geo.morphAttributes.position = body.targets.map((t) => new BufferAttribute(t.slice(), 3));
	geo.morphTargetsRelative = true;
	const hips = new Bone(); hips.name = body.joints[0];
	const spine = new Bone(); spine.name = body.joints[1];
	hips.add(spine);
	const mesh = new SkinnedMesh(geo, new MeshStandardMaterial());
	mesh.add(hips);
	mesh.bind(new Skeleton([hips, spine]));
	mesh.morphTargetInfluences = weightsFor(morphs || {});
	mesh.morphTargetDictionary = Object.fromEntries(body.names.map((n, i) => [n, i]));
	const root = new Group();
	root.add(mesh);
	return { root, mesh };
}

function threeGarment(positions) {
	const count = positions.length / 3;
	const geo = new BufferGeometry();
	geo.setAttribute('position', new BufferAttribute(positions.slice(), 3));
	geo.setIndex(new BufferAttribute(Uint32Array.from(body.idx.subarray(0, 3 * Math.floor(count / 3)).map((i) => i % count)), 1));
	geo.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(count * 4), 4));
	const sw = new Float32Array(count * 4);
	for (let v = 0; v < count; v++) sw[v * 4] = 1;
	geo.setAttribute('skinWeight', new BufferAttribute(sw, 4));
	const hips = new Bone(); hips.name = body.joints[0];
	const spine = new Bone(); spine.name = body.joints[1];
	hips.add(spine);
	const mesh = new SkinnedMesh(geo, new MeshStandardMaterial());
	mesh.add(hips);
	mesh.bind(new Skeleton([hips, spine]));
	const root = new Group();
	root.add(mesh);
	return root;
}

describe('editor and bake agree', () => {
	const morphs = { chestWider: 1, chestDeeper: 0.7, bellyBigger: 0.6, hipsWider: 0.8, jawWider: 0.5 };

	it('place every garment vertex within 0.1 mm of each other', async () => {
		const worn = shell(0.008);
		const baked = await bakeShell({ positions: worn, morphs });
		expect(baked.result.skipped).toEqual([]);
		expect(baked.result.attached).toEqual(['conform-shell']);

		const { root, mesh } = threeAvatar(morphs);
		const attached = attachGarment(root, threeGarment(worn), { slot: 'top', maxExtentRatio: 2 });
		expect(attached.reason).toBeUndefined();
		expect(attached.ok).toBe(true);
		const editor = attached.meshes[0].geometry.attributes.position.array;

		expect(editor.length).toBe(baked.positions.length);
		let worst = 0;
		for (let i = 0; i < editor.length; i++) worst = Math.max(worst, Math.abs(editor[i] - baked.positions[i]));
		expect(worst).toBeLessThan(1e-4);

		// the garment actually moved relative to its authored rest pose
		let moved = 0;
		for (let i = 0; i < worn.length; i++) moved = Math.max(moved, Math.abs(editor[i] - worn[i]));
		expect(moved).toBeGreaterThan(0.01);
		expect(mesh.morphTargetInfluences.length).toBe(body.targets.length);
	});

	it('the editor re-conforms when a slider changes and returns home at zero', () => {
		const worn = shell(0.008);
		const { root, mesh } = threeAvatar({});
		const attached = attachGarment(root, threeGarment(worn), { slot: 'top', maxExtentRatio: 2 });
		expect(attached.reason).toBeUndefined();
		const pos = attached.meshes[0].geometry.attributes.position.array;
		const idx = body.names.indexOf('chestWider');

		mesh.morphTargetInfluences[idx] = 1;
		expect(conformGarments(root)).toBe(1);
		let delta = 0;
		for (let i = 0; i < worn.length; i++) delta = Math.max(delta, Math.abs(pos[i] - worn[i]));
		expect(delta).toBeGreaterThan(0.005);

		expect(conformGarments(root)).toBe(0);

		mesh.morphTargetInfluences[idx] = 0;
		conformGarments(root);
		let home = 0;
		for (let i = 0; i < worn.length; i++) home = Math.max(home, Math.abs(pos[i] - worn[i]));
		expect(home).toBeLessThan(1e-6);
	});

	it('the bake adds no morph targets to the body', async () => {
		const baked = await bakeShell({ positions: shell(0.008), morphs });
		const bodyMesh = baked.doc.getRoot().listMeshes().find((m) => m.getName() === 'Body');
		expect(bodyMesh.listPrimitives()[0].listTargets().length).toBe(body.targets.length);
		expect(baked.node.getMesh().listPrimitives()[0].listTargets().length).toBe(0);
	});

	it('conform can be switched off for the bake', async () => {
		const worn = shell(0.008);
		const off = await bakeShell({ positions: worn, morphs, conform: false });
		let delta = 0;
		for (let i = 0; i < worn.length; i++) delta = Math.max(delta, Math.abs(off.positions[i] - worn[i]));
		expect(delta).toBeLessThan(1e-6);
	});

	it('leaves a rigid piece exactly where it was authored', async () => {
		const rigid = shell(0.02, 600);
		const glasses = { spec: 'garment/1', id: 'rigid-frames', slot: 'glasses', occludes: [], rig: { attachBone: 'Head' } };
		const baked = await bakeShell({ positions: rigid, skinned: false, manifest: glasses, morphs });
		expect(baked.result.attached).toEqual(['rigid-frames']);
		for (let i = 0; i < rigid.length; i++) expect(baked.positions[i]).toBe(rigid[i]);

		const { root } = threeAvatar(morphs);
		const group = new Group();
		group.add(new Mesh(new BufferGeometry().setAttribute('position', new BufferAttribute(rigid.slice(), 3)), new MeshStandardMaterial()));
		const attached = attachGarment(root, group, { slot: 'glasses' });
		expect(attached.ok).toBe(true);
		expect(attached.meshes[0].userData.conform).toBeUndefined();
	});
});

/* ── a real catalog garment ──────────────────────────────────────────────── */

describe('a live catalog top', () => {
	const CATALOG = 'https://storage.googleapis.com/three-ws-garments/garments/catalog.json';
	let garment = null;

	beforeAll(async () => {
		try {
			const catalog = await (await fetch(CATALOG, { signal: AbortSignal.timeout(20000) })).json();
			const list = Array.isArray(catalog) ? catalog : catalog.garments;
			const manifest = list.find((g) => g.slot === 'top');
			const res = await fetch(manifest.model.uri, { signal: AbortSignal.timeout(60000) });
			const doc = await io.readBinary(new Uint8Array(await res.arrayBuffer()));
			const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
			garment = { manifest, positions: Float32Array.from(prim.getAttribute('POSITION').getArray()) };
		} catch {
			garment = null;
		}
	}, 90000);

	it('follows a chest morph with the same penetration ceiling', (ctx) => {
		if (!garment) ctx.skip();
		const morphed = morphedBodyPositions(body.pos, body.targets, weightsFor({ chestWider: 1, chestDeeper: 1, bellyBigger: 0.5 }), new Float32Array(body.pos.length));
		const binding = buildConformBinding(body.pos, body.idx, garment.positions);
		expect(binding.bound).toBeGreaterThan(garment.positions.length / 3 * 0.1);
		const before = penetration(garment.positions, morphed, garment.positions).fraction;
		const out = conformPositions(binding, body.idx, body.pos, morphed, garment.positions, new Float32Array(garment.positions.length));
		const after = penetration(out, morphed, garment.positions).fraction;
		expect(after).toBeLessThanOrEqual(Math.max(0.005, before * 0.5));
	}, 60000);
});
