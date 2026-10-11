// Perps desk (api/_lib/perps): the pure parts every mode and interface leans on.
// Nothing here touches the network or a wallet: the venue contract is checked
// structurally, the paper engine's math is checked against the venue SDK's own
// closed form, and the guards are checked on synthetic quotes.

import { describe, it, expect } from 'vitest';
import { calculateLiquidationPriceUsd } from '@ellipsis-labs/rise';

const { VENUE_CONTRACT, venueContractProblems, getVenue, listVenues, DEFAULT_VENUE } = await import('../api/_lib/perps/index.js');
const {
	PERPS_LIMIT_DEFAULTS,
	PERPS_LIMIT_CEILINGS,
	normalizePerpsLimits,
	loosenedPerpsKeys,
	checkPerpsOrder,
	quoteMoved,
} = await import('../api/_lib/perps/limits.js');
const { paperLiquidationPrice, fundingOwed, limitCrossed, triggerHit, buildPaperAccount, applyFill, settleFunding } = await import(
	'../api/_lib/perps/paper.js'
);
const { evaluateAlerts, alertDedupeKey } = await import('../api/_lib/perps/alerts.js');
const phoenix = await import('../api/_lib/perps/phoenix.js');

const HOUR = 3_600_000;

function emptyState(collateral = 0) {
	return {
		positions: new Map(),
		orders: [],
		collateral_usd: collateral,
		realized_pnl_usd: 0,
		fees_paid_usd: 0,
		funding_paid_usd: 0,
		deposited_usd: collateral,
		withdrawn_usd: 0,
	};
}

function quote(over = {}) {
	return {
		risk_increasing: true,
		account_leverage_after: 1.5,
		market_max_leverage: 20,
		position_after: { notional_usd: 30 },
		free_collateral_after_usd: 10,
		slippage_bps: 50,
		...over,
	};
}

describe('venue contract', () => {
	it('every registered venue implements every member', () => {
		for (const v of listVenues()) expect(venueContractProblems(getVenue(v.id)), v.id).toEqual([]);
	});

	it('names the missing and mistyped members of a broken venue', () => {
		const broken = { ...phoenix, quoteOrder: undefined, label: 7 };
		const problems = venueContractProblems(broken);
		expect(problems).toContain('quoteOrder: expected function, got undefined');
		expect(problems).toContain('label: expected string, got number');
		expect(venueContractProblems(null)).toHaveLength(Object.keys(VENUE_CONTRACT).length);
	});

	it('has exactly one default venue, settles in USDC, and refuses an unknown venue with a 400', () => {
		const venues = listVenues();
		expect(venues.filter((v) => v.default).map((v) => v.id)).toEqual([DEFAULT_VENUE]);
		for (const v of venues) expect(v.collateral).toEqual({ asset: 'USDC', decimals: 6 });
		expect(() => getVenue('no-such-venue')).toThrow(expect.objectContaining({ status: 400, code: 'unknown_venue' }));
		expect(getVenue().id).toBe(DEFAULT_VENUE);
	});
});

