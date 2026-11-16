// OAuth 2.0 client credentials for the three.ws SCIM endpoint.
//
// The Entra app gallery only onboards provisioning apps that authenticate with
// the OAuth 2.0 client credentials grant (or workload identity federation):
// "Microsoft doesn't onboard SCIM provisioning applications that use basic
// authentication, long-lived bearer tokens, or the authorization code grant
// flow." Its requirements for that grant, each covered here:
//   - a client id, a client secret, a token endpoint and the SCIM endpoint
//   - client secrets that expire after one to three years
//   - no access token issued on expired (or revoked) credentials
//   - several active secrets at once, so a customer rotates without downtime
//   - access tokens that live between 60 minutes and 6 hours
// The token endpoint is api/scim/token.js (POST /scim/oauth/token, RFC 6749
// section 4.4); the access token it issues is accepted by api/scim/v2.js.

import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { buildScimSchema, resetScimTables, invoke } from './_helpers/scim-harness.js';

const holder = vi.hoisted(() => ({ db: null }));

vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	const { createPgliteSql } = await import('./_helpers/pglite-sql.js');
	holder.db ??= createPgliteSql();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});
vi.mock('../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, limits: new Proxy({}, { get: () => async () => ({ success: true }) }), clientIp: () => '127.0.0.1' };
});

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';
process.env.JWT_SECRET ||= 'scim-oauth-secret-scim-oauth-secret-scim-oauth';

const OWNER = '11111111-1111-4111-8111-111111111111';
const TENANT = '72f988bf-86f1-41af-91ab-2d7cd011db47';

let ent;
let tokenHandler;
let scimHandler;
let teamId;

beforeAll(async () => {
	const { createPgliteSql } = await import('./_helpers/pglite-sql.js');
	holder.db ??= createPgliteSql();
	await buildScimSchema(holder.db);
	ent = await import('../api/_lib/team-enterprise.js');
	tokenHandler = (await import('../api/scim/token.js')).default;
	scimHandler = (await import('../api/scim/v2.js')).default;
});

beforeEach(async () => {
	await resetScimTables(holder.db);
	await holder.db.query(`insert into users (id, email, email_verified) values ($1, 'owner@example.org', true)`, [OWNER]);
	const [row] = await holder.db.query(
		`insert into teams (owner_user_id, name, network, status, is_public) values ($1, 'Desk', 'devnet', 'active', false) returning id`,
		[OWNER],
	);
	teamId = row.id;
	await ent.claimTenant({ teamId, userId: OWNER, tenantId: TENANT, tenantName: 'contoso.example', verifiedBy: 'admin@contoso.example', verifiedRole: 'Global Administrator' });
});

const form = (fields) => new URLSearchParams(fields).toString();

function token(fields, headers = {}) {
	return invoke(tokenHandler, {
		method: 'POST',
		url: '/scim/oauth/token',
		body: form(fields),
		headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
	});
}

const listUsers = (bearer) => invoke(scimHandler, {
	method: 'GET',
	url: '/scim/v2/Users',
	headers: { authorization: `Bearer ${bearer}` },
});

describe('credentials', () => {
	it('creates a client id and a one-time secret that expire within one to three years', async () => {
		const c = await ent.createScimClient({ teamId, userId: OWNER, years: 2 });
		expect(c.client_id).toMatch(/^[0-9a-f-]{36}$/);
		expect(c.client_secret).toMatch(/^tws_scs_[A-Za-z0-9_-]{30,}$/);
		const years = (new Date(c.expires_at) - Date.now()) / (365.25 * 86400_000);
		expect(years).toBeGreaterThan(1.99);
		expect(years).toBeLessThan(2.01);
		const [stored] = await holder.db.query('select secret_hash from team_scim_clients where id = $1', [c.client_id]);
		expect(stored.secret_hash).not.toContain(c.client_secret);
		const view = await ent.enterpriseView(teamId);
		expect(view.scim.clients).toHaveLength(1);
		expect(view.scim.clients[0]).not.toHaveProperty('client_secret');
		expect(view.scim.clients[0]).toMatchObject({ client_id: c.client_id, secret_prefix: c.client_secret.slice(0, 14) });
	});

	it('refuses a lifetime outside one to three years', async () => {
		for (const years of [0, 4, 1.5, 'two']) {
			await expect(ent.createScimClient({ teamId, userId: OWNER, years })).rejects.toMatchObject({ status: 400, code: 'invalid_expiry' });
		}
	});

	it('needs a claimed tenant', async () => {
		await ent.unclaimTenant({ teamId, userId: OWNER });
		await expect(ent.createScimClient({ teamId, userId: OWNER, years: 1 })).rejects.toMatchObject({ status: 409, code: 'tenant_claim_required' });
	});

	it('keeps several secrets active at once and caps them at five', async () => {
		for (let i = 0; i < 5; i += 1) await ent.createScimClient({ teamId, userId: OWNER, years: 1 });
		await expect(ent.createScimClient({ teamId, userId: OWNER, years: 1 })).rejects.toMatchObject({ status: 409, code: 'too_many_clients' });
	});
});

