import { describe, expect, it } from 'vitest';
import nbtParser from 'prismarine-nbt';
import { unzipSync, strFromU8 } from 'fflate';
import sharp from 'sharp';
import { Document, NodeIO } from '@gltf-transform/core';

import { nbt, TAG, writeNbtLE } from '../api/_lib/minecraft/nbt-le.js';
import { BEDROCK_BLOCKS, createMatcher, resolvePalette, rgbToLab, BLOCK_VERSION } from '../api/_lib/minecraft/bedrock-palette.js';
import { voxelizeMesh, planGrid, CELL_STATE } from '../api/_lib/minecraft/voxelize.js';
import { writeMcstructure, tileGrid, buildMcpack, structureName, TILE_XZ } from '../api/_lib/minecraft/mcstructure.js';
import { autoLevels, buildBedrockGrid, packageBuild, previewPayload } from '../api/_lib/minecraft/export.js';
import { loadMesh } from '../api/_lib/print/mesh-io.js';

const parseLE = async (bytes) => (await nbtParser.parse(Buffer.from(bytes), 'little')).parsed;

// Closed axis-aligned box [0,1]^3 as 12 outward triangles.
function boxMesh({ openTop = false, color = [200, 40, 40] } = {}) {
	const p = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1];
	const faces = [
		[0, 2, 1], [0, 3, 2], // z=0
		[4, 5, 6], [4, 6, 7], // z=1
		[0, 1, 5], [0, 5, 4], // y=0
		[0, 4, 7], [0, 7, 3], // x=0
		[1, 2, 6], [1, 6, 5], // x=1
	];
	if (!openTop) faces.push([3, 7, 6], [3, 6, 2]); // y=1
	const colors = new Uint8Array(8 * 3);
	for (let i = 0; i < 8; i += 1) colors.set(color, i * 3);
	return { positions: Float64Array.from(p), indices: Uint32Array.from(faces.flat()), colors, surface: null };
}

describe('little-endian NBT writer', () => {
	it('round-trips through prismarine-nbt with exact types', async () => {
		const bytes = writeNbtLE(
			nbt.compound({
				b: nbt.byte(-3),
				s: nbt.short(1234),
				i: nbt.int(-123456789),
				l: nbt.long(9007199254740993n),
				f: nbt.float(1.5),
				d: nbt.double(Math.PI),
				str: nbt.string('threews:dragon ü'),
				ints: nbt.list(TAG.Int, [1, -1, 70000]),
				nested: nbt.list(TAG.List, [nbt.list(TAG.Int, [5]), nbt.list(TAG.Int, [-1])]),
				comps: nbt.list(TAG.Compound, [nbt.compound({ name: nbt.string('minecraft:stone') })]),
				empty: nbt.list(TAG.Compound, []),
				arr: nbt.intArray([7, 8]),
			}),
		);
		const parsed = await parseLE(bytes);
		const v = parsed.value;
		expect(parsed.type).toBe('compound');
		expect(v.b).toEqual({ type: 'byte', value: -3 });
		expect(v.s).toEqual({ type: 'short', value: 1234 });
		expect(v.i).toEqual({ type: 'int', value: -123456789 });
		expect(v.l.type).toBe('long');
		expect(v.f).toEqual({ type: 'float', value: 1.5 });
		expect(v.d.type).toBe('double');
		expect(v.d.value).toBeCloseTo(Math.PI, 12);
		expect(v.str).toEqual({ type: 'string', value: 'threews:dragon ü' });
		expect(v.ints.value).toEqual({ type: 'int', value: [1, -1, 70000] });
		expect(v.nested.value.type).toBe('list');
		expect(v.nested.value.value.map((l) => l.value)).toEqual([[5], [-1]]);
		expect(v.comps.value.value[0].name.value).toBe('minecraft:stone');
		expect(v.empty.value.value).toEqual([]);
		expect(v.arr).toEqual({ type: 'intArray', value: [7, 8] });
	});

	it('lays numbers out little-endian', () => {
		const bytes = writeNbtLE(nbt.compound({ a: nbt.int(0x01020304) }));
		// compound tag(1) + name len(2) + tag(1) + name len(2) "a"(1) + int(4)
		expect(Array.from(bytes.slice(0, 3))).toEqual([10, 0, 0]);
		expect(Array.from(bytes.slice(3, 6))).toEqual([3, 1, 0]);
		expect(String.fromCharCode(bytes[6])).toBe('a');
		expect(Array.from(bytes.slice(7, 11))).toEqual([4, 3, 2, 1]);
		expect(bytes[11]).toBe(0);
	});
});

