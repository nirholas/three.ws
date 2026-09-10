// One place that owns the acoustic input chain, so every surface driving an
// agent by hand shares the same wiring instead of rebuilding it.
//
// Below this file: the sensor (./doppler.js) and the three detectors
// (./gestures.js). Above it: whatever is being driven. /sonar drives the shared
// animation preview, the <agent-3d> web component drives an embedded avatar,
// and neither one repeats the mode arbitration, the reverse handling or the
// lift's per-frame integration.
//
// What this owns:
//   • starting and stopping the sensor
//   • which detectors are live (see MODES: they cross-trigger, so it is a mode)
//   • the three reverse switches
//   • turning a held lift into a per-frame turn
//
// What it does not own: what a gesture means. That is the consumer's decision,
// taken through the callbacks.

import { DopplerSensor, DIRECTION } from './doppler.js';
import { SwipeDetector, PushPullDetector, LiftMotion } from './gestures.js';

/**
 * Which detectors are live at once.
 *
 * The three gestures are not separable at the hardware level: the microphone
 * senses distance, so a sweep passing it is an approach followed by a retreat,
 * which is also exactly what a push and a pull look like. Sonar solves that with
 * modes, and so does this. `all` is offered because it is genuinely more fun,
 * and is honest about misreading more often.
 */
export const MODES = {
	swipe: { label: 'Sweep', detectors: ['swipe'] },
	push: { label: 'Push and pull', detectors: ['push'] },
	lift: { label: 'Lift', detectors: ['lift'] },
	all: { label: 'All three', detectors: ['swipe', 'push', 'lift'] },
};

/**
 * Radians of turn per unit of lift travel. A hand held at full strength returns
 * about 700 units a second, which lands a full revolution at a little under two
 * seconds: fast enough to feel connected to the hand, slow enough to stop on a
 * face.
 */
export const ORBIT_SCALE = 0.0045;

/**
 * The gesture slots a sweep walks through, in the order they read best on
 * stage: an opener, two reactions, a loop worth landing on, then the rest of the
 * vocabulary. Shared so /sonar and an <agent-3d> embed step the same cast
 * rather than drifting apart. Every entry is a slot name from
 * src/runtime/animation-slots.js, so a slot re-pointed there moves here too.
 */
export const GESTURE_CAST = [
	'wave',
	'nod',
	'celebrate',
	'dance',
	'point',
	'shrug',
	'think',
	'bow',
	'concern',
	'shake',
];

const now = () => performance.now() / 1000;

/**
 * Drives one acoustic input chain and reports what it read.
 *
 * ```js
 * const sonar = new SonarController({
 *   mode: 'swipe',
 *   onSwipe: (dir) => dir > 0 ? next() : previous(),
 *   onZoom: (action) => applyZoom(action),
 *   onTurn: (radians) => camera.orbitBy(radians),
 * });
 * await sonar.start();   // prompts for the microphone
 * sonar.stop();
 * ```
 */
export class SonarController {
	/**
	 * @param {{
	 *   mode?: keyof typeof MODES,
	 *   amplitude?: number,
	 *   tone?: number,
	 *   autoTone?: boolean,
	 *   onReading?: (r: object) => void,
	 *   onSwipe?: (direction: 1|-1, reading: object) => void,
	 *   onZoom?: (action: 3|-1|0, reading: object) => void,
	 *   onTurn?: (radians: number, velocity: number) => void,
	 *   onStatus?: (s: {state: string, message: string}) => void,
	 *   onError?: (err: Error) => void,
	 * }} [opts]
	 */
	constructor(opts = {}) {
		this.mode = MODES[opts.mode] ? opts.mode : 'swipe';
		this.reverse = { swipe: false, push: false };
		this.onReading = opts.onReading || null;
		this.onSwipe = opts.onSwipe || null;
		this.onZoom = opts.onZoom || null;
		this.onTurn = opts.onTurn || null;
		this.onStatus = opts.onStatus || null;
		this.onError = opts.onError || null;
		this._opts = opts;

		this._sensor = null;
		this._swipe = new SwipeDetector();
		this._push = new PushPullDetector();
		this._lift = new LiftMotion();
		this._raf = 0;
		this._liftLast = 0;
		this._generation = 0;
		this.lastReading = null;
	}

