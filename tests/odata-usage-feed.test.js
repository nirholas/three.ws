// OData v4 usage feed (api/odata/v1.js over api/_lib/usage-feed.js and
// api/_lib/odata/*): the strict query parser as units, then the real HTTP
// handlers on an in-process Postgres (PGlite) carrying the full production
// schema (schema.sql plus every migration), so scoping, paging and auth are
// proven against the tables production has.
//
// The load-bearing assertions: no feed key ever returns a row of a person
// outside its scope (personal key: its creator; team key: the team owner plus
// active team people), a team key dies when its creator stops owning the team,
// paging walks every row exactly once, and key creation and use are audited.

import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createPgliteSql } from './_helpers/pglite-sql.js';
import { createFullSchemaDb } from './_helpers/pglite-full-schema.js';
import { invoke } from './_helpers/scim-harness.js';
import {
	tokenize, parseFilter, compileFilter, Params, parseQueryOptions, pageWindow, preferredPageSize, ODataError,
} from '../api/_lib/odata/query.js';

const holder = vi.hoisted(() => ({ db: null, session: null, limit: { key: true, fail: true, write: true } }));

vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});
vi.mock('../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	const verdict = (ok) => ({ success: ok, limit: 10, remaining: ok ? 9 : 0, reset: Date.now() + 60_000 });
	return {
		...actual,
		clientIp: () => '203.0.113.7',
		limits: new Proxy({}, {
			get: (_t, name) => async () => {
				if (name === 'usageFeedKey') return verdict(holder.limit.key);
				if (name === 'usageFeedAuthFail') return verdict(holder.limit.fail);
				if (name === 'usageFeedKeyWrite') return verdict(holder.limit.write);
				return verdict(true);
			},
		}),
	};
});
vi.mock('../api/_lib/auth.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, getSessionUser: async () => holder.session };
});
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: async () => true }));

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';
process.env.PUBLIC_APP_ORIGIN = 'https://feed.test';

const PROPS = {
	Id: { type: 'Edm.String' },
	Date: { type: 'Edm.Date' },
	Timestamp: { type: 'Edm.DateTimeOffset' },
	Tool: { type: 'Edm.String' },
	Quantity: { type: 'Edm.Int64' },
	CostUsd: { type: 'Edm.Decimal' },
};

const expectODataError = (fn, status) => {
	try {
		fn();
	} catch (e) {
		expect(e).toBeInstanceOf(ODataError);
		expect(e.status).toBe(status);
		return e;
	}
	throw new Error('expected an ODataError');
};