describe('.mcstructure', () => {
	it('writes the Bedrock layout an independent parser reads back', async () => {
		const size = [2, 3, 4];
		const indices = Int32Array.from({ length: 24 }, (_, i) => (i % 3 === 0 ? -1 : i % 2));
		const palette = [{ name: 'minecraft:white_concrete' }, { name: 'minecraft:deepslate', states: { pillar_axis: 'y' } }];
		const s = (await parseLE(writeMcstructure({ size, indices, palette }))).value;
		expect(s.format_version).toEqual({ type: 'int', value: 1 });
		expect(s.size.value).toEqual({ type: 'int', value: [2, 3, 4] });
		expect(s.structure_world_origin.value.value).toEqual([0, 0, 0]);
		const layers = s.structure.value.block_indices.value.value;
		expect(layers).toHaveLength(2);
		expect(layers[0].type).toBe('int');
		expect(layers[0].value).toEqual(Array.from(indices));
		expect(layers[1].value.every((v) => v === -1)).toBe(true);
		const bp = s.structure.value.palette.value.default.value.block_palette.value.value;
		expect(bp.map((b) => b.name.value)).toEqual(['minecraft:white_concrete', 'minecraft:deepslate']);
		expect(bp[1].states.value.pillar_axis).toEqual({ type: 'string', value: 'y' });
		expect(bp[0].version).toEqual({ type: 'int', value: BLOCK_VERSION });
	});

	it('sanitizes structure names', () => {
		expect(structureName('Red Dragon #2!')).toBe('red_dragon_2');
		expect(structureName('')).toBe('build');
	});
});

describe('voxelizer', () => {
	it('fills a closed mesh solid and leaves the shell hollow in shell mode', () => {
		const solid = voxelizeMesh(boxMesh(), { height: 16, fill: 'solid' });
		expect(solid.dims).toEqual([16, 16, 16]);
		const filledSolid = solid.state.filter((s) => s === CELL_STATE.SURFACE || s === CELL_STATE.INTERIOR).length;
		expect(filledSolid).toBe(16 ** 3);
		expect(solid.interiorCount).toBe(14 ** 3);

		const shell = voxelizeMesh(boxMesh(), { height: 16, fill: 'shell' });
		const filledShell = shell.state.filter((s) => s === CELL_STATE.SURFACE).length;
		expect(filledShell).toBe(16 ** 3 - 14 ** 3);
		expect(shell.interiorCount).toBe(0);
	});

	it('does not fill through an open side', () => {
		const open = voxelizeMesh(boxMesh({ openTop: true }), { height: 16, fill: 'solid' });
		expect(open.interiorCount).toBe(0);
	});

	it('averages vertex colors into each voxel', () => {
		const g = voxelizeMesh(boxMesh({ color: [10, 120, 230] }), { height: 16, fill: 'solid' });
		expect(Array.from(g.slotRgb.slice(0, 3))).toEqual([10, 120, 230]);
	});

	it('caps wide models horizontally and clamps the height range', () => {
		expect(planGrid([10, 1, 1], 128).dims[0]).toBe(192);
		expect(planGrid([10, 1, 1], 128).clamped).toBe(true);
		expect(planGrid([1, 1, 1], 4).dims).toEqual([16, 16, 16]);
		expect(planGrid([1, 1, 1], 500).dims).toEqual([128, 128, 128]);
	});
});

