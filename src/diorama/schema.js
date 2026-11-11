// Diorama — the shared data contract.
//
// One sentence becomes a little explorable 3D world. This module is the single
// source of truth for that world's shape: every other diorama module (the
// renderer, the create-flow controller, the gallery, the API) imports the
// constants, validators, and the sample fixture from here so they cannot drift.
//
// A Diorama is a plan first (objects with prompts + placement, no meshes yet)
// and a populated world second (each object gains a `glbUrl` once it is forged
// on the free text→3D lane). The renderer accepts a diorama at any stage of
// population and shows objects as luminous "forming" seeds until their mesh
// arrives — that progressive materialization is the heart of the experience.
//
// Shapes (JSDoc so editors type-check call sites without a build step):
//
// @typedef {'dawn'|'day'|'dusk'|'night'} DioramaMood
// @typedef {'grass'|'sand'|'snow'|'stone'|'water'|'meadow'|'void'} DioramaGround
// @typedef {'round'|'craggy'|'plateau'} IslandShape
//
// @typedef {Object} DioramaPalette
// @property {[string,string]} sky      two hex stops, top → horizon
// @property {string} ground            island surface tint (hex)
// @property {string} fog               atmospheric fog colour (hex)
// @property {string} accent            light/glow accent (hex)
//
// @typedef {Object} DioramaObject
// @property {string} id                stable id within the diorama
// @property {string} prompt            the forge prompt for this single object
// @property {string} label             short human label ("red canoe")
// @property {[number,number,number]} position  metres on the island; y is lift
// @property {number} scale             uniform scale multiplier (0.2–4)
// @property {number} rotationY         yaw in radians
// @property {('pending'|'forging'|'ready'|'failed')} status
// @property {string|null} glbUrl       durable GLB once forged
// @property {[number,number,number,number]} [box]  photo worlds only: where the
//                                      object sits in the source photo, as
//                                      [x0, y0, x1, y1] fractions of the frame
// @property {string} [supportId]       photo worlds only: id of the object this
//                                      one rests on (a laptop on a desk); the
//                                      renderer seats it on that mesh's real top
// @property {('photo'|'text')} [forgeFrom]  photo worlds only: 'photo' forges the
//                                      object from its crop of the source photo
//                                      (image→3D), 'text' from its description
// @property {string} [refImage]        durable crop of the source photo the
//                                      image→3D lane reads (set once uploaded)
//
// @typedef {'collect'|'reach'|'survive'} DioramaGoal
//
// @typedef {Object} DioramaGame
// @property {DioramaGoal} goal         collect: pick up `count` of the targets.
//                                      reach: walk to the first target.
//                                      survive: stay clear of every target (they
//                                      are hazards) until the timer runs out.
// @property {string[]} targetIds       object ids the goal refers to
// @property {number} count             pickups needed (collect); 1 otherwise
// @property {number|null} timeLimitSec null = untimed (survive always has one)
// @property {{x:number,z:number,heading:number}} spawn  where the walker starts
//
// @typedef {Object} Diorama
// @property {string} id
// @property {string} prompt            the original sentence
// @property {string} title            short evocative title
// @property {DioramaMood} mood
// @property {DioramaPalette} palette
// @property {DioramaGround} ground
// @property {IslandShape} island
// @property {DioramaObject[]} objects
// @property {DioramaGame|null} game    optional goal; null = exploration only
// @property {string} [sourceImage]     photo worlds only: the photo the scene was
//                                      rebuilt from (durable https URL)
// @property {{handle?:string, wallet?:string}|null} author
// @property {string} createdAt         ISO 8601
// @property {number} views
// @property {boolean} featured

export const MOODS = /** @type {const} */ (['dawn', 'day', 'dusk', 'night']);
export const GROUNDS = /** @type {const} */ ([
	'grass',
	'sand',
	'snow',
	'stone',
	'water',
	'meadow',
	'void',
]);
export const ISLANDS = /** @type {const} */ (['round', 'craggy', 'plateau']);

// Bounds. A diorama is a *miniature* — a handful of objects on a small island,
// not an open world. These caps keep one creation to a bounded generation cost
// (each object is one free forge job) and a bounded render budget.
export const MAX_OBJECTS = 8;
export const MIN_OBJECTS = 3;
export const MAX_PROMPT_LEN = 240;
export const ISLAND_RADIUS = 6.2; // metres; placement must stay inside this
// Every forged mesh is normalized so its larger horizontal side spans this many
// metres before the object's `scale` multiplier. The live renderer, the GLB
// exporter, and the photo layout all size objects against this one number.
export const OBJECT_FOOTPRINT = 1.4;
export const FORGE_SOURCES = /** @type {const} */ (['photo', 'text']);
export const GOALS = /** @type {const} */ (['collect', 'reach', 'survive']);
export const MIN_TIME_LIMIT_SEC = 10;
export const MAX_TIME_LIMIT_SEC = 600;
export const DEFAULT_SURVIVE_SEC = 45;
// Spawns are kept a little inside the rim so the walker never starts on the edge.
export const SPAWN_RADIUS = ISLAND_RADIUS - 0.8;

