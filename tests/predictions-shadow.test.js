import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { rows: [], agentMeta: {} };
const sqlSpy = vi.fn();
vi.mock('../api/_lib/db.js', () => {
	const sql = (strings, ...vals) => {
		const text = strings.join('?');
		sqlSpy(text, vals);
		if (/INSERT INTO prediction_shadow_ledger/.test(text)) {
			const row = { id: 'row-1', mode: vals[3], market_id: vals[4], side: vals[8], contracts: vals[10], price_at_decision: vals[11], entry_price: vals[12], fees_usd: vals[13], cost_usd: vals[14], status: 'open' };
			state.rows.push(row);
			return Promise.resolve([row]);
		}
		return Promise.resolve([]);
	};
	return { sql };
});
vi.mock('../api/_lib/audit.js', () => ({ logAudit: vi.fn() }));

const previewOpen = vi.fn(async () => ({ preview_id: 'p1' }));
const executeOpen = vi.fn();
vi.mock('../api/_lib/predictions/engine.js', () => ({
	MIN_STAKE_USD: 1,
	MAX_STAKE_USD: 100000,
	PredictionError: class PredictionError extends Error {
		constructor(code, message, status = 400, detail = null) {
			super(message);
			this.code = code;
			this.status = status;
			this.detail = detail;
		}
	},
	loadOwnedAgent: vi.fn(async (id) => ({ id, user_id: 'u1', meta: state.agentMeta })),
	previewOpen: (...a) => previewOpen(...a),
	executeOpen: (...a) => executeOpen(...a),
}));

const buildOpenOrder = vi.fn();
const buildCloseOrder = vi.fn();
const buildRedeem = vi.fn();
const submit = vi.fn();
const market = {
	id: 'SYN-1',
	event_id: 'SYN-E1',
	title: 'Synthetic market',
	provider: 'provider-a',
	status: 'open',
	tradable: true,
	close_time: '2027-01-01T00:00:00.000Z',
	outcomes: [
		{ side: 'yes', buy_price: 0.4, sell_price: 0.39 },
		{ side: 'no', buy_price: 0.61, sell_price: 0.6 },
	],
};
const fakeVenue = {
	id: 'solana',
	getMarket: vi.fn(async () => market),
	getOrderbook: vi.fn(async () => ({ yes_bids: [[0.39, 500]], no_bids: [[0.6, 500]] })),
	buildOpenOrder,
	buildCloseOrder,
	buildRedeem,
	submit,
};
vi.mock('../api/_lib/predictions/index.js', () => ({ DEFAULT_VENUE: 'solana', getVenue: () => fakeVenue, listVenues: () => [], VenueError: class VenueError extends Error {} }));

const { feePerContract, totalFee, walkComplement, topOfBookEdge, scoreMarket, rankRows, DEFAULT_MODELS } = await import('../api/_lib/predictions/arb.js');
const { getStrategy, strategyLoosens, setStrategy, priceIntent, markEntry, summarize, submitIntent } = await import('../api/_lib/predictions/shadow.js');

const FLAT = { venue: { kind: 'bps_of_notional', bps: 0 }, providers: {}, default_provider: { kind: 'bps_of_notional', bps: 0 }, thresholds: DEFAULT_MODELS.thresholds, strategy_defaults: DEFAULT_MODELS.strategy_defaults };

beforeEach(() => {
	state.rows = [];
	state.agentMeta = {};
	for (const f of [sqlSpy, previewOpen, executeOpen, buildOpenOrder, buildCloseOrder, buildRedeem, submit]) f.mockClear();
});

describe('fee models', () => {
	it.each([
		[{ kind: 'bps_of_notional', bps: 100 }, 0.5, 0.005],
		[{ kind: 'bps_of_notional', bps: 0 }, 0.5, 0],
		[{ kind: 'p_one_minus_p', rate: 0.07 }, 0.5, 0.0175],
		[{ kind: 'p_one_minus_p', rate: 0.07 }, 0.1, 0.0063],
		[{ kind: 'flat_per_contract', usd: 0.01 }, 0.9, 0.01],
	])('%j at %d costs %d a contract', (model, price, fee) => {
		expect(feePerContract(model, price)).toBeCloseTo(fee, 10);
	});

	it('stacks the venue fee on the provider fee', () => {
		const m = { ...FLAT, venue: { kind: 'bps_of_notional', bps: 100 }, providers: { 'provider-b': { kind: 'p_one_minus_p', rate: 0.07 } } };
		expect(totalFee(m, 'provider-b', 0.5)).toBeCloseTo(0.005 + 0.0175, 10);
		expect(totalFee(m, 'unknown', 0.5)).toBeCloseTo(0.005 + 0, 10);
	});
});

