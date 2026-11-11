// Bedrock block palette for voxel export, and perceptual nearest-colour match.
//
// Each entry is a fact, not an asset: a Bedrock block identifier plus the
// representative (average) sRGB colour of its face. No texture file is copied
// or shipped. Only solid, full-cube, single-texture blocks are listed, so a
// voxel placed with any of them reads as one flat colour from every side.
// Patterned blocks (glazed terracotta, ores, logs with bark/end faces) are left
// out on purpose: at one voxel per block their pattern reads as noise rather
// than as the colour of the model.
//
// Identifiers use the flattened names Bedrock adopted through 1.21 (one id per
// colour or variant instead of a `color` / `stone_type` state), so `states` is
// empty for nearly every entry. BLOCK_VERSION is the block-state version the
// palette was authored against; the game upgrades older versions on load, and
// MIN_ENGINE_VERSION in the pack manifest keeps the pack off clients older
// than the names it uses.

// 1.21.60.33 packed as (major<<24)|(minor<<16)|(patch<<8)|revision.
export const BLOCK_VERSION = (1 << 24) | (21 << 16) | (60 << 8) | 33;
export const MIN_ENGINE_VERSION = [1, 21, 60];

const COLORS16 = [
	'white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
	'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black',
];

const CONCRETE_RGB = [
	[207, 213, 214], [224, 97, 1], [169, 48, 159], [36, 137, 199], [241, 175, 21], [94, 169, 24],
	[214, 101, 143], [55, 58, 62], [125, 125, 115], [21, 119, 136], [100, 32, 156], [45, 47, 143],
	[96, 60, 32], [73, 91, 36], [142, 33, 33], [8, 10, 15],
];
const WOOL_RGB = [
	[234, 236, 237], [241, 118, 20], [190, 69, 180], [58, 175, 217], [249, 198, 40], [112, 185, 26],
	[238, 141, 172], [63, 68, 72], [142, 142, 135], [21, 138, 145], [122, 42, 173], [53, 57, 157],
	[114, 72, 41], [85, 110, 28], [161, 39, 35], [21, 21, 26],
];
const TERRACOTTA_RGB = [
	[210, 178, 161], [162, 84, 38], [150, 88, 109], [113, 109, 138], [186, 133, 35], [104, 118, 53],
	[162, 78, 79], [58, 42, 36], [135, 107, 98], [87, 91, 91], [118, 70, 86], [74, 60, 91],
	[77, 51, 36], [76, 83, 42], [143, 61, 47], [37, 23, 17],
];

