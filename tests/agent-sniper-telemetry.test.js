/**
 * agent-sniper telemetry: tick sampling, row shape, latency stages, percentiles.
 */
import { describe, it, expect } from 'vitest';
import { shouldSampleTick, tickRow, stageLatencies, percentile, CANDIDATE_WINDOW_MS } from '../workers/agent-sniper/telemetry.js';
import { ARCHIVED_TABLES } from '../api/_lib/db-archive-tables.js';

describe('shouldSampleTick', () => {
	it('samples a position the first time', () => {
		expect(shouldSampleTick(undefined, 10_000)).toBe(true);
	});
	it('samples at most once per second per position', () => {
		expect(shouldSampleTick(10_000, 10_999)).toBe(false);
		expect(shouldSampleTick(10_000, 11_000)).toBe(true);
	});
	it('treats a clock that went backwards as a fresh sample', () => {
		expect(shouldSampleTick(20_000, 10_000)).toBe(true);
	});
});

describe('tickRow', () => {
	it('computes price per token and keeps the source', () => {
		const r = tickRow({ position_id: 'p', mint: 'M', network: 'mainnet', base_amount: '2000' }, 1_000_000, 'position');
		expect(r).toEqual({ position_id: 'p', mint: 'M', network: 'mainnet', value_lamports: 1_000_000, price_lamports_per_token: 500, source: 'position' });
	});
	it('leaves price null when the base amount is unknown, never inventing one', () => {
		const r = tickRow({ position_id: 'p', mint: 'M', network: 'mainnet', base_amount: '0' }, 5, 'moonbag');
		expect(r.price_lamports_per_token).toBeNull();
	});
	it('rejects an unknown source and a non-finite value', () => {
		expect(() => tickRow({ position_id: 'p', mint: 'M', network: 'mainnet', base_amount: '1' }, 5, 'x')).toThrow();
		expect(() => tickRow({ position_id: 'p', mint: 'M', network: 'mainnet', base_amount: '1' }, NaN, 'position')).toThrow();
	});
});

describe('candidate window', () => {
	it('is 120 seconds', () => {
		expect(CANDIDATE_WINDOW_MS).toBe(120_000);
	});
});

describe('stageLatencies', () => {
	const t = (s) => new Date(1_700_000_000_000 + s).toISOString();
	it('derives each stage gap in ms', () => {
		expect(stageLatencies({ signal_seen_at: t(0), decision_at: t(40), sent_at: t(300), landed_at: t(1_300) })).toEqual({
			signal_to_decision: 40, decision_to_sent: 260, sent_to_landed: 1_000, total: 1_300,
		});
	});
	it('omits gaps whose endpoints are missing and never goes negative', () => {
		const r = stageLatencies({ signal_seen_at: null, decision_at: t(40), sent_at: t(30), landed_at: null });
		expect(r).toEqual({ signal_to_decision: null, decision_to_sent: null, sent_to_landed: null, total: null });
	});
});

describe('percentile', () => {
	it('uses nearest-rank', () => {
		expect(percentile([10, 20, 30, 40, 50], 50)).toBe(30);
		expect(percentile([10, 20, 30, 40, 50], 90)).toBe(50);
	});
	it('returns null for no data', () => {
		expect(percentile([], 50)).toBeNull();
	});
});

describe('retention', () => {
	it('bounds the price tick table to a 14-day window in the archive list', () => {
		const spec = ARCHIVED_TABLES.find((x) => x.table === 'agent_sniper_price_ticks');
		expect(spec).toMatchObject({ tsColumn: 'ts', days: 14 });
		expect(spec.pk).toEqual([{ col: 'id', type: 'bigint' }]);
	});
});
