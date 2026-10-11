// Mesh operations that run in the browser: repair, smooth, decimate.
//
// Adapted from Modly (https://github.com/lightningpixel/modly), MIT License,
// Copyright (c) 2026 Lightning Pixel. Modly ships these as a Python mesh
// pipeline (trimesh merge/repair, Taubin smoothing, meshoptimizer decimation
// behind a weld). The parameter model and the weld-then-simplify order come
// from there; the implementations below are rewritten for the browser so a
// forge result can be cleaned up without a server round trip, and they keep
// every vertex attribute (UVs, colours, skin weights, morph targets) intact,
// which a position-only pipeline does not.
//
// Everything here works on one indexed triangle primitive in a plain shape:
//
//   { indices: Uint32Array,
//     attributes: { POSITION: { array, itemSize }, NORMAL: ..., TEXCOORD_0: ... },
//     targets: [ { POSITION: { array, itemSize }, ... } ] }
//
// Attribute records may carry extra fields (glTF accessor type, normalized);
// they are passed through untouched. Nothing in this module touches glTF, the
// DOM, or a worker, so the same code runs in a Web Worker, on the main thread,
// and under vitest.
//
// The one idea every operation shares is the split between ATTRIBUTE vertices
// (what a GPU draws: a position plus its UV, normal, ...) and POSITION groups
// (every attribute vertex sitting at the same point in space). A UV seam is two
// attribute vertices in one position group. Topology questions (is this a hole,
// which way is out, who are my neighbours) are asked of position groups so a
// seam never reads as a crack; data is written per attribute vertex so the
// texture never moves.

import {
	connectedShells,
	edgeTopology,
	orientConsistently,
	signedVolume,
	triangleArea,
} from '../../api/_lib/print/topology.js';

// Weld tolerance as a fraction of the bounding-box diagonal. Loose enough to
// close the float noise a generator leaves between "the same" vertex on two
// triangles, tight enough to never fuse two genuinely distinct surfaces.
const WELD_FRACTION = 1e-6;
// Attribute values are compared after rounding to this many steps per unit.
// UVs and colours equal to five decimals are the same texel on any texture
// under 16K; normals and tangents are compared coarser (about 0.06 degrees) so
// float noise does not split a smooth surface, while a real hard edge, whose
// normals differ by tens of degrees, stays split.
const ATTRIBUTE_STEPS = 1e5;
const DIRECTION_STEPS = 1e3;
const DIRECTION_SEMANTICS = new Set(['NORMAL', 'TANGENT']);
// Default crease for recomputed normals: faces meeting at a sharper angle keep
// a hard edge. 60 degrees keeps a cube a cube and a sphere a sphere.
export const DEFAULT_CREASE_DEGREES = 60;

export const SMOOTH_DEFAULTS = Object.freeze({
	method: 'taubin',
	iterations: 10,
	lambda: 0.5,
	passband: 0.1,
	preserveBoundary: true,
});

// ── small helpers ────────────────────────────────────────────────────────────

export function vertexCount(mesh) {
	return mesh.attributes.POSITION.array.length / 3;
}

export function triangleCount(mesh) {
	return Math.floor(mesh.indices.length / 3);
}

export function bboxDiagonal(positions) {
	let minX = Infinity;
	let minY = Infinity;
	let minZ = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	let maxZ = -Infinity;
	for (let i = 0; i < positions.length; i += 3) {
		const x = positions[i];
		const y = positions[i + 1];
		const z = positions[i + 2];
		if (x < minX) minX = x;
		if (y < minY) minY = y;
		if (z < minZ) minZ = z;
		if (x > maxX) maxX = x;
		if (y > maxY) maxY = y;
		if (z > maxZ) maxZ = z;
	}
	if (!Number.isFinite(minX)) return 0;
	return Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
}

function weldTolerance(positions, override) {
	if (override > 0) return override;
	return Math.max(bboxDiagonal(positions) * WELD_FRACTION, 1e-9);
}

function cloneRecord(record, array) {
	return { ...record, array };
}

