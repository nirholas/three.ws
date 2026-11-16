// Self-service for Microsoft-billed customers (api/_lib/microsoft-billing.js):
// the billing period and usage meters, the seat entitlement rule, the
// over-allocation rule after a ChangeQuantity down, and the two endpoints
// /dashboard/billing calls. The seat rules and endpoints run for real against
// an in-process Postgres (PGlite) carrying the real Marketplace migrations;
// Microsoft's Fulfillment API is a stubbed fetch that answers as its host does.

import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { createPgliteSql } from './_helpers/pglite-sql.js';

const holder = vi.hoisted(() => ({ db: null, user: null, csrfOk: true, notifications: [] }));

vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});
vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: async () => holder.user,
	createSession: async () => 'session',
	sessionCookie: () => 'sid=session',
	authenticateBearer: async () => null,
	extractBearer: () => null,
}));
vi.mock('../api/_lib/csrf.js', () => ({
	requireCsrf: async (req, res) => {
		if (holder.csrfOk) return true;
		res.statusCode = 403;
		res.end(JSON.stringify({ error: 'csrf_invalid' }));
		return false;
	},
}));
vi.mock('../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	const ok = async () => ({ success: true, limit: 100, remaining: 99, reset: Date.now() + 60_000 });
	return { ...actual, limits: new Proxy({}, { get: () => ok }), clientIp: () => '127.0.0.1' };
});
vi.mock('../api/_lib/notify.js', () => ({
	insertNotification: async (userId, type, payload) => {
		holder.notifications.push({ userId, type, payload });
		return { id: holder.notifications.length };
	},
}));
vi.mock('../api/_lib/audit.js', () => ({ logAudit: () => {} }));

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';

import {
	billingPeriod, aggregateUsage, includedFor, seatsToRevoke, maskEmail, statusInfo, planDisplayName,
	MANAGE_LINKS, REFRESH_AFTER_MS,
} from '../api/_lib/microsoft-billing.js';
import { DIMENSIONS, isSeatBased, grantsMicrosoftPlan } from '../api/_lib/microsoft-marketplace.js';
import { categoryForType, lockedChannelsFor } from '../api/_lib/notify-prefs.js';

const MARKETPLACE_CONFIG = JSON.parse(readFileSync('data/microsoft-marketplace.json', 'utf8'));
const PLANS = JSON.parse(readFileSync('data/plans.json', 'utf8'));

// ── Billing period ──────────────────────────────────────────────────────────

describe('billingPeriod', () => {
	it('is the monthly window anchored on the term start that contains now', () => {
		const p = billingPeriod({ termStart: '2026-01-15T00:00:00Z', termEnd: '2027-01-15T00:00:00Z', now: new Date('2026-11-16T09:00:00Z') });
		expect(p).toEqual({ start: new Date('2026-11-15T00:00:00Z'), end: new Date('2026-12-15T00:00:00Z'), anchored: true });
	});

	it('steps back a month when now falls before this month\'s anchor day', () => {
		const p = billingPeriod({ termStart: '2026-01-20T00:00:00Z', termEnd: '2027-01-20T00:00:00Z', now: new Date('2026-11-16T09:00:00Z') });
		expect(p.start).toEqual(new Date('2026-10-20T00:00:00Z'));
		expect(p.end).toEqual(new Date('2026-11-20T00:00:00Z'));
	});

	it('clamps a 31st anchor to the last day of a short month without drifting', () => {
		const p = billingPeriod({ termStart: '2026-01-31T00:00:00Z', termEnd: '2027-01-31T00:00:00Z', now: new Date('2026-02-28T12:00:00Z') });
		expect(p.start).toEqual(new Date('2026-02-28T00:00:00Z'));
		expect(p.end).toEqual(new Date('2026-03-31T00:00:00Z'));
	});

	it('ends the last period at term end and holds it after the term is over', () => {
		const monthly = { termStart: '2026-11-01T00:00:00Z', termEnd: '2026-11-30T23:59:59Z' };
		expect(billingPeriod({ ...monthly, now: new Date('2026-11-16T00:00:00Z') }).end).toEqual(new Date('2026-11-30T23:59:59Z'));
		const after = billingPeriod({ ...monthly, now: new Date('2027-03-01T00:00:00Z') });
		expect(after.start).toEqual(new Date('2026-11-01T00:00:00Z'));
		expect(after.end).toEqual(new Date('2026-11-30T23:59:59Z'));
	});

	it('uses the first period before the term starts and the UTC calendar month with no term', () => {
		expect(billingPeriod({ termStart: '2026-12-01T00:00:00Z', termEnd: '2027-12-01T00:00:00Z', now: new Date('2026-11-16T00:00:00Z') }).start)
			.toEqual(new Date('2026-12-01T00:00:00Z'));
		expect(billingPeriod({ termStart: null, termEnd: null, now: new Date('2026-11-16T10:00:00Z') }))
			.toEqual({ start: new Date('2026-11-01T00:00:00Z'), end: new Date('2026-12-01T00:00:00Z'), anchored: false });
	});
});

