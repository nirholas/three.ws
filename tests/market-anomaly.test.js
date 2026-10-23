// Unit tests for api/_lib/market-anomaly.js, the pure market anomaly engine.
//
// The series under tests/fixtures/market-anomaly/ are recorded from the live
// upstreams the scanner reads (DeFiLlama Solana TVL and stablecoin supply,
// Hyperliquid SOL funding history). Recorded tails must score clean; shocks
// are appended to them as one extra observation so the test states exactly
// what the detectors are asked to catch.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	median,
	modifiedZScore,
	ewmaDeviation,
	rateOfChange,
	classify,
	windowReturns,
	detectSeries,
	detectMany,
	detectPegDeviation,
	meetsSeverity,
	TVL_SPEC,
	STABLE_SUPPLY_SPEC,
	FUNDING_SPEC,
	PRICE_SPEC,
	OPEN_INTEREST_SPEC,
	MIN_POINTS,
} from '../api/_lib/market-anomaly.js';
import {
	marketAnomalyMatchesRule,
	buildMarketAnomalyPayload,
	formatAlertSummary,
	deriveRuleLabel,
} from '../api/_lib/pump-alert-eval.js';
import { createRuleSchema, validateUpdate, normalizeForKind } from '../api/alerts/_rules.js';

const load = (name) =>
	JSON.parse(readFileSync(new URL(`./fixtures/market-anomaly/${name}.json`, import.meta.url), 'utf8'));
const tvl = load('solana-tvl-daily');
const supply = load('solana-stablecoin-supply-daily');
const funding = load('hyperliquid-sol-funding-hourly');

const DAY = 86_400_000;
const HOUR = 3_600_000;
const shock = (points, factor, step) => {
	const last = points[points.length - 1];
	return [...points, { t: last.t + step, v: last.v * factor }];
};
const spec = (base, subject) => ({ ...base, subject });

describe('statistics', () => {
	it('median handles odd, even and empty input', () => {
		expect(median([3, 1, 2])).toBe(2);
		expect(median([4, 1, 3, 2])).toBe(2.5);
		expect(median([])).toBeNaN();
	});

	it('modifiedZScore flags an outlier and spares an inlier', () => {
		const h = [10, 11, 9, 10, 10, 12, 8, 10, 11, 9];
		expect(Math.abs(modifiedZScore(h, 10.5).score)).toBeLessThan(1);
		expect(modifiedZScore(h, 30).score).toBeGreaterThan(3.5);
		expect(modifiedZScore(h, -10).score).toBeLessThan(-3.5);
	});

	it('modifiedZScore falls back to mean absolute deviation when MAD is zero, and refuses a constant series', () => {
		const mostlyFlat = [5, 5, 5, 5, 5, 5, 6];
		expect(modifiedZScore(mostlyFlat, 9).score).toBeGreaterThan(3.5);
		expect(modifiedZScore([5, 5, 5, 5], 9)).toBeNull();
		expect(modifiedZScore([1], 2)).toBeNull();
		expect(modifiedZScore([1, 2, 3], NaN)).toBeNull();
	});

	it('ewmaDeviation tracks a drifting regime', () => {
		const drift = Array.from({ length: 40 }, (_, i) => 100 + i + (i % 2 ? 0.3 : -0.3));
		expect(Math.abs(ewmaDeviation(drift, 141).score)).toBeLessThan(3);
		expect(ewmaDeviation(drift, 200).score).toBeGreaterThan(3);
		expect(ewmaDeviation([2, 2, 2, 2], 3)).toBeNull();
	});

	it('rateOfChange is a percent move and refuses a non-positive base', () => {
		expect(rateOfChange(100, 110)).toBeCloseTo(10);
		expect(rateOfChange(100, 75)).toBeCloseTo(-25);
		expect(rateOfChange(0, 5)).toBeNull();
		expect(rateOfChange(-1, 5)).toBeNull();
	});

	it('windowReturns builds overlapping lookback returns', () => {
		const pts = [100, 110, 121, 133.1].map((v, i) => ({ t: i, v }));
		const r1 = windowReturns(pts, 1);
		expect(r1).toHaveLength(3);
		expect(r1[0].r).toBeCloseTo(10);
		expect(windowReturns(pts, 2)[0].r).toBeCloseTo(21);
	});

	it('classify takes the lower rung of score and move', () => {
		expect(classify(20, 5, [5, 10, 20])).toBe('medium');
		expect(classify(4, 50, [5, 10, 20])).toBe('medium');
		expect(classify(6, 12, [5, 10, 20])).toBe('high');
		expect(classify(9, 25, [5, 10, 20])).toBe('critical');
		expect(classify(9, 1, [5, 10, 20])).toBeNull();
	});

	it('meetsSeverity orders medium < high < critical', () => {
		expect(meetsSeverity('critical', 'high')).toBe(true);
		expect(meetsSeverity('medium', 'high')).toBe(false);
		expect(meetsSeverity('high', 'high')).toBe(true);
	});
});