/**
 * Rebuild every attribute (and every morph target attribute) through a vertex
 * remap. `remap[old]` is the new index, or 0xffffffff for a dropped vertex.
 * When several old vertices map to one new one, the first wins; callers only
 * merge vertices whose kept attributes are equal.
 */
export function remapMesh(mesh, remap, newCount, indices) {
	const remapRecords = (records) => {
		const out = {};
		for (const [name, record] of Object.entries(records)) {
			const { array, itemSize } = record;
			const next = new array.constructor(newCount * itemSize);
			const written = new Uint8Array(newCount);
			const oldCount = array.length / itemSize;
			for (let v = 0; v < oldCount; v += 1) {
				const n = remap[v];
				if (n === 0xffffffff || written[n]) continue;
				written[n] = 1;
				for (let k = 0; k < itemSize; k += 1) next[n * itemSize + k] = array[v * itemSize + k];
			}
			out[name] = cloneRecord(record, next);
		}
		return out;
	};
	return {
		...mesh,
		indices,
		attributes: remapRecords(mesh.attributes),
		targets: (mesh.targets || []).map(remapRecords),
	};
}

/**
 * Drop vertices no triangle references. Survivors keep their original relative
 * order, so attribute arrays stay aligned with what the caller had.
 */
export function compactMesh(mesh) {
	const count = vertexCount(mesh);
	const used = new Uint8Array(count);
	for (let i = 0; i < mesh.indices.length; i += 1) used[mesh.indices[i]] = 1;
	const remap = new Uint32Array(count).fill(0xffffffff);
	let next = 0;
	for (let v = 0; v < count; v += 1) if (used[v]) remap[v] = next++;
	if (next === count) return { mesh, removed: 0 };
	const indices = new Uint32Array(mesh.indices.length);
	for (let i = 0; i < indices.length; i += 1) indices[i] = remap[mesh.indices[i]];
	return { mesh: remapMesh(mesh, remap, next, indices), removed: count - next };
}

/**
 * Position groups: every attribute vertex mapped to the id of the point in
 * space it sits on. Two vertices whose positions agree to `tolerance` share a
 * group, which is what makes a UV seam one edge instead of two.
 */
export function positionGroups(positions, tolerance) {
	const count = positions.length / 3;
	const groupOf = new Uint32Array(count);
	const seen = new Map();
	const inv = 1 / tolerance;
	let groups = 0;
	for (let v = 0; v < count; v += 1) {
		const key = `${Math.round(positions[v * 3] * inv)},${Math.round(positions[v * 3 + 1] * inv)},${Math.round(
			positions[v * 3 + 2] * inv,
		)}`;
		let g = seen.get(key);
		if (g === undefined) {
			g = groups++;
			seen.set(key, g);
		}
		groupOf[v] = g;
	}
	return { groupOf, groupCount: groups };
}

function vertexKey(mesh, v, posInv) {
	const parts = [];
	const pos = mesh.attributes.POSITION.array;
	parts.push(Math.round(pos[v * 3] * posInv), Math.round(pos[v * 3 + 1] * posInv), Math.round(pos[v * 3 + 2] * posInv));
	const pushRecords = (records) => {
		for (const [name, { array, itemSize }] of Object.entries(records)) {
			if (name === 'POSITION' && records === mesh.attributes) continue;
			const steps = DIRECTION_SEMANTICS.has(name) ? DIRECTION_STEPS : ATTRIBUTE_STEPS;
			for (let k = 0; k < itemSize; k += 1) parts.push(Math.round(array[v * itemSize + k] * steps));
		}
	};
	pushRecords(mesh.attributes);
	for (const target of mesh.targets || []) pushRecords(target);
	return parts.join(',');
}

/**
 * Merge attribute vertices that are the same vertex: same position (to the
 * weld tolerance) AND the same UV, colour, skin, normal direction and morph
 * deltas. Never merges across a UV seam or a hard edge, so the texture and the
 * shading are exactly what they were.
 */