// ── Usage aggregation ───────────────────────────────────────────────────────

describe('aggregateUsage', () => {
	it('sums each dimension by status and measures billable usage against the plan\'s included quantity', () => {
		const rows = [
			{ dimension: 'mcp_tool_calls', status: 'accepted', quantity: '1000.000000' },
			{ dimension: 'mcp_tool_calls', status: 'accepted', quantity: '500' },
			{ dimension: 'mcp_tool_calls', status: 'pending', quantity: '250' },
			{ dimension: 'mcp_tool_calls', status: 'rejected', quantity: '40' },
			{ dimension: 'agent_messages', status: 'expired', quantity: '7' },
			{ dimension: 'agent_messages', status: 'accepted', quantity: '3000' },
		];
		const meters = aggregateUsage(rows, 'pro');
		expect(meters.map((m) => m.id)).toEqual(DIMENSIONS.map((d) => d.id));
		const mcp = meters.find((m) => m.id === 'mcp_tool_calls');
		expect(mcp).toMatchObject({ accepted: 1500, pending: 250, rejected: 40, expired: 0, billable: 1750, included: 1_500_000, over_included: false });
		expect(mcp.percent).toBe(0.1);
		const msgs = meters.find((m) => m.id === 'agent_messages');
		expect(msgs).toMatchObject({ accepted: 3000, expired: 7, billable: 3000, included: 30_000, percent: 10 });
	});

	it('flags usage past the included quantity and caps the meter at 100 percent', () => {
		const meters = aggregateUsage([{ dimension: 'agent_messages', status: 'accepted', quantity: 45_000 }], 'pro');
		expect(meters.find((m) => m.id === 'agent_messages')).toMatchObject({ billable: 45_000, over_included: true, percent: 100 });
	});

	it('ignores dimensions the offer does not declare and statuses the table does not use', () => {
		const meters = aggregateUsage([
			{ dimension: 'gpu_minutes', status: 'accepted', quantity: 9 },
			{ dimension: 'mcp_tool_calls', status: 'mystery', quantity: 9 },
			{ dimension: 'mcp_tool_calls', status: 'accepted', quantity: -4 },
		], 'team');
		expect(meters.every((m) => m.billable === 0)).toBe(true);
	});

	it('has no ceiling for a plan without included quantities', () => {
		const meters = aggregateUsage([{ dimension: 'mcp_tool_calls', status: 'pending', quantity: 5 }], 'legacy-gold');
		expect(meters[0]).toMatchObject({ billable: 5, included: null, percent: null, over_included: false });
	});

	it('keeps every included quantity equal to the plan\'s daily limit times the billing period (no drift from plans.json)', () => {
		const days = PLANS.billing_period_days;
		for (const pcPlan of Object.keys(MARKETPLACE_CONFIG.plans)) {
			const limitsOf = PLANS.plans.find((p) => p.id === MARKETPLACE_CONFIG.plans[pcPlan]).limits;
			expect(includedFor(pcPlan, 'mcp_tool_calls')).toBe(limitsOf.mcp_calls_per_day * days);
			expect(includedFor(pcPlan, 'agent_messages')).toBe(limitsOf.free_model_messages_per_day * days);
		}
	});
});

describe('display rules', () => {
	it('names plans as three.ws does and explains every Microsoft status in plain language', () => {
		expect(planDisplayName('team')).toBe('Team');
		expect(planDisplayName('legacy-gold')).toBe('legacy-gold');
		expect(statusInfo('Subscribed')).toMatchObject({ label: 'Active', tone: 'ok' });
		expect(statusInfo('Suspended').explanation).toMatch(/keep working/);
		expect(statusInfo('Unsubscribed').explanation).toMatch(/cannot reactivate/);
		expect(statusInfo('PendingFulfillmentStart').label).toBe('Waiting for activation');
	});

	it('masks the local part of an address and keeps the organization domain', () => {
		expect(maskEmail('buyer@contoso.example')).toBe('b***r@contoso.example');
		expect(maskEmail('jo@contoso.example')).toBe('j***@contoso.example');
		expect(maskEmail(null)).toBe(null);
	});

	it('links to the Microsoft management surfaces named in Microsoft\'s SaaS lifecycle guide', () => {
		expect(MANAGE_LINKS.map((l) => l.url)).toEqual([
			'https://admin.microsoft.com/Adminportal/Home?#/subscriptions',
			'https://portal.azure.com/#home',
		]);
	});

	it('delivers seat notices in-app no matter how the bell is set', () => {
		expect(lockedChannelsFor(categoryForType('microsoft_seat'))).toContain('in_app');
	});
});

