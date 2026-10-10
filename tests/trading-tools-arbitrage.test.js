// Arbitrage honesty (size cap, simulated worst case, verdict), the ecosystem
// anomaly rules, and the shared tool registry both the REST routes and the
// MCP server are built from. The arbitrage figures replay a live quote
// recorded in tests/fixtures/trading-tools/sol-usdc-arbitrage.json.

import { describe, it, expect } from 'vitest';

import recorded from './fixtures/trading-tools/sol-usdc-arbitrage.json' with { type: 'json' };
import {
	ARB_SIZE_CAP_USD,
	ARB_HARD_CAP_USD,
	ARB_LEG_SLIPPAGE_BPS,
	checkArbSize,
	worstCase,
	arbVerdict,
	slippageFloor,
	rankRoutes,
	twoLegFeeInQuote,
	LEG_FEE_LAMPORTS,
} from '../api/_lib/trading-tools/arbitrage.js';
import { hourlyAnomalies, coinAnomalies, zScore } from '../api/_lib/trading-tools/ecosystem.js';
import { TRADING_TOOLS, validateToolArgs } from '../api/_lib/trading-tools/registry.js';
import { queryArgs, tradingRoutes } from '../api/_lib/trading-tools/routes.js';
import { tradingToolDefs } from '../api/_mcpagent/trading-tools.js';
import { CATALOG } from '../api/v1/_catalog.js';
import { WSOL_MINT, USDC_MINT } from '../api/_lib/trading-tools/market.js';

const r = recorded.result;

describe('arbitrage size gate', () => {
	it('quotes inside the default cap', () => {
		expect(checkArbSize({ sizeUsd: 50 })).toMatchObject({ ok: true, size_usd: 50, above_default_cap: false, cap_usd: ARB_SIZE_CAP_USD });
	});

	it('refuses above the default cap unless the caller accepts the risk', () => {
		const refused = checkArbSize({ sizeUsd: ARB_SIZE_CAP_USD + 1 });
		expect(refused).toMatchObject({ ok: false, code: 'size_above_cap' });
		expect(refused.message).toMatch(/accept_size_risk: true/);
		expect(checkArbSize({ sizeUsd: ARB_SIZE_CAP_USD + 1, accept: true })).toMatchObject({ ok: true, above_default_cap: true });
	});

	it('refuses above the hard ceiling even with consent', () => {
		expect(checkArbSize({ sizeUsd: ARB_HARD_CAP_USD + 1, accept: true })).toMatchObject({ ok: false, code: 'size_above_hard_cap' });
	});

	it('refuses a size it cannot price', () => {
		expect(checkArbSize({ sizeUsd: null })).toMatchObject({ ok: false, code: 'size_unpriced' });
		expect(checkArbSize({ sizeUsd: Number.NaN })).toMatchObject({ ok: false, code: 'size_unpriced' });
	});

	it('kept the recorded live quote inside the cap', () => {
		expect(r.size).toMatchObject({ ok: true, size_usd: recorded.args.amount, above_default_cap: false });
	});
});

describe('simulated worst case on the recorded live quote', () => {
	const bps = r.worst_case.inputs.slippage_bps_per_leg;
	const floorBack = (x) => x / (1 - bps / 10_000);
	const scenario = (id) => r.worst_case.scenarios.find((s) => s.id === id);
	const inputs = {
		amount: recorded.args.amount,
		feeInQuote: r.expected.network_fees,
		expectedOut: r.expected.quote_out,
		slippedOut: floorBack(scenario('both_legs_slip').quote_out),
		closedOut: floorBack(scenario('spread_closes').quote_out),
		slippageBps: bps,
	};

	it('reproduces the recorded scenarios and maximum loss', () => {
		const w = worstCase(inputs);
		expect(w.scenarios.map((s) => s.id)).toEqual(['expected', 'both_legs_slip', 'spread_closes']);
		w.scenarios.forEach((s, i) => {
			expect(s.quote_out).toBeCloseTo(r.worst_case.scenarios[i].quote_out, 9);
			expect(s.net_profit).toBeCloseTo(r.worst_case.scenarios[i].net_profit, 9);
		});
		expect(w.max_loss).toBeCloseTo(r.worst_case.max_loss, 9);
		expect(w.max_loss_pct).toBeCloseTo(r.worst_case.max_loss_pct, 6);
		expect(w.fees_counted).toBe(true);
	});

	it('takes the lower of the two adverse scenarios', () => {
		const w = worstCase(inputs);
		expect(w.worst_quote_out).toBe(Math.min(...w.scenarios.slice(1).map((s) => s.quote_out)));
		expect(w.worst_net_profit).toBeLessThan(w.scenarios[0].net_profit);
	});

	it('still prices the slip scenario when no weaker venue quoted', () => {
		const w = worstCase({ ...inputs, closedOut: null });
		expect(w.scenarios.map((s) => s.id)).toEqual(['expected', 'both_legs_slip']);
	});

	it('says the recorded route is unprofitable and treats the legs as non-atomic', () => {
		expect(arbVerdict({ expectedNet: r.expected.net_profit, worst: r.worst_case }).verdict).toBe(r.verdict);
		expect(r.risk.atomic).toBe(false);
		expect(r.risk.factors.map((f) => f.id)).toEqual(['leg_gap', 'slippage', 'stranded_inventory', 'guards']);
		expect(r.legs.map((l) => l.swap_quote.slippage_bps)).toEqual([ARB_LEG_SLIPPAGE_BPS, ARB_LEG_SLIPPAGE_BPS]);
		expect(r.legs[0].swap_quote.dex).toBe(r.legs[0].venue);
	});
});

