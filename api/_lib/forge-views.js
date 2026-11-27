// Extra reference views for Forge: when they help, when they are dropped, and
// the guarantee that an optional step never costs the user the model they would
// have had from one image.
//
// Three rules live here so api/forge.js and its ChatGPT clone api/gpt-forge.js
// share one answer:
//
//   1. FAIL OPEN, BOUNDED. Painting side and back views from the primary image
//      is an improvement layered on a path that already works with one image.
//      A throw, a throttle, a hung provider or an empty answer all end the same
//      way: the job continues at once with the images it already had. The step
//      has a hard time budget (FORGE_VIEWS_BUDGET_MS, default 30 s), so even a
//      provider that never answers delays the submit by at most that long.
//   2. VET WHAT WAS PAINTED. A generated view joins the fusion only when it is a
//      real picture of the same subject: not blank, a sane size, the same shape
//      of canvas as the primary, and a colour palette that matches the subject
//      once the background is taken out. Anything else is dropped, because a bad
//      view does not merely waste a slot, it votes for geometry that is not
//      there. The same palette check keeps a photo of a different object out of
//      a set of user photos.
//   3. SAY WHAT WAS USED. A lane that reads one image is given one image, the
//      one that shows the object best (the front view), and the response names
//      how many of the supplied photos the engine actually used.

import { fetchSafePublicUrl } from './ssrf-guard.js';
import { isInlineImageRef } from './image-persist.js';

// Engines whose workers read only the first view of a request (their gcp
// provider reports viewsUsed 1, or the Spaces chain takes images[0]). Sending
// them more only costs bandwidth and lets the page claim coverage that was not
// used. The fusing lanes (trellis_selfhost, pixal3d, the Replicate TRELLIS
// chain) are deliberately absent: their requests are never trimmed here.
const SINGLE_VIEW_LANES = new Set([
	'trellis2',
	'hunyuan3d',
	'modly',
	'modly_hunyuan',
	'anigen',
	'partcrafter',
	'huggingface',
]);

export function laneReadsOnlyOneView(backendId) {
	return SINGLE_VIEW_LANES.has(backendId);
}

// The only lane that paints extra turnaround views today (the self-host TRELLIS
// worker fuses up to six). Every other lane conditions on the primary view.
export function laneWantsTurnaroundViews(backendId, tierId) {
	return backendId === 'trellis_selfhost' && tierId !== 'draft';
}

const DEFAULT_VIEWS_BUDGET_MS = 30_000;
const VETTING_BUDGET_MS = 8_000;
const FETCH_TIMEOUT_MS = 6_000;
const MAX_VIEW_BYTES = 12 * 1024 * 1024;

export function viewsBudgetMs() {
	const raw = Number(process.env.FORGE_VIEWS_BUDGET_MS);
	return Number.isFinite(raw) && raw >= 1000 ? Math.floor(raw) : DEFAULT_VIEWS_BUDGET_MS;
}

// Races `work` against a timer. Resolves { value } when the work finishes in
// time, { timedOut: true } when it does not, and { error } when it throws. The
// work promise is always given a catch so a late rejection is never unhandled.
async function withinBudget(work, ms) {
	let timer;
	const timeout = new Promise((resolve) => {
		timer = setTimeout(() => resolve({ timedOut: true }), ms);
	});
	const settled = Promise.resolve(work).then(
		(value) => ({ value }),
		(error) => ({ error }),
	);
	try {
		return await Promise.race([settled, timeout]);
	} finally {
		clearTimeout(timer);
	}
}

// ---------------------------------------------------------------------------
// Image checks
// ---------------------------------------------------------------------------

const SIG_SIDE = 48;
const FG_DISTANCE = 48;
const HIST_BINS = 4;
// Palette overlap below this means "a different object". Deliberately low: the
// same object under different light, or its back against its front, keeps well
// over half of its palette, and a wrong drop costs a view while a wrong keep
// costs a corrupted fusion, so only an unmistakable mismatch is acted on.
const SAME_SUBJECT_MIN_OVERLAP = 0.15;
// Less foreground than this is an empty frame, whatever colour it is filled with.
const MIN_FOREGROUND_FRACTION = 0.015;
const MIN_SIDE_PX = 128;
// A painted view keeps the primary's framing, so its canvas shape must too.
const MAX_ASPECT_DRIFT = 1.6;

