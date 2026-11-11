// Microsoft 365 Copilot connector (api/_lib/m365-connector.js).
//
// The pure half (schema rules, ACL mapping, item payloads, sync planning,
// Retry-After arithmetic) is tested directly. The sync itself runs against the
// real migration in an in-process Postgres (PGlite); only Microsoft's HTTP
// endpoints are replaced, at the fetch boundary, with the response shapes
// Microsoft documents for Graph connectors and the Entra token endpoint.

import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const dbState = { pg: null };

vi.mock('../api/_lib/db.js', () => {
	const build = (strings, values) => ({
		text: strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''), ''),
		values,
	});
	const sql = (strings, ...values) => {
		const q = build(strings, values);
		return { ...q, then: (res, rej) => dbState.pg.query(q.text, q.values).then((r) => r.rows).then(res, rej) };
	};
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false };
});

process.env.MS_ENTRA_SSO_CLIENT_ID = '11111111-2222-4333-8444-555555555555';
process.env.MS_ENTRA_SSO_CLIENT_SECRET = 'test-secret-value';

const m = await import('../api/_lib/m365-connector.js');

const TENANT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OTHER_TENANT = 'ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OWNER_OID = '12345678-1234-4234-8234-123456789abc';
const GROUP = '99999999-8888-4777-8666-555555555555';
const USER = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
const ORIGIN = 'https://three.ws';

// ── Schema ──────────────────────────────────────────────────────────────────

describe('schema', () => {
	it('the registered schema passes every documented Graph constraint', () => {
		expect(m.validateSchema(m.buildSchema())).toEqual([]);
	});

	it('tells agents, models and avatars apart with a refinable itemType property', () => {
		const p = m.buildSchema().properties.find((x) => x.name === 'itemType');
		expect(p).toMatchObject({ type: 'string', isQueryable: true, isRefinable: true, labels: ['itemType'] });
	});

	it('maps the semantic labels Copilot uses for titles, links and dates', () => {
		const labels = m.buildSchema().properties.flatMap((p) => p.labels || []);
		for (const l of ['title', 'url', 'iconUrl', 'createdBy', 'createdDateTime', 'lastModifiedDateTime', 'tags']) expect(labels).toContain(l);
	});

	it('rejects names over 32 characters or with forbidden characters', () => {
		const bad = (name) => ({ baseType: 'microsoft.graph.externalItem', properties: [{ name, type: 'string' }] });
		expect(m.validateSchema(bad('a'.repeat(33)))[0]).toMatch(/1 to 32/);
		expect(m.validateSchema(bad('has space'))[0]).toMatch(/1 to 32/);
		expect(m.validateSchema(bad('price$'))[0]).toMatch(/1 to 32/);
		expect(m.validateSchema(bad('a'.repeat(32)))).toEqual([]);
	});

	it('rejects searchable non-string properties, searchable+refinable, and refinable without queryable', () => {
		const s = (p) => m.validateSchema({ baseType: 'microsoft.graph.externalItem', properties: [{ name: 'x', ...p }] });
		expect(s({ type: 'int64', isSearchable: true }).join()).toMatch(/only string and stringCollection/);
		expect(s({ type: 'string', isSearchable: true, isRefinable: true, isQueryable: true }).join()).toMatch(/both searchable and refinable/);
		expect(s({ type: 'string', isRefinable: true }).join()).toMatch(/must also be queryable/);
	});

	it('rejects unknown types, unknown or duplicated labels, long descriptions and duplicate names', () => {
		const problems = m.validateSchema({
			baseType: 'microsoft.graph.externalItem',
			properties: [
				{ name: 'a', type: 'text', labels: ['title'] },
				{ name: 'b', type: 'string', labels: ['title', 'headline'], description: 'x'.repeat(201) },
				{ name: 'A', type: 'string' },
			],
		}).join('\n');
		expect(problems).toMatch(/unknown type text/);
		expect(problems).toMatch(/label title is on both a and b/);
		expect(problems).toMatch(/unknown label headline/);
		expect(problems).toMatch(/description over 200/);
		expect(problems).toMatch(/declared twice/);
	});

	it('rejects a wrong baseType and an empty or oversized property list', () => {
		expect(m.validateSchema({ baseType: 'x', properties: [] }).join()).toMatch(/baseType.*1 to 128/s);
		const many = Array.from({ length: 129 }, (_, i) => ({ name: `p${i}`, type: 'string' }));
		expect(m.validateSchema({ baseType: 'microsoft.graph.externalItem', properties: many }).join()).toMatch(/has 129/);
	});
});

