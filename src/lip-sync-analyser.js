// LipSyncAnalyser — drives viseme morph weights from live audio via AnalyserNode.
//
// Frequency band → viseme group mapping:
//   Low  (0–500 Hz)   → open vowels:             viseme_aa, viseme_O
//   Mid  (500–2k Hz)  → mid vowels + nasals:      viseme_E, viseme_I, viseme_nn
//   High (2k–8k Hz)   → sibilants + fricatives:   viseme_SS, viseme_FF, viseme_CH
//   Amplitude dip     → bilabial closure:          viseme_PP

export const VISEMES = [
	'viseme_aa', 'viseme_O', 'viseme_E', 'viseme_I', 'viseme_nn',
	'viseme_SS', 'viseme_FF', 'viseme_CH', 'viseme_PP',
];

// Module-level scratch buffer — avoids a Float32Array allocation per sample() call.
const _TARGET = new Float32Array(VISEMES.length);

export class LipSyncAnalyser {
	constructor() {
		this._ctx      = null;
		this._analyser = null;
		this._source   = null;
		this._freqBuf  = null;
		this._active   = false;

		// Bin-boundary indices, pre-computed in connect() from the AudioContext sample rate.
		this._lowEnd  = 0;
		this._midEnd  = 0;
		this._highEnd = 0;

		// Pre-allocated output and smoothing buffers — mutated in place so sample()
		// never touches the heap.
		this._out  = {};
		this._prev = {};
		for (const n of VISEMES) this._out[n] = this._prev[n] = 0;

		// Smoothed overall amplitude (0..1) — exposed via getAmplitude() so
		// non-ARKit avatars (no viseme morphs) can drive a single jaw morph.
		this._amplitude     = 0;
		this._prevAmplitude = 0;
	}

	/**
	 * Connect to an audio source.
	 * @param {AnalyserNode|HTMLMediaElement} audioSource
	 *   AnalyserNode  — use the pre-wired node from ElevenLabsTTS.analyserNode directly.
	 *   HTMLMediaElement — create a private AudioContext and wire through it.
	 */
	connect(audioSource) {
		this.disconnect();

		let analyser   = null;
		let sampleRate = 44100;
		const fftSize  = 256;

		if (typeof AnalyserNode !== 'undefined' && audioSource instanceof AnalyserNode) {
			analyser   = audioSource;
			sampleRate = audioSource.context?.sampleRate ?? 44100;
		} else if (typeof HTMLMediaElement !== 'undefined' && audioSource instanceof HTMLMediaElement) {
			const AC = window.AudioContext || window.webkitAudioContext;
			if (!AC) return;
			try {
				this._ctx  = new AC();
				analyser   = this._ctx.createAnalyser();
				analyser.fftSize               = fftSize;
				analyser.smoothingTimeConstant = 0.7;
				this._source = this._ctx.createMediaElementSource(audioSource);
				this._source.connect(analyser);
				analyser.connect(this._ctx.destination);
				this._ctx.resume().catch(() => {});
				sampleRate = this._ctx.sampleRate;
			} catch {
				try { this._ctx?.close(); } catch {}
				this._ctx = null;
				return;
			}
		} else {
			return;
		}

		this._analyser = analyser;
		this._freqBuf  = new Uint8Array(analyser.frequencyBinCount);

		const binHz    = sampleRate / (analyser.fftSize ?? fftSize);
		this._lowEnd   = Math.round(500  / binHz);
		this._midEnd   = Math.round(2000 / binHz);
		this._highEnd  = Math.min(Math.round(8000 / binHz), analyser.frequencyBinCount);
		this._active   = true;
	}

	/** Disconnect and release audio resources. */
	disconnect() {
		this._active = false;
		try { this._source?.disconnect(); } catch {}
		if (this._ctx) {
			try { this._analyser?.disconnect(); } catch {}
			try { this._ctx.close(); } catch {}
		}
		this._ctx = this._analyser = this._source = this._freqBuf = null;
		for (const n of VISEMES) this._out[n] = this._prev[n] = 0;
		this._amplitude = this._prevAmplitude = 0;
	}

	/**
	 * Last sampled overall amplitude (0..1), smoothed by the same EMA as the
	 * viseme weights. Updated by every call to sample(). Returns 0 before the
	 * first sample or after disconnect.
	 *
	 * Non-ARKit avatars (no viseme morphs) can drive jawOpen/mouthOpen directly
	 * from this without re-running spectral analysis.
	 */
	getAmplitude() {
		return this._amplitude;
	}

	/**
	 * Sample the current audio frame and return a viseme weight map.
	 * Mutates and returns the pre-allocated _out object — no heap allocations.
	 * @returns {Record<string,number>|null}  null when inactive
	 */
	sample() {
		if (!this._active || !this._analyser || !this._freqBuf) return null;

		this._analyser.getByteFrequencyData(this._freqBuf);

		const low     = _bandAvg(this._freqBuf, 0,            this._lowEnd);
		const mid     = _bandAvg(this._freqBuf, this._lowEnd,  this._midEnd);
		const high    = _bandAvg(this._freqBuf, this._midEnd,  this._highEnd);
		const overall = (low + mid + high) / 3;

		if (overall < 0.15) {
			// Silence — lerp all weights toward zero
			for (let i = 0; i < VISEMES.length; i++) {
				const k     = VISEMES[i];
				const n     = this._prev[k] * 0.75;
				this._prev[k] = n;
				this._out[k]  = n;
			}
			this._prevAmplitude = this._amplitude = this._prevAmplitude * 0.75;
			return this._out;
		}

		// Map frequency bands to per-viseme targets
		_TARGET[0] = low  * 0.8;                          // viseme_aa
		_TARGET[1] = low  * 0.6;                          // viseme_O
		_TARGET[2] = mid  * 0.7;                          // viseme_E
		_TARGET[3] = mid  * 0.5;                          // viseme_I
		_TARGET[4] = mid  * 0.4;                          // viseme_nn
		_TARGET[5] = high * 0.8;                          // viseme_SS
		_TARGET[6] = high * 0.6;                          // viseme_FF
		_TARGET[7] = high * 0.5;                          // viseme_CH
		_TARGET[8] = Math.max(0, 0.3 - overall * 1.5);   // viseme_PP (amplitude dip → bilabial)

		for (let i = 0; i < VISEMES.length; i++) {
			const k     = VISEMES[i];
			const p     = this._prev[k];
			const n     = p + (_TARGET[i] - p) * 0.25;
			this._prev[k] = n;
			this._out[k]  = n;
		}
		// Smoothed amplitude tracks the same EMA so the jaw fallback feels
		// in-step with the viseme weights instead of leading or lagging them.
		this._prevAmplitude = this._amplitude = this._prevAmplitude + (overall - this._prevAmplitude) * 0.25;
		return this._out;
	}
}

function _bandAvg(buf, start, end) {
	const e = Math.min(end, buf.length);
	if (e <= start) return 0;
	let s = 0;
	for (let i = start; i < e; i++) s += buf[i];
	return s / ((e - start) * 255);
}
