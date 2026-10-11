// Per-agent token ceilings (api/_lib/token-budgets.js) against the REAL
// agent_token_usage and approval_requests migrations in an in-process Postgres
// (PGlite). Pins the contracts the ceilings exist for:
//   - two calls racing for the last tokens of a window admit exactly one, and
//     the loser pauses the agent once: one notification, one extend-once
//     approval, no duplicate on the next refusal;
//   - every call after the pause is refused as token_budget_paused;
//   - resume refuses while the window is still full (409 still_capped);
//   - extend-once raises the ceiling, resumes the agent, and is refused the
//     second time for the same window; the executor itself is idempotent;
//   - the 50 and 80 percent marks notify once per window;
//   - clearing the caps restarts an agent the ceiling had stopped;
//   - the free-tier body carries the choices a client needs to recover.

import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createPgliteSql } from './_helpers/pglite-sql.js';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const db = createPgliteSql();

vi.mock('../api/_lib/db.js', () => ({ sql: (...args) => db.sql(...args), isDbUnavailableError: () => false, isDbCapacityError: () => false }));

const audit = vi.hoisted(() => ({ logAudit: vi.fn() }));
vi.mock('../api/_lib/audit.js', () => audit);

const notify = vi.hoisted(() => ({
	insertNotification: vi.fn(async () => ({ id: 1, in_app: true, delivered: { push: 1 } })),
	emailAllowedForType: vi.fn(async () => true),
}));
vi.mock('../api/_lib/notify.js', () => notify);

const email = vi.hoisted(() => ({ sendApprovalRequestEmail: vi.fn(async () => ({ id: 'email-1' })) }));
vi.mock('../api/_lib/email.js', () => email);

vi.mock('../api/_lib/wallet-intents.js', () => ({ executeApprovedIntentAction: vi.fn() }));

const T = await import('../api/_lib/token-budgets.js');
const A = await import('../api/_lib/approvals.js');
const F = await import('../api/_lib/free-tier.js');

const TOKEN_MIGRATION = readFileSync(new URL('../api/_lib/migrations/20261010173000_agent_token_budgets.sql', import.meta.url), 'utf8');
const APPROVALS_MIGRATION = readFileSync(new URL('../api/_lib/migrations/20261010120000_approval_requests.sql', import.meta.url), 'utf8');

const OWNER = '11111111-1111-4111-8111-111111111111';
const AGENT = '33333333-3333-4333-8333-333333333333';
const SECOND = '44444444-4444-4444-8444-444444444444';

async function agentRow(id = AGENT) {
	const [row] = await db.query('select id, user_id, name, status, meta from agent_identities where id = $1', [id]);
	return row;
}

function notifications(type) {
	return notify.insertNotification.mock.calls.filter((c) => c[1] === type);
}

beforeAll(async () => {
	await db.exec(`
		create table users (id uuid primary key, email text);
		create table agent_identities (
			id uuid primary key, user_id uuid, name text,
			status text not null default 'running', status_changed_at timestamptz,
			meta jsonb not null default '{}'::jsonb, updated_at timestamptz default now(), deleted_at timestamptz
		);
		insert into users (id, email) values ('${OWNER}', 'owner@example.com');
	`);
	await db.exec(TOKEN_MIGRATION);
	await db.exec(APPROVALS_MIGRATION);
});

beforeEach(async () => {
	await db.exec(`
		delete from approval_requests; delete from approval_auto_policies; delete from agent_token_usage;
		delete from agent_identities;
		insert into agent_identities (id, user_id, name, meta) values
			('${AGENT}', '${OWNER}', 'Scout', '{"autopilot": {"enabled": true}}'),
			('${SECOND}', '${OWNER}', 'Lookout', '{}');
	`);
	vi.clearAllMocks();
	notify.insertNotification.mockResolvedValue({ id: 1, in_app: true, delivered: { push: 1 } });
});