describe('perps limits', () => {
	it('gives a fresh agent conservative defaults with live trading off', () => {
		const l = normalizePerpsLimits(undefined);
		expect(l).toMatchObject({ ...PERPS_LIMIT_DEFAULTS, updated_at: null });
		expect(l.live_enabled).toBe(false);
		expect(l.max_leverage).toBeLessThanOrEqual(2);
	});

	it('clamps to the hard ceilings and rejects garbage', () => {
		const l = normalizePerpsLimits({ max_leverage: 500, max_margin_per_position_usd: 'abc', max_slippage_bps: 0, live_enabled: 'yes' });
		expect(l.max_leverage).toBe(PERPS_LIMIT_CEILINGS.max_leverage);
		expect(l.max_margin_per_position_usd).toBe(PERPS_LIMIT_DEFAULTS.max_margin_per_position_usd);
		expect(l.max_slippage_bps).toBe(PERPS_LIMIT_DEFAULTS.max_slippage_bps);
		expect(l.live_enabled).toBe(false);
	});

	it('lets an alert be turned off with null and keeps the liquidation alert on by default', () => {
		expect(normalizePerpsLimits({}).alert_liquidation_distance_pct).toBe(15);
		expect(normalizePerpsLimits({ alert_liquidation_distance_pct: null }).alert_liquidation_distance_pct).toBeNull();
		expect(normalizePerpsLimits({ alert_loss_usd: 40 }).alert_loss_usd).toBe(40);
	});

	it('flags exactly the keys a patch loosens', () => {
		const prev = { ...PERPS_LIMIT_DEFAULTS, halted: true };
		expect(loosenedPerpsKeys(prev, { live_enabled: true })).toEqual(['live_enabled']);
		expect(loosenedPerpsKeys(prev, { halted: false })).toEqual(['halted']);
		expect(loosenedPerpsKeys(prev, { max_leverage: 5, max_quote_move_bps: 10 })).toEqual(['max_leverage']);
		expect(loosenedPerpsKeys(prev, { max_leverage: 1, max_margin_per_position_usd: 5, live_enabled: false })).toEqual([]);
		expect(loosenedPerpsKeys(prev, { alert_loss_usd: 5, alert_gain_usd: 100 })).toEqual([]);
		expect(loosenedPerpsKeys(prev, { max_leverage: 999 })).toEqual(['max_leverage']);
	});
});

describe('checkPerpsOrder', () => {
	const limits = normalizePerpsLimits({ max_leverage: 2, max_margin_per_position_usd: 25 });

	it('passes a paper order inside every cap', () => {
		const r = checkPerpsOrder({ limits, quote: quote(), mode: 'paper' });
		expect(r.blocked).toBeNull();
		expect(r.leverage_cap).toBe(2);
	});

	it('refuses live mode until the owner turns it on', () => {
		expect(checkPerpsOrder({ limits, quote: quote(), mode: 'live' }).blocked?.id).toBe('mode');
		const on = normalizePerpsLimits({ ...limits, live_enabled: true });
		expect(checkPerpsOrder({ limits: on, quote: quote(), mode: 'live' }).blocked).toBeNull();
	});

	it('enforces the leverage cap, capped further by the market maximum', () => {
		expect(checkPerpsOrder({ limits, quote: quote({ account_leverage_after: 2.01 }), mode: 'paper' }).blocked?.id).toBe('leverage');
		const loose = normalizePerpsLimits({ max_leverage: 10, max_margin_per_position_usd: 1000 });
		const r = checkPerpsOrder({ limits: loose, quote: quote({ account_leverage_after: 4, market_max_leverage: 3 }), mode: 'paper' });
		expect(r.leverage_cap).toBe(3);
		expect(r.blocked?.id).toBe('leverage');
	});

	it('enforces the per-position margin cap at the leverage cap', () => {
		// $60 notional at a 2x cap ties up $30 of margin, over the $25 cap.
		const r = checkPerpsOrder({ limits, quote: quote({ position_after: { notional_usd: 60 } }), mode: 'paper' });
		expect(r.blocked?.id).toBe('position_margin');
	});

	it('blocks new risk while halted, frozen or kill-switched, but lets risk-reducing orders through', () => {
		const halted = normalizePerpsLimits({ ...limits, halted: true });
		expect(checkPerpsOrder({ limits: halted, quote: quote(), mode: 'paper' }).blocked?.id).toBe('halted');
		expect(checkPerpsOrder({ limits, quote: quote(), tradeKill: true, mode: 'paper' }).blocked?.id).toBe('trade_kill_switch');
		expect(checkPerpsOrder({ limits, quote: quote(), walletFrozen: true, mode: 'paper' }).blocked?.id).toBe('wallet_frozen');
		const closing = quote({ risk_increasing: false, account_leverage_after: 50, position_after: { notional_usd: 0 } });
		expect(checkPerpsOrder({ limits: halted, quote: closing, tradeKill: true, walletFrozen: true, mode: 'paper' }).blocked).toBeNull();
	});

	it('refuses slippage past the owner ceiling and a position with no equity behind it', () => {
		expect(checkPerpsOrder({ limits, quote: quote({ slippage_bps: 101 }), mode: 'paper' }).blocked?.id).toBe('slippage');
		expect(checkPerpsOrder({ limits, quote: quote({ account_leverage_after: null }), mode: 'paper' }).blocked?.id).toBe('leverage');
		expect(checkPerpsOrder({ limits, quote: quote({ free_collateral_after_usd: -1 }), mode: 'paper' }).blocked?.id).toBe('free_collateral');
	});
});

