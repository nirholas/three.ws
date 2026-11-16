// Pure timing and layout math for talking-avatar clips (src/clip/clip-renderer.js).
//
// The renderer is offline and frame-stepped: video frame i is drawn for the
// presentation time i / fps, and the avatar's face is posed from the
// Audio2Face-3D track sampled at the matching speech time. Audio is laid into
// the output starting at the same lead-in offset, so frame i and the audio
// sample at i / fps describe the same instant. Everything here is
// deterministic so the sync can be tested without a browser.

export const CLIP_FPS = 30;
// A short beat before the first word and after the last one, so a clip never
// starts or ends mid-syllable.
export const LEAD_IN_SEC = 0.3;
export const TAIL_SEC = 0.6;

export const ASPECTS = Object.freeze({
	portrait: Object.freeze({ id: 'portrait', label: 'Portrait 9:16', width: 1080, height: 1920 }),
	landscape: Object.freeze({ id: 'landscape', label: 'Landscape 16:9', width: 1920, height: 1080 }),
});

// How much of the avatar the camera frames. `fill` is the fraction of the frame
// height the framed span occupies; `span` names the vertical range.
export const FRAMINGS = Object.freeze({
	face: Object.freeze({ id: 'face', label: 'Close-up', fill: 0.62 }),
	bust: Object.freeze({ id: 'bust', label: 'Head and shoulders', fill: 0.78 }),
	full: Object.freeze({ id: 'full', label: 'Full body', fill: 0.86 }),
});

/**
 * Timeline for a clip whose speech lasts `speechSec`.
 * @returns {{ fps:number, leadIn:number, tail:number, durationSec:number, frameCount:number }}
 */
export function clipTimeline(speechSec, { fps = CLIP_FPS, leadIn = LEAD_IN_SEC, tail = TAIL_SEC } = {}) {
	const speech = Math.max(0, Number(speechSec) || 0);
	const durationSec = leadIn + speech + tail;
	// Round up so the last audio sample always has a frame on screen.
	const frameCount = Math.max(1, Math.ceil(durationSec * fps - 1e-9));
	return { fps, leadIn, tail, durationSec: frameCount / fps, frameCount };
}

/** Presentation time (seconds) of video frame `i`. */
export function frameTime(i, fps = CLIP_FPS) {
	return i / fps;
}

/** Duration of one video frame (seconds). */
export function frameDuration(fps = CLIP_FPS) {
	return 1 / fps;
}

/**
 * Speech-relative time to sample the face track at for video frame `i`.
 * Negative during the lead-in, past the speech end during the tail; the A2F
 * sampler clamps both to the first and last frame of the track.
 */
export function speechTimeForFrame(i, timeline) {
	return frameTime(i, timeline.fps) - timeline.leadIn;
}

/** Output-audio sample index where the speech audio begins. */
export function audioOffsetSamples(timeline, sampleRate) {
	return Math.round(timeline.leadIn * sampleRate);
}

/** Output-audio buffer length (samples) covering the whole clip. */
export function audioLengthSamples(timeline, sampleRate) {
	return Math.round(timeline.durationSec * sampleRate);
}

/** Float [-1, 1] samples to little-endian s16 bytes. */
export function floatToPcm16(samples) {
	const pcm = new Int16Array(samples.length);
	for (let i = 0; i < samples.length; i++) {
		pcm[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)));
	}
	return new Uint8Array(pcm.buffer);
}

/**
 * RMS envelope of mono samples at `fps` windows (one value per video frame).
 * Window k covers [k / fps, (k + 1) / fps).
 */
export function rmsEnvelope(samples, sampleRate, fps = CLIP_FPS) {
	const hop = sampleRate / fps;
	const n = Math.floor(samples.length / hop);
	const out = new Float32Array(n);
	for (let k = 0; k < n; k++) {
		const a = Math.round(k * hop);
		const b = Math.min(samples.length, Math.round((k + 1) * hop));
		let s = 0;
		for (let i = a; i < b; i++) s += samples[i] * samples[i];
		out[k] = Math.sqrt(s / Math.max(1, b - a));
	}
	return out;
}

/**
 * First and last moment (seconds) the speech is audible: where the 1/fps RMS
 * envelope rises above `rel` of its peak.
 */
