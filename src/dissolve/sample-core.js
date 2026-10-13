// Pure geometry maths behind /dissolve. No three.js, no DOM, so every rule here
// is held by tests/dissolve-core.test.js.
//
//   • mulberry32          seeded RNG, so a shape dissolves into the same cloud
//                         every time and a shared link reproduces a look
//   • allocateCounts      split a particle budget across meshes by surface area
//   • sampleMesh          area-weighted uniform points on a triangle mesh
//   • interpolate         barycentric blend of any per-vertex attribute
//   • mortonOrder         spatial sort that pairs shape A with shape B
//   • fitTransform        scale and offset that seat a shape on the shared floor

/** Small, fast, well-distributed seeded generator. Returns floats in [0, 1). */
export function mulberry32(seed) {
	let a = seed >>> 0;
	return function next() {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Triangle count of an indexed or non-indexed position array. */
export function triangleCount(positions, indices) {
	return indices ? Math.floor(indices.length / 3) : Math.floor(positions.length / 9);
}

function vertexOf(indices, tri, corner) {
	return indices ? indices[tri * 3 + corner] : tri * 3 + corner;
}

/** Surface area of every triangle. Degenerate triangles come out as 0. */
export function triangleAreas(positions, indices) {
	const n = triangleCount(positions, indices);
	const areas = new Float64Array(n);
	for (let t = 0; t < n; t++) {
		const a = vertexOf(indices, t, 0) * 3;
		const b = vertexOf(indices, t, 1) * 3;
		const c = vertexOf(indices, t, 2) * 3;
		const ux = positions[b] - positions[a];
		const uy = positions[b + 1] - positions[a + 1];
		const uz = positions[b + 2] - positions[a + 2];
		const vx = positions[c] - positions[a];
		const vy = positions[c + 1] - positions[a + 1];
		const vz = positions[c + 2] - positions[a + 2];
		const cx = uy * vz - uz * vy;
		const cy = uz * vx - ux * vz;
		const cz = ux * vy - uy * vx;
		const area = 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
		areas[t] = Number.isFinite(area) ? area : 0;
	}
	return areas;
}

/** Cumulative area table. `total` is 0 when the mesh has no surface at all. */
export function buildCdf(areas) {
	const cdf = new Float64Array(areas.length);
	let total = 0;
	for (let i = 0; i < areas.length; i++) {
		total += areas[i];
		cdf[i] = total;
	}
	return { cdf, total };
}

/** Index of the triangle that owns a draw `r` in [0, 1). Binary search. */
export function pickTriangle(cdf, total, r) {
	const target = r * total;
	let lo = 0;
	let hi = cdf.length - 1;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (cdf[mid] > target) hi = mid;
		else lo = mid + 1;
	}
	return lo;
}

/** Uniform barycentric coordinates via the square-root method. */
export function randomBarycentric(r1, r2, out = [0, 0, 0]) {
	const s = Math.sqrt(r1);
	out[0] = 1 - s;
	out[1] = s * (1 - r2);
	out[2] = s * r2;
	return out;
}

/**
 * Split `count` particles across weights with the largest-remainder method, so
 * the parts always sum to exactly `count` and no weight is rounded to nothing
 * while a heavier one gains an extra particle.
 */
export function allocateCounts(weights, count) {
	const n = weights.length;
	const out = new Array(n).fill(0);
	let sum = 0;
	for (const w of weights) sum += w > 0 ? w : 0;
	if (n === 0 || !(sum > 0) || count <= 0) return out;
	const remainders = [];
	let assigned = 0;
	for (let i = 0; i < n; i++) {
		const exact = ((weights[i] > 0 ? weights[i] : 0) / sum) * count;
		const whole = Math.floor(exact);
		out[i] = whole;
		assigned += whole;
		remainders.push({ i, frac: exact - whole });
	}
	remainders.sort((a, b) => b.frac - a.frac || a.i - b.i);
	for (let k = 0; assigned < count; k = (k + 1) % n) {
		if ((weights[remainders[k].i] > 0 ? weights[remainders[k].i] : 0) > 0) {
			out[remainders[k].i]++;
			assigned++;
		}
	}
	return out;
}

/**
 * Draw `count` uniform points on the surface of one mesh.
 *
 * `mesh.positions` is world-space xyz, `mesh.indices` is optional, `mesh.uvs`
 * is optional. Returns the points plus, per point, the triangle it landed on
 * and its barycentric weights, which is what colour lookup needs.
 */
export function sampleMesh(mesh, count, rng, precomputed = null) {
	const { positions, indices = null, uvs = null } = mesh;
	const { cdf, total } = precomputed || buildCdf(triangleAreas(positions, indices));
	const out = {
		positions: new Float32Array(count * 3),
		uvs: uvs ? new Float32Array(count * 2) : null,
		tri: new Uint32Array(count),
		bary: new Float32Array(count * 3),
	};
	if (!(total > 0) || count === 0) return { ...out, count: 0 };
	const w = [0, 0, 0];
	for (let i = 0; i < count; i++) {
		const t = pickTriangle(cdf, total, rng());
		randomBarycentric(rng(), rng(), w);
		const a = vertexOf(indices, t, 0);
		const b = vertexOf(indices, t, 1);
		const c = vertexOf(indices, t, 2);
		for (let k = 0; k < 3; k++) {
			out.positions[i * 3 + k] =
				positions[a * 3 + k] * w[0] + positions[b * 3 + k] * w[1] + positions[c * 3 + k] * w[2];
		}
		if (uvs) {
			for (let k = 0; k < 2; k++) {
				out.uvs[i * 2 + k] = uvs[a * 2 + k] * w[0] + uvs[b * 2 + k] * w[1] + uvs[c * 2 + k] * w[2];
			}
		}
		out.tri[i] = t;
		out.bary[i * 3] = w[0];
		out.bary[i * 3 + 1] = w[1];
		out.bary[i * 3 + 2] = w[2];
	}
	return { ...out, count };
}

/** Barycentric blend of a per-vertex attribute for sample `i`. */
export function interpolate(attribute, itemSize, indices, tri, bary, i, out) {
	const a = vertexOf(indices, tri[i], 0);
	const b = vertexOf(indices, tri[i], 1);
	const c = vertexOf(indices, tri[i], 2);
	for (let k = 0; k < itemSize; k++) {
		out[k] =
			attribute[a * itemSize + k] * bary[i * 3] +
			attribute[b * itemSize + k] * bary[i * 3 + 1] +
			attribute[c * itemSize + k] * bary[i * 3 + 2];
	}
	return out;
}

/** Spread the low 10 bits of `v` so there are two zero bits between each. */
function spreadBits(v) {
	v &= 0x3ff;
	v = (v | (v << 16)) & 0x030000ff;
	v = (v | (v << 8)) & 0x0300f00f;
	v = (v | (v << 4)) & 0x030c30c3;
	v = (v | (v << 2)) & 0x09249249;
	return v >>> 0;
}

/** 30-bit Morton code for a point inside [min, max]. */
export function mortonCode(x, y, z, min, max) {
	const q = (v, axis) => {
		const span = max[axis] - min[axis];
		const f = span > 0 ? (v - min[axis]) / span : 0;
		return Math.max(0, Math.min(1023, Math.floor(f * 1023)));
	};
	return (spreadBits(q(x, 0)) | (spreadBits(q(y, 1)) << 1) | (spreadBits(q(z, 2)) << 2)) >>> 0;
}

/**
 * Permutation that lists points in Morton order over a shared box. Particle
 * `i` of two clouds sorted over the SAME box lands at the same relative place
 * in each, so a morph moves bottom to bottom and head to head instead of
 * shuffling the whole body through itself. Supports up to 2^20 points.
 */
export function mortonOrder(positions, count, min, max) {
	if (count > 1048576) throw new RangeError('mortonOrder supports at most 1048576 points');
	const keys = new Float64Array(count);
	for (let i = 0; i < count; i++) {
		const code = mortonCode(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2], min, max);
		keys[i] = code * 1048576 + i;
	}
	keys.sort();
	const order = new Uint32Array(count);
	for (let i = 0; i < count; i++) order[i] = keys[i] % 1048576;
	return order;
}