describe('quoteMoved', () => {
	const base = { entry_price: 100, liquidation_price: 60, size: 0.5 };

	it('accepts a quote inside tolerance', () => {
		expect(quoteMoved(base, { entry_price: 100.4, liquidation_price: 60.2, size: 0.5 }, 50)).toBeNull();
	});

	it('refuses an entry move past tolerance with the measured bps', () => {
		const r = quoteMoved(base, { ...base, entry_price: 100.6 }, 50);
		expect(r).toMatchObject({ reason: 'quote_moved', detail: { field: 'entry_price', moved_bps: 60, tolerance_bps: 50 } });
	});

	it('refuses a liquidation move, a liquidation appearing, and any size change', () => {
		expect(quoteMoved(base, { ...base, liquidation_price: 61 }, 50)?.detail.field).toBe('liquidation_price');
		expect(quoteMoved({ ...base, liquidation_price: null }, base, 50)?.detail.field).toBe('liquidation_price');
		expect(quoteMoved(base, { ...base, size: 0.4 }, 50)?.detail.field).toBe('size');
	});
});

describe('paper engine math', () => {
	it('matches the venue SDK liquidation price for longs and shorts, alone and cross-margined', () => {
		const cases = [
			{ positionSize: 2, entryPriceUsd: 150, collateralUsd: 60, mmr: 0.05 },
			{ positionSize: -2, entryPriceUsd: 150, collateralUsd: 60, mmr: 0.05 },
			{ positionSize: 0.01, entryPriceUsd: 60_000, collateralUsd: 120, mmr: 0.025, otherPnl: -8, otherMm: 3 },
			{ positionSize: -40, entryPriceUsd: 1.2, collateralUsd: 15, mmr: 0.1, otherPnl: 4, otherMm: 1.5 },
		];
		for (const c of cases) {
			const ours = paperLiquidationPrice({
				signedSize: c.positionSize,
				entry: c.entryPriceUsd,
				collateralUsd: c.collateralUsd,
				mmr: c.mmr,
				otherPnlUsd: c.otherPnl || 0,
				otherMaintenanceUsd: c.otherMm || 0,
			});
			const sdk = calculateLiquidationPriceUsd({
				positionSize: c.positionSize,
				entryPriceUsd: c.entryPriceUsd,
				leverage: 1,
				maintenanceMarginBps: c.mmr * 10_000,
				collateralUsd: c.collateralUsd,
				otherAssetUnrealizedPnlUsd: c.otherPnl || 0,
				otherAssetMaintenanceMarginUsd: c.otherMm || 0,
			});
			expect(ours, JSON.stringify(c)).toBeCloseTo(sdk, 8);
		}
	});

	it('puts a long liquidation below entry and a short one above', () => {
		const long = paperLiquidationPrice({ signedSize: 1, entry: 100, collateralUsd: 50, mmr: 0.05 });
		const short = paperLiquidationPrice({ signedSize: -1, entry: 100, collateralUsd: 50, mmr: 0.05 });
		expect(long).toBeLessThan(100);
		expect(short).toBeGreaterThan(100);
		expect(paperLiquidationPrice({ signedSize: 1, entry: 100, collateralUsd: 500, mmr: 0.05 })).toBeNull();
		expect(paperLiquidationPrice({ signedSize: 0, entry: 100, collateralUsd: 50, mmr: 0.05 })).toBeNull();
	});

	it('charges longs and pays shorts on a positive funding rate', () => {
		const args = { mark: 100, hourlyPct: 0.01, fromMs: 0, toMs: 2 * HOUR };
		expect(fundingOwed({ ...args, signedSize: 3 })).toBeCloseTo(0.06, 10);
		expect(fundingOwed({ ...args, signedSize: -3 })).toBeCloseTo(-0.06, 10);
		expect(fundingOwed({ ...args, signedSize: 3, toMs: 0 })).toBe(0);
	});

	it('fills resting limits only once the live book crosses them and fires triggers in the right direction', () => {
		const book = { best_bid: 99, best_ask: 101 };
		expect(limitCrossed({ side: 'long', price: 100 }, book)).toBe(false);
		expect(limitCrossed({ side: 'long', price: 101 }, book)).toBe(true);
		expect(limitCrossed({ side: 'short', price: 99 }, book)).toBe(true);
		expect(limitCrossed({ side: 'short', price: 100 }, book)).toBe(false);
		expect(triggerHit({ direction: 'greater_than', trigger_price: 110 }, 110)).toBe(true);
		expect(triggerHit({ direction: 'greater_than', trigger_price: 110 }, 109)).toBe(false);
		expect(triggerHit({ direction: 'less_than', trigger_price: 90 }, 89.5)).toBe(true);
		expect(triggerHit({ direction: 'less_than', trigger_price: 90 }, null)).toBe(false);
	});

	it('opens, adds at a blended entry, partly closes with realized PnL, and flips', () => {
		let s = emptyState(100);
		({ state: s } = applyFill(s, { symbol: 'SOL', delta: 1, price: 100, feeUsd: 0.05, reason: 'order' }));
		({ state: s } = applyFill(s, { symbol: 'SOL', delta: 1, price: 110, feeUsd: 0.05, reason: 'order' }));
		expect(s.positions.get('SOL').entry_price).toBeCloseTo(105, 10);
		expect(s.collateral_usd).toBeCloseTo(99.9, 10);

		let fill;
		({ state: s, fill } = applyFill(s, { symbol: 'SOL', delta: -0.5, price: 115, feeUsd: 0.02, reason: 'take_profit' }));
		expect(fill.realized_pnl_usd).toBeCloseTo(5, 10);
		expect(s.positions.get('SOL').signed_size).toBeCloseTo(1.5, 10);
		expect(s.positions.get('SOL').entry_price).toBeCloseTo(105, 10);
		expect(s.collateral_usd).toBeCloseTo(99.9 + 5 - 0.02, 10);

		({ state: s, fill } = applyFill(s, { symbol: 'SOL', delta: -2.5, price: 100, feeUsd: 0, reason: 'order' }));
		expect(fill.realized_pnl_usd).toBeCloseTo(-7.5, 10);
		expect(s.positions.get('SOL')).toMatchObject({ signed_size: -1, entry_price: 100, funding_paid_usd: 0 });
		expect(s.realized_pnl_usd).toBeCloseTo(-2.5, 10);
		expect(s.fees_paid_usd).toBeCloseTo(0.12, 10);
	});

	it('closes to exactly flat', () => {
		let s = emptyState(50);
		({ state: s } = applyFill(s, { symbol: 'BTC', delta: -0.001, price: 60_000, feeUsd: 0, reason: 'order' }));
		({ state: s } = applyFill(s, { symbol: 'BTC', delta: 0.001, price: 59_000, feeUsd: 0, reason: 'order' }));
		expect(s.positions.get('BTC')).toMatchObject({ signed_size: 0, entry_price: 0 });
		expect(s.collateral_usd).toBeCloseTo(51, 10);
	});

	it('builds a venue-shaped account with leverage, liquidation, funding and attached triggers', () => {
		const now = 10 * HOUR;
		let s = emptyState(40);
		({ state: s } = applyFill(s, { symbol: 'SOL', delta: 1, price: 100, feeUsd: 0, reason: 'order' }));
		s.positions.set('SOL', { ...s.positions.get('SOL'), funding_at: now - HOUR });
		s.orders = [
			{ id: 7, symbol: 'SOL', type: 'stop_loss', side: 'short', trigger_price: 90, price: 87.3, direction: 'less_than', status: 'open' },
			{ id: 8, symbol: 'SOL', type: 'limit', side: 'long', size: 0.5, price: 95, reduce_only: false, status: 'open' },
		];
		const markets = new Map([['SOL', { mark_price: 110, funding_rate_hourly_pct: 0.01, initial_margin_rate: 0.1, maintenance_margin_rate: 0.05 }]]);
		const a = buildPaperAccount(s, markets, now);

		expect(a.unrealized_pnl_usd).toBeCloseTo(10, 6);
		expect(a.funding_owed_usd).toBeCloseTo(0.011, 6);
		expect(a.collateral_usd).toBeCloseTo(40 - 0.011, 6);
		expect(a.equity_usd).toBeCloseTo(50 - 0.011, 6);
		expect(a.notional_usd).toBe(110);
		expect(a.account_leverage).toBeCloseTo(110 / (50 - 0.011), 3);
		expect(a.risk_state).toBe('healthy');
		// Withdrawable holds back initial margin: equity minus 10% of $110 notional.
		expect(a.withdrawable_usd).toBeCloseTo(50 - 0.011 - 11, 6);

		const p = a.positions[0];
		expect(p).toMatchObject({ symbol: 'SOL', side: 'long', stop_loss_price: 90, take_profit_price: null });
		const sdkLiq = calculateLiquidationPriceUsd({ positionSize: 1, entryPriceUsd: 100, leverage: 1, maintenanceMarginBps: 500, collateralUsd: 40 - 0.011 });
		expect(p.liquidation_price).toBeCloseTo(sdkLiq, 4);
		expect(p.liquidation_distance_pct).toBeCloseTo(((110 - sdkLiq) / 110) * 100, 1);
		expect(a.orders).toEqual([expect.objectContaining({ id: '8', type: 'limit', price: 95 })]);
		expect(a.conditionals).toEqual([expect.objectContaining({ id: '7', kind: 'stop_loss', trigger_price: 90, cancellable: true })]);
	});

	it('marks an account under maintenance margin liquidatable', () => {
		let s = emptyState(5);
		({ state: s } = applyFill(s, { symbol: 'SOL', delta: 1, price: 100, feeUsd: 0, reason: 'order' }));
		const markets = new Map([['SOL', { mark_price: 96, funding_rate_hourly_pct: 0, initial_margin_rate: 0.1, maintenance_margin_rate: 0.05 }]]);
		expect(buildPaperAccount(s, markets, Date.now()).risk_state).toBe('liquidatable');
	});

	it('settles accrued funding into collateral and restarts the clock', () => {
		let s = emptyState(100);
		({ state: s } = applyFill(s, { symbol: 'SOL', delta: -2, price: 100, feeUsd: 0, reason: 'order' }));
		s.positions.set('SOL', { ...s.positions.get('SOL'), funding_at: 0 });
		const markets = new Map([['SOL', { mark_price: 100, funding_rate_hourly_pct: 0.02 }]]);
		const settled = settleFunding(s, markets, 3 * HOUR);
		expect(settled.collateral_usd).toBeCloseTo(100 + 0.12, 10);
		expect(settled.funding_paid_usd).toBeCloseTo(-0.12, 10);
		expect(settled.positions.get('SOL').funding_at).toBe(3 * HOUR);
	});
});

