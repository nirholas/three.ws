// Credit plans, time passes and free trials for paid MCP tools, driven through
// the real /api/mcp dispatcher over an in-process Postgres (PGlite) that runs the
// real migration. Covers: debit on success, refund on error, an exhausted
// balance falling back to the per-call -32402, trials, time passes, plan purchase.

import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { createPgliteSql } from './_helpers/pglite-sql.js';

const holder = vi.hoisted(() => ({ db: null, fail: false }));

vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});
vi.mock('../api/_mcp/catalog.js', () => {
	const handler = async (args) => {
		if (holder.fail) throw new Error('tool exploded');
		return { content: [{ type: 'text', text: 'ok' }] };
	};
	return {
		TOOL_CATALOG: [],
		TOOLS: { render_avatar: { handler }, optimize_model: { handler }, list_my_avatars: { handler } },
	};
});
vi.mock('../api/_mcp/policy.js', () => ({
	declaredArgs: () => [],
	gateCall: async (_s, _n, args) => ({ ok: true, args }),
	finishCall: async (_s, _n, _a, _auth, result) => result,
	listForRequest: async () => [],
}));
vi.mock('../api/_mcp/resources.js', () => ({ handleResourceMethod: async () => undefined, RESOURCE_CAPABILITIES: {} }));
vi.mock('../api/_mcp/prompts.js', () => ({ handlePromptMethod: () => undefined, PROMPT_CAPABILITIES: {} }));
vi.mock('../api/_lib/usage.js', () => ({
	recordEvent: () => {},
	logger: () => ({ info() {}, warn() {}, error() {} }),
}));
vi.mock('../api/_lib/credits.js', () => ({
	debitCredits: vi.fn(async () => ({ replay: false })),
	getCreditAccount: async () => ({ balanceUsd: 40 }),
}));

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';

const USER = '00000000-0000-4000-8000-000000000001';
const migration = readFileSync('api/_lib/migrations/20261023160000_mcp_plans.sql', 'utf8');

let dispatch;
let plans;
let credits;

beforeAll(async () => {
	({ dispatch } = await import('../api/_mcp/dispatch.js'));
	plans = await import('../api/_lib/mcp-plans.js');
	credits = await import('../api/_lib/mcp-credits.js');
});

beforeEach(async () => {
	holder.db = createPgliteSql();
	holder.fail = false;
	delete process.env.MCP_METER_ALL;
	delete process.env.MCP_TRIAL_CALLS;
	await holder.db.exec(`create table users (id uuid primary key); insert into users values ('${USER}');`);
	await holder.db.exec(migration);
});

const auth = { userId: USER, source: 'bearer', scope: '' };
const call = (name) =>
	dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } }, auth, {});

async function grantBundle(creditsAmount, tools = []) {
	const [plan] = await holder.db.query(`select id from mcp_plans where slug = 'starter-500'`);
	const [row] = await holder.db.query(
		`insert into mcp_plan_balances (user_id, plan_id, kind, credits_total, credits_remaining, tools, purchase_key)
		 values ($1, $2, 'credits', $3, $3, $4, gen_random_uuid()::text) returning id`,
		[USER, plan.id, creditsAmount, tools],
	);
	return row.id;
}

describe('credit cost', () => {
	it('is the list price in thousandths of a dollar, minimum 1', () => {
		expect(credits.creditCostFor('render_avatar')).toBe(5);
		expect(credits.creditCostFor('optimize_model')).toBe(50);
		expect(credits.creditCostFor('list_my_avatars')).toBeNull();
	});
});

describe('bundle debit and refund', () => {
	it('debits on success and reports creditsUsed and creditsRemaining', async () => {
		await grantBundle(100);
		const res = await call('render_avatar');
		expect(res.result._meta).toMatchObject({ creditsUsed: 5, creditsRemaining: 95, creditSource: 'plan' });
		const [bal] = await holder.db.query('select credits_remaining from mcp_plan_balances');
		expect(bal.credits_remaining).toBe(95);
		const events = await holder.db.query('select kind, credits from mcp_credit_events');
		expect(events).toEqual([{ kind: 'debit', credits: 5 }]);
	});

	it('refunds when the tool throws', async () => {
		await grantBundle(100);
		holder.fail = true;
		const res = await call('render_avatar');
		expect(res.result.isError).toBe(true);
		expect(res.result._meta).toMatchObject({ creditsUsed: 0, creditsRemaining: 100 });
		const [bal] = await holder.db.query('select credits_remaining from mcp_plan_balances');
		expect(bal.credits_remaining).toBe(100);
		const events = await holder.db.query('select kind from mcp_credit_events order by created_at, kind');
		expect(events.map((e) => e.kind).sort()).toEqual(['debit', 'refund']);
	});

	it('never drives a balance negative and does not charge unmetered tools', async () => {
		await grantBundle(100);
		const res = await call('list_my_avatars');
		expect(res.result._meta).toBeUndefined();
		const [bal] = await holder.db.query('select credits_remaining from mcp_plan_balances');
		expect(bal.credits_remaining).toBe(100);
	});
});

