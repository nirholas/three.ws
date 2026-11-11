// Diorama: photo → placed plan.
//
// A vision model reads one photo and reports, per object, where it sits in the
// frame (its box), roughly how far it is from the camera, how big it really is,
// and what it rests on. This module turns that report into a Diorama plan whose
// layout mirrors the photo: the same left/right order, the same near/far depth,
// true relative sizes, and stacked objects (a lamp on a desk) marked with the
// object they rest on so the renderer can seat them on its real top surface.
//
// Pure and deterministic: no network, no DOM, no Three.js. The API calls it on
// the vision reply; tests call it on fixtures.
//
// Geometry. The photo is a pinhole projection. An object whose box centre is at
// horizontal fraction cx, at distance d from the camera, sits at
//   x = (cx - 0.5) * 2 * d * tan(fov / 2)
// metres right of the optical axis, and z = d metres in front of it. That puts
// every object on a real floor plan. The plan is then centred, flipped so the
// nearest object faces the diorama's default camera (+z), and scaled by ONE
// factor so the whole room fits the island and the largest object stays inside
// the schema's scale cap. One factor for everything is what keeps a lamp lamp-
// sized next to its desk.

import {
	ISLAND_RADIUS,
	MAX_OBJECTS,
	MAX_PROMPT_LEN,
	OBJECT_FOOTPRINT,
	MOODS,
	GROUNDS,
	ISLANDS,
} from './schema.js';

/** Assumed horizontal field of view of a phone camera's main lens (≈ 26 mm). */
export const PHOTO_HFOV_DEG = 66;
/** Boxes smaller than this (fraction of frame width or height) are too small to crop. */
export const MIN_CROP_SIDE = 0.07;
/** Two boxes of the same label overlapping this much are the same object. */
const DUPLICATE_IOU = 0.8;
/** Keep the outermost object this far inside the island rim (metres). */
const RIM_MARGIN = 1.0;
const MAX_SCALE = 4;
const MIN_SCALE = 0.2;

const FACING_YAW = { camera: 0, left: -Math.PI / 2, right: Math.PI / 2, away: Math.PI };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v) => (typeof v === 'number' ? v : Number(v));
const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;

function iou(a, b) {
	const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
	const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
	const inter = ix * iy;
	const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
	return union > 0 ? inter / union : 0;
}

/** `[ymin, xmin, ymax, xmax]` in 0..1000 (the Gemini convention) → `[x0, y0, x1, y1]` in 0..1, or null. */
export function boxFromBox2d(raw) {
	if (!Array.isArray(raw) || raw.length !== 4) return null;
	const n = raw.map(num);
	if (!n.every(Number.isFinite)) return null;
	// Accept either 0..1000 or 0..1 fractions: a model that answers in fractions
	// has every value <= 1.
	const scale = n.every((v) => v <= 1) ? 1 : 1000;
	const [ymin, xmin, ymax, xmax] = n.map((v) => clamp(v / scale, 0, 1));
	if (!(xmin < xmax && ymin < ymax)) return null;
	return [xmin, ymin, xmax, ymax];
}

/**
 * `{ left, top, right, bottom }` in 0..1000 (or 0..1 fractions) → `[x0, y0, x1, y1]`
 * in 0..1, or null. Named edges are what the prompt asks for: array boxes are
 * ambiguous across models (Gemini answers [ymin, xmin, ymax, xmax], others
 * answer [x0, y0, x1, y1] to the same request), named edges are not.
 */
export function boxFromEdges(raw) {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const n = [raw.left, raw.top, raw.right, raw.bottom].map(num);
	if (!n.every(Number.isFinite)) return null;
	const scale = n.every((v) => v <= 1) ? 1 : 1000;
	const [x0, y0, x1, y1] = n.map((v) => clamp(v / scale, 0, 1));
	if (!(x0 < x1 && y0 < y1)) return null;
	return [x0, y0, x1, y1];
}

function slugId(label, i) {
	const base = String(label || 'object')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 32);
	return `${base || 'object'}-${i + 1}`;
}

