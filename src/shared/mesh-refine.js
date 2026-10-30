// Local mesh refinement — deterministic geometry passes that run entirely in
// the browser on an already-loaded GLB. No worker, no API, no rate limit.
//
// Generated meshes (TRELLIS / Meshy / Tripo drafts) ship with three recurring
// flaws this module fixes without re-generating anything:
//   • duplicated vertices along seams  → weld (merge by position)
//   • faceted shading from split normals → recompute smooth vertex normals
//   • surface noise / stair-stepping     → Laplacian relaxation
// Plus two density transforms for a target use-case:
//   • decimate (QEM) → a real-time triangle budget, UVs preserved
//   • subdivide      → render-quality density before smoothing
//
// Every function is pure with respect to the DOM and runs headless (the test
// suite exercises them under node), so the panel in forge-refine.js is a thin
// wrapper over this library.

import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js';
import { TessellateModifier } from 'three/addons/modifiers/TessellateModifier.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Triangle + vertex counts for one geometry. */
export function geometryStats(geometry) {
	const pos = geometry.getAttribute?.('position');
	const vertices = pos ? pos.count : 0;
	const index = geometry.getIndex?.();
	const triangles = index ? index.count / 3 : vertices / 3;
	return { vertices, triangles: Math.round(triangles) };
}

/** Summed triangle + vertex counts across every mesh under a scene root. */
export function sceneStats(root) {
	let vertices = 0;
	let triangles = 0;
	root?.traverse?.((obj) => {
		if (obj.isMesh && obj.geometry) {
			const s = geometryStats(obj.geometry);
			vertices += s.vertices;
			triangles += s.triangles;
		}
	});
	return { vertices, triangles };
}

// A geometry with per-face (multi-material) groups can't survive the
// re-indexing that decimate/subdivide perform — the group ranges would point at
// stale vertices. We still weld + re-shade those meshes, but skip the density
// transforms rather than corrupt them.
function hasMaterialGroups(geometry) {
	return Array.isArray(geometry.groups) && geometry.groups.length > 1;
}

function ensureIndexed(geometry) {
	return geometry.getIndex() ? geometry : mergeVertices(geometry);
}

/** Weld vertices that share a position (within tolerance). Returns indexed geometry. */
export function weldGeometry(geometry, tolerance = 1e-4) {
	try {
		return mergeVertices(geometry, tolerance);
	} catch {
		// mergeVertices throws on geometries with interleaved/odd attributes;
		// the original is always safe to return untouched.
		return geometry;
	}
}

/** Recompute smooth vertex normals in place (fixes faceted shading post-weld). */
export function recomputeSmoothNormals(geometry) {
	geometry.deleteAttribute('normal');
	geometry.computeVertexNormals();
	return geometry;
}

// Mean length of a sample of edges — used to scale subdivision so one pass
// roughly doubles density regardless of the model's world scale. Sampled (not
// exhaustive) so it stays O(1)-ish on large meshes.
function meanEdgeLength(geometry) {
	const pos = geometry.getAttribute('position');
	const index = geometry.getIndex();
	if (!pos || !index) return 0;
	const idx = index.array;
	const triCount = idx.length / 3;
	const step = Math.max(1, Math.floor(triCount / 2000)); // cap at ~2k sampled tris
	let total = 0;
	let n = 0;
	for (let t = 0; t < triCount; t += step) {
		const a = idx[t * 3];
		const b = idx[t * 3 + 1];
		const c = idx[t * 3 + 2];
		total += edgeLen(pos, a, b) + edgeLen(pos, b, c) + edgeLen(pos, c, a);
		n += 3;
	}
	return n ? total / n : 0;
}

