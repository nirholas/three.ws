// In-browser mesh operations for the Workbench viewport.
//
// Both tools work on the live three.js scene, so they run instantly on any GLB
// the user generated or imported, with no upload and no queue:
//   • decimate : meshoptimizer edge-collapse simplification (the same library
//                the server-side cleanup in api/_lib/glb-cleanup.js uses),
//                followed by a vertex compaction so the export really shrinks.
//   • smooth   : Taubin lambda/mu smoothing over position-welded vertices, so
//                UV seams never tear and the mesh does not shrink the way plain
//                Laplacian smoothing does.
//
// Generated GLBs arrive meshopt-quantized (Int16/Int8 normalized attributes).
// Every operation first rewrites the touched geometry to plain Float32 so the
// math runs on real coordinates; the exporter writes Float32 back out.

import { BufferAttribute } from 'three';

let simplifierPromise = null;

function loadSimplifier() {
	if (!simplifierPromise) {
		simplifierPromise = import('meshoptimizer/simplifier').then(async ({ MeshoptSimplifier }) => {
			await MeshoptSimplifier.ready;
			return MeshoptSimplifier;
		});
	}
	return simplifierPromise;
}

/** Every mesh in a scene graph that carries triangle geometry. */
export function collectMeshes(root) {
	const meshes = [];
	root.traverse((o) => {
		if (o.isMesh && o.geometry?.attributes?.position) meshes.push(o);
	});
	return meshes;
}

/** Triangle and vertex totals for a scene graph. */
export function countScene(root) {
	let tris = 0;
	let verts = 0;
	for (const m of collectMeshes(root)) {
		const g = m.geometry;
		verts += g.attributes.position.count;
		tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
	}
	return { tris: Math.round(tris), verts };
}

function toFloatAttribute(attr) {
	const size = attr.itemSize;
	const out = new Float32Array(attr.count * size);
	const getters = ['getX', 'getY', 'getZ', 'getW'];
	for (let i = 0; i < attr.count; i++) {
		for (let c = 0; c < size; c++) out[i * size + c] = attr[getters[c]](i);
	}
	return new BufferAttribute(out, size, false);
}

/**
 * Rewrite a geometry so every attribute is a plain, non-interleaved Float32
 * array (skin indices stay integral) and it carries an explicit Uint32 index.
 */
function normalizeGeometry(geometry) {
	for (const name of Object.keys(geometry.attributes)) {
		const attr = geometry.attributes[name];
		if (name === 'skinIndex') {
			if (attr.isInterleavedBufferAttribute) {
				const arr = new Uint16Array(attr.count * attr.itemSize);
				for (let i = 0; i < attr.count; i++) {
					arr[i * 4] = attr.getX(i);
					arr[i * 4 + 1] = attr.getY(i);
					arr[i * 4 + 2] = attr.getZ(i);
					arr[i * 4 + 3] = attr.getW(i);
				}
				geometry.setAttribute(name, new BufferAttribute(arr, attr.itemSize));
			}
			continue;
		}
		if (attr.isInterleavedBufferAttribute || attr.normalized || !(attr.array instanceof Float32Array)) {
			geometry.setAttribute(name, toFloatAttribute(attr));
		}
	}
	for (const name of Object.keys(geometry.morphAttributes)) {
		geometry.morphAttributes[name] = geometry.morphAttributes[name].map((a) =>
			a.isInterleavedBufferAttribute || a.normalized || !(a.array instanceof Float32Array) ? toFloatAttribute(a) : a,
		);
	}
	const count = geometry.attributes.position.count;
	const index = new Uint32Array(geometry.index ? geometry.index.count : count);
	if (geometry.index) for (let i = 0; i < index.length; i++) index[i] = geometry.index.getX(i);
	else for (let i = 0; i < count; i++) index[i] = i;
	geometry.setIndex(new BufferAttribute(index, 1));
	return geometry;
}

function remapAttribute(attr, remap, unique) {
	const size = attr.itemSize;
	const Ctor = attr.array.constructor;
	const out = new Ctor(unique * size);
	for (let i = 0; i < remap.length; i++) {
		const to = remap[i];
		if (to === 0xffffffff) continue;
		for (let c = 0; c < size; c++) out[to * size + c] = attr.array[i * size + c];
	}
	return new BufferAttribute(out, size, attr.normalized);
}

/** Drop vertices no triangle references; rewrites the index in place. */
function compactGeometry(geometry, simplifier, indices) {
	const [remap, unique] = simplifier.compactMesh(indices);
	for (const name of Object.keys(geometry.attributes)) {
		geometry.setAttribute(name, remapAttribute(geometry.attributes[name], remap, unique));
	}
	for (const name of Object.keys(geometry.morphAttributes)) {
		geometry.morphAttributes[name] = geometry.morphAttributes[name].map((a) => remapAttribute(a, remap, unique));
	}
	geometry.setIndex(new BufferAttribute(indices, 1));
	geometry.clearGroups();
	geometry.computeBoundingBox();
	geometry.computeBoundingSphere();
}

/**
 * Simplify every mesh under `root` to `ratio` of its triangles.
 * Geometry shared between meshes is simplified once.
 * @returns {Promise<{before:{tris:number,verts:number}, after:{tris:number,verts:number}}>}
 */
export async function decimateScene(root, ratio) {
	const simplifier = await loadSimplifier();
	const before = countScene(root);
	const done = new Set();
	for (const mesh of collectMeshes(root)) {
		const g = mesh.geometry;
		if (done.has(g)) continue;
		done.add(g);
		normalizeGeometry(g);
		const index = g.index.array;
		if (index.length < 3 * 64) continue;
		const target = Math.max(3 * 32, Math.floor((index.length * ratio) / 3) * 3);
		const [simplified] = simplifier.simplify(index, g.attributes.position.array, 3, target, 0.05, []);
		if (simplified.length >= index.length) continue;
		compactGeometry(g, simplifier, simplified);
		if (g.attributes.normal) recomputeWeldedNormals(g, simplifier);
	}
	return { before, after: countScene(root) };
}

