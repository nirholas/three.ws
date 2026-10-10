// Core-path smoke tests for the programmable-orders worker (workers/agent-orders).
//
// tests/orders-engine.test.js already covers the pure rule layer (api/_lib/orders.js:
// validation, condition evaluation, price predicates). This suite covers the half
// that actually moves money: runOrderSweep + store.js, i.e. the decision-to-fire
// wiring. It asserts the properties the engine is trusted for:
//
//   * a matched trigger fires ONCE, through executeAgentTrade, with the custody
//     idempotency key `order:<id>:slice:<n>` and simulate=true off ORDERS_MODE
//   * a missing live quote holds the order (never fires on absent data)
//   * a terminal block (firewall rug verdict) halts the order to 'error';
//     a clearable block (daily budget) returns it to active for the next sweep
//   * a DCA slice advances the schedule and re-arms next_fire_at, only going
//     terminal on the last slice
//   * two due orders on one agent are serialized (one wallet, one budget)
//
// Only the two edges are stubbed: the chain/market reads (market.js) and the
// trade executor itself. The real store.js SQL, the real parseTradeInput, and the
// real trigger predicates run, so the queries and the trade body are the ones
// production issues.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── db: record every query the real store.js issues, answer from a router ─────
const dbState = { calls: [], activeOrders: [], agent: null, claimOk: true, group: [], cancelled: [] };

function classify(q) {
	if (q.includes('INSERT INTO agent_order_events')) return 'event';
	if (q.includes('SET route =')) return 'set_route';
	if (q.includes('SET last_skip_code = NULL')) return 'clear_skip';
	if (q.includes('SET last_skip_code =')) return 'note_skip';
	if (q.includes('FROM orders WHERE group_id')) return 'group_orders';
	if (q.includes('WHERE group_id =') && q.includes("SET status = 'cancelled'")) return 'cancel_siblings';
	if (q.includes('SET schedule =') && q.includes('cancel_reason')) return 'consume_slice';
	if (q.includes('SELECT * FROM orders')) return 'active_orders';
	if (q.includes("SET status = 'expired'")) return 'expire';
	if (q.includes('SET status = CASE WHEN fill_count')) return 'recover_stale';
	if (q.includes("SET status = 'firing'")) return 'claim';
	if (q.includes('SET last_eval_at = now()')) return 'mark_evaluated';
	if (q.includes('SET reference_price =')) return 'seed_reference';
	if (q.includes('INSERT INTO order_fills')) return 'insert_fill';
	if (q.includes('filled_sol = filled_sol +')) return 'advance';
	if (q.includes('FROM agent_identities')) return 'load_agent';
	if (q.includes('UPDATE orders SET status')) return 'set_status';
	if (q.includes('bot_heartbeat')) return 'heartbeat';
	return 'other';
}

vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...values) => {
		const query = strings.join('?');
		const kind = classify(query);
		dbState.calls.push({ kind, values });
		if (kind === 'active_orders') return dbState.activeOrders;
		if (kind === 'claim') return dbState.claimOk ? [{ id: values[0] }] : [];
		if (kind === 'load_agent') return dbState.agent ? [dbState.agent] : [];
		if (kind === 'group_orders') return dbState.group;
		if (kind === 'cancel_siblings') return dbState.cancelled;
		return [];
	}),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
	sqlValues: (rows) => rows,
	isStoragePressured: async () => false,
}));

// ── market: the only chain reads the sweep makes ─────────────────────────────
const marketState = { market: null, signals: {}, holding: null };
vi.mock('../workers/agent-orders/market.js', async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		getSignals: vi.fn(async () => ({ market: marketState.market, signals: marketState.signals })),
		getHolding: vi.fn(async () => marketState.holding),
	};
});

// ── the executor: real parseTradeInput, stubbed execution ────────────────────
const tradeState = { result: null, calls: [], inflight: 0, maxInflight: 0, delayMs: 0 };
vi.mock('../api/agents/agent-trade.js', async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		executeAgentTrade: vi.fn(async (args) => {
			tradeState.calls.push(args);
			tradeState.inflight++;
			tradeState.maxInflight = Math.max(tradeState.maxInflight, tradeState.inflight);
			if (tradeState.delayMs) await new Promise((r) => setTimeout(r, tradeState.delayMs));
			tradeState.inflight--;
			return tradeState.result;
		}),
	};
});

// ── the aggregator executor: real parseTradeRequest, stubbed execution ──────
const aggState = { result: null, calls: [] };
vi.mock('../api/agents/solana-trade.js', async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		runAgentTrade: vi.fn(async (args) => { aggState.calls.push(args); return aggState.result; }),
	};
});

