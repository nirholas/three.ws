// Tests for the audio-driven lipsync math.
//
// The shape estimator is a pure function over a Uint8Array, so we exercise it
// directly without an AudioContext. The numeric thresholds here track the
// constants in lipsync-driver.js — change both together if you tune them.

import { describe, it, expect } from 'vitest';
import { computeShape } from '../src/voice/lipsync-driver.js';

// Build a synthetic spectrum: ints 0..255 across the FFT bin array, controlled
// per third so we can simulate vowel-like distributions.
function spectrum({ low = 0, mid = 0, high = 0, bins = 128 } = {}) {
	const a = new Uint8Array(bins);
	const third = Math.floor(bins / 3);
	for (let i = 0; i < third; i++) a[i] = low;
	for (let i = third; i < third * 2; i++) a[i] = mid;
	for (let i = third * 2; i < bins; i++) a[i] = high;
	return a;
}

describe('computeShape — energy → mouth open', () => {
	it('returns a zero shape for silence', () => {
		const s = computeShape(spectrum({ low: 0, mid: 0, high: 0 }));
		expect(s.open).toBe(0);
		expect(s.wide).toBe(0);
		expect(s.round).toBe(0);
	});

	it('returns a zero shape below the noise floor', () => {
		// All channels at 5/255 ≈ 2% energy — below NOISE_FLOOR (4%).
		const s = computeShape(spectrum({ low: 5, mid: 5, high: 5 }));
		expect(s.open).toBe(0);
	});

	it('opens the mouth proportional to overall energy', () => {
		const quiet = computeShape(spectrum({ low: 40, mid: 40, high: 40 }));
		const loud = computeShape(spectrum({ low: 200, mid: 200, high: 200 }));
		expect(loud.open).toBeGreaterThan(quiet.open);
		expect(loud.open).toBeLessThanOrEqual(1);
	});

	it('clamps open to 1 even with high gain on a saturated signal', () => {
		const s = computeShape(spectrum({ low: 255, mid: 255, high: 255 }), 5);
		expect(s.open).toBe(1);
	});
});

describe('computeShape — front (wide) vs back (round) vowels', () => {
	it('lights up wide when high-frequency energy dominates (front vowel /i/ /e/)', () => {
		// High-band heavy → wide should win, round should stay near zero.
		const s = computeShape(spectrum({ low: 30, mid: 50, high: 220 }));
		expect(s.wide).toBeGreaterThan(0.2);
		expect(s.wide).toBeGreaterThan(s.round);
	});

	it('lights up round when low-frequency energy dominates (back vowel /o/ /u/)', () => {
		const s = computeShape(spectrum({ low: 220, mid: 50, high: 30 }));
		expect(s.round).toBeGreaterThan(0.2);
		expect(s.round).toBeGreaterThan(s.wide);
	});

	it('stays mostly neutral on a flat spectrum (no dominant vowel band)', () => {
		const s = computeShape(spectrum({ low: 120, mid: 120, high: 120 }));
		// Neither wide nor round should drive hard — open is the main signal.
		expect(s.wide).toBeLessThan(0.3);
		expect(s.round).toBeLessThan(0.3);
	});
});

describe('computeShape — robustness', () => {
	it('handles an empty array without throwing', () => {
		const s = computeShape(new Uint8Array(0));
		expect(s).toEqual({ open: 0, wide: 0, round: 0 });
	});

	it('handles odd-length arrays (third division remainder)', () => {
		// 127 bins — third = 42, remainder 1 in the high band.
		const s = computeShape(spectrum({ low: 200, mid: 200, high: 200, bins: 127 }));
		expect(s.open).toBeGreaterThan(0);
		expect(s.open).toBeLessThanOrEqual(1);
	});

	it('clamps all channels to [0, 1]', () => {
		// Adversarial: ratios designed to push wide/round negative or > 1.
		const cases = [
			spectrum({ low: 0, mid: 200, high: 0 }),
			spectrum({ low: 0, mid: 0, high: 255 }),
			spectrum({ low: 255, mid: 0, high: 0 }),
		];
		for (const bins of cases) {
			const s = computeShape(bins, 2.5);
			for (const v of [s.open, s.wide, s.round]) {
				expect(v).toBeGreaterThanOrEqual(0);
				expect(v).toBeLessThanOrEqual(1);
			}
		}
	});
});
