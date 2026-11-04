/**
 * Morph conform for worn garments and hair on the Parametric base.
 *
 * Catalog wearables are rebound by skin weights (src/avatar-garment.js in the
 * editor, api/_lib/bake-garments.js in the server bake). Skin weights follow
 * bones and proportions but not the body's identity morphs (jaw, chest, hips,
 * limbs) or free-sculpt deltas, so a widened chest leaves the shirt at the
 * default silhouette. This module closes that gap with one shared, pure,
 * dependency-free algorithm used by both paths, so the baked GLB matches what
 * the editor shows.
 *
 *   1. bind    : once per (body, garment) pair, find each garment vertex's
 *                nearest body triangle in the rest pose and store barycentric
 *                coordinates, the offset along the face normal and a falloff
 *                weight. The result is cached on the garment instance.
 *   2. apply   : given the morphed body positions, move each garment vertex by
 *                the interpolated body delta plus the change of the face normal
 *                scaled by the stored offset (so standoff survives a rotating
 *                surface), blended by the falloff weight. Zero allocation.
 *
 * Positions are flat Float32Array/Array triples in the shared bind space.
 */

export const DEFAULT_REACH = 0.08;
export const DEFAULT_FALLOFF = 0.05;

/**
 * Whether a wearable should be conformed. Unskinned (rigid) pieces ride a bone;
 * deforming them would bend glasses and hats.
 * @param {{ skinned: boolean, rigid?: boolean }} piece
 */
export function shouldConform(piece) {
	if (!piece || !piece.skinned) return false;
	if (piece.rigid === true) return false;
	return true;
}

/* ── geometry ────────────────────────────────────────────────────────────── */

/** Closest point on triangle (a,b,c) to p. Writes barycentric (u,v,w) to `out`; returns squared distance. */
function closestOnTriangle(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, out) {
	const abx = bx - ax, aby = by - ay, abz = bz - az;
	const acx = cx - ax, acy = cy - ay, acz = cz - az;
	const apx = px - ax, apy = py - ay, apz = pz - az;
	const d1 = abx * apx + aby * apy + abz * apz;
	const d2 = acx * apx + acy * apy + acz * apz;
	let u, v, w;
	if (d1 <= 0 && d2 <= 0) {
		u = 1; v = 0; w = 0;
	} else {
		const bpx = px - bx, bpy = py - by, bpz = pz - bz;
		const d3 = abx * bpx + aby * bpy + abz * bpz;
		const d4 = acx * bpx + acy * bpy + acz * bpz;
		if (d3 >= 0 && d4 <= d3) {
			u = 0; v = 1; w = 0;
		} else {
			const vc = d1 * d4 - d3 * d2;
			if (vc <= 0 && d1 >= 0 && d3 <= 0) {
				const t = d1 / (d1 - d3);
				u = 1 - t; v = t; w = 0;
			} else {
				const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
				const d5 = abx * cpx + aby * cpy + abz * cpz;
				const d6 = acx * cpx + acy * cpy + acz * cpz;
				if (d6 >= 0 && d5 <= d6) {
					u = 0; v = 0; w = 1;
				} else {
					const vb = d5 * d2 - d1 * d6;
					if (vb <= 0 && d2 >= 0 && d6 <= 0) {
						const t = d2 / (d2 - d6);
						u = 1 - t; v = 0; w = t;
					} else {
						const va = d3 * d6 - d5 * d4;
						if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
							const t = (d4 - d3) / (d4 - d3 + (d5 - d6));
							u = 0; v = 1 - t; w = t;
						} else {
							const denom = 1 / (va + vb + vc);
							v = vb * denom;
							w = vc * denom;
							u = 1 - v - w;
						}
					}
				}
			}
		}
	}
	out[0] = u; out[1] = v; out[2] = w;
	const qx = u * ax + v * bx + w * cx - px;
	const qy = u * ay + v * by + w * cy - py;
	const qz = u * az + v * bz + w * cz - pz;
	return qx * qx + qy * qy + qz * qz;
}

/** Unit face normal of triangle tri into out[o..o+2]; returns false when degenerate. */
function faceNormal(pos, i0, i1, i2, out, o) {
	const ax = pos[i0 * 3], ay = pos[i0 * 3 + 1], az = pos[i0 * 3 + 2];
	const e1x = pos[i1 * 3] - ax, e1y = pos[i1 * 3 + 1] - ay, e1z = pos[i1 * 3 + 2] - az;
	const e2x = pos[i2 * 3] - ax, e2y = pos[i2 * 3 + 1] - ay, e2z = pos[i2 * 3 + 2] - az;
	const nx = e1y * e2z - e1z * e2y;
	const ny = e1z * e2x - e1x * e2z;
	const nz = e1x * e2y - e1y * e2x;
	const len = Math.hypot(nx, ny, nz);
	if (len < 1e-14) {
		out[o] = 0; out[o + 1] = 0; out[o + 2] = 0;
		return false;
	}
	out[o] = nx / len; out[o + 1] = ny / len; out[o + 2] = nz / len;
	return true;
}

