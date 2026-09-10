// Acoustic motion sensing in the browser: no camera, no permissions beyond the
// microphone, no model weights.
//
// The speakers emit a steady inaudible tone. A hand moving in front of the
// laptop reflects it, and the reflection comes back frequency-shifted: higher
// when the hand approaches, lower when it recedes. That is the Doppler effect,
// and it is enough to read a sweep, a push and a lift off the microphone.
//
// The technique is SoundWave (Gupta, Morris, Patel & Tan, CHI 2012). This
// module is a port of the analysis in Emanuel Perez's Sonar
// (https://github.com/nirholas/sonar.cool, MIT), which is itself an
// independent implementation of that paper, with Daniel Rapp's browser Doppler
// as the prior art for doing it in Web Audio at all. The Swift analyzer's
// constants are reproduced exactly (8192-point transform, a 600 Hz window
// either side of the carrier, a 2.5 s baseline, the 1.7x sideband ratio), so
// the detectors in ./gestures.js keep behaving the way they were tuned to.
//
// What this file owns: the tone, the microphone, the transform, the baseline,
// and one Reading per frame. It knows nothing about gestures or about 3D.

/** Frame size of the analysis transform. Sonar's `Analyzer.n`. */
const FFT_SIZE = 8192;
/** Half-width of the analysis window around the carrier, in Hz. */
const WINDOW_HZ = 600;
/** Seconds of stillness averaged into the room baseline before sensing starts. */
export const CALIBRATION_SECONDS = 2.5;
/** Carrier-to-floor contrast below which the tone is not usable. */
const MIN_SNR_DB = 15;
/** Sideband excess below which the room counts as still. */
const MIN_STRENGTH = 0.0003;

/** Reading.direction is one of these. Detectors compare against them. */
export const DIRECTION = {
	approaching: 'approaching',
	away: 'away',
	mixed: 'mixed',
	still: 'still',
	listening: 'listening',
	calibrating: 'calibrating',
	weakTone: 'weak-tone',
};

/** Human copy for each direction, so the UI never spells these out itself. */
export const DIRECTION_LABEL = {
	[DIRECTION.approaching]: 'Approaching',
	[DIRECTION.away]: 'Moving away',
	[DIRECTION.mixed]: 'Mixed movement',
	[DIRECTION.still]: 'Still',
	[DIRECTION.listening]: 'Listening',
	[DIRECTION.calibrating]: 'Calibrating, hold still',
	[DIRECTION.weakTone]: 'Tone not clear',
};

/**
 * Carrier candidates, quietest-to-the-ear last. Laptop speakers roll off hard
 * near Nyquist and every model rolls off somewhere different, so the sensor
 * measures each one against this machine's own hardware instead of assuming
 * 20 kHz reaches the microphone (the Sonar desktop app asks the user to try
 * another frequency by hand when it does not).
 */
export const TONE_CANDIDATES = [18000, 18500, 19000, 19500, 20000, 20500, 21000];

export const DEFAULT_TONE = 20000;

/** True when this browser can run the sensor at all. */
export function isSupported() {
	return Boolean(
		typeof window !== 'undefined' &&
			(window.AudioContext || window.webkitAudioContext) &&
			navigator.mediaDevices?.getUserMedia,
	);
}

/**
 * Microphone constraints. All three cleanups have to be off: echo cancellation
 * exists specifically to remove the speaker's own output from the microphone
 * signal, which is the entire signal here. Noise suppression and AGC chew the
 * sidebands the same way.
 */
const MIC_CONSTRAINTS = {
	audio: {
		echoCancellation: false,
		noiseSuppression: false,
		autoGainControl: false,
		channelCount: 1,
	},
};

/** Wall-clock seconds. See the note in _frame for why this is not the audio clock. */
const now = () => performance.now() / 1000;

/**
 * The analyser reports a bin with no energy at all as -Infinity, which turns
 * every level comparison downstream into NaN and silently disables every
 * threshold. Digital silence in this band is a real state (a muted machine, a
 * carrier the speakers cannot project), so it is floored rather than special-cased.
 */
const FLOOR_DB = -180;
const readDb = (value) => (Number.isFinite(value) ? value : FLOOR_DB);

const dbToPower = (db) => 10 ** (db / 10);