describe('cap validation and arithmetic', () => {
	it('accepts the API field names, the stored ones, and null to clear', () => {
		expect(T.normalizeTokenBudget({ hourly: 50_000, daily: 500_000, per_run: 20_000 })).toEqual({ hourly_tokens: 50_000, daily_tokens: 500_000, per_run_tokens: 20_000 });
		expect(T.normalizeTokenBudget({ daily_tokens: 100, perRun: 10 })).toEqual({ hourly_tokens: null, daily_tokens: 100, per_run_tokens: 10 });
		expect(T.normalizeTokenBudget(null)).toBeNull();
		expect(T.normalizeTokenBudget({})).toBeNull();
	});

	it('rejects fractions, zero, oversized caps, an hourly above the daily, and non-objects', () => {
		expect(() => T.normalizeTokenBudget({ hourly: 1.5 })).toThrow(/whole number/);
		expect(() => T.normalizeTokenBudget({ hourly: 0 })).toThrow(/whole number/);
		expect(() => T.normalizeTokenBudget({ daily: T.MAX_TOKENS_PER_CAP + 1 })).toThrow(/cannot exceed/);
		expect(() => T.normalizeTokenBudget({ hourly: 10, daily: 5 })).toThrow(/cannot exceed tokenBudget.daily/);
		expect(() => T.normalizeTokenBudget('10')).toThrow(/object/);
	});

	it('adds a granted extension to the ceiling only for the window key it was granted for', () => {
		const budget = { hourly_tokens: 100, extensions: { hour: { key: '2026-10-10T14', extra_tokens: 50 } } };
		expect(T.ceilingFor(budget, 'hour', '2026-10-10T14')).toBe(150);
		expect(T.ceilingFor(budget, 'hour', '2026-10-10T15')).toBe(100);
		expect(T.ceilingFor(budget, 'day', '2026-10-10')).toBeNull();
		expect(T.defaultExtensionTokens(10)).toBe(T.MIN_EXTENSION_TOKENS);
		expect(T.defaultExtensionTokens(400_000)).toBe(200_000);
	});

	it('keys windows by UTC hour, UTC day or run id and knows when each resets', () => {
		const now = new Date('2026-10-10T14:25:00.000Z');
		expect(T.tokenWindowKey('hour', { now })).toBe('2026-10-10T14');
		expect(T.tokenWindowKey('day', { now })).toBe('2026-10-10');
		expect(T.tokenWindowKey('run', { now, runId: 'run-1' })).toBe('run-1');
		expect(T.tokenWindowKey('run', { now })).toBeNull();
		expect(T.nextTokenReset('hour', now)).toBe('2026-10-10T15:00:00.000Z');
		expect(T.nextTokenReset('day', now)).toBe('2026-10-11T00:00:00.000Z');
		expect(T.nextTokenReset('run', now)).toBeNull();
	});
});

