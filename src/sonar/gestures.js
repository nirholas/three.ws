// Gesture detectors over a stream of Doppler Readings.
//
// Ports of the three detectors in Sonar (https://github.com/nirholas/sonar.cool,
// MIT): ImmediateWave (a sideways sweep), ZoomMotion (a push and its paced
// return) and ScrollMotion (a held lift). Their constants are reproduced to the
// digit, because every one of them is a tuning result rather than a choice: the
// 0.22 s re-arm is what stops a returning hand from firing a second sweep, and
// the 1.7x sideband ratio is what keeps a still room from drifting into a
// direction.
//
// Everything here is pure state machines over {direction, strength, snr,
// waveBands} plus a clock. No audio, no DOM, no 3D. That is what makes them
// testable without a microphone (tests/sonar-gestures.test.js drives them with
// the same synthetic frames the Swift suite uses).

import { DIRECTION } from './doppler.js';

/**
 * A sideways sweep, read as a direction without any training.
 *
 * A sweep is not sideways to the microphone at all: the hardware only senses
 * distance, so a sweep registers as one coherent lobe (a hand closing on the
 * speaker) followed by the opposite lobe as it passes. The detector takes the
 * first coherent lobe and suppresses the return, which is why a pause before
 * sweeping back matters.
 *
 * Emits `'next'` or `'previous'`.
 */
export class SwipeDetector {
	constructor() {
		this.reset();
	}

	reset() {
		this._quietSince = null;
		this._armed = false;
		this._started = null;
		this._lastSample = -Infinity;
		this._cooldownUntil = 0;
		this._balanceSum = 0;
		this._votes = 0;
	}

	_clearCandidate() {
		this._started = null;
		this._votes = 0;
		this._balanceSum = 0;
	}

	/**
	 * @param {object} reading
	 * @param {number} now seconds, monotonic
	 * @returns {'next'|'previous'|null}
	 */
	feed(reading, now) {
		// A gap this long means frames were dropped; the candidate in flight
		// cannot be trusted to be one continuous motion. The one deviation from
		// the Swift here: it also drops the cooldown, which would let a return
		// stroke fire a second sweep if frames stuttered inside that window.
		if (now - this._lastSample > 0.2) {
			const cooldown = this._cooldownUntil;
			this.reset();
			this._cooldownUntil = cooldown;
		}
		this._lastSample = now;

		if (reading.direction === DIRECTION.calibrating || reading.snr <= 15) {
			this._armed = false;
			this._quietSince = null;
			this._clearCandidate();
			return null;
		}
		if (now < this._cooldownUntil) return null;

		const moving = reading.strength > 0.00022;
		if (!moving) {
			// Separate an interrupted candidate from a completed sweep: a quiet
			// stretch re-arms, an interruption only clears.
			this._clearCandidate();
			if (this._quietSince === null) this._quietSince = now;
			if (now - this._quietSince >= 0.22) {
				this._armed = true;
				this._clearCandidate();
			}
			return null;
		}
		this._quietSince = null;
		if (!this._armed) return null;
		if (this._started === null) this._started = now;

		let balance = 0;
		if (reading.waveBands?.length === 8) {
			const power = reading.waveBands.map((b) => Math.expm1(Math.min(20, Math.max(0, b))));
			const away = power.slice(0, 4).reduce((a, b) => a + b, 0);
			const toward = power.slice(4).reduce((a, b) => a + b, 0);
			balance = (toward - away) / Math.max(1e-9, toward + away);
		} else if (reading.direction === DIRECTION.approaching) {
			balance = 1;
		} else if (reading.direction === DIRECTION.away) {
			balance = -1;
		}

		if (Math.abs(balance) > 0.16) {
			// A clear lobe must not be cancelled by an earlier opposite twitch:
			// restart the candidate on it rather than averaging the two to zero.
			if (this._votes > 0 && balance * this._balanceSum < 0) {
				this._started = now;
				this._votes = 0;
				this._balanceSum = 0;
			}
			this._balanceSum += balance;
			this._votes += 1;
		} else {
			this._started = now;
			this._votes = 0;
			this._balanceSum = 0;
		}

		const elapsed = now - this._started;
		if (elapsed > 0.65) {
			// Too slow to be a sweep. Something else is moving in the room.
			this._armed = false;
			this._clearCandidate();
			return null;
		}
		if (elapsed < 0.04 || this._votes < 3 || Math.abs(this._balanceSum) / this._votes <= 0.24) {
			return null;
		}
		const event = this._balanceSum > 0 ? 'next' : 'previous';
		this._armed = false;
		this._clearCandidate();
		this._cooldownUntil = now + 0.65;
		return event;
	}
}

/**
 * A push toward the screen, and the paced pull that undoes it.
 *
 * Emits `+3` on the push (three steps at once, so the response is visible),
 * `-1` per step of the return, and `0` on the step that lands back at rest. The
 * return is paced by how fast the hand is actually moving, read off how far the
 * reflected energy sits from the carrier, so a quick pull snaps back and a slow
 * one eases.
 */
