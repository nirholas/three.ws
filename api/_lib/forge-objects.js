/**
 * Helpers for the "scene from a photo" lane (api/forge-scene-objects.js).
 *
 * The SAM 3D Objects worker reconstructs the objects a caller names in a photo.
 * Two pure functions live here so they can be tested without a network:
 *
 *   - normalizeDetectedBoxes: turn a vision model's object list into the clean,
 *     bounded, de-duplicated boxes the worker accepts.
 *   - isSanctionedTerritory: the SAM License refuses comprehensively sanctioned
 *     jurisdictions, so those requests never reach the worker.
 *
 * And one that talks to the vision chain: detectObjectBoxes.
 */

import { describeImageJson } from './vision.js';

export const MAX_SCENE_OBJECTS = 12;
export const DEFAULT_SCENE_OBJECTS = 8;
export const MIN_BOX_SIDE = 0.04;
export const MIN_BOX_AREA = 0.002;
const DUPLICATE_IOU = 0.7;

/**
 * Comprehensively sanctioned jurisdictions (ISO 3166-1 alpha-2) the SAM License
 * and Hugging Face both refuse. Only a country we positively resolved as one of
 * these is blocked: an unknown country is not, because the guard exists to honour
 * the licence, not to turn away every visitor behind a proxy.
 */
export const SANCTIONED_COUNTRIES = Object.freeze(['CU', 'IR', 'KP', 'SY']);

export function isSanctionedTerritory(country) {
	return typeof country === 'string' && SANCTIONED_COUNTRIES.includes(country.toUpperCase());
}

function iou(a, b) {
	const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
	const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
	const inter = ix * iy;
	const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
	return union > 0 ? inter / union : 0;
}

/**
 * Accepts the vision model's `{ objects: [{ label, box_2d: [ymin, xmin, ymax, xmax] }] }`
 * (0..1000, the convention Gemini is trained on) and returns
 * `[{ label, box: [x0, y0, x1, y1] }]` in 0..1 fractions of the frame, largest
 * first, with slivers, out-of-order boxes and near-duplicates dropped.
 */
export function normalizeDetectedBoxes(json, maxObjects = DEFAULT_SCENE_OBJECTS) {
	const list = Array.isArray(json) ? json : Array.isArray(json?.objects) ? json.objects : [];
	const cap = Math.min(Math.max(1, Math.floor(maxObjects) || DEFAULT_SCENE_OBJECTS), MAX_SCENE_OBJECTS);
	const candidates = [];
	for (const item of list) {
		const raw = item?.box_2d ?? item?.box;
		if (!Array.isArray(raw) || raw.length !== 4) continue;
		const nums = raw.map(Number);
		if (!nums.every(Number.isFinite)) continue;
		const [ymin, xmin, ymax, xmax] = nums.map((v) => Math.min(Math.max(v / 1000, 0), 1));
		if (!(xmin < xmax && ymin < ymax)) continue;
		if (xmax - xmin < MIN_BOX_SIDE || ymax - ymin < MIN_BOX_SIDE) continue;
		if ((xmax - xmin) * (ymax - ymin) < MIN_BOX_AREA) continue;
		const label = typeof item.label === 'string' ? item.label.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
		candidates.push({ label, box: [xmin, ymin, xmax, ymax].map((v) => Math.round(v * 10000) / 10000) });
	}
	candidates.sort(
		(a, b) => (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]) - (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]),
	);
	const kept = [];
	for (const c of candidates) {
		if (kept.some((k) => iou(k.box, c.box) > DUPLICATE_IOU)) continue;
		kept.push(c);
		if (kept.length >= cap) break;
	}
	return kept;
}

/**
 * Strictly validate caller-supplied boxes (`[x0, y0, x1, y1]`, fractions of the
 * frame). Unlike detected boxes these are never clamped or reordered: a caller
 * who sent a bad box is told which one, not silently given a different object.
 * Returns `{ boxes }` or `{ error }`.
 */
export function parseUserBoxes(raw, maxObjects = MAX_SCENE_OBJECTS) {
	if (!Array.isArray(raw) || raw.length === 0) return { error: 'boxes must be a non-empty list.' };
	if (raw.length > maxObjects) return { error: `${raw.length} boxes sent but max_objects is ${maxObjects}.` };
	const boxes = [];
	for (let i = 0; i < raw.length; i++) {
		const b = raw[i];
		if (!Array.isArray(b) || b.length !== 4 || !b.every((v) => typeof v === 'number' && Number.isFinite(v))) {
			return { error: `boxes[${i}] must be [x0, y0, x1, y1] as four numbers.` };
		}
		const [x0, y0, x1, y1] = b;
		if (!(x0 >= 0 && y0 >= 0 && x1 <= 1 && y1 <= 1 && x0 < x1 && y0 < y1)) {
			return { error: `boxes[${i}] must satisfy 0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1 (fractions of the frame).` };
		}
		if (x1 - x0 < MIN_BOX_SIDE || y1 - y0 < MIN_BOX_SIDE || (x1 - x0) * (y1 - y0) < MIN_BOX_AREA) {
			return { error: `boxes[${i}] is too small to reconstruct; it must cover at least 4% of the frame width and height.` };
		}
		for (let j = 0; j < i; j++) {
			if (iou(boxes[j], b) > DUPLICATE_IOU) {
				return { error: `boxes[${i}] overlaps boxes[${j}] by more than 70%; they name the same object.` };
			}
		}
		boxes.push([x0, y0, x1, y1]);
	}
	return { boxes };
}

const DETECT_PROMPT = (max) =>
	`List the distinct, separable physical objects in this photo, up to ${max}, most prominent first. ` +
	'Skip walls, floors, ceilings, sky, ground, and anything cut off by more than half the frame edge. ' +
	'Reply ONLY with JSON: {"objects":[{"label":"short name","box_2d":[ymin,xmin,ymax,xmax]}]} ' +
	'where box_2d is the tight bounding box in whole numbers from 0 to 1000 (fractions of the image height ' +
	'and width times 1000, origin top-left).';

/** Ask the vision chain to box the objects in a photo. Throws on a vision outage. */
export async function detectObjectBoxes(imageUrl, maxObjects = DEFAULT_SCENE_OBJECTS) {
	const result = await describeImageJson({
		prompt: DETECT_PROMPT(maxObjects),
		imageUrl,
		maxTokens: 1024,
		timeoutMs: 25_000,
		deadlineMs: 45_000,
	});
	return normalizeDetectedBoxes(result.json, maxObjects);
}
