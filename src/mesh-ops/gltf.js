// glTF document layer for the mesh operations in ./core.js.
//
// Reads every triangle primitive of a glTF-Transform Document into the plain
// shape core.js speaks, runs one operation, and writes the result back as fresh
// accessors. Materials, textures, skins, animations and the node hierarchy are
// never touched, which is the whole point of operating on the document rather
// than re-exporting a three.js scene: the texture bytes that come out are the
// texture bytes that went in.
//
// Shared by the browser worker (./worker.js) and the vitest suite, so it
// imports nothing that needs a DOM.

import { decimateMesh, repairMesh, smoothMesh, triangleCount } from './core.js';

const TRIANGLES = 4;

function isTriangles(prim) {
	const mode = prim.getMode();
	return mode === undefined || mode === null || mode === TRIANGLES;
}

function readRecord(accessor) {
	return {
		array: accessor.getArray().slice(),
		itemSize: accessor.getElementSize(),
		type: accessor.getType(),
		normalized: accessor.getNormalized(),
	};
}

/** One triangle primitive as core.js mesh data, or null for points/lines. */
export function readPrimitive(prim) {
	if (!isTriangles(prim)) return null;
	const position = prim.getAttribute('POSITION');
	if (!position) return null;
	const attributes = {};
	for (const semantic of prim.listSemantics()) attributes[semantic] = readRecord(prim.getAttribute(semantic));
	const count = position.getCount();
	const source = prim.getIndices();
	let indices;
	if (source) {
		indices = Uint32Array.from(source.getArray());
	} else {
		indices = new Uint32Array(count);
		for (let i = 0; i < count; i += 1) indices[i] = i;
	}
	if (indices.length % 3) indices = indices.subarray(0, indices.length - (indices.length % 3));
	const targets = prim.listTargets().map((target) => {
		const out = {};
		for (const semantic of target.listSemantics()) out[semantic] = readRecord(target.getAttribute(semantic));
		return out;
	});
	return { indices, attributes, targets };
}

function disposeIfOrphaned(accessor) {
	if (!accessor || accessor.isDisposed()) return;
	const users = accessor.listParents().filter((p) => p.propertyType !== 'Root');
	if (users.length === 0) accessor.dispose();
}

function makeAccessor(doc, buffer, record) {
	const accessor = doc
		.createAccessor()
		.setType(record.type || (record.itemSize === 1 ? 'SCALAR' : `VEC${record.itemSize}`))
		.setArray(record.array)
		.setBuffer(buffer);
	if (record.normalized) accessor.setNormalized(true);
	return accessor;
}

/** Replace a primitive's geometry with `mesh`, disposing accessors left unused. */
export function writePrimitive(doc, prim, mesh) {
	const buffer = doc.getRoot().listBuffers()[0] || doc.createBuffer();
	const old = new Set();
	for (const semantic of prim.listSemantics()) old.add(prim.getAttribute(semantic));
	if (prim.getIndices()) old.add(prim.getIndices());

	for (const semantic of prim.listSemantics()) {
		if (!mesh.attributes[semantic]) prim.setAttribute(semantic, null);
	}
	for (const [semantic, record] of Object.entries(mesh.attributes)) {
		prim.setAttribute(semantic, makeAccessor(doc, buffer, record));
	}
	const vertexTotal = mesh.attributes.POSITION.array.length / 3;
	const indexArray = vertexTotal <= 65535 ? Uint16Array.from(mesh.indices) : Uint32Array.from(mesh.indices);
	prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(indexArray).setBuffer(buffer));

	const targets = prim.listTargets();
	targets.forEach((target, i) => {
		const records = mesh.targets?.[i] || {};
		for (const semantic of target.listSemantics()) {
			old.add(target.getAttribute(semantic));
			const record = records[semantic];
			target.setAttribute(semantic, record ? makeAccessor(doc, buffer, record) : null);
		}
	});
	for (const accessor of old) disposeIfOrphaned(accessor);
}

