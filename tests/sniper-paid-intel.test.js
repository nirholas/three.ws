// Paid-intel sniper arm: agreement rule, skip-on-failed-payment (never an unpaid
// fetch), receipts on every decision, budget cap, and the isolation of the
// rules and llm modes. The payment boundary (payX402) is injected here only;
// app code calls the real payX402.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	evaluateSignals, launchQualityPasses, purchaseSignals, runPaidIntelCycle, isPaidIntel, signalPlan,
} from '../workers/agent-sniper/paid-intel.js';
import { proposeAdjustments } from '../api/_lib/sniper-optimizer.js';

const NOW = 1_800_000_000_000;
const SYN = (n) => `THREEsynthetic${String(n).padStart(2, '0')}1111111111111111111111111`;

const launch = (n, over = {}) => ({
	mint: SYN(n), name: `Syn${n}`, symbol: `S${n}`, created_at: NOW - 60_000,
	market_cap_usd: 6000, liquidity_sol: 30, ...over,
});
const launches = (...l) => ({ launches: l, avg_initial_liquidity_sol: 20 });
const strat = { id: 's1', agent_id: 'a1', user_id: 'u1', network: 'mainnet', decision_mode: 'paid_intel', intel_daily_cap_atomic: 1_000_000 };

describe('agreement rule truth table', () => {
	const l = launches(launch(1));
	const anomalyYes = { anomaly: true, mint: SYN(1), signal: 'bullish' };
	const trendYes = { signal: 'bullish', trending_mints: [{ mint: SYN(1) }] };

	it('launch quality alone is not enough', () => {
		const { best } = evaluateSignals({ launches: l, anomaly: { anomaly: false }, trending: { trending_mints: [] }, strat, nowMs: NOW });
		expect(best).toBe(null);
	});
	it('launch quality + volume anomaly passes', () => {
		const { best } = evaluateSignals({ launches: l, anomaly: anomalyYes, trending: { trending_mints: [] }, strat, nowMs: NOW });
		expect(best.mint).toBe(SYN(1));
		expect(best.agreeing).toEqual(['launch_quality', 'volume_anomaly']);
	});
	it('launch quality + trending passes', () => {
		const { best } = evaluateSignals({ launches: l, anomaly: { anomaly: false }, trending: trendYes, strat, nowMs: NOW });
		expect(best.agreeing).toEqual(['launch_quality', 'trending']);
	});
	it('anomaly + trending without launch quality never buys', () => {
		const weak = launches(launch(1, { liquidity_sol: 5 }));
		const { best } = evaluateSignals({ launches: weak, anomaly: anomalyYes, trending: trendYes, strat, nowMs: NOW });
		expect(best).toBe(null);
	});
	it('a bearish or off-mint anomaly does not count', () => {
		const a = evaluateSignals({ launches: l, anomaly: { anomaly: true, mint: SYN(1), signal: 'bearish' }, trending: {}, strat, nowMs: NOW });
		const b = evaluateSignals({ launches: l, anomaly: { anomaly: true, mint: SYN(9), signal: 'bullish' }, trending: {}, strat, nowMs: NOW });
		expect(a.best).toBe(null);
		expect(b.best).toBe(null);
	});
	it('all three signals ranks above two', () => {
		const two = launch(2, { liquidity_sol: 90 });
		const both = launches(launch(1), two);
		const { best } = evaluateSignals({
			launches: both, anomaly: { anomaly: true, mint: SYN(1), signal: 'bullish' },
			trending: { signal: 'bullish', trending_mints: [SYN(1), SYN(2)] }, strat, nowMs: NOW,
		});
		expect(best.mint).toBe(SYN(1));
		expect(best.agree).toBe(3);
	});
	it('honours the strategy market cap band and launch age', () => {
		expect(launchQualityPasses(launch(1, { market_cap_usd: 90_000 }), 20, { max_market_cap_usd: 50_000 }, NOW)).toBe(false);
		expect(launchQualityPasses(launch(1, { created_at: NOW - 3_600_000 }), 20, {}, NOW)).toBe(false);
		expect(launchQualityPasses(launch(1), 20, { min_market_cap_usd: 1000 }, NOW)).toBe(true);
	});
});

const settled = (n) => ({ paid: true, success: true, free: false, skipped: false, amountAtomic: 10_000, txSig: `sig${n}`, responseBody: {} });

