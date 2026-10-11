// In-browser mesh tools (src/mesh-ops): repair, smoothing, decimation.
//
// The algorithms are pure, so they are tested on real geometry built here: a
// UV sphere with a texture seam (the shape every generated model has), and a
// cube assembled from separate triangles with the defects a generator emits
// (duplicate vertices, a collapsed face, a duplicated face, a reversed face, an
// inside-out shell). Decimation runs through the real meshoptimizer WASM, and
// the document layer is exercised end to end on a GLB written and read back by
// glTF-Transform, so nothing here is a stand-in for the code that ships.
import { describe, it, expect, beforeAll } from 'vitest';
import { Document, NodeIO } from '@gltf-transform/core';
import { MeshoptSimplifier } from 'meshoptimizer';

import {
	computeNormals,
	decimateMesh,
	repairMesh,
	resolveTarget,
	smoothMesh,
	taubinMu,
	triangleCount,
	vertexCount,
	weldVertices,
} from '../src/mesh-ops/core.js';
import { applyMeshOp, countTriangles, readPrimitive } from '../src/mesh-ops/gltf.js';
import { edgeTopology, signedVolume } from '../api/_lib/print/topology.js';

/** UV sphere with a duplicated seam column, smooth normals, and UVs. */
function uvSphere(segments = 48, rings = 24, radius = 1) {
	const positions = [];
	const normals = [];
	const uvs = [];
	for (let r = 0; r <= rings; r += 1) {
		const v = r / rings;
		const phi = v * Math.PI;
		for (let s = 0; s <= segments; s += 1) {
			const u = s / segments;
			const theta = u * Math.PI * 2;
			const x = Math.sin(phi) * Math.cos(theta);
			const y = Math.cos(phi);
			const z = Math.sin(phi) * Math.sin(theta);
			positions.push(x * radius, y * radius, z * radius);
			normals.push(x, y, z);
			uvs.push(u, v);
		}
	}
	const indices = [];
	const row = segments + 1;
	for (let r = 0; r < rings; r += 1) {
		for (let s = 0; s < segments; s += 1) {
			const a = r * row + s;
			const b = a + row;
			if (r !== 0) indices.push(a, a + 1, b);
			if (r !== rings - 1) indices.push(a + 1, b + 1, b);
		}
	}
	return {
		indices: Uint32Array.from(indices),
		attributes: {
			POSITION: { array: Float32Array.from(positions), itemSize: 3, type: 'VEC3' },
			NORMAL: { array: Float32Array.from(normals), itemSize: 3, type: 'VEC3' },
			TEXCOORD_0: { array: Float32Array.from(uvs), itemSize: 2, type: 'VEC2' },
		},
		targets: [],
	};
}

/** Add deterministic radial noise to a sphere: what smoothing exists to remove. */
function noisy(mesh, amount = 0.04) {
	const p = mesh.attributes.POSITION.array.slice();
	const groups = new Map();
	for (let v = 0; v < p.length / 3; v += 1) {
		const q = (x) => Math.round(x * 1e5) + 0;
		const key = `${q(p[v * 3])},${q(p[v * 3 + 1])},${q(p[v * 3 + 2])}`;
		if (!groups.has(key)) groups.set(key, 1 + amount * Math.sin(v * 12.9898) * Math.cos(v * 78.233));
		const k = groups.get(key);
		p[v * 3] *= k;
		p[v * 3 + 1] *= k;
		p[v * 3 + 2] *= k;
	}
	return { ...mesh, attributes: { ...mesh.attributes, POSITION: { ...mesh.attributes.POSITION, array: p } } };
}