// ── Seat entitlement rule (pure) ────────────────────────────────────────────

const OWNER = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';
const MEMBER2 = '33333333-3333-4333-8333-333333333333';
const OUTSIDER = '44444444-4444-4444-8444-444444444444';
const TEAM = '55555555-5555-4555-8555-555555555555';
const SUB = 'a1b2c3d4-0000-4000-8000-0000000000aa';

describe('seat entitlement rule', () => {
	it('treats a positive quantity as a per-user plan and null or 0 as flat rate', () => {
		expect(isSeatBased({ quantity: 5 })).toBe(true);
		expect(isSeatBased({ quantity: null })).toBe(false);
		expect(isSeatBased({ quantity: 0 })).toBe(false);
	});

	it('grants a per-user plan only to a seat holder, owner included', () => {
		const sub = { plan_id: 'pro', saas_status: 'Subscribed', quantity: 3, user_id: OWNER };
		expect(grantsMicrosoftPlan({ ...sub, holds_seat: true }, MEMBER)).toBe(true);
		expect(grantsMicrosoftPlan({ ...sub, holds_seat: false }, OWNER)).toBe(false);
		expect(grantsMicrosoftPlan({ ...sub, holds_seat: false }, MEMBER)).toBe(false);
	});

	it('grants a flat-rate plan to its owner without seats, and nothing while not Subscribed', () => {
		const flat = { plan_id: 'pro', saas_status: 'Subscribed', quantity: null, user_id: OWNER, holds_seat: false };
		expect(grantsMicrosoftPlan(flat, OWNER)).toBe(true);
		expect(grantsMicrosoftPlan(flat, MEMBER)).toBe(false);
		expect(grantsMicrosoftPlan({ ...flat, saas_status: 'Suspended' }, OWNER)).toBe(false);
		expect(grantsMicrosoftPlan({ ...flat, quantity: 3, holds_seat: true, saas_status: 'Unsubscribed' }, OWNER)).toBe(false);
		expect(grantsMicrosoftPlan({ ...flat, plan_id: 'legacy-gold' }, OWNER)).toBe(false);
	});
});

// ── Over-allocation rule (pure) ─────────────────────────────────────────────

describe('seatsToRevoke', () => {
	const seats = [
		{ user_id: OWNER, assigned_at: '2026-11-01T00:00:00Z' },
		{ user_id: MEMBER, assigned_at: '2026-11-03T00:00:00Z' },
		{ user_id: MEMBER2, assigned_at: '2026-11-05T00:00:00Z' },
	];

	it('takes back the most recently assigned seats first', () => {
		expect(seatsToRevoke(seats, 1).map((s) => s.user_id)).toEqual([MEMBER2, MEMBER]);
		expect(seatsToRevoke(seats, 2).map((s) => s.user_id)).toEqual([MEMBER2]);
	});

	it('takes nothing when the quantity still covers every seat', () => {
		expect(seatsToRevoke(seats, 3)).toEqual([]);
		expect(seatsToRevoke(seats, 10)).toEqual([]);
	});

	it('breaks a tie on assignment time by user id, independent of row order', () => {
		const tied = [
			{ user_id: MEMBER, assigned_at: '2026-11-03T00:00:00Z' },
			{ user_id: MEMBER2, assigned_at: '2026-11-03T00:00:00Z' },
		];
		expect(seatsToRevoke(tied, 1)).toEqual(seatsToRevoke([...tied].reverse(), 1));
		expect(seatsToRevoke(tied, 1)[0].user_id).toBe(MEMBER2);
	});
});

// ── Against a real Postgres ─────────────────────────────────────────────────

const MIGRATIONS = [
	'api/_lib/migrations/20261104180000_microsoft_marketplace_saas.sql',
	'api/_lib/migrations/20261116151500_microsoft_saas_seats.sql',
].map((p) => readFileSync(p, 'utf8'));

const BASE_TABLES = `
create table users (id uuid primary key default gen_random_uuid(), email text, display_name text,
  plan text not null default 'free', email_verified boolean default false, deleted_at timestamptz);
create table user_identities (id uuid primary key default gen_random_uuid(), user_id uuid, provider text not null,
  subject text, constraint user_identities_provider_check check (provider in ('google')));
create table subscriptions (user_id uuid, plan text, status text, active_until timestamptz);
create table teams (id uuid primary key default gen_random_uuid(), owner_user_id uuid not null references users(id),
  name text not null, archived_at timestamptz);
create table team_people (id uuid primary key default gen_random_uuid(), team_id uuid not null references teams(id),
  user_id uuid references users(id), status text not null default 'active', source text not null default 'tenant_join',
  display_name text, email text, scim_deleted_at timestamptz);`;

