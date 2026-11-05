// @ts-check
// Studio avatar lane — the free, self-owned seeder engine that replaced the dead
// Avaturn public-editor path (Avaturn locked down their free catalog mid-2026,
// and their API is paid).
//
// It varies the Ready-Player-Me / Wolf3D rigged base bodies shipped in
// public/avatars (realistic-male, realistic-female, selfie-girl, default) by
// recoloring their per-part materials — Wolf3D_Skin, Wolf3D_Hair, and the
// Wolf3D_Outfit_* set — per a diversity profile. The skeleton, skin weights and
// ARKit blendshapes are untouched, so every output is a genuinely rigged,
// walk-ready avatar that drives the canonical clip library. Pure buffer-in /
// buffer-out (no I/O, no external service, no GPU, no cost), fully testable.

/** @typedef {{ id:string, file:string, gender:'male'|'female', label:string }} BaseBody */

export const BASE_BODIES = /** @type {BaseBody[]} */ ([
	{ id: 'realistic-male', file: 'realistic-male.glb', gender: 'male', label: 'Realistic male' },
	{
		id: 'realistic-female',
		file: 'realistic-female.glb',
		gender: 'female',
		label: 'Realistic female',
	},
	{ id: 'selfie-girl', file: 'selfie-girl.glb', gender: 'female', label: 'Selfie girl' },
	{ id: 'michelle', file: 'michelle.glb', gender: 'female', label: 'Michelle' },
	{ id: 'default', file: 'default.glb', gender: 'female', label: 'Default' },
]);

// Complexion multipliers by ethnicity key. glTF caps factors at 1, so the base
// texture is the lightest tone and we darken toward deeper complexions.
const SKIN_TINTS = {
	nordic: [1.0, 0.99, 0.97],
	'white-european': [0.98, 0.93, 0.88],
	'east-asian': [0.96, 0.87, 0.76],
	'southeast-asian': [0.85, 0.72, 0.58],
	latino: [0.82, 0.66, 0.52],
	'middle-eastern': [0.8, 0.64, 0.5],
	'south-asian': [0.72, 0.55, 0.42],
	'pacific-islander': [0.68, 0.52, 0.4],
	'black-caribbean': [0.55, 0.4, 0.31],
	'black-african': [0.45, 0.32, 0.25],
};
const DEFAULT_SKIN = [0.85, 0.72, 0.58];

const HAIR_TINTS = [
	[0.07, 0.05, 0.04],
	[0.16, 0.1, 0.06],
	[0.3, 0.19, 0.11],
	[0.45, 0.31, 0.18],
	[0.6, 0.45, 0.26],
	[0.78, 0.63, 0.4],
	[0.5, 0.22, 0.12],
];
const GRAY_HAIR = [
	[0.62, 0.62, 0.64],
	[0.8, 0.8, 0.82],
	[0.9, 0.9, 0.92],
];
const OUTFIT_TINTS = [
	[0.15, 0.16, 0.2],
	[0.2, 0.28, 0.45],
	[0.5, 0.12, 0.14],
	[0.14, 0.32, 0.22],
	[0.68, 0.66, 0.6],
	[0.35, 0.2, 0.45],
	[0.9, 0.86, 0.82],
	[0.85, 0.5, 0.15],
	[0.1, 0.1, 0.12],
	[0.2, 0.45, 0.5],
];
const FOOTWEAR_TINTS = [
	[0.08, 0.08, 0.09],
	[0.9, 0.88, 0.85],
	[0.3, 0.2, 0.14],
	[0.5, 0.12, 0.14],
];

function hashSeed(str) {
	let h = 2166136261 >>> 0;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}
