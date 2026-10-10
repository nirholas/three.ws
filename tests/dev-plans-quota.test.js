// Quota enforcement at the edges: the call that lands exactly on the limit,
// the one after it, concurrent calls against the concurrency ceiling, and a
// period that rolls over under a fake clock. The real gate runs with the real
// plan config, the real burst limiter (in memory, no Redis) and an in-memory
// counter store; only the subscription table is faked.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.PUBLIC_APP_ORIGIN = 'https://three.ws';

const USER = '9a8b7c6d-0000-4000-8000-0000000000cc';
let subRow = null;
const debits = [];

function row(overrides = {}) {
	const start = new Date('2026-10-01T00:00:00Z');
	return {
		user_id: USER,
		plan_id: 'free',
		period_start: start.toISOString(),
		period_end: new Date(start.getTime() + 30 * 86_400_000).toISOString(),
		scheduled_plan_id: null,
		renew_with: null,
		paid_usd: 0,
		...overrides,
	};
}

vi.mock('../api/_lib/db.js', () => {
	const sql = (strings, ...values) => {
		const text = Array.isArray(strings) ? strings.join('?') : String(strings);
		if (/select \* from dev_plan_subscriptions/.test(text)) return Promise.resolve(subRow ? [subRow] : []);
		if (/insert into dev_plan_subscriptions \(user_id\) values/.test(text)) {
			subRow = subRow || row();
			return Promise.resolve([subRow]);
		}
		if (/update dev_plan_subscriptions/.test(text)) {
			// values: planId, periodStart, periodEnd, renewWith, paidUsd, userId, oldPeriodEnd
			const [planId, periodStart, periodEnd, renewWith, paidUsd, , oldEnd] = values;
			if (subRow.period_end !== oldEnd) return Promise.resolve([]);
			subRow = { ...subRow, plan_id: planId, period_start: periodStart, period_end: periodEnd, scheduled_plan_id: null, renew_with: renewWith, paid_usd: paidUsd };
			return Promise.resolve([subRow]);
		}
		return Promise.resolve([]);
	};
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false, isStoragePressured: () => false };
});
vi.mock('../api/_lib/redis.js', () => ({ getRedis: () => null }));
vi.mock('../api/_lib/credits.js', () => ({
	debitCredits: vi.fn(async (args) => {
		debits.push(args);
		if (args.meta?.plan === 'scale') throw Object.assign(new Error('no'), { status: 402, code: 'insufficient_credits', available_usd: 0 });
		return { ledgerId: 'ledger-1', balanceUsd: 100 };
	}),
}));
vi.mock('../api/_lib/notify.js', () => ({ insertNotification: vi.fn(async () => ({ id: null })) }));
vi.mock('../api/_lib/usage.js', () => ({ recordEvent: vi.fn(), logger: () => ({ info() {}, warn() {}, error() {} }) }));

const { devPlanById, DEV_PLAN_PERIOD_MS } = await import('../api/_lib/dev-plans/config.js');
const { planRollover, getDevSubscription, resetDevSubscriptionCache } = await import('../api/_lib/dev-plans/subscription.js');
const { devPlanGate, consumeDevQuota, createMemoryQuotaStore, setDevQuotaStore, resetDevPlanState, acquireDevSlot } = await import('../api/_lib/dev-plans/quota.js');

function fakeRes() {
	const headers = {};
	return {
		statusCode: 200,
		body: null,
		headersSent: false,
		writableEnded: false,
		setHeader(k, v) { headers[k.toLowerCase()] = String(v); },
		getHeader(k) { return headers[k.toLowerCase()]; },
		headers,
		writeHead(status, h) { this.statusCode = status; Object.assign(headers, Object.fromEntries(Object.entries(h || {}).map(([k, v]) => [k.toLowerCase(), String(v)]))); },
		end(chunk) { this.body = chunk ? JSON.parse(String(chunk)) : null; this.writableEnded = true; },
	};
}

const FREE = devPlanById('free');