export function weldVertices(mesh, opts = {}) {
	const positions = mesh.attributes.POSITION.array;
	const tolerance = weldTolerance(positions, opts.tolerance);
	const posInv = 1 / tolerance;
	const count = vertexCount(mesh);
	const remap = new Uint32Array(count);
	const seen = new Map();
	let next = 0;
	for (let v = 0; v < count; v += 1) {
		const key = vertexKey(mesh, v, posInv);
		let n = seen.get(key);
		if (n === undefined) {
			n = next++;
			seen.set(key, n);
		}
		remap[v] = n;
	}
	const indices = new Uint32Array(mesh.indices.length);
	for (let i = 0; i < indices.length; i += 1) indices[i] = remap[mesh.indices[i]];
	return {
		mesh: next === count ? { ...mesh, indices } : remapMesh(mesh, remap, next, indices),
		merged: count - next,
		tolerance,
	};
}

// ── normals ─────────────────────────────────────────────────────────────────

function buildIncidence(keyOf, keyCount, indices) {
	const triCount = indices.length / 3;
	const offsets = new Uint32Array(keyCount + 1);
	for (let i = 0; i < triCount * 3; i += 1) offsets[keyOf(indices[i]) + 1] += 1;
	for (let k = 0; k < keyCount; k += 1) offsets[k + 1] += offsets[k];
	const cursor = offsets.slice(0, keyCount);
	const faces = new Uint32Array(triCount * 3);
	for (let t = 0; t < triCount; t += 1) {
		for (let c = 0; c < 3; c += 1) {
			const k = keyOf(indices[t * 3 + c]);
			faces[cursor[k]++] = t;
		}
	}
	return { offsets, faces };
}

/**
 * Recompute vertex normals with a crease angle.
 *
 * Around every point in space (a POSITION group, so a UV seam is one point),
 * the surrounding faces are clustered into smoothing groups: two faces join a
 * group when their normals are within `creaseDegrees` of each other, and the
 * relation is transitive, so a sphere is one group and a cube corner is three.
 * Each corner of each triangle takes the area-weighted normal of its group.
 *
 * With `split: true` (repair), a vertex whose corners land in different groups
 * is split into one vertex per group, which is how a hard edge is drawn. With
 * `split: false` (smoothing, which must keep the vertex count), such a vertex
 * averages all of its groups, while vertices that were already split keep their
 * own hard edge.
 */