describe('recorded Solana TVL', () => {
	it('the recorded tail is not an anomaly', () => {
		const r = detectSeries(spec(TVL_SPEC, 'Solana'), tvl);
		expect(r.anomaly).toBeNull();
	});

	it('a one-day 28% collapse is critical and points down', () => {
		const r = detectSeries(spec(TVL_SPEC, 'Solana'), shock(tvl, 0.72, DAY));
		expect(r.anomaly).toMatchObject({ processor: 'tvl', subject: 'Solana', severity: 'critical', direction: 'down' });
		expect(r.anomaly.change_pct).toBeCloseTo(-28, 0);
		expect(r.anomaly.detectors).toContain('modified_z');
		expect(r.anomaly.summary).toMatch(/fell 28\.\d+%/);
	});

	it('a statistically odd but sub-gate move is not reported', () => {
		const r = detectSeries(spec(TVL_SPEC, 'Solana'), shock(tvl, 1.02, DAY));
		expect(r.anomaly).toBeNull();
	});
});

describe('recorded Solana stablecoin supply', () => {
	it('the recorded tail is not an anomaly', () => {
		expect(detectSeries(spec(STABLE_SUPPLY_SPEC, 'Solana'), supply).anomaly).toBeNull();
	});

	it('a 9% supply drop (mass redemption) is flagged high or critical', () => {
		const r = detectSeries(spec(STABLE_SUPPLY_SPEC, 'Solana'), shock(supply, 0.91, DAY));
		expect(['high', 'critical']).toContain(r.anomaly.severity);
		expect(r.anomaly.direction).toBe('down');
	});
});

describe('recorded Hyperliquid SOL funding', () => {
	it('the recorded week is not an anomaly', () => {
		expect(detectSeries(spec(FUNDING_SPEC, 'SOL-USD'), funding).anomaly).toBeNull();
	});

	it('a funding print of 0.4% per 8h is flagged and keeps its sign', () => {
		const last = funding[funding.length - 1];
		const up = detectSeries(spec(FUNDING_SPEC, 'SOL-USD'), [...funding, { t: last.t + HOUR, v: 0.4 }]);
		expect(up.anomaly).toMatchObject({ processor: 'funding', direction: 'up' });
		expect(['high', 'critical']).toContain(up.anomaly.severity);
		const down = detectSeries(spec(FUNDING_SPEC, 'SOL-USD'), [...funding, { t: last.t + HOUR, v: -0.4 }]);
		expect(down.anomaly.direction).toBe('down');
	});
});

describe('hourly price and open interest', () => {
	const hourly = Array.from({ length: 168 }, (_, i) => ({ t: i * HOUR, v: 100 + Math.sin(i / 5) * 0.8 + (i % 3) * 0.1 }));

	it('a quiet hourly series is clean', () => {
		expect(detectSeries(spec(PRICE_SPEC, 'SYN'), hourly).anomaly).toBeNull();
	});

	it('a 20% four-hour dump is critical', () => {
		const last = hourly[hourly.length - 1];
		const pts = [...hourly.slice(0, -4), ...[0.97, 0.92, 0.86, 0.8].map((f, i) => ({ t: last.t + (i - 3) * HOUR, v: 100 * f }))];
		const r = detectSeries(spec(PRICE_SPEC, 'SYN'), pts);
		expect(r.anomaly).toMatchObject({ severity: 'critical', direction: 'down' });
	});

	it('an open interest surge of 60% in four snapshots is flagged', () => {
		const oi = Array.from({ length: 80 }, (_, i) => ({ t: i * 900_000, v: 1_000_000 + (i % 4) * 5_000 }));
		const n = oi.length;
		const pts = [...oi.slice(0, n - 1), { t: oi[n - 1].t, v: oi[n - 5].v * 1.6 }];
		const r = detectSeries(spec(OPEN_INTEREST_SPEC, 'SYN-USD'), pts);
		expect(r.anomaly).toMatchObject({ processor: 'open_interest', direction: 'up' });
	});
});

