// GLB to Bedrock build: voxelize, palette-match, preview, package.
//
// One entry point the API handler and the CLI share, so a preview the user
// sees and the .mcpack they download come from the same grid and the same
// block choices.

import { createMatcher, resolvePalette } from './bedrock-palette.js';
import { assignBlocks, buildMcpack, tileGrid, TILE_XZ } from './mcstructure.js';
import { voxelizeMesh } from './voxelize.js';

/** Which color input the voxelizer actually used, in the order it prefers them. */
export function colorSourceOf(mesh) {
	const surface = mesh.surface;
	if (surface && surface.textures.length && surface.triTexture.some((t) => t >= 0)) return 'texture';
	if (mesh.vertexColored) return 'vertex';
	return 'material';
}

// Auto levels. Forge albedo textures are often authored dark (metal and
// weathered materials average RGB 20-45) because the viewer's PBR lighting and
// environment map brighten them on screen. Blocks carry no such lighting, so a
// faithful match turns a knight into coal. When the surface's 90th-percentile
// lightness sits below TARGET_L, every color is scaled in linear light so that
// percentile lands on TARGET_L, preserving hue and relative contrast.
const TARGET_L = 70;
const MAX_GAIN = 4;

const toLinear = (c) => {
	const v = c / 255;
	return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const toSrgb8 = (v) => {
	const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
	return Math.max(0, Math.min(255, Math.round(c * 255)));
};

/** Returns the linear-light gain applied (1 when the colors were already bright enough). */
export function autoLevels(slotRgb) {
	const n = slotRgb.length / 3;
	if (!n) return 1;
	const lum = new Float64Array(n);
	for (let s = 0; s < n; s += 1) {
		lum[s] = 0.2126 * toLinear(slotRgb[s * 3]) + 0.7152 * toLinear(slotRgb[s * 3 + 1]) + 0.0722 * toLinear(slotRgb[s * 3 + 2]);
	}
	const sorted = Float64Array.from(lum).sort();
	const p90 = sorted[Math.min(n - 1, Math.floor(n * 0.9))];
	// CIE L* 70 is relative luminance ((70 + 16) / 116)^3.
	const targetY = ((TARGET_L + 16) / 116) ** 3;
	if (p90 >= targetY) return 1;
	const gain = Math.min(MAX_GAIN, targetY / Math.max(p90, 1e-4));
	for (let i = 0; i < slotRgb.length; i += 1) slotRgb[i] = toSrgb8(toLinear(slotRgb[i]) * gain);
	return gain;
}

/**
 * @param {object} mesh from loadMesh(bytes, { surface: true })
 * @param {{height?: number, fill?: 'solid'|'shell', palette?: string|string[], dither?: boolean, levels?: 'auto'|'none', deadline?: number}} opts
 */
export function buildBedrockGrid(mesh, opts = {}) {
	const blocksPalette = resolvePalette(opts.palette || 'all');
	const grid = voxelizeMesh(mesh, { height: opts.height, fill: opts.fill, deadline: opts.deadline });
	const gain = opts.levels === 'none' ? 1 : autoLevels(grid.slotRgb);
	const match = createMatcher(blocksPalette, { dither: Boolean(opts.dither) });
	const blocks = assignBlocks(grid, match);
	const [nx, ny, nz] = grid.dims;

	const counts = new Uint32Array(blocksPalette.length);
	let total = 0;
	for (let c = 0; c < blocks.length; c += 1) {
		if (blocks[c] >= 0) {
			counts[blocks[c]] += 1;
			total += 1;
		}
	}
	const used = blocksPalette
		.map((b, i) => ({ name: b.name, label: b.label, rgb: b.rgb, count: counts[i], index: i }))
		.filter((b) => b.count > 0)
		.sort((a, b) => b.count - a.count);

	return {
		grid,
		blocks,
		palette: blocksPalette,
		stats: {
			dims: grid.dims,
			height: ny,
			requestedHeight: grid.requestedHeight,
			clamped: grid.clamped,
			fill: grid.fill,
			dither: Boolean(opts.dither),
			levels: opts.levels === 'none' ? 'none' : 'auto',
			brightness: Math.round(gain * 100) / 100,
			blockCount: total,
			surfaceBlocks: grid.surfaceCount,
			interiorBlocks: grid.interiorCount,
			tiles: Math.ceil(nx / TILE_XZ) * Math.ceil(nz / TILE_XZ),
			colorSource: colorSourceOf(mesh),
			used,
		},
	};
}

/**
 * Blocks the viewer can see: filled cells with at least one empty (or
 * out-of-grid) face neighbour. Packed as 4 bytes per voxel (x, y, z, palette
 * index into `used`), which is all the preview needs to draw instanced cubes.
 */
export function previewPayload(built) {
	const { blocks } = built;
	const [nx, ny, nz] = built.grid.dims;
	const remap = new Map(built.stats.used.map((u, i) => [u.index, i]));
	const at = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz ? -1 : blocks[(x * ny + y) * nz + z]);
	const out = [];
	for (let x = 0; x < nx; x += 1) {
		for (let y = 0; y < ny; y += 1) {
			for (let z = 0; z < nz; z += 1) {
				const b = blocks[(x * ny + y) * nz + z];
				if (b < 0) continue;
				if (at(x - 1, y, z) >= 0 && at(x + 1, y, z) >= 0 && at(x, y - 1, z) >= 0 && at(x, y + 1, z) >= 0 && at(x, y, z - 1) >= 0 && at(x, y, z + 1) >= 0) continue;
				out.push(x, y, z, remap.get(b));
			}
		}
	}
	return {
		voxels: Buffer.from(Uint8Array.from(out)).toString('base64'),
		visibleCount: out.length / 4,
		palette: built.stats.used.map(({ name, label, rgb, count }) => ({ name, label, rgb, count })),
	};
}

/** Package the build as a .mcpack. */
export function packageBuild(built, { name, title, sourceUrl } = {}) {
	const tiles = tileGrid({ dims: built.grid.dims, blocks: built.blocks }, built.palette);
	return buildMcpack({ name, title, tiles, sourceUrl });
}