/**
 * Taubin smoothing (lambda = 0.5, mu = -0.53) over position-welded vertices.
 * @param {number} iterations  lambda/mu pairs to apply
 */
export async function smoothScene(root, iterations = 4) {
	const simplifier = await loadSimplifier();
	const done = new Set();
	for (const mesh of collectMeshes(root)) {
		const g = mesh.geometry;
		if (done.has(g)) continue;
		done.add(g);
		normalizeGeometry(g);
		smoothGeometry(g, simplifier, iterations);
	}
	return countScene(root);
}

function smoothGeometry(geometry, simplifier, iterations) {
	const pos = geometry.attributes.position.array;
	const count = pos.length / 3;
	// Vertices that share a position (UV or normal seams) move together.
	const canon = simplifier.generatePositionRemap(pos, 3);
	const index = geometry.index.array;

	// Unique undirected edges between canonical vertices, as CSR adjacency.
	const degree = new Uint32Array(count);
	const edgeSet = new Set();
	const edges = [];
	const addEdge = (a, b) => {
		if (a === b) return;
		const lo = a < b ? a : b;
		const hi = a < b ? b : a;
		const key = lo * count + hi;
		if (edgeSet.has(key)) return;
		edgeSet.add(key);
		edges.push(lo, hi);
		degree[lo]++;
		degree[hi]++;
	};
	for (let t = 0; t < index.length; t += 3) {
		const a = canon[index[t]];
		const b = canon[index[t + 1]];
		const c = canon[index[t + 2]];
		addEdge(a, b);
		addEdge(b, c);
		addEdge(c, a);
	}
	const offsets = new Uint32Array(count + 1);
	for (let i = 0; i < count; i++) offsets[i + 1] = offsets[i] + degree[i];
	const neighbors = new Uint32Array(offsets[count]);
	const fill = offsets.slice(0, count);
	for (let e = 0; e < edges.length; e += 2) {
		neighbors[fill[edges[e]]++] = edges[e + 1];
		neighbors[fill[edges[e + 1]]++] = edges[e];
	}

	const work = Float32Array.from(pos);
	const next = new Float32Array(pos.length);
	const step = (factor) => {
		next.set(work);
		for (let v = 0; v < count; v++) {
			const n = offsets[v + 1] - offsets[v];
			if (n === 0 || canon[v] !== v) continue;
			let x = 0;
			let y = 0;
			let z = 0;
			for (let k = offsets[v]; k < offsets[v + 1]; k++) {
				const u = neighbors[k] * 3;
				x += work[u];
				y += work[u + 1];
				z += work[u + 2];
			}
			const o = v * 3;
			next[o] = work[o] + factor * (x / n - work[o]);
			next[o + 1] = work[o + 1] + factor * (y / n - work[o + 1]);
			next[o + 2] = work[o + 2] + factor * (z / n - work[o + 2]);
		}
		work.set(next);
	};
	for (let i = 0; i < iterations; i++) {
		step(0.5);
		step(-0.53);
	}
	// Seam duplicates take their canonical vertex's new position.
	for (let v = 0; v < count; v++) {
		const c = canon[v] * 3;
		pos[v * 3] = work[c];
		pos[v * 3 + 1] = work[c + 1];
		pos[v * 3 + 2] = work[c + 2];
	}
	geometry.attributes.position.needsUpdate = true;
	if (geometry.attributes.normal) recomputeWeldedNormals(geometry, simplifier, canon);
	geometry.computeBoundingBox();
	geometry.computeBoundingSphere();
}

/**
 * Area-weighted vertex normals summed across every vertex sharing a position,
 * so UV seams shade continuously instead of showing a hard crease.
 */
function recomputeWeldedNormals(geometry, simplifier, canon = null) {
	const pos = geometry.attributes.position.array;
	const index = geometry.index.array;
	const count = pos.length / 3;
	const map = canon || simplifier.generatePositionRemap(pos, 3);
	const acc = new Float32Array(count * 3);
	for (let t = 0; t < index.length; t += 3) {
		const a = index[t] * 3;
		const b = index[t + 1] * 3;
		const c = index[t + 2] * 3;
		const e1x = pos[b] - pos[a];
		const e1y = pos[b + 1] - pos[a + 1];
		const e1z = pos[b + 2] - pos[a + 2];
		const e2x = pos[c] - pos[a];
		const e2y = pos[c + 1] - pos[a + 1];
		const e2z = pos[c + 2] - pos[a + 2];
		const nx = e1y * e2z - e1z * e2y;
		const ny = e1z * e2x - e1x * e2z;
		const nz = e1x * e2y - e1y * e2x;
		for (const v of [index[t], index[t + 1], index[t + 2]]) {
			const o = map[v] * 3;
			acc[o] += nx;
			acc[o + 1] += ny;
			acc[o + 2] += nz;
		}
	}
	const normals = new Float32Array(count * 3);
	for (let v = 0; v < count; v++) {
		const o = map[v] * 3;
		const len = Math.hypot(acc[o], acc[o + 1], acc[o + 2]) || 1;
		normals[v * 3] = acc[o] / len;
		normals[v * 3 + 1] = acc[o + 1] / len;
		normals[v * 3 + 2] = acc[o + 2] / len;
	}
	geometry.setAttribute('normal', new BufferAttribute(normals, 3));
}