const notifications = [];
vi.mock('../api/_lib/notify.js', () => ({
	insertNotification: vi.fn((userId, type, payload) => { notifications.push({ userId, type, payload }); }),
}));

vi.mock('../workers/agent-orders/log.js', () => ({
	log: { info: () => {}, warn: () => {}, error: () => {}, trade: () => {} },
}));

const { runOrderSweep, resetVenueHealth } = await import('../workers/agent-orders/sweep.js');
const { loadConfig } = await import('../workers/agent-orders/config.js');

// ── fixtures ─────────────────────────────────────────────────────────────────
const AGENT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump'; // $THREE
const AGENT_ADDRESS = 'THREEsyntheticAgentWallet11111111111111111111'; // never validated: getHolding is stubbed

const cfg = { network: 'mainnet', mode: 'simulate', concurrency: 4, staleFiringMs: 180_000 };

function order(over = {}) {
	return {
		id: '33333333-3333-4333-8333-333333333333',
		agent_id: AGENT_ID, user_id: USER_ID, network: 'mainnet', mint: MINT,
		type: 'limit', side: 'buy', size_sol: 0.25, size_tokens: null, sell_pct: null,
		trigger_metric: 'mcap_usd', limit_price: 40_000, stop_price: null, trail_pct: null,
		peak_price: null, reference_price: 50_000, schedule: null, next_fire_at: null,
		condition: null, slippage_bps: 500, expires_at: null, status: 'active',
		filled_sol: 0, filled_tokens: 0, fill_count: 0, last_error: null,
		...over,
	};
}

function priceAt(mcapUsd) {
	marketState.market = { price_sol: mcapUsd / 1e9 / 150, mcap_sol: mcapUsd / 150, graduated: false };
	marketState.signals = { ...marketState.market, mcap_usd: mcapUsd, smart_money_score: null, dev_dump: null, price_change_pct: null };
}

const okResult = {
	ok: true, status: 200,
	data: { simulated: true, venue: 'bonding_curve', price_impact_pct: 0.8, signature: 'SIMULATED', custody_event_id: null },
};

const kinds = () => dbState.calls.map((c) => c.kind);
const call = (kind) => dbState.calls.find((c) => c.kind === kind);

beforeEach(() => {
	dbState.calls = [];
	dbState.activeOrders = [];
	dbState.claimOk = true;
	dbState.group = [];
	dbState.cancelled = [];
	aggState.calls = [];
	aggState.result = null;
	notifications.length = 0;
	resetVenueHealth();
	dbState.agent = { id: AGENT_ID, user_id: USER_ID, meta: { solana_address: AGENT_ADDRESS, encrypted_solana_secret: 'enc:v1:test' } };
	marketState.market = null;
	marketState.signals = {};
	marketState.holding = null;
	tradeState.calls = [];
	tradeState.result = okResult;
	tradeState.inflight = 0;
	tradeState.maxInflight = 0;
	tradeState.delayMs = 0;
});

// ── the fire path ────────────────────────────────────────────────────────────
describe('runOrderSweep: a matched trigger fires through the audited trade path', () => {
	it('fires a limit buy once the metric falls to the target, with the custody idempotency key', async () => {
		dbState.activeOrders = [order()];
		priceAt(39_000); // at/below the 40k target

		await runOrderSweep(cfg);

		expect(tradeState.calls).toHaveLength(1);
		const args = tradeState.calls[0];
		expect(args.id).toBe(AGENT_ID);
		expect(args.userId).toBe(USER_ID);
		expect(args.source).toBe('order:limit');
		expect(args.sourceMeta).toEqual({ order_id: order().id, slice: 0 });
		// Exactly-once across processes rides on this key.
		expect(args.input.idempotencyKey).toBe(`order:${order().id}:slice:0`);
		// simulate mode must never broadcast.
		expect(args.input.simulate).toBe(true);
		// Real parseTradeInput shaped the body.
		expect(args.input.side).toBe('buy');
		expect(args.input.mint).toBe(MINT);
		expect(args.input.amount).toBe(0.25);
		expect(args.input.slippageBps).toBe(500);

		// Claimed, then a fill receipt, then the order advanced to filled.
		expect(kinds()).toContain('claim');
		expect(kinds()).toContain('insert_fill');
		expect(kinds()).toContain('advance');
		const fill = call('insert_fill');
		expect(fill.values).toContain('simulated');
		expect(fill.values).toContain('limit');
		// terminal single fill → status 'filled', next_fire_at null
		expect(call('advance').values[0]).toBe('filled');
	});

	it('holds (never fires) when the trigger has not been met', async () => {
		dbState.activeOrders = [order()];
		priceAt(55_000); // above a limit-buy target

		await runOrderSweep(cfg);

		expect(tradeState.calls).toHaveLength(0);
		expect(kinds()).toContain('mark_evaluated');
		expect(kinds()).not.toContain('claim');
	});

	it('holds on a missing live quote instead of treating it as a price of zero', async () => {
		dbState.activeOrders = [order()];
		marketState.market = null; // quote failed this sweep

		await runOrderSweep(cfg);

		expect(tradeState.calls).toHaveLength(0);
		expect(kinds()).not.toContain('claim');
		expect(kinds()).toContain('mark_evaluated');
	});

	it('leaves orders untouched when the agent has no provisioned wallet', async () => {
		dbState.activeOrders = [order()];
		dbState.agent = { id: AGENT_ID, user_id: USER_ID, meta: { solana_address: AGENT_ADDRESS } };
		priceAt(39_000);

		await runOrderSweep(cfg);

		expect(tradeState.calls).toHaveLength(0);
		expect(kinds()).not.toContain('claim');
	});

	it('does not fire an order another sweep already claimed', async () => {
		dbState.activeOrders = [order()];
		dbState.claimOk = false;
		priceAt(39_000);

		await runOrderSweep(cfg);

		expect(kinds()).toContain('claim');
		expect(tradeState.calls).toHaveLength(0);
	});

	it('runs housekeeping (expire + stale-firing recovery) before evaluating', async () => {
		dbState.activeOrders = [];
		await runOrderSweep(cfg);
		expect(kinds().slice(0, 3)).toEqual(['expire', 'recover_stale', 'active_orders']);
	});
});

