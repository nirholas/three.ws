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

/**
 * @param {object} mesh from loadMesh(bytes, { surface: true })
 * @param {{height?: number, fill?: 'solid'|'shell', palette?: string|string[], dither?: boolean, deadline?: number}} opts
 */
export function buildBedrockGrid(mesh, opts = {}) {
	const blocksPalette = resolvePalette(opts.palette || 'all');
	const grid = voxelizeMesh(mesh, { height: opts.height, fill: opts.fill, deadline: opts.deadline });
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
