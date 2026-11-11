#!/usr/bin/env node
// Export a GLB (URL or local path) to a Minecraft: Bedrock .mcpack, then verify
// the result by unzipping it and parsing every .mcstructure with prismarine-nbt,
// an independent little-endian NBT reader. Same code path as /api/minecraft-export.
//
//   node scripts/minecraft-export.mjs <glb-url-or-path> [--height 64] [--palette all]
//        [--fill solid|shell] [--dither] [--no-levels] [--name dragon] [--out dir]
//
// Prints the grid size, block count, palette used, and the verification result.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { unzipSync, strFromU8 } from 'fflate';
import nbtParser from 'prismarine-nbt';

import { loadMesh, loadMeshFromUrl } from '../api/_lib/print/mesh-io.js';
import { buildBedrockGrid, packageBuild } from '../api/_lib/minecraft/export.js';
import { structureName } from '../api/_lib/minecraft/mcstructure.js';

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		height: { type: 'string', default: '64' },
		palette: { type: 'string', default: 'all' },
		fill: { type: 'string', default: 'solid' },
		dither: { type: 'boolean', default: false },
		'no-levels': { type: 'boolean', default: false },
		name: { type: 'string' },
		out: { type: 'string', default: '.' },
	},
});

const src = positionals[0];
if (!src) {
	console.error('usage: node scripts/minecraft-export.mjs <glb-url-or-path> [--height 64] [--palette all] [--fill solid|shell] [--dither] [--name id] [--out dir]');
	process.exit(2);
}

const t0 = Date.now();
const mesh = /^https?:\/\//.test(src)
	? await loadMeshFromUrl(src, { surface: true })
	: await loadMesh(await readFile(src), { surface: true });
const built = buildBedrockGrid(mesh, {
	height: Number(values.height),
	palette: values.palette,
	fill: values.fill,
	dither: values.dither,
	levels: values['no-levels'] ? 'none' : 'auto',
});
const name = structureName(values.name || src.split('/').pop().replace(/\.glb$/i, ''));
const pack = packageBuild(built, { name, title: values.name || name, sourceUrl: /^https?:/.test(src) ? src : '' });
await mkdir(values.out, { recursive: true });
const file = join(values.out, `${name}.mcpack`);
await writeFile(file, pack.bytes);

// Independent verification.
const files = unzipSync(pack.bytes);
const manifest = JSON.parse(strFromU8(files['manifest.json']));
let parsedBlocks = 0;
const parsedPalette = new Map();
const sizes = [];
for (const [path, bytes] of Object.entries(files)) {
	if (!path.endsWith('.mcstructure')) continue;
	const { parsed } = await nbtParser.parse(Buffer.from(bytes), 'little');
	const s = nbtParser.simplify(parsed);
	sizes.push(`${path.split('/').pop()}=${s.size.join('x')}`);
	const layer = s.structure.block_indices[0];
	if (layer.length !== s.size[0] * s.size[1] * s.size[2]) throw new Error(`${path}: index count does not match size`);
	const pal = s.structure.palette.default.block_palette;
	for (const v of layer) {
		if (v < 0) continue;
		parsedBlocks += 1;
		const n = pal[v].name;
		parsedPalette.set(n, (parsedPalette.get(n) || 0) + 1);
	}
}
const expected = new Map(built.stats.used.map((u) => [u.name, u.count]));
const paletteMatches = expected.size === parsedPalette.size && [...expected].every(([k, v]) => parsedPalette.get(k) === v);

console.log(JSON.stringify({
	file,
	bytes: pack.bytes.length,
	ms: Date.now() - t0,
	triangles: mesh.triangleCount,
	colorSource: built.stats.colorSource,
	brightness: built.stats.brightness,
	dims: built.stats.dims,
	clamped: built.stats.clamped,
	blockCount: built.stats.blockCount,
	surfaceBlocks: built.stats.surfaceBlocks,
	interiorBlocks: built.stats.interiorBlocks,
	distinctBlocks: built.stats.used.length,
	topBlocks: built.stats.used.slice(0, 5).map((u) => `${u.name.replace('minecraft:', '')}:${u.count}`),
	structures: pack.structures.map((s) => s.id),
	function: `/function ${pack.functionName}`,
	verify: {
		manifestName: manifest.header.name,
		structureSizes: sizes,
		parsedBlocks,
		blockCountMatches: parsedBlocks === built.stats.blockCount,
		paletteMatches,
	},
}, null, 2));
if (parsedBlocks !== built.stats.blockCount || !paletteMatches) process.exit(1);