/**
 * One analysis frame.
 *
 * @typedef {object} Reading
 * @property {Float32Array} spectrumDb   the analysis window, in dB
 * @property {Float32Array} baselineDb   the still-room reference, in dB
 * @property {string} direction          a DIRECTION value
 * @property {number} carrierDb          peak level at the carrier
 * @property {number} snr                carrier minus noise floor, in dB
 * @property {number} strength           sideband excess over the carrier
 * @property {number[]} waveBands        8 log-compressed bands across the window
 * @property {number} opposedStrength    the weaker sideband, same units as strength
 * @property {number} binWidth           Hz per bin
 * @property {number} firstFrequency     Hz at spectrumDb[0]
 * @property {number} sampleRate
 * @property {number} tone
 * @property {number|null} calibrationRemaining seconds left, null once sensing
 */

/**
 * Emits a tone, listens to its reflections, and reports one Reading per frame.
 *
 * ```js
 * const sensor = new DopplerSensor({ onReading: (r) => console.log(r.direction) });
 * await sensor.start();          // prompts for the microphone
 * sensor.stop();
 * ```
 */
export class DopplerSensor {
	/**
	 * @param {{tone?: number, amplitude?: number, autoTone?: boolean,
	 *   onReading?: (r: Reading) => void, onStatus?: (s: {state: string, message: string}) => void}} [opts]
	 */
	constructor(opts = {}) {
		this.tone = opts.tone || DEFAULT_TONE;
		this.amplitude = opts.amplitude ?? 0.08;
		this.autoTone = opts.autoTone !== false;
		this.onReading = opts.onReading || null;
		this.onStatus = opts.onStatus || null;

		this._ctx = null;
		this._stream = null;
		this._osc = null;
		this._gain = null;
		this._analyser = null;
		this._source = null;
		this._raf = 0;
		this._db = null; // scratch dB buffer, reused every frame
		this._baseline = null; // linear power, the still-room reference
		this._frames = 0;
		this._startedAt = 0;
		this._history = [];
		this._lastFrameAt = 0;
		// Bumped by every start and every stop. start() awaits the microphone and
		// the carrier probe, and a user who presses stop during that wait must not
		// end up with a sensor that arms itself once the await finally resolves.
		this._generation = 0;
		this.running = false;
	}

	_status(state, message) {
		this.onStatus?.({ state, message });
	}

	/**
	 * Prompt for the microphone, start the tone, and begin reporting.
	 * Rejects with a message worth showing the user.
	 */
	async start() {
		if (this.running) return;
		if (!isSupported()) throw new Error('This browser has no Web Audio microphone input.');
		const gen = ++this._generation;
		const superseded = () => gen !== this._generation;
		this._status('starting', 'Requesting the microphone');
		try {
			this._stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
		} catch (err) {
			throw new Error(
				err?.name === 'NotAllowedError'
					? 'Microphone access was denied. Allow it in the browser address bar and start again.'
					: `The microphone could not be opened: ${err?.message || err}`,
			);
		}
		if (superseded()) {
			for (const track of this._stream?.getTracks() || []) track.stop();
			this._stream = null;
			return;
		}
		const Ctx = window.AudioContext || window.webkitAudioContext;
		this._ctx = new Ctx();
		await this._ctx.resume();
		if (superseded()) return this._teardown();

		if (this._ctx.sampleRate < this.tone * 2 + 1000) {
			const usable = TONE_CANDIDATES.filter((t) => this._ctx.sampleRate >= t * 2 + 1000);
			if (!usable.length) {
				await this._teardown();
				throw new Error(
					`This device samples audio at ${Math.round(this._ctx.sampleRate)} Hz, too low for an inaudible carrier.`,
				);
			}
			this.tone = usable[usable.length - 1];
		}

		this._analyser = this._ctx.createAnalyser();
		this._analyser.fftSize = FFT_SIZE;
		// Sonar averages the room itself, over its own window. Any smoothing here
		// would average twice and blunt the sidebands a fast sweep depends on.
		this._analyser.smoothingTimeConstant = 0;
		this._db = new Float32Array(this._analyser.frequencyBinCount);

		this._source = this._ctx.createMediaStreamSource(this._stream);
		this._source.connect(this._analyser);
		// The analyser is a sink here. Connecting it onward would put the
		// microphone into the speakers.

		this._gain = this._ctx.createGain();
		this._gain.gain.value = 0;
		this._gain.connect(this._ctx.destination);
		this._osc = this._ctx.createOscillator();
		this._osc.type = 'sine';
		this._osc.frequency.value = this.tone;
		this._osc.connect(this._gain);
		this._osc.start();
		// Sonar's 0.15 s envelope: a hard start on a 20 kHz sine is an audible click.
		this._gain.gain.linearRampToValueAtTime(this.amplitude, this._ctx.currentTime + 0.15);

		this.running = true;
		if (this.autoTone) {
			this._status('tuning', 'Finding a carrier this hardware can hear');
			await this._pickTone();
			if (superseded()) {
				this.running = false;
				return this._teardown();
			}
		}
		this.recalibrate();
		this._status('calibrating', 'Hold still while the room is measured');
		this._lastFrameAt = 0;
		this._raf = requestAnimationFrame(this._frame);
	}