describe('OData query parser', () => {
	it('tokenizes every literal kind', () => {
		const t = tokenize("Tool eq 'it''s' and Quantity ge 10 and CostUsd lt 1.5 and Date ge 2026-01-31 and Timestamp lt 2026-02-01T00:00:00Z and Tool ne null");
		const lits = t.filter((x) => x.kind === 'lit').map((x) => [x.edm, x.value]);
		expect(lits).toEqual([
			['Edm.String', "it's"],
			['Edm.Int64', 10],
			['Edm.Decimal', '1.5'],
			['Edm.Date', '2026-01-31'],
			['Edm.DateTimeOffset', '2026-02-01T00:00:00.000Z'],
			[null, null],
		]);
	});

	it('rejects impossible dates and unterminated strings with 400', () => {
		expectODataError(() => tokenize('Date eq 2026-02-30'), 400);
		expectODataError(() => tokenize("Tool eq 'open"), 400);
	});

	it('compiles a Power Query style date range to bound parameters', () => {
		const ast = parseFilter('Date ge 2026-01-01 and Date lt 2026-02-01', PROPS);
		const p = new Params();
		expect(compileFilter(ast, p)).toBe('((e."Date" >= $1::date) and (e."Date" < $2::date))');
		expect(p.values).toEqual(['2026-01-01', '2026-02-01']);
	});

	it('compiles functions, not, null checks and Date-vs-DateTimeOffset in UTC', () => {
		const p = new Params();
		const sql = compileFilter(parseFilter("not contains(Tool,'gen') or year(Timestamp) eq 2026 or Tool eq null or Timestamp ge 2026-03-01", PROPS), p);
		expect(sql).toContain('strpos(e."Tool", $1::text) > 0');
		expect(sql).toContain(`extract(year from (e."Timestamp" at time zone 'UTC'))::int`);
		expect(sql).toContain('(e."Tool" is null)');
		expect(sql).toContain(`($3::date::timestamp at time zone 'UTC')`);
		expect(sql).toContain('not coalesce(');
	});

	it('never lets an identifier reach SQL unless it is a declared property', () => {
		expectODataError(() => parseFilter('Secret eq 1', PROPS), 400);
		expectODataError(() => parseFilter("Tool eq 'x'; drop table users", PROPS), 400);
		expectODataError(() => parseQueryOptions(new URLSearchParams('$orderby=Tool;drop'), PROPS), 501);
	});

	it('type-checks comparisons and function arguments', () => {
		expectODataError(() => parseFilter("Quantity eq 'ten'", PROPS), 400);
		expectODataError(() => parseFilter('year(Tool) eq 2026', PROPS), 400);
		expectODataError(() => parseFilter('Quantity gt null', PROPS), 400);
		expectODataError(() => parseFilter('Tool', PROPS), 400);
	});

	it('answers 501 for operators and functions outside the subset', () => {
		expectODataError(() => parseFilter("Tool in ('a','b')", PROPS), 501);
		expectODataError(() => parseFilter('round(CostUsd) eq 1', PROPS), 501);
		expectODataError(() => parseQueryOptions(new URLSearchParams('$expand=Owner'), PROPS), 501);
		expectODataError(() => parseQueryOptions(new URLSearchParams('$format=xml'), PROPS), 501);
	});

	it('rejects unknown, duplicated and malformed system options with 400', () => {
		expectODataError(() => parseQueryOptions(new URLSearchParams('$bogus=1'), PROPS), 400);
		expectODataError(() => parseQueryOptions(new URLSearchParams('$top=1&$TOP=2'), PROPS), 400);
		expectODataError(() => parseQueryOptions(new URLSearchParams('$top=-1'), PROPS), 400);
		expectODataError(() => parseQueryOptions(new URLSearchParams('$count=yes'), PROPS), 400);
		expectODataError(() => parseQueryOptions(new URLSearchParams('$select=Nope'), PROPS), 400);
	});

	it('parses select, orderby and paging options', () => {
		const o = parseQueryOptions(new URLSearchParams('$select=Tool,Date&$orderby=Date desc,Tool&$top=50&$skip=5&$count=true&custom=1'), PROPS);
		expect(o.select).toEqual(['Tool', 'Date']);
		expect(o.orderBy).toEqual([{ name: 'Date', dir: 'desc' }, { name: 'Tool', dir: 'asc' }]);
		expect([o.top, o.skip, o.count, o.skipToken]).toEqual([50, 5, true, 0]);
	});

	it('computes the page window from $top, $skip, the page size and the skip token', () => {
		expect(pageWindow({ top: null, skip: 0, skipToken: 0 }, 1000)).toEqual({ offset: 0, limit: 1000 });
		expect(pageWindow({ top: 15, skip: 5, skipToken: 10 }, 10)).toEqual({ offset: 15, limit: 5 });
		expect(pageWindow({ top: 15, skip: 0, skipToken: 15 }, 10)).toEqual({ offset: 15, limit: 0 });
		expect(pageWindow({ top: null, skip: 0, skipToken: 0 }, 99999)).toEqual({ offset: 0, limit: 1000 });
		expect(preferredPageSize('odata.maxpagesize=250')).toBe(250);
		expect(preferredPageSize('return=minimal, odata.maxpagesize=5000')).toBe(1000);
		expect(preferredPageSize('')).toBeNull();
	});
});

// The OASIS OData v4.0 edmx.xsd and edm.xsd, via scripts/validate-odata-csdl.py
// (python3 with lxml; the schemas are fetched once into ~/.cache).
const hasLxml = spawnSync('python3', ['-c', 'import lxml'], { stdio: 'ignore' }).status === 0;

describe('$metadata', () => {
	it.skipIf(!hasLxml)('validates against the OData v4.0 CSDL XML schema', () => {
		const r = spawnSync('python3', ['scripts/validate-odata-csdl.py'], { encoding: 'utf8', timeout: 60_000 });
		expect(r.stdout + r.stderr).toMatch(/^VALID: .*5 entity types, 5 entity sets/m);
		expect(r.status).toBe(0);
	});
});

// ── integration ─────────────────────────────────────────────────────────────