// ── blocked fires ────────────────────────────────────────────────────────────
describe('runOrderSweep: blocked fires', () => {
	it('halts the order to error on a terminal firewall block', async () => {
		dbState.activeOrders = [order()];
		priceAt(39_000);
		tradeState.result = { ok: false, status: 422, code: 'firewall_blocked', message: 'rug indicators' };

		await runOrderSweep(cfg);

		const fill = call('insert_fill');
		expect(fill).toBeTruthy();
		expect(fill.values).toContain('failed');
		const halt = dbState.calls.find((c) => c.kind === 'set_status' && c.values[0] === 'error');
		expect(halt).toBeTruthy();
		expect(kinds()).not.toContain('advance'); // a failed fill never advances the budget
	});

	it('returns the order to active on a clearable block so the next sweep retries', async () => {
		dbState.activeOrders = [order()];
		priceAt(39_000);
		tradeState.result = { ok: false, status: 429, code: 'daily_budget_exceeded', message: 'budget' };

		await runOrderSweep(cfg);

		expect(kinds()).not.toContain('insert_fill');
		const release = dbState.calls.find((c) => c.kind === 'set_status' && c.values[0] === 'active');
		expect(release).toBeTruthy();
		expect(release.values[1]).toContain('daily_budget_exceeded');
	});

	it('releases the claim when a sell cannot be sized (no holding)', async () => {
		dbState.activeOrders = [order({ type: 'limit', side: 'sell', size_sol: null, sell_pct: 50, limit_price: 40_000 })];
		priceAt(45_000); // limit sell fires at/above target
		marketState.holding = { whole: 0, raw: 0n, decimals: 6 };

		await runOrderSweep(cfg);

		expect(tradeState.calls).toHaveLength(0);
		const release = dbState.calls.find((c) => c.kind === 'set_status' && c.values[1] === 'no_balance_or_size');
		expect(release).toBeTruthy();
	});

	it('scales a raw size_tokens sell by the mint decimals before handing it to the trade path', async () => {
		// size_tokens is persisted in raw base units; executeAgentTrade takes whole
		// tokens. Unscaled, this would ask for 1e6x the size and bounce off
		// insufficient_token_balance (a clearable code) on every sweep forever.
		dbState.activeOrders = [order({ type: 'limit', side: 'sell', size_sol: null, size_tokens: 2_500_000, limit_price: 40_000 })];
		priceAt(45_000);
		marketState.holding = { whole: 1_000, raw: 1_000_000_000n, decimals: 6 };

		await runOrderSweep(cfg);

		expect(tradeState.calls).toHaveLength(1);
		expect(tradeState.calls[0].input.amount).toBe(2.5);
	});

	it('holds a size_tokens sell when the mint decimals cannot be read', async () => {
		dbState.activeOrders = [order({ type: 'limit', side: 'sell', size_sol: null, size_tokens: 2_500_000, limit_price: 40_000 })];
		priceAt(45_000);
		marketState.holding = null; // RPC could not resolve the mint this sweep

		await runOrderSweep(cfg);

		expect(tradeState.calls).toHaveLength(0);
		const release = dbState.calls.find((c) => c.kind === 'set_status' && c.values[1] === 'no_balance_or_size');
		expect(release).toBeTruthy();
	});

	it('sizes a percentage sell off the live holding', async () => {
		dbState.activeOrders = [order({ type: 'limit', side: 'sell', size_sol: null, sell_pct: 25, limit_price: 40_000 })];
		priceAt(45_000);
		marketState.holding = { whole: 1_000, raw: 1_000_000_000n, decimals: 6 };

		await runOrderSweep(cfg);

		expect(tradeState.calls).toHaveLength(1);
		expect(tradeState.calls[0].input.amount).toBe(250);
		expect(tradeState.calls[0].input.side).toBe('sell');
	});
});