const entry = (group, id, rgb, label, states = {}) => ({ group, name: `minecraft:${id}`, rgb, label, states });
const titleCase = (s) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const BEDROCK_BLOCKS = Object.freeze([
	...COLORS16.map((c, i) => entry('concrete', `${c}_concrete`, CONCRETE_RGB[i], `${titleCase(c)} Concrete`)),
	...COLORS16.map((c, i) => entry('wool', `${c}_wool`, WOOL_RGB[i], `${titleCase(c)} Wool`)),
	entry('terracotta', 'hardened_clay', [152, 94, 68], 'Terracotta'),
	...COLORS16.map((c, i) => entry('terracotta', `${c}_terracotta`, TERRACOTTA_RGB[i], `${titleCase(c)} Terracotta`)),
	entry('planks', 'oak_planks', [162, 131, 79], 'Oak Planks'),
	entry('planks', 'spruce_planks', [115, 85, 49], 'Spruce Planks'),
	entry('planks', 'birch_planks', [192, 175, 121], 'Birch Planks'),
	entry('planks', 'jungle_planks', [160, 115, 81], 'Jungle Planks'),
	entry('planks', 'acacia_planks', [168, 90, 50], 'Acacia Planks'),
	entry('planks', 'dark_oak_planks', [67, 43, 20], 'Dark Oak Planks'),
	entry('planks', 'mangrove_planks', [117, 54, 48], 'Mangrove Planks'),
	entry('planks', 'cherry_planks', [226, 178, 172], 'Cherry Planks'),
	entry('planks', 'bamboo_planks', [194, 173, 80], 'Bamboo Planks'),
	entry('planks', 'crimson_planks', [101, 49, 71], 'Crimson Planks'),
	entry('planks', 'warped_planks', [43, 105, 99], 'Warped Planks'),
	entry('stone', 'stone', [126, 126, 126], 'Stone'),
	entry('stone', 'cobblestone', [128, 127, 128], 'Cobblestone'),
	entry('stone', 'smooth_stone', [159, 159, 159], 'Smooth Stone'),
	entry('stone', 'stone_bricks', [122, 121, 122], 'Stone Bricks'),
	entry('stone', 'granite', [149, 103, 86], 'Granite'),
	entry('stone', 'polished_granite', [154, 107, 89], 'Polished Granite'),
	entry('stone', 'diorite', [189, 188, 189], 'Diorite'),
	entry('stone', 'polished_diorite', [193, 193, 195], 'Polished Diorite'),
	entry('stone', 'andesite', [136, 136, 137], 'Andesite'),
	entry('stone', 'polished_andesite', [132, 135, 134], 'Polished Andesite'),
	entry('stone', 'deepslate', [80, 80, 82], 'Deepslate', { pillar_axis: 'y' }),
	entry('stone', 'cobbled_deepslate', [77, 77, 81], 'Cobbled Deepslate'),
	entry('stone', 'deepslate_bricks', [70, 70, 71], 'Deepslate Bricks'),
	entry('stone', 'tuff', [108, 109, 103], 'Tuff'),
	entry('stone', 'calcite', [223, 224, 220], 'Calcite'),
	entry('stone', 'blackstone', [42, 36, 41], 'Blackstone'),
	entry('stone', 'polished_blackstone', [53, 49, 57], 'Polished Blackstone'),
	entry('stone', 'brick_block', [151, 98, 83], 'Bricks'),
	entry('stone', 'mud_bricks', [137, 103, 79], 'Mud Bricks'),
	entry('stone', 'packed_mud', [142, 106, 79], 'Packed Mud'),
	entry('stone', 'dripstone_block', [134, 107, 92], 'Dripstone Block'),
	entry('stone', 'nether_brick', [44, 21, 26], 'Nether Bricks'),
	entry('stone', 'red_nether_brick', [69, 7, 9], 'Red Nether Bricks'),
	entry('stone', 'end_stone', [219, 222, 158], 'End Stone'),
	entry('stone', 'netherrack', [97, 38, 38], 'Netherrack'),
	entry('stone', 'obsidian', [15, 10, 24], 'Obsidian'),
	entry('mineral', 'gold_block', [246, 208, 61], 'Block of Gold'),
	entry('mineral', 'iron_block', [220, 220, 220], 'Block of Iron'),
	entry('mineral', 'diamond_block', [98, 237, 228], 'Block of Diamond'),
	entry('mineral', 'emerald_block', [42, 203, 87], 'Block of Emerald'),
	entry('mineral', 'lapis_block', [30, 67, 140], 'Block of Lapis Lazuli'),
	entry('mineral', 'redstone_block', [175, 24, 5], 'Block of Redstone'),
	entry('mineral', 'coal_block', [16, 15, 15], 'Block of Coal'),
	entry('mineral', 'copper_block', [192, 107, 79], 'Block of Copper'),
	entry('mineral', 'amethyst_block', [133, 97, 191], 'Block of Amethyst'),
	entry('mineral', 'raw_iron_block', [166, 135, 107], 'Block of Raw Iron'),
	entry('mineral', 'raw_gold_block', [221, 169, 46], 'Block of Raw Gold'),
	entry('mineral', 'raw_copper_block', [154, 105, 79], 'Block of Raw Copper'),
	entry('mineral', 'honeycomb_block', [229, 148, 29], 'Honeycomb Block'),
	entry('mineral', 'moss_block', [89, 109, 45], 'Moss Block'),
	entry('mineral', 'snow', [249, 254, 254], 'Snow Block'),
	entry('mineral', 'clay', [160, 166, 179], 'Clay'),
]);