	/**
	 * Measure carrier contrast at each candidate and keep the best. Every laptop
	 * rolls off at a different frequency, and a carrier the speakers cannot
	 * project reads exactly like a room with nothing moving in it.
	 */
	async _pickTone() {
		let best = { tone: this.tone, snr: -Infinity };
		for (const tone of TONE_CANDIDATES) {
			if (this._ctx.sampleRate < tone * 2 + 1000) continue;
			this._osc.frequency.setValueAtTime(tone, this._ctx.currentTime);
			await this._settle(90);
			if (!this.running) return;
			this._analyser.getFloatFrequencyData(this._db);
			const { snr } = this._carrier(tone);
			if (snr > best.snr) best = { tone, snr };
		}
		this.tone = best.tone;
		this._osc.frequency.setValueAtTime(this.tone, this._ctx.currentTime);
		await this._settle(120);
	}

	_settle(ms) {
		return new Promise((r) => setTimeout(r, ms));
	}

	/** Carrier peak and noise floor for `tone`, read from the current dB buffer. */
	_carrier(tone) {
		const { center, radius } = this._window(tone);
		let peak = FLOOR_DB;
		for (let i = center - 1; i <= center + 1; i++) peak = Math.max(peak, readDb(this._db[i]));
		let floor = 0;
		for (let k = 0; k < 5; k++) {
			floor += readDb(this._db[center - radius + k]) + readDb(this._db[center + radius - k]);
		}
		return { carrierDb: peak, snr: peak - floor / 10 };
	}

	_window(tone) {
		const n = this._analyser.fftSize;
		const rate = this._ctx.sampleRate;
		const center = Math.round((tone / rate) * n);
		const radius = Math.round((WINDOW_HZ / rate) * n);
		return { center, radius, n, rate };
	}

	/** Throw away the room reference and measure it again. */
	recalibrate() {
		this._baseline = null;
		this._frames = 0;
		this._history = [];
		this._startedAt = now();
	}

	/** Retune the carrier without restarting the microphone. */
	setTone(tone) {
		this.tone = tone;
		if (this._osc) this._osc.frequency.setValueAtTime(tone, this._ctx.currentTime);
		this.recalibrate();
	}

	/** Speaker level for the carrier, 0..1. */
	setAmplitude(amplitude) {
		this.amplitude = amplitude;
		if (this._gain) {
			this._gain.gain.linearRampToValueAtTime(amplitude, this._ctx.currentTime + 0.05);
		}
	}

	_frame = () => {
		if (!this.running) return;
		this._raf = requestAnimationFrame(this._frame);
		// Sonar advances one analysis per 2048-sample hop. A display-rate loop
		// would re-read overlapping windows and hand the detectors more votes per
		// second than their thresholds were tuned against.
		//
		// The clock is the wall clock, not AudioContext.currentTime: a machine
		// with no audio sink (a headless browser, a VM, a laptop with everything
		// muted at the device level) leaves the context clock frozen at zero, and
		// every duration in this file then reads as "no time has passed": the
		// calibration never completes and the page waits forever on a room it has
		// already measured.
		const t = now();
		const hop = 2048 / this._ctx.sampleRate;
		if (t - this._lastFrameAt < hop) return;
		this._lastFrameAt = t;
		this._analyser.getFloatFrequencyData(this._db);
		const reading = this._analyze(t);
		this.onReading?.(reading);
	};

