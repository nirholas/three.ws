// Pure rules behind the Microsoft Marketplace SaaS offer
// (api/_lib/microsoft-marketplace.js): webhook token claims, Entra sign-in
// claims, plan mapping and entitlement, tenant matching, the Fulfillment API
// to column mapping, and the hourly metering window.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { createPgliteSql } from './_helpers/pglite-sql.js';

// The webhook and client tests below run the real handler and client against
// an in-process Postgres and a stubbed fetch that answers as Microsoft's hosts
// do. jose is stubbed only for the bearer signature (the claims rule still runs
// through checkWebhookClaims); audit writes are not under test.
const holder = vi.hoisted(() => ({ db: null, jwtPayload: null }));
vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});
vi.mock('jose', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		jwtVerify: async (...args) => (holder.jwtPayload ? { payload: holder.jwtPayload } : actual.jwtVerify(...args)),
	};
});
vi.mock('../api/_lib/audit.js', () => ({ logAudit: () => {} }));

import {
	MARKETPLACE_APP_ID, MarketplaceError, DIMENSIONS,
	checkWebhookClaims, ssoClaimsFromPayload, identityMatchesSubscription,
	planForMicrosoftPlan, highestPlan, entitles, subscriptionColumns, publicSubscription,
	floorHour, hoursToMeter, settleUsageStatus, chunk,
	METERING_LOOKBACK_HOURS, METERING_BATCH_MAX,
} from '../api/_lib/microsoft-marketplace.js';

const TENANT = '72f988bf-86f1-41af-91ab-2d7cd011db47';
const CLIENT = '0b8d3f4e-1111-4c3a-9a77-5f0d2c1e9a01';
const H = 3_600_000;

function webhookPayload(over = {}) {
	return { iss: `https://sts.windows.net/${TENANT}/`, tid: TENANT, aud: CLIENT, appid: MARKETPLACE_APP_ID, ...over };
}

function expectCode(fn, code) {
	try {
		fn();
	} catch (err) {
		expect(err).toBeInstanceOf(MarketplaceError);
		expect(err.code).toBe(code);
		return;
	}
	throw new Error(`expected ${code}`);
}

describe('checkWebhookClaims', () => {
	const opts = { tenantId: TENANT, clientId: CLIENT };

	it('accepts a v1 token from the publisher tenant sent by the Marketplace app', () => {
		expect(checkWebhookClaims(webhookPayload(), opts)).toBe(true);
	});

	it('accepts a v2 issuer, an api:// audience and azp in place of appid', () => {
		const p = webhookPayload({ iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, aud: `api://${CLIENT}`, appid: undefined, azp: MARKETPLACE_APP_ID });
		expect(checkWebhookClaims(p, opts)).toBe(true);
	});

	it('rejects another tenant as issuer', () => {
		expectCode(() => checkWebhookClaims(webhookPayload({ iss: 'https://sts.windows.net/00000000-0000-0000-0000-000000000000/' }), opts), 'invalid_webhook_token');
	});

	it('rejects a tid that disagrees with the issuer', () => {
		expectCode(() => checkWebhookClaims(webhookPayload({ tid: 'other' }), opts), 'invalid_webhook_token');
	});

	it('rejects a token for a different audience', () => {
		expectCode(() => checkWebhookClaims(webhookPayload({ aud: 'someone-else' }), opts), 'invalid_webhook_token');
	});

	it('rejects a token the Marketplace app did not request', () => {
		expectCode(() => checkWebhookClaims(webhookPayload({ appid: 'not-marketplace' }), opts), 'invalid_webhook_token');
	});

	it('rejects a missing payload', () => {
		expectCode(() => checkWebhookClaims(null, opts), 'invalid_webhook_token');
	});
});