describe('the gate at the ceiling', () => {
	async function capped(caps = { daily: 10 }) {
		await T.setTokenBudget({ userId: OWNER, agent: await agentRow(), budget: caps });
		return agentRow();
	}

	it('admits exactly one of two concurrent calls racing for the last token, and pauses the agent once', async () => {
		let agent = await capped({ daily: 10 });
		await T.settleTokenUsage({ agentId: AGENT, inputTokens: 6, outputTokens: 3, reservedTokens: 0 });
		expect(notifications('spend_cap_alert')).toHaveLength(1);
		expect(notifications('spend_cap_alert')[0][2]).toMatchObject({ cap: 'tokens', window: 'day', threshold: 80, limit: 10, used: 9 });

		agent = await agentRow();
		const results = await Promise.allSettled([
			T.assertTokenBudget({ userId: OWNER, agent }),
			T.assertTokenBudget({ userId: OWNER, agent }),
		]);
		const admitted = results.filter((r) => r.status === 'fulfilled');
		const refused = results.filter((r) => r.status === 'rejected');
		expect(admitted).toHaveLength(1);
		expect(refused).toHaveLength(1);
		expect(admitted[0].value.reservation).toEqual({ quantum: 1, windows: [{ window: 'day', key: expect.any(String) }] });
		expect(refused[0].reason).toMatchObject({ status: 429, code: 'token_budget_exhausted' });
		expect(refused[0].reason.detail).toMatchObject({ agent_id: AGENT, window: 'day', limit_tokens: 10, ceiling_tokens: 10, used_tokens: 9 });
		expect(refused[0].reason.detail.recover.extend_once.body).toEqual({ window: 'day', extra_tokens: T.MIN_EXTENSION_TOKENS });

		const [usage] = await db.query('select tokens, reserved from agent_token_usage where agent_id = $1', [AGENT]);
		expect({ tokens: Number(usage.tokens), reserved: Number(usage.reserved) }).toEqual({ tokens: 9, reserved: 1 });

		const paused = await agentRow();
		expect(paused.status).toBe('stopped');
		expect(paused.meta.autopilot.enabled).toBe(false);
		expect(paused.meta.token_budget.paused).toMatchObject({ window: 'day', limit: 10, used: 9, stopped_agent: true });
		expect(notifications('token_budget_paused')).toHaveLength(1);
		const approvals = await db.query("select * from approval_requests where venue = 'token_budget'");
		expect(approvals).toHaveLength(1);
		expect(approvals[0]).toMatchObject({ status: 'pending', action_type: 'token_budget_extend', agent_id: AGENT });
		expect(paused.meta.token_budget.paused.approval_id).toBe(approvals[0].id);
		expect(notifications('token_budget_paused')[0][2]).toMatchObject({ approval_id: approvals[0].id, link: `/spend?agent=${AGENT}` });

		// Every call after the pause is refused as paused, and the winner's
		// settlement at 100 percent does not pause or notify a second time.
		await expect(T.assertTokenBudget({ userId: OWNER, agent: paused })).rejects.toMatchObject({ code: 'token_budget_paused' });
		await T.settleTokenUsage({ agentId: AGENT, inputTokens: 1, outputTokens: 0, reservedTokens: 1 });
		expect(notifications('token_budget_paused')).toHaveLength(1);
		expect(await db.query("select id from approval_requests where venue = 'token_budget'")).toHaveLength(1);
		const [after] = await db.query('select tokens, reserved from agent_token_usage where agent_id = $1', [AGENT]);
		expect({ tokens: Number(after.tokens), reserved: Number(after.reserved) }).toEqual({ tokens: 10, reserved: 0 });
	});

	it('refuses both calls when the window is already full', async () => {
		const agent = await capped({ daily: 10 });
		await T.settleTokenUsage({ agentId: AGENT, inputTokens: 10, outputTokens: 0, reservedTokens: 0 });
		expect(notifications('token_budget_paused')).toHaveLength(1);
		const results = await Promise.allSettled([
			T.assertTokenBudget({ userId: OWNER, agent: await agentRow() }),
			T.assertTokenBudget({ userId: OWNER, agent: await agentRow() }),
		]);
		expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
		expect(results.map((r) => r.reason.code)).toEqual(['token_budget_paused', 'token_budget_paused']);
		expect(notifications('token_budget_paused')).toHaveLength(1);
		expect(agent.id).toBe(AGENT);
	});

	it('hands a reservation back when the call never reached the model', async () => {
		const agent = await capped({ hourly: 5, daily: 10 });
		const { reservation } = await T.assertTokenBudget({ userId: OWNER, agent, expectedTokens: 4 });
		expect(reservation.windows.map((w) => w.window)).toEqual(['hour', 'day']);
		await T.releaseTokenReservation(AGENT, reservation);
		const rows = await db.query('select "window", reserved from agent_token_usage where agent_id = $1 order by "window"', [AGENT]);
		expect(rows.map((r) => Number(r.reserved))).toEqual([0, 0]);
	});

	it('releases the windows it already held when a later window refuses', async () => {
		const agent = await capped({ hourly: 100, daily: 100, per_run: 10 });
		await expect(T.assertTokenBudget({ userId: OWNER, agent, runId: 'run-1', expectedTokens: 20 })).rejects.toMatchObject({ code: 'token_budget_exhausted', detail: { window: 'run', window_key: 'run-1' } });
		const rows = await db.query('select "window", reserved from agent_token_usage where agent_id = $1 order by "window"', [AGENT]);
		expect(rows.map((r) => [r.window, Number(r.reserved)])).toEqual([['day', 0], ['hour', 0]]);
		expect((await agentRow()).meta.token_budget.paused).toMatchObject({ window: 'run', key: 'run-1' });
	});

	it('leaves an agent with no token budget alone', async () => {
		const agent = await agentRow(SECOND);
		expect(await T.assertTokenBudget({ userId: OWNER, agent })).toEqual({ budget: null, reservation: null });
		expect(await T.settleTokenUsage({ agentId: SECOND, inputTokens: 100, outputTokens: 100 })).toBeNull();
		expect(await db.query('select * from agent_token_usage where agent_id = $1', [SECOND])).toHaveLength(0);
	});
});