describe('connection id and resolvers', () => {
	it('derives a stable alphanumeric id under 32 characters from the account id', () => {
		const id = m.connectionIdFor(USER);
		expect(id).toBe('threews0a1b2c3d4e5f4a6b8c7d8e9f');
		expect(id).toBe(m.connectionIdFor(USER.toUpperCase()));
		expect(m.isValidConnectionId(id)).toBe(true);
	});

	it('enforces the documented id rule', () => {
		expect(m.isValidConnectionId('ab')).toBe(false);
		expect(m.isValidConnectionId('a'.repeat(33))).toBe(false);
		expect(m.isValidConnectionId('MicrosoftThing')).toBe(false);
		expect(m.isValidConnectionId('SharePoint')).toBe(false);
		expect(m.isValidConnectionId('three-ws')).toBe(false);
	});

	it('resolves pasted agent, model and avatar links to item ids', () => {
		const { urlToItemResolvers } = m.activitySettings(ORIGIN);
		const id = '4a7d1c2e-1111-4222-8333-444455556666';
		const match = (path) => urlToItemResolvers.map((r) => ({ r, g: new RegExp(r.urlMatchInfo.urlPattern).exec(path) })).find((x) => x.g);
		expect(match(`/agent/${id}`).r.itemId.replace('{id}', match(`/agent/${id}`).g.groups.id)).toBe(`agent-${id}`);
		expect(match(`/m/${id}?ar=1`).r.itemId).toBe('model-{id}');
		expect(match(`/avatars/${id}`).r.itemId).toBe('avatar-{id}');
		expect(match('/agent/not-a-uuid')).toBeUndefined();
		for (const r of urlToItemResolvers) expect(r['@odata.type']).toBe('#microsoft.graph.externalConnectors.itemIdResolver');
	});
});