describe('ssoClaimsFromPayload', () => {
	const base = {
		oid: 'oid-1', tid: TENANT, aud: CLIENT,
		iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
		nonce: 'n1', email: 'Buyer@Contoso.com', name: 'Buyer One',
	};

	it('builds a tenant-scoped subject and lowercases the email, never marking it verified', () => {
		const c = ssoClaimsFromPayload(base, { nonce: 'n1', clientId: CLIENT });
		expect(c.subject).toBe(`${TENANT}:oid-1`);
		expect(c.tenant_id).toBe(TENANT);
		expect(c.email).toBe('buyer@contoso.com');
		expect(c.email_verified).toBe(false);
		expect(c.display_name).toBe('Buyer One');
	});

	it('falls back to preferred_username only when it is an address', () => {
		const withUpn = ssoClaimsFromPayload({ ...base, email: undefined, preferred_username: 'upn@contoso.com' }, { nonce: 'n1', clientId: CLIENT });
		expect(withUpn.email).toBe('upn@contoso.com');
		const withoutAt = ssoClaimsFromPayload({ ...base, email: undefined, preferred_username: 'buyer' }, { nonce: 'n1', clientId: CLIENT });
		expect(withoutAt.email).toBeNull();
	});

	it('rejects a wrong nonce, audience, issuer, or a token without tenant and object id', () => {
		expectCode(() => ssoClaimsFromPayload(base, { nonce: 'other', clientId: CLIENT }), 'sso_invalid_token');
		expectCode(() => ssoClaimsFromPayload({ ...base, aud: 'x' }, { nonce: 'n1', clientId: CLIENT }), 'sso_invalid_token');
		expectCode(() => ssoClaimsFromPayload({ ...base, iss: 'https://login.microsoftonline.com/other/v2.0' }, { nonce: 'n1', clientId: CLIENT }), 'sso_invalid_token');
		expectCode(() => ssoClaimsFromPayload({ ...base, oid: undefined }, { nonce: 'n1', clientId: CLIENT }), 'sso_invalid_token');
	});
});

describe('identityMatchesSubscription', () => {
	it('matches the beneficiary or purchaser tenant and nothing else', () => {
		const row = { beneficiary_tenant_id: 'b', purchaser_tenant_id: 'p' };
		expect(identityMatchesSubscription({ tenant_id: 'b' }, row)).toBe(true);
		expect(identityMatchesSubscription({ tenant_id: 'p' }, row)).toBe(true);
		expect(identityMatchesSubscription({ tenant_id: 'x' }, row)).toBe(false);
		expect(identityMatchesSubscription({ tenant_id: null }, { beneficiary_tenant_id: null, purchaser_tenant_id: null })).toBe(false);
	});
});

describe('plans and entitlement', () => {
	it('maps the configured Partner Center plan ids and rejects unknown ones', () => {
		expect(planForMicrosoftPlan('pro')).toBe('pro');
		expect(planForMicrosoftPlan('enterprise')).toBe('enterprise');
		expect(planForMicrosoftPlan('platinum')).toBeNull();
		expect(planForMicrosoftPlan('__proto__')).toBeNull();
		expect(planForMicrosoftPlan(undefined)).toBeNull();
	});

	it('picks the highest plan and ignores unknown entries', () => {
		expect(highestPlan([])).toBe('free');
		expect(highestPlan(['pro', 'team', null, 'bogus'])).toBe('team');
		expect(highestPlan(['enterprise', 'pro'])).toBe('enterprise');
	});

	it('grants a plan only while Subscribed', () => {
		expect(entitles('Subscribed')).toBe(true);
		for (const s of ['PendingFulfillmentStart', 'Suspended', 'Unsubscribed', undefined]) expect(entitles(s)).toBe(false);
	});

	it('every metered dimension counts a real usage_events kind', () => {
		expect(DIMENSIONS.length).toBeGreaterThan(0);
		for (const d of DIMENSIONS) {
			expect(d.id).toMatch(/^[a-z0-9_]+$/);
			expect(['tool_call', 'llm']).toContain(d.usage_kind);
		}
	});
});