const CUBE_CORNERS = [
	[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
	[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];
// Outward-wound quads (counter-clockwise seen from outside).
const CUBE_QUADS = [
	[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3],
];

/**
 * A closed cube written as triangle soup (every triangle owns its corners), so
 * welding has 36 corners to merge down to 8, plus one collapsed triangle, one
 * duplicated triangle, and one reversed triangle. `insideOut` reverses all.
 */
function brokenCube({ insideOut = false } = {}) {
	const tris = [];
	for (const [a, b, c, d] of CUBE_QUADS) tris.push([a, b, c], [a, c, d]);
	if (insideOut) for (const t of tris) t.reverse();
	tris[5] = [tris[5][0], tris[5][2], tris[5][1]];
	tris.push([...tris[0]]);
	tris.push([0, 0, 1]);
	const positions = [];
	for (const t of tris) for (const corner of t) positions.push(...CUBE_CORNERS[corner]);
	const count = positions.length / 3;
	const indices = new Uint32Array(count);
	for (let i = 0; i < count; i += 1) indices[i] = i;
	return {
		indices,
		attributes: { POSITION: { array: Float32Array.from(positions), itemSize: 3, type: 'VEC3' } },
		targets: [],
	};
}

beforeAll(async () => {
	await MeshoptSimplifier.ready;
});

describe('repair', () => {
	it('merges duplicate vertices and drops collapsed and duplicate faces', () => {
		const { mesh, stats } = repairMesh(brokenCube());
		expect(stats.trianglesBefore).toBe(14);
		expect(stats.collapsedFaces).toBe(1);
		expect(stats.duplicateFaces).toBe(1);
		expect(stats.trianglesAfter).toBe(12);
		expect(vertexCount(mesh)).toBeLessThanOrEqual(stats.verticesBefore);
		expect(stats.mergedVertices).toBeGreaterThan(0);
	});

	it('makes winding consistent and the closed shell face outward', () => {
		const { mesh, stats } = repairMesh(brokenCube());
		expect(stats.flippedFaces).toBe(1);
		expect(stats.openEdges).toBe(0);
		expect(edgeTopology(mesh.indices).flippedEdges).toBe(0);
		expect(signedVolume(mesh.attributes.POSITION.array, mesh.indices)).toBeCloseTo(8, 5);
	});

	it('turns an inside-out shell outward and reports it', () => {
		const { mesh, stats } = repairMesh(brokenCube({ insideOut: true }));
		expect(stats.reversedShells).toBe(1);
		expect(signedVolume(mesh.attributes.POSITION.array, mesh.indices)).toBeCloseTo(8, 5);
	});

	it('keeps UV seams split and hard edges hard while recomputing normals', () => {
		const sphere = uvSphere();
		expect(signedVolume(sphere.attributes.POSITION.array, sphere.indices)).toBeGreaterThan(0);
		const { mesh, stats } = repairMesh(sphere);
		// The seam column and pole fans are distinct UVs: none of it may merge.
		// The only vertices that go are the two pole corners no triangle uses.
		expect(stats.mergedVertices).toBe(0);
		expect(stats.trianglesAfter).toBe(stats.trianglesBefore);
		const used = new Set(sphere.indices);
		expect(vertexCount(mesh)).toBe(used.size);
		const kept = [...used].sort((a, b) => a - b);
		const uv = mesh.attributes.TEXCOORD_0.array;
		kept.forEach((old, i) => {
			expect(uv[i * 2]).toBe(sphere.attributes.TEXCOORD_0.array[old * 2]);
			expect(uv[i * 2 + 1]).toBe(sphere.attributes.TEXCOORD_0.array[old * 2 + 1]);
		});
		// Cube faces meet at 90 degrees: recomputed normals stay axis aligned.
		const repairedCube = repairMesh(brokenCube());
		const cube = repairedCube.mesh;
		// 8 welded corners, each split three ways for its three hard edges.
		expect(vertexCount(cube)).toBe(24);
		expect(repairedCube.stats.hardEdgeVertices).toBe(16);
		const n = cube.attributes.NORMAL.array;
		for (let v = 0; v < n.length / 3; v += 1) {
			const big = Math.max(Math.abs(n[v * 3]), Math.abs(n[v * 3 + 1]), Math.abs(n[v * 3 + 2]));
			expect(big).toBeCloseTo(1, 5);
		}
	});

	it('smooths shading across a UV seam instead of leaving a visible crease', () => {
		const sphere = uvSphere();
		const { attributes } = computeNormals(sphere).mesh;
		const p = sphere.attributes.POSITION.array;
		const n = attributes.NORMAL.array;
		for (const v of new Set(sphere.indices)) {
			const len = Math.hypot(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]);
			const dot = (p[v * 3] * n[v * 3] + p[v * 3 + 1] * n[v * 3 + 1] + p[v * 3 + 2] * n[v * 3 + 2]) / len;
			expect(dot).toBeGreaterThan(0.99);
		}
	});
});

describe('smoothing', () => {
	it('derives the classic Taubin inflation factor', () => {
		expect(taubinMu(0.5, 0.1)).toBeCloseTo(-0.5263, 3);
		expect(taubinMu(0.5, 0.1)).toBeLessThan(-0.5);
	});

	it('preserves vertex count, index buffer and UVs exactly', () => {
		const sphere = noisy(uvSphere());
		const { mesh, stats } = smoothMesh(sphere, { iterations: 8, lambda: 0.5 });
		expect(vertexCount(mesh)).toBe(vertexCount(sphere));
		expect(mesh.indices).toBe(sphere.indices);
		expect(mesh.attributes.TEXCOORD_0).toBe(sphere.attributes.TEXCOORD_0);
		expect(stats.movedPoints).toBeGreaterThan(0);
	});

	it('moves both sides of a UV seam together so the seam never opens', () => {
		const { mesh } = smoothMesh(noisy(uvSphere()), { iterations: 5 });
		const segments = 48;
		const row = segments + 1;
		const p = mesh.attributes.POSITION.array;
		for (let r = 0; r <= 24; r += 1) {
			const first = r * row;
			const last = first + segments;
			expect(p[first * 3]).toBeCloseTo(p[last * 3], 6);
			expect(p[first * 3 + 1]).toBeCloseTo(p[last * 3 + 1], 6);
			expect(p[first * 3 + 2]).toBeCloseTo(p[last * 3 + 2], 6);
		}
	});

	it('removes noise, and Taubin keeps far more volume than Laplacian', () => {
		const rough = noisy(uvSphere(), 0.05);
		const deviation = (m) => {
			const p = m.attributes.POSITION.array;
			let sum = 0;
			for (let v = 0; v < p.length / 3; v += 1) sum += Math.abs(Math.hypot(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]) - 1);
			return sum / (p.length / 3);
		};
		const taubin = smoothMesh(rough, { method: 'taubin', iterations: 10, lambda: 0.5 });
		const laplacian = smoothMesh(rough, { method: 'laplacian', iterations: 10, lambda: 0.5 });
		expect(Math.abs(taubin.stats.volumeChange)).toBeLessThan(Math.abs(laplacian.stats.volumeChange));
		expect(laplacian.stats.volumeChange).toBeLessThan(0);
		const before = rough.attributes.POSITION.array;
		let roughness = 0;
		let smoothed = 0;
		const p = taubin.mesh.attributes.POSITION.array;
		// Local roughness: distance between neighbours along a ring.
		for (let v = 1; v < before.length / 3; v += 1) {
			roughness += Math.abs(Math.hypot(before[v * 3], before[v * 3 + 1], before[v * 3 + 2]) - Math.hypot(before[v * 3 - 3], before[v * 3 - 2], before[v * 3 - 1]));
			smoothed += Math.abs(Math.hypot(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]) - Math.hypot(p[v * 3 - 3], p[v * 3 - 2], p[v * 3 - 1]));
		}
		expect(smoothed).toBeLessThan(roughness * 0.5);
		expect(deviation(taubin.mesh)).toBeLessThan(0.05);
	});
});

