// Hero clips: a short Grok Imagine Video clip made from real renders of a
// user's own model (docs/hero-clips.md).
//
// This module holds everything the endpoint, the clip page and the tests share:
// the four style presets and their prompts, the allowed durations, the signed
// job token a caller polls with, and the copy for every failure a caller can
// see. No DB table: the job lives at xAI until it finishes and in our object
// store after that, and the token carries the rest, signed so nobody can poll
// someone else's request id or rewrite the owner.

import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from './env.js';

// ── presets ────────────────────────────────────────────────────────────────

// Appended to every preset. The first frame and the reference images are
// real renders, so the model's job is camera and light, never a redesign.
export const FIDELITY_CLAUSE =
	'Keep the model exactly as it appears in the first frame and the reference renders: same shape, proportions, colours and materials. ' +
	'Do not add, remove or redesign any part. No text, no logos, no people, no extra objects.';

export const HERO_CLIP_PRESETS = Object.freeze([
	Object.freeze({
		id: 'turntable',
		label: 'Turntable',
		description: 'A level studio camera while the model turns a full circle.',
		loop: true,
		direction:
			'Studio turntable of the 3D model shown in the first frame. The camera stays level and locked off while the model rotates a full 360 degrees clockwise at one steady speed on an invisible turntable, ending where it started. ' +
			'Plain dark seamless backdrop, soft even three-point lighting, a gentle contact shadow under the model.',
	}),
	Object.freeze({
		id: 'hero_push_in',
		label: 'Hero push-in',
		description: 'A slow cinematic push toward the model, ending close and low.',
		loop: false,
		direction:
			'Cinematic hero shot of the 3D model shown in the first frame. The camera starts wide and pushes in slowly and smoothly toward the model, drifting slightly lower so the model feels powerful, and settles on a close three-quarter view. ' +
			'Shallow depth of field, warm key light, cool rim light outlining the silhouette, faint atmospheric haze in a dark backdrop.',
	}),
	Object.freeze({
		id: 'light_sweep',
		label: 'Dramatic light sweep',
		description: 'The model holds still while a hard light rakes across it.',
		loop: false,
		direction:
			'Dramatic light sweep over the 3D model shown in the first frame. The model and the camera stay completely still while a single hard key light travels from left to right across the model, raking over its surfaces and revealing form and material detail, with crisp specular highlights sliding along its edges. ' +
			'Deep shadows, a near-black backdrop, a trace of haze catching the beam.',
	}),
	Object.freeze({
		id: 'product_reveal',
		label: 'Product reveal',
		description: 'Out of darkness, rim lights up, then a quarter orbit.',
		loop: false,
		direction:
			'Premium product reveal of the 3D model shown in the first frame. The model starts in near darkness, rim lights fade up to trace its silhouette, then soft fill light brings out its materials while the camera arcs a slow quarter turn around it. ' +
			'Glossy dark floor with a subtle reflection, clean studio look.',
	}),
]);

export const DEFAULT_PRESET = 'turntable';
const PRESET_BY_ID = new Map(HERO_CLIP_PRESETS.map((p) => [p.id, p]));

export function heroClipPreset(id) {
	return PRESET_BY_ID.get(id) || null;
}

// Short and predictable on purpose: every second is billed. The lite model
// renders up to 15 s, but a hero clip that loops on a profile reads best short.
export const HERO_CLIP_DURATIONS = Object.freeze([4, 6, 8, 10]);
export const DEFAULT_DURATION = 6;