describe('sparse and flat series', () => {
	it('skips a series shorter than the minimum window instead of scoring it', () => {
		const few = tvl.slice(0, 10);
		const r = detectSeries(spec(TVL_SPEC, 'Solana'), few);
		expect(r).toMatchObject({ skipped: 'insufficient_history', have: 10 });
		expect(r.need).toBeGreaterThan(MIN_POINTS);
	});

	it('skips a perfectly flat series with a reason', () => {
		const flat = Array.from({ length: 60 }, (_, i) => ({ t: i * DAY, v: 1000 }));
		const r = detectSeries(spec(TVL_SPEC, 'Flat'), shock(flat, 0.5, DAY));
		expect(r.skipped).toBe('flat_history');
	});

	it('ignores non-finite points', () => {
		const dirty = [...tvl, { t: NaN, v: 1 }, { t: 1, v: Infinity }];
		expect(detectSeries(spec(TVL_SPEC, 'Solana'), dirty).anomaly).toBeNull();
	});

	it('detectMany returns anomalies and a skip log', () => {
		const out = detectMany(TVL_SPEC, [
			{ subject: 'Solana', points: shock(tvl, 0.7, DAY) },
			{ subject: 'Thin', points: tvl.slice(0, 5) },
		]);
		expect(out.anomalies).toHaveLength(1);
		expect(out.skipped).toEqual([{ processor: 'tvl', subject: 'Thin', reason: 'insufficient_history', have: 5, need: expect.any(Number) }]);
	});
});

describe('event keys', () => {
	it('is stable within a bucket and changes across buckets', () => {
		const a = detectSeries(spec(TVL_SPEC, 'Solana'), shock(tvl, 0.7, DAY)).anomaly;
		const b = detectSeries(spec(TVL_SPEC, 'Solana'), shock(tvl, 0.65, DAY)).anomaly;
		expect(a.event_key).toBe(b.event_key);
		const c = detectSeries(spec(TVL_SPEC, 'Solana'), shock(tvl, 0.7, 2 * DAY)).anomaly;
		expect(c.event_key).not.toBe(a.event_key);
	});
});

describe('stablecoin peg', () => {
	const coin = (over) => ({ symbol: 'SYNUSD', price: 1, peg_type: 'peggedUSD', circulating_usd: 5e9, ...over });
	const NOW = Date.UTC(2026, 9, 23, 12);

	it('on-peg and in-tolerance coins are quiet', () => {
		expect(detectPegDeviation(coin({ price: 0.9995 }), NOW)).toBeNull();
		expect(detectPegDeviation(coin({ price: 1.004 }), NOW)).toBeNull();
	});

	it('grades depth: 0.7% medium, 1.5% high, 8% critical', () => {
		expect(detectPegDeviation(coin({ price: 0.993 }), NOW).severity).toBe('medium');
		expect(detectPegDeviation(coin({ price: 0.985 }), NOW).severity).toBe('high');
		const crit = detectPegDeviation(coin({ price: 0.92 }), NOW);
		expect(crit).toMatchObject({ severity: 'critical', direction: 'down', processor: 'stablecoin_peg' });
		expect(crit.summary).toMatch(/8\.00% below its \$1 peg/);
	});

	it('judges only USD pegs with real float and a usable price', () => {
		expect(detectPegDeviation(coin({ peg_type: 'peggedEUR', price: 0.5 }), NOW)).toBeNull();
		expect(detectPegDeviation(coin({ circulating_usd: 1_000_000, price: 0.9 }), NOW)).toBeNull();
		expect(detectPegDeviation(coin({ price: null }), NOW)).toBeNull();
		expect(detectPegDeviation(null, NOW)).toBeNull();
	});

	it('keys one event per 12 hour bucket', () => {
		const a = detectPegDeviation(coin({ price: 0.9 }), NOW);
		const b = detectPegDeviation(coin({ price: 0.89 }), NOW + HOUR);
		const c = detectPegDeviation(coin({ price: 0.9 }), NOW + 13 * HOUR);
		expect(a.event_key).toBe(b.event_key);
		expect(a.event_key).not.toBe(c.event_key);
	});
});