function cleanText(v, max) {
	return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function positive(v, lo, hi) {
	const n = num(v);
	return Number.isFinite(n) && n > 0 ? clamp(n, lo, hi) : null;
}

/**
 * Parse the vision reply's object list into clean records, keeping the model's
 * prominence order and remembering each record's original index (support
 * references point at original indices). Invalid boxes and duplicates go.
 */
function parseObjects(list, cap) {
	const halfTan = Math.tan(((PHOTO_HFOV_DEG / 2) * Math.PI) / 180);
	const kept = [];
	for (let i = 0; i < list.length && kept.length < cap; i++) {
		const item = list[i];
		if (!item || typeof item !== 'object') continue;
		const box = boxFromEdges(item.box) ?? boxFromBox2d(item.box_2d) ?? boxFromBox2d(item.box);
		if (!box) continue;
		const label = cleanText(item.label, 48);
		const prompt = cleanText(item.prompt, MAX_PROMPT_LEN) || label;
		if (!prompt) continue;
		if (kept.some((k) => k.label === label && iou(k.box, box) > DUPLICATE_IOU)) continue;

		const boxW = box[2] - box[0];
		let distance = positive(item.distance_m, 0.2, 60);
		let footprint = positive(item.footprint_m ?? item.width_m, 0.02, 30);
		// Fill one unknown from the other through the projection; a box that is
		// w of the frame at distance d spans w * 2 * d * tan(fov/2) metres.
		if (!distance && footprint) distance = clamp(footprint / (boxW * 2 * halfTan), 0.2, 60);
		if (!distance) distance = 2.5;
		if (!footprint) footprint = clamp(boxW * 2 * distance * halfTan, 0.02, 30);
		const height = positive(item.height_m, 0.01, 30) ?? footprint;

		const cx = (box[0] + box[2]) / 2;
		kept.push({
			index: i,
			label: label || prompt.split(' ').slice(0, 3).join(' '),
			prompt,
			box,
			distance,
			footprint,
			height,
			x: (cx - 0.5) * 2 * distance * halfTan,
			z: distance,
			on: item.on,
			occluded: item.occluded === true || item.visibility === 'partial',
			facing: typeof item.facing === 'string' ? item.facing.toLowerCase() : 'camera',
		});
	}
	return kept;
}

/** Resolve each record's `on` (an original index or a label) to a kept record, or null. */
function linkSupports(records) {
	const byIndex = new Map(records.map((r) => [r.index, r]));
	for (const r of records) {
		let target = null;
		const asIndex = typeof r.on === 'number' || (typeof r.on === 'string' && /^\d+$/.test(r.on.trim()));
		if (asIndex) {
			target = byIndex.get(Number(r.on)) || null;
		} else if (typeof r.on === 'string' && r.on.trim()) {
			const want = r.on.trim().toLowerCase();
			target = records.find((o) => o !== r && o.label.toLowerCase() === want) || null;
		}
		r.support = target && target !== r ? target : null;
	}
	// Break cycles: walk each chain and cut the link that closes a loop.
	for (const r of records) {
		const seen = new Set([r]);
		let cur = r;
		while (cur.support) {
			if (seen.has(cur.support)) {
				cur.support = null;
				break;
			}
			seen.add(cur.support);
			cur = cur.support;
		}
	}
}

/** Order records so every supporter forges before what rests on it, prominence order otherwise. */
function supportersFirst(records) {
	const out = [];
	const placed = new Set();
	const visit = (r) => {
		if (placed.has(r)) return;
		if (r.support) visit(r.support);
		placed.add(r);
		out.push(r);
	};
	records.forEach(visit);
	return out;
}

/** Summed real height of the chain of supports under a record (metres). */
function liftOf(r) {
	let lift = 0;
	for (let s = r.support; s; s = s.support) lift += s.height;
	return lift;
}

function pickEnum(value, allowed, fallback) {
	return allowed.includes(value) ? value : fallback;
}

/**
 * Turn a vision reply into a raw Diorama plan (feed it to normalizeDiorama).
 *
 * @param {object} analysis  `{ title, scene, mood, ground, palette, objects: [{ label,
 *   prompt, box: { left, top, right, bottom } (or a Gemini-order box_2d array),
 *   distance_m, footprint_m, height_m, on, occluded, facing }] }`
 * @param {{ maxObjects?: number }} [opts]
 * @returns {{ plan: object, dropped: number }} the plan and how many listed
 *   objects were discarded (bad box, duplicate, over the cap).
 */
export function planFromPhotoAnalysis(analysis, { maxObjects = MAX_OBJECTS } = {}) {
	const src = analysis && typeof analysis === 'object' ? analysis : {};
	const list = Array.isArray(src.objects) ? src.objects : [];
	const cap = clamp(Math.floor(maxObjects) || MAX_OBJECTS, 1, MAX_OBJECTS);
	const records = parseObjects(list, cap);
	linkSupports(records);

	// Floor plan in real metres. Only grounded objects define the extent; what
	// rests on them is carried inside their footprint.
	const grounded = records.filter((r) => !r.support);
	const anchor = grounded.length ? grounded : records;
	const xs = anchor.map((r) => r.x);
	const zs = anchor.map((r) => r.z);
	const cx = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
	const cz = zs.length ? (Math.min(...zs) + Math.max(...zs)) / 2 : 0;

	let extent = 0;
	for (const r of anchor) {
		extent = Math.max(extent, Math.hypot(r.x - cx, r.z - cz) + r.footprint / 2);
	}
	const largest = records.reduce((m, r) => Math.max(m, r.footprint), 0) || 1;
	// One factor for the whole room: fit inside the island, keep the largest
	// object within the scale cap.
	const fit = extent > 0 ? (ISLAND_RADIUS - RIM_MARGIN) / extent : Infinity;
	const capByScale = (MAX_SCALE * OBJECT_FOOTPRINT) / largest;
	const k = Math.min(fit, capByScale);

	const objects = supportersFirst(records);
	const idOf = new Map(objects.map((r, i) => [r, slugId(r.label, i)]));

	const planObjects = objects.map((r) => {
		const fromPhoto = !r.occluded && r.box[2] - r.box[0] >= MIN_CROP_SIDE && r.box[3] - r.box[1] >= MIN_CROP_SIDE;
		return {
			id: idOf.get(r),
			label: r.label,
			prompt: r.prompt,
			position: [round2((r.x - cx) * k), round2(clamp(liftOf(r) * k, 0, 4)), round2((cz - r.z) * k)],
			scale: round2(clamp((r.footprint * k) / OBJECT_FOOTPRINT, MIN_SCALE, MAX_SCALE)),
			// A photo crop already shows the object at its photographed angle, and
			// image→3D keeps that view facing +z, so it needs no yaw. A text forge
			// comes back front-facing and takes the model's facing estimate.
			rotationY: fromPhoto ? 0 : round3(FACING_YAW[r.facing] ?? 0),
			box: r.box.map((v) => Math.round(v * 10000) / 10000),
			...(r.support ? { supportId: idOf.get(r.support) } : {}),
			forgeFrom: fromPhoto ? 'photo' : 'text',
			status: 'pending',
			glbUrl: null,
		};
	});

	const scene = cleanText(src.scene, MAX_PROMPT_LEN);
	const mood = pickEnum(src.mood, MOODS, 'day');
	const plan = {
		title: cleanText(src.title, 80),
		prompt: scene || `A scene rebuilt from a photo: ${planObjects.map((o) => o.label).join(', ')}`.slice(0, MAX_PROMPT_LEN),
		mood,
		ground: pickEnum(src.ground, GROUNDS, 'stone'),
		island: pickEnum(src.island, ISLANDS, 'plateau'),
		palette: src.palette,
		objects: planObjects,
	};
	return { plan, dropped: list.length - planObjects.length };
}