describe('venue pure helpers', () => {
	it('normalizes a raw book and walks it for a fill', () => {
		const book = phoenix.normalizeBook({ bids: [['99', '2'], ['98', '0'], ['97', '5']], asks: [['101', '1'], ['102', '3']] });
		expect(book).toMatchObject({ best_bid: 99, best_ask: 101, mid: 100, spread_bps: 200 });
		expect(book.bids).toHaveLength(2);
		const fill = phoenix.estimateFill(book.asks, 2);
		expect(fill).toMatchObject({ filled: 2, complete: true, avg_price: 101.5, worst_price: 102 });
		expect(phoenix.estimateFill(book.asks, 10)).toMatchObject({ filled: 4, complete: false });
	});

	it('projects adds, reductions and flips the same way the paper ledger books them', () => {
		expect(phoenix.projectPosition({ size: 1, entry: 100, delta: 1, price: 110 })).toEqual({ size: 2, entry: 105, realized_pnl: 0 });
		expect(phoenix.projectPosition({ size: 2, entry: 105, delta: -2, price: 100 })).toEqual({ size: 0, entry: 0, realized_pnl: -10 });
		expect(phoenix.projectPosition({ size: -1, entry: 100, delta: 3, price: 90 })).toEqual({ size: 2, entry: 90, realized_pnl: 10 });
	});

	it('rounds sizes down to lots and prices to ticks in the protective direction', () => {
		expect(phoenix.sizeToLots(1.23456, { baseLotsDecimals: 3 })).toEqual({ lots: 1234, size: 1.234, text: '1.234' });
		expect(phoenix.priceToTick(100.037, { tickUsd: 0.01 }, 'up')).toBe(100.04);
		expect(phoenix.priceToTick(100.037, { tickUsd: 0.01 }, 'down')).toBe(100.03);
		expect(phoenix.priceToTick(100.037, { tickUsd: 0.01 })).toBe(100.04);
	});
});