export function computeNormals(mesh, opts = {}) {
	const positions = mesh.attributes.POSITION.array;
	const count = vertexCount(mesh);
	const indices = mesh.indices;
	const triCount = indices.length / 3;
	const groups = opts.groups || positionGroups(positions, weldTolerance(positions, opts.tolerance));
	const cosCrease = Math.cos(((opts.creaseDegrees ?? DEFAULT_CREASE_DEGREES) * Math.PI) / 180);

	const area = new Float64Array(triCount * 3);
	const unit = new Float64Array(triCount * 3);
	for (let t = 0; t < triCount; t += 1) {
		const a = indices[t * 3] * 3;
		const b = indices[t * 3 + 1] * 3;
		const c = indices[t * 3 + 2] * 3;
		const ux = positions[b] - positions[a];
		const uy = positions[b + 1] - positions[a + 1];
		const uz = positions[b + 2] - positions[a + 2];
		const vx = positions[c] - positions[a];
		const vy = positions[c + 1] - positions[a + 1];
		const vz = positions[c + 2] - positions[a + 2];
		const nx = uy * vz - uz * vy;
		const ny = uz * vx - ux * vz;
		const nz = ux * vy - uy * vx;
		area[t * 3] = nx;
		area[t * 3 + 1] = ny;
		area[t * 3 + 2] = nz;
		const len = Math.hypot(nx, ny, nz) || 1;
		unit[t * 3] = nx / len;
		unit[t * 3 + 1] = ny / len;
		unit[t * 3 + 2] = nz / len;
	}

	// For every corner: the smoothed normal of its face's group at that point.
	const corner = new Float32Array(triCount * 9);
	const cornerCluster = new Int32Array(triCount * 3);
	const around = buildIncidence((v) => groups.groupOf[v], groups.groupCount, indices);
	const parent = [];
	const find = (x) => {
		while (parent[x] !== x) {
			parent[x] = parent[parent[x]];
			x = parent[x];
		}
		return x;
	};
	for (let g = 0; g < groups.groupCount; g += 1) {
		const start = around.offsets[g];
		const faces = around.faces.subarray(start, around.offsets[g + 1]);
		const k = faces.length;
		parent.length = k;
		for (let i = 0; i < k; i += 1) parent[i] = i;
		for (let i = 0; i < k; i += 1) {
			const fi = faces[i];
			for (let j = i + 1; j < k; j += 1) {
				const fj = faces[j];
				const dot = unit[fi * 3] * unit[fj * 3] + unit[fi * 3 + 1] * unit[fj * 3 + 1] + unit[fi * 3 + 2] * unit[fj * 3 + 2];
				if (dot >= cosCrease) {
					const ri = find(i);
					const rj = find(j);
					if (ri !== rj) parent[rj] = ri;
				}
			}
		}
		const sums = new Map();
		for (let i = 0; i < k; i += 1) {
			const r = find(i);
			const f = faces[i];
			const s = sums.get(r) || [0, 0, 0];
			s[0] += area[f * 3];
			s[1] += area[f * 3 + 1];
			s[2] += area[f * 3 + 2];
			sums.set(r, s);
		}
		for (let i = 0; i < k; i += 1) {
			const f = faces[i];
			const r = find(i);
			const s = sums.get(r);
			let len = Math.hypot(s[0], s[1], s[2]);
			let n = s;
			if (len === 0) {
				n = [unit[f * 3], unit[f * 3 + 1], unit[f * 3 + 2]];
				len = Math.hypot(n[0], n[1], n[2]) || 1;
			}
			for (let c = 0; c < 3; c += 1) {
				if (groups.groupOf[indices[f * 3 + c]] !== g) continue;
				const slot = f * 3 + c;
				corner[slot * 3] = n[0] / len;
				corner[slot * 3 + 1] = n[1] / len;
				corner[slot * 3 + 2] = n[2] / len;
				cornerCluster[slot] = start + r;
			}
		}
	}

	const previous = mesh.attributes.NORMAL;
	const normalRecord = (array) =>
		previous ? { ...previous, array, itemSize: 3, normalized: false } : { array, itemSize: 3, type: 'VEC3' };

	if (!opts.split) {
		const normals = new Float32Array(count * 3);
		const seen = new Map();
		for (let slot = 0; slot < triCount * 3; slot += 1) {
			const v = indices[slot];
			const key = v * 2 ** 21 + cornerCluster[slot];
			if (seen.has(key)) continue;
			seen.set(key, true);
			normals[v * 3] += corner[slot * 3];
			normals[v * 3 + 1] += corner[slot * 3 + 1];
			normals[v * 3 + 2] += corner[slot * 3 + 2];
		}
		for (let v = 0; v < count; v += 1) {
			const len = Math.hypot(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]);
			if (len === 0) normals[v * 3 + 1] = 1;
			else {
				normals[v * 3] /= len;
				normals[v * 3 + 1] /= len;
				normals[v * 3 + 2] /= len;
			}
		}
		return { mesh: { ...mesh, attributes: { ...mesh.attributes, NORMAL: normalRecord(normals) } }, splitVertices: 0 };
	}

	// Split: the first smoothing group a vertex meets keeps the vertex, every
	// further group gets a copy of it.
	const firstCluster = new Int32Array(count).fill(-1);
	const copies = new Map();
	const sources = [];
	const nextIndices = new Uint32Array(indices.length);
	let total = count;
	for (let slot = 0; slot < triCount * 3; slot += 1) {
		const v = indices[slot];
		const cl = cornerCluster[slot];
		if (firstCluster[v] === -1 || firstCluster[v] === cl) {
			firstCluster[v] = cl;
			nextIndices[slot] = v;
			continue;
		}
		const key = `${v}:${cl}`;
		let copy = copies.get(key);
		if (copy === undefined) {
			copy = total++;
			copies.set(key, copy);
			sources.push(v);
		}
		nextIndices[slot] = copy;
	}
	const extend = (records) => {
		const out = {};
		for (const [name, record] of Object.entries(records)) {
			const { array, itemSize } = record;
			if (!sources.length) {
				out[name] = record;
				continue;
			}
			const next = new array.constructor(total * itemSize);
			next.set(array);
			sources.forEach((src, i) => {
				for (let k = 0; k < itemSize; k += 1) next[(count + i) * itemSize + k] = array[src * itemSize + k];
			});
			out[name] = cloneRecord(record, next);
		}
		return out;
	};
	const attributes = extend(mesh.attributes);
	const normals = new Float32Array(total * 3);
	for (let slot = 0; slot < triCount * 3; slot += 1) {
		const v = nextIndices[slot];
		normals[v * 3] = corner[slot * 3];
		normals[v * 3 + 1] = corner[slot * 3 + 1];
		normals[v * 3 + 2] = corner[slot * 3 + 2];
	}
	attributes.NORMAL = normalRecord(normals);
	return {
		mesh: { ...mesh, indices: nextIndices, attributes, targets: (mesh.targets || []).map(extend) },
		splitVertices: sources.length,
	};
}

