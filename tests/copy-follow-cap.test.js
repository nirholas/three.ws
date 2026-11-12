/**
 * Follow with a spend cap: the one-tap Follow on an agent page attaches a copier
 * to a leader with a lifetime SOL budget set at the moment of the tap.
 *
 *  1. A follow requires a cap greater than zero and at most the platform maximum,
 *     and a per-trade cap that does not exceed it.
 *  2. A copied trade larger than what is left of the cap is skipped, never sized
 *     past it, and the fanout logs that skip as a copy_executions row with a reason.
 *  3. Unfollow (DELETE) stops the subscription, and a stopped subscription mirrors
 *     nothing on the very next decision.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	COPY_MAX_SPEND_CAP_SOL,
	normalizeSubscriptionInput,
	planCopyOrder,
} from '../api/_lib/copy-engine.js';

const LEADER = '33333333-3333-4333-8333-333333333333';
const SUB = '11111111-1111-4111-8111-111111111111';

const followBody = (over = {}) => ({
	follow: true,
	sizing_rule: 'fixed',
	fixed_sol: 0.05,
	per_trade_cap_sol: 0.05,
	daily_budget_sol: 0.2,
	spend_cap_sol: 0.5,
	...over,
});

const activeSub = (over = {}) => ({
	id: SUB,
	status: 'active',
	sizing_rule: 'fixed',
	fixed_sol: 0.05,
	per_trade_cap_sol: 0.05,
	min_order_sol: 0,
	daily_budget_sol: 1,
	max_open_copies: 5,
	copy_sells: true,
	require_safety_pass: false,
	spend_cap_sol: 0.5,
	...over,
});

const buy = { direction: 'buy', entry_sol: 0.2, mint: 'THREEsynthetic11111111111111111111111111111' };

describe('follow requires a spend cap', () => {
	it('refuses a follow with no cap', () => {
		const r = normalizeSubscriptionInput(followBody({ spend_cap_sol: undefined }));
		expect(r.ok).toBe(false);
		expect(r.error).toMatch(/spend_cap_sol/);
	});

	it('refuses a zero or negative cap', () => {
		expect(normalizeSubscriptionInput(followBody({ spend_cap_sol: 0 })).ok).toBe(false);
		expect(normalizeSubscriptionInput(followBody({ spend_cap_sol: -1 })).ok).toBe(false);
	});

	it('refuses a cap above the platform maximum', () => {
		const r = normalizeSubscriptionInput(followBody({ spend_cap_sol: COPY_MAX_SPEND_CAP_SOL + 0.01 }));
		expect(r.ok).toBe(false);
		expect(r.error).toContain(String(COPY_MAX_SPEND_CAP_SOL));
	});

	it('refuses a per-trade cap larger than the spend cap', () => {
		const r = normalizeSubscriptionInput(followBody({ spend_cap_sol: 0.1, per_trade_cap_sol: 0.2, fixed_sol: 0.2 }));
		expect(r.ok).toBe(false);
		expect(r.error).toMatch(/per_trade_cap_sol/);
	});

	it('accepts a cap at exactly the platform maximum', () => {
		const r = normalizeSubscriptionInput(followBody({ spend_cap_sol: COPY_MAX_SPEND_CAP_SOL }));
		expect(r.ok).toBe(true);
		expect(r.value.spend_cap_sol).toBe(COPY_MAX_SPEND_CAP_SOL);
	});

	it('leaves an existing non-follow subscription uncapped', () => {
		const r = normalizeSubscriptionInput(followBody({ follow: undefined, spend_cap_sol: undefined }));
		expect(r.ok).toBe(true);
		expect(r.value.spend_cap_sol).toBeNull();
	});
});

describe('the engine never sizes past the remaining cap', () => {
	it('copies when the order fits inside what is left', () => {
		const d = planCopyOrder({ subscription: activeSub(), position: buy, spentCapSol: 0.4 });
		expect(d).toMatchObject({ action: 'copy', order_sol: 0.05 });
	});

	it('skips a trade that exceeds the remaining cap, with a reason the copier can read', () => {
		const d = planCopyOrder({ subscription: activeSub(), position: buy, spentCapSol: 0.48 });
		expect(d.action).toBe('skip');
		expect(d.reason).toBe('spend_cap_exceeded');
		expect(d.detail).toMatch(/0\.02/);
	});

	it('skips once the cap is spent', () => {
		const d = planCopyOrder({ subscription: activeSub(), position: buy, spentCapSol: 0.5 });
		expect(d).toMatchObject({ action: 'skip', reason: 'spend_cap_reached' });
	});

	it('still mirrors an exit after the cap is spent, since a sell spends no new SOL', () => {
		const d = planCopyOrder({ subscription: activeSub(), position: { ...buy, direction: 'sell' }, spentCapSol: 0.5 });
		expect(d).toMatchObject({ action: 'copy', direction: 'sell', order_sol: 0 });
	});
});

// ── Endpoint + fanout, against a recording sql mock ────────────────────────────

let sessionUser = { id: 'copier-1' };
const sqlCalls = [];
let subRows = [];
let capSpendRows = [];
let positions = [];

vi.mock('../api/_lib/http.js', () => ({
	wrap: (fn) => fn,
	wrapCron: (fn) => fn,
	cors: () => false,
	method: () => true,
	readJson: async (req) => req.body ?? {},
	rateLimited: (res) => res,
	error: (res, status, code, message, extra = {}) => {
		res._json = { status, body: { error: code, error_description: message, ...extra } };
		return res;
	},
	json: (res, status, body) => { res._json = { status, body }; return res; },
}));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { publicIp: async () => ({ success: true }) },
	clientIp: () => '1.2.3.4',
}));
vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: async () => sessionUser,
	authenticateBearer: async () => null,
	extractBearer: () => null,
}));
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: async () => true }));
vi.mock('../api/_lib/cron-auth.js', () => ({ requireCron: () => true }));
vi.mock('../api/_lib/pump.js', () => ({ getConnection: () => ({}) }));
vi.mock('../api/_lib/pump-feed-fetch.js', () => ({
	pumpFetchJson: async () => ({ ok: true, body: { usd_market_cap: 50000, complete: false } }),
	PUMP_FRONTEND_BASE: 'https://frontend.example',
}));
vi.mock('../api/_lib/market/token-market.js', () => ({ fetchTokenMarketData: async () => null }));
vi.mock('../api/_lib/copy-drip-runtime.js', () => ({
	loadDripConfigs: async () => new Map(),
	newTierCache: () => new Map(),
	priceRelease: async ({ plannedSol }) => ({ plannedSol, capacitySkip: null, notifyNow: true }),
	releaseDueDrips: async () => {},
}));
vi.mock('../api/_lib/copy-eligibility.js', async (importOriginal) => {
	const real = await importOriginal();
	return {
		...real,
		leaderCopyProfile: async () => ({ settled: 30, span_hours: 200, deployed_sol: 2, max_drawdown_pct: 5 }),
		leaderDrawdownPcts: async () => new Map(),
		checkLeaderCreatorLinkage: async () => ({ linked: false }),
	};
});
vi.mock('../api/_lib/db.js', () => ({
	sql: (strings, ...values) => {
		const text = strings.join('?');
		sqlCalls.push({ text, values });
		if (text.includes('from agent_sniper_positions p')) return Promise.resolve(positions);
		if (text.includes('spend_cap_set_at') && text.includes('from copy_executions')) return Promise.resolve(capSpendRows);
		if (text.includes('from copy_subscriptions s') && text.includes('join agent_identities')) return Promise.resolve(subRows);
		if (text.includes('from agent_identities')) {
			return Promise.resolve([{ id: LEADER, user_id: 'owner-2', name: 'Steady', is_public: true }]);
		}
		if (text.includes('insert into copy_subscriptions')) return Promise.resolve([{ id: SUB, leader_agent_id: LEADER }]);
		if (text.includes('update copy_subscriptions set status')) return Promise.resolve([{ id: SUB }]);
		if (text.includes('insert into copy_executions')) return Promise.resolve([{ id: 'exec-1' }]);
		return Promise.resolve([]);
	},
}));

const subscriptions = (await import('../api/copy/subscriptions.js')).default;
const fanout = (await import('../api/cron/copy-fanout.js')).default;

const res = () => ({ setHeader() {}, _json: null });

beforeEach(() => {
	sqlCalls.length = 0;
	sessionUser = { id: 'copier-1' };
	subRows = [];
	capSpendRows = [];
	positions = [];
});

describe('POST /api/copy/subscriptions with follow: true', () => {
	it('rejects a follow without a cap before writing anything', async () => {
		const r = res();
		await subscriptions({
			method: 'POST', url: '/api/copy/subscriptions', headers: {},
			body: { leader_agent_id: LEADER, copier_wallet: 'So11111111111111111111111111111111111111112', ...followBody({ spend_cap_sol: null }) },
		}, r);
		expect(r._json.status).toBe(400);
		expect(r._json.body.error).toBe('invalid_config');
		expect(sqlCalls.some((c) => c.text.includes('insert into copy_subscriptions'))).toBe(false);
	});

	it('persists the cap and restarts its counter on the follow', async () => {
		const r = res();
		await subscriptions({
			method: 'POST', url: '/api/copy/subscriptions', headers: {},
			body: { leader_agent_id: LEADER, copier_wallet: 'So11111111111111111111111111111111111111112', ...followBody() },
		}, r);
		expect(r._json.status).toBe(200);
		const insert = sqlCalls.find((c) => c.text.includes('insert into copy_subscriptions'));
		expect(insert.text).toContain('spend_cap_sol');
		expect(insert.text).toContain('spend_cap_set_at');
		expect(insert.values).toContain(0.5);
	});
});

describe('fanout logs a cap skip', () => {
	it('writes a skipped execution with skip_reason spend_cap_exceeded instead of a pending intent', async () => {
		positions = [{ id: 'pos-1', agent_id: LEADER, mint: buy.mint, symbol: 'THREE', name: 'three.ws', entry_quote_lamports: '200000000', buy_sig: 'sig1', opened_at: new Date() }];
		subRows = [{ ...activeSub(), copier_user_id: 'copier-1', leader_agent_id: LEADER, leader_user_id: 'owner-2', network: 'mainnet', leader_wallet: null }];
		capSpendRows = [{ subscription_id: SUB, spent: 0.48 }];
		const r = res();
		await fanout({ method: 'GET', url: '/api/cron/copy-fanout', headers: {} }, r);
		const inserts = sqlCalls.filter((c) => c.text.includes('insert into copy_executions'));
		expect(inserts.length).toBeGreaterThan(0);
		const row = inserts[0];
		expect(row.values).toContain('skipped');
		expect(row.values).toContain('spend_cap_exceeded');
		expect(r._json.body.skipped).toBeGreaterThan(0);
	});
});

describe('unfollow stops mirroring immediately', () => {
	it('DELETE marks the subscription stopped', async () => {
		const r = res();
		await subscriptions({ method: 'DELETE', url: `/api/copy/subscriptions?id=${SUB}`, headers: {} }, r);
		expect(r._json.status).toBe(200);
		expect(r._json.body.status).toBe('stopped');
		const update = sqlCalls.find((c) => c.text.includes("set status = 'stopped'"));
		expect(update.values).toEqual([SUB, 'copier-1']);
	});

	it('a stopped subscription copies nothing, buy or sell', () => {
		const stopped = activeSub({ status: 'stopped' });
		expect(planCopyOrder({ subscription: stopped, position: buy }).reason).toBe('subscription_inactive');
		expect(planCopyOrder({ subscription: stopped, position: { ...buy, direction: 'sell' } }).action).toBe('skip');
	});
});