describe('subscriptionColumns', () => {
	const sub = {
		id: 'sub-1', name: 'three.ws for Contoso', offerId: 'three-ws', planId: 'team', quantity: 5,
		saasSubscriptionStatus: 'Subscribed',
		purchaser: { emailId: 'p@contoso.com', objectId: 'po', tenantId: 'pt' },
		beneficiary: { emailId: 'b@contoso.com', objectId: 'bo', tenantId: 'bt' },
		term: { startDate: '2026-11-01T00:00:00Z', endDate: '2026-12-01T00:00:00Z' },
		autoRenew: true, isTest: true,
	};

	it('maps the Fulfillment API object onto columns', () => {
		const c = subscriptionColumns(sub);
		expect(c).toMatchObject({
			id: 'sub-1', offer_id: 'three-ws', plan_id: 'team', quantity: 5, saas_status: 'Subscribed',
			purchaser_tenant_id: 'pt', beneficiary_email: 'b@contoso.com', beneficiary_tenant_id: 'bt',
			term_end: '2026-12-01T00:00:00Z', auto_renew: true, is_test: true,
		});
	});

	it('keeps quantity null for a flat-rate plan, so activation never sends quantity 0', () => {
		expect(subscriptionColumns({ ...sub, quantity: undefined }).quantity).toBeNull();
		expect(subscriptionColumns({ ...sub, quantity: null }).quantity).toBeNull();
		expect(subscriptionColumns({ ...sub, quantity: 0 }).quantity).toBeNull();
	});

	it('treats an unrecognised status as not yet active', () => {
		expect(subscriptionColumns({ ...sub, saasSubscriptionStatus: 'Something' }).saas_status).toBe('PendingFulfillmentStart');
	});

	it('the public view entitles only a Subscribed row on a known plan', () => {
		const row = { ...subscriptionColumns(sub), user_id: 'u1' };
		expect(publicSubscription(row)).toMatchObject({ plan: 'team', entitled: true, linked: true, status: 'Subscribed' });
		expect(publicSubscription({ ...row, plan_id: 'unknown' }).entitled).toBe(false);
		expect(publicSubscription({ ...row, saas_status: 'Suspended' }).entitled).toBe(false);
	});
});

describe('metering window', () => {
	const now = new Date('2026-11-04T15:20:00Z');

	it('floors to the hour', () => {
		expect(floorHour('2026-11-04T15:59:59Z').toISOString()).toBe('2026-11-04T15:00:00.000Z');
	});

	it('meters every completed hour after metered_through', () => {
		const hours = hoursToMeter({ meteredThrough: new Date('2026-11-04T11:00:00Z'), activatedAt: null, now });
		expect(hours.map((h) => h.toISOString())).toEqual([
			'2026-11-04T12:00:00.000Z', '2026-11-04T13:00:00.000Z', '2026-11-04T14:00:00.000Z',
		]);
	});

	it('starts at the activation hour when nothing was metered yet', () => {
		const hours = hoursToMeter({ meteredThrough: null, activatedAt: new Date('2026-11-04T13:45:00Z'), now });
		expect(hours.map((h) => h.toISOString())).toEqual(['2026-11-04T13:00:00.000Z', '2026-11-04T14:00:00.000Z']);
	});

	it('never includes the current, unfinished hour', () => {
		const hours = hoursToMeter({ meteredThrough: new Date('2026-11-04T14:00:00Z'), activatedAt: null, now });
		expect(hours).toEqual([]);
	});

	it('never reaches past the acceptance window', () => {
		const hours = hoursToMeter({ meteredThrough: new Date('2026-10-01T00:00:00Z'), activatedAt: null, now });
		expect(hours.length).toBeLessThanOrEqual(METERING_LOOKBACK_HOURS);
		expect(now.getTime() - hours[0].getTime()).toBeLessThan(24 * H);
	});

	it('settles Microsoft per-event statuses', () => {
		expect(settleUsageStatus('Accepted')).toBe('accepted');
		expect(settleUsageStatus('Duplicate')).toBe('accepted');
		expect(settleUsageStatus('Expired')).toBe('expired');
		for (const s of ['ResourceNotFound', 'ResourceNotAuthorized', 'InvalidDimension', 'InvalidQuantity', 'BadArgument', undefined]) {
			expect(settleUsageStatus(s)).toBe('rejected');
		}
	});

	it('keeps transient verdicts pending so the next tick retries them', () => {
		expect(settleUsageStatus('Error')).toBe('pending');
		expect(settleUsageStatus('ResourceNotActive')).toBe('pending');
	});

	it('chunks into Metering API sized batches', () => {
		const list = Array.from({ length: 60 }, (_, i) => i);
		const parts = chunk(list, METERING_BATCH_MAX);
		expect(parts.map((p) => p.length)).toEqual([25, 25, 10]);
		expect(parts.flat()).toEqual(list);
	});
});