describe('perps alerts', () => {
	const limits = normalizePerpsLimits({ alert_liquidation_distance_pct: 10, alert_loss_usd: 20, alert_gain_usd: 50, alert_funding_usd: 1 });
	const pos = (over = {}) => ({ symbol: 'SOL', side: 'long', liquidation_price: 80, liquidation_distance_pct: 30, funding_accrued_usd: 0, ...over });

	it('stays quiet on a healthy account and with no limits', () => {
		const account = { risk_state: 'healthy', unrealized_pnl_usd: 5, positions: [pos()] };
		expect(evaluateAlerts(account, limits)).toEqual([]);
		expect(evaluateAlerts(account, null)).toEqual([]);
	});

	it('grades liquidation distance as a warning, then critical at half the threshold', () => {
		const warn = evaluateAlerts({ positions: [pos({ liquidation_distance_pct: 8 })] }, limits);
		expect(warn).toEqual([expect.objectContaining({ kind: 'liquidation_distance', severity: 'warning', symbol: 'SOL', threshold: 10 })]);
		const crit = evaluateAlerts({ positions: [pos({ liquidation_distance_pct: 4 })] }, limits);
		expect(crit[0].severity).toBe('critical');
	});

	it('fires loss, gain, funding and liquidatable alerts at the owner thresholds', () => {
		const kinds = (a) => evaluateAlerts(a, limits).map((x) => x.kind).sort();
		expect(kinds({ unrealized_pnl_usd: -20, positions: [pos()] })).toEqual(['loss']);
		expect(kinds({ unrealized_pnl_usd: 50, positions: [pos()] })).toEqual(['gain']);
		expect(kinds({ unrealized_pnl_usd: 0, positions: [pos({ funding_accrued_usd: 1.2 })] })).toEqual(['funding']);
		expect(kinds({ risk_state: 'liquidatable', equity_usd: 1, maintenance_margin_usd: 2, positions: [pos()] })).toEqual(['liquidatable']);
		expect(kinds({ unrealized_pnl_usd: -100, positions: [] })).toEqual([]);
	});

	it('writes alert copy without banned dashes', () => {
		const all = evaluateAlerts(
			{ risk_state: 'liquidatable', equity_usd: 1, maintenance_margin_usd: 2, unrealized_pnl_usd: -30, positions: [pos({ liquidation_distance_pct: 2, funding_accrued_usd: 3 })] },
			limits,
		);
		expect(all.length).toBe(4);
		for (const a of all) expect(a.message).not.toMatch(new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`));
	});

	it('dedupes one alert per agent, mode, kind and symbol per hour', () => {
		const alert = { kind: 'loss', symbol: null };
		const a = alertDedupeKey({ agentId: 'A', mode: 'paper', alert, nowMs: 5 * HOUR + 10 });
		expect(a).toBe('A:paper:loss:*:5');
		expect(alertDedupeKey({ agentId: 'A', mode: 'paper', alert, nowMs: 6 * HOUR - 1 })).toBe(a);
		expect(alertDedupeKey({ agentId: 'A', mode: 'paper', alert, nowMs: 6 * HOUR })).not.toBe(a);
		expect(alertDedupeKey({ agentId: 'A', mode: 'live', alert, nowMs: 5 * HOUR })).not.toBe(a);
	});
});