export class PushPullDetector {
	constructor() {
		this.steps = 0;
		this._direction = '';
		this._began = 0;
		this._last = -Infinity;
		this._budget = 0;
	}

	/** Forget the stroke in flight without forgetting where the zoom sits. */
	clearEvidence() {
		this._direction = '';
		this._last = -Infinity;
		this._budget = 0;
	}

	/**
	 * Steps per second for the return, from the Doppler shift itself: energy
	 * further from the carrier is a faster hand.
	 */
	static returnRate(reading) {
		const spectrum = reading.spectrumDb;
		const baseline = reading.baselineDb;
		if (!spectrum || !baseline || spectrum.length !== baseline.length) return 15;
		if (spectrum.length <= 7 || !(reading.binWidth > 0)) return 15;
		const center = Math.floor(spectrum.length / 2);
		let weighted = 0;
		let total = 0;
		for (let i = 0; i < spectrum.length; i++) {
			if (Math.abs(i - center) < 3) continue;
			if ((reading.direction === DIRECTION.away) !== (i < center)) continue;
			const energy = Math.max(0, 10 ** (spectrum[i] / 10) - 2 * 10 ** (baseline[i] / 10));
			weighted += energy * Math.abs(i - center) * reading.binWidth;
			total += energy;
		}
		if (!(total > 0) || !Number.isFinite(weighted)) return 15;
		return Math.min(45, Math.max(5, (weighted / total) * 0.15));
	}

	/**
	 * @param {object} reading
	 * @param {number} now seconds
	 * @param {boolean} [reversed] swap which way is "in"
	 * @returns {3|-1|0|null}
	 */
	feed(reading, now, reversed = false) {
		const gap = now - this._last;
		this._last = now;
		if (gap > 0.16) {
			this._direction = '';
			this._budget = 0;
		}
		const usable =
			reading.snr > 15 &&
			reading.strength > 0.0003 &&
			(reading.direction === DIRECTION.approaching || reading.direction === DIRECTION.away);
		if (!usable) {
			// A couple of ambiguous frames must not erase a return stroke midway.
			if (now - this._began > 0.16) {
				this._direction = '';
				this._budget = 0;
			}
			return null;
		}

		const toward = (reading.direction === DIRECTION.approaching) !== reversed;
		if (this._direction !== reading.direction) {
			this._direction = reading.direction;
			this._began = now;
			this._budget = 0;
		}
		if (toward) {
			if (this.steps !== 0 || now - this._began < 0.1) return null;
			this.steps = 3;
			this._direction = '';
			return 3;
		}
		if (this.steps <= 0) return null;
		this._budget += Math.min(0.06, Math.max(0, Number.isFinite(gap) ? gap : 0)) * PushPullDetector.returnRate(reading);
		if (now - this._began < 0.025 || this._budget < 1) return null;
		this._budget -= 1;
		this.steps -= 1;
		return this.steps === 0 ? 0 : -1;
	}
}

/**
 * A held lift, read as a continuous velocity rather than a discrete event.
 *
 * Lifting the hand off the keyboard reads as sustained recession; the velocity
 * eases toward a target set by how much energy that motion is returning, and
 * eases back to nothing the moment the hand settles. `step()` is called once
 * per animation frame and returns the distance travelled in that frame.
 */
export class LiftMotion {
	constructor() {
		this.velocity = 0;
		this.target = 0;
		this.forward = true;
		this._lastAway = -Infinity;
	}

	/** Flip which way a lift travels, dropping the motion in flight with it. */
	switchDirection() {
		this.forward = !this.forward;
		this.velocity = 0;
		this.target = 0;
		this._lastAway = -Infinity;
	}

	reset() {
		this.velocity = 0;
		this.target = 0;
		this._lastAway = -Infinity;
	}

	/** @param {object} reading @param {number} now seconds */
	feed(reading, now) {
		if (reading.direction === DIRECTION.away) {
			this._lastAway = now;
			this.target =
				(this.forward ? 1 : -1) * Math.min(700, 110 + 120 * Math.log1p(reading.strength / 0.0003));
		} else if (
			reading.direction === DIRECTION.approaching ||
			reading.direction === DIRECTION.calibrating ||
			reading.direction === DIRECTION.weakTone
		) {
			this.target = 0;
			this._lastAway = -Infinity;
		}
		// Anything else (a listening or mixed frame) bridges: brief uncertainty
		// mid-lift should not drop the motion, only a confirmed return should.
	}

	/**
	 * @param {number} dt seconds since the last step
	 * @param {number} now seconds
	 * @returns {number} distance travelled this frame
	 */
	step(dt, now) {
		if (now - this._lastAway > 0.09) this.target = 0;
		const tau = this.target === 0 ? 0.075 : 0.07;
		this.velocity += (this.target - this.velocity) * (1 - Math.exp(-dt / tau));
		if (Math.abs(this.velocity) < 2 && this.target === 0) this.velocity = 0;
		return this.velocity * dt;
	}
}
