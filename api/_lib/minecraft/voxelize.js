// Mesh to colored voxel grid, sized in Minecraft blocks.
//
// Input is the triangle soup api/_lib/print/mesh-io.js produces (world-space
// positions, indices, per-vertex sRGB color, and, when loaded with
// `surface: true`, per-vertex UV + tint and a per-triangle texture). Output is
// a dense grid in Bedrock's own .mcstructure cell order, index
// (x * ny + y) * nz + z with Z fastest, so the writer can hand the array to the
// file without re-ordering.
//
// Surface: every triangle is sampled on a barycentric lattice with spacing at
// most half a voxel, so no point of the surface is further than half a voxel
// from a sample and the marked shell is 26-connected. Each sample takes its
// color from the base-color texture at its own interpolated UV (times the
// material and vertex tint), so a voxel's color is the average of the texels
// that actually fall inside it, not of whichever vertices happen to be nearby.
//
// Interior: a 6-connected flood fill from the grid border marks everything
// reachable as outside. A 26-connected shell cannot be crossed by a
// 6-connected walk, so a closed mesh fills solid; a mesh with a hole wider
// than a voxel stays a shell there instead of growing a tunnel, which is the
// failure ray parity has on AI-generated meshes (see print/voxel-sdf.js).
// Interior cells copy the color of the nearest surface cell in their column,
// so breaking into the build reveals a plausible color, not a filler block.

export const MIN_HEIGHT = 16;
export const MAX_HEIGHT = 128;
// Horizontal ceiling, in blocks. Bedrock's structure block holds 64 x 257 x 64
// (learn.microsoft.com, Introduction to Structure Blocks), so wider builds are
// split into 64x64 tiles by the pack writer; this cap bounds the tile count
// (3 x 3) and the grid memory (128 x 192 x 192 = 4.7M cells).
export const MAX_HORIZONTAL = 192;
// Sample ceiling across all triangles; about two seconds of work.
export const MAX_SAMPLES = 40_000_000;

const EMPTY = 0;
const SURFACE = 1;
const OUTSIDE = 2;
const INTERIOR = 3;

export class VoxelizeError extends Error {
	constructor(code, message) {
		super(message);
		this.name = 'VoxelizeError';
		this.code = code;
	}
}

function bounds(positions) {
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < positions.length; i += 3) {
		for (let a = 0; a < 3; a += 1) {
			const v = positions[i + a];
			if (v < min[a]) min[a] = v;
			if (v > max[a]) max[a] = v;
		}
	}
	return { min, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

/** Pick the blocks-per-meter scale and the grid dimensions for a target height. */
export function planGrid(size, height, maxHorizontal = MAX_HORIZONTAL) {
	const h = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Number(height) || 64)));
	const longestH = Math.max(size[0], size[2]);
	let scale = size[1] > 1e-9 ? h / size[1] : longestH > 1e-9 ? h / longestH : 1;
	let clamped = false;
	if (longestH * scale > maxHorizontal) {
		scale = maxHorizontal / longestH;
		clamped = true;
	}
	const dim = (s) => Math.max(1, Math.ceil(s * scale - 1e-6));
	return { scale, dims: [dim(size[0]), dim(size[1]), dim(size[2])], requestedHeight: h, clamped };
}

/**
 * @param {{positions: ArrayLike<number>, indices: ArrayLike<number>, colors?: Uint8Array|null,
 *          surface?: {uvs: Float32Array, tints: Uint8Array, triTexture: Int32Array, textures: Array<{data, width, height, channels}>}|null}} mesh
 * @param {{height?: number, fill?: 'solid'|'shell', deadline?: number, maxHorizontal?: number}} [opts]
 */