const TENANT = '72f988bf-86f1-41af-91ab-2d7cd011db47';
const CLIENT = '0b8d3f4e-1111-4c3a-9a77-5f0d2c1e9a01';
const PUBLISHER_ENV = { MS_MARKETPLACE_TENANT_ID: TENANT, MS_MARKETPLACE_CLIENT_ID: CLIENT, MS_MARKETPLACE_CLIENT_SECRET: 'publisher-secret' };
const ENV_KEYS = [...Object.keys(PUBLISHER_ENV), 'MS_MARKETPLACE_API_BASE', 'MS_MARKETPLACE_METERING_BASE', 'MS_MARKETPLACE_TOKEN_URL', 'MS_MARKETPLACE_EMULATOR'];

async function seedWorld({ quantity = 3, planId = 'team' } = {}) {
	holder.db = createPgliteSql();
	await holder.db.exec(BASE_TABLES);
	for (const m of MIGRATIONS) await holder.db.exec(m);
	await holder.db.sql`insert into users (id, email, display_name) values
		(${OWNER}, 'it-admin@contoso.example', 'Ada Owner'),
		(${MEMBER}, 'grace@contoso.example', 'Grace Member'),
		(${MEMBER2}, 'linus@contoso.example', 'Linus Member'),
		(${OUTSIDER}, 'eve@fabrikam.example', 'Eve Outsider')`;
	await holder.db.sql`insert into teams (id, owner_user_id, name) values (${TEAM}, ${OWNER}, 'Contoso Studio')`;
	await holder.db.sql`insert into team_people (team_id, user_id, display_name, email) values
		(${TEAM}, ${MEMBER}, 'Grace Member', 'grace@contoso.example'),
		(${TEAM}, ${MEMBER2}, 'Linus Member', 'linus@contoso.example')`;
	await holder.db.sql`insert into microsoft_saas_subscriptions
		(id, user_id, name, offer_id, plan_id, quantity, saas_status, purchaser_email, beneficiary_email,
		 beneficiary_tenant_id, term_start, term_end, auto_renew, activated_at, team_id, refreshed_at)
		values (${SUB}, ${OWNER}, 'Contoso three.ws', 'three-ws', ${planId}, ${quantity}, 'Subscribed',
		 'procurement@contoso.example', 'it-admin@contoso.example', ${TENANT},
		 '2026-11-01T00:00:00Z', '2027-11-01T00:00:00Z', true, '2026-11-01T00:00:00Z', ${TEAM}, now())`;
}

const plans = async () => Object.fromEntries((await holder.db.sql`select id, plan from users`).map((r) => [r.id, r.plan]));
const seatHolders = async () => (await holder.db.sql`select user_id from microsoft_saas_seats where subscription_id = ${SUB} order by assigned_at`).map((r) => r.user_id);

function captureFetch(answer) {
	const calls = [];
	vi.stubGlobal('fetch', async (url, init = {}) => {
		const call = { url: String(url), method: (init.method || 'GET').toUpperCase() };
		calls.push(call);
		const out = await answer(call);
		return new Response(out.body == null ? '' : JSON.stringify(out.body), { status: out.status ?? 200, headers: { 'content-type': 'application/json' } });
	});
	return calls;
}

async function call(path, { method = 'GET', body = null } = {}) {
	const { default: handler } = await import('../api/microsoft-marketplace/[action].js');
	const raw = body ? Buffer.from(JSON.stringify(body)) : null;
	const req = Object.assign(raw ? Readable.from([raw]) : Readable.from([]), {
		method,
		url: path,
		headers: { 'content-type': 'application/json', origin: 'http://localhost:3128' },
		rawBody: raw,
		socket: { remoteAddress: '127.0.0.1' },
	});
	const out = { body: '', headers: {} };
	const res = {
		statusCode: 200,
		headersSent: false,
		setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
		getHeader(k) { return out.headers[k.toLowerCase()]; },
		removeHeader(k) { delete out.headers[k.toLowerCase()]; },
		writeHead(code, h) { this.statusCode = code; if (h) for (const [k, v] of Object.entries(h)) this.setHeader(k, v); return this; },
		write(chunk) { out.body += chunk; return true; },
		end(chunk) { if (chunk) out.body += chunk; this.headersSent = true; this.writableEnded = true; },
		on() { return this; }, once() { return this; },
	};
	await handler(req, res);
	let json = null;
	try { json = JSON.parse(out.body); } catch { json = null; }
	return { status: res.statusCode, json, headers: out.headers };
}