describe('market_anomaly alert rules', () => {
	const event = { id: 7, processor: 'stablecoin_peg', subject: 'SYNUSD', metric: 'peg', severity: 'critical', direction: 'down', value: 0.92, baseline: 1, change_pct: -8, score: 8, summary: 'SYNUSD is trading at $0.9200, 8.00% below its $1 peg', observed_at: '2026-10-23T12:00:00.000Z' };
	const rule = (filters) => ({ id: 'r1', kind: 'market_anomaly', filters });

	it('defaults to high severity and above across every processor', () => {
		expect(marketAnomalyMatchesRule(rule(null), event)).toBe(true);
		expect(marketAnomalyMatchesRule(rule(null), { ...event, severity: 'medium' })).toBe(false);
	});

	it('honours processors, min_severity and subject filters', () => {
		expect(marketAnomalyMatchesRule(rule({ processors: ['funding'] }), event)).toBe(false);
		expect(marketAnomalyMatchesRule(rule({ processors: ['stablecoin_peg', 'tvl'] }), event)).toBe(true);
		expect(marketAnomalyMatchesRule(rule({ min_severity: 'medium' }), { ...event, severity: 'medium' })).toBe(true);
		expect(marketAnomalyMatchesRule(rule({ subject: 'synusd' }), event)).toBe(true);
		expect(marketAnomalyMatchesRule(rule({ subject: 'other' }), event)).toBe(false);
		expect(marketAnomalyMatchesRule({ ...rule(null), kind: 'whale_buy' }, event)).toBe(false);
	});

	it('builds a deduping payload and readable summary and label', () => {
		const p = buildMarketAnomalyPayload(rule(null), event);
		expect(p).toMatchObject({ kind: 'market_anomaly', event_id: 'anomaly:7', severity: 'critical', processor: 'stablecoin_peg' });
		expect(formatAlertSummary(p)).toContain('below its $1 peg');
		expect(deriveRuleLabel({ kind: 'market_anomaly', filters: { min_severity: 'critical', processors: ['tvl'] } })).toBe('Market anomalies · critical+ · tvl');
	});

	it('API validation accepts a bare rule and filters, and rejects a target or unknown filter keys', () => {
		expect(createRuleSchema.safeParse({ kind: 'market_anomaly' }).success).toBe(true);
		expect(createRuleSchema.safeParse({ kind: 'market_anomaly', filters: { processors: ['tvl'], min_severity: 'high' } }).success).toBe(true);
		expect(createRuleSchema.safeParse({ kind: 'market_anomaly', filters: { processors: ['nope'] } }).success).toBe(false);
		expect(createRuleSchema.safeParse({ kind: 'market_anomaly', filters: { bogus: 1 } }).success).toBe(false);
		const withTarget = createRuleSchema.safeParse({ kind: 'market_anomaly', target_mint: 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump' });
		expect(withTarget.success).toBe(false);
	});

	it('keeps anomaly filters on update and clears them when the kind changes', () => {
		expect(normalizeForKind({ kind: 'market_anomaly', filters: { min_severity: 'high' } }).filters).toEqual({ min_severity: 'high' });
		expect(normalizeForKind({ kind: 'graduation', filters: { min_severity: 'high' } }).filters).toBeNull();
		const upd = validateUpdate({ kind: 'market_anomaly', filters: null, deliver_in_app: true, cooldown_seconds: 300, enabled: true }, { filters: { min_severity: 'critical' } });
		expect(upd.ok).toBe(true);
	});
});