function trianglePrimitives(doc) {
	const out = [];
	for (const mesh of doc.getRoot().listMeshes()) {
		for (const prim of mesh.listPrimitives()) if (isTriangles(prim) && prim.getAttribute('POSITION')) out.push(prim);
	}
	return out;
}

function primitiveTriangles(prim) {
	const indices = prim.getIndices();
	const count = indices ? indices.getCount() : prim.getAttribute('POSITION').getCount();
	return Math.floor(count / 3);
}

/** Total triangles drawn by every triangle primitive in the document. */
export function countTriangles(doc) {
	let total = 0;
	for (const prim of trianglePrimitives(doc)) total += primitiveTriangles(prim);
	return total;
}

const SUM_KEYS = [
	'trianglesBefore',
	'trianglesAfter',
	'verticesBefore',
	'verticesAfter',
	'mergedVertices',
	'collapsedFaces',
	'zeroAreaFaces',
	'duplicateFaces',
	'flippedFaces',
	'reversedShells',
	'hardEdgeVertices',
	'openEdges',
	'nonManifoldEdges',
	'movedPoints',
	'pinnedPoints',
];

function mergeStats(total, stats) {
	for (const key of SUM_KEYS) {
		if (typeof stats[key] === 'number') total[key] = (total[key] || 0) + stats[key];
	}
	if (typeof stats.maxDisplacement === 'number') total.maxDisplacement = Math.max(total.maxDisplacement || 0, stats.maxDisplacement);
	if (typeof stats.error === 'number') total.error = Math.max(total.error || 0, stats.error);
	if (stats.seamsRelaxed) total.seamsRelaxed = true;
	for (const key of ['method', 'iterations', 'lambda', 'mu']) if (key in stats) total[key] = stats[key];
}

export const OPERATIONS = Object.freeze(['repair', 'smooth', 'decimate']);

/**
 * Run one operation across every triangle primitive. Decimation targets are
 * distributed in proportion to each primitive's share of the triangles, so a
 * request for "20,000 triangles" means the whole model, not each part.
 *
 * @param {import('@gltf-transform/core').Document} doc
 * @param {'repair'|'smooth'|'decimate'} op
 * @param {object} params  operation options from core.js
 * @param {{ simplifier?: object }} deps  MeshoptSimplifier for decimation
 */
export function applyMeshOp(doc, op, params = {}, deps = {}) {
	if (!OPERATIONS.includes(op)) throw new RangeError(`unknown mesh operation "${op}"`);
	const prims = trianglePrimitives(doc);
	const before = countTriangles(doc);
	const totals = { op, primitives: prims.length, trianglesBefore: 0, trianglesAfter: 0 };
	if (!prims.length) return { ...totals, trianglesBefore: before, trianglesAfter: before };

	let ratio = 1;
	if (op === 'decimate') {
		const target = Number(params.targetTriangles) > 0 ? Number(params.targetTriangles) : before * Number(params.ratio || 1);
		ratio = Math.max(0, Math.min(1, target / Math.max(1, before)));
		totals.target = Math.max(1, Math.round(Math.min(before, target)));
	}

	for (const prim of prims) {
		const mesh = readPrimitive(prim);
		if (!mesh || triangleCount(mesh) === 0) continue;
		let result;
		if (op === 'repair') result = repairMesh(mesh, params);
		else if (op === 'smooth') result = smoothMesh(mesh, params);
		else {
			const own = triangleCount(mesh);
			result = decimateMesh(mesh, {
				targetTriangles: Math.max(1, Math.round(own * ratio)),
				maxError: params.maxError,
				simplifier: deps.simplifier,
			});
		}
		writePrimitive(doc, prim, result.mesh);
		const stats = { ...result.stats };
		if (op === 'smooth') {
			stats.trianglesBefore = stats.triangles;
			stats.trianglesAfter = stats.triangles;
		}
		mergeStats(totals, stats);
	}
	totals.trianglesBefore = before;
	totals.trianglesAfter = countTriangles(doc);
	return totals;
}