describe('palette matching', () => {
	it('picks the block whose color it is given', () => {
		const concrete = resolvePalette('concrete');
		const match = createMatcher(concrete);
		const name = (rgb) => concrete[match(...rgb)].name;
		expect(name([207, 213, 214])).toBe('minecraft:white_concrete');
		expect(name([8, 10, 15])).toBe('minecraft:black_concrete');
		expect(name([36, 137, 199])).toBe('minecraft:light_blue_concrete');
		expect(name([0, 0, 0])).toBe('minecraft:black_concrete');
	});

	it('restricts to the chosen palette', () => {
		const wool = resolvePalette('wool');
		expect(wool.every((b) => b.name.endsWith('_wool'))).toBe(true);
		const all = resolvePalette('all');
		expect(all[createMatcher(all)(246, 208, 61)].name).toBe('minecraft:gold_block');
		expect(() => resolvePalette('glass')).toThrow(/unknown palette/);
	});

	it('only lists unique, namespaced block ids', () => {
		const names = BEDROCK_BLOCKS.map((b) => b.name);
		expect(new Set(names).size).toBe(names.length);
		expect(names.every((n) => /^minecraft:[a-z_]+$/.test(n))).toBe(true);
	});

	it('computes CIELAB for the D65 white point', () => {
		const [L, a, b] = rgbToLab(255, 255, 255);
		expect(L).toBeCloseTo(100, 1);
		expect(Math.abs(a)).toBeLessThan(0.01);
		expect(Math.abs(b)).toBeLessThan(0.01);
	});

	it('dithers a between-color into a mix of the two nearest blocks', () => {
		const concrete = resolvePalette('concrete');
		const white = concrete.find((b) => b.name === 'minecraft:white_concrete').rgb;
		const lightGray = concrete.find((b) => b.name === 'minecraft:light_gray_concrete').rgb;
		const mid = white.map((c, i) => Math.round((c + lightGray[i]) / 2));
		const match = createMatcher(concrete, { dither: true });
		const picks = new Set();
		for (let x = 0; x < 4; x += 1) for (let y = 0; y < 4; y += 1) picks.add(concrete[match(...mid, x, y, 0)].name);
		expect(picks).toEqual(new Set(['minecraft:white_concrete', 'minecraft:light_gray_concrete']));
		const plain = createMatcher(concrete);
		expect(new Set(Array.from({ length: 16 }, (_, i) => plain(...mid, i & 3, i >> 2, 0))).size).toBe(1);
	});
});

// A GLB quad textured with a 2x1 image (left red, right blue). Sampling at each
// voxel's surface point must split the quad's voxels by color; sampling only at
// the four vertices would average them all to purple.
async function texturedQuadGlb() {
	const png = await sharp(Buffer.from([142, 33, 33, 255, 45, 47, 143, 255]),{ raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
	const doc = new Document();
	const buffer = doc.createBuffer();
	const pos = doc.createAccessor().setType('VEC3').setBuffer(buffer).setArray(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]));
	const uv = doc.createAccessor().setType('VEC2').setBuffer(buffer).setArray(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]));
	const idx = doc.createAccessor().setType('SCALAR').setBuffer(buffer).setArray(new Uint16Array([0, 1, 2, 0, 2, 3]));
	const tex = doc.createTexture('albedo').setImage(new Uint8Array(png)).setMimeType('image/png');
	const mat = doc.createMaterial('m').setBaseColorTexture(tex);
	const prim = doc.createPrimitive().setAttribute('POSITION', pos).setAttribute('TEXCOORD_0', uv).setIndices(idx).setMaterial(mat);
	doc.createScene().addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(prim)));
	return new NodeIO().writeBinary(doc);
}

describe('auto levels', () => {
	it('brightens a dark albedo in linear light and leaves a bright one alone', () => {
		const dark = Uint8Array.from([20, 20, 20, 40, 30, 25, 10, 10, 10]);
		const gain = autoLevels(dark);
		expect(gain).toBeGreaterThan(1);
		expect(gain).toBeLessThanOrEqual(4);
		// Order and hue survive: the warm color stays warm, the darkest stays darkest.
		expect(dark[3]).toBeGreaterThan(dark[5]);
		expect(dark[6]).toBeLessThan(dark[0]);
		expect(dark[0]).toBeGreaterThan(20);

		const bright = Uint8Array.from([230, 230, 230, 200, 120, 90]);
		const before = Array.from(bright);
		expect(autoLevels(bright)).toBe(1);
		expect(Array.from(bright)).toEqual(before);
	});

	it('turns a near-black knight into gray blocks instead of coal', () => {
		const dark = buildBedrockGrid(boxMesh({ color: [20, 20, 20] }), { height: 16, palette: 'concrete' });
		expect(dark.stats.brightness).toBeGreaterThan(1);
		expect(dark.stats.used[0].name).not.toBe('minecraft:black_concrete');
		const raw = buildBedrockGrid(boxMesh({ color: [20, 20, 20] }), { height: 16, palette: 'concrete', levels: 'none' });
		expect(raw.stats.used[0].name).toBe('minecraft:black_concrete');
		expect(raw.stats.brightness).toBe(1);
	});
});

