// Countdown text shown on the $THREE holder windows (drops page and name claim page).

import { describe, it, expect } from 'vitest';
import { formatRemaining } from '../src/early-countdown.js';

describe('formatRemaining', () => {
	it('reads m:ss under an hour', () => {
		expect(formatRemaining(0)).toBe('0:00');
		expect(formatRemaining(9_400)).toBe('0:09');
		expect(formatRemaining(15 * 60_000)).toBe('15:00');
		expect(formatRemaining(3_599_999)).toBe('59:59');
	});

	it('reads h:mm:ss under a day', () => {
		expect(formatRemaining(3_600_000)).toBe('1:00:00');
		expect(formatRemaining(23 * 3_600_000 + 5 * 60_000 + 7_000)).toBe('23:05:07');
	});

	it('reads Nd Nh from a day up', () => {
		expect(formatRemaining(86_400_000)).toBe('1d 0h');
		expect(formatRemaining(7 * 86_400_000 - 1)).toBe('6d 23h');
	});

	it('never goes negative or NaN', () => {
		expect(formatRemaining(-5_000)).toBe('0:00');
		expect(formatRemaining(Number.NaN)).toBe('0:00');
		expect(formatRemaining(undefined)).toBe('0:00');
	});
});