export function voicedSpan(samples, sampleRate, { fps = CLIP_FPS, rel = 0.08 } = {}) {
	const env = rmsEnvelope(samples, sampleRate, fps);
	let peak = 0;
	for (const v of env) if (v > peak) peak = v;
	const total = samples.length / sampleRate;
	if (peak <= 0) return { start: 0, end: total };
	const gate = peak * rel;
	let first = 0;
	while (first < env.length && env[first] < gate) first++;
	let last = env.length - 1;
	while (last > first && env[last] < gate) last--;
	return { start: first / fps, end: Math.min(total, (last + 1) / fps) };
}

/**
 * Split a line into caption cues and time them across the voiced span in
 * proportion to their length (characters approximate spoken duration).
 * @returns {Array<{ text:string, start:number, end:number }>} speech-relative seconds
 */
export function captionCues(text, span, { maxChars = 34 } = {}) {
	const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
	if (!words.length) return [];
	const chunks = [];
	let cur = '';
	for (const w of words) {
		const next = cur ? `${cur} ${w}` : w;
		// Break after sentence punctuation so a cue never straddles two sentences.
		if (cur && (next.length > maxChars || /[.!?]$/.test(cur))) {
			chunks.push(cur);
			cur = w;
		} else {
			cur = next;
		}
	}
	if (cur) chunks.push(cur);
	const weight = (c) => c.replace(/[^\p{L}\p{N}]/gu, '').length + 1;
	const total = chunks.reduce((s, c) => s + weight(c), 0);
	const length = Math.max(0, span.end - span.start);
	const cues = [];
	let t = span.start;
	for (const c of chunks) {
		const d = (weight(c) / total) * length;
		cues.push({ text: c, start: t, end: t + d });
		t += d;
	}
	return cues;
}

/** The cue showing at speech time `t`, or null between and outside cues. */
export function cueAt(cues, t) {
	for (const c of cues) if (t >= c.start && t < c.end) return c;
	return null;
}

/**
 * Camera distance so a span of `height` world units fills `fill` of the frame
 * height with a vertical field of view of `fovDeg`.
 */
export function cameraDistanceForHeight(height, fovDeg, fill) {
	const half = (fovDeg * Math.PI) / 360;
	return (Math.max(1e-6, height) / Math.max(0.05, fill)) / (2 * Math.tan(half));
}

/**
 * Vertical span (world units, low to high) a framing preset shows, given the
 * avatar's floor, top and head centre heights.
 */
export function framingSpan(framing, { floorY, topY, headY }) {
	const headSize = Math.max(0.05, (topY - headY) * 2);
	if (framing === 'face') return { low: headY - headSize * 0.75, high: topY + headSize * 0.12 };
	if (framing === 'bust') return { low: headY - headSize * 2.1, high: topY + headSize * 0.2 };
	return { low: floorY, high: topY + (topY - floorY) * 0.04 };
}

/**
 * Integer lag (in samples of `a`/`b`) that maximises the normalised
 * cross-correlation of two equally sampled signals, searched in
 * [-maxLag, maxLag]. A positive lag means `b` trails `a`.
 * @returns {{ lag:number, score:number }}
 */
export function bestLag(a, b, maxLag) {
	const n = Math.min(a.length, b.length);
	const mean = (x) => {
		let s = 0;
		for (let i = 0; i < n; i++) s += x[i];
		return s / Math.max(1, n);
	};
	const ma = mean(a);
	const mb = mean(b);
	let best = { lag: 0, score: -Infinity };
	for (let lag = -maxLag; lag <= maxLag; lag++) {
		let num = 0;
		let da = 0;
		let db = 0;
		for (let i = 0; i < n; i++) {
			const j = i + lag;
			if (j < 0 || j >= n) continue;
			const x = a[i] - ma;
			const y = b[j] - mb;
			num += x * y;
			da += x * x;
			db += y * y;
		}
		const score = da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
		if (score > best.score) best = { lag, score };
	}
	return best;
}

/** A filesystem-safe clip file name from an agent name. */
export function clipFileName(name, aspect) {
	const base = String(name || 'avatar')
		.normalize('NFKD')
		.replace(/[^\w\s-]/g, '')
		.trim()
		.replace(/\s+/g, '-')
		.toLowerCase()
		.slice(0, 48) || 'avatar';
	return `${base}-clip-${aspect}.mp4`;
}
