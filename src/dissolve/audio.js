// Microphone to three smoothed energy levels (bass, mid, treble) that pump the
// particle storm. The mic is opt-in, nothing is recorded and nothing leaves the
// page: the analyser reads frequency bins and the page keeps only the numbers.

/**
 * Mean energy, 0..1, of the bins between two frequencies.
 * `bins` is an analyser byte spectrum (0..255 per bin).
 */
export function bandLevel(bins, sampleRate, lowHz, highHz) {
	if (!bins || bins.length === 0) return 0;
	const hzPerBin = sampleRate / 2 / bins.length;
	const from = Math.max(0, Math.floor(lowHz / hzPerBin));
	const to = Math.min(bins.length - 1, Math.max(from, Math.ceil(highHz / hzPerBin)));
	let sum = 0;
	for (let i = from; i <= to; i++) sum += bins[i];
	return sum / ((to - from + 1) * 255);
}

/** Bass, mid and treble for one spectrum. */
export function bandLevels(bins, sampleRate) {
	return {
		bass: bandLevel(bins, sampleRate, 20, 160),
		mid: bandLevel(bins, sampleRate, 160, 2000),
		treble: bandLevel(bins, sampleRate, 2000, 9000),
	};
}

/** One-pole smoother: fast attack so a kick lands, slow release so it breathes. */
export function smoothLevel(previous, next, attack = 0.55, release = 0.12) {
	const k = next > previous ? attack : release;
	return previous + (next - previous) * k;
}

export class MicLevels {
	constructor() {
		this.levels = { bass: 0, mid: 0, treble: 0 };
		this.active = false;
		this._ctx = null;
		this._stream = null;
		this._analyser = null;
		this._bins = null;
	}

	static isSupported() {
		return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && (window.AudioContext || window.webkitAudioContext));
	}

	/** Resolves once the mic is live. Rejects with the browser's own error. */
	async start() {
		if (this.active) return;
		const stream = await navigator.mediaDevices.getUserMedia({
			audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
		});
		const Ctx = window.AudioContext || window.webkitAudioContext;
		const ctx = new Ctx();
		const source = ctx.createMediaStreamSource(stream);
		const analyser = ctx.createAnalyser();
		analyser.fftSize = 1024;
		analyser.smoothingTimeConstant = 0.6;
		source.connect(analyser);
		this._ctx = ctx;
		this._stream = stream;
		this._analyser = analyser;
		this._bins = new Uint8Array(analyser.frequencyBinCount);
		this.active = true;
	}

	/** Read the spectrum and update the smoothed levels. Call once per frame. */
	sample() {
		if (!this.active) return this.levels;
		this._analyser.getByteFrequencyData(this._bins);
		const raw = bandLevels(this._bins, this._ctx.sampleRate);
		for (const key of ['bass', 'mid', 'treble']) {
			this.levels[key] = smoothLevel(this.levels[key], raw[key]);
		}
		return this.levels;
	}

	stop() {
		if (!this.active) return;
		this.active = false;
		for (const track of this._stream.getTracks()) track.stop();
		this._ctx.close();
		this._ctx = this._stream = this._analyser = this._bins = null;
		this.levels = { bass: 0, mid: 0, treble: 0 };
	}
}