describe('decimation', () => {
	it('resolves a target from a count or a ratio, clamped to the mesh', () => {
		expect(resolveTarget(1000, { ratio: 0.25 })).toBe(250);
		expect(resolveTarget(1000, { targetTriangles: 400, ratio: 0.1 })).toBe(400);
		expect(resolveTarget(1000, { targetTriangles: 5000 })).toBe(1000);
	});

	it('hits a triangle target within 5% on a textured mesh', () => {
		const sphere = uvSphere(96, 48);
		const before = triangleCount(sphere);
		for (const ratio of [0.5, 0.25, 0.1]) {
			const target = Math.round(before * ratio);
			const { mesh, stats } = decimateMesh(sphere, { targetTriangles: target, simplifier: MeshoptSimplifier });
			expect(stats.trianglesAfter).toBe(triangleCount(mesh));
			expect(Math.abs(stats.trianglesAfter - target) / target).toBeLessThan(0.05);
			expect(mesh.attributes.TEXCOORD_0.array.length / 2).toBe(vertexCount(mesh));
		}
	});

	it('decimates an unindexed soup by welding it first', () => {
		const sphere = uvSphere(64, 32);
		const soupCount = sphere.indices.length;
		const soup = { indices: new Uint32Array(soupCount), attributes: {}, targets: [] };
		for (const [name, rec] of Object.entries(sphere.attributes)) {
			const out = new Float32Array(soupCount * rec.itemSize);
			for (let i = 0; i < soupCount; i += 1) {
				for (let k = 0; k < rec.itemSize; k += 1) out[i * rec.itemSize + k] = rec.array[sphere.indices[i] * rec.itemSize + k];
			}
			soup.attributes[name] = { ...rec, array: out };
		}
		for (let i = 0; i < soupCount; i += 1) soup.indices[i] = i;
		expect(weldVertices(soup).merged).toBeGreaterThan(soupCount / 2);
		const target = Math.round(triangleCount(soup) / 4);
		const { stats } = decimateMesh(soup, { targetTriangles: target, simplifier: MeshoptSimplifier });
		expect(Math.abs(stats.trianglesAfter - target) / target).toBeLessThan(0.05);
	});
});