// User-facing palette presets. Each resolves to a set of groups.
export const PALETTE_PRESETS = Object.freeze({
	all: { label: 'All solid blocks', groups: ['concrete', 'wool', 'terracotta', 'planks', 'stone', 'mineral'] },
	concrete: { label: 'Concrete only', groups: ['concrete'] },
	wool: { label: 'Wool only', groups: ['wool'] },
	terracotta: { label: 'Terracotta only', groups: ['terracotta'] },
	builder: { label: 'Builder (planks and stone)', groups: ['planks', 'stone'] },
	colorful: { label: 'Concrete, wool and terracotta', groups: ['concrete', 'wool', 'terracotta'] },
});

export class PaletteError extends Error {
	constructor(message) {
		super(message);
		this.name = 'PaletteError';
		this.code = 'invalid_palette';
	}
}

/** Resolve a preset name (or an array of group names) to palette entries. */
export function resolvePalette(choice = 'all') {
	let groups;
	if (Array.isArray(choice)) groups = choice;
	else if (PALETTE_PRESETS[choice]) groups = PALETTE_PRESETS[choice].groups;
	else throw new PaletteError(`unknown palette "${choice}"; use one of ${Object.keys(PALETTE_PRESETS).join(', ')}`);
	const set = new Set(groups);
	const blocks = BEDROCK_BLOCKS.filter((b) => set.has(b.group));
	if (!blocks.length) throw new PaletteError('the chosen palette contains no blocks');
	return blocks;
}

// ---- CIELAB (D65) ---------------------------------------------------------

function srgbToLinear(c) {
	const v = c / 255;
	return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
const labF = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);

/** sRGB 0-255 triple to CIELAB [L, a, b] under the D65 white point. */
export function rgbToLab(r, g, b) {
	const R = srgbToLinear(r);
	const G = srgbToLinear(g);
	const B = srgbToLinear(b);
	const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
	const y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
	const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
	const fx = labF(x);
	const fy = labF(y);
	const fz = labF(z);
	return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// Ordered-dither thresholds from a 4x4 Bayer matrix, indexed by (y + z, x + 3z)
// so that every axis-aligned face (top, and walls facing X or Z) sees the full
// 2D pattern rather than a stripe.
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export function bayer3(x, y, z) {
	return (BAYER4[(((y + z) & 3) << 2) | ((x + 3 * z) & 3)] + 0.5) / 16;
}

/**
 * Build a matcher over a palette. `match(r, g, b, x, y, z)` returns the index
 * of the chosen palette entry. With `dither`, a colour that sits between two
 * blocks picks the second-nearest in proportion to how close it is, laid out
 * on a 3D ordered pattern, so a gradient becomes a stable mix of two blocks
 * instead of a hard band. Results are memoized per quantized colour.
 */
export function createMatcher(blocks, { dither = false } = {}) {
	const labs = blocks.map((b) => rgbToLab(b.rgb[0], b.rgb[1], b.rgb[2]));
	const cache = new Map();
	function nearestTwo(r, g, b) {
		const key = (r << 16) | (g << 8) | b;
		const hit = cache.get(key);
		if (hit) return hit;
		const [L, A, B] = rgbToLab(r, g, b);
		let i1 = 0;
		let d1 = Infinity;
		let i2 = 0;
		let d2 = Infinity;
		for (let i = 0; i < labs.length; i += 1) {
			const dl = labs[i][0] - L;
			const da = labs[i][1] - A;
			const db = labs[i][2] - B;
			const d = dl * dl + da * da + db * db;
			if (d < d1) {
				i2 = i1;
				d2 = d1;
				i1 = i;
				d1 = d;
			} else if (d < d2) {
				i2 = i;
				d2 = d;
			}
		}
		const out = [i1, Math.sqrt(d1), i2, Math.sqrt(d2)];
		if (cache.size < 1 << 16) cache.set(key, out);
		return out;
	}
	return function match(r, g, b, x = 0, y = 0, z = 0) {
		const [i1, d1, i2, d2] = nearestTwo(r, g, b);
		if (!dither || i1 === i2 || !Number.isFinite(d2)) return i1;
		const t = d1 / (d1 + d2 || 1); // 0 (exact match) .. 0.5 (exactly between)
		return bayer3(x, y, z) < t ? i2 : i1;
	};
}
