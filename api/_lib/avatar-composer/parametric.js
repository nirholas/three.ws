// @ts-check
// Avatar Composer: parametric mode.
//
// The legacy composer (select.js + compose.js) grafts skinned parts between the
// Ready-Player-Me bases, so every result shares one of a handful of body builds.
// The Parametric base (public/avatars/parametric-base.glb) carries ~300 identity
// morph sliders and a skeleton-proportions solver, so a seeded APPEARANCE RECORD
// for that single base yields real build, face and height variety, and the same
// record format the editor saves (api/_lib/validate.js `avatarAppearance`) bakes
// it with bakeAppearance(). This module only chooses the record. It does no I/O
// beyond reading the morph names out of GLB bytes the caller supplies, so the
// surprise endpoint, the seed tooling and the tests all share one selector.
//
// Everything is deterministic on `seed`: the same seed, profile, morph names and
// garment catalog always yield the same record.

import { hashSeed, mulberry32 } from '../avaturn-seed.js';
import { listPresetIds } from '../accessories.js';
import { PROPORTION_PARAMS, normalizeProportions } from '../../../src/avatar-proportions.js';

/** Value of `appearance.base` for this mode, and the file id under /avatars. */
export const PARAMETRIC_BASE_ID = 'parametric-base-v1';
export const PARAMETRIC_BASE_FILE = 'parametric-base';

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;

/**
 * Identity morph names of the base's Body mesh, read from the GLB JSON chunk
 * (mesh.extras.targetNames), so the slider set always matches the shipped file.
 * @param {Uint8Array} glb
 * @returns {string[]}
 */
export function readMorphNames(glb) {
	const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
	if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error('not a GLB');
	let off = 12;
	while (off + 8 <= glb.byteLength) {
		const len = view.getUint32(off, true);
		const type = view.getUint32(off + 4, true);
		if (type === CHUNK_JSON) {
			const json = JSON.parse(new TextDecoder().decode(glb.subarray(off + 8, off + 8 + len)));
			const body = (json.meshes || []).find((m) => m.name === 'Body') || (json.meshes || [])[0];
			const names = body?.extras?.targetNames;
			if (!Array.isArray(names) || !names.length) throw new Error('base has no morph target names');
			return names.filter((n) => typeof n === 'string');
		}
		off += 8 + len + ((4 - (len % 4)) % 4);
	}
	throw new Error('GLB has no JSON chunk');
}

// Opposing direction words. Two sliders with the same stem and opposed last
// words (headWider / headNarrower) cancel each other, so the selector never
// takes both.
const ANTONYMS = new Map();
for (const [a, b] of [
	['Wider', 'Narrower'], ['Bigger', 'Smaller'], ['Taller', 'Shorter'], ['Longer', 'Shorter'],
	['Thicker', 'Thinner'], ['Deeper', 'Shallower'], ['Deeper', 'Flatter'], ['Fuller', 'Leaner'],
	['Higher', 'Lower'], ['Forward', 'Backward'], ['In', 'Out'], ['Up', 'Down'],
	['More', 'Less'], ['Heavier', 'Thinner'], ['Muscular', 'Softer'], ['Rounder', 'Flatter'],
	['Older', 'Youthful'], ['Aged', 'Youthful'],
]) {
	if (!ANTONYMS.has(a)) ANTONYMS.set(a, new Set());
	if (!ANTONYMS.has(b)) ANTONYMS.set(b, new Set());
	ANTONYMS.get(a).add(b);
	ANTONYMS.get(b).add(a);
}

/** Split a camelCase slider name into [stem, lastWord, side]. */
function parts(name) {
	const side = /(Left|Right)$/.exec(name)?.[1] || '';
	const bare = side ? name.slice(0, -side.length) : name;
	const m = /^(.*?)([A-Z][a-z]+)$/.exec(bare);
	return { stem: m ? m[1] : bare, word: m ? m[2] : '', side };
}

function opposes(a, b) {
	const pa = parts(a);
	const pb = parts(b);
	if (pa.side !== pb.side) return false;
	if (pa.stem === pb.stem && ANTONYMS.get(pa.word)?.has(pb.word)) return true;
	// "chestPectorals" vs "chestPectoralsLess": the Less/More form negates its stem.
	const baseA = pa.word === 'Less' || pa.word === 'More' ? pa.stem : null;
	const baseB = pb.word === 'Less' || pb.word === 'More' ? pb.stem : null;
	return (baseA && (baseA === b || baseA === parts(b).stem + parts(b).word)) ||
		(baseB && (baseB === a || baseB === pa.stem + pa.word));
}

