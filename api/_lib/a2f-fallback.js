// Graceful degradation for Audio2Face-3D (api/a2f.js).
//
// NVIDIA's hosted A2F function is a free shared service: it rotates function
// ids, rate-limits the platform key, and goes down. A talking avatar must still
// speak with a moving mouth when it does, so this module holds everything the
// endpoint needs to answer without the service:
//
//   amplitudeTrack()   a per-frame ARKit mouth track computed from the audio
//                      itself (loudness drives the jaw, zero-crossing rate
//                      separates open vowels from narrow fricatives). Same
//                      shape as an A2F track, so every player takes it as is.
//   validateA2fTrack() the checks a track from the service must pass before it
//                      reaches a face: names, row width, range, time order, and
//                      a frame count that matches the audio length.
//   a2fBudgetMs()      the firm time budget for one A2F call.
//   a2fBreaker         a per-instance circuit breaker: after repeated service
//                      failures the endpoint stops calling NVIDIA for a cooldown
//                      and goes straight to the fallback, then lets exactly one
//                      probe through. Probe failures back the cooldown off.

const FPS = 30;

// ARKit names in the PascalCase A2F itself emits, so a fallback track and a real
// track are interchangeable for src/voice/a2f-player.js (canonicalARKitName).
export const FALLBACK_BLENDSHAPES = [
	'JawOpen',
	'MouthClose',
	'MouthFunnel',
	'MouthPucker',
	'MouthStretchLeft',
	'MouthStretchRight',
	'MouthLowerDownLeft',
	'MouthLowerDownRight',
	'MouthUpperUpLeft',
	'MouthUpperUpRight',
];

export const FALLBACK_MODEL = 'amplitude-fallback';

const round3 = (v) => Math.round(v * 1000) / 1000;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Mouth animation from mono 16-bit PCM, computed locally.
 * @param {Int16Array} mono
 * @param {number} sampleRateHz
 * @returns {{ fps, blendShapeNames, frames: Array<{t:number,w:number[]}>, frameCount, durationSec, model, source }}
 */
export function amplitudeTrack(mono, sampleRateHz) {
	const rate = Number(sampleRateHz) > 0 ? Number(sampleRateHz) : 16000;
	const durationSec = mono.length / rate;
	const hop = rate / FPS;
	const count = Math.max(1, Math.round(durationSec * FPS) + 1);

	// Per-frame loudness (RMS) and zero-crossing rate over a window centered on
	// each frame time.
	const rms = new Float64Array(count);
	const zcr = new Float64Array(count);
	const half = Math.max(1, Math.round(hop));
	for (let f = 0; f < count; f++) {
		const c = Math.round(f * hop);
		const a = Math.max(0, c - half);
		const b = Math.min(mono.length, c + half);
		let sum = 0;
		let crossings = 0;
		for (let i = a; i < b; i++) {
			const s = mono[i] / 32768;
			sum += s * s;
			if (i > a && (mono[i] >= 0) !== (mono[i - 1] >= 0)) crossings++;
		}
		const n = b - a;
		rms[f] = n > 0 ? Math.sqrt(sum / n) : 0;
		zcr[f] = n > 1 ? crossings / (n - 1) : 0;
	}

	// Normalize to the loud end of THIS clip (95th percentile) so a quiet voice
	// still opens the mouth, and gate out room noise below an absolute floor.
	const sorted = Array.from(rms).sort((x, y) => x - y);
	const ref = Math.max(sorted[Math.floor(0.95 * (sorted.length - 1))], 1e-4);
	const GATE = 0.012; // about -38 dBFS
	const env = new Float64Array(count);
	let prev = 0;
	for (let f = 0; f < count; f++) {
		const target = rms[f] < GATE ? 0 : clamp01((rms[f] - GATE) / Math.max(ref - GATE, 1e-4));
		// Fast attack, slower release: jaws snap open and settle shut.
		const k = target > prev ? 0.7 : 0.35;
		prev = prev + (target - prev) * k;
		if (prev < 0.02) prev = target === 0 ? 0 : prev;
		env[f] = prev;
	}

	const frames = new Array(count);
	for (let f = 0; f < count; f++) {
		const e = env[f];
		// Zero-crossing rate maps fricatives (s, f, sh: high) to a narrow, wide
		// mouth and voiced vowels (low) to an open, slightly rounded one.
		const fric = clamp01((zcr[f] - 0.08) / 0.25);
		const jaw = e * (0.85 - 0.5 * fric);
		const stretch = e * (0.15 + 0.45 * fric);
		const round = e * 0.3 * (1 - fric);
		const lower = e * 0.35;
		const upper = e * 0.2 * fric;
		frames[f] = {
			t: round3(f / FPS),
			w: [
				jaw,
				e === 0 ? 0.08 : 0, // lips meet at rest
				round,
				round * 0.6,
				stretch,
				stretch,
				lower,
				lower,
				upper,
				upper,
			].map((v) => round3(clamp01(v))),
		};
	}
	return {
		fps: FPS,
		blendShapeNames: FALLBACK_BLENDSHAPES.slice(),
		frames,
		frameCount: frames.length,
		durationSec,
		sampleRateHz: rate,
		model: FALLBACK_MODEL,
		source: 'fallback',
		emotion: null,
	};
}

const canon = (n) => String(n).toLowerCase().replace(/[^a-z]/g, '');

