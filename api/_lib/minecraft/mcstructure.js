// .mcstructure writer and .mcpack packager for Minecraft: Bedrock Edition.
//
// .mcstructure layout (uncompressed little-endian NBT, root tag named ""):
//   format_version          Int 1
//   size                    List<Int> [x, y, z]
//   structure               Compound
//     block_indices         List<List<Int>>: layer 0 (blocks) and layer 1
//                           (waterlog layer), one int per cell, index
//                           (x * sy + y) * sz + z, -1 for "leave the world as is"
//     entities              List<Compound> (empty)
//     palette.default       Compound
//       block_palette       List<Compound { name, states, version }>
//       block_position_data Compound (block entities; empty)
//   structure_world_origin  List<Int> [0, 0, 0]
//
// A behavior pack ships structures under structures/<namespace>/<name>.mcstructure,
// which the game exposes as `<namespace>:<name>` to structure blocks and the
// /structure command. The pack is a zip with manifest.json at its root, renamed
// .mcpack so Bedrock imports it on double-click.

import { createHash } from 'node:crypto';
import { strToU8, zipSync } from 'fflate';

import { nbt, TAG, writeNbtLE } from './nbt-le.js';
import { BLOCK_VERSION, MIN_ENGINE_VERSION } from './bedrock-palette.js';
import { isFilled } from './voxelize.js';

export const NAMESPACE = 'threews';
// Structure block ceiling from learn.microsoft.com (Introduction to Structure
// Blocks): X 64, Y 257, Z 64. Heights are capped at 128, so only X and Z tile.
export const TILE_XZ = 64;
export const MAX_STRUCTURE_Y = 257;

function stateTag(value) {
	if (typeof value === 'boolean') return nbt.byte(value ? 1 : 0);
	if (typeof value === 'number') return nbt.int(value);
	return nbt.string(value);
}

/**
 * Write one .mcstructure file.
 * @param {{size: [number, number, number], indices: Int32Array|number[], palette: Array<{name: string, states?: object}>}} s
 */
export function writeMcstructure({ size, indices, palette }) {
	const [sx, sy, sz] = size;
	if (indices.length !== sx * sy * sz) {
		throw new Error(`block index count ${indices.length} does not match size ${sx}x${sy}x${sz}`);
	}
	const waterlog = new Int32Array(indices.length).fill(-1);
	const root = nbt.compound({
		format_version: nbt.int(1),
		size: nbt.list(TAG.Int, [sx, sy, sz]),
		structure: nbt.compound({
			block_indices: nbt.list(TAG.List, [nbt.list(TAG.Int, indices), nbt.list(TAG.Int, waterlog)]),
			entities: nbt.list(TAG.Compound, []),
			palette: nbt.compound({
				default: nbt.compound({
					block_palette: nbt.list(
						TAG.Compound,
						palette.map((p) =>
							nbt.compound({
								name: nbt.string(p.name),
								states: nbt.compound(
									Object.fromEntries(Object.entries(p.states || {}).map(([k, v]) => [k, stateTag(v)])),
								),
								version: nbt.int(BLOCK_VERSION),
							}),
						),
					),
					block_position_data: nbt.compound({}),
				}),
			}),
		}),
		structure_world_origin: nbt.list(TAG.Int, [0, 0, 0]),
	});
	return writeNbtLE(root, '');
}

/** Lowercase identifier safe for a structure name and a file name. */
export function structureName(raw) {
	const s = String(raw || '')
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, '_')
		.replace(/^[_-]+|[_-]+$/g, '')
		.slice(0, 32);
	return s || 'build';
}

/**
 * Split a block grid (palette indices per cell, -1 empty) into structure tiles
 * no wider than TILE_XZ. Fully empty tiles are dropped.
 * @param {{dims: number[], blocks: Int32Array}} grid
 */
export function tileGrid({ dims, blocks }, palette) {
	const [nx, ny, nz] = dims;
	const tiles = [];
	for (let ox = 0; ox < nx; ox += TILE_XZ) {
		for (let oz = 0; oz < nz; oz += TILE_XZ) {
			const sx = Math.min(TILE_XZ, nx - ox);
			const sz = Math.min(TILE_XZ, nz - oz);
			const local = new Int32Array(sx * ny * sz);
			const remap = new Map();
			const tilePalette = [];
			let count = 0;
			for (let x = 0; x < sx; x += 1) {
				for (let y = 0; y < ny; y += 1) {
					for (let z = 0; z < sz; z += 1) {
						const b = blocks[((ox + x) * ny + y) * nz + (oz + z)];
						let v = -1;
						if (b >= 0) {
							v = remap.get(b);
							if (v === undefined) {
								v = tilePalette.length;
								remap.set(b, v);
								tilePalette.push(palette[b]);
							}
							count += 1;
						}
						local[(x * ny + y) * sz + z] = v;
					}
				}
			}
			if (count) tiles.push({ offset: [ox, 0, oz], size: [sx, ny, sz], indices: local, palette: tilePalette, blockCount: count });
		}
	}
	return tiles;
}