describe('resume and extend once', () => {
	async function pausedAgent() {
		await T.setTokenBudget({ userId: OWNER, agent: await agentRow(), budget: { daily: 10 } });
		await T.settleTokenUsage({ agentId: AGENT, inputTokens: 10, outputTokens: 0, reservedTokens: 0 });
		const agent = await agentRow();
		expect(agent.status).toBe('stopped');
		expect(agent.meta.token_budget.paused.window).toBe('day');
		return agent;
	}

	it('refuses to resume while the window is still full', async () => {
		const agent = await pausedAgent();
		await expect(T.resumeTokenBudget({ userId: OWNER, agent })).rejects.toMatchObject({ status: 409, code: 'still_capped' });
		expect((await agentRow()).status).toBe('stopped');
	});

	it('extends the ceiling once, resumes the agent, and refuses the second extension', async () => {
		const agent = await pausedAgent();
		const out = await T.extendTokenBudgetOnce({ userId: OWNER, agent, window: 'day' });
		expect(out.status).toBe('executed');
		expect(out.extra_tokens).toBe(T.MIN_EXTENSION_TOKENS);

		const [row] = await db.query('select status, result from approval_requests where id = $1', [out.approval_id]);
		expect(row.status).toBe('executed');
		expect(row.result).toMatchObject({ status: 'ok' });

		const resumed = await agentRow();
		expect(resumed.status).toBe('running');
		expect(resumed.meta.token_budget.paused).toBeUndefined();
		expect(resumed.meta.token_budget.extensions.day).toMatchObject({ extra_tokens: T.MIN_EXTENSION_TOKENS, approval_id: out.approval_id });

		const status = await T.tokenBudgetStatus({ agent: resumed });
		expect(status.windows[0]).toMatchObject({ window: 'day', limit_tokens: 10, extension_tokens: T.MIN_EXTENSION_TOKENS, ceiling_tokens: 10 + T.MIN_EXTENSION_TOKENS, used_tokens: 10, exhausted: false });
		// A window that jumped straight to the ceiling announced only the pause.
		expect(status.windows[0].alerts).toEqual([100]);

		const { reservation } = await T.assertTokenBudget({ userId: OWNER, agent: resumed, expectedTokens: 500 });
		expect(reservation.quantum).toBe(500);

		await expect(T.extendTokenBudgetOnce({ userId: OWNER, agent: await agentRow(), window: 'day' })).rejects.toMatchObject({ status: 409, code: 'already_extended' });
		expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'token_budget_extended', resourceId: AGENT }));
	});

	it('approving the pause-time request from the inbox applies the same extension exactly once', async () => {
		await pausedAgent();
		const [req] = await db.query("select * from approval_requests where venue = 'token_budget'");
		const first = await A.decideApproval({ userId: OWNER, id: req.id, decision: 'approve', payloadHash: req.payload_hash });
		expect(first.request.status).toBe('executed');
		expect((await agentRow()).status).toBe('running');
		expect((await agentRow()).meta.token_budget.extensions.day.extra_tokens).toBe(T.MIN_EXTENSION_TOKENS);

		// The executor is idempotent on its own: the same row applied again is a no-op.
		const again = await T.executeTokenBudgetExtension(req);
		expect(again.status).toBe('skipped');
		expect((await agentRow()).meta.token_budget.extensions.day.extra_tokens).toBe(T.MIN_EXTENSION_TOKENS);
	});

	it('refuses a malformed or oversized extension', async () => {
		const agent = await pausedAgent();
		await expect(T.extendTokenBudgetOnce({ userId: OWNER, agent, window: 'day', extraTokens: 5 })).rejects.toMatchObject({ code: 'invalid_extension' });
		await expect(T.extendTokenBudgetOnce({ userId: OWNER, agent, window: 'hour' })).rejects.toMatchObject({ code: 'no_cap_for_window' });
		expect(await T.executeTokenBudgetExtension({ id: 'x', user_id: OWNER, payload: { window: 'week' } })).toMatchObject({ status: 'error' });
	});

	it('raising the cap lifts the pause, and clearing the caps restarts the agent', async () => {
		const agent = await pausedAgent();
		const raised = await T.setTokenBudget({ userId: OWNER, agent, budget: { daily: 20 } });
		expect(raised.resumed).toBe(true);
		expect(raised.budget.paused).toBeNull();
		expect((await agentRow()).status).toBe('running');

		await T.settleTokenUsage({ agentId: AGENT, inputTokens: 10, outputTokens: 0, reservedTokens: 0 });
		expect((await agentRow()).status).toBe('stopped');
		const cleared = await T.setTokenBudget({ userId: OWNER, agent: await agentRow(), budget: null });
		expect(cleared).toEqual({ budget: null, resumed: true });
		expect((await agentRow()).status).toBe('running');
		expect((await agentRow()).meta.token_budget).toBeUndefined();
	});
});