// ── scheduled orders ─────────────────────────────────────────────────────────
describe('runOrderSweep: DCA / TWAP slices', () => {
	const dca = (over = {}) => order({
		type: 'dca', side: 'buy', size_sol: 0.1,
		schedule: { interval_seconds: 3600, slices: 3, filled_slices: 0 },
		next_fire_at: new Date(Date.now() - 1_000).toISOString(),
		...over,
	});

	it('fires a due slice, stays partial, and re-arms the next fire time', async () => {
		dbState.activeOrders = [dca()];
		priceAt(41_000);

		await runOrderSweep(cfg);

		expect(tradeState.calls).toHaveLength(1);
		expect(tradeState.calls[0].source).toBe('order:dca');
		expect(tradeState.calls[0].input.idempotencyKey).toBe(`order:${dca().id}:slice:0`);
		const advance = call('advance');
		expect(advance.values[0]).toBe('partial');
		// schedule counter bumped, next_fire_at re-armed
		expect(JSON.parse(advance.values[3]).filled_slices).toBe(1);
		expect(advance.values[4]).toBeTruthy();
	});

	it('marks the last slice terminal and clears next_fire_at', async () => {
		dbState.activeOrders = [dca({ schedule: { interval_seconds: 3600, slices: 3, filled_slices: 2 }, fill_count: 2, status: 'partial' })];
		priceAt(41_000);

		await runOrderSweep(cfg);

		const advance = call('advance');
		expect(advance.values[0]).toBe('filled');
		expect(advance.values[4]).toBeNull();
	});

	it('does not fire a slice before its scheduled time', async () => {
		dbState.activeOrders = [dca({ next_fire_at: new Date(Date.now() + 60_000).toISOString() })];
		priceAt(41_000);

		await runOrderSweep(cfg);

		expect(tradeState.calls).toHaveLength(0);
	});

	it('does not fire past the configured slice count', async () => {
		dbState.activeOrders = [dca({ schedule: { interval_seconds: 3600, slices: 3, filled_slices: 3 } })];
		priceAt(41_000);

		await runOrderSweep(cfg);

		expect(tradeState.calls).toHaveLength(0);
	});

	// A TWAP sell divides the owner's TOTAL percentage across the slices, so its
	// sell_pct is a share of the bag at creation time, not of whatever is left.
	const twapSell = (over = {}) => order({
		type: 'twap', side: 'sell', size_sol: null, sell_pct: 25,
		schedule: { interval_seconds: 300, slices: 4, filled_slices: 0, total_pct: 100 },
		next_fire_at: new Date(Date.now() - 1_000).toISOString(),
		...over,
	});

	it('sells the promised share of the ORIGINAL bag on a later TWAP slice, not of what is left', async () => {
		// Slice 3 of 4 on a "sell 100%" TWAP: 50% of the bag is already gone, so the
		// remaining 25 points of the original are 50% of what is still held. Applying
		// the raw 25% here would leave a third of the position stranded.
		dbState.activeOrders = [twapSell({
			schedule: { interval_seconds: 300, slices: 4, filled_slices: 2, total_pct: 100 },
			fill_count: 2, status: 'partial',
		})];
		priceAt(41_000);
		marketState.holding = { whole: 500, raw: 500_000_000n, decimals: 6 };

		await runOrderSweep(cfg);

		expect(tradeState.calls).toHaveLength(1);
		expect(tradeState.calls[0].input.amount).toBeCloseTo(250, 6);
	});

	it('closes the position with a max sell on the final slice of a full-exit TWAP', async () => {
		dbState.activeOrders = [twapSell({
			schedule: { interval_seconds: 300, slices: 4, filled_slices: 3, total_pct: 100 },
			fill_count: 3, status: 'partial',
		})];
		priceAt(41_000);
		marketState.holding = { whole: 250, raw: 250_000_000n, decimals: 6 };

		await runOrderSweep(cfg);

		expect(tradeState.calls).toHaveLength(1);
		// parseTradeInput turns a "max" sell into the isMax flag with a null amount,
		// so the executor dusts out the whole balance it reads at fire time.
		expect(tradeState.calls[0].input.isMax).toBe(true);
		expect(tradeState.calls[0].input.amount).toBeNull();
		expect(call('advance').values[0]).toBe('filled');
	});

	it('leaves the first TWAP slice sized straight off the total percentage', async () => {
		dbState.activeOrders = [twapSell()];
		priceAt(41_000);
		marketState.holding = { whole: 1_000, raw: 1_000_000_000n, decimals: 6 };

		await runOrderSweep(cfg);

		expect(tradeState.calls[0].input.amount).toBe(250);
	});

	it('keeps a DCA percentage sell measured against the live bag', async () => {
		// The opposite convention on purpose: "DCA out 10% an hour" means 10% of
		// whatever is left each time, so a later slice must NOT be re-based.
		dbState.activeOrders = [dca({
			side: 'sell', size_sol: null, sell_pct: 10,
			schedule: { interval_seconds: 3600, slices: 5, filled_slices: 3 },
			fill_count: 3, status: 'partial',
		})];
		priceAt(41_000);
		marketState.holding = { whole: 700, raw: 700_000_000n, decimals: 6 };

		await runOrderSweep(cfg);

		expect(tradeState.calls[0].input.amount).toBeCloseTo(70, 6);
	});
});