describe('exhausted balance', () => {
	it('falls back to the per-call -32402 for an account that holds a plan', async () => {
		process.env.MCP_TRIAL_CALLS = '0';
		await grantBundle(4);
		const res = await call('render_avatar');
		expect(res.error.code).toBe(-32402);
		expect(res.error.data).toMatchObject({ scheme: 'x402', tool: 'render_avatar', creditsRequired: 5, creditsRemaining: 4, amount_usdc: 0.005 });
		const [bal] = await holder.db.query('select credits_remaining from mcp_plan_balances');
		expect(bal.credits_remaining).toBe(4);
	});

	it('leaves an account with no plan on the existing bearer bypass once trials are used', async () => {
		process.env.MCP_TRIAL_CALLS = '1';
		expect((await call('render_avatar')).result._meta.creditSource).toBe('trial');
		const second = await call('render_avatar');
		expect(second.error).toBeUndefined();
		expect(second.result._meta).toBeUndefined();
	});

	it('meters every account when MCP_METER_ALL is set', async () => {
		process.env.MCP_METER_ALL = '1';
		process.env.MCP_TRIAL_CALLS = '0';
		expect((await call('render_avatar')).error.code).toBe(-32402);
	});
});

describe('trials', () => {
	it('gives N free calls per account per tool and refunds a failed one', async () => {
		process.env.MCP_TRIAL_CALLS = '2';
		expect((await call('render_avatar')).result._meta).toMatchObject({ creditSource: 'trial', creditsUsed: 0, trialRemaining: 1 });
		holder.fail = true;
		expect((await call('render_avatar')).result._meta.trialRemaining).toBe(1);
		holder.fail = false;
		expect((await call('render_avatar')).result._meta.trialRemaining).toBe(0);
		expect((await call('render_avatar')).result._meta).toBeUndefined();
		expect((await call('optimize_model')).result._meta.trialRemaining).toBe(1);
	});

	it('is used only after a bundle cannot pay', async () => {
		await grantBundle(100);
		expect((await call('render_avatar')).result._meta.creditSource).toBe('plan');
		const trials = await holder.db.query('select * from mcp_tool_trials');
		expect(trials).toEqual([]);
	});
});

describe('time pass', () => {
	it('covers calls without spending credits and ignores an expired pass', async () => {
		const [plan] = await holder.db.query(`select id from mcp_plans where slug = 'studio-day'`);
		await holder.db.query(
			`insert into mcp_plan_balances (user_id, plan_id, kind, tools, expires_at, purchase_key)
			 values ($1, $2, 'time', '{}', now() - interval '1 hour', 'expired')`,
			[USER, plan.id],
		);
		process.env.MCP_TRIAL_CALLS = '0';
		expect((await call('render_avatar')).error.code).toBe(-32402);
		await holder.db.query(
			`insert into mcp_plan_balances (user_id, plan_id, kind, tools, expires_at, purchase_key)
			 values ($1, $2, 'time', '{}', now() + interval '1 hour', 'live')`,
			[USER, plan.id],
		);
		const res = await call('optimize_model');
		expect(res.result._meta).toMatchObject({ creditSource: 'time_pass', creditsUsed: 0 });
		expect(res.result._meta.planExpiresAt).toBeTruthy();
	});
});

describe('plan purchase', () => {
	it('grants a bundle once per idempotency key', async () => {
		const a = await plans.purchasePlan({ userId: USER, slug: 'starter-500', idempotencyKey: 'purchase-key-1' });
		const b = await plans.purchasePlan({ userId: USER, slug: 'starter-500', idempotencyKey: 'purchase-key-1' });
		expect(a.replay).toBe(false);
		expect(b).toMatchObject({ replay: true, balanceId: a.balanceId });
		const summary = await plans.accountSummary(USER);
		expect(summary.creditsRemaining).toBe(500);
	});

	it('grants a time pass with an expiry and rejects an unknown plan', async () => {
		await plans.purchasePlan({ userId: USER, slug: 'studio-day', idempotencyKey: 'purchase-key-2' });
		const summary = await plans.accountSummary(USER);
		expect(summary.timePasses).toHaveLength(1);
		await expect(plans.purchasePlan({ userId: USER, slug: 'nope', idempotencyKey: 'purchase-key-3' })).rejects.toMatchObject({ status: 404 });
	});
});