// ── repair ──────────────────────────────────────────────────────────────────

/**
 * Topology repair for a rendered (not printed) model: merge duplicate
 * vertices, drop collapsed / zero-area / duplicate faces, make every connected
 * patch wind the same way, turn closed shells outward, and recompute normals.
 * Never resamples the surface and never moves a UV.
 */
export function repairMesh(input, opts = {}) {
	const trianglesBefore = triangleCount(input);
	const verticesBefore = vertexCount(input);
	const welded = weldVertices(input, opts);
	let mesh = welded.mesh;
	const positions = mesh.attributes.POSITION.array;
	const groups = positionGroups(positions, welded.tolerance);
	const areaEpsilon = (welded.tolerance * welded.tolerance) / 2;

	// Faces are judged on position groups: a face whose corners share a point is
	// collapsed even when its UVs differ, and two faces over the same three
	// points are duplicates even when one is the mirror winding of the other.
	const src = mesh.indices;
	const keepAttr = [];
	const keepPos = [];
	const faceSeen = new Set();
	let collapsedFaces = 0;
	let zeroAreaFaces = 0;
	let duplicateFaces = 0;
	for (let t = 0; t + 2 < src.length; t += 3) {
		const a = src[t];
		const b = src[t + 1];
		const c = src[t + 2];
		const ga = groups.groupOf[a];
		const gb = groups.groupOf[b];
		const gc = groups.groupOf[c];
		if (ga === gb || gb === gc || ga === gc) {
			collapsedFaces += 1;
			continue;
		}
		if (triangleArea(positions, a, b, c) <= areaEpsilon) {
			zeroAreaFaces += 1;
			continue;
		}
		const lo = Math.min(ga, gb, gc);
		const hi = Math.max(ga, gb, gc);
		const key = `${lo},${ga + gb + gc - lo - hi},${hi}`;
		if (faceSeen.has(key)) {
			duplicateFaces += 1;
			continue;
		}
		faceSeen.add(key);
		keepAttr.push(a, b, c);
		keepPos.push(ga, gb, gc);
	}

	const attrIndices = Uint32Array.from(keepAttr);
	const posIndices = Uint32Array.from(keepPos);

	// Winding: propagate across shared edges in position space, then mirror
	// every flip onto the attribute index buffer.
	const oriented = orientConsistently(posIndices);
	const triCount = attrIndices.length / 3;
	const flip = (t) => {
		const b = attrIndices[t * 3 + 1];
		attrIndices[t * 3 + 1] = attrIndices[t * 3 + 2];
		attrIndices[t * 3 + 2] = b;
		const pb = oriented.indices[t * 3 + 1];
		oriented.indices[t * 3 + 1] = oriented.indices[t * 3 + 2];
		oriented.indices[t * 3 + 2] = pb;
	};
	for (let t = 0; t < triCount; t += 1) {
		if (oriented.indices[t * 3 + 1] !== posIndices[t * 3 + 1]) {
			const b = attrIndices[t * 3 + 1];
			attrIndices[t * 3 + 1] = attrIndices[t * 3 + 2];
			attrIndices[t * 3 + 2] = b;
		}
	}

	// Outward: a closed shell with negative enclosed volume is inside-out. Open
	// shells (a cape, a leaf) have no inside, so their winding is left alone.
	const topo = edgeTopology(oriented.indices);
	const shells = connectedShells(oriented.indices, topo.edges);
	const shellOf = new Int32Array(triCount);
	shells.forEach((tris, s) => {
		for (const t of tris) shellOf[t] = s;
	});
	const shellOpen = new Uint8Array(shells.length);
	for (const list of topo.edges.values()) {
		if (list.length === 1) shellOpen[shellOf[list[0]]] = 1;
	}
	let reversedShells = 0;
	shells.forEach((tris, s) => {
		if (shellOpen[s]) return;
		const local = new Uint32Array(tris.length * 3);
		tris.forEach((t, i) => {
			local[i * 3] = attrIndices[t * 3];
			local[i * 3 + 1] = attrIndices[t * 3 + 1];
			local[i * 3 + 2] = attrIndices[t * 3 + 2];
		});
		if (signedVolume(positions, local) < 0) {
			for (const t of tris) flip(t);
			reversedShells += 1;
		}
	});

	mesh = { ...mesh, indices: attrIndices };
	const compacted = compactMesh(mesh);
	mesh = compacted.mesh;
	const shaded = computeNormals(mesh, { creaseDegrees: opts.creaseDegrees, tolerance: welded.tolerance, split: true });
	mesh = shaded.mesh;
	const after = edgeTopology(positionIndexBuffer(mesh, welded.tolerance));

	return {
		mesh,
		stats: {
			trianglesBefore,
			trianglesAfter: triangleCount(mesh),
			verticesBefore,
			verticesAfter: vertexCount(mesh),
			mergedVertices: welded.merged,
			collapsedFaces,
			zeroAreaFaces,
			duplicateFaces,
			flippedFaces: oriented.flipped,
			reversedShells,
			hardEdgeVertices: shaded.splitVertices,
			openEdges: after.openEdges,
			nonManifoldEdges: after.nonManifoldEdges,
		},
	};
}