describe('purchaseSignals', () => {
	it('stops at the first failed purchase and makes no further call (no unpaid fallback)', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch');
		const pay = vi.fn()
			.mockResolvedValueOnce({ ...settled(1), responseBody: { launches: [] } })
			.mockResolvedValueOnce({ paid: false, success: false, free: false, skipped: true, amountAtomic: 10_000, txSig: null, errorMsg: 'insufficient_payer_usdc' });
		const out = await purchaseSignals({ origin: 'https://x.test', pay, ctx: {}, remainingCapAtomic: 1_000_000 });
		expect(out.ok).toBe(false);
		expect(out.reason).toBe('purchase_failed:anomaly:insufficient_payer_usdc');
		expect(pay).toHaveBeenCalledTimes(2);
		expect(out.receipts).toHaveLength(1);
		expect(out.spent).toBe(10_000);
		expect(fetchSpy).not.toHaveBeenCalled();
		fetchSpy.mockRestore();
	});
	it('treats a free (uncharged) answer as a failed purchase', async () => {
		const pay = vi.fn().mockResolvedValue({ paid: false, success: true, free: true, amountAtomic: 0, txSig: null, responseBody: { launches: [] } });
		const out = await purchaseSignals({ origin: 'https://x.test', pay, ctx: {}, remainingCapAtomic: 1_000_000 });
		expect(out.ok).toBe(false);
		expect(out.reason).toBe('purchase_failed:launches:endpoint_did_not_charge');
	});
	it('treats a settled payment with no signature as failed', async () => {
		const pay = vi.fn().mockResolvedValue({ ...settled(1), txSig: null });
		const out = await purchaseSignals({ origin: 'https://x.test', pay, ctx: {}, remainingCapAtomic: 1_000_000 });
		expect(out.ok).toBe(false);
	});
	it('passes the shrinking remaining cap down and stops once it is spent', async () => {
		const pay = vi.fn().mockResolvedValue({ ...settled(1), amountAtomic: 600_000 });
		const out = await purchaseSignals({ origin: 'https://x.test', pay, ctx: {}, remainingCapAtomic: 1_000_000 });
		expect(pay.mock.calls[0][0].remainingCap).toBe(1_000_000);
		expect(pay.mock.calls[1][0].remainingCap).toBe(400_000);
		expect(out.ok).toBe(false);
		expect(out.reason).toBe('intel_budget_exhausted');
		expect(out.failedAt).toBe('trending');
		expect(pay).toHaveBeenCalledTimes(2);
	});
	it('targets only the three paid signal endpoints', () => {
		const urls = signalPlan('https://x.test').map((s) => s.url);
		expect(urls).toEqual([
			'https://x.test/api/x402/pump-agent-audit?limit=10&sort=newest',
			'https://x.test/api/x402/crypto-intel',
			'https://x.test/api/x402/crypto-intel',
		]);
	});
});

function harness({ payResults, spent = 0, bought = new Set(), keypair = { keypair: {} } }) {
	const rows = [];
	const pay = vi.fn();
	for (const r of payResults) pay.mockResolvedValueOnce(r);
	return {
		rows, pay,
		deps: {
			pay,
			bootstrap: vi.fn().mockResolvedValue({ buyer: {}, conn: {}, blockhash: 'h', mintInfo: {} }),
			loadKeypair: vi.fn().mockResolvedValue(keypair),
			spentToday: vi.fn().mockResolvedValue(spent),
			alreadyBought: vi.fn().mockResolvedValue(bought),
			record: vi.fn(async (_s, row) => { rows.push(row); }),
			now: () => NOW,
		},
	};
}

