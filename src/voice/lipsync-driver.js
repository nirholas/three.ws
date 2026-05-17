/**
 * Audio-driven lipsync.
 *
 * Takes a live `AnalyserNode` (typically tapped off the TTS playback element)
 * and a mouth target object that exposes:
 *
 *   target.setMouthShape({ open, wide, round })   // values in [0, 1]
 *
 * Each frame the driver reads the analyser, derives three mouth-shape values
 * from the audio signal, smooths them, and pushes them into the target. The
 * target is responsible for translating those into morph weights / bone
 * rotations on whatever GLB is loaded (see avatar-morph-target.js).
 *
 * The shape estimation is intentionally simple — not phoneme-accurate, but
 * convincing for streaming TTS where we don't have viseme timestamps:
 *
 *   open  := overall energy (RMS-ish over the lowest few bands)
 *   wide  := high-band energy relative to low-band  (front vowels: /i/, /e/)
 *   round := low-band energy relative to mid-band   (back vowels: /o/, /u/)
 *
 * The driver runs on requestAnimationFrame and is cheap; multiple instances
 * can coexist (e.g. a peer avatar's speech bubble) without ill effects.
 */

const DEFAULT_FFT_SIZE = 256; // 128 bands — enough resolution for vowel cues
const SMOOTH_ATTACK = 0.45; // weight on new sample when value is rising
const SMOOTH_RELEASE = 0.18; // weight on new sample when value is falling
const NOISE_FLOOR = 0.04; // below this, treat as silence

export class LipsyncDriver {
	/**
	 * @param {object} options
	 * @param {AnalyserNode} options.analyser
	 *        Live analyser node fed by the TTS audio source.
	 * @param {{ setMouthShape(s:{open:number,wide:number,round:number}):void, dispose?():void }} options.target
	 *        Mouth target adapter — receives shape updates per frame.
	 * @param {number} [options.gain=1.4]
	 *        Multiplier applied to `open` before clamping. Tune up for quiet
	 *        TTS, down for shouty TTS.
	 */
	constructor({ analyser, target, gain = 1.4 } = {}) {
		if (!analyser || typeof analyser.getByteFrequencyData !== 'function') {
			throw new Error('LipsyncDriver requires an AnalyserNode');
		}
		if (!target || typeof target.setMouthShape !== 'function') {
			throw new Error('LipsyncDriver requires a target with setMouthShape()');
		}
		this.analyser = analyser;
		this.target = target;
		this.gain = gain;
		this._bins = new Uint8Array(analyser.frequencyBinCount);
		this._open = 0;
		this._wide = 0;
		this._round = 0;
		this._rafId = 0;
		this._running = false;
	}

	start() {
		if (this._running) return;
		this._running = true;
		const tick = () => {
			if (!this._running) return;
			this._step();
			this._rafId = requestAnimationFrame(tick);
		};
		this._rafId = requestAnimationFrame(tick);
	}

	stop() {
		this._running = false;
		if (this._rafId) cancelAnimationFrame(this._rafId);
		this._rafId = 0;
		// Settle the mouth shut so it doesn't freeze mid-shape.
		this._open = this._wide = this._round = 0;
		try {
			this.target.setMouthShape({ open: 0, wide: 0, round: 0 });
		} catch {}
	}

	dispose() {
		this.stop();
		try {
			this.target.dispose?.();
		} catch {}
	}

	// ── internals ────────────────────────────────────────────────────────

	_step() {
		this.analyser.getByteFrequencyData(this._bins);
		const shape = computeShape(this._bins, this.gain);

		// Asymmetric smoothing: snap open on rising edges (so plosives feel
		// punchy), ease back on falls (so the mouth doesn't chatter shut
		// between syllables).
		this._open = lerp(this._open, shape.open, smoothFor(this._open, shape.open));
		this._wide = lerp(this._wide, shape.wide, smoothFor(this._wide, shape.wide));
		this._round = lerp(this._round, shape.round, smoothFor(this._round, shape.round));

		try {
			this.target.setMouthShape({
				open: this._open,
				wide: this._wide,
				round: this._round,
			});
		} catch (err) {
			// Target failures should not kill the loop; log once.
			if (!this._loggedTargetErr) {
				console.warn('[lipsync] target error:', err?.message);
				this._loggedTargetErr = true;
			}
		}
	}
}

function smoothFor(prev, next) {
	return next > prev ? SMOOTH_ATTACK : SMOOTH_RELEASE;
}

function lerp(a, b, t) {
	return a + (b - a) * t;
}

/**
 * Pure shape estimator — exported so tests can drive it directly.
 *
 * @param {Uint8Array} bins  frequency-domain magnitudes [0..255]
 * @param {number} [gain=1.4]
 * @returns {{open:number, wide:number, round:number}} each in [0,1]
 */
export function computeShape(bins, gain = 1.4) {
	if (!bins || bins.length === 0) return { open: 0, wide: 0, round: 0 };

	// Split the spectrum into three coarse bands. Even split is intentional —
	// real human voice F1/F2/F3 formants don't line up with FFT bins exactly,
	// and we want this to work across sample rates without per-rate tuning.
	const third = Math.floor(bins.length / 3);
	let lowSum = 0;
	let midSum = 0;
	let highSum = 0;
	for (let i = 0; i < third; i++) lowSum += bins[i];
	for (let i = third; i < third * 2; i++) midSum += bins[i];
	for (let i = third * 2; i < bins.length; i++) highSum += bins[i];

	const low = lowSum / third / 255;
	const mid = midSum / third / 255;
	const high = highSum / (bins.length - third * 2) / 255;

	const energy = (low + mid + high) / 3;
	if (energy < NOISE_FLOOR) return { open: 0, wide: 0, round: 0 };

	const open = clamp01(energy * gain);
	// Wide vowels (/i/, /e/) have stronger high-frequency content. Compare high
	// vs the rest of the spectrum, push through a soft curve so small differences
	// don't make the smile jitter.
	const wideRaw = high / (low + mid + 0.0001) - 0.5;
	const wide = clamp01(wideRaw * 0.9);
	// Round vowels (/o/, /u/) have low-frequency dominance.
	const roundRaw = low / (mid + high + 0.0001) - 0.6;
	const round = clamp01(roundRaw * 0.9);

	return { open, wide, round };
}

function clamp01(n) {
	if (!Number.isFinite(n)) return 0;
	if (n < 0) return 0;
	if (n > 1) return 1;
	return n;
}

/**
 * Build an AnalyserNode wired to an existing `<audio>` or `<video>` element,
 * using a shared AudioContext (passed in or lazily created). Returns
 * `{ analyser, context, source, disconnect }`. Call disconnect() when done to
 * release the MediaElementAudioSource (otherwise the element can't be played
 * outside this graph).
 *
 * @param {HTMLMediaElement} audioEl
 * @param {AudioContext} [context]
 */
export function tapAudioElement(audioEl, context) {
	const ctx = context || new (window.AudioContext || window.webkitAudioContext)();
	const source = ctx.createMediaElementSource(audioEl);
	const analyser = ctx.createAnalyser();
	analyser.fftSize = DEFAULT_FFT_SIZE;
	analyser.smoothingTimeConstant = 0.4;
	source.connect(analyser);
	// Pass-through to speakers so the user still hears the audio.
	analyser.connect(ctx.destination);
	return {
		analyser,
		context: ctx,
		source,
		disconnect: () => {
			try {
				source.disconnect();
			} catch {}
			try {
				analyser.disconnect();
			} catch {}
		},
	};
}