// ── Endpoints and emulator mode ─────────────────────────────────────────────

const ENDPOINT_ENV = ['MS_MARKETPLACE_API_BASE', 'MS_MARKETPLACE_METERING_BASE', 'MS_MARKETPLACE_TOKEN_URL'];
const PUBLISHER_ENV = {
	MS_MARKETPLACE_TENANT_ID: TENANT,
	MS_MARKETPLACE_CLIENT_ID: CLIENT,
	MS_MARKETPLACE_CLIENT_SECRET: 'publisher-secret',
};

function captureFetch(answer) {
	const calls = [];
	vi.stubGlobal('fetch', async (url, init = {}) => {
		const call = { url: String(url), method: (init.method || 'GET').toUpperCase(), headers: init.headers || {}, body: init.body };
		calls.push(call);
		const out = answer(call);
		return new Response(out.body == null ? '' : JSON.stringify(out.body), {
			status: out.status ?? 200,
			headers: { 'content-type': 'application/json' },
		});
	});
	return calls;
}

function tokenAnswer(call) {
	if (call.url.includes('/oauth2/v2.0/token') || call.url.endsWith('/entra/token')) return { body: { access_token: `tok-${call.url.length}`, expires_in: 3600 } };
	return null;
}

describe('Marketplace endpoints', () => {
	let saved;
	beforeEach(() => {
		saved = Object.fromEntries([...ENDPOINT_ENV, ...Object.keys(PUBLISHER_ENV)].map((k) => [k, process.env[k]]));
		for (const k of ENDPOINT_ENV) delete process.env[k];
		Object.assign(process.env, PUBLISHER_ENV);
	});
	afterEach(() => {
		for (const [k, v] of Object.entries(saved)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
		vi.unstubAllGlobals();
	});

	it('defaults every call to the Microsoft production hosts when no override is set', async () => {
		const mm = await import('../api/_lib/microsoft-marketplace.js');
		expect(mm.marketplaceEndpoints()).toMatchObject({
			fulfillmentBase: 'https://marketplaceapi.microsoft.com/api',
			meteringBase: 'https://marketplaceapi.microsoft.com/api',
		});
		expect(mm.marketplaceEndpoints().tokenUrl(TENANT)).toBe(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`);
		const calls = captureFetch((c) => tokenAnswer(c) || { body: c.url.includes('batchUsageEvent') ? { count: 0, result: [] } : { id: 'sub-1' } });
		await mm.getSubscription('sub-1');
		await mm.postUsageBatch([{ resourceId: 'sub-1', quantity: 1, dimension: 'mcp_tool_calls', effectiveStartTime: '2026-11-16T10:00:00.000Z', planId: 'pro' }]);
		expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
			`POST https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
			'GET https://marketplaceapi.microsoft.com/api/saas/subscriptions/sub-1?api-version=2018-08-31',
			'POST https://marketplaceapi.microsoft.com/api/batchUsageEvent?api-version=2018-08-31',
		]);
	});

	it('sends each API to its override and refetches the token when the token endpoint changes', async () => {
		const mm = await import('../api/_lib/microsoft-marketplace.js');
		process.env.MS_MARKETPLACE_API_BASE = 'http://127.0.0.1:3978/api/';
		process.env.MS_MARKETPLACE_METERING_BASE = 'http://127.0.0.1:4100/metering';
		process.env.MS_MARKETPLACE_TOKEN_URL = 'http://127.0.0.1:4100/entra/token';
		const calls = captureFetch((c) => tokenAnswer(c) || { body: c.url.includes('batchUsageEvent') ? { count: 0, result: [] } : { id: 'sub-2' } });
		await mm.getSubscription('sub-2');
		await mm.postUsageBatch([{ resourceId: 'sub-2', quantity: 1, dimension: 'mcp_tool_calls', effectiveStartTime: '2026-11-16T10:00:00.000Z', planId: 'pro' }]);
		expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
			'POST http://127.0.0.1:4100/entra/token',
			'GET http://127.0.0.1:3978/api/saas/subscriptions/sub-2?api-version=2018-08-31',
			'POST http://127.0.0.1:4100/metering/batchUsageEvent?api-version=2018-08-31',
		]);
	});
});

