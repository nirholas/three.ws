// The seeded world biomes for /play, as plain data.
//
// Split out of world-env.js so code that only needs to NAME or COLOUR a coin's
// world (the /api/play-og share card, the lobby) can resolve the exact biome a
// mint renders in without importing three.js. world-env.js re-exports all of
// it and stays the one place that builds a world from these entries.
//
// The order of BIOMES is load-bearing: biomeForSeed() picks by index, so
// reordering or inserting an entry silently moves existing coins to a
// different world. Append only; curated looks go in CURATED_BIOMES.

// FNV-1a hash → a stable 32-bit seed from a coin mint (or any string). Identical
// input always yields the identical world; no Math.random in the layout path.

export function seedFromString(str) {
	let h = 2166136261 >>> 0;
	const s = String(str || 'three-ws');
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

// --- Biome archetypes ------------------------------------------------------
// Each entry is a complete mood: graded sky, atmospheric fog, a key/fill light
// rig, ground + plaza + accent palette, and which flora the band outside the
// arena is planted with. The mint's seed picks one of these, then a per-coin
// hue jitter (below) shifts it so two coins in the same biome still read apart.
export const BIOMES = [
	{
		id: 'meadow', label: 'Verdant Meadow',
		sky: ['#2f6fd0', '#7fb4ec', '#eaf2ff'], fog: '#cfe0f4', fogNear: 90, fogFar: 340,
		hemi: [0xbfd8ff, 0x4a6b3a, 0.75], ambient: 0.25,
		sun: { color: 0xfff2d0, intensity: 2.1, elevation: 48, azimuth: 135 },
		ground: 0x4f9d5b, plaza: 0xcdb892, grid: 0x8f7f5e, ring: 0x4ea8ff,
		hill: 0x6f9f86, trunk: 0x6b4a2f, leafA: 0x3f8a49, leafB: 0x57ab60,
		flora: 'conifer', density: 46,
	},
	{
		id: 'desert', label: 'Dune Sea',
		sky: ['#3b7bc4', '#c9a86a', '#f6e6c4'], fog: '#ead8b0', fogNear: 80, fogFar: 320,
		hemi: [0xffe7bf, 0xb98a4a, 0.85], ambient: 0.3,
		sun: { color: 0xffe1a8, intensity: 2.4, elevation: 58, azimuth: 110 },
		ground: 0xd9b878, plaza: 0xc9a25e, grid: 0xa07c44, ring: 0xff9a3c,
		hill: 0xcaa569, trunk: 0x3f7a44, leafA: 0x4f9a52, leafB: 0x5fae5a,
		flora: 'cactus', density: 26,
	},
	{
		id: 'tundra', label: 'Frostfields',
		sky: ['#5b7fb0', '#bcd3ea', '#f2f7fb'], fog: '#dfeaf4', fogNear: 70, fogFar: 300,
		hemi: [0xdfeeff, 0x9fb0c2, 0.8], ambient: 0.35,
		sun: { color: 0xeaf2ff, intensity: 1.9, elevation: 32, azimuth: 150 },
		ground: 0xe7eef5, plaza: 0xcfd9e2, grid: 0x9fb0bf, ring: 0x7fd4ff,
		hill: 0xc9d6e2, trunk: 0x4a3f33, leafA: 0xdfe9f2, leafB: 0xcdd9e6,
		flora: 'snowpine', density: 40,
	},
	{
		id: 'volcanic', label: 'Ashen Caldera',
		sky: ['#3a1f2a', '#7a3322', '#d65a2e'], fog: '#5a2a22', fogNear: 60, fogFar: 280,
		hemi: [0xff8a5a, 0x2a1410, 0.55], ambient: 0.22,
		sun: { color: 0xff7a3a, intensity: 1.7, elevation: 22, azimuth: 200 },
		ground: 0x2a2424, plaza: 0x3a2e2c, grid: 0x6a3a2a, ring: 0xff5a2a,
		hill: 0x352828, trunk: 0x241c18, leafA: 0x140e0c, leafB: 0x1c1410,
		flora: 'deadtree', density: 34,
	},
	{
		id: 'alien', label: 'Neon Expanse',
		sky: ['#1a0f3a', '#5a2a8a', '#c25ad6'], fog: '#3a1f6a', fogNear: 70, fogFar: 320,
		hemi: [0xc59aff, 0x2a1a5a, 0.7], ambient: 0.28,
		sun: { color: 0xc8a0ff, intensity: 1.8, elevation: 40, azimuth: 160 },
		ground: 0x3a2a6a, plaza: 0x2e2456, grid: 0x6a4ab0, ring: 0x2af0e0,
		hill: 0x4a3a8a, trunk: 0x6a4ab0, leafA: 0x2af0e0, leafB: 0xff5ad0,
		flora: 'crystal', density: 30,
	},
	{
		id: 'tropical', label: 'Lagoon Shore',
		sky: ['#1f9fd0', '#7fdce8', '#eafbff'], fog: '#cdeef4', fogNear: 90, fogFar: 340,
		hemi: [0xcdf4ff, 0x3a8a7a, 0.8], ambient: 0.3,
		sun: { color: 0xfff4d8, intensity: 2.2, elevation: 52, azimuth: 120 },
		ground: 0x2fb89a, plaza: 0xe6d8a8, grid: 0xb8a878, ring: 0x2ad0ff,
		hill: 0x3fae9a, trunk: 0x7a5a36, leafA: 0x3f9a54, leafB: 0x5fbf66,
		flora: 'palm', density: 30,
	},
	{
		// Old-west frontier town, a dusty main square ringed by false-front
		// storefronts under a low golden-hour sun that throws the long shadows of
		// every porch post and water tower across the packed-dirt plaza. `town`
		// flags the storefront/prop builder below; sagebrush + the odd saguaro
		// dress the mesa band beyond.
		id: 'frontier', label: 'Dust Gulch',
		sky: ['#6b78a2', '#d6b483', '#f5e6c0'], fog: '#e9d6aa', fogNear: 72, fogFar: 300,
		hemi: [0xffe9c2, 0xa9824c, 0.82], ambient: 0.32,
		sun: { color: 0xffce86, intensity: 2.35, elevation: 17, azimuth: 252 },
		ground: 0xc9a974, plaza: 0xb6985e, grid: 0x8a6f42, ring: 0xd98a38,
		hill: 0xc09a60, trunk: 0x6a4a2e, leafA: 0x7d8a4c, leafB: 0x97a560,
		flora: 'sagebrush', density: 18, town: 'frontier',
	},
];

// Curated biomes reachable ONLY by explicit id (biomeById), never by the seed
// modulo, so adding one here can't shift which biome an existing coin's mint maps
// to. `noir` is a neutral, near-monochrome dark world tuned to match an embedding
// host's dark UI: its sky and ground sit on the same #1c2530→#0c1116 ramp the
// three.ws 3D viewer stages use, so a /play embed reads as part of that surface
// instead of a clashing sunlit biome. Pinned via ?biome=noir.
export const CURATED_BIOMES = [
	{
		id: 'noir', label: 'Midnight',
		sky: ['#1c2530', '#141b24', '#0c1116'], fog: '#0c1116', fogNear: 80, fogFar: 320,
		hemi: [0x2a3645, 0x0c1116, 0.6], ambient: 0.3,
		sun: { color: 0xbcd0ff, intensity: 1.25, elevation: 52, azimuth: 135 },
		ground: 0x141a22, plaza: 0x1c2530, grid: 0x2f3d4e, ring: 0x4ea8ff,
		hill: 0x141b24, trunk: 0x2a3645, leafA: 0x223044, leafB: 0x2c3c52,
		flora: 'conifer', density: 12,
	},
	{
		// Robinhood Chain worlds. A trading-floor-at-night mood, deep emerald
		// dark fading to near-black, gold ticker-tape accents on the ring and
		// glass "crystal" flora standing in for a financial district skyline. No
		// wordmark, logo, or literal brand hex; the palette nods at "stocks +
		// tape" rather than reproducing anyone's UI. Pinned via ?biome=hoodchain
		// (or opts.biome) so every Robinhood Chain coin shares this family while
		// the usual per-coin hue jitter keeps them from looking identical.
		id: 'hoodchain', label: 'Ticker Row',
		sky: ['#03130c', '#0a2e1e', '#123c28'], fog: '#0a2419', fogNear: 75, fogFar: 310,
		hemi: [0x3fd68a, 0x081a10, 0.62], ambient: 0.26,
		sun: { color: 0xffc35a, intensity: 1.6, elevation: 44, azimuth: 205 },
		ground: 0x0e1d15, plaza: 0x162a1f, grid: 0x2a4636, ring: 0xf2b705,
		hill: 0x11241a, trunk: 0x203a2c, leafA: 0x1fae6e, leafB: 0x2ecf85,
		flora: 'crystal', density: 26,
	},
];

// Map any seed to a biome. Exposed so the UI can name the world the player is in.
export function biomeForSeed(seed) {
	return BIOMES[(seed >>> 3) % BIOMES.length];
}

// Look up a biome by its archetype id (e.g. a curated world that pins its look
// instead of drawing it from the mint seed), searching the seeded set first and
// the curated-only set second. Returns null for an unknown id so the caller can
// fall back to the seeded pick.
export function biomeById(id) {
	return BIOMES.find((b) => b.id === id) || CURATED_BIOMES.find((b) => b.id === id) || null;
}