describe('token endpoint (RFC 6749 4.4)', () => {
	it('issues a bearer that lives one hour for a client secret in the form body', async () => {
		const c = await ent.createScimClient({ teamId, userId: OWNER, years: 1 });
		const out = await token({ grant_type: 'client_credentials', client_id: c.client_id, client_secret: c.client_secret });
		expect(out.status).toBe(200);
		expect(out.headers['cache-control']).toMatch(/no-store/);
		expect(out.json).toMatchObject({ token_type: 'Bearer', expires_in: 3600 });
		expect(out.json.access_token).toMatch(/^tws_scat_/);
		expect(out.json.expires_in).toBeGreaterThanOrEqual(3600);
		expect(out.json.expires_in).toBeLessThanOrEqual(6 * 3600);
	});

	it('accepts HTTP Basic client authentication', async () => {
		const c = await ent.createScimClient({ teamId, userId: OWNER, years: 1 });
		const basic = Buffer.from(`${encodeURIComponent(c.client_id)}:${encodeURIComponent(c.client_secret)}`).toString('base64');
		const out = await token({ grant_type: 'client_credentials' }, { authorization: `Basic ${basic}` });
		expect(out.status).toBe(200);
		expect(out.json.access_token).toMatch(/^tws_scat_/);
	});

	it('answers invalid_client for a wrong secret, an unknown client, a revoked or an expired client', async () => {
		const c = await ent.createScimClient({ teamId, userId: OWNER, years: 1 });
		const wrong = await token({ grant_type: 'client_credentials', client_id: c.client_id, client_secret: `${c.client_secret}x` });
		expect(wrong.status).toBe(401);
		expect(wrong.json.error).toBe('invalid_client');
		expect(wrong.headers['www-authenticate']).toMatch(/^Basic/);

		const unknown = await token({ grant_type: 'client_credentials', client_id: '00000000-0000-4000-8000-000000000000', client_secret: c.client_secret });
		expect(unknown.json.error).toBe('invalid_client');

		await holder.db.query(`update team_scim_clients set expires_at = now() - interval '1 second' where id = $1`, [c.client_id]);
		const expired = await token({ grant_type: 'client_credentials', client_id: c.client_id, client_secret: c.client_secret });
		expect(expired.status).toBe(401);
		expect(expired.json.error).toBe('invalid_client');

		const d = await ent.createScimClient({ teamId, userId: OWNER, years: 1 });
		await ent.revokeScimClient({ teamId, userId: OWNER, clientId: d.client_id });
		const revoked = await token({ grant_type: 'client_credentials', client_id: d.client_id, client_secret: d.client_secret });
		expect(revoked.json.error).toBe('invalid_client');
	});

	it('answers unsupported_grant_type and invalid_request', async () => {
		const c = await ent.createScimClient({ teamId, userId: OWNER, years: 1 });
		const grant = await token({ grant_type: 'password', client_id: c.client_id, client_secret: c.client_secret });
		expect(grant.status).toBe(400);
		expect(grant.json.error).toBe('unsupported_grant_type');
		const missing = await token({ client_id: c.client_id, client_secret: c.client_secret });
		expect(missing.status).toBe(400);
		expect(missing.json.error).toBe('invalid_request');
		const get = await invoke(tokenHandler, { method: 'GET', url: '/scim/oauth/token' });
		expect(get.status).toBe(405);
	});

	it('stops issuing once the tenant is unclaimed', async () => {
		const c = await ent.createScimClient({ teamId, userId: OWNER, years: 1 });
		await ent.unclaimTenant({ teamId, userId: OWNER });
		const out = await token({ grant_type: 'client_credentials', client_id: c.client_id, client_secret: c.client_secret });
		expect(out.json.error).toBe('invalid_client');
	});

	it('is routed at /scim/oauth/token', () => {
		const routes = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).routes;
		const row = routes.find((r) => r.src === '/scim/oauth/token');
		expect(row?.dest).toBe('/api/scim/token');
	});
});

describe('the SCIM endpoint accepts the access token', () => {
	async function accessToken() {
		const c = await ent.createScimClient({ teamId, userId: OWNER, years: 1 });
		const out = await token({ grant_type: 'client_credentials', client_id: c.client_id, client_secret: c.client_secret });
		return { client: c, access: out.json.access_token };
	}

	it('serves /Users for a fresh access token and records the client as used', async () => {
		const { client, access } = await accessToken();
		const out = await listUsers(access);
		expect(out.status).toBe(200);
		expect(out.json.totalResults).toBe(0);
		const view = await ent.enterpriseView(teamId);
		expect(view.scim.clients.find((x) => x.client_id === client.client_id).last_used_at).toBeTruthy();
	});

	it('refuses an expired access token', async () => {
		const { access } = await accessToken();
		await holder.db.query(`update team_scim_access_tokens set expires_at = now() - interval '1 second'`);
		const out = await listUsers(access);
		expect(out.status).toBe(401);
	});

	it('refuses the access tokens of a revoked client at once', async () => {
		const { client, access } = await accessToken();
		await ent.revokeScimClient({ teamId, userId: OWNER, clientId: client.client_id });
		expect((await listUsers(access)).status).toBe(401);
	});

	it('refuses a client secret presented as a bearer', async () => {
		const c = await ent.createScimClient({ teamId, userId: OWNER, years: 1 });
		expect((await listUsers(c.client_secret)).status).toBe(401);
	});

	it('still serves the legacy team bearer token', async () => {
		const { token: legacy } = await ent.issueScimToken({ teamId, userId: OWNER });
		expect((await listUsers(legacy)).status).toBe(200);
	});
});
