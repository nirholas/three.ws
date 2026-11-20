import { describe, it, expect } from 'vitest';
import { creditPosition, creditVerdict, creditExpiry } from '../api/_lib/xai-credit-health.js';

const DAY = 86_400_000;
const issuedAt = '2026-11-01T00:00:00Z';
const at = (daysAfterIssue) => new Date(issuedAt).getTime() + daysAfterIssue * DAY;

function verdict(over) {
	const p = creditPosition({ now: at(10), grantUsd: 1000, issuedAt, spentUsd: 100, spent24hUsd: 10, spent7dUsd: 70, dailyCapUsd: 200, ...over });
	return { p, v: creditVerdict(p) };
}

describe('creditExpiry', () => {
	it('is six calendar months after issue', () => {
		expect(creditExpiry(issuedAt).toISOString().slice(0, 10)).toBe('2027-05-01');
	});
});

describe('creditVerdict', () => {
	it('is ok on a healthy burn with runway past expiry', () => {
		const { p, v } = verdict({});
		expect(v.status).toBe('ok');
		expect(p.burnPerDayUsd).toBeCloseTo(10);
		expect(p.daysToExhaustion).toBe(90);
	});

	it('warns when credit runs out within 14 days, before expiry', () => {
		const { v } = verdict({ spentUsd: 900, spent7dUsd: 70 });
		expect(v.status).toBe('warn');
		expect(v.reasons.join()).toMatch(/runs out in 10 days/);
	});

	it('warns when expiry is within 30 days with more than 40% unspent', () => {
		const { v } = verdict({ now: at(160), spentUsd: 300, spent7dUsd: 7 });
		expect(v.status).toBe('warn');
		expect(v.reasons.join()).toMatch(/unspent/);
	});

	it('stays ok near expiry when most of the grant is spent', () => {
		const { v } = verdict({ now: at(160), spentUsd: 800, spent7dUsd: 7 });
		expect(v.status).toBe('ok');
	});

	it('fails when 24 hour spend is over the daily cap', () => {
		const { v } = verdict({ spent24hUsd: 250 });
		expect(v.status).toBe('fail');
		expect(v.reasons.join()).toMatch(/daily cap/);
	});

	it('fails when the grant is spent', () => {
		const { v } = verdict({ spentUsd: 1000 });
		expect(v.status).toBe('fail');
	});

	it('does not apply a cap that is not configured', () => {
		const { v } = verdict({ spent24hUsd: 5000, dailyCapUsd: null });
		expect(v.status).toBe('ok');
	});
});