describe('arbitrage verdict', () => {
	const worst = (maxLoss) => ({ max_loss: maxLoss });
	it('calls a positive edge with a smaller worst case viable', () => {
		expect(arbVerdict({ expectedNet: 0.5, worst: worst(0.2) }).verdict).toBe('viable');
	});
	it('calls an edge the worst case can wipe out risk_exceeds_edge', () => {
		expect(arbVerdict({ expectedNet: 0.5, worst: worst(0.5) }).verdict).toBe('risk_exceeds_edge');
	});
	it('calls a non-positive edge unprofitable', () => {
		expect(arbVerdict({ expectedNet: 0, worst: worst(0) }).verdict).toBe('unprofitable');
		expect(arbVerdict({ expectedNet: null, worst: worst(0) }).verdict).toBe('unprofitable');
	});
});

describe('arbitrage helpers', () => {
	it('applies the slippage floor in base units', () => {
		expect(slippageFloor('45528323', 100)).toBe(45073039n);
		expect(slippageFloor(10_000n, 0)).toBe(10_000n);
	});

	it('prices both legs of network fees in the quote token', () => {
		expect(twoLegFeeInQuote(WSOL_MINT, null)).toBe((2 * LEG_FEE_LAMPORTS) / 1e9);
		expect(twoLegFeeInQuote(USDC_MINT, 100)).toBeCloseTo(((2 * LEG_FEE_LAMPORTS) / 1e9) * 100, 12);
		expect(twoLegFeeInQuote('THREEsynthetic1111111111111111111111111111', 100)).toBeNull();
	});

	it('ranks candidates by net profit', () => {
		const ranked = rankRoutes([{ sell: { out: 5.01 } }, { sell: { out: 5.03 } }, { sell: { out: 4.9 } }], 5, 0.02);
		expect(ranked.map((c) => c.sell.out)).toEqual([5.03, 5.01, 4.9]);
		expect(ranked[0].net).toBeCloseTo(0.01, 12);
	});
});

describe('ecosystem anomaly rules', () => {
	const asOf = '2026-10-10T06:00:00.000Z';
	const hours = (values) => values.map((v, i) => ({ hour: new Date(Date.UTC(2026, 9, 9, i)).toISOString(), launches: v }));
	const metrics = [{ id: 'launches_per_hour', label: 'Launches per hour', source: 'pump_coin_intel', value: (b) => b.launches }];

	it('flags a latest hour two deviations off its baseline and returns its inputs', () => {
		const out = hourlyAnomalies(hours([100, 104, 98, 101, 97, 103, 99, 100, 160]), metrics, asOf);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ kind: 'metric_spike', id: 'launches_per_hour_high', direction: 'above_normal', value: 160, as_of: asOf });
		expect(out[0].inputs).toMatchObject({ source: 'pump_coin_intel', baseline_hours: 8 });
		expect(out[0].inputs.hour).toBe(new Date(Date.UTC(2026, 9, 9, 8)).toISOString());
	});

	it('stays quiet inside normal variation and with too little history', () => {
		expect(hourlyAnomalies(hours([100, 104, 98, 101, 97, 103, 99, 100, 102]), metrics, asOf)).toEqual([]);
		expect(hourlyAnomalies(hours([1, 1, 1, 50]), metrics, asOf)).toEqual([]);
	});

	it('refuses a z-score on a flat baseline', () => {
		expect(zScore(5, [1, 1, 1, 1, 1, 1]).z).toBeNull();
	});

	it('ranks a dev dump into inflow above a smart-money cluster above a plain outlier', () => {
		const row = (mint, buySol, extra = {}) => ({ mint, symbol: null, name: null, first_seen_at: asOf, buy_volume_lamports: buySol * 1e9, sell_volume_lamports: 0, unique_buyers: 10, smart_money_count: 0, dev_sold: false, risk_flags: [], ...extra });
		const out = coinAnomalies({
			sample: 400,
			cut: 30e9,
			rows: [
				row('THREEsynthetic1111111111111111111111111111a', 40),
				row('THREEsynthetic1111111111111111111111111111b', 35, { dev_sold: true }),
				row('THREEsynthetic1111111111111111111111111111c', 5, { smart_money_count: 3 }),
				row('THREEsynthetic1111111111111111111111111111d', 10),
			],
		}, asOf, { window: '1h', minutes: 60 });
		expect(out.map((a) => a.kind)).toEqual(['dev_dump_into_inflow', 'smart_money_cluster', 'volume_outlier']);
		expect(out[0].inputs).toMatchObject({ source: 'pump_coin_intel', window: '1h', threshold_sol: 30, coins_in_window: 400 });
		for (const a of out) expect(a.as_of).toBe(asOf);
	});

	it('holds the outlier floor when the window cut is low, and skips outliers on a thin sample', () => {
		const rows = [{ mint: 'THREEsynthetic1111111111111111111111111111e', buy_volume_lamports: 20e9, smart_money_count: 0 }];
		expect(coinAnomalies({ sample: 400, cut: 1e9, rows }, asOf, {})).toEqual([]);
		expect(coinAnomalies({ sample: 10, cut: 1e9, rows: [{ ...rows[0], buy_volume_lamports: 900e9 }] }, asOf, {})).toEqual([]);
	});
});