/** Uniform grid over triangle bounding boxes for nearest-triangle queries. */
function buildGrid(pos, idx, cell) {
	let minX = Infinity, minY = Infinity, minZ = Infinity;
	let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
	for (let i = 0; i < pos.length; i += 3) {
		if (pos[i] < minX) minX = pos[i];
		if (pos[i] > maxX) maxX = pos[i];
		if (pos[i + 1] < minY) minY = pos[i + 1];
		if (pos[i + 1] > maxY) maxY = pos[i + 1];
		if (pos[i + 2] < minZ) minZ = pos[i + 2];
		if (pos[i + 2] > maxZ) maxZ = pos[i + 2];
	}
	const nx = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
	const ny = Math.max(1, Math.ceil((maxY - minY) / cell) + 1);
	const nz = Math.max(1, Math.ceil((maxZ - minZ) / cell) + 1);
	const buckets = new Map();
	const key = (x, y, z) => (z * ny + y) * nx + x;
	const triCount = idx.length / 3;
	for (let t = 0; t < triCount; t++) {
		const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
		const lx = Math.min(pos[a], pos[b], pos[c]), hx = Math.max(pos[a], pos[b], pos[c]);
		const ly = Math.min(pos[a + 1], pos[b + 1], pos[c + 1]), hy = Math.max(pos[a + 1], pos[b + 1], pos[c + 1]);
		const lz = Math.min(pos[a + 2], pos[b + 2], pos[c + 2]), hz = Math.max(pos[a + 2], pos[b + 2], pos[c + 2]);
		const x0 = Math.floor((lx - minX) / cell), x1 = Math.floor((hx - minX) / cell);
		const y0 = Math.floor((ly - minY) / cell), y1 = Math.floor((hy - minY) / cell);
		const z0 = Math.floor((lz - minZ) / cell), z1 = Math.floor((hz - minZ) / cell);
		for (let z = z0; z <= z1; z++) {
			for (let y = y0; y <= y1; y++) {
				for (let x = x0; x <= x1; x++) {
					const k = key(x, y, z);
					let list = buckets.get(k);
					if (!list) buckets.set(k, (list = []));
					list.push(t);
				}
			}
		}
	}
	return { minX, minY, minZ, nx, ny, nz, cell, buckets, key };
}

/* ── bind ────────────────────────────────────────────────────────────────── */

/**
 * Precompute how each garment vertex is anchored to the body surface.
 *
 * @param {ArrayLike<number>} bodyRest   body rest positions (xyz triples)
 * @param {ArrayLike<number>} bodyIndex  body triangle indices
 * @param {ArrayLike<number>} garmentRest garment rest positions (xyz triples)
 * @param {object} [opts]
 * @param {number} [opts.reach]   vertices farther than this from the body are not conformed (m)
 * @param {number} [opts.falloff] distance over which the pull fades from full to none (m). Loose
 *                                cloth uses a larger value so it keeps its drape.
 * @returns {{ count: number, tri: Uint32Array, bary: Float32Array, offset: Float32Array,
 *             normal: Float32Array, weight: Float32Array, bound: number }}
 */
