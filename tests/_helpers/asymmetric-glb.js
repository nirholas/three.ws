// A small, deliberately asymmetric GLB for render tests: an L-shaped pair of
// boxes in two colours. Every camera azimuth shows a different silhouette, so a
// camera that is parsed but never reaches the rasterizer renders the same
// picture twice and the test catches it.

import { Document, NodeIO } from '@gltf-transform/core';

const CORNERS = [
	[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
	[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];
const FACES = [
	[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4],
	[2, 3, 7], [2, 7, 6], [1, 2, 6], [1, 6, 5], [0, 4, 7], [0, 7, 3],
];

export async function buildAsymmetricGlb() {
	const doc = new Document();
	const buffer = doc.createBuffer();
	const scene = doc.createScene('s');
	const box = (sx, sy, sz, ox, oy, oz, color) => {
		const p = [];
		for (const [x, y, z] of CORNERS) p.push(ox + x * sx, oy + y * sy, oz + z * sz);
		const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array(p)).setBuffer(buffer);
		const ind = doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(FACES.flat())).setBuffer(buffer);
		const mat = doc.createMaterial().setBaseColorFactor(color).setRoughnessFactor(0.6);
		const prim = doc.createPrimitive().setAttribute('POSITION', pos).setIndices(ind).setMaterial(mat);
		scene.addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(prim)));
	};
	box(1.6, 0.4, 0.4, -0.8, 0, -0.2, [0.9, 0.2, 0.1, 1]);
	box(0.4, 1.4, 0.4, 0.4, 0.4, -0.2, [0.1, 0.4, 0.9, 1]);
	return new NodeIO().writeBinary(doc);
}