function positionIndexBuffer(mesh, tolerance) {
	const { groupOf } = positionGroups(mesh.attributes.POSITION.array, tolerance);
	const out = new Uint32Array(mesh.indices.length);
	for (let i = 0; i < out.length; i += 1) out[i] = groupOf[mesh.indices[i]];
	return out;
}

// ── smoothing ───────────────────────────────────────────────────────────────

/**
 * Taubin's second (inflating) factor for a given shrink factor and passband.
 * mu = 1 / (kpb - 1/lambda). With lambda 0.5 and kpb 0.1 this is about -0.526,
 * the classic pairing that smooths noise without the volume loss plain
 * Laplacian smoothing causes.
 */
export function taubinMu(lambda, passband = SMOOTH_DEFAULTS.passband) {
	return 1 / (passband - 1 / lambda);
}

/**
 * Laplacian or Taubin smoothing with uniform weights over position groups.
 * Only positions (and recomputed normals) change: vertex count, index buffer,
 * UVs, colours, skin weights and morph targets are untouched, so the texture
 * stays exactly where it was painted. Boundary rims are pinned by default so an
 * open edge does not creep inward iteration after iteration.
 */
export function smoothMesh(input, opts = {}) {
	const method = opts.method === 'laplacian' ? 'laplacian' : 'taubin';
	const iterations = Math.max(1, Math.min(200, Math.round(opts.iterations ?? SMOOTH_DEFAULTS.iterations)));
	const lambda = Math.max(0.01, Math.min(1, Number(opts.lambda ?? SMOOTH_DEFAULTS.lambda)));
	const passband = Math.max(0.01, Math.min(0.5, Number(opts.passband ?? SMOOTH_DEFAULTS.passband)));
	const mu = method === 'taubin' ? taubinMu(lambda, passband) : 0;
	const preserveBoundary = opts.preserveBoundary ?? SMOOTH_DEFAULTS.preserveBoundary;

	const positions = input.attributes.POSITION.array;
	const diag = bboxDiagonal(positions) || 1;
	const tolerance = weldTolerance(positions, opts.tolerance);
	const groups = positionGroups(positions, tolerance);
	const G = groups.groupCount;
	const count = vertexCount(input);

	const current = new Float64Array(G * 3);
	const seeded = new Uint8Array(G);
	for (let v = 0; v < count; v += 1) {
		const g = groups.groupOf[v];
		if (seeded[g]) continue;
		seeded[g] = 1;
		current[g * 3] = positions[v * 3];
		current[g * 3 + 1] = positions[v * 3 + 1];
		current[g * 3 + 2] = positions[v * 3 + 2];
	}
	const original = current.slice();

	// Neighbour lists over position groups, plus which groups sit on a rim.
	const posIndices = new Uint32Array(input.indices.length);
	for (let i = 0; i < posIndices.length; i += 1) posIndices[i] = groups.groupOf[input.indices[i]];
	const topo = edgeTopology(posIndices);
	const degree = new Uint32Array(G + 1);
	const pinned = new Uint8Array(G);
	const edgeList = [];
	for (const [key, faces] of topo.edges) {
		const a = Math.floor(key / 2 ** 26);
		const b = key - a * 2 ** 26;
		if (a === b) continue;
		edgeList.push(a, b);
		degree[a + 1] += 1;
		degree[b + 1] += 1;
		if (preserveBoundary && faces.length === 1) {
			pinned[a] = 1;
			pinned[b] = 1;
		}
	}
	for (let g = 0; g < G; g += 1) degree[g + 1] += degree[g];
	const neighbours = new Uint32Array(edgeList.length);
	const cursor = degree.slice(0, G);
	for (let i = 0; i < edgeList.length; i += 2) {
		const a = edgeList[i];
		const b = edgeList[i + 1];
		neighbours[cursor[a]++] = b;
		neighbours[cursor[b]++] = a;
	}

	const scratch = new Float64Array(G * 3);
	const step = (factor) => {
		for (let g = 0; g < G; g += 1) {
			const start = degree[g];
			const end = degree[g + 1];
			if (pinned[g] || end === start) {
				scratch[g * 3] = current[g * 3];
				scratch[g * 3 + 1] = current[g * 3 + 1];
				scratch[g * 3 + 2] = current[g * 3 + 2];
				continue;
			}
			let sx = 0;
			let sy = 0;
			let sz = 0;
			for (let i = start; i < end; i += 1) {
				const n = neighbours[i];
				sx += current[n * 3];
				sy += current[n * 3 + 1];
				sz += current[n * 3 + 2];
			}
			const k = 1 / (end - start);
			scratch[g * 3] = current[g * 3] + factor * (sx * k - current[g * 3]);
			scratch[g * 3 + 1] = current[g * 3 + 1] + factor * (sy * k - current[g * 3 + 1]);
			scratch[g * 3 + 2] = current[g * 3 + 2] + factor * (sz * k - current[g * 3 + 2]);
		}
		current.set(scratch);
	};
	for (let i = 0; i < iterations; i += 1) {
		step(lambda);
		if (method === 'taubin') step(mu);
	}

	const next = new positions.constructor(positions.length);
	for (let v = 0; v < count; v += 1) {
		const g = groups.groupOf[v];
		next[v * 3] = current[g * 3];
		next[v * 3 + 1] = current[g * 3 + 1];
		next[v * 3 + 2] = current[g * 3 + 2];
	}
	let maxMove = 0;
	let sumMove = 0;
	let moved = 0;
	for (let g = 0; g < G; g += 1) {
		const d = Math.hypot(
			current[g * 3] - original[g * 3],
			current[g * 3 + 1] - original[g * 3 + 1],
			current[g * 3 + 2] - original[g * 3 + 2],
		);
		if (d > 0) moved += 1;
		sumMove += d;
		if (d > maxMove) maxMove = d;
	}

	const volumeBefore = signedVolume(positions, input.indices);
	let mesh = {
		...input,
		attributes: { ...input.attributes, POSITION: { ...input.attributes.POSITION, array: next } },
	};
	const volumeAfter = signedVolume(next, input.indices);
	if (input.attributes.NORMAL) mesh = computeNormals(mesh, { groups, creaseDegrees: opts.creaseDegrees }).mesh;

	return {
		mesh,
		stats: {
			method,
			iterations,
			lambda,
			mu,
			triangles: triangleCount(mesh),
			vertices: count,
			movedPoints: moved,
			pinnedPoints: pinned.reduce((s, p) => s + p, 0),
			maxDisplacement: maxMove / diag,
			meanDisplacement: G ? sumMove / G / diag : 0,
			volumeChange: Math.abs(volumeBefore) > 0 ? (volumeAfter - volumeBefore) / Math.abs(volumeBefore) : 0,
		},
	};
}