export function buildConformBinding(bodyRest, bodyIndex, garmentRest, opts = {}) {
	const reach = opts.reach ?? DEFAULT_REACH;
	const falloff = Math.max(1e-4, opts.falloff ?? DEFAULT_FALLOFF);
	const count = Math.floor(garmentRest.length / 3);
	const binding = {
		count,
		tri: new Uint32Array(count),
		bary: new Float32Array(count * 3),
		offset: new Float32Array(count),
		normal: new Float32Array(count * 3),
		weight: new Float32Array(count),
		bound: 0,
	};
	if (!bodyIndex.length || !count) return binding;

	const cell = 0.01;
	const grid = buildGrid(bodyRest, bodyIndex, cell);
	const triCount = bodyIndex.length / 3;
	const sphere = new Float32Array(triCount * 4);
	for (let t = 0; t < triCount; t++) {
		const a = bodyIndex[t * 3] * 3, b = bodyIndex[t * 3 + 1] * 3, c = bodyIndex[t * 3 + 2] * 3;
		const cx = (bodyRest[a] + bodyRest[b] + bodyRest[c]) / 3;
		const cy = (bodyRest[a + 1] + bodyRest[b + 1] + bodyRest[c + 1]) / 3;
		const cz = (bodyRest[a + 2] + bodyRest[b + 2] + bodyRest[c + 2]) / 3;
		sphere[t * 4] = cx; sphere[t * 4 + 1] = cy; sphere[t * 4 + 2] = cz;
		sphere[t * 4 + 3] = Math.sqrt(Math.max(
			(bodyRest[a] - cx) ** 2 + (bodyRest[a + 1] - cy) ** 2 + (bodyRest[a + 2] - cz) ** 2,
			(bodyRest[b] - cx) ** 2 + (bodyRest[b + 1] - cy) ** 2 + (bodyRest[b + 2] - cz) ** 2,
			(bodyRest[c] - cx) ** 2 + (bodyRest[c + 1] - cy) ** 2 + (bodyRest[c + 2] - cz) ** 2,
		));
	}
	const bary = new Float64Array(3);
	const tmpN = new Float32Array(3);
	const searchRings = Math.max(1, Math.ceil(reach / cell));

	for (let v = 0; v < count; v++) {
		const px = garmentRest[v * 3], py = garmentRest[v * 3 + 1], pz = garmentRest[v * 3 + 2];
		const cx = Math.floor((px - grid.minX) / cell);
		const cy = Math.floor((py - grid.minY) / cell);
		const cz = Math.floor((pz - grid.minZ) / cell);
		let bestD = reach * reach, bestT = -1, bu = 0, bv = 0, bw = 0;
		// Expand square shells around the vertex's cell. Every cell in shell r+1
		// is at least r*cell away, so stop once the best hit beats that bound.
		for (let r = 0; r <= searchRings; r++) {
			if (bestT >= 0 && bestD <= (r - 1) * (r - 1) * cell * cell) break;
			for (let z = cz - r; z <= cz + r; z++) {
				if (z < 0 || z >= grid.nz) continue;
				const zEdge = z === cz - r || z === cz + r;
				for (let y = cy - r; y <= cy + r; y++) {
					if (y < 0 || y >= grid.ny) continue;
					const yEdge = zEdge || y === cy - r || y === cy + r;
					const step = yEdge || r === 0 ? 1 : 2 * r;
					for (let x = cx - r; x <= cx + r; x += step) {
						if (x < 0 || x >= grid.nx) continue;
						const list = grid.buckets.get(grid.key(x, y, z));
						if (!list) continue;
						for (let k = 0; k < list.length; k++) {
							const t = list[k];
							// Bounding-sphere reject before the exact test.
							const sx = px - sphere[t * 4], sy = py - sphere[t * 4 + 1], sz = pz - sphere[t * 4 + 2];
							const lb = Math.sqrt(sx * sx + sy * sy + sz * sz) - sphere[t * 4 + 3];
							if (lb > 0 && lb * lb >= bestD) continue;
							const a = bodyIndex[t * 3] * 3, b = bodyIndex[t * 3 + 1] * 3, c = bodyIndex[t * 3 + 2] * 3;
							const d = closestOnTriangle(
								px, py, pz,
								bodyRest[a], bodyRest[a + 1], bodyRest[a + 2],
								bodyRest[b], bodyRest[b + 1], bodyRest[b + 2],
								bodyRest[c], bodyRest[c + 1], bodyRest[c + 2],
								bary,
							);
							if (d < bestD) {
								bestD = d; bestT = t; bu = bary[0]; bv = bary[1]; bw = bary[2];
							}
						}
					}
				}
			}
		}
		if (bestT < 0) continue;
		const i0 = bodyIndex[bestT * 3], i1 = bodyIndex[bestT * 3 + 1], i2 = bodyIndex[bestT * 3 + 2];
		if (!faceNormal(bodyRest, i0, i1, i2, tmpN, 0)) continue;
		const qx = bu * bodyRest[i0 * 3] + bv * bodyRest[i1 * 3] + bw * bodyRest[i2 * 3];
		const qy = bu * bodyRest[i0 * 3 + 1] + bv * bodyRest[i1 * 3 + 1] + bw * bodyRest[i2 * 3 + 1];
		const qz = bu * bodyRest[i0 * 3 + 2] + bv * bodyRest[i1 * 3 + 2] + bw * bodyRest[i2 * 3 + 2];
		const dist = Math.sqrt(bestD);
		binding.tri[v] = bestT;
		binding.bary[v * 3] = bu; binding.bary[v * 3 + 1] = bv; binding.bary[v * 3 + 2] = bw;
		binding.normal[v * 3] = tmpN[0]; binding.normal[v * 3 + 1] = tmpN[1]; binding.normal[v * 3 + 2] = tmpN[2];
		binding.offset[v] = (px - qx) * tmpN[0] + (py - qy) * tmpN[1] + (pz - qz) * tmpN[2];
		// Full pull while hugging the body, linear fade to none at `falloff`.
		binding.weight[v] = dist <= falloff * 0.25 ? 1 : Math.max(0, 1 - (dist - falloff * 0.25) / (falloff * 0.75));
		if (binding.weight[v] > 0) binding.bound++;
	}
	return binding;
}

