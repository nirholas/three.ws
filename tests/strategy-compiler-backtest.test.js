/**
 * NL strategy compiler + historical backtester — pure logic tests.
 *
 * Money-adjacent: the compiler produces the leash on an autonomous trader and the
 * backtester is the honesty layer holders trust before risking funds, so the
 * invariants that keep them safe and faithful are pinned here:
 *   - a compiled strategy can NEVER emit an unsafe config (stop-loss mandatory,
 *     every knob clamped to the agent's runtime trade guards),
 *   - the backtest exit math matches the live decideExit priority exactly,
 *   - the cache hash is stable over the trade-determining fields only.
 *
 * These run without a model (the compiler degrades to its deterministic parser)
 * and without a DB (simulateTrade / strategyHash / decideExit are all pure).
 */

import { describe, it, expect, vi } from 'vitest';

// The header promises no model: pin that, so a developer or CI box with LLM
// credentials in its environment does not turn these into live, nondeterministic
// model calls whose wording differs from the deterministic parser's.
vi.mock('../api/_lib/llm.js', () => ({
	llmConfigured: () => false,
	llmComplete: vi.fn(async () => {
		throw new Error('llmComplete must not run in the deterministic compiler tests');
	}),
}));

import { compileStrategyFromText } from '../api/_lib/strategy-compiler.js';
import { simulateTrade, strategyHash } from '../api/_lib/strategy-backtest.js';
import { decideExit } from '../workers/agent-sniper/exit-logic.js';

const LAMPORTS_PER_SOL = 1_000_000_000;

describe('compileStrategyFromText — safety invariants', () => {
	it('compiles the canonical example into a valid, bounded strategy', async () => {
		const r = await compileStrategyFromText(
			"Snipe creators who've graduated at least two coins, market cap under $30k, organic distribution. Take profit at 3x, stop loss 40%, 30% trailing stop, max 0.3 SOL per trade.",
		);
		expect(r.ok).toBe(true);
		const s = r.strategy;
		// stop-loss is mandatory and must be > 0, always.
		expect(Number(s.stop_loss_pct)).toBeGreaterThan(0);
		// "3x" → +200% take profit.
		expect(s.take_profit_pct).toBe(200);
		expect(s.stop_loss_pct).toBe(40);
		expect(s.trailing_stop_pct).toBe(30);
		expect(Number(BigInt(s.per_trade_lamports))).toBe(0.3 * LAMPORTS_PER_SOL);
		// "graduated at least two" → min_creator_graduated 2.
		expect(s.min_creator_graduated).toBe(2);
		// "$30k" cap.
		expect(s.max_market_cap_usd).toBe(30000);
		// "organic" pulls in the intel read.
		expect(s.trigger).toBe('intel_confirmed');
		expect(s.max_bundle_score).toBeLessThanOrEqual(0.3);
	});

	it('defaults a mandatory stop-loss when the user omits one', async () => {
		const r = await compileStrategyFromText('snipe new launches, 0.1 sol each, take profit 2x');
		expect(r.ok).toBe(true);
		expect(Number(r.strategy.stop_loss_pct)).toBeGreaterThan(0);
		expect(r.assumptions.join(' ').toLowerCase()).toContain('stop-loss');
	});

	it('clamps money + risk knobs to the agent runtime trade guards', async () => {
		const tradeLimits = { per_trade_sol: 0.05, daily_budget_sol: 0.2, max_slippage_bps: 300, max_price_impact_pct: 8, max_concurrent: 2 };
		const r = await compileStrategyFromText(
			'snipe with 5 sol per trade, 50 sol a day, 30% slippage, 50% max impact, 20 concurrent, stop loss 30%',
			{ tradeLimits },
		);
		expect(r.ok).toBe(true);
		const s = r.strategy;
		expect(Number(BigInt(s.per_trade_lamports)) / LAMPORTS_PER_SOL).toBeLessThanOrEqual(0.05);
		expect(Number(BigInt(s.daily_budget_lamports)) / LAMPORTS_PER_SOL).toBeLessThanOrEqual(0.2);
		expect(s.slippage_bps).toBeLessThanOrEqual(300);
		expect(s.max_price_impact_pct).toBeLessThanOrEqual(8);
		expect(s.max_concurrent_positions).toBeLessThanOrEqual(2);
		expect(r.clamped.length).toBeGreaterThan(0);
	});

	it('rejects an empty description rather than emitting a config', async () => {
		const r = await compileStrategyFromText('  ');
		expect(r.ok).toBe(false);
		expect(r.error).toBe('empty');
	});

	it('keeps per-trade ≤ daily budget', async () => {
		const r = await compileStrategyFromText('1 sol per trade, stop loss 30%');
		expect(r.ok).toBe(true);
		const per = Number(BigInt(r.strategy.per_trade_lamports));
		const day = Number(BigInt(r.strategy.daily_budget_lamports));
		expect(per).toBeLessThanOrEqual(day);
	});
});