describe('end to end', () => {
	it('samples the texture at each voxel surface point from a real GLB', async () => {
		const mesh = await loadMesh(await texturedQuadGlb(), { surface: true });
		expect(mesh.surface.textures).toHaveLength(1);
		const built = buildBedrockGrid(mesh, { height: 16, fill: 'shell', palette: 'concrete', levels: 'none' });
		expect(built.stats.colorSource).toBe('texture');
		expect(built.stats.dims).toEqual([16, 16, 1]);
		const [nx, ny, nz] = built.stats.dims;
		const nameAt = (x, y) => built.palette[built.blocks[(x * ny + y) * nz]].name;
		expect(nameAt(2, 8)).toBe('minecraft:red_concrete');
		expect(nameAt(13, 8)).toBe('minecraft:blue_concrete');
		expect(nx).toBe(16);
	});

	it('packages a .mcpack whose structure parses back with the expected size, palette and counts', async () => {
		const built = buildBedrockGrid(boxMesh({ color: [207, 213, 214] }), { height: 20, palette: 'concrete', levels: 'none' });
		expect(built.stats.blockCount).toBe(20 ** 3);
		expect(built.stats.used).toEqual([expect.objectContaining({ name: 'minecraft:white_concrete', count: 8000 })]);
		const preview = previewPayload(built);
		expect(preview.visibleCount).toBe(20 ** 3 - 18 ** 3);

		const pack = packageBuild(built, { name: 'Test Box', title: 'Test box' });
		const files = unzipSync(pack.bytes);
		const manifest = JSON.parse(strFromU8(files['manifest.json']));
		expect(manifest.format_version).toBe(2);
		expect(manifest.header.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		expect(manifest.modules[0].type).toBe('data');
		expect(manifest.header.uuid).not.toBe(manifest.modules[0].uuid);
		expect(strFromU8(files['functions/threews/test_box.mcfunction'])).toContain('structure load threews:test_box ~ ~ ~');

		const s = (await parseLE(files['structures/threews/test_box.mcstructure'])).value;
		expect(s.size.value.value).toEqual([20, 20, 20]);
		const layer0 = s.structure.value.block_indices.value.value[0].value;
		expect(layer0.filter((v) => v === 0)).toHaveLength(8000);
		expect(s.structure.value.palette.value.default.value.block_palette.value.value[0].name.value).toBe('minecraft:white_concrete');
	});

	it('splits builds wider than a structure block into 64-block tiles', () => {
		const dims = [130, 2, 70];
		const blocks = new Int32Array(dims[0] * dims[1] * dims[2]).fill(0);
		const tiles = tileGrid({ dims, blocks }, [{ name: 'minecraft:stone' }]);
		expect(tiles).toHaveLength(6);
		expect(tiles.map((t) => t.size[0])).toEqual([64, 64, 64, 64, 2, 2]);
		expect(tiles.map((t) => t.size[2])).toEqual([64, 6, 64, 6, 64, 6]);
		expect(tiles.reduce((n, t) => n + t.blockCount, 0)).toBe(blocks.length);
		const pack = buildMcpack({ name: 'wide', tiles });
		expect(pack.structures.map((t) => t.id)).toContain(`threews:wide_2_1`);
		const fn = strFromU8(unzipSync(pack.bytes)['functions/threews/wide.mcfunction']);
		expect(fn).toContain(`structure load threews:wide_2_1 ~${2 * TILE_XZ} ~ ~${TILE_XZ}`);
	});
});