describe('emulator mode', () => {
	const LOGIN = 'http://127.0.0.1:4100';
	it('can never be active in a production runtime', async () => {
		const em = await import('../api/_lib/microsoft-marketplace-emulator.js');
		const prodEnvs = [
			{ MS_MARKETPLACE_EMULATOR: '1', NODE_ENV: 'production' },
			{ MS_MARKETPLACE_EMULATOR: '1', K_SERVICE: 'three-ws-api' },
			{ MS_MARKETPLACE_EMULATOR: ' 1 ', NODE_ENV: 'production', K_SERVICE: 'three-ws-api' },
			{ MS_MARKETPLACE_EMULATOR: '1', VERCEL_ENV: 'production' },
		];
		for (const env of prodEnvs) {
			expect(() => em.assertEmulatorModeAllowed(env)).toThrow(/refused/);
			expect(() => em.emulatorMode(env)).toThrow(/refused/);
			expect(() => em.emulatorLoginBase({ ...env, MS_MARKETPLACE_EMULATOR_LOGIN_BASE: LOGIN })).toThrow(/refused/);
		}
	});

	it('is off unless MS_MARKETPLACE_EMULATOR is exactly 1, and production without it boots normally', async () => {
		const em = await import('../api/_lib/microsoft-marketplace-emulator.js');
		const offEnvs = [
			{},
			{ NODE_ENV: 'production', K_SERVICE: 'three-ws-api' },
			{ MS_MARKETPLACE_EMULATOR: '0' },
			{ MS_MARKETPLACE_EMULATOR: 'true', K_SERVICE: 'three-ws-api' },
			{ MS_MARKETPLACE_EMULATOR: 'yes', NODE_ENV: 'production' },
		];
		for (const env of offEnvs) {
			expect(em.assertEmulatorModeAllowed(env)).toBe(false);
			expect(em.emulatorMode(env)).toBe(false);
			expect(em.emulatorLoginBase({ ...env, MS_MARKETPLACE_EMULATOR_LOGIN_BASE: LOGIN })).toBe(null);
		}
		expect(em.emulatorMode({ MS_MARKETPLACE_EMULATOR: '1' })).toBe(true);
		expect(em.emulatorLoginBase({ MS_MARKETPLACE_EMULATOR: '1', MS_MARKETPLACE_EMULATOR_LOGIN_BASE: `${LOGIN}/` })).toBe(LOGIN);
	});

	it('refuses a Cloud Run server boot that carries the flag', async () => {
		const em = await import('../api/_lib/microsoft-marketplace-emulator.js');
		const server = readFileSync('server/index.mjs', 'utf8');
		expect(server).toMatch(/assertEmulatorModeAllowed\(\)/);
		expect(() => em.assertEmulatorModeAllowed({ MS_MARKETPLACE_EMULATOR: '1', K_SERVICE: 'three-ws-api', NODE_ENV: 'production' }))
			.toThrow(em.EmulatorModeRefused);
	});
});