beforeEach(() => {
	subRow = row();
	debits.length = 0;
	resetDevSubscriptionCache();
	resetDevPlanState();
	setDevQuotaStore(createMemoryQuotaStore());
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-10-10T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('monthly quota', () => {
	it('allows the call that lands exactly on the limit and refuses the next one with a 402', async () => {
		const sub = await getDevSubscription(USER);
		for (let i = 0; i < FREE.includedCalls - 1; i++) {
			const q = await consumeDevQuota(sub);
			expect(q.allowed).toBe(true);
		}
		const res = fakeRes();
		const gate = await devPlanGate({ userId: USER, res });
		expect(gate.ok).toBe(true);
		expect(res.headers['x-quota-used']).toBe(String(FREE.includedCalls));
		expect(res.headers['x-quota-remaining']).toBe('0');
		expect(res.headers['x-plan']).toBe('free');
		expect(res.headers['x-ratelimit-limit']).toBe(String(FREE.burstPerMinute));
		gate.release();

		const over = fakeRes();
		const refused = await devPlanGate({ userId: USER, res: over });
		expect(refused.ok).toBe(false);
		expect(over.statusCode).toBe(402);
		expect(over.body).toMatchObject({ error: 'quota_exceeded', plan: 'free', limit: FREE.includedCalls, used: FREE.includedCalls, upgrade_url: '/developers', manage_url: '/dashboard/developers#plan' });
		expect(over.body.next_plan).toMatchObject({ id: 'builder' });
		expect(over.body.reset_at).toBe(sub.periodEnd.toISOString());
		// The refused call was not counted.
		expect(over.headers['x-quota-used']).toBe(String(FREE.includedCalls));
	});

	it('does not spend quota for a signed-in owner browsing the dashboard', async () => {
		const res = fakeRes();
		const gate = await devPlanGate({ userId: USER, res, countsAgainstQuota: false });
		expect(gate.ok).toBe(true);
		expect(res.headers['x-quota-used']).toBe('0');
		gate.release();
	});
});

describe('concurrency', () => {
	it('holds the plan ceiling for calls in flight and frees a slot on release', async () => {
		const open = [];
		for (let i = 0; i < FREE.concurrent; i++) {
			const res = fakeRes();
			const gate = await devPlanGate({ userId: USER, res });
			expect(gate.ok).toBe(true);
			open.push(gate);
		}
		const res = fakeRes();
		const refused = await devPlanGate({ userId: USER, res });
		expect(refused.ok).toBe(false);
		expect(res.statusCode).toBe(429);
		expect(res.headers['retry-after']).toBe('1');
		expect(res.body).toMatchObject({ error: 'concurrency_limited', concurrent_limit: FREE.concurrent });
		open[0].release();
		open[0].release();
		const again = await devPlanGate({ userId: USER, res: fakeRes() });
		expect(again.ok).toBe(true);
		expect(acquireDevSlot(USER, FREE.concurrent)).toBeNull();
	});

	it("races: only the ceiling's worth of simultaneous calls get through", async () => {
		const results = await Promise.all(Array.from({ length: FREE.concurrent * 3 }, () => devPlanGate({ userId: USER, res: fakeRes() })));
		expect(results.filter((r) => r.ok).length).toBe(FREE.concurrent);
	});
});

describe('burst', () => {
	it("returns 429 with Retry-After past the plan's per-minute ceiling", async () => {
		let last = null;
		for (let i = 0; i < FREE.burstPerMinute + 1; i++) {
			const res = fakeRes();
			const gate = await devPlanGate({ userId: USER, res });
			gate.release?.();
			last = { gate, res };
		}
		expect(last.gate.ok).toBe(false);
		expect(last.res.statusCode).toBe(429);
		expect(last.res.body).toMatchObject({ error: 'rate_limited', plan: 'free', upgrade_url: '/developers' });
		expect(Number(last.res.headers['retry-after'])).toBeGreaterThanOrEqual(1);
		expect(last.res.headers['x-ratelimit-remaining']).toBe('0');
	});
});

describe('period rollover', () => {
	it('starts a fresh counter when the period ends', async () => {
		const sub = await getDevSubscription(USER);
		for (let i = 0; i < 5; i++) await consumeDevQuota(sub);
		vi.setSystemTime(new Date(sub.periodEnd.getTime() + 60_000));
		const res = fakeRes();
		const gate = await devPlanGate({ userId: USER, res });
		expect(gate.ok).toBe(true);
		expect(gate.sub.periodStart.toISOString()).toBe(sub.periodEnd.toISOString());
		expect(res.headers['x-quota-used']).toBe('1');
		gate.release();
	});

	it('keeps free periods aligned when the account was dormant for several periods', () => {
		const sub = { planId: 'free', plan: FREE, periodStart: new Date('2026-01-01T00:00:00Z'), periodEnd: new Date('2026-01-31T00:00:00Z'), scheduledPlanId: null, renewWith: null };
		const next = planRollover(sub, new Date('2026-05-15T00:00:00Z'));
		expect(next.changed).toBe(true);
		expect(next.planId).toBe('free');
		expect((next.periodStart.getTime() - sub.periodEnd.getTime()) % DEV_PLAN_PERIOD_MS).toBe(0);
		expect(next.periodStart.getTime()).toBeLessThanOrEqual(Date.parse('2026-05-15T00:00:00Z'));
		expect(next.periodEnd.getTime()).toBeGreaterThan(Date.parse('2026-05-15T00:00:00Z'));
	});

	it('renews a credits-paid plan from the balance and lapses a wallet-paid one to free', async () => {
		const start = new Date('2026-09-01T00:00:00Z');
		const end = new Date(start.getTime() + DEV_PLAN_PERIOD_MS);
		const base = { userId: USER, planId: 'builder', plan: devPlanById('builder'), periodStart: start, periodEnd: end, scheduledPlanId: null };
		expect(planRollover({ ...base, renewWith: 'credits' }, new Date(end.getTime() + 1))).toMatchObject({ planId: 'builder', needsPayment: true, lapses: false });
		expect(planRollover({ ...base, renewWith: 'USDC' }, new Date(end.getTime() + 1))).toMatchObject({ planId: 'free', needsPayment: false, lapses: true });
		expect(planRollover({ ...base, renewWith: 'credits', scheduledPlanId: 'free' }, new Date(end.getTime() + 1))).toMatchObject({ planId: 'free', needsPayment: false });

		subRow = row({ plan_id: 'builder', period_start: start.toISOString(), period_end: end.toISOString(), renew_with: 'credits', paid_usd: 29 });
		const sub = await getDevSubscription(USER);
		expect(sub.planId).toBe('builder');
		expect(sub.periodStart.toISOString()).toBe(end.toISOString());
		expect(debits[0]).toMatchObject({ userId: USER, amountUsd: 29, idempotencyKey: `devplan:renew:${USER}:${end.toISOString()}` });
	});

	it('falls to free when the renewal cannot be paid', async () => {
		const start = new Date('2026-09-01T00:00:00Z');
		const end = new Date(start.getTime() + DEV_PLAN_PERIOD_MS);
		subRow = row({ plan_id: 'scale', period_start: start.toISOString(), period_end: end.toISOString(), renew_with: 'credits', paid_usd: 199 });
		const sub = await getDevSubscription(USER);
		expect(sub.planId).toBe('free');
		expect(sub.renewWith).toBeNull();
	});
});