describe('simulateTrade — exits match live decideExit priority', () => {
	const base = { slippage_bps: 0, stop_loss_pct: 40, take_profit_pct: 200, trailing_stop_pct: 30 };

	it('takes profit when the peak crosses the TP threshold', () => {
		// peak 4x ≥ 1 + 200% = 3x → TP fires at exactly +200%.
		const r = simulateTrade(base, 4, 0.1, 0);
		expect(r.exitReason).toBe('take_profit');
		expect(r.roiPct).toBeCloseTo(200, 5);
	});

	it('stops out at the stop-loss level when terminal is below it', () => {
		// peak 1.5x (below 3x TP), terminal 0 (rugged) → stop-loss at −40%.
		const r = simulateTrade(base, 1.5, 0, 0);
		expect(r.exitReason).toBe('stop_loss');
		expect(r.roiPct).toBeCloseTo(-40, 5);
	});

	it('trails the stop from the peak when terminal sits between SL and the trail', () => {
		// peak 2x; trailing 30% off peak = 1.4x; SL 40% = 0.6x; terminal 1.3x is
		// below the trail (1.4x) but above the SL (0.6x) → trailing stop at 1.4x.
		const r = simulateTrade({ ...base, take_profit_pct: 500 }, 2, 1.3, 0);
		expect(r.exitReason).toBe('trailing_stop');
		expect(r.roiPct).toBeCloseTo(40, 5); // 2 * (1 - 0.3) - 1 = 0.4
	});

	it('holds to the terminal price (timeout) when no exit triggers', () => {
		// No TP/SL/trailing reached: peak 1.2x, terminal 1.1x.
		const r = simulateTrade({ stop_loss_pct: 90, take_profit_pct: 500, trailing_stop_pct: null, slippage_bps: 0 }, 1.2, 1.1, 0);
		expect(r.exitReason).toBe('timeout');
		expect(r.roiPct).toBeCloseTo(10, 5);
	});

	it('drags ROI down with slippage and price impact', () => {
		const clean = simulateTrade(base, 4, 0.1, 0);
		const costly = simulateTrade({ ...base, slippage_bps: 500 }, 4, 0.1, 20);
		expect(costly.roiPct).toBeLessThan(clean.roiPct);
	});

	it('agrees with decideExit on the take-profit boundary', () => {
		const pos = { entry_quote_lamports: '1000000000', stop_loss_pct: 40, take_profit_pct: 200, trailing_stop_pct: 30, max_hold_seconds: null };
		const ev = 1e9;
		// At exactly 3x the entry value, decideExit must call take_profit.
		expect(decideExit(pos, 3 * ev, 3 * ev)).toBe('take_profit');
		// Just below, it must not.
		expect(decideExit(pos, 2.99 * ev, 2.99 * ev)).not.toBe('take_profit');
	});
});

describe('strategyHash — stable over trade-determining fields only', () => {
	const s = {
		trigger: 'new_mint', per_trade_lamports: '300000000', slippage_bps: 500,
		max_price_impact_pct: 10, stop_loss_pct: 40, take_profit_pct: 200,
		allowed_categories: ['meme', 'ai'],
	};

	it('is deterministic for the same inputs', () => {
		expect(strategyHash(s, 30, 'mainnet')).toBe(strategyHash(s, 30, 'mainnet'));
	});

	it('ignores cosmetic fields not in the hash set', () => {
		const h1 = strategyHash(s, 30, 'mainnet');
		const h2 = strategyHash({ ...s, telegram_chat_id: '12345', enabled: true }, 30, 'mainnet');
		expect(h1).toBe(h2);
	});

	it('is insensitive to category order but sensitive to membership', () => {
		expect(strategyHash({ ...s, allowed_categories: ['ai', 'meme'] }, 30, 'mainnet')).toBe(strategyHash(s, 30, 'mainnet'));
		expect(strategyHash({ ...s, allowed_categories: ['meme'] }, 30, 'mainnet')).not.toBe(strategyHash(s, 30, 'mainnet'));
	});

	it('changes with the window and the network', () => {
		expect(strategyHash(s, 30, 'mainnet')).not.toBe(strategyHash(s, 90, 'mainnet'));
		expect(strategyHash(s, 30, 'mainnet')).not.toBe(strategyHash(s, 30, 'devnet'));
	});
});
