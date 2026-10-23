import { describe, it, expect } from 'vitest';
import {
	mapCreatorClaim, mapRevenueEvent, mapHire, mapRoyalty, mapInvoice, mapTradePnl, valueEntry, summarize,
	toCsv, project, normalizeRule, ruleHash, planRun, lastPeriod, runKey, legKey, bucketStart, formatAtomics,
	USDC_MINTS, reachedMilestones,
} from '../api/_lib/revenue-ledger-core.js';

const U = '11111111-1111-1111-1111-111111111111';
const A = '22222222-2222-2222-2222-222222222222';
const SIG = '5'.repeat(88);

describe('source mapping', () => {
	it('maps a creator fee claim in lamports with its signature', () => {
		const e = mapCreatorClaim({ id: 'c1', user_id: U, agent_id: A, claimed_lamports: 2_500_000_000, claim_sig: SIG, created_at: '2026-10-01T00:00:00Z', network: 'mainnet', mint: 'M' });
		expect(e).toMatchObject({ source: 'creator_fee_claim', asset: 'SOL', amount_atomics: '2500000000', tx_signature: SIG, usd: null });
		expect(valueEntry(e, { SOL: 100 })).toMatchObject({ usd: 250, usd_basis: 'sync_price' });
	});
	it('skips claims with no signature or no owner', () => {
		expect(mapCreatorClaim({ id: 'c', user_id: U, agent_id: A, claimed_lamports: 5, claim_sig: null })).toBeNull();
		expect(mapCreatorClaim({ id: 'c', user_id: null, agent_id: A, claimed_lamports: 5, claim_sig: SIG })).toBeNull();
	});
	it('values USDC sales exactly and extracts the tx from the intent id', () => {
		const e = mapRevenueEvent({ id: 'r1', owner_user_id: U, agent_id: A, net_amount: 1_500_000, currency_mint: USDC_MINTS.mainnet, chain: 'solana', intent_id: `x402:${SIG}`, created_at: '2026-10-02T00:00:00Z' });
		expect(e).toMatchObject({ usd: 1.5, usd_basis: 'exact', tx_signature: SIG, counted: true });
	});
	it('does not invent a signature from a random-uuid intent id and flags base as excluded', () => {
		const e = mapRevenueEvent({ id: 'r2', owner_user_id: U, agent_id: A, net_amount: 1_000_000, currency_mint: USDC_MINTS.mainnet, chain: 'base', intent_id: 'x402:eip155:8453:abc', created_at: '2026-10-02T00:00:00Z' });
		expect(e).toMatchObject({ tx_signature: null, counted: false, exclusion_reason: 'evm_not_included', chain: 'base' });
	});
	it('leaves an unknown currency unvalued', () => {
		const e = mapRevenueEvent({ id: 'r3', owner_user_id: U, agent_id: A, net_amount: 7, currency_mint: 'Weird', chain: 'solana', intent_id: 'x', created_at: '2026-10-02T00:00:00Z' });
		expect(e.usd).toBeNull();
		expect(valueEntry(e, { SOL: 100 }).usd).toBeNull();
	});
	it('maps only completed hires to the provider', () => {
		const h = { id: 'h', status: 'completed', provider_agent_id: A, provider_user_id: U, amount_atomics: '250000', usd: 0.25, currency: 'USDC', payment_signature: SIG, created_at: '2026-10-03T00:00:00Z' };
		expect(mapHire(h)).toMatchObject({ source: 'hire', usd: 0.25, usd_basis: 'recorded', tx_signature: SIG });
		expect(mapHire({ ...h, status: 'pending' })).toBeNull();
	});
	it('maps settled royalties, excluding EVM ones from totals', () => {
		const r = { id: 'y', status: 'settled', author_user_id: U, price_usd: '0.0075', network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', tx_hash: SIG, settled_at: '2026-10-04T00:00:00Z' };
		expect(mapRoyalty(r)).toMatchObject({ amount_atomics: '7500', usd: 0.0075, counted: true });
		expect(mapRoyalty({ ...r, network: 'eip155:8453' })).toMatchObject({ counted: false, chain: 'base', tx_signature: null });
		expect(mapRoyalty({ ...r, status: 'pending' })).toBeNull();
	});
	it('maps paid invoices and keeps devnet out of mainnet totals', () => {
		const i = { id: 'i', status: 'paid', user_id: U, agent_id: A, paid_atomics: '5000000', decimals: 6, asset: 'USDC', paid_usd: '5', paid_at: '2026-10-05T00:00:00Z', number: 'INV-1', network: 'devnet', payment_signature: SIG };
		const e = mapInvoice(i);
		expect(e).toMatchObject({ usd: 5, network: 'devnet' });
		expect(summarize([e]).revenue_usd).toBe(0);
	});
	it('maps closed positions with signed PnL', () => {
		const e = mapTradePnl({ id: 'p', status: 'closed', user_id: U, agent_id: A, realized_pnl_lamports: '-1000000000', sell_sig: SIG, closed_at: '2026-10-06T00:00:00Z', network: 'mainnet', symbol: 'X' });
		expect(e).toMatchObject({ kind: 'pnl', amount_atomics: '-1000000000' });
		expect(valueEntry(e, { SOL: 150 }).usd).toBe(-150);
	});
});

describe('totals', () => {
	const mk = (source, usd, at) => ({ source, kind: source === 'trading_pnl' ? 'pnl' : 'revenue', usd, occurred_at: at, chain: 'solana', network: 'mainnet', counted: true });
	it('sums by source, separates PnL, counts unvalued and fills empty periods', () => {
		const s = summarize([
			mk('hire', 2, '2026-10-01T10:00:00Z'),
			mk('skill_sale', 3, '2026-10-01T11:00:00Z'),
			mk('trading_pnl', -1, '2026-10-03T10:00:00Z'),
			mk('invoice', null, '2026-10-03T10:00:00Z'),
		], { period: 'day' });
		expect(s.revenue_usd).toBe(5);
		expect(s.trading_pnl_usd).toBe(-1);
		expect(s.net_usd).toBe(4);
		expect(s.unvalued_count).toBe(1);
		expect(s.series.map((p) => p.start.slice(0, 10))).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
		expect(s.series[1].hire).toBe(0);
	});
	it('buckets weeks on Monday and months on the first', () => {
		expect(bucketStart('2026-10-23T12:00:00Z', 'week').toISOString()).toBe('2026-10-19T00:00:00.000Z');
		expect(bucketStart('2026-10-23T12:00:00Z', 'month').toISOString()).toBe('2026-10-01T00:00:00.000Z');
	});
	it('exports CSV with exact amounts and neutralises formula cells', () => {
		const csv = toCsv([{ occurred_at: '2026-10-01T00:00:00Z', source: 'hire', kind: 'revenue', asset: 'USDC', amount_atomics: '1500000', decimals: 6, usd: 1.5, counterparty: '=cmd()', label: 'a,b', counted: true }]);
		const [head, row] = csv.trim().split('\n');
		expect(head.startsWith('occurred_at,source')).toBe(true);
		expect(row).toContain(',1.5,');
		expect(row).toContain("'=cmd()");
		expect(row).toContain('"a,b"');
	});
	it('formats atomics without float drift', () => {
		expect(formatAtomics('1500000', 6)).toBe('1.5');
		expect(formatAtomics('-1000000000', 9)).toBe('-1');
		expect(formatAtomics('1', 9)).toBe('0.000000001');
	});
	it('announces milestones in order', () => {
		expect(reachedMilestones(150)).toEqual([1, 10, 100]);
	});
});

describe('projection', () => {
	const now = Date.parse('2026-10-23T00:00:00Z');
	const e = (days, usd) => ({ kind: 'revenue', usd, chain: 'solana', network: 'mainnet', counted: true, occurred_at: new Date(now - days * 86400000).toISOString() });
	it('refuses with too little history', () => {
		const p = project([e(2, 5), e(1, 5)], { now });
		expect(p.available).toBe(false);
		expect(p.reason).toMatch(/at least 7 days/);
	});
	it('holds the trailing run rate flat with no growth term', () => {
		const p = project([e(40, 100), e(20, 30), e(10, 30), e(1, 30)], { now, windowDays: 30, horizonDays: 30 });
		expect(p.available).toBe(true);
		expect(p.trailing_revenue_usd).toBe(90);
		expect(p.per_day_usd).toBe(3);
		expect(p.projected_usd).toBe(90);
		expect(p.window_days).toBe(30);
	});
});

describe('reinvest rules', () => {
	const body = { legs: [{ kind: 'model_credits', pct: 20 }, { kind: 'dca_own_coin', pct: 20 }, { kind: 'tools_budget', pct: 10, session_id: '33333333-3333-3333-3333-333333333333' }], per_run_cap_usd: 50, lifetime_cap_usd: 500 };
	it('accepts the brief example and keeps the rest implicit', () => {
		const r = normalizeRule(body);
		expect(r.legs).toHaveLength(3);
		expect(r.period).toBe('weekly');
	});
	it('rejects over 100 percent, duplicates, missing session and missing caps', () => {
		expect(() => normalizeRule({ ...body, legs: [{ kind: 'model_credits', pct: 60 }, { kind: 'dca_own_coin', pct: 50 }] })).toThrow(/over 100/);
		expect(() => normalizeRule({ ...body, legs: [{ kind: 'model_credits', pct: 5 }, { kind: 'model_credits', pct: 5 }] })).toThrow(/twice/);
		expect(() => normalizeRule({ ...body, legs: [{ kind: 'tools_budget', pct: 5 }] })).toThrow(/session/);
		expect(() => normalizeRule({ ...body, per_run_cap_usd: 0 })).toThrow(/per-run cap/);
		expect(() => normalizeRule({ ...body, lifetime_cap_usd: 10 })).toThrow(/lifetime cap/);
	});
	it('changes the confirmation hash on any edit', () => {
		const a = { ...normalizeRule(body), agent_id: 'a' };
		const b = { ...a, legs: a.legs.map((l) => (l.kind === 'model_credits' ? { ...l, pct: 25 } : l)) };
		expect(ruleHash(a)).toBe(ruleHash({ ...a, legs: [...a.legs].reverse() }));
		expect(ruleHash(a)).not.toBe(ruleHash(b));
		expect(ruleHash(a)).not.toBe(ruleHash({ ...a, per_run_cap_usd: 51 }));
	});
	it('plans the split and keeps the remainder', () => {
		const p = planRun({ baseUsd: 100, legs: normalizeRule(body).legs, perRunCapUsd: 50, lifetimeCapUsd: 500 });
		expect(p.legs.map((l) => l.capped_usd)).toEqual([20, 20, 10]);
		expect(p.kept_usd).toBe(50);
		expect(p.scaled).toBe(false);
	});
	it('scales every leg proportionally under the per-run cap', () => {
		const p = planRun({ baseUsd: 1000, legs: normalizeRule(body).legs, perRunCapUsd: 50, lifetimeCapUsd: 500 });
		expect(p.executable_usd).toBeLessThanOrEqual(50);
		expect(p.legs[0].capped_usd).toBeCloseTo(p.legs[1].capped_usd, 5);
		expect(p.legs[0].capped_usd / p.legs[2].capped_usd).toBeCloseTo(2, 3);
		expect(p.scaled).toBe(true);
	});
	it('stops at the lifetime cap and under the minimum run', () => {
		const legs = normalizeRule(body).legs;
		expect(planRun({ baseUsd: 100, legs, perRunCapUsd: 50, lifetimeCapUsd: 500, lifetimeSpentUsd: 500 }).skip).toMatch(/lifetime/);
		expect(planRun({ baseUsd: 100, legs, perRunCapUsd: 50, lifetimeCapUsd: 500, lifetimeSpentUsd: 495 }).executable_usd).toBeLessThanOrEqual(5);
		const small = planRun({ baseUsd: 1, legs, perRunCapUsd: 50, lifetimeCapUsd: 500, minRunUsd: 1 });
		expect(small.skip).toMatch(/minimum/);
		expect(small.executable_usd).toBe(0);
		expect(planRun({ baseUsd: 0, legs, perRunCapUsd: 50, lifetimeCapUsd: 500 }).skip).toMatch(/No income/);
	});
	it('derives stable idempotency keys and the last complete period', () => {
		const { start, end } = lastPeriod('weekly', Date.parse('2026-10-23T12:00:00Z'));
		expect(start.toISOString()).toBe('2026-10-12T00:00:00.000Z');
		expect(end.toISOString()).toBe('2026-10-19T00:00:00.000Z');
		expect(runKey('r', start)).toBe('revenue_reinvest:r:2026-10-12T00:00:00.000Z');
		expect(legKey('r', start, 'model_credits')).toBe(`${runKey('r', start)}:model_credits`);
		expect(lastPeriod('monthly', Date.parse('2026-01-15T00:00:00Z')).start.toISOString()).toBe('2025-12-01T00:00:00.000Z');
	});
});

describe('simulated fills', () => {
	it('keeps simulated positions out of totals', () => {
		const e = mapTradePnl({ id: 'p', status: 'closed', user_id: U, agent_id: A, realized_pnl_lamports: '1000000000', sell_sig: SIG, closed_at: '2026-10-06T00:00:00Z', network: 'mainnet', exec_route: 'simulated' });
		expect(e).toMatchObject({ counted: false, exclusion_reason: 'simulated_fill' });
		expect(summarize([valueEntry(e, { SOL: 100 })]).trading_pnl_usd).toBe(0);
	});
});