// Sliders the selector drives itself rather than drawing at random: the body
// macros (gender, ethnicity blend) and the age pair.
const MACRO_RE = /^body(Feminine|Masculine|African|Asian|Caucasian|Older)$|^head(Aged|Youthful)$/;
const BUST_GROUP = 'bust';

/**
 * Group the base's sliders by their leading word (head, neck, chest, nose, ...)
 * and mark the macro sliders the selector places itself.
 * @param {string[]} names
 * @returns {{ groups: Map<string,string[]>, macros: Set<string> }}
 */
export function deriveSliders(names) {
	const groups = new Map();
	const macros = new Set();
	for (const name of names) {
		if (MACRO_RE.test(name)) {
			macros.add(name);
			continue;
		}
		const group = /^[a-z]+/.exec(name)?.[0];
		if (!group) continue;
		if (!groups.has(group)) groups.set(group, []);
		groups.get(group).push(name);
	}
	return { groups, macros };
}

// Skin ranges per diversity-profile ethnicity: [light end, dark end]. The record
// carries one concrete hex drawn along the range (the baker writes it onto the
// Parametric_Body base colour, so it is an absolute tone, not a tint).
const SKIN_RANGES = {
	'east-asian': ['#f6d3b8', '#e2b48f'],
	'southeast-asian': ['#e4b48a', '#b9835a'],
	'south-asian': ['#d9a577', '#9a6a45'],
	'black-african': ['#8d5a3b', '#4a2c1d'],
	'black-caribbean': ['#a06a46', '#5b3724'],
	latino: ['#e0b088', '#a8754d'],
	'middle-eastern': ['#e2b88f', '#b98860'],
	'white-european': ['#fbe3d0', '#e6b896'],
	nordic: ['#fde8d9', '#ecc3a6'],
	'pacific-islander': ['#c58d63', '#8c5b3a'],
};
const DEFAULT_SKIN = ['#f3c1a3', '#9c6b44'];

// Which ethnicity macro slider leads for a profile key, with an optional blend.
const MACRO_BLEND = {
	'east-asian': { bodyAsian: 0.85 },
	'southeast-asian': { bodyAsian: 0.7 },
	'south-asian': { bodyCaucasian: 0.35, bodyAsian: 0.3 },
	'black-african': { bodyAfrican: 0.9 },
	'black-caribbean': { bodyAfrican: 0.7, bodyCaucasian: 0.2 },
	latino: { bodyCaucasian: 0.5, bodyAsian: 0.2 },
	'middle-eastern': { bodyCaucasian: 0.6 },
	'white-european': { bodyCaucasian: 0.9 },
	nordic: { bodyCaucasian: 1 },
	'pacific-islander': { bodyAsian: 0.4, bodyAfrican: 0.3 },
};

const hex2 = (n) => Math.round(n).toString(16).padStart(2, '0');
function lerpHex(a, b, t) {
	const ca = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
	const cb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
	return `#${ca.map((c, i) => hex2(c + (cb[i] - c) * t)).join('')}`;
}

const r3 = (n) => Math.round(n * 1000) / 1000;
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

// Probability of each garment slot being worn. Top and bottom are near-certain
// (the base ships bare); the rest add variety without every avatar being dressed
// identically. Headwear/glasses/accessory garment slots are left to the bone
// accessory presets so the two never stack on the same bone.
const GARMENT_SLOT_ODDS = [
	['top', 0.96],
	['bottom', 0.96],
	['footwear', 0.8],
	['hair', 0.88],
	['outerwear', 0.22],
];

/**
 * Choose a full appearance record for the Parametric base.
 *
 * @param {{ gender?: 'male'|'female', ethnicityKey?: string, ageKey?: string, grayBias?: number, build?: string }} profile
 * @param {string} seed
 * @param {{ morphNames: string[], catalog?: Array<{ slot: string, id: string }> }} ctx
 *        morphNames from readMorphNames(); catalog is the garment catalog (an
 *        empty or missing catalog just means no garments are chosen)
 * @returns {{
 *   base: 'parametric-base-v1',
 *   morphs: Record<string, number>,
 *   proportions: Record<string, number>,
 *   colors: { skin: string },
 *   garments: Array<{ slot: string, id: string }>,
 *   accessories: string[],
 * }}
 */