describe('seats against Postgres', () => {
	let saved;
	beforeEach(async () => {
		saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
		for (const k of ENV_KEYS) delete process.env[k];
		holder.notifications = [];
		holder.csrfOk = true;
		await seedWorld();
		holder.user = { id: OWNER, email: 'it-admin@contoso.example' };
	});
	afterEach(() => {
		for (const [k, v] of Object.entries(saved)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
		vi.unstubAllGlobals();
	});

	it('backfills the owner\'s seat for a per-user subscription linked before seats existed', async () => {
		holder.db = createPgliteSql();
		await holder.db.exec(BASE_TABLES);
		await holder.db.exec(MIGRATIONS[0]);
		await holder.db.sql`insert into users (id, email) values (${OWNER}, 'it-admin@contoso.example')`;
		await holder.db.sql`insert into microsoft_saas_subscriptions (id, user_id, plan_id, quantity, saas_status) values (${SUB}, ${OWNER}, 'pro', 5, 'Subscribed')`;
		await holder.db.exec(MIGRATIONS[1]);
		expect(await seatHolders()).toEqual([OWNER]);
		const mm = await import('../api/_lib/microsoft-marketplace.js');
		expect(await mm.recomputeUserPlan(OWNER)).toBe('pro');
	});

	it('changes the computed plan when a seat is assigned and when it is taken back', async () => {
		const mm = await import('../api/_lib/microsoft-marketplace.js');
		const mb = await import('../api/_lib/microsoft-billing.js');
		expect(await mb.ensureOwnerSeat(SUB)).toBe(true);
		await mm.recomputeUserPlan(OWNER);
		await mm.recomputeUserPlan(MEMBER);
		const before = await plans();
		const assigned = await mb.assignSeat(OWNER, SUB, MEMBER);
		const during = await plans();
		await mb.unassignSeat(OWNER, SUB, MEMBER);
		const after = await plans();
		console.log('[seat entitlement] Grace before assign:', before[MEMBER], '| after assign:', during[MEMBER], '| after unassign:', after[MEMBER]);
		expect(before).toMatchObject({ [OWNER]: 'team', [MEMBER]: 'free' });
		expect(assigned).toEqual({ changed: true, plan: 'team' });
		expect(during[MEMBER]).toBe('team');
		expect(after[MEMBER]).toBe('free');
		expect(holder.notifications.map((n) => [n.userId, n.type, n.payload.action])).toEqual([
			[MEMBER, 'microsoft_seat', 'assigned'],
			[MEMBER, 'microsoft_seat', 'removed'],
		]);
	});

	it('never grants the plan to a seat holder who left the linked team, and never to the owner without a seat', async () => {
		const mm = await import('../api/_lib/microsoft-marketplace.js');
		const mb = await import('../api/_lib/microsoft-billing.js');
		await mb.assignSeat(OWNER, SUB, MEMBER);
		await holder.db.sql`update team_people set status = 'deactivated' where user_id = ${MEMBER}`;
		expect(await mm.recomputeUserPlan(MEMBER)).toBe('free');
		expect(await mm.recomputeUserPlan(OWNER)).toBe('free');
		await mb.releaseTeamSeat(TEAM, MEMBER);
		expect(await seatHolders()).toEqual([]);
	});

	it('refuses a seat beyond the purchased quantity, to an outsider, and on a flat-rate plan', async () => {
		const mb = await import('../api/_lib/microsoft-billing.js');
		await holder.db.sql`update microsoft_saas_subscriptions set quantity = 2 where id = ${SUB}`;
		await mb.assignSeat(OWNER, SUB, OWNER);
		await mb.assignSeat(OWNER, SUB, MEMBER);
		await expect(mb.assignSeat(OWNER, SUB, MEMBER2)).rejects.toMatchObject({ code: 'no_seats_left', status: 409 });
		await expect(mb.assignSeat(OWNER, SUB, OUTSIDER)).rejects.toMatchObject({ code: 'not_eligible' });
		await expect(mb.assignSeat(MEMBER, SUB, MEMBER2)).rejects.toMatchObject({ code: 'not_found', status: 404 });
		await holder.db.sql`update microsoft_saas_subscriptions set quantity = null where id = ${SUB}`;
		await expect(mb.assignSeat(OWNER, SUB, MEMBER2)).rejects.toMatchObject({ code: 'flat_rate' });
	});

	it('after a ChangeQuantity down frees the most recently assigned seats and tells each person in-app', async () => {
		const mm = await import('../api/_lib/microsoft-marketplace.js');
		const mb = await import('../api/_lib/microsoft-billing.js');
		await holder.db.sql`insert into microsoft_saas_seats (subscription_id, user_id, assigned_by, assigned_at) values
			(${SUB}, ${OWNER}, ${OWNER}, '2026-11-01T00:00:00Z'),
			(${SUB}, ${MEMBER}, ${OWNER}, '2026-11-03T00:00:00Z'),
			(${SUB}, ${MEMBER2}, ${OWNER}, '2026-11-05T00:00:00Z')`;
		for (const id of [OWNER, MEMBER, MEMBER2]) await mm.recomputeUserPlan(id);
		expect(await plans()).toMatchObject({ [OWNER]: 'team', [MEMBER]: 'team', [MEMBER2]: 'team' });

		await holder.db.sql`update microsoft_saas_subscriptions set quantity = 2 where id = ${SUB}`;
		expect(await mb.reconcileSeats(SUB)).toEqual([MEMBER2]);
		expect(await seatHolders()).toEqual([OWNER, MEMBER]);
		expect(await plans()).toMatchObject({ [OWNER]: 'team', [MEMBER]: 'team', [MEMBER2]: 'free' });
		expect(holder.notifications).toHaveLength(1);
		expect(holder.notifications[0]).toMatchObject({ userId: MEMBER2, type: 'microsoft_seat', payload: { action: 'removed', link: '/dashboard/billing#bl-microsoft' } });
		expect(holder.notifications[0].payload.summary).toMatch(/reduced the seats/);
	});

	it('frees every seat when the subscription moves to a flat-rate plan, keeping the owner entitled', async () => {
		const mm = await import('../api/_lib/microsoft-marketplace.js');
		const mb = await import('../api/_lib/microsoft-billing.js');
		await mb.assignSeat(OWNER, SUB, OWNER);
		await mb.assignSeat(OWNER, SUB, MEMBER);
		await holder.db.sql`update microsoft_saas_subscriptions set quantity = null where id = ${SUB}`;
		expect((await mb.reconcileSeats(SUB)).sort()).toEqual([OWNER, MEMBER].sort());
		expect(await mm.recomputeUserPlan(OWNER)).toBe('team');
		expect(await mm.recomputeUserPlan(MEMBER)).toBe('free');
	});

	it('runs ChangeQuantity down end to end through the connection webhook', async () => {
		const mb = await import('../api/_lib/microsoft-billing.js');
		const mm = await import('../api/_lib/microsoft-marketplace.js');
		process.env.MS_MARKETPLACE_EMULATOR = '1';
		Object.assign(process.env, PUBLISHER_ENV);
		await holder.db.sql`insert into microsoft_saas_seats (subscription_id, user_id, assigned_by, assigned_at) values
			(${SUB}, ${OWNER}, ${OWNER}, '2026-11-01T00:00:00Z'),
			(${SUB}, ${MEMBER}, ${OWNER}, '2026-11-03T00:00:00Z'),
			(${SUB}, ${MEMBER2}, ${OWNER}, '2026-11-05T00:00:00Z')`;
		for (const id of [OWNER, MEMBER, MEMBER2]) await mm.recomputeUserPlan(id);
		const op = { id: 'op-q', activityId: 'act', subscriptionId: SUB, offerId: 'three-ws', planId: 'team', quantity: 1, action: 'ChangeQuantity', status: 'InProgress', timeStamp: '2026-11-16T10:00:00Z' };
		captureFetch((c) => {
			if (c.url.includes('/oauth2/v2.0/token')) return { body: { access_token: 'tok', expires_in: 3600 } };
			if (c.url.includes('/operations/op-q')) return { body: op };
			return { body: { id: SUB, offerId: 'three-ws', planId: 'team', quantity: 3, saasSubscriptionStatus: 'Subscribed', term: { startDate: '2026-11-01T00:00:00Z', endDate: '2027-11-01T00:00:00Z' }, autoRenew: true } };
		});
		const r = await call('/api/microsoft-marketplace/webhook?action=webhook', { method: 'POST', body: op });
		expect(r.status).toBe(200);
		expect(await seatHolders()).toEqual([OWNER]);
		expect(await plans()).toMatchObject({ [OWNER]: 'team', [MEMBER]: 'free', [MEMBER2]: 'free' });
		expect(holder.notifications.map((n) => n.userId).sort()).toEqual([MEMBER, MEMBER2].sort());
		expect(mb).toBeTruthy();
	});
});

describe('GET /api/microsoft-marketplace/subscriptions', () => {
	let saved;
	beforeEach(async () => {
		saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
		for (const k of ENV_KEYS) delete process.env[k];
		holder.notifications = [];
		await seedWorld();
		holder.user = { id: OWNER, email: 'it-admin@contoso.example' };
		await holder.db.sql`insert into microsoft_saas_seats (subscription_id, user_id, assigned_by) values (${SUB}, ${OWNER}, ${OWNER})`;
		const hour = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
		await holder.db.sql`insert into microsoft_saas_usage_events (subscription_id, plan_id, dimension, effective_start_time, quantity, status) values
			(${SUB}, 'team', 'mcp_tool_calls', ${hour(2)}, 1200, 'accepted'),
			(${SUB}, 'team', 'mcp_tool_calls', ${hour(1)}, 300, 'pending'),
			(${SUB}, 'team', 'agent_messages', ${hour(3)}, 80, 'accepted'),
			(${SUB}, 'team', 'agent_messages', ${hour(4)}, 5, 'rejected'),
			(${SUB}, 'team', 'agent_messages', '2025-01-01T00:00:00Z', 999, 'accepted')`;
	});
	afterEach(() => {
		for (const [k, v] of Object.entries(saved)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
		vi.unstubAllGlobals();
	});

	it('requires a session', async () => {
		holder.user = null;
		const r = await call('/api/microsoft-marketplace/subscriptions?action=subscriptions');
		expect(r.status).toBe(401);
	});

	it('returns the owner\'s subscription with plan, status, term, this period\'s usage and the seat roster', async () => {
		const r = await call('/api/microsoft-marketplace/subscriptions?action=subscriptions');
		expect(r.status).toBe(200);
		expect(r.headers['cache-control']).toBe('private, no-store');
		expect(r.json.manage_links).toHaveLength(2);
		expect(r.json.teams).toEqual([{ id: TEAM, name: 'Contoso Studio' }]);
		const [s] = r.json.subscriptions;
		expect(s).toMatchObject({
			id: SUB, plan_id: 'team', plan: 'team', plan_name: 'Team', status: 'Subscribed', status_label: 'Active',
			auto_renew: true, renews_at: '2027-11-01T00:00:00.000Z', quantity: 3, seat_based: true, role: 'owner',
			can_manage_seats: true, can_link_team: true, team: { id: TEAM, name: 'Contoso Studio' },
			purchaser_email: 'procurement@contoso.example',
		});
		const mcp = s.usage.find((u) => u.id === 'mcp_tool_calls');
		const msgs = s.usage.find((u) => u.id === 'agent_messages');
		expect(mcp).toMatchObject({ accepted: 1200, pending: 300, billable: 1500, included: 15_000_000 });
		expect(msgs).toMatchObject({ accepted: 80, rejected: 5, billable: 80 });
		expect(s.seats.purchased).toBe(3);
		expect(s.seats.used).toBe(1);
		expect(s.seats.holders.map((h) => h.user_id)).toEqual([OWNER]);
		expect(s.seats.candidates.map((c) => c.user_id).sort()).toEqual([MEMBER, MEMBER2].sort());
		expect(s.freshness.source).toBe('microsoft');
	});

	it('shows a team admin the subscription with masked contacts, and a seat holder no roster', async () => {
		const OTHER_OWNER = '66666666-6666-4666-8666-666666666666';
		await holder.db.sql`insert into users (id, email) values (${OTHER_OWNER}, 'cfo@contoso.example')`;
		await holder.db.sql`update microsoft_saas_subscriptions set user_id = ${OTHER_OWNER} where id = ${SUB}`;
		let r = await call('/api/microsoft-marketplace/subscriptions?action=subscriptions');
		let [s] = r.json.subscriptions;
		expect(s).toMatchObject({ role: 'team_admin', can_manage_seats: true, can_link_team: false, purchaser_email: 'p***t@contoso.example' });

		await holder.db.sql`insert into microsoft_saas_seats (subscription_id, user_id, assigned_by) values (${SUB}, ${MEMBER}, ${OWNER})`;
		holder.user = { id: MEMBER, email: 'grace@contoso.example' };
		r = await call('/api/microsoft-marketplace/subscriptions?action=subscriptions');
		[s] = r.json.subscriptions;
		expect(s).toMatchObject({ role: 'seat_holder', you_hold_seat: true, can_manage_seats: false });
		expect(s.seats).toMatchObject({ purchased: 3, used: 2, holders: [], candidates: [] });

		holder.user = { id: OUTSIDER, email: 'eve@fabrikam.example' };
		r = await call('/api/microsoft-marketplace/subscriptions?action=subscriptions');
		expect(r.json.subscriptions).toEqual([]);
	});

	it('refreshes a stale row from the Fulfillment API and reconciles seats when Microsoft changed it', async () => {
		Object.assign(process.env, PUBLISHER_ENV);
		await holder.db.sql`update microsoft_saas_subscriptions set refreshed_at = now() - interval '1 hour', updated_at = now() - interval '1 hour' where id = ${SUB}`;
		const calls = captureFetch((c) => {
			if (c.url.includes('/oauth2/v2.0/token')) return { body: { access_token: 'tok', expires_in: 3600 } };
			return { body: { id: SUB, offerId: 'three-ws', planId: 'team', quantity: 3, saasSubscriptionStatus: 'Suspended', term: { startDate: '2026-11-01T00:00:00Z', endDate: '2027-11-01T00:00:00Z' }, autoRenew: true } };
		});
		const r = await call('/api/microsoft-marketplace/subscriptions?action=subscriptions');
		expect(calls.some((c) => c.url.includes(`/saas/subscriptions/${SUB}`))).toBe(true);
		const [s] = r.json.subscriptions;
		expect(s).toMatchObject({ status: 'Suspended', status_label: 'Suspended', entitled: false, renews_at: null });
		expect(s.freshness.source).toBe('microsoft');
		expect(r.json.plan).toBe('free');
	});

	it('falls back to the stored row, and says so, when Microsoft does not answer in time', async () => {
		Object.assign(process.env, PUBLISHER_ENV);
		await holder.db.sql`update microsoft_saas_subscriptions set refreshed_at = now() - interval '1 hour', updated_at = now() - interval '1 hour' where id = ${SUB}`;
		captureFetch((c) => {
			if (c.url.includes('/oauth2/v2.0/token')) return { body: { access_token: 'tok', expires_in: 3600 } };
			return { status: 503, body: { message: 'Service Unavailable' } };
		});
		const r = await call('/api/microsoft-marketplace/subscriptions?action=subscriptions');
		expect(r.status).toBe(200);
		const [s] = r.json.subscriptions;
		expect(s.status).toBe('Subscribed');
		expect(s.freshness.source).toBe('stored');
		expect(s.freshness.error).toBeTruthy();
	}, 20_000);

	it('does not call Microsoft for a row refreshed inside the window', async () => {
		Object.assign(process.env, PUBLISHER_ENV);
		const calls = captureFetch(() => ({ body: {} }));
		await call('/api/microsoft-marketplace/subscriptions?action=subscriptions');
		expect(calls).toEqual([]);
		expect(REFRESH_AFTER_MS).toBe(600_000);
	});
});

describe('POST /api/microsoft-marketplace/seats', () => {
	let saved;
	beforeEach(async () => {
		saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
		for (const k of ENV_KEYS) delete process.env[k];
		holder.notifications = [];
		holder.csrfOk = true;
		await seedWorld({ quantity: 2 });
		holder.user = { id: OWNER, email: 'it-admin@contoso.example' };
	});
	afterEach(() => {
		for (const [k, v] of Object.entries(saved)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
	});

	const seats = (body) => call('/api/microsoft-marketplace/seats?action=seats', { method: 'POST', body });

	it('assigns and unassigns a seat and reports the member\'s new plan', async () => {
		let r = await seats({ op: 'assign', subscription_id: SUB, user_id: MEMBER });
		expect(r.status).toBe(200);
		expect(r.json).toMatchObject({ ok: true, changed: true, plan: 'team' });
		r = await seats({ op: 'unassign', subscription_id: SUB, user_id: MEMBER });
		expect(r.json).toMatchObject({ ok: true, changed: true, plan: 'free' });
	});

	it('answers 409 once every purchased seat is in use', async () => {
		await seats({ op: 'assign', subscription_id: SUB, user_id: OWNER });
		await seats({ op: 'assign', subscription_id: SUB, user_id: MEMBER });
		const r = await seats({ op: 'assign', subscription_id: SUB, user_id: MEMBER2 });
		expect(r.status).toBe(409);
		expect(r.json.error).toBe('no_seats_left');
	});

	it('lets a member give up their own seat but not manage anyone else\'s', async () => {
		await seats({ op: 'assign', subscription_id: SUB, user_id: MEMBER });
		holder.user = { id: MEMBER };
		expect((await seats({ op: 'assign', subscription_id: SUB, user_id: MEMBER2 })).status).toBe(404);
		const r = await seats({ op: 'unassign', subscription_id: SUB, user_id: MEMBER });
		expect(r.json).toMatchObject({ ok: true, plan: 'free' });
	});

	it('links and unlinks a team, freeing seats held through it', async () => {
		await seats({ op: 'assign', subscription_id: SUB, user_id: MEMBER });
		let r = await seats({ op: 'unlink_team', subscription_id: SUB });
		expect(r.json).toMatchObject({ ok: true, revoked: [MEMBER] });
		r = await seats({ op: 'link_team', subscription_id: SUB, team_id: TEAM });
		expect(r.json).toMatchObject({ ok: true, team: { id: TEAM, name: 'Contoso Studio' }, revoked: [] });
		r = await seats({ op: 'link_team', subscription_id: SUB, team_id: '77777777-7777-4777-8777-777777777777' });
		expect(r.status).toBe(404);
	});

	it('validates input and requires the CSRF token', async () => {
		expect((await seats({ op: 'grant', subscription_id: SUB })).status).toBe(400);
		expect((await seats({ op: 'assign', subscription_id: SUB, user_id: 'not-a-uuid' })).status).toBe(400);
		holder.csrfOk = false;
		expect((await seats({ op: 'assign', subscription_id: SUB, user_id: MEMBER })).status).toBe(403);
	});
});