// ── Webhook against Microsoft's documented contract ─────────────────────────

const SUB_ID = 'a1b2c3d4-0000-4000-8000-000000000001';
const BUYER_TENANT = '2694e9dc-29a5-4017-958d-68314a91f2d2';
const MIGRATION = readFileSync('api/_lib/migrations/20261104180000_microsoft_marketplace_saas.sql', 'utf8');
const BASE_TABLES = `
create table users (id uuid primary key default gen_random_uuid(), email text, display_name text,
  plan text not null default 'free', email_verified boolean default false, deleted_at timestamptz);
create table user_identities (id uuid primary key default gen_random_uuid(), user_id uuid, provider text not null,
  subject text, constraint user_identities_provider_check check (provider in ('google')));
create table subscriptions (user_id uuid, plan text, status text, active_until timestamptz);`;

function microsoftSub(over = {}) {
	return {
		id: SUB_ID, name: 'Contoso three.ws', offerId: 'three-ws', planId: 'pro', quantity: 0,
		saasSubscriptionStatus: 'Subscribed',
		beneficiary: { emailId: 'buyer@contoso.example', objectId: 'oid-1', tenantId: BUYER_TENANT },
		purchaser: { emailId: 'buyer@contoso.example', objectId: 'oid-1', tenantId: BUYER_TENANT },
		term: { startDate: '2026-11-01T00:00:00Z', endDate: '2026-12-01T00:00:00Z', termUnit: 'P1M' },
		autoRenew: true, isTest: true, ...over,
	};
}

// Answers the way the Fulfillment API does for one subscription. The GET keeps
// Microsoft's pre-operation copy while an operation is InProgress, as the live
// API does; tests change `ms.sub` to model an operation Microsoft completed.
function fakeMicrosoft(ms) {
	return captureFetch((c) => {
		const t = tokenAnswer(c);
		if (t) return t;
		const u = new URL(c.url);
		const opMatch = /\/saas\/subscriptions\/([^/]+)\/operations\/([^/]+)$/.exec(u.pathname);
		if (opMatch) {
			const op = ms.ops[decodeURIComponent(opMatch[2])];
			if (!op || op.subscriptionId !== decodeURIComponent(opMatch[1])) return { status: 404, body: { message: 'operation not found' } };
			if (c.method === 'PATCH') return { status: 200, body: {} };
			return { body: op };
		}
		if (/\/saas\/subscriptions\/[^/]+$/.test(u.pathname)) return { body: ms.sub };
		return { status: 404, body: { message: `unexpected ${c.method} ${c.url}` } };
	});
}

function operation(over = {}) {
	return {
		id: 'op-1', activityId: 'act-1', subscriptionId: SUB_ID, offerId: 'three-ws', publisherId: 'pub',
		planId: 'pro', quantity: null, action: 'ChangePlan', timeStamp: '2026-11-16T10:00:00Z',
		status: 'InProgress', operationRequestSource: 'Azure', ...over,
	};
}

async function callWebhook(body, { authorization = 'Bearer signed.by.entra' } = {}) {
	const { default: handler } = await import('../api/microsoft-marketplace/[action].js');
	const raw = Buffer.from(JSON.stringify(body));
	const req = Object.assign(Readable.from([raw]), {
		method: 'POST',
		url: '/api/microsoft-marketplace/webhook?action=webhook',
		headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) },
		rawBody: raw,
		socket: { remoteAddress: '127.0.0.1' },
	});
	const out = { status: 0, headers: {}, body: '' };
	const res = {
		statusCode: 200,
		headersSent: false,
		setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
		getHeader(k) { return out.headers[k.toLowerCase()]; },
		removeHeader(k) { delete out.headers[k.toLowerCase()]; },
		writeHead(code, h) { this.statusCode = code; if (h) for (const [k, v] of Object.entries(h)) this.setHeader(k, v); return this; },
		write(chunk) { out.body += chunk; return true; },
		end(chunk) { if (chunk) out.body += chunk; this.headersSent = true; this.writableEnded = true; out.status = this.statusCode; },
		on() { return this; }, once() { return this; },
	};
	await handler(req, res);
	let json = null;
	try { json = JSON.parse(out.body); } catch { json = null; }
	return { status: out.status, json };
}

