// Identity-morph fold for served avatar bakes.
//
// three.js allocates one dense float layer per morph target, so a Parametric
// avatar built on the base body carries 306 identity sliders and
// costs every viewer about 68 MB of VRAM even when the avatar's saved sliders
// were settled long ago. A served bake does not need the sliders: the appearance
// it was baked from is final. This module applies the weighted sum of the
// identity targets to POSITION, recomputes the vertex normals for the new shape,
// and deletes the identity targets, so the served GLB carries only the targets a
// viewer still drives at runtime (ARKit expression and viseme targets) plus the
// free-sculpt target, which stays a target because it is reversible by design
// (api/_lib/bake-sculpt.js).
//
// Order inside bakeAppearance: it runs after applyMorphs has written the final
// weights and BEFORE proportions. Proportions rewrite the rest skeleton and its
// inverse bind matrices; the fold works on the original bind geometry, which is
// what the weights were authored against, and never touches the skin.
//
// The editor keeps live sliders: it loads the pristine base plus the saved
// appearance and never reads a served bake, so the fold applies only to
// bakeAndUploadAppearance.
//
// Normals: the mesh is skinned, so they are recomputed in bind (rest, unskinned)
// pose. Vertices are welded by position AND original normal for the
// calculation: a UV seam (same position, same normal, two vertices) is smoothed
// as one, so the seam does not crack, while a hard-edge split (same position,
// different normal) keeps its two normals. Each face adds its unit normal to
// each corner weighted by the interior angle at that corner, then scaled by the
// face area, which is stable on both the thin triangles of a face rig and the
// large flat ones of a torso.

import { ARKIT_52, ARKIT_VISEMES } from '../../src/runtime/arkit52.js';
import { SCULPT_TARGET_NAME } from '../../src/avatar-sculpt-doc.js';

/** Bump when the fold's output changes; it is part of the baked storage key. */
export const FOLD_VERSION = 1;

const KEEP = new Set([...ARKIT_52, ...ARKIT_VISEMES, SCULPT_TARGET_NAME]);

/** Identity targets are everything a viewer does not drive at runtime. */
export function isRuntimeTarget(name) {
	return KEEP.has(name) || /^viseme_/i.test(name) || name === 'tongueOut';
}

/**
 * True for a document built by scripts/build-parametric-base.mjs. The writer
 * replaces the asset generator string, so detect the body by its Body mesh
 * carrying the ethnicity blend targets that script emits.
 */
export function isParametricDocument(doc) {
	return doc
		.getRoot()
		.listMeshes()
		.some((m) => {
			const names = (m.getExtras() || {}).targetNames;
			return m.getName() === 'Body' && Array.isArray(names) && names.includes('bodyCaucasian') && names.length > 100;
		});
}

function namesOf(mesh, count) {
	const ext = mesh.getExtras() || {};
	const names = Array.isArray(ext.targetNames) ? [...ext.targetNames] : [];
	while (names.length < count) names.push(`morph_${names.length}`);
	return names;
}

/** Effective per-target weights of a mesh, or null when its users disagree. */
function effectiveWeights(doc, mesh, count) {
	const users = doc
		.getRoot()
		.listNodes()
		.filter((n) => n.getMesh() === mesh);
	const meshWeights = mesh.getWeights() || [];
	const vectors = (users.length ? users : [null]).map((node) => {
		const own = node?.getWeights() || [];
		return Array.from({ length: count }, (_, i) => own[i] ?? meshWeights[i] ?? 0);
	});
	const first = vectors[0];
	for (const v of vectors) {
		for (let i = 0; i < count; i++) if (Math.abs(v[i] - first[i]) > 1e-9) return { users, weights: null };
	}
	return { users, weights: first };
}

