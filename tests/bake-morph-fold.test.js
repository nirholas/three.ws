// Identity-morph fold: a served bake of a Parametric avatar carries the
// weighted sum of its identity sliders in POSITION and only the targets a
// viewer still drives at runtime. Uses the real public/avatars/parametric-base.glb.

import { describe, it, expect, beforeAll } from 'vitest';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { bakeAppearance, bakedStorageKeyFor } from '../api/_lib/bake.js';
import {
	foldIdentityMorphs,
	isParametricDocument,
	morphVramBytes,
	recomputeNormals,
	FOLD_VERSION,
} from '../api/_lib/bake-morph-fold.js';

const BASE = path.resolve(import.meta.dirname, '../public/avatars/parametric-base.glb');
let baseBytes;
let io;

beforeAll(async () => {
	await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
	io = new NodeIO()
		.registerExtensions(ALL_EXTENSIONS)
		.registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
	baseBytes = new Uint8Array(await readFile(BASE));
});

function body(doc) {
	return doc.getRoot().listMeshes().find((m) => m.getName() === 'Body');
}

describe('foldIdentityMorphs on the real parametric base', () => {
	it('folds the weighted sum into POSITION, drops identity targets, recomputes normals', async () => {
		const ref = await io.readBinary(baseBytes);
		const doc = await io.readBinary(baseBytes);
		expect(isParametricDocument(doc)).toBe(true);

		const mesh = body(doc);
		const names = mesh.getExtras().targetNames;
		const weights = {
			[names[0]]: 0.7,
			[names[5]]: -0.4,
			[names[40]]: 1,
			[names[200]]: 0.25,
		};
		const w = new Array(names.length).fill(0);
		names.forEach((n, i) => {
			if (weights[n] !== undefined) w[i] = weights[n];
		});
		for (const d of [doc, ref]) {
			const m = body(d);
			m.setWeights(w);
			for (const n of d.getRoot().listNodes()) if (n.getMesh() === m) n.setWeights(w);
		}

		// Reference: base + sum(w_i * delta_i), computed straight from the untouched doc.
		const refPrim = body(ref).listPrimitives()[0];
		const basePos = refPrim.getAttribute('POSITION').getArray();
		const expected = Float32Array.from(basePos);
		refPrim.listTargets().forEach((t, i) => {
			if (!w[i]) return;
			const delta = t.getAttribute('POSITION').getArray();
			for (let k = 0; k < expected.length; k++) expected[k] += w[i] * delta[k];
		});
		const baseNormals = Float32Array.from(refPrim.getAttribute('NORMAL').getArray());
		const expectedNormals = recomputeNormals(expected, refPrim.getIndices().getArray(), baseNormals);

		const before = morphVramBytes(doc);
		const report = foldIdentityMorphs(doc);
		expect(report.skipped).toEqual([]);
		expect(report.vramAfter).toBe(0);
		expect(report.vramBefore).toBe(before);
		expect(before).toBeGreaterThan(60 * 1024 * 1024);

		const prim = body(doc).listPrimitives()[0];
		expect(prim.listTargets().length).toBe(0);
		expect(body(doc).getWeights()).toEqual([]);

		const got = prim.getAttribute('POSITION').getArray();
		let maxErr = 0;
		for (let k = 0; k < got.length; k++) maxErr = Math.max(maxErr, Math.abs(got[k] - expected[k]));
		expect(maxErr).toBeLessThan(1e-5);

		const gotN = prim.getAttribute('NORMAL').getArray();
		let maxN = 0;
		for (let k = 0; k < gotN.length; k++) maxN = Math.max(maxN, Math.abs(gotN[k] - expectedNormals[k]));
		expect(maxN).toBeLessThan(1e-5);
		for (let v = 0; v < gotN.length; v += 3) {
			expect(Math.hypot(gotN[v], gotN[v + 1], gotN[v + 2])).toBeCloseTo(1, 4);
		}
		// The shape really changed, so normals moved off the pristine ones.
		let moved = 0;
		const orig = refPrim.getAttribute('NORMAL').getArray();
		for (let k = 0; k < gotN.length; k++) if (Math.abs(gotN[k] - orig[k]) > 1e-4) moved++;
		expect(moved).toBeGreaterThan(0);
	});

	it('keeps ARKit, viseme and sculpt targets and their weights', async () => {
		const doc = await io.readBinary(baseBytes);
		const mesh = body(doc);
		const prim = mesh.listPrimitives()[0];
		const names = [...mesh.getExtras().targetNames];
		const pos = prim.getAttribute('POSITION');
		const addTarget = (name, w) => {
			const acc = doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos.getCount() * 3).fill(0.001));
			acc.setBuffer(doc.getRoot().listBuffers()[0]);
			prim.addTarget(doc.createPrimitiveTarget(name).setAttribute('POSITION', acc));
			names.push(name);
			return w;
		};
		const weights = new Array(names.length).fill(0);
		weights.push(addTarget('jawOpen', 0.5), addTarget('viseme_aa', 0.2), addTarget('customSculpt', 1));
		mesh.setExtras({ ...mesh.getExtras(), targetNames: names });
		mesh.setWeights(weights);

		foldIdentityMorphs(doc);
		const after = body(doc);
		expect(after.getExtras().targetNames).toEqual(['jawOpen', 'viseme_aa', 'customSculpt']);
		expect(after.getWeights()).toEqual([0.5, 0.2, 1]);
		expect(after.listPrimitives()[0].listTargets().length).toBe(3);
	});
});

describe('recomputeNormals', () => {
	it('smooths a UV seam (same position and normal) and keeps a hard edge split', () => {
		// Two coplanar triangles sharing an edge, but the shared edge is duplicated
		// (seam). A third triangle folds up at 90 degrees with its own normals.
		const pos = new Float32Array([
			0, 0, 0, 1, 0, 0, 0, 1, 0,
			1, 0, 0, 1, 1, 0, 0, 1, 0,
		]);
		const base = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
		const n = recomputeNormals(pos, [0, 1, 2, 3, 4, 5], base);
		for (let v = 0; v < 6; v++) {
			expect(n[3 * v]).toBeCloseTo(0, 5);
			expect(n[3 * v + 1]).toBeCloseTo(0, 5);
			expect(n[3 * v + 2]).toBeCloseTo(1, 5);
		}
	});
});

describe('bakeAppearance fold option', () => {
	it('folds only when asked, and keys the served bake apart from the unfolded one', async () => {
		const doc = await io.readBinary(baseBytes);
		const names = body(doc).getExtras().targetNames;
		const appearance = { morphs: { [names[3]]: 0.6, [names[90]]: -0.3 } };

		const plain = await io.readBinary(await bakeAppearance(baseBytes, appearance));
		const folded = await io.readBinary(await bakeAppearance(baseBytes, appearance, { fold: true }));
		expect(body(plain).listPrimitives()[0].listTargets().length).toBe(306);
		expect(body(folded).listPrimitives()[0].listTargets().length).toBe(0);
		expect(morphVramBytes(folded)).toBe(0);

		const a = bakedStorageKeyFor({ baseStorageKey: 'u/1/s/1.glb', hash: 'a'.repeat(32) });
		const b = bakedStorageKeyFor({ baseStorageKey: 'u/1/s/1.glb', hash: 'a'.repeat(32), fold: true });
		expect(a).not.toBe(b);
		expect(b.endsWith(`-f${FOLD_VERSION}.glb`)).toBe(true);
	}, 120000);
});