const U = {
	owner: '00000000-0000-4000-8000-0000000000a1',
	member: '00000000-0000-4000-8000-0000000000b2',
	other: '00000000-0000-4000-8000-0000000000c3',
	gone: '00000000-0000-4000-8000-0000000000d4',
};
const T = { main: '00000000-0000-4000-8000-0000000000e1', otherTeam: '00000000-0000-4000-8000-0000000000e2' };
const TOOL_CALLS_OWNER = 25;

let fullPg;
let feed;
let handler;
let keysHandler;

const basic = (token, user = 'powerbi') => ({ authorization: `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}` });
const get = (path, token, headers = {}) => invoke(handler, { url: `/api/odata/v1${path}`, headers: token ? { ...basic(token), ...headers } : headers });

async function seed(sql) {
	for (const [name, id] of Object.entries(U)) {
		await sql`insert into users (id, email, display_name) values (${id}, ${`${name}@example.test`}, ${name})`;
	}
	await sql`insert into teams (id, owner_user_id, name, status) values (${T.main}, ${U.owner}, 'Finance', 'active')`;
	await sql`insert into teams (id, owner_user_id, name, status) values (${T.otherTeam}, ${U.other}, 'Elsewhere', 'active')`;
	await sql`insert into team_people (team_id, user_id, source, status) values (${T.main}, ${U.member}, 'tenant_join', 'active')`;
	await sql`insert into team_people (team_id, user_id, source, status) values (${T.main}, ${U.gone}, 'scim', 'deactivated')`;
	for (const id of Object.values(U)) {
		await sql`insert into usage_events (user_id, kind, tool, status, latency_ms, created_at) values (${id}, 'tool_call', 'generate_avatar', 'ok', 120, '2026-11-01T10:00:00Z')`;
		await sql`insert into usage_events (user_id, kind, provider, model, input_tokens, output_tokens, cost_micro_usd, created_at)
			values (${id}, 'llm', 'anthropic', 'claude-sonnet-5-5', 1000, 200, 4500, '2026-11-02T08:00:00Z')`;
		await sql`insert into usage_events (user_id, kind, meter_action, units, price_usdc_atomics, settlement_kind, idempotency_key, created_at)
			values (${id}, 'metered', 'forge.high', 1, 250000, 'x402', ${`idem-${id}`}, '2026-11-03T09:00:00Z')`;
		await sql`insert into forge_creations (id, client_key, prompt, status, tier, user_id, created_at, completed_at)
			values (gen_random_uuid(), 'ck', 'a lamp', 'done', 'standard', ${id}, '2026-11-04T10:00:00Z', '2026-11-04T10:01:30Z')`;
	}
	for (let i = 1; i < TOOL_CALLS_OWNER; i++) {
		await sql`insert into usage_events (user_id, kind, tool, status, created_at)
			values (${U.owner}, 'tool_call', ${i % 2 ? 'list_avatars' : 'render_avatar'}, ${i % 5 ? 'ok' : 'error'}, ${new Date(Date.UTC(2026, 10, 5, 0, i)).toISOString()})`;
	}
	await sql`insert into microsoft_saas_subscriptions (id, user_id, plan_id, saas_status) values ('sub-owner', ${U.owner}, 'team', 'Subscribed')`;
	await sql`insert into microsoft_saas_usage_events (subscription_id, plan_id, dimension, effective_start_time, quantity, status)
		values ('sub-owner', 'team', 'generations', '2026-11-03T09:00:00Z', 12, 'accepted')`;
}

async function allRows(path, token, pageSize = 7) {
	const rows = [];
	let url = path;
	let pages = 0;
	for (;;) {
		const r = await get(url, token, { prefer: `odata.maxpagesize=${pageSize}` });
		expect(r.status, JSON.stringify(r.json)).toBe(200);
		rows.push(...r.json.value);
		pages++;
		const next = r.json['@odata.nextLink'];
		if (!next) break;
		url = next.replace('https://feed.test/api/odata/v1', '');
	}
	return { rows, pages };
}

