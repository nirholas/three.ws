/**
 * The acoustic gesture detectors (src/sonar/gestures.js), driven by the same
 * synthetic frames Sonar's Swift suite uses (work/Sonar/WaveCalibration.swift
 * and work/Sonar/Zoom.swift in https://github.com/nirholas/sonar.cool).
 *
 * These detectors cannot be exercised by hand in CI: they need a speaker, a
 * microphone and a moving hand. What they CAN be held to is the behaviour every
 * one of their constants was tuned to produce, which is exactly what these
 * vectors encode. Each case is a bug that shipped once:
 *
 *  · a sweep and its return stroke firing two navigations instead of one
 *  · symmetric motion (a fan, a passing body) being read as a direction
 *  · a faint opposite twitch at the start of a sweep cancelling it
 *  · a push re-triggering while already zoomed, or the pull skipping levels
 *  · a weak carrier being read as a room full of motion
 */

import { describe, it, expect } from 'vitest';
import { DIRECTION } from '../src/sonar/doppler.js';
import { SwipeDetector, PushPullDetector, LiftMotion } from '../src/sonar/gestures.js';

/** A frame with the sideband energy a sweep of `balance` sign would return. */
function sweepFrame({ moving, balance = 0, bands = null }) {
	return {
		direction: DIRECTION.mixed,
		snr: 40,
		strength: moving ? 0.004 : 0,
		waveBands: bands || (moving && balance ? bandsFor(balance) : new Array(8).fill(0)),
	};
}

/** Energy in the band a hand moving with this sign would light up. */
function bandsFor(sign) {
	const bands = new Array(8).fill(0);
	bands[sign > 0 ? 5 : 2] = 2;
	return bands;
}

describe('SwipeDetector', () => {
	for (const sign of [1, -1]) {
		const expected = sign > 0 ? 'next' : 'previous';

		it(`reads a ${expected} sweep and suppresses its return stroke`, () => {
			const detector = new SwipeDetector();
			const events = [];
			for (let frame = 0; frame < 80; frame++) {
				const moving = frame >= 20 && frame < 48;
				// The lobe flips partway through: the hand passes the microphone and
				// starts receding. Only the first lobe may count.
				const value = frame < 33 ? sign : -sign;
				const event = detector.feed(
					sweepFrame({ moving, balance: value }),
					frame * 0.02,
				);
				if (event) events.push(event);
			}
			expect(events).toEqual([expected]);
		});

		it(`fires twice for two deliberate ${expected} sweeps, not for the pause between`, () => {
			const detector = new SwipeDetector();
			const fired = [];
			const times = [];
			for (let frame = 0; frame < 120; frame++) {
				const t = frame * 0.02;
				const forward = (t >= 0.3 && t < 0.44) || (t >= 1.6 && t < 1.74);
				const returning = t >= 0.7 && t < 0.9;
				const bands = new Array(8).fill(0);
				if (forward) bands[sign > 0 ? 5 : 2] = 2;
				if (returning) bands[sign > 0 ? 2 : 5] = 2;
				const event = detector.feed(
					{
						direction: DIRECTION.mixed,
						snr: 40,
						strength: forward || returning ? 0.004 : 0,
						waveBands: bands,
					},
					t,
				);
				if (event) {
					fired.push(event);
					times.push(t);
				}
			}
			expect(fired).toEqual([expected, expected]);
			// The first sweep must still land fast. A slower re-arm would make the
			// page feel like it is thinking about it.
			expect(times[0]).toBeLessThanOrEqual(0.38);
		});

		it(`does not let a faint opposite precursor cancel a ${expected} sweep`, () => {
			const detector = new SwipeDetector();
			const fired = [];
			for (let frame = 0; frame < 40; frame++) {
				const active = frame >= 20 && frame < 26;
				const balance = frame < 22 ? -sign * 0.18 : sign * 0.32;
				const bands = new Array(8).fill(0);
				if (active) {
					bands[2] = Math.log1p(1 - balance);
					bands[5] = Math.log1p(1 + balance);
				}
				const event = detector.feed(
					{
						direction: DIRECTION.mixed,
						snr: 40,
						strength: active ? 0.004 : 0,
						waveBands: bands,
					},
					frame * 0.02,
				);
				if (event) fired.push(event);
			}
			expect(fired).toEqual([expected]);
		});
	}

	it('refuses to guess a direction from symmetric motion', () => {
		const detector = new SwipeDetector();
		for (let frame = 0; frame < 100; frame++) {
			const event = detector.feed(
				{
					direction: DIRECTION.mixed,
					snr: 40,
					strength: frame > 20 ? 0.004 : 0,
					waveBands: new Array(8).fill(1),
				},
				frame * 0.02,
			);
			expect(event).toBeNull();
		}
	});

	it('stays silent while the room baseline is still being measured', () => {
		const detector = new SwipeDetector();
		for (let frame = 0; frame < 60; frame++) {
			const event = detector.feed(
				{
					direction: DIRECTION.calibrating,
					snr: 40,
					strength: 0.004,
					waveBands: bandsFor(1),
				},
				frame * 0.02,
			);
			expect(event).toBeNull();
		}
	});
});