async function loadSharp() {
	const { default: sharp } = await import('sharp');
	return sharp;
}

export async function loadViewBytes(url) {
	if (typeof url !== 'string' || !url) return null;
	if (isInlineImageRef(url)) {
		const comma = url.indexOf(',');
		if (comma < 0 || !url.slice(0, comma).includes(';base64')) return null;
		return Buffer.from(url.slice(comma + 1), 'base64');
	}
	const res = await fetchSafePublicUrl(
		url,
		{ signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
		{ maxBytes: MAX_VIEW_BYTES, timeoutMs: FETCH_TIMEOUT_MS },
	);
	if (!res.ok) return null;
	return Buffer.from(await res.arrayBuffer());
}

function median(values) {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[sorted.length >> 1];
}

// A small, background-independent description of a picture: its canvas, how
// much of it is subject, and the colour histogram of that subject. The
// background colour is estimated from the border ring (median per channel), so
// a white studio backdrop and a grey wall both drop out the same way.
export async function describeView(bytes) {
	const sharp = await loadSharp();
	const base = sharp(bytes, { failOn: 'none' }).rotate();
	const meta = await base.metadata();
	const width = meta.width || 0;
	const height = meta.height || 0;
	const { data, info } = await base
		.clone()
		.resize(SIG_SIDE, SIG_SIDE, { fit: 'fill' })
		.flatten({ background: '#ffffff' })
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const n = info.width * info.height;
	const ring = [[], [], []];
	for (let y = 0; y < info.height; y++) {
		for (let x = 0; x < info.width; x++) {
			if (x !== 0 && y !== 0 && x !== info.width - 1 && y !== info.height - 1) continue;
			const i = (y * info.width + x) * 3;
			ring[0].push(data[i]);
			ring[1].push(data[i + 1]);
			ring[2].push(data[i + 2]);
		}
	}
	const bg = ring.map(median);
	const hist = new Float64Array(HIST_BINS ** 3);
	let foreground = 0;
	let flat = true;
	for (let p = 0; p < n; p++) {
		const r = data[p * 3];
		const g = data[p * 3 + 1];
		const b = data[p * 3 + 2];
		if (Math.abs(r - bg[0]) > 2 || Math.abs(g - bg[1]) > 2 || Math.abs(b - bg[2]) > 2) flat = false;
		const dist = Math.hypot(r - bg[0], g - bg[1], b - bg[2]);
		if (dist <= FG_DISTANCE) continue;
		foreground++;
		const bin = (v) => Math.min(HIST_BINS - 1, Math.floor((v / 256) * HIST_BINS));
		hist[(bin(r) * HIST_BINS + bin(g)) * HIST_BINS + bin(b)]++;
	}
	if (foreground > 0) for (let i = 0; i < hist.length; i++) hist[i] /= foreground;
	return { width, height, foregroundFraction: foreground / n, flat, hist };
}

function overlap(a, b) {
	let sum = 0;
	for (let i = 0; i < a.length; i++) sum += Math.min(a[i], b[i]);
	return sum;
}

// Judge one candidate against the primary's description. `primary` may be null
// when the primary could not be read: the candidate is then judged on its own
// (blank, size) and the subject comparison is skipped rather than guessed.
export function judgeView(candidate, primary) {
	if (!candidate.width || !candidate.height) return { ok: false, reason: 'unreadable' };
	if (Math.min(candidate.width, candidate.height) < MIN_SIDE_PX) return { ok: false, reason: 'too_small' };
	if (candidate.flat || candidate.foregroundFraction < MIN_FOREGROUND_FRACTION) {
		return { ok: false, reason: 'blank' };
	}
	if (!primary) return { ok: true };
	const drift = Math.max(
		candidate.width / candidate.height / (primary.width / primary.height),
		primary.width / primary.height / (candidate.width / candidate.height),
	);
	if (drift > MAX_ASPECT_DRIFT) return { ok: false, reason: 'wrong_shape' };
	if (primary.foregroundFraction >= MIN_FOREGROUND_FRACTION) {
		if (overlap(candidate.hist, primary.hist) < SAME_SUBJECT_MIN_OVERLAP) {
			return { ok: false, reason: 'different_subject' };
		}
	}
	return { ok: true };
}

// Reads and judges every candidate against the primary. Resolves to one verdict
// per candidate, in order. A candidate whose bytes cannot be read is judged
// unreadable only when `dropUnreadable` is true (painted views: the file is ours
// and must exist), and kept otherwise (a user photo the bucket is slow to serve
// is the worker's to fetch, not ours to refuse).
export async function vetViews(primaryUrl, candidateUrls, { loadBytes = loadViewBytes, dropUnreadable = true } = {}) {
	let primary = null;
	try {
		const bytes = await loadBytes(primaryUrl);
		if (bytes) primary = await describeView(bytes);
	} catch {
		primary = null;
	}
	return Promise.all(
		candidateUrls.map(async (url) => {
			let described;
			try {
				const bytes = await loadBytes(url);
				if (!bytes) return dropUnreadable ? { url, ok: false, reason: 'unreadable' } : { url, ok: true };
				described = await describeView(bytes);
			} catch {
				return dropUnreadable ? { url, ok: false, reason: 'unreadable' } : { url, ok: true };
			}
			return { url, ...judgeView(described, primary) };
		}),
	);
}

const DROP_REASON_COPY = {
	unreadable: 'could not be read',
	too_small: 'was too small',
	blank: 'came back empty',
	wrong_shape: 'did not match the framing of the first view',
	different_subject: 'did not look like the same object as the first view',
};

export function dropReasonText(reason) {
	return DROP_REASON_COPY[reason] || 'was not usable';
}

// ---------------------------------------------------------------------------
// A set of the person's own photos
// ---------------------------------------------------------------------------

// Photos 2 to 4 are extra coverage of the object in photo 1. One that shows a
// different object, or nothing at all, does not add coverage: it votes for
// geometry that is not there. Those are left out and named, by position, so the
// message can say which photo. Judged on positive evidence only: a photo the
// check cannot read, or a check that runs out of time, keeps every photo.
export async function pruneMismatchedPhotos(urls, { loadBytes = loadViewBytes } = {}) {
	if (urls.length < 2) return { urls, dropped: [] };
	const run = await withinBudget(
		vetViews(urls[0], urls.slice(1), { loadBytes, dropUnreadable: false }),
		VETTING_BUDGET_MS,
	);
	if (run.timedOut || run.error) return { urls, dropped: [] };
	const kept = [urls[0]];
	const dropped = [];
	run.value.forEach((verdict, i) => {
		const dropIt = !verdict.ok && (verdict.reason === 'different_subject' || verdict.reason === 'blank');
		if (dropIt) dropped.push({ position: i + 2, url: verdict.url, reason: verdict.reason });
		else kept.push(verdict.url);
	});
	return { urls: kept, dropped };
}

// ---------------------------------------------------------------------------
// The optional turnaround step
// ---------------------------------------------------------------------------

// Paints side and back views of `referenceImageUrl` and returns the view list to
// reconstruct from. Always resolves; never throws; takes at most the budget plus
// the vetting allowance. `synthesize` is synthesizeTurnaroundViews, passed in so
// the caller's own module import (and its tests) stay the single seam.
//
// Returns { views, added, dropped, outcome }:
//   outcome 'added'       at least one painted view joined the fusion
//   outcome 'skipped'     the step did not apply (lane, tier, view count, inline view)
//   outcome 'none'        the painter answered with no views (lane off, throttled)
//   outcome 'failed'      the painter threw
//   outcome 'timed_out'   the painter did not answer within the budget
//   outcome 'rejected'    every painted view failed the checks
export async function extendWithTurnaroundViews({
	views,
	referenceImageUrl,
	backendId,
	tierId,
	synthesize,
	budgetMs = viewsBudgetMs(),
	loadBytes = loadViewBytes,
}) {
	const keep = (outcome, extra = {}) => ({ views, added: 0, dropped: [], outcome, ...extra });
	// An inline reference view (storage outage) is skipped on purpose: the painter
	// edits an image it fetches by URL, so it could only fail.
	if (
		!laneWantsTurnaroundViews(backendId, tierId) ||
		views.length !== 1 ||
		isInlineImageRef(referenceImageUrl)
	) {
		return keep('skipped');
	}
	const painted = await withinBudget(synthesize(referenceImageUrl), budgetMs);
	if (painted.timedOut) {
		console.warn(`[forge] turnaround views did not finish within ${budgetMs} ms; continuing with the single view`);
		return keep('timed_out');
	}
	if (painted.error) {
		console.warn(`[forge] turnaround views failed, continuing with the single view: ${painted.error?.message || painted.error}`);
		return keep('failed');
	}
	const candidates = Array.isArray(painted.value)
		? painted.value.filter((u) => typeof u === 'string' && u && u !== referenceImageUrl)
		: [];
	if (!candidates.length) return keep('none');

	const vetted = await withinBudget(vetViews(referenceImageUrl, candidates, { loadBytes }), VETTING_BUDGET_MS);
	// A vetting step that cannot finish cannot vouch for the views, and an
	// unvetted view is a risk the single image does not carry: drop them all.
	if (vetted.timedOut || vetted.error) {
		console.warn('[forge] could not check the painted views in time; continuing with the single view');
		return keep('failed');
	}
	const accepted = vetted.value.filter((v) => v.ok).map((v) => v.url);
	const dropped = vetted.value.filter((v) => !v.ok).map((v) => ({ url: v.url, reason: v.reason }));
	for (const d of dropped) {
		console.warn(`[forge] dropped a painted turnaround view (${d.reason})`);
	}
	if (!accepted.length) return keep('rejected', { dropped });
	return { views: [...views, ...accepted], added: accepted.length, dropped, outcome: 'added' };
}

// ---------------------------------------------------------------------------
// One image for the lanes that read one image
// ---------------------------------------------------------------------------

const FRONT_LABEL_RE = /^\s*front\s*$/i;

// The view a single-image lane is given. A labeled set (view_labels) names its
// front view, which shows the object best and is what every single-image model
// was trained on; without labels the first view is the one the person placed
// first, which the page labels Front.
export function pickPrimaryIndex(views, labels) {
	if (Array.isArray(labels) && labels.length === views.length) {
		const front = labels.findIndex((l) => typeof l === 'string' && FRONT_LABEL_RE.test(l));
		if (front >= 0) return front;
	}
	return 0;
}

// Narrows `views` to the single image a one-image lane reads. Returns the views
// to send, the number the caller supplied, and the sentence the page shows when
// photos were left out ('' when nothing was).
export function narrowToSingleView({ views, labels, backendId, engineLabel }) {
	const supplied = views.length;
	if (supplied <= 1 || !laneReadsOnlyOneView(backendId)) {
		return { views, supplied, used: supplied, note: '' };
	}
	const primary = views[pickPrimaryIndex(views, labels)];
	const name = engineLabel || 'This engine';
	return {
		views: [primary],
		supplied,
		used: 1,
		note: `${name} builds from a single photo, so only your front view was used. Pick Match my photo or the standard engine to use all ${supplied} photos.`,
	};
}

// One sentence for the page about photos the checks left out of the set.
export function droppedViewsNote(dropped, { total }) {
	if (!dropped.length) return '';
	const parts = dropped.map((d) => `photo ${d.position} ${dropReasonText(d.reason)}`);
	const left = total - dropped.length;
	return `Left out of the set: ${parts.join(', ')}. Building from the other ${left} ${left === 1 ? 'photo' : 'photos'}.`;
}

// The view-count fields a submit response carries, so a caller never has to
// guess how many of its photos reached the model. views_note and views_dropped
// are omitted (undefined) when nothing was left out.
export function viewsReport({ requested, used, note, dropped, multiview }) {
	return {
		views_requested: requested,
		views_used: used,
		multiview: typeof multiview === 'boolean' ? multiview : used > 1,
		views_note: note || undefined,
		views_dropped: dropped && dropped.length ? dropped.map((d) => ({ position: d.position, reason: d.reason })) : undefined,
	};
}