	get running() {
		return Boolean(this._sensor?.running);
	}

	/** The sensor, once started. Null before that, for tone and level controls. */
	get sensor() {
		return this._sensor;
	}

	/**
	 * Prompt for the microphone and begin reading. Rejects with a message worth
	 * showing a user; `onError` also receives it, for callers started from a
	 * place that cannot await.
	 */
	async start() {
		if (this.running) return;
		// start() awaits the microphone; a stop() arriving during that wait must
		// win, or the frame loop below installs itself over a stopped session.
		const gen = ++this._generation;
		this._sensor = new DopplerSensor({
			tone: this._opts.tone,
			autoTone: this._opts.autoTone,
			amplitude: this._opts.amplitude ?? 0.08,
			onStatus: (s) => this.onStatus?.(s),
			onReading: (r) => this.feed(r),
		});
		try {
			await this._sensor.start();
		} catch (err) {
			this._sensor = null;
			this.onError?.(err);
			throw err;
		}
		if (gen !== this._generation) return;
		this.resetDetectors();
		this._liftLast = 0;
		this._raf = requestAnimationFrame(this._tick);
	}

	/** Silence the tone, release the microphone, and stop reporting. */
	stop() {
		this._generation++;
		this._sensor?.stop();
		this._sensor = null;
		// Guarded rather than unconditional: stop() is a teardown path, reachable
		// from an element being removed and from a failed start, and it must not
		// throw in a context that has no frame loop to cancel.
		if (this._raf) cancelAnimationFrame(this._raf);
		this._raf = 0;
		this._lift.reset();
		this.lastReading = null;
	}

	/** Forget every stroke in flight. Called on a mode change and on start. */
	resetDetectors() {
		this._swipe.reset();
		this._push.clearEvidence();
		this._push.steps = 0;
		this._lift.reset();
	}

	/** @param {keyof typeof MODES} mode */
	setMode(mode) {
		if (!MODES[mode] || mode === this.mode) return;
		this.mode = mode;
		// Whatever half-formed stroke the old mode was tracking is meaningless now.
		this.resetDetectors();
	}

	/** Flip a gesture's direction. `lift` reverses through the motion itself. */
	setReversed(gesture, on) {
		if (gesture === 'lift') {
			if (Boolean(on) !== !this._lift.forward) this._lift.switchDirection();
			return;
		}
		if (gesture in this.reverse) this.reverse[gesture] = Boolean(on);
	}

	/** Re-measure the still room without restarting the microphone. */
	recalibrate() {
		this._sensor?.recalibrate();
		this.resetDetectors();
	}

	/**
	 * Drive the controller from one Reading. Called for you by the sensor while
	 * running; public so a caller can also replay a recorded stream through the
	 * same mapping, which is how the mode and reverse behaviour is tested without
	 * a microphone (tests/sonar-controller.test.js).
	 *
	 * @param {object} reading a Reading from ./doppler.js
	 */
	feed(reading) {
		this.lastReading = reading;
		this.onReading?.(reading);
		const live = MODES[this.mode].detectors;
		const t = now();

		if (live.includes('swipe')) {
			const event = this._swipe.feed(reading, t);
			if (event) {
				const forward = this.reverse.swipe ? event === 'previous' : event === 'next';
				this.onSwipe?.(forward ? 1 : -1, reading);
			}
		}
		if (live.includes('push')) {
			const action = this._push.feed(reading, t, this.reverse.push);
			if (action !== null) this.onZoom?.(action, reading);
		}
		if (live.includes('lift')) this._lift.feed(reading, t);
	}

	/**
	 * A lift is continuous, so it advances on the display clock rather than on
	 * readings: the turn has to keep easing between analysis frames or it steps.
	 */
	_tick = () => {
		this._raf = requestAnimationFrame(this._tick);
		const t = now();
		const dt = this._liftLast ? Math.min(0.1, t - this._liftLast) : 0;
		this._liftLast = t;
		const travelled = this._lift.step(dt, t);
		if (travelled) this.onTurn?.(travelled * ORBIT_SCALE, this._lift.velocity);
	};
}

export { DIRECTION };