describe('OData usage feed over the full schema', () => {
	let keys;

	beforeAll(async () => {
		({ pg: fullPg } = await createFullSchemaDb());
		feed = await import('../api/_lib/usage-feed.js');
		handler = (await import('../api/odata/v1.js')).default;
		keysHandler = (await import('../api/usage/feed-keys.js')).default;
	}, 300_000);

	beforeEach(async () => {
		await fullPg.exec('begin');
		holder.db = createPgliteSql({ pg: fullPg });
		holder.limit = { key: true, fail: true, write: true };
		holder.session = null;
		await seed(holder.db.sql);
		keys = {
			teamOwner: (await feed.createFeedKey({ userId: U.owner, name: 'Finance BI', teamId: T.main })).token,
			ownerPersonal: (await feed.createFeedKey({ userId: U.owner, name: 'Mine' })).token,
			member: (await feed.createFeedKey({ userId: U.member, name: 'Member' })).token,
			otherTeam: (await feed.createFeedKey({ userId: U.other, name: 'Other', teamId: T.otherTeam })).token,
		};
		return async () => {
			await new Promise((r) => setTimeout(r, 20));
			await fullPg.exec('rollback');
		};
	});

	it('challenges an anonymous request with Basic so Power BI prompts for credentials', async () => {
		const r = await get('/', null);
		expect(r.status).toBe(401);
		expect(r.headers['www-authenticate']).toMatch(/^Basic realm=/);
		expect(r.json.error.code).toBe('Unauthorized');
	});

	it('rejects a wrong key, and rate limits repeated failures per address', async () => {
		expect((await get('/', 'tws_feed_wrong')).status).toBe(401);
		holder.limit.fail = false;
		expect((await get('/', 'tws_feed_wrong')).status).toBe(429);
	});

	it('rate limits a key over its budget', async () => {
		holder.limit.key = false;
		const r = await get('/UsageDaily', keys.teamOwner);
		expect(r.status).toBe(429);
		expect(r.json.error.code).toBe('TooManyRequests');
	});

	it('accepts the key as the Basic password, the Basic username, or a Bearer token', async () => {
		expect((await get('/', keys.member)).status).toBe(200);
		expect((await invoke(handler, { url: '/api/odata/v1/', headers: { authorization: `Basic ${Buffer.from(`${keys.member}:`).toString('base64')}` } })).status).toBe(200);
		expect((await invoke(handler, { url: '/api/odata/v1/', headers: { authorization: `Bearer ${keys.member}` } })).status).toBe(200);
	});

	it('serves the service document and $metadata', async () => {
		const svc = await get('/', keys.member);
		expect(svc.headers['odata-version']).toBe('4.0');
		expect(svc.json['@odata.context']).toBe('https://feed.test/api/odata/v1/$metadata');
		expect(svc.json.value.map((v) => v.name)).toEqual(['UsageDaily', 'McpToolCalls', 'LlmUsage', 'Generations', 'Billing']);
		const md = await get('/$metadata', keys.member);
		expect(md.headers['content-type']).toMatch(/^application\/xml/);
		expect(md.body).toContain('<EntitySet Name="McpToolCalls" EntityType="ThreeWs.Usage.McpToolCalls">');
	});

	const scopes = [
		['team owner key', 'teamOwner', [U.owner, U.member]],
		['owner personal key', 'ownerPersonal', [U.owner]],
		['member personal key', 'member', [U.member]],
		['other team key', 'otherTeam', [U.other]],
	];
	for (const set of ['UsageDaily', 'McpToolCalls', 'LlmUsage', 'Generations', 'Billing']) {
		it(`scopes ${set} to exactly the people each key may see`, async () => {
			for (const [, key, allowed] of scopes) {
				const { rows } = await allRows(`/${set}`, keys[key]);
				const seen = new Set(rows.map((r) => r.UserId));
				expect([...seen].sort()).toEqual([...allowed].sort());
				expect(seen.has(U.gone)).toBe(false);
			}
		});
	}

	it('labels team rows with the team and personal rows with none', async () => {
		const team = await get('/LlmUsage', keys.teamOwner);
		expect(new Set(team.json.value.map((r) => r.TeamName))).toEqual(new Set(['Finance']));
		const personal = await get('/LlmUsage', keys.member);
		expect(personal.json.value.every((r) => r.TeamId === null)).toBe(true);
	});

	it('refuses a team key to anyone but the team owner', async () => {
		await expect(feed.createFeedKey({ userId: U.member, name: 'Sneaky', teamId: T.main })).rejects.toMatchObject({ status: 403 });
		await expect(feed.createFeedKey({ userId: U.owner, name: 'Sneaky', teamId: T.otherTeam })).rejects.toMatchObject({ status: 403 });
	});

	it('ends a team key when the team changes owner or is archived, and a revoked key at once', async () => {
		await holder.db.sql`update teams set owner_user_id = ${U.other} where id = ${T.main}`;
		expect((await get('/UsageDaily', keys.teamOwner)).status).toBe(401);
		await holder.db.sql`update teams set owner_user_id = ${U.owner}, archived_at = now() where id = ${T.main}`;
		expect((await get('/UsageDaily', keys.teamOwner)).status).toBe(401);
		const [row] = await holder.db.sql`select id from usage_feed_keys where user_id = ${U.member}`;
		await feed.revokeFeedKey({ userId: U.member, id: row.id });
		expect((await get('/UsageDaily', keys.member)).status).toBe(401);
	});

	it('pages with @odata.nextLink until every row is read exactly once', async () => {
		const total = TOOL_CALLS_OWNER;
		const { rows, pages } = await allRows('/McpToolCalls?$count=true', keys.ownerPersonal, 10);
		expect(rows).toHaveLength(total);
		expect(new Set(rows.map((r) => r.Id)).size).toBe(total);
		expect(pages).toBe(3);
		const first = await get('/McpToolCalls?$count=true', keys.ownerPersonal, { prefer: 'odata.maxpagesize=10' });
		expect(first.json['@odata.count']).toBe(total);
		expect(first.headers['preference-applied']).toBe('odata.maxpagesize=10');
		expect(first.json['@odata.nextLink']).toBe('https://feed.test/api/odata/v1/McpToolCalls?$count=true&$skiptoken=10');
	});

	it('honours $top across server pages', async () => {
		const { rows, pages } = await allRows('/McpToolCalls?$top=15', keys.ownerPersonal, 10);
		expect(rows).toHaveLength(15);
		expect(pages).toBe(2);
	});

	it('applies $filter, $select, $orderby and /$count', async () => {
		const r = await get(`/McpToolCalls?$filter=Status eq 'error' and Timestamp ge 2026-11-05&$select=Tool,Status&$orderby=Tool desc`, keys.ownerPersonal);
		expect(r.status).toBe(200);
		expect(r.json['@odata.context']).toBe('https://feed.test/api/odata/v1/$metadata#McpToolCalls(Tool,Status)');
		expect(r.json.value.length).toBe(4);
		expect(Object.keys(r.json.value[0])).toEqual(['Tool', 'Status']);
		expect(r.json.value.every((v) => v.Status === 'error')).toBe(true);
		const c = await get(`/McpToolCalls/$count?$filter=Status eq 'error'`, keys.ownerPersonal);
		expect(c.headers['content-type']).toMatch(/^text\/plain/);
		expect(c.body).toBe('4');
	});

	it('serializes typed values: Date, DateTimeOffset, Int64 and Decimal', async () => {
		const llm = (await get('/LlmUsage', keys.member)).json.value[0];
		expect(llm).toMatchObject({ Date: '2026-11-02', Model: 'claude-sonnet-5-5', Calls: 1, InputTokens: 1000, OutputTokens: 200, CostUsd: 0.0045 });
		const gen = (await get('/Generations', keys.member)).json.value[0];
		expect(gen).toMatchObject({ CreatedAt: '2026-11-04T10:00:00.000Z', Tier: 'standard', DurationSeconds: 90, Status: 'done' });
	});

	it('reports Microsoft Marketplace metering and metered charges under Billing', async () => {
		const rows = (await get('/Billing?$orderby=Source', keys.ownerPersonal)).json.value;
		expect(rows.find((r) => r.Source === 'microsoft_marketplace')).toMatchObject({ Dimension: 'generations', Quantity: 12, Plan: 'team', Status: 'accepted', Granularity: 'hour' });
		expect(rows.find((r) => r.Source === 'x402')).toMatchObject({ Dimension: 'forge.high', Quantity: 1, AmountUsd: 0.25, Granularity: 'day', PeriodStart: '2026-11-03T00:00:00.000Z' });
	});

	it('reads one row by key and 404s an unknown key or set', async () => {
		const first = (await get('/UsageDaily?$top=1', keys.member)).json.value[0];
		const one = await get(`/UsageDaily('${encodeURIComponent(first.Id)}')`, keys.member);
		expect(one.status).toBe(200);
		expect(one.json.Id).toBe(first.Id);
		expect((await get(`/UsageDaily('nope')`, keys.member)).status).toBe(404);
		expect((await get('/Secrets', keys.member)).status).toBe(404);
	});

	it('reads a row whose key holds a slash, sent unencoded as OData clients do', async () => {
		await holder.db.sql`insert into usage_events (user_id, kind, provider, model, created_at)
			values (${U.member}, 'llm', 'cloudflare', '@cf/meta/llama-3.3-70b-instruct', '2026-11-06T08:00:00Z')`;
		const row = (await get(`/LlmUsage?$filter=Provider eq 'cloudflare'`, keys.member)).json.value[0];
		expect(row.Id).toContain('/');
		const raw = await get(`/LlmUsage('${row.Id}')`, keys.member);
		expect(raw.status, JSON.stringify(raw.json)).toBe(200);
		expect(raw.json.Model).toBe('@cf/meta/llama-3.3-70b-instruct');
		const encoded = await get(`/LlmUsage('${encodeURIComponent(row.Id)}')`, keys.member);
		expect(encoded.json.Id).toBe(row.Id);
	});

	it('answers bad queries with OData errors, not 500s', async () => {
		const r = await get('/UsageDaily?$filter=Nope eq 1', keys.member);
		expect(r.status).toBe(400);
		expect(r.json.error.code).toBe('BadRequest');
		expect((await get('/UsageDaily?$expand=X', keys.member)).status).toBe(501);
		expect((await invoke(handler, { method: 'POST', url: '/api/odata/v1/UsageDaily', headers: basic(keys.member) })).status).toBe(405);
	});

	it('audits key creation, and key use once per hour rather than per request', async () => {
		await get('/', keys.member);
		await get('/UsageDaily', keys.member);
		await new Promise((r) => setTimeout(r, 30));
		const rows = await holder.db.sql`select action from audit_log where user_id = ${U.member} order by action`;
		expect(rows.map((r) => r.action)).toEqual(['usage_feed.key_created', 'usage_feed.key_used']);
		const [k] = await holder.db.sql`select last_used_at from usage_feed_keys where user_id = ${U.member}`;
		expect(k.last_used_at).not.toBeNull();
	});

	it('lets a signed-in person list, create and revoke keys through /api/usage/feed-keys', async () => {
		expect((await invoke(keysHandler, { url: '/api/usage/feed-keys', headers: { 'content-type': 'application/json' } })).status).toBe(401);
		holder.session = { id: U.owner };
		const list = await invoke(keysHandler, { url: '/api/usage/feed-keys', headers: { 'content-type': 'application/json' } });
		expect(list.status).toBe(200);
		expect(list.json.feed_url).toBe('https://feed.test/api/odata/v1/');
		expect(list.json.teams.map((t) => t.name)).toEqual(['Finance']);
		expect(list.json.keys.map((k) => k.name).sort()).toEqual(['Finance BI', 'Mine']);
		expect(JSON.stringify(list.json)).not.toContain('token_hash');

		const created = await invoke(keysHandler, { method: 'POST', url: '/api/usage/feed-keys', headers: { 'content-type': 'application/json' }, body: { name: 'Excel', team_id: T.main } });
		expect(created.status).toBe(201);
		expect(created.json.token).toMatch(/^tws_feed_/);
		expect(created.json.key).toMatchObject({ name: 'Excel', team_name: 'Finance' });
		expect((await get('/', created.json.token)).status).toBe(200);

		const bad = await invoke(keysHandler, { method: 'POST', url: '/api/usage/feed-keys', headers: { 'content-type': 'application/json' }, body: { name: '  ' } });
		expect(bad.status).toBe(400);

		const del = await invoke(keysHandler, { method: 'DELETE', url: `/api/usage/feed-keys?id=${created.json.key.id}`, headers: { 'content-type': 'application/json' } });
		expect(del.status).toBe(200);
		expect((await get('/', created.json.token)).status).toBe(401);
	});

	it('caps active keys per account', async () => {
		for (let i = 0; i < 9; i++) await feed.createFeedKey({ userId: U.member, name: `k${i}` });
		await expect(feed.createFeedKey({ userId: U.member, name: 'one too many' })).rejects.toMatchObject({ status: 409 });
	});
});