// ── conditional + trailing ───────────────────────────────────────────────────
describe('runOrderSweep: conditional and trailing triggers', () => {
	it('fires a conditional order only when every clause is satisfied', async () => {
		const cond = { all: [{ signal: 'mcap_usd', op: 'lt', value: 40_000 }, { signal: 'smart_money_score', op: 'gt', value: 60 }] };
		dbState.activeOrders = [order({ type: 'conditional', condition: cond, limit_price: null })];
		priceAt(35_000);
		marketState.signals.smart_money_score = 45; // second clause fails

		await runOrderSweep(cfg);
		expect(tradeState.calls).toHaveLength(0);

		dbState.calls = [];
		marketState.signals.smart_money_score = 72;
		await runOrderSweep(cfg);

		expect(tradeState.calls).toHaveLength(1);
		expect(tradeState.calls[0].source).toBe('order:conditional');
	});

	it('never fires a conditional order on a missing signal', async () => {
		const cond = { all: [{ signal: 'dev_dump', op: 'is_true' }] };
		dbState.activeOrders = [order({ type: 'conditional', condition: cond, limit_price: null })];
		priceAt(35_000);
		marketState.signals.dev_dump = null; // intel row absent

		await runOrderSweep(cfg);

		expect(tradeState.calls).toHaveLength(0);
	});

	it('tracks the trailing high-water mark each sweep and fires on the drawdown', async () => {
		dbState.activeOrders = [order({ type: 'trailing', side: 'sell', size_sol: null, sell_pct: 100, trail_pct: 20, peak_price: 100_000, limit_price: null })];
		priceAt(90_000); // only 10% off the peak
		await runOrderSweep(cfg);
		expect(tradeState.calls).toHaveLength(0);
		expect(call('mark_evaluated').values[1]).toBe(100_000); // peak held

		dbState.calls = [];
		priceAt(75_000); // 25% off the peak
		await runOrderSweep(cfg);
		expect(tradeState.calls).toHaveLength(1);
		expect(tradeState.calls[0].input.isMax).toBe(true); // sell_pct 100 → 'max'
	});
});

// ── one agent, one wallet ────────────────────────────────────────────────────
describe('runOrderSweep: per-agent serialization', () => {
	it('never runs two fills for the same agent concurrently', async () => {
		dbState.activeOrders = [
			order({ id: '44444444-4444-4444-8444-444444444444' }),
			order({ id: '55555555-5555-4555-8555-555555555555' }),
		];
		priceAt(39_000);
		tradeState.delayMs = 5;

		await runOrderSweep(cfg);

		expect(tradeState.calls).toHaveLength(2);
		expect(tradeState.maxInflight).toBe(1);
	});

	it('loads each agent once per sweep', async () => {
		dbState.activeOrders = [
			order({ id: '44444444-4444-4444-8444-444444444444' }),
			order({ id: '55555555-5555-4555-8555-555555555555' }),
		];
		priceAt(55_000);

		await runOrderSweep(cfg);

		expect(dbState.calls.filter((c) => c.kind === 'load_agent')).toHaveLength(1);
	});
});