function mulberry32(seed) {
	let a = seed >>> 0;
	return function () {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

/**
 * Pick the base body whose gender matches the profile (seeded/reproducible).
 * @param {{ gender?: 'male'|'female' }} profile
 * @param {string} seed
 * @returns {BaseBody}
 */
export function pickBaseBody(profile, seed) {
	const rng = mulberry32(hashSeed(seed + ':body'));
	const pool = BASE_BODIES.filter((b) => b.gender === profile?.gender);
	const from = pool.length ? pool : BASE_BODIES;
	return pick(from, rng);
}

/**
 * Per-part color multipliers for a profile + seed. Pure.
 * @param {{ gender?:'male'|'female', ethnicityKey?:string, grayBias?:number }} profile
 * @param {string} seed
 * @returns {{ skin:number[], hair:number[], top:number[], bottom:number[], footwear:number[] }}
 */
export function pickColorway(profile, seed) {
	const rng = mulberry32(hashSeed(seed + ':color'));
	const skin = (SKIN_TINTS[profile?.ethnicityKey] || DEFAULT_SKIN).slice();
	const gray = rng() < (profile?.grayBias ?? 0);
	const hair = (gray ? pick(GRAY_HAIR, rng) : pick(HAIR_TINTS, rng)).slice();
	const top = pick(OUTFIT_TINTS, rng);
	const bottom = pick(
		OUTFIT_TINTS.filter((c) => c !== top),
		rng,
	);
	return {
		skin,
		hair,
		top: top.slice(),
		bottom: bottom.slice(),
		footwear: pick(FOOTWEAR_TINTS, rng).slice(),
	};
}

// Wolf3D_Skin is the head; Wolf3D_Body is the body skin (hands, neck, feet). Both
// take the complexion so the avatar is one consistent tone head-to-toe — tinting
// only the face left the hands the base color, a visible mismatch on dark tones.
const MATERIAL_CHANNEL = {
	Wolf3D_Skin: 'skin',
	Wolf3D_Body: 'skin',
	Ch03_Body: 'skin',
	Wolf3D_Hair: 'hair',
	Wolf3D_Outfit_Top: 'top',
	Wolf3D_Outfit_Bottom: 'bottom',
	Wolf3D_Outfit_Footwear: 'footwear',
};

/**
 * Pick a uniform size multiplier for a profile + seed. Morph targets on these
 * bodies are ARKit expressions (no body shape), so height is the only real size
 * axis — a uniform node scale gives believable tall / average / petite variety
 * without distorting the rig. Women trend slightly shorter, seniors a touch more.
 * @param {{ gender?:'male'|'female', ageKey?:string, build?:string }} profile
 * @param {string} seed
 * @returns {number} scale in ~[0.9, 1.1]
 */
export function pickScale(profile, seed) {
	const rng = mulberry32(hashSeed(seed + ':scale'));
	let s = 0.97 + rng() * 0.13; // 0.97–1.10 base spread
	if (profile?.gender === 'female') s -= 0.05;
	if (profile?.ageKey === 'senior') s -= 0.02;
	if (profile?.build === 'petite' || profile?.build === 'slim') s -= 0.02;
	if (profile?.build === 'stocky' || profile?.build === 'athletic') s += 0.02;
	return Math.round(Math.max(0.88, Math.min(1.12, s)) * 1000) / 1000;
}

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;

/**
 * Restyle a Wolf3D/RPM rigged GLB: recolor the skin / hair / outfit materials and
 * apply a uniform size scale to the scene roots (JSON-chunk edit, binary
 * untouched). The skeleton, weights and blendshapes are preserved, so the result
 * stays a valid, rigged, walk-ready avatar. Returns a new Buffer + what changed.
 * @param {Buffer} glb
 * @param {ReturnType<typeof pickColorway>} colorway
 * @param {number} [scale=1] - uniform size multiplier (see pickScale)
 * @returns {{ buffer: Buffer, recolored: string[], scale: number }}
 */
export function recolorGlb(glb, colorway, scale = 1) {
	if (!Buffer.isBuffer(glb) || glb.length < 20) throw new Error('recolorGlb: not a GLB buffer');
	if (glb.readUInt32LE(0) !== GLB_MAGIC || glb.readUInt32LE(4) !== 2)
		throw new Error('recolorGlb: bad GLB header');
	const jsonLen = glb.readUInt32LE(12);
	if (glb.readUInt32LE(16) !== CHUNK_JSON) throw new Error('recolorGlb: first chunk is not JSON');
	const jsonEnd = 20 + jsonLen;
	const gltf = JSON.parse(glb.slice(20, jsonEnd).toString('utf8'));

	const recolored = [];
	for (const mat of gltf.materials || []) {
		const channel = MATERIAL_CHANNEL[mat.name];
		if (!channel || !colorway[channel]) continue;
		const [r, g, b] = colorway[channel];
		mat.pbrMetallicRoughness = mat.pbrMetallicRoughness || {};
		// Skin multiplies the base's own tone (the untextured hands keep it in
		// this factor); other channels are absolute colors. See compose.js.
		const [fr, fg, fb, a] = mat.pbrMetallicRoughness.baseColorFactor || [1, 1, 1, 1];
		mat.pbrMetallicRoughness.baseColorFactor =
			channel === 'skin' ? [fr * r, fg * g, fb * b, a] : [r, g, b, a];
		recolored.push(mat.name);
	}

	// Uniform size: scale every root node of the default scene. Uniform scaling
	// keeps the rig valid and the clip retarget re-normalizes hip height, so a
	// taller/shorter avatar still walks correctly.
	const s = Number(scale) || 1;
	if (Math.abs(s - 1) > 1e-4 && Array.isArray(gltf.nodes)) {
		const scene = gltf.scenes?.[gltf.scene ?? 0];
		for (const idx of scene?.nodes || []) {
			const node = gltf.nodes[idx];
			if (!node || node.matrix) continue; // skip matrix-form nodes (rare here)
			const cur = Array.isArray(node.scale) ? node.scale : [1, 1, 1];
			node.scale = [cur[0] * s, cur[1] * s, cur[2] * s];
		}
	}

	let jsonBuf = Buffer.from(JSON.stringify(gltf), 'utf8');
	const pad = (4 - (jsonBuf.length % 4)) % 4;
	if (pad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(pad, 0x20)]);

	const rest = glb.slice(jsonEnd);
	const header = Buffer.alloc(20);
	header.writeUInt32LE(GLB_MAGIC, 0);
	header.writeUInt32LE(2, 4);
	header.writeUInt32LE(20 + jsonBuf.length + rest.length, 8);
	header.writeUInt32LE(jsonBuf.length, 12);
	header.writeUInt32LE(CHUNK_JSON, 16);

	return { buffer: Buffer.concat([header, jsonBuf, rest]), recolored, scale: s };
}
