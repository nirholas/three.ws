// Talking-avatar clip limits: how long a clip may be and how many a principal
// may make per day, by plan.
//
// A clip spends two NVIDIA calls (Magpie TTS, then Audio2Face-3D) on the
// server, so both the per-day count and the per-clip duration are enforced in
// api/clips/voice.js before any upstream call. The browser does the render and
// the encode, which costs the platform nothing, so only the voice + face legs
// are metered.
//
// `users.plan` is one of free | pro | team | enterprise (api/_lib/schema.sql,
// plan_quotas). Anonymous visitors get a small per-IP allowance so the "Make a
// clip" button works for anyone landing on an agent page.

export const CLIP_PLANS = Object.freeze({
	anonymous: Object.freeze({ perDay: 3, maxSeconds: 20 }),
	free: Object.freeze({ perDay: 10, maxSeconds: 30 }),
	pro: Object.freeze({ perDay: 60, maxSeconds: 60 }),
	team: Object.freeze({ perDay: 200, maxSeconds: 60 }),
	enterprise: Object.freeze({ perDay: 1000, maxSeconds: 60 }),
});

// Magpie speaks English at roughly 14 to 16 characters per second. The text cap
// is set a little above that so a line that fits the duration cap is never
// refused on length alone; the measured duration check after synthesis is the
// authoritative one.
export const CHARS_PER_SECOND = 18;

// Audio2Face-3D's own ceiling (api/_lib/a2f-nvidia.js MAX_AUDIO_SECONDS).
export const A2F_MAX_SECONDS = 60;

/**
 * Resolve the clip policy for a principal.
 * @param {{ signedIn: boolean, plan?: string|null }} who
 * @returns {{ plan: string, perDay: number, maxSeconds: number, maxChars: number }}
 */
export function clipPolicy({ signedIn, plan } = {}) {
	const key = !signedIn ? 'anonymous' : CLIP_PLANS[String(plan || '').toLowerCase()] ? String(plan).toLowerCase() : 'free';
	const p = CLIP_PLANS[key];
	const maxSeconds = Math.min(p.maxSeconds, A2F_MAX_SECONDS);
	return { plan: key, perDay: p.perDay, maxSeconds, maxChars: maxCharsFor(maxSeconds) };
}

/** Longest text accepted for a given duration cap. */
export function maxCharsFor(maxSeconds) {
	return Math.round(Math.max(1, Number(maxSeconds) || 0) * CHARS_PER_SECOND);
}

/**
 * Duration in seconds of header-less mono s16 PCM at `sampleRateHz`.
 * @param {number} byteLength
 * @param {number} sampleRateHz
 */
export function pcmDurationSec(byteLength, sampleRateHz, channels = 1) {
	const rate = Number(sampleRateHz) || 0;
	if (rate <= 0) return 0;
	return Math.floor((Number(byteLength) || 0) / (2 * Math.max(1, channels))) / rate;
}