describe('document layer', () => {
	async function sphereGlb() {
		const doc = new Document();
		const buffer = doc.createBuffer();
		const sphere = uvSphere(64, 32);
		const prim = doc.createPrimitive();
		for (const [name, rec] of Object.entries(sphere.attributes)) {
			prim.setAttribute(name, doc.createAccessor().setType(rec.type).setArray(rec.array).setBuffer(buffer));
		}
		prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(sphere.indices).setBuffer(buffer));
		const material = doc.createMaterial('paint').setBaseColorFactor([0.8, 0.3, 0.2, 1]);
		prim.setMaterial(material);
		const mesh = doc.createMesh('sphere').addPrimitive(prim);
		doc.createScene().addChild(doc.createNode('sphere').setMesh(mesh));
		return new NodeIO().writeBinary(doc);
	}

	it('decimates a whole GLB to a document-wide target and round-trips', async () => {
		const io = new NodeIO();
		const doc = await io.readBinary(await sphereGlb());
		const before = countTriangles(doc);
		const stats = applyMeshOp(doc, 'decimate', { ratio: 0.3 }, { simplifier: MeshoptSimplifier });
		expect(stats.trianglesBefore).toBe(before);
		expect(Math.abs(stats.trianglesAfter - stats.target) / stats.target).toBeLessThan(0.05);
		const reread = await io.readBinary(await io.writeBinary(doc));
		expect(countTriangles(reread)).toBe(stats.trianglesAfter);
		expect(reread.getRoot().listMaterials()[0].getName()).toBe('paint');
		expect(reread.getRoot().listAccessors().length).toBe(4);
	});

	it('repairs and smooths in place without changing the material or UV count', async () => {
		const io = new NodeIO();
		const doc = await io.readBinary(await sphereGlb());
		const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
		const uvBefore = new Set(prim.getIndices().getArray()).size;
		const repaired = applyMeshOp(doc, 'repair');
		expect(repaired.duplicateFaces).toBe(0);
		const smoothed = applyMeshOp(doc, 'smooth', { iterations: 4 });
		expect(smoothed.trianglesAfter).toBe(repaired.trianglesAfter);
		const mesh = readPrimitive(doc.getRoot().listMeshes()[0].listPrimitives()[0]);
		expect(mesh.attributes.TEXCOORD_0.array.length / 2).toBe(uvBefore);
		expect(prim.getMaterial().getName()).toBe('paint');
	});
});
