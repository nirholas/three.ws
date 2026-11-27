// Real GLBs built from boxes, for tests of the rig preflight
// (api/_lib/rig-preflight.js), which loads the mesh and measures its shape.

import { Document, NodeIO } from '@gltf-transform/core';

// An axis-aligned box as 12 triangles, offset by `at`.
function boxGeometry([sx, sy, sz], at = [0, 0, 0]) {
	const p = [];
	for (const x of [0, sx]) for (const y of [0, sy]) for (const z of [0, sz]) p.push(x + at[0], y + at[1], z + at[2]);
	const quads = [
		[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3],
	];
	const idx = [];
	for (const [a, b, c, d] of quads) idx.push(a, b, c, a, c, d);
	return { positions: p, indices: idx };
}

/**
 * @param {{ size: number[], at?: number[] }[]} boxes
 * @param {{ skinned?: boolean }} [opts] skinned adds a one-joint skin.
 * @returns {Promise<Uint8Array>}
 */
export async function boxGlb(boxes, { skinned = false } = {}) {
	const doc = new Document();
	const buffer = doc.createBuffer();
	const positions = [];
	const indices = [];
	for (const b of boxes) {
		const g = boxGeometry(b.size, b.at);
		const base = positions.length / 3;
		positions.push(...g.positions);
		indices.push(...g.indices.map((i) => i + base));
	}
	const prim = doc
		.createPrimitive()
		.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer))
		.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(indices)).setBuffer(buffer));
	const node = doc.createNode('model').setMesh(doc.createMesh('model').addPrimitive(prim));
	const scene = doc.createScene().addChild(node);
	if (skinned) {
		const n = positions.length / 3;
		prim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(new Uint16Array(n * 4)).setBuffer(buffer));
		const w = new Float32Array(n * 4);
		for (let i = 0; i < n; i += 1) w[i * 4] = 1;
		prim.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(w).setBuffer(buffer));
		const hips = doc.createNode('Hips');
		scene.addChild(hips);
		const ibm = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
		node.setSkin(
			doc
				.createSkin('rig')
				.addJoint(hips)
				.setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buffer)),
		);
	}
	return new NodeIO().writeBinary(doc);
}

// A standing figure: torso block plus two legs that touch it.
export const FIGURE = [
	{ size: [0.5, 0.9, 0.3], at: [0, 0.9, 0] },
	{ size: [0.2, 0.9, 0.25], at: [0.02, 0, 0.02] },
	{ size: [0.2, 0.9, 0.25], at: [0.28, 0, 0.02] },
];

/** fetchModel's answer for a figure GLB, for tests that mock api/_lib/fetch-model.js. */
export async function figureFetchResult(url) {
	return { bytes: await boxGlb(FIGURE), contentType: 'model/gltf-binary', finalUrl: url };
}