// Per-mood lighting presets the renderer reads so sky, sun, and fog stay
// coherent with the palette the composer chose. Pure data — no Three.js here.
export const MOOD_LIGHT = {
	dawn: { sunElevation: 0.18, sunIntensity: 1.1, ambient: 0.55, fog: 0.02 },
	day: { sunElevation: 0.62, sunIntensity: 1.6, ambient: 0.7, fog: 0.012 },
	dusk: { sunElevation: 0.1, sunIntensity: 0.9, ambient: 0.45, fog: 0.03 },
	night: { sunElevation: -0.08, sunIntensity: 0.35, ambient: 0.3, fog: 0.04 },
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const isHex = (v) => typeof v === 'string' && HEX.test(v);
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** A safe, fully-populated palette for a mood — used as a fallback. */
export function defaultPalette(mood = 'day') {
	switch (mood) {
		case 'dawn':
			return { sky: ['#ffd9a0', '#ff9e7d'], ground: '#7fae6b', fog: '#ffc0a8', accent: '#ffd76b' };
		case 'dusk':
			return { sky: ['#3a2a6b', '#ff7a59'], ground: '#5d7a59', fog: '#6b4b7a', accent: '#ff9d5c' };
		case 'night':
			return { sky: ['#0a1230', '#1d2a5e'], ground: '#3a4a52', fog: '#10183a', accent: '#9db1ff' };
		case 'day':
		default:
			return { sky: ['#7ec8ff', '#dff0ff'], ground: '#86c06a', fog: '#cfe8ff', accent: '#ffe08a' };
	}
}

/** Coerce a palette-ish object into a valid DioramaPalette (never throws). */
export function coercePalette(p, mood = 'day') {
	const d = defaultPalette(mood);
	if (!p || typeof p !== 'object') return d;
	const sky =
		Array.isArray(p.sky) && p.sky.length === 2 && p.sky.every(isHex) ? [p.sky[0], p.sky[1]] : d.sky;
	return {
		sky,
		ground: isHex(p.ground) ? p.ground : d.ground,
		fog: isHex(p.fog) ? p.fog : d.fog,
		accent: isHex(p.accent) ? p.accent : d.accent,
	};
}

/**
 * Validate + normalize an untrusted diorama (from the API or a composer) into a
 * guaranteed-renderable object. Returns { ok, diorama, errors }. Never throws —
 * boundaries clean their input; internal code then trusts the result.
 */
export function normalizeDiorama(input) {
	const errors = [];
	const src = input && typeof input === 'object' ? input : {};

	const prompt = String(src.prompt ?? '').slice(0, MAX_PROMPT_LEN).trim();
	if (!prompt) errors.push('prompt is required');

	const mood = MOODS.includes(src.mood) ? src.mood : 'day';
	const ground = GROUNDS.includes(src.ground) ? src.ground : 'grass';
	const island = ISLANDS.includes(src.island) ? src.island : 'round';
	const palette = coercePalette(src.palette, mood);

	const rawObjects = Array.isArray(src.objects) ? src.objects : [];
	const objects = rawObjects
		.slice(0, MAX_OBJECTS)
		.map((o, i) => normalizeObject(o, i))
		.filter(Boolean);
	if (objects.length < 1) errors.push('at least one object is required');

	const title = String(src.title ?? '').slice(0, 80).trim() || titleFromPrompt(prompt);

	resolveSupports(objects);
	const sourceImage = httpsUrl(src.sourceImage);

	const { game, warnings } = normalizeGame(src.game, objects);

	const diorama = {
		id: typeof src.id === 'string' ? src.id : '',
		prompt,
		title,
		mood,
		palette,
		ground,
		island,
		objects,
		game,
		author: normalizeAuthor(src.author),
		createdAt: typeof src.createdAt === 'string' ? src.createdAt : '',
		views: isFiniteNum(src.views) ? Math.max(0, Math.floor(src.views)) : 0,
		featured: Boolean(src.featured),
		...(sourceImage ? { sourceImage } : {}),
	};

	return { ok: errors.length === 0, diorama, errors, warnings };
}

/**
 * Validate + normalize an untrusted `game` block against the world's objects.
 * Returns { game, warnings }. `game` is null when the input is absent or cannot
 * be played (unknown goal, no surviving targets); an old diorama with no game
 * block is simply exploration only and produces no warning. Unknown target ids
 * are dropped (never fatal) and reported, so a model that names an object the
 * plan does not have loses the bad reference instead of failing the world.
 * Idempotent: normalizing a normalized game returns an equal game.
 */
export function normalizeGame(input, objects) {
	const warnings = [];
	if (input === undefined || input === null) return { game: null, warnings };
	if (typeof input !== 'object' || Array.isArray(input)) {
		return { game: null, warnings: ['game must be an object'] };
	}
	const goal = input.goal;
	if (!GOALS.includes(goal)) {
		return { game: null, warnings: [`unknown goal "${String(goal).slice(0, 24)}"`] };
	}
	const known = new Set((objects || []).map((o) => o.id));
	const seen = new Set();
	const targetIds = [];
	for (const id of Array.isArray(input.targetIds) ? input.targetIds : []) {
		if (typeof id !== 'string') continue;
		if (!known.has(id)) {
			warnings.push(`unknown target id "${id.slice(0, 48)}" dropped`);
			continue;
		}
		if (!seen.has(id)) {
			seen.add(id);
			targetIds.push(id);
		}
	}
	if (targetIds.length === 0) {
		warnings.push('game has no valid targets');
		return { game: null, warnings };
	}

	let count = 1;
	if (goal === 'collect') {
		const asked = Math.floor(Number(input.count));
		count = clamp(Number.isFinite(asked) && asked > 0 ? asked : targetIds.length, 1, targetIds.length);
	}
	const reach = goal === 'reach' ? [targetIds[0]] : targetIds;

	let timeLimitSec = null;
	const limit = Number(input.timeLimitSec);
	if (input.timeLimitSec !== null && input.timeLimitSec !== undefined && Number.isFinite(limit) && limit > 0) {
		timeLimitSec = Math.round(clamp(limit, MIN_TIME_LIMIT_SEC, MAX_TIME_LIMIT_SEC));
	}
	if (goal === 'survive' && timeLimitSec === null) timeLimitSec = DEFAULT_SURVIVE_SEC;

	return {
		game: { goal, targetIds: reach, count, timeLimitSec, spawn: normalizeSpawn(input.spawn) },
		warnings,
	};
}

function normalizeSpawn(sp) {
	const src = sp && typeof sp === 'object' ? sp : {};
	let x = Number(src.x);
	let z = Number(src.z);
	if (!Number.isFinite(x) || !Number.isFinite(z)) {
		x = 0;
		z = SPAWN_RADIUS * 0.75;
	}
	const r = Math.hypot(x, z);
	if (r > SPAWN_RADIUS) {
		const k = SPAWN_RADIUS / r;
		x *= k;
		z *= k;
	}
	const heading = Number.isFinite(Number(src.heading)) ? Number(src.heading) : Math.PI;
	return { x: round2(x), z: round2(z), heading: round3(heading) };
}

function normalizeObject(o, i) {
	if (!o || typeof o !== 'object') return null;
	const prompt = String(o.prompt ?? '').slice(0, MAX_PROMPT_LEN).trim();
	if (!prompt) return null;
	const pos = Array.isArray(o.position) ? o.position : [];
	let [x, y, z] = [Number(pos[0]) || 0, Number(pos[1]) || 0, Number(pos[2]) || 0];
	// Keep placement on the island disc.
	const r = Math.hypot(x, z);
	if (r > ISLAND_RADIUS) {
		const k = ISLAND_RADIUS / r;
		x *= k;
		z *= k;
	}
	const status = ['pending', 'forging', 'ready', 'failed'].includes(o.status)
		? o.status
		: o.glbUrl
			? 'ready'
			: 'pending';
	const box = normalizeBox(o.box);
	const refImage = httpsUrl(o.refImage);
	return {
		id: typeof o.id === 'string' && o.id ? o.id : `obj-${i}`,
		prompt,
		label: String(o.label ?? prompt).slice(0, 48).trim() || `object ${i + 1}`,
		position: [round2(x), round2(clamp(y, 0, 4)), round2(z)],
		scale: round2(clamp(Number(o.scale) || 1, 0.2, 4)),
		rotationY: round3(Number(o.rotationY) || 0),
		status,
		glbUrl: typeof o.glbUrl === 'string' && /^https?:\/\//.test(o.glbUrl) ? o.glbUrl : null,
		// Photo-world fields ride along only when present, so a sentence world
		// normalizes to exactly the shape it always had.
		...(box ? { box } : {}),
		...(typeof o.supportId === 'string' && o.supportId ? { supportId: o.supportId.slice(0, 64) } : {}),
		...(FORGE_SOURCES.includes(o.forgeFrom) ? { forgeFrom: o.forgeFrom } : {}),
		...(refImage ? { refImage } : {}),
	};
}

/** A photo-frame box `[x0, y0, x1, y1]` in 0..1 with x0 < x1 and y0 < y1, or null. */
function normalizeBox(b) {
	if (!Array.isArray(b) || b.length !== 4) return null;
	const n = b.map(Number);
	if (!n.every(Number.isFinite)) return null;
	const [x0, y0, x1, y1] = n.map((v) => clamp(v, 0, 1));
	if (!(x0 < x1 && y0 < y1)) return null;
	return [x0, y0, x1, y1].map((v) => Math.round(v * 10000) / 10000);
}

/** A durable https URL (max 1 KB) or null. */
function httpsUrl(v) {
	return typeof v === 'string' && v.length <= 1024 && /^https:\/\/[^\s]+$/i.test(v) ? v : null;
}

/**
 * Drop any `supportId` that does not name another object in the world, and
 * break support cycles (a rests on b rests on a), so the renderer can always
 * walk a support chain to the ground. Mutates the freshly normalized objects.
 */
function resolveSupports(objects) {
	const byId = new Map(objects.map((o) => [o.id, o]));
	for (const o of objects) {
		if (o.supportId && (o.supportId === o.id || !byId.has(o.supportId))) delete o.supportId;
	}
	for (const o of objects) {
		const seen = new Set([o.id]);
		let cur = o;
		while (cur.supportId) {
			if (seen.has(cur.supportId)) {
				delete cur.supportId;
				break;
			}
			seen.add(cur.supportId);
			cur = byId.get(cur.supportId);
		}
	}
}

function normalizeAuthor(a) {
	if (!a || typeof a !== 'object') return null;
	const handle = typeof a.handle === 'string' ? a.handle.slice(0, 48) : undefined;
	const wallet = typeof a.wallet === 'string' ? a.wallet.slice(0, 64) : undefined;
	if (!handle && !wallet) return null;
	return { ...(handle ? { handle } : {}), ...(wallet ? { wallet } : {}) };
}

/** Derive a short Title Case title from the prompt when none is supplied. */
export function titleFromPrompt(prompt) {
	const words = String(prompt || 'A little world')
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 6);
	if (!words.length) return 'A little world';
	return words
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ');
}