/**
 * Checks a track must pass before it drives a face.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateA2fTrack(track, audioSeconds) {
	const bad = (reason) => ({ ok: false, reason });
	if (!track || typeof track !== 'object') return bad('no track');
	const names = track.blendShapeNames;
	if (!Array.isArray(names) || !names.length) return bad('no blendshape names');
	if (!names.every((n) => typeof n === 'string' && n)) return bad('a blendshape name is not a string');
	if (!names.some((n) => canon(n) === 'jawopen')) return bad('no JawOpen channel');
	const frames = track.frames;
	if (!Array.isArray(frames) || !frames.length) return bad('no frames');
	const width = names.length;
	let lastT = -Infinity;
	for (let i = 0; i < frames.length; i++) {
		const fr = frames[i];
		const t = fr?.t;
		if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) return bad(`frame ${i} has no valid time`);
		if (t < lastT) return bad(`frame ${i} time goes backwards`);
		lastT = t;
		if (!Array.isArray(fr.w) || fr.w.length !== width)
			return bad(`frame ${i} width ${fr.w?.length ?? 0} does not match ${width} names`);
		for (const v of fr.w) {
			// A2F overshoots by a hair on some channels; anything further is garbage.
			if (typeof v !== 'number' || !Number.isFinite(v) || v < -0.05 || v > 1.05)
				return bad(`frame ${i} has a weight out of range`);
		}
	}
	const secs = Number(audioSeconds);
	if (Number.isFinite(secs) && secs > 0) {
		const fps = Number(track.fps) || FPS;
		if (fps < 10 || fps > 120) return bad(`fps ${fps} is not plausible`);
		const expected = secs * fps;
		// Allow for A2F's lead-in and trailing frames, but not a track that
		// covers a fraction of the speech or runs on far past it.
		if (frames.length < expected * 0.8 - 2 || frames.length > expected * 1.25 + 4)
			return bad(`${frames.length} frames for ${secs.toFixed(2)}s of audio at ${fps} fps`);
		if (lastT > secs + 1) return bad(`track runs ${(lastT - secs).toFixed(2)}s past the audio`);
	}
	return { ok: true };
}

// Base covers channel setup and auth on a cold NVCF call; A2F itself runs at
// least as fast as the audio plays, so one second per second of speech.
const BUDGET_BASE_MS = 6000;
const BUDGET_PER_SEC_MS = 1000;
const BUDGET_MAX_MS = 40_000;

/** Firm budget for one A2F call on a clip of `audioSeconds`. */
export function a2fBudgetMs(audioSeconds) {
	const s = Number(audioSeconds);
	const secs = Number.isFinite(s) && s > 0 ? s : 0;
	return Math.min(BUDGET_MAX_MS, Math.round(BUDGET_BASE_MS + secs * BUDGET_PER_SEC_MS));
}

// Codes that say the SERVICE is unhealthy. Bad input and a client hanging up
// say nothing about NVIDIA and never trip the breaker.
const SERVICE_FAILURES = new Set([
	'timeout',
	'provider_unreachable',
	'provider_error',
	'function_not_found',
	'rate_limited',
	'invalid_key',
	'malformed_track',
]);
export const isServiceFailure = (code) => SERVICE_FAILURES.has(code || 'provider_error');

/**
 * Closed -> (threshold failures in a row) -> open -> (cooldown) -> half-open:
 * one probe. Probe success closes; probe failure re-opens with the cooldown
 * doubled up to maxCooldownMs. A probe that never reports back is forgotten
 * after probeTimeoutMs so the breaker cannot wedge half-open.
 */
export function createA2fBreaker({
	threshold = 3,
	cooldownMs = 30_000,
	maxCooldownMs = 5 * 60_000,
	probeTimeoutMs = 45_000,
	now = Date.now,
} = {}) {
	let state = 'closed';
	let failures = 0;
	let openedAt = 0;
	let cooldown = cooldownMs;
	let probeAt = 0;
	let lastCode = null;

	return {
		allow() {
			const t = now();
			if (state === 'closed') return true;
			if (state === 'open') {
				if (t - openedAt < cooldown) return false;
				state = 'half_open';
				probeAt = t;
				return true;
			}
			// half_open: a probe is in flight.
			if (t - probeAt > probeTimeoutMs) {
				probeAt = t;
				return true;
			}
			return false;
		},
		success() {
			state = 'closed';
			failures = 0;
			cooldown = cooldownMs;
			lastCode = null;
		},
		failure(code) {
			lastCode = code || 'provider_error';
			if (state === 'half_open') {
				cooldown = Math.min(maxCooldownMs, cooldown * 2);
				state = 'open';
				openedAt = now();
				return;
			}
			failures++;
			if (failures >= threshold) {
				state = 'open';
				openedAt = now();
			}
		},
		retryAfterSec() {
			if (state !== 'open') return 0;
			return Math.max(1, Math.ceil((cooldown - (now() - openedAt)) / 1000));
		},
		state() {
			return {
				state,
				failures,
				cooldownMs: cooldown,
				lastCode,
				retryAfterSec: this.retryAfterSec(),
			};
		},
		reset() {
			state = 'closed';
			failures = 0;
			cooldown = cooldownMs;
			openedAt = 0;
			probeAt = 0;
			lastCode = null;
		},
	};
}

// One breaker per warm instance, shared by every request it serves.
export const a2fBreaker = createA2fBreaker();