describe('runPaidIntelCycle', () => {
	const winning = () => [
		{ ...settled(1), responseBody: launches(launch(1)) },
		{ ...settled(2), responseBody: { anomaly: true, mint: SYN(1), signal: 'bullish' } },
		{ ...settled(3), responseBody: { signal: 'bullish', trending_mints: [] } },
	];

	it('buys on agreement and every ledger row carries signatures for all three purchases', async () => {
		const h = harness({ payResults: winning() });
		const out = await runPaidIntelCycle({ strat, origin: 'https://x.test', deps: h.deps });
		expect(out.status).toBe('buy');
		expect(out.mint.entry_trigger).toBe('paid_intel');
		expect(out.mint.paidIntel.receipts.map((r) => r.tx_sig)).toEqual(['sig1', 'sig2', 'sig3']);
		expect(h.rows.length).toBeGreaterThan(0);
		for (const row of h.rows) expect(row.receipts.map((r) => r.tx_sig)).toEqual(['sig1', 'sig2', 'sig3']);
		const spend = h.rows.reduce((a, r) => a + (r.spend || 0), 0);
		expect(spend).toBe(30_000);
	});

	it('skips with the reason when a purchase fails and records the partial spend', async () => {
		const h = harness({ payResults: [
			{ ...settled(1), responseBody: launches(launch(1)) },
			{ paid: false, success: false, skipped: true, amountAtomic: 10_000, txSig: null, errorMsg: 'unexpected_asset:X' },
		] });
		const out = await runPaidIntelCycle({ strat, origin: 'https://x.test', deps: h.deps });
		expect(out.status).toBe('skipped');
		expect(out.reason).toBe('purchase_failed:anomaly:unexpected_asset:X');
		expect(h.rows).toHaveLength(1);
		expect(h.rows[0]).toMatchObject({ decision: 'skip', spend: 10_000 });
		expect(h.rows[0].receipts[0].tx_sig).toBe('sig1');
	});

	it('skips without paying when the arm has no budget or the daily cap is spent', async () => {
		const none = harness({ payResults: [] });
		expect((await runPaidIntelCycle({ strat: { ...strat, intel_daily_cap_atomic: null }, deps: none.deps })).reason).toBe('no_intel_budget');
		const spent = harness({ payResults: [], spent: 1_000_000 });
		expect((await runPaidIntelCycle({ strat, deps: spent.deps })).reason).toBe('intel_budget_exhausted');
		expect(none.pay).not.toHaveBeenCalled();
		expect(spent.pay).not.toHaveBeenCalled();
	});

	it('skips when the arm has no provisioned wallet', async () => {
		const h = harness({ payResults: [], keypair: null });
		expect((await runPaidIntelCycle({ strat, deps: h.deps })).reason).toBe('no_wallet');
		expect(h.pay).not.toHaveBeenCalled();
	});

	it('never re-enters a mint it already bought', async () => {
		const h = harness({ payResults: winning(), bought: new Set([SYN(1)]) });
		const out = await runPaidIntelCycle({ strat, origin: 'https://x.test', deps: h.deps });
		expect(out.status).toBe('no_entry');
	});
});

describe('isolation from the rules and llm modes', () => {
	it('only paid_intel arms are claimed by the new branch', () => {
		expect(isPaidIntel({ decision_mode: 'paid_intel' })).toBe(true);
		expect(isPaidIntel({ decision_mode: 'llm' })).toBe(false);
		expect(isPaidIntel({})).toBe(false);
	});

	it('paid-intel.js has no code path that fetches a signal endpoint unpaid', () => {
		const src = readFileSync(new URL('../workers/agent-sniper/paid-intel.js', import.meta.url), 'utf8');
		expect(src).not.toMatch(/\bfetch\s*\(/);
		expect(src).not.toMatch(/\baxios\b/);
	});

	it('the new-mint and intel loops skip paid_intel arms before any rules or llm logic', () => {
		const src = readFileSync(new URL('../workers/agent-sniper/index.js', import.meta.url), 'utf8');
		const guard = 'if (isPaidIntel(strat)) continue;';
		expect(src.split(guard).length - 1).toBe(2);
		expect(src.indexOf(guard)).toBeLessThan(src.indexOf("=== 'llm') {"));
	});

	it('the optimizer proposes no entry-rule tuning for a paid_intel arm', () => {
		const stats = { closed: 20, wins: 4, winRate: 20, avgPnlPct: -5, bestPnlPct: 40, worstPnlPct: -30, avgHoldSeconds: 600, netPnlLamports: -5_000_000, exitReasons: { stop_loss: 12, timeout: 8 } };
		const cfg = { decision_mode: 'paid_intel', per_trade_lamports: 50_000_000, daily_budget_lamports: 200_000_000, max_concurrent_positions: 1, trailing_stop_pct: 25, stop_loss_pct: 30, max_hold_seconds: 1800 };
		const out = proposeAdjustments(stats, cfg);
		for (const p of out.proposals) {
			expect(['min_oracle_score', 'min_quality_score', 'min_market_cap_usd', 'llm_min_confidence']).not.toContain(p.field);
		}
	});
});