describe('the 50 and 80 percent marks', () => {
	it('notify once per window each, in order, and never again for the same window', async () => {
		await T.setTokenBudget({ userId: OWNER, agent: await agentRow(), budget: { hourly: 1000, daily: 10_000 } });
		await T.settleTokenUsage({ agentId: AGENT, inputTokens: 400, outputTokens: 100, reservedTokens: 0 });
		expect(notifications('spend_cap_alert')).toHaveLength(1);
		expect(notifications('spend_cap_alert')[0][2]).toMatchObject({ cap: 'tokens', window: 'hour', threshold: 50, pct: 50, limit: 1000, used: 500, unit: 'tokens' });

		await T.settleTokenUsage({ agentId: AGENT, inputTokens: 50, outputTokens: 0, reservedTokens: 0 });
		expect(notifications('spend_cap_alert')).toHaveLength(1);

		await T.settleTokenUsage({ agentId: AGENT, inputTokens: 250, outputTokens: 0, reservedTokens: 0 });
		expect(notifications('spend_cap_alert')).toHaveLength(2);
		expect(notifications('spend_cap_alert')[1][2]).toMatchObject({ window: 'hour', threshold: 80, pct: 80 });

		await T.settleTokenUsage({ agentId: AGENT, inputTokens: 100, outputTokens: 0, reservedTokens: 0 });
		expect(notifications('spend_cap_alert')).toHaveLength(2);
		expect(notifications('token_budget_paused')).toHaveLength(0);

		const status = await T.tokenBudgetStatus({ agent: await agentRow() });
		const hour = status.windows.find((w) => w.window === 'hour');
		expect(hour).toMatchObject({ used_tokens: 900, pct: 90, alerts: [50, 80], exhausted: false });
		const day = status.windows.find((w) => w.window === 'day');
		expect(day).toMatchObject({ used_tokens: 900, pct: 9, alerts: [] });
	});

	it('latches a threshold exactly once and resets when the window key moves', async () => {
		expect(await T.latchSpendAlert({ agentId: AGENT, cap: 'usd:daily', key: '2026-10-10', threshold: 50 })).toBe(true);
		expect(await T.latchSpendAlert({ agentId: AGENT, cap: 'usd:daily', key: '2026-10-10', threshold: 50 })).toBe(false);
		expect(await T.latchSpendAlert({ agentId: AGENT, cap: 'usd:daily', key: '2026-10-10', threshold: 80 })).toBe(true);
		expect(T.alertsFor((await agentRow()).meta, 'usd:daily', '2026-10-10')).toEqual([50, 80]);
		expect(await T.latchSpendAlert({ agentId: AGENT, cap: 'usd:daily', key: '2026-10-11', threshold: 50 })).toBe(true);
		expect(T.alertsFor((await agentRow()).meta, 'usd:daily', '2026-10-11')).toEqual([50]);
		expect(T.alertsFor((await agentRow()).meta, 'usd:daily', '2026-10-10')).toEqual([]);
	});
});

describe('the free-tier body', () => {
	it('carries wait, top up and bring-your-own-key, plus the one-step paid fallback where a surface offers it', () => {
		const resetAt = new Date(Date.now() + 3600_000).toISOString();
		const err = new F.FreeTierExhaustedError({ limit: 20, used: 20, resetAt, model: 'three-ws/agent' });
		expect(err.status).toBe(429);
		const body = F.freeTierErrorBody(err, { signedIn: false, paidFallback: { method: 'POST', path: '/api/brain/chat' } });
		expect(body).toMatchObject({ error: 'free_tier_exhausted', limit: 20, used: 20, reset_at: resetAt, model: 'three-ws/agent' });
		expect(body.retry_after_seconds).toBeGreaterThan(3500);
		expect(body.choices.map((c) => c.action)).toEqual(['wait', 'top_up', 'bring_your_own_key', 'paid_fallback']);
		const [wait, topUp, byok, paid] = body.choices;
		expect(wait).toMatchObject({ reset_at: resetAt });
		expect(topUp).toMatchObject({ catalog: { method: 'GET', path: '/api/credits' }, deposit: { method: 'POST', path: '/api/credits/deposit' }, requires_sign_in: true });
		expect(byok).toMatchObject({ set_key: { method: 'PATCH', path: '/api/user/provider-keys' }, requires_sign_in: true });
		expect(byok.url).toMatch(/\/docs\/inference-billing#bring-your-own-key$/);
		expect(paid).toEqual({
			action: 'paid_fallback',
			description: expect.any(String),
			method: 'POST',
			path: '/api/brain/chat',
			body_patch: { paid_fallback: true },
			bills: 'credits',
			requires_sign_in: true,
		});

		const plain = F.freeTierErrorBody(err, { signedIn: true });
		expect(plain.choices.map((c) => c.action)).toEqual(['wait', 'top_up', 'bring_your_own_key']);
		expect(plain.choices[1].requires_sign_in).toBe(false);
	});
});