// ── decimation ──────────────────────────────────────────────────────────────

/**
 * Resolve a decimation request to a whole triangle target. `ratio` is the
 * fraction of triangles to keep; `targetTriangles` wins when both are given.
 */
export function resolveTarget(currentTriangles, { targetTriangles, ratio } = {}) {
	let target = Number(targetTriangles);
	if (!(target > 0)) {
		const r = Number(ratio);
		target = r > 0 ? currentTriangles * Math.min(1, r) : currentTriangles;
	}
	return Math.max(1, Math.min(currentTriangles, Math.round(target)));
}

/**
 * Quadric decimation through meshoptimizer, the same library Modly drives.
 * The primitive is welded first (losslessly: only identical vertices merge),
 * because a simplifier can only collapse edges that are actually shared.
 *
 * `simplifier` is meshoptimizer's MeshoptSimplifier after `await .ready`. It is
 * passed in rather than imported so this module stays free of WASM and can be
 * unit tested against the real library without a bundler.
 *
 * A first pass keeps UV seams and attribute borders locked, which is what keeps
 * a texture undistorted. Only when the seams alone stop it short of the target
 * does a second, permissive pass let collapses cross them; the stats say so.
 */
export function decimateMesh(input, opts = {}) {
	const { simplifier } = opts;
	if (!simplifier || typeof simplifier.simplify !== 'function') {
		throw new TypeError('decimateMesh needs MeshoptSimplifier (after `await MeshoptSimplifier.ready`)');
	}
	const trianglesBefore = triangleCount(input);
	const target = resolveTarget(trianglesBefore, opts);
	if (target >= trianglesBefore) {
		return { mesh: input, stats: { trianglesBefore, trianglesAfter: trianglesBefore, target, error: 0, seamsRelaxed: false } };
	}
	const welded = weldVertices(input).mesh;
	const positions = Float32Array.from(welded.attributes.POSITION.array);
	const indices = Uint32Array.from(welded.indices);
	const targetIndexCount = target * 3;
	const maxError = opts.maxError ?? 1;

	const normals = welded.attributes.NORMAL;
	const run = (flags) => {
		if (normals && typeof simplifier.simplifyWithAttributes === 'function') {
			return simplifier.simplifyWithAttributes(
				indices,
				positions,
				3,
				Float32Array.from(normals.array),
				3,
				[0.5, 0.5, 0.5],
				null,
				targetIndexCount,
				maxError,
				flags,
			);
		}
		return simplifier.simplify(indices, positions, 3, targetIndexCount, maxError, flags);
	};

	let [out, error] = run([]);
	let seamsRelaxed = false;
	if (out.length / 3 > target * 1.05) {
		const [relaxed, relaxedError] = run(['Permissive']);
		if (relaxed.length < out.length) {
			out = relaxed;
			error = relaxedError;
			seamsRelaxed = true;
		}
	}

	const { mesh } = compactMesh({ ...welded, indices: Uint32Array.from(out) });
	return {
		mesh,
		stats: {
			trianglesBefore,
			trianglesAfter: triangleCount(mesh),
			verticesBefore: vertexCount(input),
			verticesAfter: vertexCount(mesh),
			target,
			error,
			seamsRelaxed,
		},
	};
}
