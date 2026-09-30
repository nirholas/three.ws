// api/_lib/agent-earnings.js: the pure parts of the earnings read model that
// both GET /api/agents/:id/earnings and GET /api/leaderboard/earnings rely on.
// The window ranges decide which fee buckets and service rows count, and
// shapeTotals is the one place SOL and USD are derived, so the two endpoints
// can only agree if these are right.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn(async () => []) }));
vi.mock('../api/_lib/sol-price.js', () => ({ solPriceUsd: vi.fn(async () => 100) }));
vi.mock('../api/_lib/r2.js', () => ({ publicUrl: (k) => `https://cdn.example/${k}` }));

const { windowRange, normalizeWindow, shapeTotals, earningsMethod, EARNINGS_WINDOWS } = await import(
	'../api/_lib/agent-earnings.js'
);

const NOW = Date.UTC(2026, 8, 30, 14, 30); // 2026-09-30 14:30 UTC
const iso = (d) => d.toISOString();

const totals = (over = {}) => ({
	creator_lamports: 0n,
	lifetime_lamports: 0n,
	claimed_lamports: 0n,
	unclaimed_lamports: 0n,
	refreshed_at: null,
	skill_sales_usd: 0,
	skill_sales_count: 0,
	hires_usd: 0,
	hires_count: 0,
	...over,
});

describe('normalizeWindow', () => {
	it('keeps the four supported windows and falls back to all', () => {
		for (const w of EARNINGS_WINDOWS) expect(normalizeWindow(w)).toBe(w);
		expect(normalizeWindow('1y')).toBe('all');
		expect(normalizeWindow(undefined)).toBe('all');
	});
});

describe('windowRange', () => {
	it('has no range for all-time', () => {
		expect(windowRange('all', 0, NOW)).toBeNull();
	});

	it('uses the last 24 hours of 30-minute buckets, and the 24 before that', () => {
		const cur = windowRange('24h', 0, NOW);
		expect(cur.interval).toBe('30m');
		expect(iso(cur.end)).toBe('2026-09-30T14:30:00.000Z');
		expect(iso(cur.start)).toBe('2026-09-29T14:30:00.000Z');
		const prev = windowRange('24h', 1, NOW);
		expect(iso(prev.end)).toBe(iso(cur.start));
	});

	it('uses whole UTC days including today for 7d and 30d', () => {
		const week = windowRange('7d', 0, NOW);
		expect(week.interval).toBe('1d');
		expect(iso(week.start)).toBe('2026-09-24T00:00:00.000Z');
		expect(iso(week.end)).toBe('2026-10-01T00:00:00.000Z');
		const prevWeek = windowRange('7d', 1, NOW);
		expect(iso(prevWeek.end)).toBe(iso(week.start));
		expect(iso(prevWeek.start)).toBe('2026-09-17T00:00:00.000Z');
		const month = windowRange('30d', 0, NOW);
		expect(iso(month.start)).toBe('2026-09-01T00:00:00.000Z');
	});
});

describe('shapeTotals', () => {
	it('converts creator fees and service income at one price and sums them', () => {
		const out = shapeTotals(
			totals({ creator_lamports: 1_500_000_000n, skill_sales_usd: 20, skill_sales_count: 2, hires_usd: 30, hires_count: 1 }),
			100,
		);
		expect(out.creator_fees).toEqual({ lamports: '1500000000', sol: 1.5, usd: 150 });
		expect(out.service_income).toMatchObject({ usd: 50, sol: 0.5, skill_sales_count: 2, hires_count: 1 });
		expect(out.total).toEqual({ sol: 2, usd: 200 });
	});

	it('never invents a USD figure when the SOL price is unknown', () => {
		const out = shapeTotals(totals({ creator_lamports: 1_000_000_000n }), 0);
		expect(out.creator_fees.usd).toBeNull();
		expect(out.service_income.sol).toBeNull();
		expect(out.total).toEqual({ sol: 1, usd: null });
	});

	it('reports a clean zero for an agent that earned nothing', () => {
		const out = shapeTotals(totals(), 100);
		expect(out.total).toEqual({ sol: 0, usd: 0 });
		expect(out.creator_fees.lamports).toBe('0');
	});
});

describe('earningsMethod', () => {
	it('names the source, the attribution rule and the window', () => {
		expect(earningsMethod('all')).toMatch(/creator-fee index/);
		expect(earningsMethod('all')).toMatch(/own custodial wallet/);
		expect(earningsMethod('7d')).toMatch(/last 7 UTC days/);
		expect(earningsMethod('24h')).toMatch(/30-minute buckets/);
		expect(earningsMethod('all')).toMatch(/Devnet coins are excluded/);
	});
});