// ── boot config ──────────────────────────────────────────────────────────────
describe('loadConfig', () => {
	const saved = { ...process.env };

	const withEnv = (over) => {
		process.env = { ...saved, DATABASE_URL: 'postgres://u:p@example.invalid/db', JWT_SECRET: 'test-secret', ...over };
	};

	beforeEach(() => { withEnv({}); });
	afterEach(() => { process.env = { ...saved }; });

	it('defaults to the safe simulate mode on mainnet', () => {
		const cfgOut = loadConfig();
		expect(cfgOut.mode).toBe('simulate');
		expect(cfgOut.network).toBe('mainnet');
		expect(cfgOut.globalKill).toBe(false);
	});

	it('refuses to start without a database or a JWT secret', () => {
		process.env = { ...saved, DATABASE_URL: '', POSTGRES_URL: '', NEON_DATABASE_URL: '', DATABASE_URL_UNPOOLED: '', JWT_SECRET: 'x' };
		expect(() => loadConfig()).toThrow(/DATABASE_URL/);
		withEnv({ JWT_SECRET: '' });
		expect(() => loadConfig()).toThrow(/JWT_SECRET/);
	});

	it('rejects an unknown mode or network', () => {
		withEnv({ ORDERS_MODE: 'yolo' });
		expect(() => loadConfig()).toThrow(/ORDERS_MODE/);
		withEnv({ ORDERS_NETWORK: 'testnet' });
		expect(() => loadConfig()).toThrow(/ORDERS_NETWORK/);
	});

	it('refuses live mode without a real RPC endpoint', () => {
		withEnv({ ORDERS_MODE: 'live', SOLANA_RPC_URL: '', HELIUS_API_KEY: '', WALLET_ENCRYPTION_KEY: 'k' });
		expect(() => loadConfig()).toThrow(/SOLANA_RPC_URL or HELIUS_API_KEY/);
	});

	it('refuses live mode without the custodial wallet key (every fill would die at key recovery)', () => {
		withEnv({ ORDERS_MODE: 'live', SOLANA_RPC_URL: 'https://rpc.example.invalid', WALLET_ENCRYPTION_KEY: '' });
		expect(() => loadConfig()).toThrow(/WALLET_ENCRYPTION_KEY/);
		withEnv({ ORDERS_MODE: 'live', SOLANA_RPC_URL: 'https://rpc.example.invalid', WALLET_ENCRYPTION_KEY: 'k' });
		expect(loadConfig().mode).toBe('live');
	});

	it('clamps the poll, concurrency, and stale-claim windows to safe bounds', () => {
		withEnv({ ORDERS_POLL_MS: '10', ORDERS_CONCURRENCY: '999', ORDERS_STALE_FIRING_MS: '5', ORDERS_HEARTBEAT_MS: '-1' });
		const cfgOut = loadConfig();
		expect(cfgOut.pollMs).toBe(3_000);
		expect(cfgOut.concurrency).toBe(16);
		expect(cfgOut.staleFiringMs).toBe(60_000);
		expect(cfgOut.heartbeatMs).toBe(0);
	});
});

// ── live mode ────────────────────────────────────────────────────────────────
describe('runOrderSweep: live mode', () => {
	it('does not force simulate and records a confirmed fill with the signature', async () => {
		dbState.activeOrders = [order()];
		priceAt(39_000);
		tradeState.result = {
			ok: true, status: 200,
			data: { signature: '5xSigTest', venue: 'bonding_curve', sol_spent: 0.25, tokens_received: 12_345, price_impact_pct: 1.2, custody_event_id: 'ce-1' },
		};

		await runOrderSweep({ ...cfg, mode: 'live' });

		expect(tradeState.calls[0].input.simulate).toBe(false);
		const fill = call('insert_fill');
		expect(fill.values).toContain('confirmed');
		expect(fill.values).toContain('5xSigTest');
		expect(fill.values).toContain('ce-1');
	});
});