describe('fee-adjusted edge', () => {
	const cases = [
		// name, yes ask, no ask, models, expected net edge per contract
		['efficient market, no fees', 0.4, 0.6, FLAT, 0],
		['two cents under par, no fees', 0.4, 0.58, FLAT, 0.02],
		['two cents under par, 1% venue fee eats part', 0.4, 0.58, { ...FLAT, venue: { kind: 'bps_of_notional', bps: 100 } }, 0.02 - 0.01 * (0.4 + 0.58)],
		['two cents under par, provider-b schedule at 50/50', 0.5, 0.48, { ...FLAT, providers: { 'provider-b': { kind: 'p_one_minus_p', rate: 0.07 } } }, 0.02 - 0.0175 - 0.07 * 0.48 * 0.52],
		['over par is negative', 0.55, 0.5, FLAT, -0.05],
	];
	it.each(cases)('%s', (_n, y, n, models, expected) => {
		const provider = Object.keys(models.providers)[0] || null;
		const top = topOfBookEdge({ yes_bids: [[1 - n, 100]], no_bids: [[1 - y, 100]] }, { models, provider });
		expect(top.net_edge).toBeCloseTo(expected, 5);
	});

	it('walks levels while the marginal pair still clears the floor', () => {
		const yes = [[0.4, 100], [0.45, 100]];
		const no = [[0.58, 150], [0.6, 100]];
		const r = walkComplement(yes, no, { models: FLAT, minEdge: 0.005 });
		// pair 1: 0.4+0.58 = 0.98 edge .02 for 100 contracts; pair 2: 0.45+0.58 = 1.03 stops.
		expect(r.contracts).toBe(100);
		expect(r.cost_usd).toBe(98);
		expect(r.profit_usd).toBe(2);
		expect(r.edge_pct).toBeCloseTo((2 / 98) * 100, 3);
	});

	it('takes nothing when fees consume the gross edge', () => {
		const r = walkComplement([[0.4, 100]], [[0.58, 100]], { models: { ...FLAT, venue: { kind: 'bps_of_notional', bps: 300 } }, minEdge: 0.005 });
		expect(r.contracts).toBe(0);
		expect(r.profit_usd).toBe(0);
	});

	it('marks a market executable only past the depth and edge floors, and ranks it first', () => {
		const m = { id: 'SYN-A', title: 'a', provider: 'provider-a' };
		const thick = { yes_bids: [[0.42, 500]], no_bids: [[0.6, 500]] }; // asks 0.40 / 0.58
		const thin = { yes_bids: [[0.42, 1]], no_bids: [[0.6, 1]] };
		const flat = { yes_bids: [[0.4, 500]], no_bids: [[0.6, 500]] }; // asks 0.40 / 0.60
		const a = scoreMarket({ ...m, id: 'thick' }, thick, { models: FLAT });
		const b = scoreMarket({ ...m, id: 'thin' }, thin, { models: FLAT });
		const c = scoreMarket({ ...m, id: 'flat' }, flat, { models: FLAT });
		expect(a.executable).toBe(true);
		expect(b.executable).toBe(false);
		expect(c.executable).toBe(false);
		expect(rankRows([c, b, a]).map((r) => r.market_id)).toEqual(['thick', 'thin', 'flat']);
	});
});

describe('strategy setting', () => {
	it('defaults to shadow', () => {
		expect(getStrategy({}).mode).toBe('shadow');
		expect(getStrategy(null).mode).toBe('shadow');
		expect(getStrategy({ prediction_strategy: { mode: 'anything-else' } }).mode).toBe('shadow');
		expect(getStrategy({ prediction_strategy: { mode: 'live' } }).mode).toBe('live');
	});

	it('treats live and looser caps as loosening', () => {
		const base = getStrategy({});
		expect(strategyLoosens(base, { ...base, mode: 'live' })).toBe(true);
		expect(strategyLoosens(base, { ...base, max_stake_usd: base.max_stake_usd + 1 })).toBe(true);
		expect(strategyLoosens(base, { ...base, min_edge_pct: 0 })).toBe(true);
		expect(strategyLoosens(base, { ...base, max_stake_usd: 1 })).toBe(false);
	});

	it('refuses to go live without the owner session and writes nothing', async () => {
		await expect(setStrategy({ agentId: 'a1', userId: 'u1', patch: { mode: 'live' }, ownerSession: false })).rejects.toMatchObject({ code: 'owner_session_required' });
		expect(sqlSpy).not.toHaveBeenCalled();
		await setStrategy({ agentId: 'a1', userId: 'u1', patch: { mode: 'live' }, ownerSession: true });
		expect(sqlSpy).toHaveBeenCalledTimes(1);
	});
});

