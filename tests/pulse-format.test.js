import { describe, it, expect } from 'vitest';
import { fmtUsd, fmtThree } from '../src/shared/pulse-format.js';

describe('fmtUsd', () => {
	it.each([
		[0, '$0'], [5, '$5.00'], [9.99, '$9.99'], [10, '$10'], [42, '$42'], [999, '$999'],
		[1000, '$1.0k'], [12345, '$12.3k'], [1_000_000, '$1.0M'], [2_500_000, '$2.5M'],
	])('keeps %s in its band: %s', (input, out) => expect(fmtUsd(input)).toBe(out));

	it.each([
		[9.999, '$10'], [999.6, '$1.0k'], [999_999, '$1.0M'],
	])('rolls %s over to the next unit after rounding: %s', (input, out) => expect(fmtUsd(input)).toBe(out));

	it.each([
		[9.99, '$9.99'], [10, '$10'], [10.01, '$10'],
		[999.4, '$999'], [1000, '$1.0k'], [1000.4, '$1.0k'],
		[999_949, '$999.9k'], [999_950, '$1.0M'], [1_000_001, '$1.0M'],
	])('boundary %s: %s', (input, out) => expect(fmtUsd(input)).toBe(out));

	it.each([[-5], [NaN], ['x'], [null], [undefined]])('renders %s as $0', (input) => expect(fmtUsd(input)).toBe('$0'));
});

describe('fmtThree', () => {
	it.each([
		[0.5, '0.500'], [42, '42'], [340, '340'], [12400, '12.4k'], [1_200_000, '1.20M'],
	])('keeps %s in its band: %s', (input, out) => expect(fmtThree(input)).toBe(out));

	it.each([
		[999.6, '1.0k'], [999_950, '1.00M'],
	])('rolls %s over to the next unit after rounding: %s', (input, out) => expect(fmtThree(input)).toBe(out));

	it.each([
		[999.4, '999'], [1000, '1.0k'], [1000.4, '1.0k'],
		[999_949, '999.9k'], [999_950, '1.00M'], [1_000_000, '1.00M'], [1_000_001, '1.00M'],
	])('boundary %s: %s', (input, out) => expect(fmtThree(input)).toBe(out));

	it.each([[NaN, '0.000'], ['x', '0.000'], [null, '0.000'], [-5, '-5.000']])('renders %s as before: %s', (input, out) => expect(fmtThree(input)).toBe(out));
});
