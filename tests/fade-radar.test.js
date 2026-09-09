/**
 * Fade Radar, pure scoring tests.
 *
 * The score decides whether a visitor is told to walk away from a coin, so the
 * whole contract is pinned here: the share arithmetic, the sample floor that
 * separates "clean" from "we cannot tell yet", the band thresholds the measured
 * calibration is computed against, and the sentence a trader actually reads.
 * A score that reads clean on a coin full of proven-losing money is the one
 * failure this page cannot have.
 */

import { describe, it, expect } from 'vitest';
import {
	fadeScore,
	fadeVerdict,
	fadeSummary,
	RI_MIN_JUDGED,
	MIN_BUYERS,
	AVOID_SHARE,
} from '../api/_lib/fade-radar.js';

describe('fadeScore', () => {
	it('scores a clean coin at zero and calls it clear', () => {
		const s = fadeScore({ buyers: 12, riBuyers: 0, totalBuySol: 40, riBuySol: 0 });
		expect(s.score).toBe(0);
		expect(s.verdict).toBe('clear');
		expect(s.ri_buyer_share).toBe(0);
		expect(s.confidence).toBe('high');
	});

	it('scores a coin whose whole buy side is reverse indicators at 100', () => {
		const s = fadeScore({ buyers: 10, riBuyers: 10, totalBuySol: 8, riBuySol: 8 });
		expect(s.score).toBe(100);
		expect(s.verdict).toBe('avoid');
	});

	it('weights buyers 60 / volume 40', () => {
		// Half the buyers, all of the volume: 0.6*0.5 + 0.4*1 = 0.7
		const s = fadeScore({ buyers: 10, riBuyers: 5, totalBuySol: 10, riBuySol: 10 });
		expect(s.score).toBe(70);
	});

	it('falls back to the buyer share when no volume was recorded', () => {
		const s = fadeScore({ buyers: 10, riBuyers: 4, totalBuySol: 0, riBuySol: 0 });
		expect(s.ri_volume_share).toBe(0.4);
		expect(s.score).toBe(40);
	});

	it('refuses to read a buy side below the sample floor', () => {
		const s = fadeScore({ buyers: MIN_BUYERS - 1, riBuyers: 2, totalBuySol: 3, riBuySol: 3 });
		expect(s.verdict).toBe('unknown');
		expect(s.confidence).toBe('low');
	});

	it('never lets a reverse indicator count outrun the buyers or the volume', () => {
		const s = fadeScore({ buyers: 5, riBuyers: 9, totalBuySol: 2, riBuySol: 40 });
		expect(s.ri_buyers).toBe(5);
		expect(s.ri_buy_sol).toBe(2);
		expect(s.score).toBe(100);
	});

	it('treats missing, negative and non-numeric input as no data', () => {
		for (const bad of [{}, { buyers: -4, riBuyers: -2 }, { buyers: 'x', riBuyers: null }]) {
			const s = fadeScore(bad);
			expect(s.score).toBe(0);
			expect(s.buyers).toBe(0);
			expect(s.verdict).toBe('unknown');
		}
	});
});

describe('fadeVerdict', () => {
	it('needs the sample floor before it will call anything', () => {
		expect(fadeVerdict(1, MIN_BUYERS - 1)).toBe('unknown');
		expect(fadeVerdict(0, 0)).toBe('unknown');
	});

	it('splits caution from avoid exactly at the calibrated share', () => {
		expect(fadeVerdict(AVOID_SHARE - 0.001, 20)).toBe('caution');
		expect(fadeVerdict(AVOID_SHARE, 20)).toBe('avoid');
	});

	it('calls a coin with no reverse indicator clear', () => {
		expect(fadeVerdict(0, 20)).toBe('clear');
	});
});

describe('fadeSummary', () => {
	it('says how thin the sample is instead of guessing', () => {
		const s = fadeScore({ buyers: 2, riBuyers: 1 });
		expect(fadeSummary(s)).toContain('too few');
	});

	it('says nothing was observed when nothing was', () => {
		expect(fadeSummary(fadeScore({}))).toContain('nothing to read');
	});

	it('quotes the real counts on a heavy coin', () => {
		const s = fadeScore({ buyers: 8, riBuyers: 6, totalBuySol: 10, riBuySol: 9 });
		const line = fadeSummary(s);
		expect(line).toContain('6 of 8');
		expect(line).toContain('75%');
		expect(line).toContain('90%');
	});

	it('states the clean case in full', () => {
		expect(fadeSummary(fadeScore({ buyers: 11, riBuyers: 0 }))).toBe(
			'None of the 11 observed buyers is a proven reverse indicator.',
		);
	});
});

describe('thresholds', () => {
	it('holds the constants the calibration query is computed against', () => {
		expect(RI_MIN_JUDGED).toBe(5);
		expect(MIN_BUYERS).toBe(5);
		expect(AVOID_SHARE).toBe(0.25);
	});
});