describe('shadow mode never trades', () => {
	it('records the decision and calls no order function', async () => {
		const out = await submitIntent({ agentId: 'a1', userId: 'u1', intent: { market_id: 'SYN-1', side: 'yes', stake_usd: 10, reason: 'test' } });
		expect(out.mode).toBe('shadow');
		expect(out.recorded.mode).toBe('shadow');
		expect(state.rows).toHaveLength(1);
		expect(previewOpen).not.toHaveBeenCalled();
		expect(executeOpen).not.toHaveBeenCalled();
		expect(buildOpenOrder).not.toHaveBeenCalled();
		expect(buildCloseOrder).not.toHaveBeenCalled();
		expect(buildRedeem).not.toHaveBeenCalled();
		expect(submit).not.toHaveBeenCalled();
	});

	it('treats a corrupt strategy as shadow', async () => {
		state.agentMeta = { prediction_strategy: { mode: 'LIVE ' } };
		const out = await submitIntent({ agentId: 'a1', userId: 'u1', intent: { market_id: 'SYN-1', side: 'no', stake_usd: 5 } });
		expect(out.mode).toBe('shadow');
		expect(previewOpen).not.toHaveBeenCalled();
		expect(buildOpenOrder).not.toHaveBeenCalled();
	});

	it('in live mode previews through the engine but still never executes or builds', async () => {
		state.agentMeta = { prediction_strategy: { mode: 'live' } };
		const out = await submitIntent({ agentId: 'a1', userId: 'u1', intent: { market_id: 'SYN-1', side: 'yes', stake_usd: 10 } });
		expect(out.mode).toBe('live');
		expect(previewOpen).toHaveBeenCalledTimes(1);
		expect(executeOpen).not.toHaveBeenCalled();
		expect(buildOpenOrder).not.toHaveBeenCalled();
		expect(submit).not.toHaveBeenCalled();
	});

	it('refuses a stake over the strategy cap before touching the ledger', async () => {
		await expect(submitIntent({ agentId: 'a1', userId: 'u1', intent: { market_id: 'SYN-1', side: 'yes', stake_usd: 5000 } })).rejects.toMatchObject({ code: 'invalid_stake' });
		expect(state.rows).toHaveLength(0);
	});
});

describe('pricing and marking', () => {
	const book = { yes_bids: [[0.39, 500]], no_bids: [[0.6, 500]] };

	it('prices the decision at the best ask and the entry at the walked average', () => {
		const p = priceIntent({ book, side: 'yes', stakeUsd: 10, provider: 'provider-a', models: FLAT });
		expect(p.price_at_decision).toBe(0.4);
		expect(p.entry_price).toBe(0.4);
		expect(p.contracts).toBe(25);
		expect(p.fees_usd).toBe(0);
	});

	it('returns null when the side has no asks', () => {
		expect(priceIntent({ book: { yes_bids: [], no_bids: [] }, side: 'yes', stakeUsd: 10, provider: null })).toBeNull();
	});

	const entry = { side: 'yes', contracts: 25, cost_usd: 10, fees_usd: 0.1, entry_price: 0.4 };
	it('settles a win at one dollar a contract, net of cost and fees', () => {
		expect(markEntry(entry, { result: 'yes' })).toMatchObject({ status: 'won', payout_usd: 25, pnl_usd: 14.9, resolved: true });
	});
	it('settles a loss as the whole stake plus fees', () => {
		expect(markEntry(entry, { result: 'no' })).toMatchObject({ status: 'lost', payout_usd: 0, pnl_usd: -10.1, resolved: true });
	});
	it('returns the cost on a refund', () => {
		expect(markEntry(entry, { result: 'refund' })).toMatchObject({ status: 'void', payout_usd: 10, pnl_usd: -0.1, resolved: true });
	});
	it('values an open entry at the bid, less the exit fee', () => {
		const m = { provider: 'provider-a', outcomes: [{ side: 'yes', sell_price: 0.5 }, { side: 'no', sell_price: 0.5 }] };
		const r = markEntry(entry, m, FLAT);
		expect(r).toMatchObject({ status: 'open', mark_price: 0.5, resolved: false });
		expect(r.pnl_usd).toBeCloseTo(25 * 0.5 - 10.1, 4);
	});

	it('summarizes shadow and live separately and exposes the cost of fees and slippage', () => {
		const rows = [
			{ mode: 'shadow', status: 'won', contracts: 25, cost_usd: 10, fees_usd: 0.1, price_at_decision: 0.39, entry_price: 0.4, mark_price: 1, pnl_usd: 14.9 },
			{ mode: 'shadow', status: 'lost', contracts: 10, cost_usd: 5, fees_usd: 0.05, price_at_decision: 0.5, entry_price: 0.5, mark_price: 0, pnl_usd: -5.05 },
			{ mode: 'live', status: 'open', contracts: 10, cost_usd: 4, fees_usd: 0.04, price_at_decision: 0.4, entry_price: 0.4, mark_price: 0.45, pnl_usd: 0.4 },
		];
		const s = summarize(rows);
		expect(s.shadow).toMatchObject({ entries: 2, settled: 2, won: 1, lost: 1, win_rate: 0.5, realized_pnl_usd: 9.85, total_pnl_usd: 9.85 });
		expect(s.shadow.gross_pnl_usd).toBeCloseTo(25 - 25 * 0.39 - 10 * 0.5, 1);
		expect(s.shadow.costs_usd).toBeCloseTo(0.1 + 0.05 + 25 * 0.01, 2);
		expect(s.live).toMatchObject({ entries: 1, open: 1, unrealized_pnl_usd: 0.4, win_rate: null });
	});
});