const key3 = (x, y, z) => `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;

/**
 * Smooth vertex normals for `positions` (flat xyz) over `indices`, welding
 * vertices that share a position and a base normal (see the header).
 *
 * @param {Float32Array} positions
 * @param {ArrayLike<number>} indices
 * @param {Float32Array|null} baseNormals  the primitive's NORMAL before the fold; null welds by position only
 * @returns {Float32Array}
 */
export function recomputeNormals(positions, indices, baseNormals) {
	const count = positions.length / 3;
	const group = new Int32Array(count);
	const groups = new Map();
	for (let v = 0; v < count; v++) {
		const k = baseNormals
			? `${key3(positions[3 * v], positions[3 * v + 1], positions[3 * v + 2])}|${key3(baseNormals[3 * v] * 0.1, baseNormals[3 * v + 1] * 0.1, baseNormals[3 * v + 2] * 0.1)}`
			: key3(positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]);
		let g = groups.get(k);
		if (g === undefined) {
			g = groups.size;
			groups.set(k, g);
		}
		group[v] = g;
	}
	const acc = new Float64Array(groups.size * 3);

	for (let f = 0; f + 2 < indices.length; f += 3) {
		const ia = indices[f];
		const ib = indices[f + 1];
		const ic = indices[f + 2];
		const corners = [ia, ib, ic];
		const p = corners.map((i) => [positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]]);
		const e1 = sub(p[1], p[0]);
		const e2 = sub(p[2], p[0]);
		const cr = cross(e1, e2);
		const area2 = Math.hypot(cr[0], cr[1], cr[2]);
		if (area2 < 1e-20) continue;
		const n = [cr[0] / area2, cr[1] / area2, cr[2] / area2];
		for (let c = 0; c < 3; c++) {
			const a = sub(p[(c + 1) % 3], p[c]);
			const b = sub(p[(c + 2) % 3], p[c]);
			const la = Math.hypot(a[0], a[1], a[2]);
			const lb = Math.hypot(b[0], b[1], b[2]);
			if (la < 1e-12 || lb < 1e-12) continue;
			const cos = Math.min(1, Math.max(-1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb)));
			const w = Math.acos(cos) * area2;
			const g = group[corners[c]] * 3;
			acc[g] += n[0] * w;
			acc[g + 1] += n[1] * w;
			acc[g + 2] += n[2] * w;
		}
	}

	const out = new Float32Array(count * 3);
	for (let v = 0; v < count; v++) {
		const g = group[v] * 3;
		const len = Math.hypot(acc[g], acc[g + 1], acc[g + 2]);
		if (len > 1e-12) {
			out[3 * v] = acc[g] / len;
			out[3 * v + 1] = acc[g + 1] / len;
			out[3 * v + 2] = acc[g + 2] / len;
		} else if (baseNormals) {
			out[3 * v] = baseNormals[3 * v];
			out[3 * v + 1] = baseNormals[3 * v + 1];
			out[3 * v + 2] = baseNormals[3 * v + 2];
		} else {
			out[3 * v + 1] = 1;
		}
	}
	return out;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * VRAM three.js spends on a mesh's morph targets: one RGBA32F layer per target
 * per vertex (16 bytes), summed over primitives.
 */
export function morphVramBytes(doc) {
	let bytes = 0;
	for (const mesh of doc.getRoot().listMeshes()) {
		for (const prim of mesh.listPrimitives()) {
			bytes += prim.listTargets().length * (prim.getAttribute('POSITION')?.getCount() || 0) * 16;
		}
	}
	return bytes;
}

/**
 * Fold the identity morph targets of every mesh in `doc` into POSITION, in
 * place. Targets named like ARKit/viseme targets or the free-sculpt target stay.
 *
 * @param {import('@gltf-transform/core').Document} doc
 * @returns {{ folded: Array<{ mesh: string, targets: number, vertices: number }>, skipped: Array<{ mesh: string, reason: string }>, vramBefore: number, vramAfter: number }}
 */
export function foldIdentityMorphs(doc) {
	const folded = [];
	const skipped = [];
	const vramBefore = morphVramBytes(doc);

	for (const mesh of doc.getRoot().listMeshes()) {
		const prims = mesh.listPrimitives();
		const count = prims[0]?.listTargets().length || 0;
		if (!count) continue;
		if (prims.some((p) => p.listTargets().length !== count)) {
			skipped.push({ mesh: mesh.getName(), reason: 'primitives disagree on the target count' });
			continue;
		}
		const names = namesOf(mesh, count);
		const foldIdx = [];
		const keepIdx = [];
		for (let i = 0; i < count; i++) (isRuntimeTarget(names[i]) ? keepIdx : foldIdx).push(i);
		if (!foldIdx.length) continue;

		const { users, weights } = effectiveWeights(doc, mesh, count);
		if (!weights) {
			skipped.push({ mesh: mesh.getName(), reason: 'nodes sharing the mesh carry different morph weights' });
			continue;
		}

		let vertices = 0;
		for (const prim of prims) {
			const pos = prim.getAttribute('POSITION');
			if (!pos) continue;
			const n = pos.getCount();
			vertices += n;
			const base = Float32Array.from(pos.getArray());
			const next = Float32Array.from(base);
			const tangent = prim.getAttribute('TANGENT');
			const nextTangent = tangent ? Float32Array.from(tangent.getArray()) : null;
			const targets = prim.listTargets();
			let moved = false;
			for (const i of foldIdx) {
				const w = weights[i];
				if (!w) continue;
				const delta = targets[i].getAttribute('POSITION')?.getArray();
				if (delta) {
					for (let k = 0; k < n * 3; k++) next[k] += w * delta[k];
					moved = true;
				}
				const tDelta = nextTangent ? targets[i].getAttribute('TANGENT')?.getArray() : null;
				if (tDelta) {
					const stride = tangent.getElementSize();
					for (let v = 0; v < n; v++) {
						for (let c = 0; c < 3; c++) nextTangent[v * stride + c] += w * tDelta[v * 3 + c];
					}
				}
			}
			if (moved) {
				pos.setArray(next);
				const normal = prim.getAttribute('NORMAL');
				const indices = prim.getIndices()?.getArray() || Uint32Array.from({ length: n }, (_, v) => v);
				if (normal && prim.getMode() === 4) {
					normal.setArray(recomputeNormals(next, indices, Float32Array.from(normal.getArray())));
				}
				if (tangent && nextTangent) tangent.setArray(nextTangent);
			}
			for (const i of foldIdx) prim.removeTarget(targets[i]);
		}

		const keptNames = keepIdx.map((i) => names[i]);
		const keptWeights = keepIdx.map((i) => weights[i]);
		mesh.setExtras({ ...(mesh.getExtras() || {}), targetNames: keptNames });
		mesh.setWeights(keptWeights);
		for (const node of users) if ((node.getWeights() || []).length) node.setWeights(keptWeights);
		folded.push({ mesh: mesh.getName(), targets: foldIdx.length, vertices });
	}

	return { folded, skipped, vramBefore, vramAfter: morphVramBytes(doc) };
}