/** Map a voxel grid to palette indices with a matcher from bedrock-palette.js. */
export function assignBlocks(grid, match) {
	const [nx, ny, nz] = grid.dims;
	const blocks = new Int32Array(nx * ny * nz).fill(-1);
	const slotBlock = new Map();
	for (let x = 0; x < nx; x += 1) {
		for (let y = 0; y < ny; y += 1) {
			for (let z = 0; z < nz; z += 1) {
				const c = (x * ny + y) * nz + z;
				if (!isFilled(grid, c)) continue;
				const s = grid.slot[c];
				const r = grid.slotRgb[s * 3];
				const g = grid.slotRgb[s * 3 + 1];
				const b = grid.slotRgb[s * 3 + 2];
				// Interior cells share a surface slot; dithering them is pointless and
				// keeps the hidden core uniform, so they reuse the slot's undithered pick.
				if (grid.state[c] === 3) {
					let pick = slotBlock.get(s);
					if (pick === undefined) {
						pick = match(r, g, b);
						slotBlock.set(s, pick);
					}
					blocks[c] = pick;
				} else {
					blocks[c] = match(r, g, b, x, y, z);
				}
			}
		}
	}
	return blocks;
}

function uuidFrom(seed) {
	const h = createHash('sha256').update(seed).digest('hex');
	// RFC 4122 layout with version 4 and variant bits set; content-derived so a
	// re-export of identical content keeps its identity and any change gets a new one.
	const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Build a behavior pack (.mcpack bytes) holding the structure tiles plus a
 * function that places every tile at the right offset in one command.
 * @param {{name: string, title?: string, tiles: ReturnType<typeof tileGrid>, sourceUrl?: string}} opts
 */
export function buildMcpack({ name, title, tiles, sourceUrl = '' }) {
	const id = structureName(name);
	if (!tiles.length) throw new Error('nothing to package: the build has no blocks');
	const files = {};
	const single = tiles.length === 1;
	const ids = [];
	const hash = createHash('sha256');
	for (const tile of tiles) {
		const tileId = single ? id : `${id}_${tile.offset[0] / TILE_XZ}_${tile.offset[2] / TILE_XZ}`;
		const bytes = writeMcstructure(tile);
		files[`structures/${NAMESPACE}/${tileId}.mcstructure`] = bytes;
		hash.update(bytes);
		ids.push({ id: `${NAMESPACE}:${tileId}`, offset: tile.offset, size: tile.size, blockCount: tile.blockCount });
	}
	const functionLines = [
		`# Places ${title || id} (${ids.length} structure${ids.length > 1 ? 's' : ''}) with its corner at your feet.`,
		...ids.map((t) => `structure load ${t.id} ~${t.offset[0] || ''} ~ ~${t.offset[2] || ''}`),
	];
	files[`functions/${NAMESPACE}/${id}.mcfunction`] = strToU8(`${functionLines.join('\n')}\n`);

	const digest = hash.digest('hex');
	const manifest = {
		format_version: 2,
		header: {
			name: `${title || id} (three.ws build)`.slice(0, 64),
			description: `Voxel build exported from three.ws${sourceUrl ? `: ${sourceUrl}` : ''}. Load ${ids[0].id} with a structure block, or run /function ${NAMESPACE}/${id}. Not an official Minecraft product.`,
			uuid: uuidFrom(`${digest}:header`),
			version: [1, 0, 0],
			min_engine_version: MIN_ENGINE_VERSION,
		},
		modules: [{ type: 'data', uuid: uuidFrom(`${digest}:data`), version: [1, 0, 0] }],
	};
	files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
	const zip = zipSync(files, { level: 6, mtime: new Date('2026-01-01T00:00:00Z') });
	return { bytes: zip, manifest, structures: ids, functionName: `${NAMESPACE}/${id}` };
}
