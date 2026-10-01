import { describe, expect, it } from 'vitest';
import { fmtThree, fmtUsd } from '../src/shared/pulse-format.js';

describe('Money Pulse compact formatting', () => {
	it('promotes USD values when rounding crosses a unit boundary', () => {
		expect(fmtUsd(9.999)).toBe('$10');
		expect(fmtUsd(999.6)).toBe('$1.0k');
		expect(fmtUsd(999999)).toBe('$1.0M');
	});

	it('promotes $THREE values when rounding crosses a unit boundary', () => {
		expect(fmtThree(999.6)).toBe('1.0k');
		expect(fmtThree(999950)).toBe('1.00M');
	});

	it('keeps the existing representation within each formatting band', () => {
		expect(fmtUsd(0)).toBe('$0');
		expect(fmtUsd(5)).toBe('$5.00');
		expect(fmtUsd(42)).toBe('$42');
		expect(fmtUsd(12345)).toBe('$12.3k');
		expect(fmtThree(0.5)).toBe('0.500');
		expect(fmtThree(42)).toBe('42');
		expect(fmtThree(340)).toBe('340');
		expect(fmtThree(12400)).toBe('12.4k');
		expect(fmtThree(1200000)).toBe('1.20M');
	});

	it('handles values around 10, 1k, and 1M without incorrect compact labels', () => {
		expect(fmtUsd(9.99)).toBe('$9.99');
		expect(fmtUsd(10)).toBe('$10');
		expect(fmtUsd(10.01)).toBe('$10');
		expect(fmtUsd(999.4)).toBe('$999');
		expect(fmtUsd(1000)).toBe('$1.0k');
		expect(fmtUsd(1000.01)).toBe('$1.0k');
		expect(fmtUsd(1000000)).toBe('$1.0M');
		expect(fmtUsd(1000000.01)).toBe('$1.0M');
		expect(fmtThree(999.4)).toBe('999');
		expect(fmtThree(1000)).toBe('1.0k');
		expect(fmtThree(1000.01)).toBe('1.0k');
		expect(fmtThree(999949)).toBe('999.9k');
		expect(fmtThree(1000000)).toBe('1.00M');
		expect(fmtThree(1000000.01)).toBe('1.00M');
	});

	it('preserves non-positive and invalid input behavior', () => {
		expect(fmtUsd(-1)).toBe('$0');
		expect(fmtUsd('nope')).toBe('$0');
		expect(fmtThree(-5)).toBe('-5.000');
		expect(fmtThree('nope')).toBe('0.000');
	});
});