function edgeLen(pos, i, j) {
	const dx = pos.getX(i) - pos.getX(j);
	const dy = pos.getY(i) - pos.getY(j);
	const dz = pos.getZ(i) - pos.getZ(j);
	return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Laplacian smoothing: move each interior vertex a fraction (`lambda`) toward
 * the centroid of its neighbours, `iterations` times. Boundary vertices (on an
 * edge used by a single triangle) are pinned so open meshes don't shrink inward.
 * Operates on a welded, indexed copy and recomputes smooth normals.
 */
export function laplacianSmooth(geometry, { iterations = 1, lambda = 0.5 } = {}) {
	const geo = ensureIndexed(geometry);
	const posAttr = geo.getAttribute('position');
	const index = geo.getIndex().array;
	const count = posAttr.count;
	if (!count || iterations < 1) return recomputeSmoothNormals(geo);

	const neighbors = Array.from({ length: count }, () => new Set());
	const edgeUse = new Map();
	for (let i = 0; i < index.length; i += 3) {
		const tri = [index[i], index[i + 1], index[i + 2]];
		for (let e = 0; e < 3; e++) {
			const u = tri[e];
			const v = tri[(e + 1) % 3];
			neighbors[u].add(v);
			neighbors[v].add(u);
			const key = u < v ? u * count + v : v * count + u;
			edgeUse.set(key, (edgeUse.get(key) || 0) + 1);
		}
	}
	const boundary = new Uint8Array(count);
	for (const [key, used] of edgeUse) {
		if (used === 1) {
			boundary[Math.floor(key / count)] = 1;
			boundary[key % count] = 1;
		}
	}

	let buf = Float32Array.from(posAttr.array);
	const l = clamp(lambda, 0, 1);
	for (let it = 0; it < iterations; it++) {
		const next = Float32Array.from(buf);
		for (let v = 0; v < count; v++) {
			if (boundary[v]) continue;
			const ns = neighbors[v];
			if (ns.size === 0) continue;
			let cx = 0;
			let cy = 0;
			let cz = 0;
			for (const n of ns) {
				cx += buf[n * 3];
				cy += buf[n * 3 + 1];
				cz += buf[n * 3 + 2];
			}
			const inv = 1 / ns.size;
			next[v * 3] = buf[v * 3] + l * (cx * inv - buf[v * 3]);
			next[v * 3 + 1] = buf[v * 3 + 1] + l * (cy * inv - buf[v * 3 + 1]);
			next[v * 3 + 2] = buf[v * 3 + 2] + l * (cz * inv - buf[v * 3 + 2]);
		}
		buf = next;
	}
	posAttr.copyArray(buf);
	posAttr.needsUpdate = true;
	return recomputeSmoothNormals(geo);
}

/**
 * Subdivide: split edges longer than half the mean edge length, up to
 * `iterations` passes, then re-weld so the denser mesh shades smoothly.
 */
export function subdivideGeometry(geometry, { iterations = 1 } = {}) {
	const geo = ensureIndexed(geometry);
	const mean = meanEdgeLength(geo);
	if (!(mean > 0)) return geo;
	const passes = clamp(Math.round(iterations), 1, 3);
	const mod = new TessellateModifier(mean * 0.5, passes * 2);
	const tessellated = mod.modify(geo);
	const welded = weldGeometry(tessellated);
	return recomputeSmoothNormals(welded);
}

/**
 * Decimate via quadric error metric (SimplifyModifier). `keep` is the fraction
 * of vertices to retain (0..1). UVs/normals/colors are carried through.
 * Async because SimplifyModifier runs meshoptimizer's WASM simplifier since
 * three 0.187 and resolves once that module is ready.
 */
export async function decimateGeometry(geometry, { keep = 0.5 } = {}) {
	const pos = geometry.getAttribute('position');
	if (!pos) return geometry;
	const ratio = clamp(keep, 0.05, 0.95);
	const remove = Math.floor(pos.count * (1 - ratio));
	if (remove <= 0) return geometry;
	try {
		return await new SimplifyModifier().modify(geometry, remove);
	} catch {
		// Degenerate topology can trip the simplifier; the un-decimated geometry
		// is always a valid result, just denser than requested.
		return geometry;
	}
}

/**
 * Apply a refinement spec to one geometry and return the refined geometry.
 * Pipeline order is fixed and intentional: weld first (dedupe + enable the
 * later passes), then the one density transform, then relaxation, then smooth
 * normals last. `spec` keys: { weld, decimate, subdivide, smooth, lambda,
 * normals }.
 */
export async function refineGeometry(geometry, spec = {}) {
	let geo = geometry;
	const groups = hasMaterialGroups(geo);
	if (spec.weld !== false) geo = weldGeometry(geo, spec.weldTolerance ?? 1e-4);
	if (!groups && spec.decimate) geo = await decimateGeometry(geo, { keep: spec.decimate });
	if (!groups && spec.subdivide) geo = subdivideGeometry(geo, { iterations: spec.subdivide });
	if (spec.smooth) geo = laplacianSmooth(geo, { iterations: spec.smooth, lambda: spec.lambda });
	if (spec.normals !== false) recomputeSmoothNormals(geo);
	return geo;
}

/**
 * Refine every mesh under a scene root in place, swapping each mesh's geometry
 * for its refined version. Returns { before, after } stat totals so the caller
 * can show the user exactly what changed.
 */
export async function refineScene(root, spec = {}) {
	const before = sceneStats(root);
	const meshes = [];
	root.traverse((obj) => {
		if (obj.isMesh && obj.geometry?.getAttribute?.('position')) meshes.push(obj);
	});
	for (const obj of meshes) {
		const refined = await refineGeometry(obj.geometry, spec);
		if (refined !== obj.geometry) {
			obj.geometry.dispose?.();
			obj.geometry = refined;
		}
	}
	return { before, after: sceneStats(root) };
}

// Intent-driven presets. Each carries the spec it applies plus an optional
// slider descriptor whose `map(value)` returns spec overrides — so one slider
// means "smoothing passes" under Smooth and "kept detail %" under Game-ready.
export const REFINE_PRESETS = [
	{
		key: 'clean',
		name: 'Clean',
		icon: '✦',
		blurb: 'Weld duplicate vertices and fix faceted shading. Smaller file, smoother look — geometry unchanged.',
		spec: { weld: true, normals: true },
		slider: null,
	},
	{
		key: 'smooth',
		name: 'Smooth',
		icon: '◠',
		blurb: 'Relax the surface noise and stair-stepping that generated meshes carry, without losing the shape.',
		spec: { weld: true, smooth: 3, lambda: 0.5, normals: true },
		slider: {
			min: 1,
			max: 8,
			def: 3,
			label: 'Smoothing passes',
			map: (v) => ({ smooth: v }),
		},
	},
	{
		key: 'gameready',
		name: 'Game-ready',
		icon: '◆',
		blurb: 'Decimate to a real-time triangle budget while preserving silhouette and UVs. Lower poly, clean shading.',
		spec: { weld: true, decimate: 0.5, normals: true },
		slider: {
			min: 10,
			max: 90,
			def: 50,
			label: 'Kept detail',
			unit: '%',
			map: (v) => ({ decimate: v / 100 }),
		},
	},
	{
		key: 'hero',
		name: 'Hero',
		icon: '❖',
		blurb: 'Subdivide and relax for a high-density, render-quality surface. Best for close-up hero shots.',
		spec: { weld: true, subdivide: 1, smooth: 2, lambda: 0.4, normals: true },
		slider: {
			min: 1,
			max: 3,
			def: 1,
			label: 'Subdivision',
			map: (v) => ({ subdivide: v }),
		},
	},
];

export const REFINE_PRESET_BY_KEY = Object.fromEntries(REFINE_PRESETS.map((p) => [p.key, p]));

/** Resolve a preset + slider value into the concrete spec to run. */
export function specForPreset(key, sliderValue) {
	const preset = REFINE_PRESET_BY_KEY[key];
	if (!preset) return null;
	if (!preset.slider || sliderValue == null) return { ...preset.spec };
	return { ...preset.spec, ...preset.slider.map(Number(sliderValue)) };
}
