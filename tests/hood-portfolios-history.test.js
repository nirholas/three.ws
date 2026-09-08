// Unit tests for the daily-close reduction (api/_lib/hood-portfolios-history.js).
//
// Chainlink rounds arrive irregularly: several within an hour when a price is
// moving, then nothing for two days. Everything downstream assumes one
// observation per day, so this reduction is where that assumption is made, and
// getting it wrong shifts an entire backtest by a day.

import { describe, it, expect } from 'vitest';
import { snapshotKey, toDailyCloses } from '../api/_lib/hood-portfolios-history.js';

const at = (iso, priceUsd) => ({ t: Date.parse(iso), priceUsd });

describe('toDailyCloses', () => {
	it('keeps the last observation of each UTC day', () => {
		const out = toDailyCloses([
			at('2026-09-01T01:00:00Z', 100),
			at('2026-09-01T23:59:00Z', 110),
			at('2026-09-02T00:01:00Z', 120),
		]);
		expect(out.map((p) => [p.day, p.priceUsd])).toEqual([
			['2026-09-01', 110],
			['2026-09-02', 120],
		]);
	});

	it('is order independent', () => {
		const points = [
			at('2026-09-02T10:00:00Z', 120),
			at('2026-09-01T23:00:00Z', 110),
			at('2026-09-01T02:00:00Z', 100),
		];
		const forward = toDailyCloses(points);
		const reversed = toDailyCloses([...points].reverse());
		expect(forward).toEqual(reversed);
	});

	it('returns days in ascending order', () => {
		const out = toDailyCloses([
			at('2026-09-05T10:00:00Z', 1),
			at('2026-09-01T10:00:00Z', 2),
			at('2026-09-03T10:00:00Z', 3),
		]);
		expect(out.map((p) => p.day)).toEqual(['2026-09-01', '2026-09-03', '2026-09-05']);
	});

	it('drops non-positive prices rather than charting them as zero', () => {
		const out = toDailyCloses([at('2026-09-01T10:00:00Z', 0), at('2026-09-02T10:00:00Z', -5), at('2026-09-03T10:00:00Z', 7)]);
		expect(out).toHaveLength(1);
		expect(out[0].priceUsd).toBe(7);
	});

	it('leaves gaps as gaps, never filling a day it did not observe', () => {
		const out = toDailyCloses([at('2026-09-01T10:00:00Z', 100), at('2026-09-05T10:00:00Z', 105)]);
		expect(out.map((p) => p.day)).toEqual(['2026-09-01', '2026-09-05']);
	});

	it('handles an empty series', () => {
		expect(toDailyCloses([])).toEqual([]);
	});
});

describe('snapshotKey', () => {
	it('is one key per UTC day, so a second run in a day overwrites', () => {
		expect(snapshotKey(new Date('2026-09-08T00:00:01Z'))).toBe('hood_prices:2026-09-08');
		expect(snapshotKey(new Date('2026-09-08T23:59:59Z'))).toBe('hood_prices:2026-09-08');
		expect(snapshotKey(new Date('2026-09-09T00:00:00Z'))).toBe('hood_prices:2026-09-09');
	});
});