// ── any SPL token: the aggregator route ─────────────────────────────────────
describe('runOrderSweep: aggregator route for non-launchpad tokens', () => {
	const aggOk = (over = {}) => ({
		status: 200,
		data: {
			simulated: true, err: null, venue: 'aggregator', price_impact_pct: 0.3,
			in: { asset: 'SOL', amount: 0.25, atomics: '250000000' },
			out: { asset: 'TOKEN', amount: 1234.5, atomics: '1234500000', decimals: 6 },
			...over,
		},
	});
	const aggPrice = (mcapUsd) => { priceAt(mcapUsd); marketState.market.route = 'aggregator'; marketState.market.graduated = true; };

	it('fills through runAgentTrade with the aggregator executor, simulated, with the slice key, and pins the route', async () => {
		dbState.activeOrders = [order({ venue: 'auto', route: null })];
		aggPrice(39_000);
		aggState.result = aggOk();

		await runOrderSweep(cfg);

		expect(tradeState.calls).toHaveLength(0); // never the launchpad executor
		expect(aggState.calls).toHaveLength(1);
		const args = aggState.calls[0];
		expect(args.simulate).toBe(true);
		expect(args.executor).toBeTruthy();
		expect(typeof args.executor.quote).toBe('function');
		expect(args.parsed.idempotencyKey).toBe(`order:${order().id}:slice:0`);
		expect(args.parsed.solAmount).toBe(0.25);
		expect(args.address).toBe(AGENT_ADDRESS);
		expect(call('set_route').values[0]).toBe('aggregator');
		expect(call('insert_fill').values).toContain('simulated');
		expect(call('advance').values[0]).toBe('filled');
	});

	it('sizes a percentage sell against the raw on-chain balance with integer math', async () => {
		dbState.activeOrders = [order({ route: 'aggregator', side: 'sell', size_sol: null, sell_pct: 25, limit_price: 40_000 })];
		aggPrice(45_000);
		marketState.holding = { whole: 1_000, raw: 1_000_000_001n, decimals: 6 };
		aggState.result = aggOk();

		await runOrderSweep(cfg);

		expect(aggState.calls).toHaveLength(1);
		expect(aggState.calls[0].parsed.tokenAmountRaw).toBe('250000000');
		expect(aggState.calls[0].parsed.side).toBe('sell');
	});

	it('never books a paper fill whose simulation reverted; records the skip instead', async () => {
		dbState.activeOrders = [order({ route: 'aggregator' })];
		aggPrice(39_000);
		aggState.result = aggOk({ err: { InstructionError: [2, { Custom: 6001 }] } });

		await runOrderSweep(cfg);

		expect(kinds()).not.toContain('insert_fill');
		expect(call('note_skip').values[0]).toBe('venue_unhealthy');
		expect(call('note_skip').values[1]).toContain('simulation_failed');
	});

	it('reroutes an auto order to the aggregator when the launchpad says the token is not its market', async () => {
		dbState.activeOrders = [order({ venue: 'auto', route: 'launchpad' })];
		priceAt(39_000);
		tradeState.result = { ok: false, status: 422, code: 'quote_not_sol', message: 'not SOL-quoted' };

		await runOrderSweep(cfg);

		expect(call('set_route').values[0]).toBe('aggregator');
		expect(dbState.calls.find((c) => c.kind === 'set_status' && c.values[0] === 'error')).toBeFalsy();
		expect(kinds()).not.toContain('insert_fill');
	});

	it('still halts a launchpad-only order on the same code', async () => {
		dbState.activeOrders = [order({ venue: 'launchpad', route: 'launchpad' })];
		priceAt(39_000);
		tradeState.result = { ok: false, status: 422, code: 'quote_not_sol', message: 'not SOL-quoted' };

		await runOrderSweep(cfg);

		expect(dbState.calls.find((c) => c.kind === 'set_status' && c.values[0] === 'error')).toBeTruthy();
		expect(notifications.some((n) => n.type === 'order_update' && n.payload.kind === 'fail')).toBe(true);
	});

	it('opens the per-route breaker after three venue failures and backs the next order off', async () => {
		const ids = ['a', 'b', 'c', 'd'].map((x) => `${x.repeat(8)}-0000-4000-8000-000000000000`);
		dbState.activeOrders = ids.map((id) => order({ id, route: 'aggregator' }));
		aggPrice(39_000);
		aggState.result = { status: 502, error: { code: 'quote_failed', message: 'aggregator down' } };

		await runOrderSweep(cfg);

		expect(aggState.calls).toHaveLength(3);
		const held = dbState.calls.filter((c) => c.kind === 'note_skip' && c.values[0] === 'venue_unhealthy' && c.values[2]);
		expect(held).toHaveLength(1);
		expect(new Date(held[0].values[2]).getTime()).toBeGreaterThan(Date.now());
	});
});

