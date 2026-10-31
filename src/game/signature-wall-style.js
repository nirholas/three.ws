// Signature wall style: the deterministic "hand" of each signature, shared by the
// in-world canvas (signature-wall.js) and the share card (api/play/signature-wall-og.js)
// so a signature looks like itself everywhere. Pure functions, no DOM, no three.

/** FNV-1a 32-bit hash of a string. Stable across runtimes. */
export function hashString(str) {
	let h = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h >>> 0;
}

/** Small seeded PRNG (mulberry32). Returns a function yielding floats in [0, 1). */
export function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// Spray-paint inks that stay readable on dark concrete.
export const INKS = [
	'#ff5d73', '#ffb03b', '#ffe14d', '#7dff7a', '#3be8c8',
	'#52b6ff', '#a98bff', '#ff7ae0', '#f4f4f0', '#ff8a4d',
];

// Name faces. Each is a stack ending in a generic family so every OS lands on
// something in the same spirit (marker, brush, block, mono).
export const NAME_FONTS = [
	{ stack: '"Permanent Marker","Marker Felt","Comic Sans MS","Chalkboard SE",cursive', weight: 400 },
	{ stack: '"Brush Script MT","Segoe Script","Lucida Handwriting",cursive', weight: 400 },
	{ stack: 'Impact,"Arial Black","Haettenschweiler",sans-serif', weight: 400 },
	{ stack: '"Courier New",Courier,monospace', weight: 700 },
	{ stack: '"Trebuchet MS","Gill Sans",Verdana,sans-serif', weight: 800 },
];
export const LINE_FONT = '"Marker Felt","Comic Sans MS","Segoe Print",cursive';

/**
 * The look of one signature, derived only from its id so it is the same on every
 * screen, on every reload, forever.
 * @param {{ id: string }} sig
 * @returns {{ ink: string, ink2: string, font: object, rot: number, lineRot: number, splat: number, scale: number, underline: boolean }}
 */
export function styleFor(sig) {
	const r = rng(hashString(String(sig.id)));
	const ink = INKS[Math.floor(r() * INKS.length)];
	let ink2 = INKS[Math.floor(r() * INKS.length)];
	if (ink2 === ink) ink2 = INKS[(INKS.indexOf(ink) + 3) % INKS.length];
	return {
		ink,
		ink2,
		font: NAME_FONTS[Math.floor(r() * NAME_FONTS.length)],
		rot: (r() - 0.5) * 0.30,
		lineRot: (r() - 0.5) * 0.16,
		splat: Math.floor(r() * 1e9),
		scale: 0.9 + r() * 0.2,
		underline: r() > 0.55,
	};
}

/** Tile grids by density: a sparse wall gets big tiles, a dense one gets small. */
export const TIERS = [
	{ max: 8, cols: 4, rows: 2 },
	{ max: 18, cols: 6, rows: 3 },
	{ max: 32, cols: 8, rows: 4 },
	{ max: 60, cols: 10, rows: 6 },
	{ max: Infinity, cols: 16, rows: 8 },
];

/** The smallest grid that holds `total` signatures (the largest once past it). */
export function tierFor(total) {
	return TIERS.find((t) => total <= t.max) || TIERS[TIERS.length - 1];
}

/** Signatures per page for a given total. */
export function pageSize(total) {
	const t = tierFor(total);
	return t.cols * t.rows;
}
