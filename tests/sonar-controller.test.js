/**
 * The shared acoustic input chain (src/sonar/controller.js).
 *
 * The detectors themselves are covered against the original's own vectors in
 * tests/sonar-gestures.test.js. What is pinned here is everything the two
 * surfaces driving them rely on and would otherwise each get wrong on their own:
 *
 *  · mode gating, which is the only thing stopping a sweep from also firing a
 *    push (the microphone senses distance, so the two look alike coming in)
 *  · the reverse switches, including the lift's, which reverses through the
 *    motion rather than through a flag
 *  · that a mode change drops the stroke in flight instead of completing it
 *    under the new mapping
 *
 * The controller is driven through its public feed(), so none of this needs a
 * microphone, a speaker, or a browser.
 */

import { describe, it, expect } from 'vitest';
import { DIRECTION } from '../src/sonar/doppler.js';
import { SonarController, MODES, GESTURE_CAST } from '../src/sonar/controller.js';
import { DEFAULT_ANIMATION_MAP } from '../src/runtime/animation-slots.js';

/** Frames for a clean one-way sweep, quiet either side so the detector arms. */
function sweep(sign) {
	const frames = [];
	for (let i = 0; i < 40; i++) {
		const moving = i >= 20 && i < 30;
		const bands = new Array(8).fill(0);
		if (moving) bands[sign > 0 ? 5 : 2] = 2;
		frames.push({
			direction: DIRECTION.mixed,
			snr: 40,
			strength: moving ? 0.004 : 0,
			waveBands: bands,
		});
	}
	return frames;
}

/** A sustained approach, which is what a push toward the screen returns. */
function push(count = 12) {
	const spectrumDb = new Float32Array(121).fill(-100);
	spectrumDb[90] = -30;
	return Array.from({ length: count }, () => ({
		spectrumDb,
		baselineDb: new Float32Array(121).fill(-100),
		direction: DIRECTION.approaching,
		carrierDb: -20,
		snr: 40,
		strength: 0.004,
		binWidth: 10,
	}));
}

/** Drive frames through a controller at a realistic frame interval. */
function run(controller, frames) {
	for (const f of frames) {
		controller.feed(f);
		// The detectors read performance.now() themselves, so the frames have to
		// be spaced in real time rather than on a supplied clock.
		const until = performance.now() + 21;
		while (performance.now() < until) {
			/* the analysis hop, spent rather than mocked */
		}
	}
}

describe('SonarController', () => {
	it('reports a sweep as a direction, not as a detector event', () => {
		const seen = [];
		const c = new SonarController({ mode: 'swipe', onSwipe: (d) => seen.push(d) });
		run(c, sweep(1));
		expect(seen).toEqual([1]);
	});

	it('honours the sweep reverse switch', () => {
		const seen = [];
		const c = new SonarController({ mode: 'swipe', onSwipe: (d) => seen.push(d) });
		c.setReversed('swipe', true);
		run(c, sweep(1));
		expect(seen).toEqual([-1]);
	});

	it('does not fire a push while the mode is watching for sweeps', () => {
		const zooms = [];
		const c = new SonarController({ mode: 'swipe', onZoom: (a) => zooms.push(a) });
		run(c, push());
		expect(zooms).toEqual([]);
	});

	it('fires that same push once the mode is watching for it', () => {
		const zooms = [];
		const c = new SonarController({ mode: 'push', onZoom: (a) => zooms.push(a) });
		run(c, push());
		expect(zooms[0]).toBe(3);
	});

	it('runs every detector in the all mode', () => {
		const seen = [];
		const c = new SonarController({
			mode: 'all',
			onSwipe: () => seen.push('swipe'),
			onZoom: () => seen.push('push'),
		});
		run(c, sweep(1));
		expect(seen).toContain('swipe');
	});

	it('drops the stroke in flight when the mode changes', () => {
		const seen = [];
		const c = new SonarController({ mode: 'swipe', onSwipe: (d) => seen.push(d) });
		const frames = sweep(1);
		// Cut before the third vote: a sweep needs three coherent frames, so this
		// leaves a half-formed candidate rather than one already fired.
		run(c, frames.slice(0, 22));
		c.setMode('all');
		run(c, frames.slice(22));
		expect(seen).toEqual([]);
	});

	it('reverses a lift through the motion itself, and is idempotent', () => {
		const c = new SonarController({ mode: 'lift' });
		c.setReversed('lift', true);
		c.feed({ direction: DIRECTION.away, strength: 0.004, snr: 40 });
		expect(c._lift.target).toBeLessThan(0);
		c.setReversed('lift', true);
		c.feed({ direction: DIRECTION.away, strength: 0.004, snr: 40 });
		expect(c._lift.target).toBeLessThan(0);
		c.setReversed('lift', false);
		c.feed({ direction: DIRECTION.away, strength: 0.004, snr: 40 });
		expect(c._lift.target).toBeGreaterThan(0);
	});

	it('passes every reading through, whatever the mode reads from it', () => {
		const readings = [];
		const c = new SonarController({ mode: 'lift', onReading: (r) => readings.push(r) });
		run(c, push(3));
		expect(readings).toHaveLength(3);
		expect(c.lastReading).toBe(readings[2]);
	});

	it('refuses an unknown mode instead of silencing every detector', () => {
		const c = new SonarController({ mode: 'nonsense' });
		expect(c.mode).toBe('swipe');
		c.setMode('also-nonsense');
		expect(c.mode).toBe('swipe');
	});

	it('is not running before start and survives a stop it never started', () => {
		const c = new SonarController();
		expect(c.running).toBe(false);
		expect(() => c.stop()).not.toThrow();
		expect(c.sensor).toBeNull();
	});

	it('steps a cast every entry of which is a real gesture slot', () => {
		expect(GESTURE_CAST.length).toBeGreaterThan(1);
		for (const slot of GESTURE_CAST) {
			expect(DEFAULT_ANIMATION_MAP[slot], `${slot} is not a gesture slot`).toBeTruthy();
		}
		expect(new Set(GESTURE_CAST).size).toBe(GESTURE_CAST.length);
	});

	it('declares a detector set for every mode it offers', () => {
		for (const [name, def] of Object.entries(MODES)) {
			expect(def.label, name).toBeTruthy();
			expect(def.detectors.length, name).toBeGreaterThan(0);
			for (const d of def.detectors) expect(['swipe', 'push', 'lift']).toContain(d);
		}
	});
});