export function selectParametricAppearance(profile, seed, ctx) {
	const { morphNames, catalog = [] } = ctx;
	const gender = profile?.gender === 'male' ? 'male' : 'female';
	const { groups, macros } = deriveSliders(morphNames);

	// 1) Identity morphs: macros first (gender, ethnicity blend, age), then a seeded
	//    handful of face/body sliders drawn evenly across the derived groups.
	/** @type {Record<string, number>} */
	const morphs = {};
	const rng = mulberry32(hashSeed(`${seed}:morphs`));
	const setMacro = (name, w) => {
		if (macros.has(name)) morphs[name] = r3(Math.min(1, Math.max(0, w)));
	};
	setMacro(gender === 'male' ? 'bodyMasculine' : 'bodyFeminine', 0.55 + rng() * 0.35);
	for (const [name, w] of Object.entries(MACRO_BLEND[profile?.ethnicityKey] || { bodyCaucasian: 0.5 })) {
		setMacro(name, w * (0.85 + rng() * 0.15));
	}
	const age = profile?.ageKey;
	if (age === 'senior') {
		setMacro('bodyOlder', 0.55 + rng() * 0.3);
		setMacro('headAged', 0.5 + rng() * 0.3);
	} else if (age === 'middle-aged') {
		setMacro('bodyOlder', 0.2 + rng() * 0.2);
		setMacro('headAged', 0.2 + rng() * 0.2);
	} else if (age === 'young-adult') {
		setMacro('headYouthful', 0.25 + rng() * 0.3);
	}

	const eligible = [...groups.entries()].filter(([g]) => !(gender === 'male' && g === BUST_GROUP));
	const draws = 7 + Math.floor(rng() * 6);
	const chosen = [];
	for (let i = 0; i < draws; i++) {
		const [, sliders] = pick(eligible, rng);
		const name = pick(sliders, rng);
		const side = parts(name).side;
		const twin = side ? name.slice(0, -side.length) + (side === 'Left' ? 'Right' : 'Left') : null;
		if (chosen.some((c) => c === name || opposes(c, name))) continue;
		const w = r3(0.18 + rng() * 0.52);
		chosen.push(name);
		morphs[name] = w;
		if (twin && sliders.includes(twin) && !chosen.includes(twin)) {
			chosen.push(twin);
			morphs[twin] = w;
		}
	}

	// 2) Proportions: height always, plus 2 to 4 more params, each pulled up to
	//    70% of the way to its declared limit so no seed reaches an extreme.
	const prng = mulberry32(hashSeed(`${seed}:proportions`));
	const raw = {};
	const swing = (param) => {
		const t = prng() * 2 - 1;
		return 1 + t * 0.7 * (t < 0 ? 1 - param.min : param.max - 1);
	};
	const height = PROPORTION_PARAMS.find((p) => p.id === 'height');
	if (height) raw.height = swing(height);
	const others = PROPORTION_PARAMS.filter((p) => p.id !== 'height');
	const extra = 2 + Math.floor(prng() * 3);
	for (let i = 0; i < extra && others.length; i++) {
		const [p] = others.splice(Math.floor(prng() * others.length), 1);
		raw[p.id] = swing(p);
	}
	const proportions = Object.fromEntries(
		Object.entries(normalizeProportions(raw)).map(([k, v]) => [k, r3(v)]),
	);

	// 3) Skin tone along the profile's ethnicity range.
	const srng = mulberry32(hashSeed(`${seed}:skin`));
	const [lo, hi] = SKIN_RANGES[profile?.ethnicityKey] || DEFAULT_SKIN;
	const colors = { skin: lerpHex(lo, hi, srng()) };

	// 4) Garments from the live catalog: one per slot, hair/top/bottom/footwear/outerwear.
	const grng = mulberry32(hashSeed(`${seed}:garments`));
	const garments = [];
	for (const [slot, odds] of GARMENT_SLOT_ODDS) {
		const pool = catalog.filter((g) => g.slot === slot);
		if (!pool.length || grng() >= odds) continue;
		garments.push({ slot, id: pick(pool, grng).id });
	}

	// 5) 0 to 2 bone accessories (hat, glasses, earrings), at most one per kind.
	const arng = mulberry32(hashSeed(`${seed}:accessories`));
	const byKind = new Map();
	for (const id of listPresetIds()) {
		const kind = id.split('-')[0];
		if (kind === 'outfit') continue;
		if (!byKind.has(kind)) byKind.set(kind, []);
		byKind.get(kind).push(id);
	}
	const roll = arng();
	const count = roll < 0.35 ? 0 : roll < 0.8 ? 1 : 2;
	const kinds = [...byKind.keys()];
	const accessories = [];
	for (let i = 0; i < count && kinds.length; i++) {
		const [kind] = kinds.splice(Math.floor(arng() * kinds.length), 1);
		accessories.push(pick(byKind.get(kind), arng));
	}

	return { base: PARAMETRIC_BASE_ID, morphs, proportions, colors, garments, accessories };
}
