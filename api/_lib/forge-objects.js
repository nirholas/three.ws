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

import { describeImageJson, VISION_TASK_LEAD } from './vision.js';

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

export const DETECT_PROMPT = (max) =>
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
		lead: VISION_TASK_LEAD.object_detect,
		maxTokens: 1024,
		timeoutMs: 25_000,
		deadlineMs: 45_000,
	});
	return normalizeDetectedBoxes(result.json, maxObjects);
}

export const NOTHING_FOUND_MESSAGE =
	'Nothing found to lift out of this photo. Try one with clear, whole objects that stand apart from the background, ' +
	'like a desk, a shelf or a corner of a room.';

const NO_MESH_REASON = /no mesh|no objects/i;
const OUT_OF_MEMORY = /out of memory|\bOOM\b|CUBLAS_STATUS_ALLOC_FAILED|MemoryError/i;

/**
 * Turn the worker's failure string (workers/model-sam3d-objects/main.py and
 * pipeline.py) into a code, a sentence a visitor can act on, and whether trying
 * again can help. The worker's own wording never reaches the page: it can name
 * libraries and allocator sizes. An opaque correlation id ("ref abc123") is kept
 * so a reported failure can be joined to the worker log.
 *
 * `nothing_found` is not a failure: the photo simply had nothing the model could
 * lift out, and the endpoint reports it as an empty result.
 *
 * @returns {{ code: string, message: string, retryable: boolean }}
 */
export function classifySceneFailure(error, code = null) {
	const raw = typeof error === 'string' ? error : '';
	if (code === 'gcp_task_missing' || /task not found/i.test(raw)) {
		return {
			code: 'job_lost',
			message: 'The scene job was lost when its GPU restarted. Start it again; your allowance was not used.',
			retryable: true,
		};
	}
	if (OUT_OF_MEMORY.test(raw)) {
		return {
			code: 'out_of_memory',
			message: 'The GPU ran out of memory on this photo. Try again with fewer objects, or a photo with less in it.',
			retryable: true,
		};
	}
	if (/pipeline not ready|model load timed out/i.test(raw)) {
		return {
			code: 'worker_cold',
			message: 'The 3D model was still starting up and did not finish loading in time. Try again: once it is awake it starts much faster.',
			retryable: true,
		};
	}
	if (/pipeline unavailable/i.test(raw)) {
		return {
			code: 'worker_unavailable',
			message: 'The 3D model could not load on its GPU just now. Try again in a few minutes.',
			retryable: true,
		};
	}
	if (/not a readable image|refused to fetch|returned HTTP \d+|source .* (rejected|unreachable after)|^mask \d+:/i.test(raw)) {
		return {
			code: 'bad_photo',
			message: 'The 3D model could not read that photo. Use a JPG, PNG or WebP that is publicly reachable, then try again.',
			retryable: false,
		};
	}
	if (/timed out|timeout|deadline/i.test(raw)) {
		return {
			code: 'timeout',
			message: 'Rebuilding the objects took too long and was stopped. Try again, or choose fewer objects.',
			retryable: true,
		};
	}
	const allEmpty = raw.match(/^no object could be reconstructed \((.*)\)$/is);
	if (allEmpty && allEmpty[1].split(';').every((r) => NO_MESH_REASON.test(r))) {
		return { code: 'nothing_found', message: NOTHING_FOUND_MESSAGE, retryable: false };
	}
	const ref = raw.match(/\bref ([0-9a-f]{6,32})\b/i);
	return {
		code: 'worker_error',
		message: `The 3D model hit an error while rebuilding the objects${ref ? ` (ref ${ref[1]})` : ''}. Try again.`,
		retryable: true,
	};
}

const OBJECT_NAME = /^object_\d{2,3}$/;
const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

function usableObject(o) {
	return (
		o && typeof o === 'object' &&
		typeof o.name === 'string' && OBJECT_NAME.test(o.name) &&
		isVec3(o.centroid) &&
		o.bbox && isVec3(o.bbox.min) && isVec3(o.bbox.max) &&
		o.bbox.min.every((v, i) => v <= o.bbox.max[i])
	);
}

/**
 * Check a finished scene before it is handed to the page: the file is a public
 * https GLB, the object count is within what the lane allows, and every object
 * the page will place has a node name and a finite position and extent in the
 * shared scene frame (so the objects sit where they did relative to each other).
 * Malformed entries are dropped; a scene with none left is unusable.
 *
 * @returns {{ status: 'done', resultUrl: string, objects: object[] }
 *         | { status: 'empty' }
 *         | { status: 'failed', message: string }}
 */
export function checkSceneResult({ resultGlbUrl, objects, objectCount } = {}) {
	const list = Array.isArray(objects) ? objects : [];
	if (list.length === 0 && (objectCount === 0 || objectCount == null)) return { status: 'empty' };
	const unusable = (why) => ({ status: 'failed', message: `The scene came back unusable (${why}). Try again.` });
	let url;
	try {
		url = new URL(String(resultGlbUrl || ''));
	} catch {
		return unusable('no file');
	}
	if (url.protocol !== 'https:') return unusable('no public file');
	if (list.length > MAX_SCENE_OBJECTS) return unusable(`${list.length} objects, more than ${MAX_SCENE_OBJECTS}`);
	const seen = new Set();
	const kept = [];
	for (const o of list) {
		if (!usableObject(o) || seen.has(o.name)) continue;
		seen.add(o.name);
		kept.push(o);
	}
	if (!kept.length) return unusable('no object had a usable position');
	return { status: 'done', resultUrl: url.href, objects: kept };
}