/** Axis-aligned bounds of an xyz array. Empty input gives a unit box. */
export function boundsOf(positions, count = positions.length / 3) {
	if (count === 0) return { min: [-1, -1, -1], max: [1, 1, 1] };
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < count; i++) {
		for (let k = 0; k < 3; k++) {
			const v = positions[i * 3 + k];
			if (v < min[k]) min[k] = v;
			if (v > max[k]) max[k] = v;
		}
	}
	return { min, max };
}

/** Height of the shared stage. Every shape is seated with its feet on -1. */
export const STAGE_HEIGHT = 2;
/** The widest a shape may get, so a long prop never leaves the frame. */
export const STAGE_MAX_WIDTH = 3.2;

/**
 * Scale and offset that turn a model's raw bounds into stage space: feet on
 * y = -1, centred on x and z, tall figures filling the stage height, and wide
 * ones (a fox, a car) held to a width the camera can frame.
 */
export function fitTransform(min, max) {
	const sx = max[0] - min[0];
	const sy = max[1] - min[1];
	const sz = max[2] - min[2];
	const wide = Math.max(sx, sz);
	const basis = Math.max(sy, 0.6 * wide);
	let scale = basis > 0 ? STAGE_HEIGHT / basis : 1;
	if (wide * scale > STAGE_MAX_WIDTH) scale = STAGE_MAX_WIDTH / wide;
	const offset = [
		-((min[0] + max[0]) / 2) * scale,
		-1 - min[1] * scale,
		-((min[2] + max[2]) / 2) * scale,
	];
	return { scale, offset };
}