describe('connection webhook', () => {
	let saved;
	let ms;
	let calls;
	let userId;
	let db;

	// One database for the suite; each test starts from empty tables.
	beforeAll(async () => {
		db = createPgliteSql();
		await db.exec(BASE_TABLES);
		await db.exec(MIGRATION);
	});

	beforeEach(async () => {
		saved = Object.fromEntries(['MS_MARKETPLACE_EMULATOR', ...ENDPOINT_ENV, ...Object.keys(PUBLISHER_ENV)].map((k) => [k, process.env[k]]));
		for (const k of ['MS_MARKETPLACE_EMULATOR', ...ENDPOINT_ENV]) delete process.env[k];
		Object.assign(process.env, PUBLISHER_ENV);
		holder.jwtPayload = webhookPayload();
		holder.db = db;
		await db.exec('truncate microsoft_saas_usage_events, microsoft_saas_operations, microsoft_saas_subscriptions, user_identities, subscriptions, users cascade');
		[{ id: userId }] = await holder.db.sql`insert into users (email, plan) values ('buyer@contoso.example', 'pro') returning id`;
		await holder.db.sql`insert into microsoft_saas_subscriptions (id, user_id, offer_id, plan_id, saas_status, beneficiary_tenant_id, activated_at)
			values (${SUB_ID}, ${userId}, 'three-ws', 'pro', 'Subscribed', ${BUYER_TENANT}, now())`;
		ms = { sub: microsoftSub(), ops: {} };
		calls = fakeMicrosoft(ms);
	});
	afterEach(() => {
		for (const [k, v] of Object.entries(saved)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
		holder.jwtPayload = null;
		vi.unstubAllGlobals();
	});

	const patches = () => calls.filter((c) => c.method === 'PATCH');
	const opReads = () => calls.filter((c) => c.method === 'GET' && c.url.includes('/operations/'));
	const userPlan = async () => (await holder.db.sql`select plan from users where id = ${userId}`)[0].plan;
	const stored = async () => (await holder.db.sql`select plan_id, quantity, saas_status from microsoft_saas_subscriptions where id = ${SUB_ID}`)[0];
	const opRow = async (id) => (await holder.db.sql`select outcome, status from microsoft_saas_operations where id = ${id}`)[0];

	it('validates every call against Get Operation before acting on it', async () => {
		const forged = operation({ id: 'op-forged', planId: 'enterprise' });
		const r = await callWebhook(forged);
		expect(opReads().map((c) => new URL(c.url).pathname)).toEqual([`/api/saas/subscriptions/${SUB_ID}/operations/op-forged`]);
		expect(r.status).toBeGreaterThanOrEqual(400);
		expect(r.status).toBeLessThan(500);
		expect(await userPlan()).toBe('pro');
		expect((await stored()).plan_id).toBe('pro');
	});

	it('refuses a payload that disagrees with Microsoft\'s copy of the operation', async () => {
		ms.ops['op-2'] = operation({ id: 'op-2', action: 'ChangeQuantity', planId: 'pro', quantity: 3 });
		const r = await callWebhook(operation({ id: 'op-2', action: 'ChangePlan', planId: 'enterprise' }));
		expect(r.status).toBe(400);
		expect(r.json.error).toBe('operation_mismatch');
		expect(await userPlan()).toBe('pro');
	});

	it('acknowledges an accepted ChangePlan with a 200 and no PATCH, and grants the new plan at once', async () => {
		ms.ops['op-3'] = operation({ id: 'op-3', planId: 'team' });
		const r = await callWebhook(ms.ops['op-3']);
		expect(r.status).toBe(200);
		expect(patches()).toEqual([]);
		expect(await stored()).toMatchObject({ plan_id: 'team', saas_status: 'Subscribed' });
		expect(await userPlan()).toBe('team');
		expect(await opRow('op-3')).toEqual({ outcome: 'acknowledged_success', status: 'InProgress' });
	});

	it('acknowledges an accepted ChangeQuantity and stores the new seat count', async () => {
		ms.ops['op-4'] = operation({ id: 'op-4', action: 'ChangeQuantity', quantity: 12 });
		const r = await callWebhook(ms.ops['op-4']);
		expect(r.status).toBe(200);
		expect(patches()).toEqual([]);
		expect((await stored()).quantity).toBe(12);
	});

	it('refuses a ChangePlan to a plan three.ws does not serve with a 4xx, and again on redelivery', async () => {
		ms.ops['op-5'] = operation({ id: 'op-5', planId: 'legacy-gold' });
		const r = await callWebhook(ms.ops['op-5']);
		expect(r.status).toBe(400);
		expect(r.json.error).toBe('unknown_plan');
		expect(patches()).toEqual([]);
		expect(await userPlan()).toBe('pro');
		expect(await opRow('op-5')).toEqual({ outcome: 'acknowledged_failure', status: 'InProgress' });
		const again = await callWebhook(ms.ops['op-5']);
		expect(again.status).toBe(400);
		expect(patches()).toEqual([]);
	});

	it('answers Reinstate with a 200 only and restores the plan while Microsoft still reports Suspended', async () => {
		await holder.db.sql`update microsoft_saas_subscriptions set saas_status = 'Suspended' where id = ${SUB_ID}`;
		await holder.db.sql`update users set plan = 'free' where id = ${userId}`;
		ms.sub = microsoftSub({ saasSubscriptionStatus: 'Suspended' });
		ms.ops['op-6'] = operation({ id: 'op-6', action: 'Reinstate' });
		const r = await callWebhook(ms.ops['op-6']);
		expect(r.status).toBe(200);
		expect(patches()).toEqual([]);
		expect((await stored()).saas_status).toBe('Subscribed');
		expect(await userPlan()).toBe('pro');
	});

	it('mirrors a Succeeded Suspend and Unsubscribe and drops the plan', async () => {
		ms.ops['op-7'] = operation({ id: 'op-7', action: 'Suspend', status: 'Succeeded' });
		expect((await callWebhook(ms.ops['op-7'])).status).toBe(200);
		expect((await stored()).saas_status).toBe('Suspended');
		expect(await userPlan()).toBe('free');
		ms.ops['op-8'] = operation({ id: 'op-8', action: 'Unsubscribe', status: 'Succeeded' });
		expect((await callWebhook(ms.ops['op-8'])).status).toBe(200);
		expect((await stored()).saas_status).toBe('Unsubscribed');
		expect(patches()).toEqual([]);
	});

	it('requires the Entra bearer token outside emulator mode', async () => {
		ms.ops['op-9'] = operation({ id: 'op-9', planId: 'team' });
		holder.jwtPayload = null;
		const r = await callWebhook(ms.ops['op-9'], { authorization: null });
		expect(r.status).toBe(401);
		expect(await userPlan()).toBe('pro');
	});

	it('in emulator mode accepts an unsigned call only when Get Operation confirms it', async () => {
		process.env.MS_MARKETPLACE_EMULATOR = '1';
		holder.jwtPayload = null;
		ms.ops['op-10'] = operation({ id: 'op-10', planId: 'team' });
		expect((await callWebhook(ms.ops['op-10'], { authorization: null })).status).toBe(200);
		expect(await userPlan()).toBe('team');
		const forged = await callWebhook(operation({ id: 'op-11', planId: 'enterprise' }), { authorization: null });
		expect(forged.status).toBe(400);
		expect(await userPlan()).toBe('team');
	});
});