	/** @param {number} t wall-clock seconds @returns {Reading} */
	_analyze(t) {
		const { center, radius, rate } = this._window(this.tone);
		const width = radius * 2 + 1;
		const power = new Float64Array(width);
		const spectrumDb = new Float32Array(width);
		for (let i = 0; i < width; i++) {
			const db = readDb(this._db[center - radius + i]);
			spectrumDb[i] = db;
			power[i] = Math.max(1e-16, dbToPower(db));
		}

		let carrierDb = FLOOR_DB;
		for (let i = radius - 1; i <= radius + 1; i++) carrierDb = Math.max(carrierDb, spectrumDb[i]);
		let floor = 0;
		for (let k = 0; k < 5; k++) floor += spectrumDb[k] + spectrumDb[width - 1 - k];
		floor /= 10;
		const snr = carrierDb - floor;

		if (!this._baseline) this._baseline = Float64Array.from(power);
		const elapsed = t - this._startedAt;
		const calibrating = elapsed < CALIBRATION_SECONDS;
		if (calibrating) {
			// A running mean over the calibration window, exactly as Sonar weights it.
			const a = 1 / (this._frames + 1);
			for (let i = 0; i < width; i++) {
				this._baseline[i] = this._baseline[i] * (1 - a) + power[i] * a;
			}
		}
		this._frames++;

		// Energy that was not in the still room, split by which side of the
		// carrier it landed on. Higher than the carrier means closing distance.
		let left = 0;
		let right = 0;
		const bands = new Array(8).fill(0);
		const reference = Math.max(power[radius - 1] + power[radius] + power[radius + 1], 1e-12);
		for (let i = 0; i < width; i++) {
			if (Math.abs(i - radius) < 3) continue;
			const excess = Math.max(0, power[i] - this._baseline[i] * 2);
			if (i < radius) left += excess;
			else right += excess;
			bands[Math.min(7, Math.floor((i * 8) / width))] += excess / reference;
		}
		const strength = Math.max(left, right) / reference;

		let raw = DIRECTION.still;
		if (strength > MIN_STRENGTH && snr > MIN_SNR_DB) {
			if (right > left * 1.7) raw = DIRECTION.approaching;
			else if (left > right * 1.7) raw = DIRECTION.away;
			else raw = DIRECTION.mixed;
		}
		this._history.push(raw);
		if (this._history.length > 2) this._history.shift();
		const stable = this._history.length === 2 && this._history[0] === this._history[1];

		let direction;
		if (calibrating) direction = DIRECTION.calibrating;
		else if (snr < MIN_SNR_DB) direction = DIRECTION.weakTone;
		else direction = stable ? raw : DIRECTION.listening;

		const baselineDb = new Float32Array(width);
		for (let i = 0; i < width; i++) baselineDb[i] = 10 * Math.log10(Math.max(this._baseline[i], 1e-16));

		return {
			spectrumDb,
			baselineDb,
			direction,
			carrierDb,
			snr,
			strength,
			waveBands: bands.map((b) => Math.log1p(b / MIN_STRENGTH)),
			opposedStrength: Math.min(left, right) / reference,
			binWidth: rate / this._analyser.fftSize,
			firstFrequency: ((center - radius) * rate) / this._analyser.fftSize,
			sampleRate: rate,
			tone: this.tone,
			calibrationRemaining: calibrating ? Math.max(0, CALIBRATION_SECONDS - elapsed) : null,
		};
	}

	/** Silence the tone, release the microphone, and stop reporting. */
	stop() {
		this._generation++;
		this.running = false;
		cancelAnimationFrame(this._raf);
		this._raf = 0;
		this._teardown();
		this._status('stopped', 'Sensing stopped');
	}

	async _teardown() {
		try {
			if (this._gain && this._ctx) {
				this._gain.gain.linearRampToValueAtTime(0, this._ctx.currentTime + 0.05);
			}
			this._osc?.stop(this._ctx ? this._ctx.currentTime + 0.08 : 0);
		} catch {
			// An oscillator that never started, or a context already closed by a
			// navigation, has nothing to ramp down.
		}
		for (const track of this._stream?.getTracks() || []) track.stop();
		this._stream = null;
		if (this._ctx && this._ctx.state !== 'closed') {
			try {
				await this._ctx.close();
			} catch {
				// Closing twice is not an error worth surfacing.
			}
		}
		this._ctx = null;
		this._osc = null;
		this._gain = null;
		this._analyser = null;
		this._source = null;
	}
}