const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;

/** True once every object has a mesh (the world is fully forged). */
export function isComplete(diorama) {
	return (
		!!diorama &&
		Array.isArray(diorama.objects) &&
		diorama.objects.length > 0 &&
		diorama.objects.every((o) => o.status === 'ready' && o.glbUrl)
	);
}

/** Progress 0..1 across forging (ready or failed both count as settled). */
export function forgeProgress(diorama) {
	const objs = diorama?.objects || [];
	if (!objs.length) return 0;
	const settled = objs.filter((o) => o.status === 'ready' || o.status === 'failed').length;
	return settled / objs.length;
}

// A hand-authored sample world. The renderer and gallery use this for local
// development and for the empty-state preview so the page is never a blank void
// before the first real diorama loads. GLB URLs point at durable, already-forged
// public meshes on the three.ws CDN-backed forge store.
export const SAMPLE_DIORAMA = Object.freeze(
	normalizeDiorama({
		id: 'sample-campsite',
		prompt: 'a cozy autumn campsite by a lake at dusk',
		title: 'Autumn Campsite',
		mood: 'dusk',
		ground: 'meadow',
		island: 'round',
		palette: { sky: ['#3a2a6b', '#ff7a59'], ground: '#6b7a4a', fog: '#5a3f6b', accent: '#ff9d5c' },
		objects: [
			{ id: 'tent', prompt: 'a small orange canvas camping tent', label: 'tent', position: [-1.6, 0, 0.4], scale: 1.1, rotationY: 0.5 },
			{ id: 'fire', prompt: 'a glowing campfire with stacked logs', label: 'campfire', position: [0.4, 0, 0.2], scale: 0.7, rotationY: 0 },
			{ id: 'pine-1', prompt: 'a tall pine tree with autumn needles', label: 'pine', position: [2.4, 0, -1.8], scale: 1.6, rotationY: 1.2 },
			{ id: 'pine-2', prompt: 'a short round pine bush', label: 'shrub', position: [-2.8, 0, -1.2], scale: 0.9, rotationY: 2.1 },
			{ id: 'canoe', prompt: 'a red wooden canoe', label: 'canoe', position: [1.8, 0, 2.6], scale: 1.2, rotationY: -0.6 },
			{ id: 'log', prompt: 'a fallen mossy log bench', label: 'log', position: [-0.6, 0, 1.8], scale: 0.8, rotationY: 0.3 },
		].map((o) => ({ ...o, status: 'pending', glbUrl: null })),
	}).diorama,
);
