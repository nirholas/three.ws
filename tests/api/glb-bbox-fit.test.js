/**
 * Bbox fit (api/_lib/glb-bbox-fit.js): a caller requests [x, y, z] meters
 * (forge-options.js `bbox`) and the delivered mesh is uniformly rescaled to
 * fit inside it, aspect ratio preserved, centered on X/Z and floored at Y=0.
 * Built the same way tests/api/glb-floor-slab.test.js builds its fixtures:
 * real GLBs assembled with the same @gltf-transform the pass reads them with.
 */
import { describe, it, expect } from 'vitest';
import { Document, NodeIO } from '@gltf-transform/core';
import { fitBbox, computeBboxFit } from '../../api/_lib/glb-bbox-fit.js';

function box(tris, x0, x1, y0, y1, z0, z1) {
	const quad = (a, b, c, d) => tris.push([a, b, c], [a, c, d]);
	quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
	quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]);
	quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]);
	quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
	quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
	quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]);
}

async function toGlb(tris) {
	const doc = new Document();
	const buffer = doc.createBuffer();
	const positions = new Float32Array(tris.flat(2));
	const indices = new Uint32Array(tris.length * 3).map((_, i) => i);
	const prim = doc
		.createPrimitive()
		.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer))
		.setIndices(doc.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer));
	const node = doc.createNode().setMesh(doc.createMesh().addPrimitive(prim));
	doc.createScene().addChild(node);
	return Buffer.from(await new NodeIO().writeBinary(doc));
}

// Independent of glb-bbox-fit.js's own bounds computation: reads the written
// GLB back from scratch to verify what actually landed in the file.
async function boundsOf(buf) {
	const doc = await new NodeIO().readBinary(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
	let minX = Infinity, minY = Infinity, minZ = Infinity;
	let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
	const v = [0, 0, 0];
	for (const node of doc.getRoot().listNodes()) {
		const mesh = node.getMesh();
		if (!mesh) continue;
		const m = node.getWorldMatrix();
		for (const prim of mesh.listPrimitives()) {
			const pos = prim.getAttribute('POSITION');
			for (let i = 0; i < pos.getCount(); i++) {
				pos.getElement(i, v);
				const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12];
				const y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13];
				const z = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
				if (y < minY) minY = y;
				if (y > maxY) maxY = y;
				if (z < minZ) minZ = z;
				if (z > maxZ) maxZ = z;
			}
		}
	}
	return { minX, minY, minZ, maxX, maxY, maxZ };
}

describe('computeBboxFit', () => {
	const bounds = { minX: -1, maxX: 1, minY: 0, maxY: 4, minZ: -2, maxZ: 2 };

	it('scales by the most constraining axis and preserves aspect ratio', () => {
		const v = computeBboxFit(bounds, [10, 10, 10]);
		expect(v.fit).toBe(true);
		// height (4) is the largest extent, so a 10m cube binds on Y: scale = 10/4.
		expect(v.scale).toBeCloseTo(2.5, 5);
	});

	it('rejects a non-positive bbox dimension', () => {
		expect(computeBboxFit(bounds, [10, 0, 10]).fit).toBe(false);
		expect(computeBboxFit(bounds, [10, -1, 10]).fit).toBe(false);
	});

	it('rejects a mesh with no extent', () => {
		const flat = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
		expect(computeBboxFit(flat, [1, 1, 1]).fit).toBe(false);
	});
});

describe('fitBbox', () => {
	it('fits a tall box into a cube, centered on X/Z and floored at Y=0', async () => {
		const tris = [];
		box(tris, -1, 1, 0, 4, -2, 2);
		const input = await toGlb(tris);
		const r = await fitBbox(input, [10, 10, 10]);
		expect(r.fitted).toBe(true);
		expect(r.scale).toBeCloseTo(2.5, 5);

		const b = await boundsOf(r.buffer);
		expect(b.minY).toBeCloseTo(0, 3);
		expect(b.maxY).toBeCloseTo(10, 3);
		expect((b.minX + b.maxX) / 2).toBeCloseTo(0, 3);
		expect((b.minZ + b.maxZ) / 2).toBeCloseTo(0, 3);
		expect(b.maxX - b.minX).toBeCloseTo(5, 3); // 2m wide * 2.5
		expect(b.maxZ - b.minZ).toBeCloseTo(10, 3); // 4m deep * 2.5
	});

	it('returns the original bytes unchanged when no bbox is requested', async () => {
		const tris = [];
		box(tris, -1, 1, 0, 1, -1, 1);
		const input = await toGlb(tris);
		const r = await fitBbox(input, null);
		expect(r.fitted).toBe(false);
		expect(r.buffer).toBe(input);
	});

	it('leaves an off-center mesh centered after the fit, not shifted by its original offset', async () => {
		const tris = [];
		box(tris, 5, 7, 0, 2, 100, 102); // same size, far from the origin
		const input = await toGlb(tris);
		const r = await fitBbox(input, [10, 10, 10]);
		expect(r.fitted).toBe(true);
		const b = await boundsOf(r.buffer);
		expect((b.minX + b.maxX) / 2).toBeCloseTo(0, 3);
		expect((b.minZ + b.maxZ) / 2).toBeCloseTo(0, 3);
		expect(b.minY).toBeCloseTo(0, 3);
	});
});