describe('PushPullDetector', () => {
	/** A frame whose reflected energy sits `offset` bins off the carrier. */
	function sample(direction, offset) {
		const spectrumDb = new Float32Array(121).fill(-100);
		spectrumDb[60 + (direction === DIRECTION.approaching ? offset : -offset)] = -30;
		return {
			spectrumDb,
			baselineDb: new Float32Array(121).fill(-100),
			direction,
			carrierDb: -20,
			snr: 40,
			strength: 0.004,
			opposedStrength: 0.0004,
			binWidth: 10,
		};
	}

	/** Push for 7 frames, then pull, and report when it landed back at rest. */
	function trial(offset, reversed = false) {
		const detector = new PushPullDetector();
		const actions = [];
		let resetTime = 0;
		for (let i = 0; i < 100; i++) {
			const pushing = i < 7;
			const direction =
				pushing !== reversed ? DIRECTION.approaching : DIRECTION.away;
			const event = detector.feed(sample(direction, offset), i * 0.02, reversed);
			if (event !== null) {
				actions.push(event);
				if (event === 0) resetTime = i * 0.02;
			}
		}
		expect(actions).toEqual([3, -1, -1, 0]);
		return resetTime;
	}

	it('steps back one level at a time without re-triggering the push', () => {
		trial(4);
	});

	it('paces the return by how fast the hand is actually moving', () => {
		const slow = trial(4);
		const fast = trial(30);
		expect(fast).toBeLessThan(slow);
		expect(fast).toBeLessThan(0.32);
	});

	it('honours a reversed mapping', () => {
		trial(30, true);
	});

	it('ignores motion when the carrier is not clear', () => {
		const detector = new PushPullDetector();
		for (let i = 0; i < 20; i++) {
			const reading = { ...sample(DIRECTION.approaching, 30), snr: 0 };
			expect(detector.feed(reading, i * 0.02, false)).toBeNull();
		}
		expect(detector.steps).toBe(0);
	});

	it('falls back to a usable return rate when there is no spectrum to read', () => {
		expect(PushPullDetector.returnRate({ direction: DIRECTION.away })).toBe(15);
	});
});

describe('LiftMotion', () => {
	it('accelerates while the hand is held up and settles once it drops', () => {
		const motion = new LiftMotion();
		let travelled = 0;
		for (let i = 0; i < 40; i++) {
			const t = i * 0.02;
			motion.feed({ direction: DIRECTION.away, strength: 0.004 }, t);
			travelled += motion.step(0.02, t);
		}
		expect(travelled).toBeGreaterThan(0);
		expect(motion.velocity).toBeGreaterThan(100);

		const held = motion.velocity;
		let t = 0.8;
		for (let i = 0; i < 40; i++) {
			t += 0.02;
			motion.feed({ direction: DIRECTION.approaching, strength: 0 }, t);
			motion.step(0.02, t);
		}
		expect(motion.velocity).toBe(0);
		expect(held).toBeGreaterThan(0);
	});

	it('bridges brief uncertain frames instead of stalling mid-lift', () => {
		const motion = new LiftMotion();
		let t = 0;
		for (let i = 0; i < 20; i++, t += 0.02) {
			motion.feed({ direction: DIRECTION.away, strength: 0.004 }, t);
			motion.step(0.02, t);
		}
		const before = motion.velocity;
		// Two frames the analyser could not call. The hand has not moved.
		for (let i = 0; i < 2; i++, t += 0.02) {
			motion.feed({ direction: DIRECTION.listening, strength: 0.004 }, t);
			motion.step(0.02, t);
		}
		expect(motion.velocity).toBeGreaterThan(before * 0.8);
	});

	it('reverses on demand and forgets the motion in flight', () => {
		const motion = new LiftMotion();
		motion.feed({ direction: DIRECTION.away, strength: 0.004 }, 0);
		motion.step(0.02, 0.02);
		motion.switchDirection();
		expect(motion.velocity).toBe(0);
		expect(motion.forward).toBe(false);
		motion.feed({ direction: DIRECTION.away, strength: 0.004 }, 0.04);
		expect(motion.target).toBeLessThan(0);
	});
});
