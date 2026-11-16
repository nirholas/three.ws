// Formatting and axis helpers behind the /nvidia live section and the
// /nvidia/benchmarks fleet chart (src/nvidia-live.js).

import { describe, it, expect } from 'vitest';
import { formatMs, timeAxis } from '../src/nvidia-live.js';

describe('formatMs', () => {
	it('shows a dash for a missing value instead of inventing one', () => {
		expect(formatMs(null)).toBe('-');
		expect(formatMs(undefined)).toBe('-');
		expect(formatMs(Number.NaN)).toBe('-');
	});

	it('picks a unit a reader can scan', () => {
		expect(formatMs(424)).toBe('424 ms');
		expect(formatMs(1107)).toBe('1.11 s');
		expect(formatMs(25_133)).toBe('25.1 s');
		expect(formatMs(179_126)).toBe('2m 59s');
		expect(formatMs(600_000)).toBe('10 min');
		expect(formatMs(119_800)).toBe('2 min');
	});
});

describe('timeAxis', () => {
	it('lands ticks on clock-friendly steps that cover the longest p95', () => {
		const { max, ticks } = timeAxis(1_543_000);
		expect(max).toBeGreaterThanOrEqual(1_543_000);
		expect(ticks).toEqual([0, 600_000, 1_200_000, 1_800_000, 2_400_000]);
		expect(ticks.map(formatMs)).toEqual(['0 ms', '10 min', '20 min', '30 min', '40 min']);
	});

	it('handles sub-second and empty inputs', () => {
		expect(timeAxis(900).ticks).toEqual([0, 250, 500, 750, 1000]);
		expect(timeAxis(0).max).toBeGreaterThan(0);
	});

	it('extends past an hour in whole hours', () => {
		const { max } = timeAxis(5 * 3_600_000);
		expect(max).toBeGreaterThanOrEqual(5 * 3_600_000);
		expect(max % 3_600_000).toBe(0);
	});
});
