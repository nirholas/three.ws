// Push-to-talk audio cleanup for a noisy room (a conference booth).
//
// The microphone already runs the browser's echo cancellation, noise
// suppression and auto gain (MicCapture). What it cannot know is where the
// visitor's words are inside the press: a booth press usually opens with the
// hand still moving and ends with crowd noise. This gate measures the noise
// floor of the press itself, keeps only the span where the level clearly rises
// above it (plus a little padding so plosives survive), and rejects a press
// that holds no speech at all, so ASR is never asked to transcribe the hall.

const FRAME_MS = 20;
const PAD_MS = 160;
const MIN_SPEECH_MS = 280;
const ABS_MIN_RMS = 0.012; // about -38 dBFS: quieter than this is not a voice at arm's length
const FLOOR_RATIO = 2.6; // speech must clear the press's own noise floor by ~8 dB

function frameRms(samples, start, len) {
	let sum = 0;
	for (let i = start; i < start + len; i++) {
		const v = samples[i] / 32768;
		sum += v * v;
	}
	return Math.sqrt(sum / len);
}

/**
 * @param {Int16Array} samples mono PCM
 * @param {number} sampleRate
 * @returns {{ ok: true, samples: Int16Array, speechMs: number, trimmedMs: number, floor: number, threshold: number }
 *          | { ok: false, reason: 'too_short' | 'no_speech', speechMs: number, floor: number, threshold: number }}
 */
export function gateUtterance(samples, sampleRate) {
	const frame = Math.max(1, Math.round((sampleRate * FRAME_MS) / 1000));
	const n = Math.floor(samples.length / frame);
	if (n < 3)
		return { ok: false, reason: 'too_short', speechMs: 0, floor: 0, threshold: ABS_MIN_RMS };

	const rms = new Float32Array(n);
	for (let f = 0; f < n; f++) rms[f] = frameRms(samples, f * frame, frame);
	const sorted = Array.from(rms).sort((a, b) => a - b);
	const floor = sorted[Math.floor(n * 0.15)];
	const threshold = Math.max(ABS_MIN_RMS, floor * FLOOR_RATIO);

	let first = -1;
	let last = -1;
	let voiced = 0;
	for (let f = 0; f < n; f++) {
		if (rms[f] >= threshold) {
			voiced++;
			if (first < 0) first = f;
			last = f;
		}
	}
	const speechMs = voiced * FRAME_MS;
	if (first < 0 || speechMs < MIN_SPEECH_MS) {
		return {
			ok: false,
			reason: first < 0 ? 'no_speech' : 'too_short',
			speechMs,
			floor,
			threshold,
		};
	}
	const pad = Math.round(PAD_MS / FRAME_MS);
	const from = Math.max(0, first - pad) * frame;
	const to = Math.min(samples.length, (last + 1 + pad) * frame);
	return {
		ok: true,
		samples: samples.subarray(from, to),
		speechMs,
		trimmedMs: Math.round(((samples.length - (to - from)) / sampleRate) * 1000),
		floor,
		threshold,
	};
}

/** 16-bit mono RIFF/WAVE bytes for `samples`. */
export function encodeWav(samples, sampleRate) {
	const buf = new ArrayBuffer(44 + samples.length * 2);
	const v = new DataView(buf);
	const str = (o, s) => {
		for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
	};
	str(0, 'RIFF');
	v.setUint32(4, 36 + samples.length * 2, true);
	str(8, 'WAVE');
	str(12, 'fmt ');
	v.setUint32(16, 16, true);
	v.setUint16(20, 1, true);
	v.setUint16(22, 1, true);
	v.setUint32(24, sampleRate, true);
	v.setUint32(28, sampleRate * 2, true);
	v.setUint16(32, 2, true);
	v.setUint16(34, 16, true);
	str(36, 'data');
	v.setUint32(40, samples.length * 2, true);
	new Int16Array(buf, 44).set(samples);
	return new Uint8Array(buf);
}

/** Parse a 16-bit PCM mono/stereo WAV (first channel) into { samples, sampleRate }. */
export function decodeWav(bytes) {
	const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
	const tag = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
	if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
	let off = 12;
	let rate = 16000;
	let channels = 1;
	let bits = 16;
	while (off + 8 <= u8.length) {
		const id = tag(off);
		const size = v.getUint32(off + 4, true);
		if (id === 'fmt ') {
			channels = v.getUint16(off + 10, true);
			rate = v.getUint32(off + 12, true);
			bits = v.getUint16(off + 22, true);
		} else if (id === 'data') {
			if (bits !== 16) throw new Error(`unsupported WAV bit depth ${bits}`);
			const end = Math.min(u8.length, off + 8 + size);
			const frames = Math.floor((end - off - 8) / (2 * channels));
			const out = new Int16Array(frames);
			for (let i = 0; i < frames; i++) out[i] = v.getInt16(off + 8 + i * 2 * channels, true);
			return { samples: out, sampleRate: rate };
		}
		off += 8 + size + (size % 2);
	}
	throw new Error('WAV has no data chunk');
}