// ── order groups ─────────────────────────────────────────────────────────────
describe('runOrderSweep: ladders and OCO pairs', () => {
	const G = '99999999-9999-4999-8999-999999999999';
	const leg = (id, over = {}) => order({
		id, group_id: G, side: 'sell', size_sol: null, type: 'limit', limit_price: 40_000, ...over,
	});
	const A = 'aaaaaaaa-0000-4000-8000-000000000001';
	const B = 'aaaaaaaa-0000-4000-8000-000000000002';
	const C = 'aaaaaaaa-0000-4000-8000-000000000003';

	it('re-bases a ladder leg onto what is left after earlier legs sold', async () => {
		dbState.activeOrders = [leg(B, { group_kind: 'ladder', sell_pct: 25 })];
		dbState.group = [
			{ id: A, status: 'filled', sell_pct: 25 },
			{ id: B, status: 'active', sell_pct: 25 },
			{ id: C, status: 'active', sell_pct: 50 },
		];
		priceAt(45_000);
		marketState.holding = { whole: 750, raw: 750_000_000n, decimals: 6 };

		await runOrderSweep(cfg);

		// 25 points of the original bag = a third of the 75% still held.
		expect(tradeState.calls[0].input.amount).toBeCloseTo(250, 6);
	});

	it('closes the position on the last open leg of a ladder that adds up to 100', async () => {
		dbState.activeOrders = [leg(C, { group_kind: 'ladder', sell_pct: 50 })];
		dbState.group = [
			{ id: A, status: 'filled', sell_pct: 25 },
			{ id: B, status: 'filled', sell_pct: 25 },
			{ id: C, status: 'active', sell_pct: 50 },
		];
		priceAt(45_000);
		marketState.holding = { whole: 500, raw: 500_000_000n, decimals: 6 };

		await runOrderSweep(cfg);

		expect(tradeState.calls[0].input.isMax).toBe(true);
	});

	it('cancels the other OCO leg when one fills and says so in the notification', async () => {
		dbState.activeOrders = [leg(A, { group_kind: 'oco', sell_pct: 100 })];
		dbState.cancelled = [{ id: B, agent_id: AGENT_ID }];
		priceAt(45_000);

		await runOrderSweep(cfg);

		const cancel = call('cancel_siblings');
		expect(cancel.values[0]).toBe('oco_sibling_filled');
		expect(cancel.values).toContain(G);
		const fired = notifications.find((n) => n.payload.kind === 'fire');
		expect(fired.type).toBe('order_update');
		expect(fired.payload.message).toMatch(/other leg/);
		expect(fired.payload.message).toMatch(/Paper fill/);
	});
});

// ── the visible book ─────────────────────────────────────────────────────────
describe('runOrderSweep: skip reasons and the DCA price band', () => {
	const dca = (over = {}) => order({
		type: 'dca', side: 'buy', size_sol: 0.1, limit_price: null,
		schedule: { interval_seconds: 3600, slices: 3, filled_slices: 0 },
		next_fire_at: new Date(Date.now() - 1_000).toISOString(),
		...over,
	});

	it('consumes a DCA slice priced outside its band instead of buying it', async () => {
		dbState.activeOrders = [dca({ price_band: { max: 40_000 } })];
		priceAt(41_000);

		await runOrderSweep(cfg);

		expect(tradeState.calls).toHaveLength(0);
		const consumed = call('consume_slice');
		expect(JSON.parse(consumed.values[0]).skipped_slices).toBe(1);
		expect(call('note_skip').values[0]).toBe('price_outside_band');
		expect(call('event').values).toContain('skip');
	});

	it('buys a DCA slice inside its band and uses the next slice index for the key', async () => {
		dbState.activeOrders = [dca({ price_band: { max: 40_000 }, schedule: { interval_seconds: 3600, slices: 3, filled_slices: 0, skipped_slices: 1 } })];
		priceAt(39_000);

		await runOrderSweep(cfg);

		expect(tradeState.calls).toHaveLength(1);
		expect(tradeState.calls[0].input.idempotencyKey).toBe(`order:${dca().id}:slice:1`);
	});

	it('records cap_hit when the spend guard blocks a fill and tells the owner once', async () => {
		dbState.activeOrders = [order()];
		priceAt(39_000);
		tradeState.result = { ok: false, status: 429, code: 'daily_budget_exceeded', message: 'budget' };

		await runOrderSweep(cfg);

		expect(call('note_skip').values[0]).toBe('cap_hit');
		expect(notifications.filter((n) => n.payload.kind === 'skip')).toHaveLength(1);
	});

	it('records no_quote when no venue prices the token', async () => {
		dbState.activeOrders = [order()];
		marketState.market = null;

		await runOrderSweep(cfg);

		expect(call('note_skip').values[0]).toBe('no_quote');
	});

	it('clears a stale skip reason once a live quote is simply waiting on the trigger', async () => {
		dbState.activeOrders = [order({ last_skip_code: 'no_quote' })];
		priceAt(55_000);

		await runOrderSweep(cfg);

		expect(kinds()).toContain('clear_skip');
	});

	it('leaves an order alone while its venue hold is in force', async () => {
		dbState.activeOrders = [order({ hold_until: new Date(Date.now() + 60_000).toISOString() })];
		priceAt(39_000);

		await runOrderSweep(cfg);

		expect(tradeState.calls).toHaveLength(0);
		expect(kinds()).not.toContain('mark_evaluated');
	});

	it('notifies the owner on a fill', async () => {
		dbState.activeOrders = [order()];
		priceAt(39_000);

		await runOrderSweep(cfg);

		const n = notifications.find((x) => x.payload.kind === 'fire');
		expect(n.userId).toBe(USER_ID);
		expect(n.payload.order_id).toBe(order().id);
		expect(n.payload.link).toContain(`/agents/${AGENT_ID}`);
	});
});
