// Pure display formatters behind the global coin pages (/coins, /coin/:id).
// These render every number on both surfaces — a wrong branch here shows a
// wrong price to every visitor, so the edges (nulls, zero, sub-cent prices,
// unit boundaries) are pinned.

import { describe, expect, it } from 'vitest';
import {
	formatUsd,
	formatPrice,
	formatPercent,
	formatSupply,
	formatTurnover,
	formatDateShort,
	formatChartTick,
	timeAgo,
	escapeHtml,
	downsample,
} from '../src/shared/coin-format.js';

describe('formatUsd', () => {
	it('returns an em dash for missing input', () => {
		expect(formatUsd(null)).toBe('—');
		expect(formatUsd(undefined)).toBe('—');
		expect(formatUsd(NaN)).toBe('—');
	});
	it('scales through K / M / B / T at the unit boundaries', () => {
		expect(formatUsd(999.994)).toBe('$999.99');
		expect(formatUsd(1_000)).toBe('$1.00K');
		expect(formatUsd(1_500_000)).toBe('$1.50M');
		expect(formatUsd(2_340_000_000)).toBe('$2.34B');
		expect(formatUsd(1.23e12)).toBe('$1.23T');
	});
	it('keeps the sign on negative amounts', () => {
		expect(formatUsd(-1_500_000)).toBe('-$1.50M');
	});
});

describe('formatPrice', () => {
	it('handles missing and zero', () => {
		expect(formatPrice(null)).toBe('—');
		expect(formatPrice(0)).toBe('$0.00');
	});
	it('uses locale grouping with 2 decimals at $1+', () => {
		expect(formatPrice(67123.456)).toBe('$67,123.46');
		expect(formatPrice(1)).toBe('$1.00');
	});
	it('uses 4 significant figures below $1', () => {
		expect(formatPrice(0.123456)).toBe('$0.1235');
		expect(formatPrice(0.00012345)).toBe('$0.0001234');
	});
	it('never emits exponent notation for micro-cap prices', () => {
		const s = formatPrice(0.000000123);
		expect(s).not.toMatch(/e/i);
		expect(s.startsWith('$0.000000123')).toBe(true);
	});
});

describe('formatPercent', () => {
	it('signs both directions and dashes missing input', () => {
		expect(formatPercent(4.2)).toBe('+4.20%');
		expect(formatPercent(-1.314)).toBe('-1.31%');
		expect(formatPercent(0)).toBe('+0.00%');
		expect(formatPercent(null)).toBe('—');
	});
});

describe('formatSupply', () => {
	it('scales without a currency prefix', () => {
		expect(formatSupply(19_710_000)).toBe('19.71M');
		expect(formatSupply(120_450_000_000)).toBe('120.45B');
		expect(formatSupply(1.5e12)).toBe('1.50T');
		expect(formatSupply(42)).toBe('42');
		expect(formatSupply(null)).toBe('—');
	});
});

describe('formatTurnover', () => {
	it('says n/a when a chain reports no TVL or no DEX volume', () => {
		expect(formatTurnover(null)).toBe('n/a');
		expect(formatTurnover(undefined)).toBe('n/a');
		expect(formatTurnover(Number.NaN)).toBe('n/a');
	});
	it('keeps two decimals at 0.1x and above, three below', () => {
		expect(formatTurnover(4.8)).toBe('4.80x');
		expect(formatTurnover(0.1)).toBe('0.10x');
		expect(formatTurnover(0.0404)).toBe('0.040x');
		expect(formatTurnover(0.001)).toBe('0.001x');
	});
	it('never rounds a trading chain down to a zero reading', () => {
		// Bitcoin: about $4.27B TVL against a few hundred thousand dollars of
		// 24h DEX volume. toFixed(3) printed 0.000x, which reads as no trading.
		expect(formatTurnover(0.00007)).toBe('<0.001x');
		expect(formatTurnover(0.00049)).toBe('<0.001x');
	});
	it('prints a true zero as zero', () => {
		expect(formatTurnover(0)).toBe('0x');
	});
});

describe('formatDateShort', () => {
	it('formats ISO dates and dashes garbage', () => {
		expect(formatDateShort('2024-03-14T00:00:00Z')).toBe('Mar 14, 2024');
		expect(formatDateShort('not-a-date')).toBe('—');
		expect(formatDateShort(null)).toBe('—');
	});
});

describe('formatChartTick', () => {
	const ts = Date.UTC(2026, 2, 14, 15, 30); // Mar 14 2026 15:30 UTC
	it('picks granularity by window size', () => {
		expect(formatChartTick(ts, 1)).toMatch(/\d{1,2}:\d{2}/);
		expect(formatChartTick(ts, 30)).toMatch(/Mar \d{1,2}/);
		expect(formatChartTick(ts, 365)).toMatch(/Mar '26/);
	});
});

describe('timeAgo', () => {
	const now = Date.UTC(2026, 6, 4, 12, 0, 0);
	it('buckets by age', () => {
		expect(timeAgo(new Date(now - 30_000).toISOString(), now)).toBe('just now');
		expect(timeAgo(new Date(now - 5 * 60_000).toISOString(), now)).toBe('5m ago');
		expect(timeAgo(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe('3h ago');
		expect(timeAgo(new Date(now - 2 * 86_400_000).toISOString(), now)).toBe('2d ago');
	});
	it('falls back to a date past 14 days and empties on garbage', () => {
		expect(timeAgo(new Date(now - 30 * 86_400_000).toISOString(), now)).toMatch(/\w{3} \d{1,2}, \d{4}/);
		expect(timeAgo('nope', now)).toBe('');
		expect(timeAgo(null, now)).toBe('');
	});
});

describe('escapeHtml', () => {
	it('escapes the five HTML-special characters', () => {
		expect(escapeHtml(`<img src="x" onerror='y'>&`)).toBe(
			'&lt;img src=&quot;x&quot; onerror=&#39;y&#39;&gt;&amp;',
		);
		expect(escapeHtml(null)).toBe('');
	});
});

describe('downsample', () => {
	it('passes short series through untouched', () => {
		const s = [1, 2, 3];
		expect(downsample(s, 10)).toBe(s);
		expect(downsample(null, 10)).toEqual([]);
	});
	it('caps length and always keeps first and last points', () => {
		const s = Array.from({ length: 168 }, (_, i) => i);
		const out = downsample(s, 32);
		expect(out).toHaveLength(32);
		expect(out[0]).toBe(0);
		expect(out[31]).toBe(167);
	});
});