export function voxelizeMesh(mesh, opts = {}) {
	const { positions, indices } = mesh;
	if (!positions?.length || !indices || indices.length < 3) {
		throw new VoxelizeError('no_geometry', 'the model has no triangles to voxelize');
	}
	const fill = opts.fill === 'shell' ? 'shell' : 'solid';
	const deadline = opts.deadline ?? Infinity;
	const { min, size } = bounds(positions);
	const plan = planGrid(size, opts.height, opts.maxHorizontal);
	const [nx, ny, nz] = plan.dims;
	const { scale } = plan;
	const cells = nx * ny * nz;
	const cellOf = (x, y, z) => (x * ny + y) * nz + z;

	const colors = mesh.colors || null;
	const surface = mesh.surface || null;
	const textures = surface?.textures || [];

	const state = new Uint8Array(cells);
	// Per-cell slot into the color accumulators; -1 until the cell is first hit.
	const slot = new Int32Array(cells).fill(-1);
	let sums = new Float64Array(1 << 16);
	let counts = new Uint32Array(1 << 14);
	let slots = 0;

	const vx = new Float64Array(3);
	const vy = new Float64Array(3);
	const vz = new Float64Array(3);
	let samples = 0;
	const triCount = Math.floor(indices.length / 3);

	for (let t = 0; t < triCount; t += 1) {
		if ((t & 4095) === 0 && Date.now() > deadline) {
			throw new VoxelizeError('timeout', 'voxelizing took too long; choose a smaller height');
		}
		const ia = indices[t * 3];
		const ib = indices[t * 3 + 1];
		const ic = indices[t * 3 + 2];
		const tri = [ia, ib, ic];
		for (let k = 0; k < 3; k += 1) {
			const v = tri[k] * 3;
			vx[k] = (positions[v] - min[0]) * scale;
			vy[k] = (positions[v + 1] - min[1]) * scale;
			vz[k] = (positions[v + 2] - min[2]) * scale;
		}
		const e = Math.max(
			Math.hypot(vx[1] - vx[0], vy[1] - vy[0], vz[1] - vz[0]),
			Math.hypot(vx[2] - vx[1], vy[2] - vy[1], vz[2] - vz[1]),
			Math.hypot(vx[0] - vx[2], vy[0] - vy[2], vz[0] - vz[2]),
		);
		const n = Math.max(1, Math.ceil(e / 0.5));
		samples += ((n + 1) * (n + 2)) / 2;
		if (samples > MAX_SAMPLES) {
			throw new VoxelizeError('too_complex', 'the model needs too many surface samples at this height; choose a smaller height');
		}
		const texIdx = surface ? surface.triTexture[t] : -1;
		const img = texIdx >= 0 ? textures[texIdx] : null;

		for (let i = 0; i <= n; i += 1) {
			for (let j = 0; j <= n - i; j += 1) {
				const w1 = i / n;
				const w2 = j / n;
				const w0 = 1 - w1 - w2;
				const px = w0 * vx[0] + w1 * vx[1] + w2 * vx[2];
				const py = w0 * vy[0] + w1 * vy[1] + w2 * vy[2];
				const pz = w0 * vz[0] + w1 * vz[1] + w2 * vz[2];
				const cx = Math.min(nx - 1, Math.max(0, Math.floor(px)));
				const cy = Math.min(ny - 1, Math.max(0, Math.floor(py)));
				const cz = Math.min(nz - 1, Math.max(0, Math.floor(pz)));
				const c = cellOf(cx, cy, cz);
				state[c] = SURFACE;

				let r = 200;
				let g = 200;
				let b = 200;
				if (img) {
					const u = w0 * surface.uvs[ia * 2] + w1 * surface.uvs[ib * 2] + w2 * surface.uvs[ic * 2];
					const v = w0 * surface.uvs[ia * 2 + 1] + w1 * surface.uvs[ib * 2 + 1] + w2 * surface.uvs[ic * 2 + 1];
					const fu = u - Math.floor(u);
					const fv = v - Math.floor(v);
					const tx = Math.min(img.width - 1, Math.floor(fu * img.width));
					const ty = Math.min(img.height - 1, Math.floor(fv * img.height));
					const ti = (ty * img.width + tx) * img.channels;
					const tints = surface.tints;
					r = img.data[ti] * ((w0 * tints[ia * 3] + w1 * tints[ib * 3] + w2 * tints[ic * 3]) / 255);
					g = img.data[ti + 1] * ((w0 * tints[ia * 3 + 1] + w1 * tints[ib * 3 + 1] + w2 * tints[ic * 3 + 1]) / 255);
					b = img.data[ti + 2] * ((w0 * tints[ia * 3 + 2] + w1 * tints[ib * 3 + 2] + w2 * tints[ic * 3 + 2]) / 255);
				} else if (colors) {
					r = w0 * colors[ia * 3] + w1 * colors[ib * 3] + w2 * colors[ic * 3];
					g = w0 * colors[ia * 3 + 1] + w1 * colors[ib * 3 + 1] + w2 * colors[ic * 3 + 1];
					b = w0 * colors[ia * 3 + 2] + w1 * colors[ib * 3 + 2] + w2 * colors[ic * 3 + 2];
				}

				let s = slot[c];
				if (s < 0) {
					s = slots;
					slots += 1;
					slot[c] = s;
					if (s >= counts.length) {
						const nc = new Uint32Array(counts.length * 2);
						nc.set(counts);
						counts = nc;
						const ns = new Float64Array(sums.length * 2);
						ns.set(sums);
						sums = ns;
					}
				}
				sums[s * 3] += r;
				sums[s * 3 + 1] += g;
				sums[s * 3 + 2] += b;
				counts[s] += 1;
			}
		}
	}

	const slotRgb = new Uint8Array(slots * 3);
	for (let s = 0; s < slots; s += 1) {
		const k = counts[s] || 1;
		slotRgb[s * 3] = Math.round(sums[s * 3] / k);
		slotRgb[s * 3 + 1] = Math.round(sums[s * 3 + 1] / k);
		slotRgb[s * 3 + 2] = Math.round(sums[s * 3 + 2] / k);
	}

	let interiorCount = 0;
	if (fill === 'solid') {
		// Outside flood fill from every empty border cell.
		const stack = new Int32Array(cells);
		let top = 0;
		const seed = (x, y, z) => {
			const c = cellOf(x, y, z);
			if (state[c] === EMPTY) {
				state[c] = OUTSIDE;
				stack[top++] = c;
			}
		};
		for (let x = 0; x < nx; x += 1) {
			for (let y = 0; y < ny; y += 1) {
				seed(x, y, 0);
				seed(x, y, nz - 1);
			}
			for (let z = 0; z < nz; z += 1) {
				seed(x, 0, z);
				seed(x, ny - 1, z);
			}
		}
		for (let y = 0; y < ny; y += 1) {
			for (let z = 0; z < nz; z += 1) {
				seed(0, y, z);
				seed(nx - 1, y, z);
			}
		}
		const strideX = ny * nz;
		while (top > 0) {
			const c = stack[--top];
			const z = c % nz;
			const y = Math.floor(c / nz) % ny;
			const x = Math.floor(c / strideX);
			if (x > 0 && state[c - strideX] === EMPTY) { state[c - strideX] = OUTSIDE; stack[top++] = c - strideX; }
			if (x < nx - 1 && state[c + strideX] === EMPTY) { state[c + strideX] = OUTSIDE; stack[top++] = c + strideX; }
			if (y > 0 && state[c - nz] === EMPTY) { state[c - nz] = OUTSIDE; stack[top++] = c - nz; }
			if (y < ny - 1 && state[c + nz] === EMPTY) { state[c + nz] = OUTSIDE; stack[top++] = c + nz; }
			if (z > 0 && state[c - 1] === EMPTY) { state[c - 1] = OUTSIDE; stack[top++] = c - 1; }
			if (z < nz - 1 && state[c + 1] === EMPTY) { state[c + 1] = OUTSIDE; stack[top++] = c + 1; }
		}
		if (Date.now() > deadline) throw new VoxelizeError('timeout', 'voxelizing took too long; choose a smaller height');

		// Interior cells take the nearest surface color in their column: the one
		// above, or below when the column has no surface above the cell.
		for (let x = 0; x < nx; x += 1) {
			for (let z = 0; z < nz; z += 1) {
				let last = -1;
				for (let y = ny - 1; y >= 0; y -= 1) {
					const c = cellOf(x, y, z);
					if (state[c] === SURFACE) last = slot[c];
					else if (state[c] === EMPTY) {
						state[c] = INTERIOR;
						slot[c] = last;
						interiorCount += 1;
					}
				}
				let below = -1;
				for (let y = 0; y < ny; y += 1) {
					const c = cellOf(x, y, z);
					if (state[c] === SURFACE) below = slot[c];
					else if (state[c] === INTERIOR && slot[c] < 0) slot[c] = below;
				}
			}
		}
	}

	return {
		dims: plan.dims,
		scale,
		requestedHeight: plan.requestedHeight,
		clamped: plan.clamped,
		fill,
		state,
		slot,
		slotRgb,
		surfaceCount: slots,
		interiorCount,
		samples,
	};
}

/** True when a cell holds a block (surface or interior). */
export function isFilled(grid, c) {
	return (grid.state[c] === SURFACE || grid.state[c] === INTERIOR) && grid.slot[c] >= 0;
}

export const CELL_STATE = Object.freeze({ EMPTY, SURFACE, OUTSIDE, INTERIOR });