// A model title is the creator's own text; it is a subject hint for the video
// model, never instructions. Quotes and control characters go, length is capped.
export function subjectHint(title) {
	const clean = String(title ?? '')
		.replace(/[\u0000-\u001f\u007f"`\\]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 80)
		.trim();
	return clean;
}

/**
 * The full prompt for one preset.
 * @param {string} presetId
 * @param {{title?:string}} [opts]
 */
export function presetPrompt(presetId, { title } = {}) {
	const preset = heroClipPreset(presetId);
	if (!preset) throw Object.assign(new Error(`unknown preset "${presetId}"`), { status: 400, code: 'invalid_args' });
	const subject = subjectHint(title);
	return [preset.direction, subject ? `The model is titled "${subject}".` : '', FIDELITY_CLAUSE].filter(Boolean).join(' ');
}

/** The public shape of the presets, for the UI and GET responses. */
export function publicPresets() {
	return HERO_CLIP_PRESETS.map(({ id, label, description, loop }) => ({ id, label, description, loop }));
}

// ── daily cap ──────────────────────────────────────────────────────────────

export const DEFAULT_DAILY_CAP = 5;

/** Clips per account per 24 h, from HERO_CLIP_DAILY_CAP (1 to 100). */
export function heroClipDailyCap(raw = env.HERO_CLIP_DAILY_CAP) {
	const n = Number(raw);
	return Number.isInteger(n) && n >= 1 && n <= 100 ? n : DEFAULT_DAILY_CAP;
}

// ── job token ──────────────────────────────────────────────────────────────

// A job xAI has not finished in this long is reported as timed out. xAI's own
// jobs settle in a minute or two; the margin covers a slow queue.
export const JOB_TIMEOUT_MS = 15 * 60 * 1000;

function sign(payload) {
	return createHmac('sha256', env.JWT_SECRET).update(`hc1:${payload}`).digest('base64url');
}

/**
 * Sign a hero-clip job handle.
 * @param {object} job
 * @param {string} job.requestId xAI request id
 * @param {string} job.userId owner
 * @param {'lite'|'full'} job.tier
 * @param {string} job.preset
 * @param {number} job.seconds
 * @param {{kind:string, id:string|null, title:string, page:string|null}} job.source
 * @param {string} [job.poster] absolute URL of the first-frame render
 * @param {number} [job.createdAt]
 */
export function encodeHeroClipJob({ requestId, userId, tier, preset, seconds, source, poster = null, createdAt = Date.now() }) {
	const payload = Buffer.from(
		JSON.stringify({ r: requestId, u: userId, t: tier, p: preset, s: seconds, src: source, po: poster, c: createdAt }),
		'utf8',
	).toString('base64url');
	return `hc1.${payload}.${sign(payload)}`;
}

/** The job a token names, or null for anything unsigned, tampered or malformed. */
export function decodeHeroClipJob(token) {
	if (typeof token !== 'string' || token.length > 4096 || !token.startsWith('hc1.')) return null;
	const parts = token.split('.');
	if (parts.length !== 3 || !parts[1] || !parts[2]) return null;
	const [, payload, sig] = parts;
	try {
		const expected = Buffer.from(sign(payload), 'utf8');
		const actual = Buffer.from(sig, 'utf8');
		if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
		const o = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
		if (!o?.r || !o?.u || !heroClipPreset(o.p)) return null;
		return {
			requestId: String(o.r),
			userId: String(o.u),
			tier: o.t === 'full' ? 'full' : 'lite',
			preset: o.p,
			seconds: Number(o.s) || DEFAULT_DURATION,
			source: o.src && typeof o.src === 'object' ? o.src : { kind: 'url', id: null, title: '', page: null },
			poster: typeof o.po === 'string' ? o.po : null,
			createdAt: Number(o.c) || 0,
		};
	} catch {
		return null;
	}
}

// ── failure copy ───────────────────────────────────────────────────────────

// Every XaiVideoError code mapped to the HTTP status and the sentence a person
// reads. `retry` says whether trying again can help without changing anything.
const FAILURES = Object.freeze({
	not_configured: {
		status: 503,
		error: 'clips_unavailable',
		message: 'Hero clips are not available yet. The turntable below is built from real renders of your model.',
		retry: false,
	},
	unauthorized: {
		status: 503,
		error: 'clips_unavailable',
		message: 'Hero clips are paused while the video service is reconnected. Try again later.',
		retry: true,
	},
	rate_limited: {
		status: 429,
		error: 'video_busy',
		message: 'The video service is at capacity right now. Wait a minute and try again.',
		retry: true,
	},
	refused: {
		status: 422,
		error: 'clip_refused',
		message: 'The video model declined this clip under its content policy. Try a different preset, or a different model.',
		retry: false,
	},
	bad_request: {
		status: 422,
		error: 'clip_rejected',
		message: 'The video service could not use this model\'s renders. Try a different preset or a shorter clip.',
		retry: false,
	},
	unavailable: {
		status: 503,
		error: 'video_unavailable',
		message: 'The video service is temporarily unavailable. Try again in a few minutes.',
		retry: true,
	},
	timeout: {
		status: 504,
		error: 'clip_timeout',
		message: 'This clip took too long to finish and was abandoned. Try again; most clips finish in under two minutes.',
		retry: true,
	},
	failed: {
		status: 502,
		error: 'clip_failed',
		message: 'The video service could not finish this clip. Try again.',
		retry: true,
	},
});

/** Status, error code, human message and retry hint for a failure code. */
export function heroClipFailure(code) {
	return FAILURES[code] || FAILURES.failed;
}

// ── links ──────────────────────────────────────────────────────────────────

/** The public page for a finished clip. */
export function clipPagePath(requestId) {
	return `/hero-clip/${encodeURIComponent(requestId)}`;
}

/** The share text for X: what the clip is and where it lives. */
export function clipShareText(title) {
	const subject = subjectHint(title);
	return subject ? `${subject}, a hero clip made from my 3D model on three.ws` : 'A hero clip made from my 3D model on three.ws';
}