const SCRATCH_NORMAL = new Float32Array(3);

/* ── apply ───────────────────────────────────────────────────────────────── */

/**
 * Effective body positions: rest plus the weighted morph targets. Targets are
 * dense Float32Array triples, or `{ indices, values }` for sparse ones. Writes
 * into `out` (length = rest.length) and returns it. Targets with a zero weight
 * cost nothing.
 *
 * @param {ArrayLike<number>} rest
 * @param {Array<Float32Array|{indices: ArrayLike<number>, values: ArrayLike<number>}>} targets
 * @param {ArrayLike<number>} weights
 * @param {Float32Array} out
 */
export function morphedBodyPositions(rest, targets, weights, out) {
	for (let i = 0; i < rest.length; i++) out[i] = rest[i];
	for (let t = 0; t < targets.length; t++) {
		const w = weights[t] || 0;
		if (w === 0) continue;
		const target = targets[t];
		if (!target) continue;
		if (target.indices) {
			const { indices, values } = target;
			for (let k = 0; k < indices.length; k++) {
				const o = indices[k] * 3;
				out[o] += values[k * 3] * w;
				out[o + 1] += values[k * 3 + 1] * w;
				out[o + 2] += values[k * 3 + 2] * w;
			}
		} else {
			for (let i = 0; i < target.length; i++) out[i] += target[i] * w;
		}
	}
	return out;
}

/**
 * Move garment vertices to follow the morphed body.
 *
 * @param {ReturnType<typeof buildConformBinding>} binding
 * @param {ArrayLike<number>} bodyIndex   body triangle indices
 * @param {ArrayLike<number>} bodyRest    body rest positions
 * @param {ArrayLike<number>} bodyMorphed body positions with morphs applied
 * @param {ArrayLike<number>} garmentRest garment rest positions
 * @param {Float32Array} out              receives the conformed positions (same length as garmentRest)
 * @returns {Float32Array} out
 */
export function conformPositions(binding, bodyIndex, bodyRest, bodyMorphed, garmentRest, out) {
	const n = binding.count;
	const normal = SCRATCH_NORMAL;
	for (let v = 0; v < n; v++) {
		const o = v * 3;
		const w = binding.weight[v];
		if (w === 0) {
			out[o] = garmentRest[o]; out[o + 1] = garmentRest[o + 1]; out[o + 2] = garmentRest[o + 2];
			continue;
		}
		const t = binding.tri[v];
		const i0 = bodyIndex[t * 3], i1 = bodyIndex[t * 3 + 1], i2 = bodyIndex[t * 3 + 2];
		const u = binding.bary[o], bv = binding.bary[o + 1], bw = binding.bary[o + 2];
		const a = i0 * 3, b = i1 * 3, c = i2 * 3;
		const dx = u * (bodyMorphed[a] - bodyRest[a]) + bv * (bodyMorphed[b] - bodyRest[b]) + bw * (bodyMorphed[c] - bodyRest[c]);
		const dy = u * (bodyMorphed[a + 1] - bodyRest[a + 1]) + bv * (bodyMorphed[b + 1] - bodyRest[b + 1]) + bw * (bodyMorphed[c + 1] - bodyRest[c + 1]);
		const dz = u * (bodyMorphed[a + 2] - bodyRest[a + 2]) + bv * (bodyMorphed[b + 2] - bodyRest[b + 2]) + bw * (bodyMorphed[c + 2] - bodyRest[c + 2]);
		let mx = dx, my = dy, mz = dz;
		if (faceNormal(bodyMorphed, i0, i1, i2, normal, 0)) {
			const off = binding.offset[v];
			mx += off * (normal[0] - binding.normal[o]);
			my += off * (normal[1] - binding.normal[o + 1]);
			mz += off * (normal[2] - binding.normal[o + 2]);
		}
		out[o] = garmentRest[o] + w * mx;
		out[o + 1] = garmentRest[o + 1] + w * my;
		out[o + 2] = garmentRest[o + 2] + w * mz;
	}
	return out;
}