describe('admin consent', () => {
	it('builds the organizations adminconsent URL with the callback and state', () => {
		const u = new URL(m.adminConsentUrl({ clientId: 'cid', state: 'st', origin: ORIGIN }));
		expect(u.origin + u.pathname).toBe('https://login.microsoftonline.com/organizations/v2.0/adminconsent');
		expect(u.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/microsoft-365/connect/callback`);
		expect(u.searchParams.get('scope')).toBe('https://graph.microsoft.com/.default');
		expect(u.searchParams.get('state')).toBe('st');
	});

	it('reads success, decline and a non-admin from the callback', () => {
		expect(m.parseConsentCallback(new URLSearchParams(`tenant=${TENANT.toUpperCase()}&admin_consent=True&state=s`))).toEqual({ ok: true, state: 's', tenantId: TENANT });
		expect(m.parseConsentCallback({ error: 'access_denied', error_description: 'AADSTS65004: User declined', state: 's' }).code).toBe('consent_declined');
		expect(m.parseConsentCallback({ error: 'invalid_request', error_description: 'AADSTS90094: admin permission required' }).code).toBe('admin_required');
		expect(m.parseConsentCallback({ tenant: TENANT, admin_consent: 'False' }).ok).toBe(false);
	});
});

// ── ACL mapping ─────────────────────────────────────────────────────────────

describe('ACL mapping', () => {
	it('organization grants everyone except guests in the tenant, plus the owner when known', () => {
		expect(m.buildAcl({ tenantId: TENANT, audience: 'organization' })).toEqual([{ type: 'everyoneExceptGuests', value: TENANT, accessType: 'grant' }]);
		expect(m.buildAcl({ tenantId: TENANT, audience: 'organization', ownerObjectId: OWNER_OID })[1]).toEqual({ type: 'user', value: OWNER_OID, accessType: 'grant' });
	});

	it('group grants the admin-chosen Entra group, which covers members with no Microsoft identity', () => {
		expect(m.buildAcl({ tenantId: TENANT, audience: 'group', groupId: GROUP.toUpperCase() })).toEqual([{ type: 'group', value: GROUP, accessType: 'grant' }]);
		expect(() => m.buildAcl({ tenantId: TENANT, audience: 'group' })).toThrow(/Entra group/);
	});

	it('owner grants only the owner, and only when they signed in with Microsoft in that tenant', () => {
		expect(m.buildAcl({ tenantId: TENANT, audience: 'owner', ownerObjectId: OWNER_OID })).toEqual([{ type: 'user', value: OWNER_OID, accessType: 'grant' }]);
		expect(() => m.buildAcl({ tenantId: TENANT, audience: 'owner' })).toThrow(/linked to a Microsoft identity/);
	});

	it('finds the owner object id only for an identity in the connected tenant', () => {
		const subjects = [`${OTHER_TENANT}:${GROUP}`, `${TENANT}:${OWNER_OID}`];
		expect(m.ownerObjectIdInTenant(subjects, TENANT)).toBe(OWNER_OID);
		expect(m.ownerObjectIdInTenant([`${OTHER_TENANT}:${OWNER_OID}`], TENANT)).toBeNull();
		expect(m.ownerObjectIdInTenant([], TENANT)).toBeNull();
	});

	it('refuses a missing tenant and an unknown audience', () => {
		expect(() => m.buildAcl({ tenantId: 'nope', audience: 'organization' })).toThrow(/tenant/);
		expect(() => m.buildAcl({ tenantId: TENANT, audience: 'everyone' })).toThrow(/audience/);
	});
});

// ── Items ───────────────────────────────────────────────────────────────────

describe('item content', () => {
	const acl = [{ type: 'everyoneExceptGuests', value: TENANT, accessType: 'grant' }];
	const agent = {
		kind: 'agent', id: '4a7d1c2e-1111-4222-8333-444455556666', name: 'Café Guide', description: 'Finds coffee',
		skills: ['search', 'maps'], tags: ['food'], category: 'local', greeting: 'Hi!', persona_prompt: 'You are a warm local guide. '.repeat(200),
		profile_image_url: '/img/a.png', is_public: true, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-02T00:00:00Z',
	};

	it('an agent carries persona summary and skills in its text body, and typed properties', () => {
		const ext = m.toExternalItem(m.normalizeSource(agent, { origin: ORIGIN, ownerName: 'Ada' }), acl);
		expect(ext.id).toBe(`agent-${agent.id}`);
		expect(ext.acl).toBe(acl);
		expect(ext.properties).toMatchObject({
			title: 'Café Guide', 'title@odata.type': 'String', itemType: 'agent', url: `${ORIGIN}/agent/${agent.id}`,
			iconUrl: `${ORIGIN}/img/a.png`, createdBy: 'Ada', createdDateTime: '2026-11-01T00:00:00.000Z',
			lastModifiedDateTime: '2026-11-02T00:00:00.000Z', 'tags@odata.type': 'Collection(String)', visibility: 'public',
		});
		expect(ext.properties.tags).toEqual(['food', 'search', 'maps', 'local']);
		expect(ext.content.type).toBe('text');
		expect(ext.content.value).toMatch(/Skills: search, maps/);
		expect(ext.content.value).toMatch(/Persona: You are a warm local guide/);
		expect(ext.content.value.length).toBeLessThan(4000);
		expect(ext.properties['description@odata.type']).toBeUndefined();
	});

	it('a model carries its prompt and tags', () => {
		const ext = m.toExternalItem(m.normalizeSource({ kind: 'model', id: '5b8e2d3f-1111-4222-8333-444455556666', prompt: 'a brass telescope on a tripod', model_category: 'prop', tier: 'pro', preview_image_url: 'https://cdn.example.org/p.webp', created_at: '2026-11-03T00:00:00Z' }, { origin: ORIGIN, ownerName: 'Ada' }), acl);
		expect(ext.properties).toMatchObject({ title: 'a brass telescope on a tripod', itemType: 'model', url: `${ORIGIN}/m/5b8e2d3f-1111-4222-8333-444455556666`, iconUrl: 'https://cdn.example.org/p.webp' });
		expect(ext.properties.tags).toEqual(expect.arrayContaining(['prop', 'pro', '3D model']));
		expect(ext.content.value).toMatch(/prompt: a brass telescope on a tripod/);
	});

	it('the hash changes when content or ACL changes and not otherwise', () => {
		const item = m.normalizeSource(agent, { origin: ORIGIN, ownerName: 'Ada' });
		const h = m.contentHash(m.toExternalItem(item, acl));
		expect(m.contentHash(m.toExternalItem(item, acl))).toBe(h);
		expect(m.contentHash(m.toExternalItem({ ...item, title: 'New' }, acl))).not.toBe(h);
		expect(m.contentHash(m.toExternalItem(item, [{ type: 'group', value: GROUP, accessType: 'grant' }]))).not.toBe(h);
	});
});

// ── Sync planning ───────────────────────────────────────────────────────────

describe('incremental cursor and delete propagation (planning)', () => {
	const row = (n, t) => ({ itemId: `agent-${n}`, updatedAt: t });

	it('first run pushes everything in cursor order', () => {
		const { upserts, deletes } = m.planSync({ current: [row('b', '2026-11-02T00:00:00Z'), row('a', '2026-11-02T00:00:00Z'), row('c', '2026-11-01T00:00:00Z')], indexed: new Map(), cursor: null });
		expect(upserts.map((r) => r.itemId)).toEqual(['agent-c', 'agent-a', 'agent-b']);
		expect(deletes).toEqual([]);
	});

	it('later runs push only rows past the cursor, plus rows never indexed', () => {
		const indexed = new Map([['agent-a', { hash: 'x' }], ['agent-b', { hash: 'y' }]]);
		const cursor = { updatedAt: '2026-11-02T00:00:00.000Z', itemId: 'agent-b' };
		const { upserts } = m.planSync({ current: [row('a', '2026-11-01T00:00:00Z'), row('b', '2026-11-02T00:00:00Z'), row('c', '2026-11-01T00:00:00Z'), row('d', '2026-11-03T00:00:00Z')], indexed, cursor });
		expect(upserts.map((r) => r.itemId)).toEqual(['agent-c', 'agent-d']);
	});

	it('a tie on updated_at is broken by item id so no row is skipped or repeated', () => {
		const cursor = { updatedAt: '2026-11-02T00:00:00.000Z', itemId: 'agent-b' };
		expect(m.isAfterCursor(row('c', '2026-11-02T00:00:00Z'), cursor)).toBe(true);
		expect(m.isAfterCursor(row('a', '2026-11-02T00:00:00Z'), cursor)).toBe(false);
		expect(m.isAfterCursor(row('b', '2026-11-02T00:00:00Z'), cursor)).toBe(false);
	});

	it('indexed items missing from the source are deleted', () => {
		const indexed = new Map([['agent-a', { hash: 'x' }], ['model-z', { hash: 'y' }]]);
		expect(m.planSync({ current: [row('a', '2026-11-01T00:00:00Z')], indexed, cursor: null }).deletes).toEqual(['model-z']);
	});

	it('the cursor never moves backwards', () => {
		const c = { updatedAt: '2026-11-05T00:00:00.000Z', itemId: 'agent-a' };
		expect(m.advanceCursor(c, row('z', '2026-11-01T00:00:00Z'))).toBe(c);
		expect(m.advanceCursor(c, row('b', '2026-11-05T00:00:00Z'))).toEqual({ updatedAt: '2026-11-05T00:00:00.000Z', itemId: 'agent-b' });
	});
});

// ── Throttling ──────────────────────────────────────────────────────────────

function res(status, body = {}, headers = {}) {
	const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
	return { ok: status >= 200 && status < 300, status, headers: { get: (k) => h.get(k.toLowerCase()) ?? null }, json: async () => body, text: async () => JSON.stringify(body) };
}

describe('throttling backoff', () => {
	it('parses Retry-After as seconds or an HTTP date', () => {
		expect(m.parseRetryAfter('7')).toBe(7000);
		expect(m.parseRetryAfter('Wed, 11 Nov 2026 12:00:30 GMT', Date.parse('Wed, 11 Nov 2026 12:00:00 GMT'))).toBe(30000);
		expect(m.parseRetryAfter(null)).toBeNull();
		expect(m.parseRetryAfter('soon')).toBeNull();
	});

	it('waits exactly what Retry-After asks, then succeeds', async () => {
		const fetchImpl = vi.fn().mockResolvedValueOnce(res(429, { error: { code: 'TooManyRequests' } }, { 'Retry-After': '3' })).mockResolvedValueOnce(res(200, { ok: true }));
		const sleep = vi.fn(async () => {});
		const r = await m.graphRequest({ token: 't', url: '/external/connections', fetchImpl, sleep });
		expect(r.status).toBe(200);
		expect(sleep).toHaveBeenCalledWith(3000);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(fetchImpl.mock.calls[0][0]).toBe('https://graph.microsoft.com/v1.0/external/connections');
	});

	it('falls back to exponential backoff without Retry-After, capped per wait', async () => {
		const fetchImpl = vi.fn().mockResolvedValueOnce(res(503)).mockResolvedValueOnce(res(503)).mockResolvedValueOnce(res(200));
		const sleep = vi.fn(async () => {});
		await m.graphRequest({ token: 't', url: '/x', fetchImpl, sleep });
		expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
		expect(m.backoffDelay(10, null)).toBe(m.MAX_RETRY_WAIT_MS);
		expect(m.backoffDelay(1, 600_000)).toBe(m.MAX_RETRY_WAIT_MS);
	});

	it('gives up after the attempt budget with the Retry-After kept for scheduling', async () => {
		const fetchImpl = vi.fn(async () => res(429, { error: { code: 'TooManyRequests', message: 'slow down' } }, { 'Retry-After': '20' }));
		const err = await m.graphRequest({ token: 't', url: '/x', fetchImpl, sleep: async () => {}, maxAttempts: 3 }).catch((e) => e);
		expect(err).toBeInstanceOf(m.GraphError);
		expect(err).toMatchObject({ status: 429, code: 'TooManyRequests', retryAfterMs: 20000 });
		expect(fetchImpl).toHaveBeenCalledTimes(3);
		expect(m.explainFailure(err).code).toBe('throttled');
	});

	it('does not retry a 401 and explains it', async () => {
		const fetchImpl = vi.fn(async () => res(401, { error: { code: 'InvalidAuthenticationToken', message: 'Access token is empty.' } }));
		const err = await m.graphRequest({ token: '', url: '/external/connections', fetchImpl, sleep: async () => {} }).catch((e) => e);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(err).toMatchObject({ status: 401, code: 'InvalidAuthenticationToken', retryAfterMs: null });
		expect(m.explainFailure(err).code).toBe('unauthorized');
	});
});

// ── Sync against the real migration ─────────────────────────────────────────

const graph = { items: new Map(), connections: new Set(), calls: [], throttleNextPut: 0, schemaStatus: 'completed' };

async function fakeMicrosoft(url, init = {}) {
	const u = new URL(url);
	const method = init.method || 'GET';
	graph.calls.push(`${method} ${u.pathname}`);
	if (u.hostname === 'login.microsoftonline.com') return res(200, { token_type: 'Bearer', access_token: 'app-token', expires_in: 3599 });
	const base = '/v1.0/external/connections';
	if (method === 'POST' && u.pathname === base) {
		const body = JSON.parse(init.body);
		if (graph.connections.has(body.id)) return res(409, { error: { code: 'NameAlreadyExists', message: 'exists' } });
		graph.connections.add(body.id);
		return res(201, { id: body.id, state: 'draft' });
	}
	let mm = u.pathname.match(/^\/v1\.0\/external\/connections\/([^/]+)\/schema$/);
	if (mm) return res(202, {}, { Location: `https://graph.microsoft.com/v1.0/external/connections/${mm[1]}/operations/op-1` });
	if (/\/operations\//.test(u.pathname)) return res(200, { id: 'op-1', status: graph.schemaStatus });
	mm = u.pathname.match(/^\/v1\.0\/external\/connections\/([^/]+)\/items\/([^/]+)$/);
	if (mm) {
		const id = decodeURIComponent(mm[2]);
		if (method === 'PUT') {
			if (graph.throttleNextPut > 0) {
				graph.throttleNextPut--;
				return res(429, { error: { code: 'TooManyRequests' } }, { 'Retry-After': '30' });
			}
			graph.items.set(id, JSON.parse(init.body));
			return res(200, {});
		}
		if (method === 'DELETE') {
			graph.items.delete(id);
			return res(204);
		}
	}
	mm = u.pathname.match(/^\/v1\.0\/external\/connections\/([^/]+)$/);
	if (mm && method === 'DELETE') {
		graph.connections.delete(mm[1]);
		graph.items.clear();
		return res(204);
	}
	return res(404, { error: { code: 'itemNotFound' } });
}

const opts = { fetchImpl: fakeMicrosoft, sleep: async () => {}, origin: ORIGIN };
const A1 = '10000000-0000-4000-8000-000000000001';
const A2 = '10000000-0000-4000-8000-000000000002';
const M1 = '20000000-0000-4000-8000-000000000001';
const V1 = '30000000-0000-4000-8000-000000000001';

describe('sync against the real migration', () => {
	beforeAll(async () => {
		dbState.pg = new PGlite();
		await dbState.pg.exec(`
			create table users (id uuid primary key, display_name text, username text);
			create table user_identities (id serial primary key, user_id uuid, provider text, subject text);
			create table agent_identities (id uuid primary key, user_id uuid, name text, description text, skills text[], tags text[], category text,
				greeting text, persona_prompt text, profile_image_url text, avatar_url text, is_public boolean, created_at timestamptz,
				updated_at timestamptz, deleted_at timestamptz);
			create table forge_creations (id uuid primary key, user_id uuid, prompt text, model_category text, tier text, multiview boolean,
				refine_instruction text, size_bytes bigint, preview_image_url text, glb_url text, visibility text, status text,
				superseded_by uuid, internal boolean, created_at timestamptz, updated_at timestamptz);
			create table avatars (id uuid primary key, owner_id uuid, name text, description text, tags text[], model_category text,
				alt_text text, thumbnail_key text, visibility text, created_at timestamptz, updated_at timestamptz, deleted_at timestamptz);
		`);
		await dbState.pg.exec(readFileSync(new URL('../api/_lib/migrations/20261111160500_m365_copilot_connector.sql', import.meta.url), 'utf8'));
		await dbState.pg.query(`insert into users (id, display_name) values ($1, 'Ada')`, [USER]);
		await dbState.pg.query(`insert into user_identities (user_id, provider, subject) values ($1, 'microsoft', $2)`, [USER, `${TENANT}:${OWNER_OID}`]);
		await dbState.pg.query(`insert into agent_identities values ($1, $2, 'Guide', 'Helps', '{search}', '{}', null, null, null, null, null, true, '2026-11-01', '2026-11-01', null)`, [A1, USER]);
		await dbState.pg.query(`insert into agent_identities values ($1, $2, 'Secret', 'Hidden', '{}', '{}', null, null, null, null, null, false, '2026-11-01', '2026-11-01', null)`, [A2, USER]);
		await dbState.pg.query(`insert into forge_creations values ($1, $2, 'a brass telescope', 'prop', 'pro', false, null, 2048, null, 'https://cdn/x.glb', null, 'done', null, false, '2026-11-02', '2026-11-02')`, [M1, USER]);
		await dbState.pg.query(`insert into avatars values ($1, $2, 'Knight', 'Armored', '{medieval}', null, null, null, 'public', '2026-11-03', '2026-11-03', null)`, [V1, USER]);
	});

	beforeEach(() => {
		graph.calls = [];
	});

	it('consent, provisioning and the schema poll bring the connection to ready', async () => {
		await m.saveConsent(USER, TENANT);
		const p = await m.provisionConnection(USER, opts);
		expect(p.status).toBe('schema_pending');
		expect(graph.connections.has(m.connectionIdFor(USER))).toBe(true);
		expect(graph.calls).toContain(`PATCH /v1.0/external/connections/${m.connectionIdFor(USER)}/schema`);
		expect(await m.pollSchema(USER, opts)).toBe('ready');
	});

	it('first sync pushes public items with the org ACL plus the owner, and skips private ones', async () => {
		const r = await m.runSync(USER, opts);
		expect(r).toMatchObject({ upserted: 3, deleted: 0, complete: true });
		expect([...graph.items.keys()].sort()).toEqual([`agent-${A1}`, `avatar-${V1}`, `model-${M1}`]);
		expect(graph.items.get(`agent-${A1}`).acl).toEqual([
			{ type: 'everyoneExceptGuests', value: TENANT, accessType: 'grant' },
			{ type: 'user', value: OWNER_OID, accessType: 'grant' },
		]);
		const s = await m.connectorStatus(USER);
		expect(s).toMatchObject({ status: 'ready', itemsIndexed: 3, counts: { agents: 1, models: 1, avatars: 1 }, ownerInTenant: true, lastError: null });
		expect(s.lastFullSyncAt).toBeTruthy();
	});

	it('an incremental run with nothing changed sends nothing to Graph', async () => {
		const r = await m.runSync(USER, opts);
		expect(r).toMatchObject({ upserted: 0, deleted: 0, complete: true });
		expect(graph.calls.filter((c) => c.includes('/items/'))).toEqual([]);
	});

	it('an edited item is re-pushed alone', async () => {
		await dbState.pg.query(`update agent_identities set description = 'Helps more', updated_at = '2026-11-10' where id = $1`, [A1]);
		const r = await m.runSync(USER, opts);
		expect(r.upserted).toBe(1);
		expect(graph.calls.filter((c) => c.startsWith('PUT'))).toEqual([`PUT /v1.0/external/connections/${m.connectionIdFor(USER)}/items/agent-${A1}`]);
		expect(graph.items.get(`agent-${A1}`).properties.description).toBe('Helps more');
	});

	it('hard-deleted, soft-deleted and now-private items are deleted from the tenant', async () => {
		await dbState.pg.query(`delete from forge_creations where id = $1`, [M1]);
		await dbState.pg.query(`update avatars set visibility = 'private' where id = $1`, [V1]);
		const r = await m.runSync(USER, opts);
		expect(r.deleted).toBe(2);
		expect([...graph.items.keys()]).toEqual([`agent-${A1}`]);
		expect((await m.connectorStatus(USER)).itemsIndexed).toBe(1);
	});

	it('a throttled run stops, keeps its place, schedules the retry from Retry-After, and the next run resumes', async () => {
		await dbState.pg.query(`update agent_identities set is_public = true, updated_at = '2026-11-11' where id = $1`, [A2]);
		graph.throttleNextPut = 10;
		const r = await m.runSync(USER, opts);
		expect(r.error.code).toBe('throttled');
		let s = await m.connectorStatus(USER);
		expect(s.status).toBe('ready');
		expect(new Date(s.nextAttemptAt).getTime()).toBeGreaterThan(Date.now() + 20_000);
		expect(await m.runSync(USER, opts)).toEqual({ skipped: 'backing_off' });
		graph.throttleNextPut = 0;
		const r2 = await m.runSync(USER, { ...opts, force: true });
		expect(r2).toMatchObject({ upserted: 1, complete: true });
		s = await m.connectorStatus(USER);
		expect(s).toMatchObject({ itemsIndexed: 2, lastError: null, nextAttemptAt: null });
	});

	it('switching to a group audience re-pushes every item with the group ACL', async () => {
		await m.updateSettings(USER, { audience: 'group', groupId: GROUP });
		const r = await m.runSync(USER, opts);
		expect(r.upserted).toBe(2);
		for (const it of graph.items.values()) expect(it.acl[0]).toEqual({ type: 'group', value: GROUP, accessType: 'grant' });
	});

	it('a full re-sync re-pushes everything even when nothing changed', async () => {
		await m.resetForFullSync(USER);
		expect((await m.runSync(USER, opts)).upserted).toBe(2);
	});

	it('disconnect deletes the connection in the tenant and the stored link', async () => {
		const r = await m.disconnect(USER, opts);
		expect(r).toMatchObject({ removed: true, remoteDeleted: true });
		expect(graph.connections.size).toBe(0);
		expect(await m.getConnection(USER)).toBeNull();
		expect((await dbState.pg.query('select count(*)::int n from m365_connector_items')).rows[0].n).toBe(0);
	});
});