describe('one registry behind REST and MCP', () => {
	const names = ['token_search', 'get_price', 'get_indicators', 'get_market_signals', 'get_news_feed', 'arbitrage_prices', 'arbitrage_quote', 'swap_quote', 'swap_simulate', 'swap_execute'];

	it('defines every brief tool exactly once', () => {
		expect(TRADING_TOOLS.map((t) => t.name).sort()).toEqual([...names].sort());
	});

	it('exposes each tool as a REST route and an MCP tool with the same schema', () => {
		for (const t of TRADING_TOOLS) {
			const route = tradingRoutes.find((x) => x.name === `v1.trading.${t.name}`);
			expect(route).toMatchObject({ method: t.method, path: `/trading${t.path}`, auth: t.auth });
			const mcp = tradingToolDefs.find((x) => x.name === t.name);
			expect(mcp.inputSchema).toBe(t.inputSchema);
			expect(mcp.group).toBe('trading');
		}
		expect(tradingRoutes[0]).toMatchObject({ method: 'GET', path: '/trading', auth: 'public' });
	});

	it('lists every trading route in the /api/v1 discovery catalog with the same method, path and auth', () => {
		for (const route of tradingRoutes) {
			const entry = CATALOG.find((e) => e.id === route.name);
			expect(entry, route.name).toMatchObject({ method: route.method, path: `/api/v1${route.path}`, auth: route.auth });
			const tool = TRADING_TOOLS.find((t) => `v1.trading.${t.name}` === route.name);
			if (tool) expect(Object.keys(entry.params).sort()).toEqual(Object.keys(tool.inputSchema.properties).sort());
		}
	});

	it('makes swap_execute the only financial tool and gates it on confirm_swap after swap_quote', () => {
		const financial = tradingToolDefs.filter((t) => t.tier === 'financial');
		expect(financial.map((t) => t.name)).toEqual(['swap_execute']);
		expect(financial[0]).toMatchObject({ confirmFlag: 'confirm_swap', previewTool: 'swap_quote' });
		expect(financial[0].annotations.destructiveHint).toBe(true);
		expect(tradingToolDefs.find((t) => t.name === 'swap_simulate').tier).not.toBe('financial');
	});

	it('validates, coerces and defaults arguments', () => {
		const args = { mint: 'SOL', indicators: 'rsi', period: '21' };
		expect(validateToolArgs('get_indicators', args)).toBeNull();
		expect(args).toEqual({ mint: 'SOL', indicators: ['rsi'], period: 21, interval: '1h' });
		expect(validateToolArgs('get_indicators', { mint: 'SOL', limit: 5 })).toMatchObject({ field: 'limit' });
		expect(validateToolArgs('swap_execute', {})).toMatchObject({ field: 'quote_id' });
		expect(validateToolArgs('swap_quote', { input_mint: 'SOL' })).toMatchObject({ field: 'output_mint' });
	});

	it('splits comma lists in a query string only for array arguments', () => {
		const schema = TRADING_TOOLS.find((t) => t.name === 'get_market_signals').inputSchema;
		expect(queryArgs({ sections: 'macro, movers', window: '1h', mint: '' }, schema)).toEqual({ sections: ['macro', 'movers'], window: '1h' });
	});
});
