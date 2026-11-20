// /api/grok/stats on the real schema (api/_lib/schema.sql plus every migration
// on PGlite). Usage rows are written the way production writes them: a real
// tools/call through the Grok MCP surface (api/_mcp-studio/dispatch.js) records
// its event with recordEvent (api/_lib/usage.js), which falls through to the
// direct insert because the Redis buffer is absent here. The forge is the one
// external system a model tool reaches; its answer is the synchronous-done shape
// /api/gpt-forge returns. The aggregation, the handler's headers and every byte
// it serves are then checked against those rows.

import { createHash } from 'node:crypto';
import { beforeAll, describe, it, expect, vi } from 'vitest';
import { createPgliteSql } from './_helpers/pglite-sql.js';
import { createFullSchemaDb } from './_helpers/pglite-full-schema.js';
import { invoke } from './_helpers/monetization.js';

const holder = vi.hoisted(() => ({ db: null }));

vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});

// No Redis: recordEvent takes the direct-insert path, the stats cache is skipped.
vi.mock('../api/_lib/redis.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, getRedis: () => null };
});

vi.mock('../api/_lib/qstash.js', () => ({ qstashEnabled: () => false, publishJob: async () => {} }));

vi.mock('../api/_lib/rate-limit.js', async (importOriginal) => {
	const real = await importOriginal();
	const pass = async () => ({ success: true, limit: 1, remaining: 1, reset: Date.now() + 1000 });
	return {
		...real,
		limits: {
			...real.limits,
			publicIp: pass,
			studioIp: pass,
			studioGenBurst: pass,
			studioGenHourly: pass,
			studioGenPoolHourly: pass,
			studioGenerateGlobal: pass,
			mcpUser: pass,
		},
	};
});

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';
process.env.PUBLIC_APP_ORIGIN = 'https://three.ws';
process.env.JWT_SECRET ||= 'vitest-ephemeral-jwt-secret-00000000000000';

const { recordEvent } = await import('../api/_lib/usage.js');
const { dispatch } = await import('../api/_mcp-studio/dispatch.js');
const { usageClientLabel, madeModelUrl } = await import('../api/_mcp-studio/usage-tags.js');
const { buildGrokStats } = await import('../api/_lib/grok-stats.js');
const { default: statsHandler, STATS_CACHE } = await import('../api/grok/stats.js');

const PROMPT = 'a brass telescope on a walnut tripod';
const IP = '203.0.113.77';
const anon = { userId: null, rateKey: IP, scope: '' };

function mkReq(url = '/api/mcp-grok') {
	return { url, headers: { host: 'three.ws', 'x-forwarded-proto': 'https' }, socket: { remoteAddress: IP } };
}

function call(name, args, id = 1) {
	return { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } };
}

let glbSeq = 0;
function doneForge() {
	return async () => {
		glbSeq += 1;
		const n = glbSeq;
		return { ok: true, status: 200, json: async () => ({ status: 'done', glb_url: `https://three.ws/cdn/creations/grok-${n}.glb`, job_id: `JOB_${n}` }) };
	};
}

async function waitForRows(sql, predicate, timeoutMs = 10_000) {
	const until = Date.now() + timeoutMs;
	for (;;) {
		const rows = await sql`select * from usage_events order by created_at`;
		if (predicate(rows)) return rows;
		if (Date.now() > until) return rows;
		await new Promise((r) => setTimeout(r, 25));
	}
}

describe('usage_events.client_id is a free-text attribution label', () => {
	beforeAll(async () => {
		const { pg } = await createFullSchemaDb();
		holder.db = createPgliteSql({ pg });
	}, 180_000);

	it('stores a label that is not an OAuth client id instead of dropping it to null', async () => {
		const { sql } = holder.db;
		recordEvent({ kind: 'tool_call', tool: 'probe_label', clientId: 'mcp-grok:session:0123456789abcdef', meta: { server: 'mcp-grok' } });
		const rows = await waitForRows(sql, (r) => r.some((e) => e.tool === 'probe_label'));
		const row = rows.find((e) => e.tool === 'probe_label');
		expect(row).toBeTruthy();
		expect(row.client_id).toBe('mcp-grok:session:0123456789abcdef');
	});
});

describe('the Grok surface tags its tool calls', () => {
	it('labels a caller by surface and kind with a salted hash, never the raw key', () => {
		const label = usageClientLabel('mcp-grok', { key: 'acct:5b0e0000-0000-4000-8000-000000000001', kind: 'account' });
		expect(label).toMatch(/^mcp-grok:account:[0-9a-f]{16}$/);
		expect(label).not.toContain('5b0e0000');
		const ipLabel = usageClientLabel('mcp-grok', { key: IP, kind: 'ip' });
		expect(ipLabel).toMatch(/^mcp-grok:ip:[0-9a-f]{16}$/);
		expect(ipLabel).not.toContain(IP);
		const plain = createHash('sha256').update(IP).digest('hex').slice(0, 16);
		expect(ipLabel.endsWith(plain)).toBe(false);
		expect(usageClientLabel('mcp-grok', null)).toBeNull();
		expect(usageClientLabel('mcp-grok', { key: '', kind: 'ip' })).toBeNull();
	});

	it('reads the finished model from a model tool or a job collection only', () => {
		const done = { structuredContent: { kind: 'model', format: 'glb', glbUrl: 'https://three.ws/cdn/x.glb' } };
		expect(madeModelUrl('forge_free', done, 'get_job')).toBe('https://three.ws/cdn/x.glb');
		expect(madeModelUrl('get_job', done, 'get_job')).toBe('https://three.ws/cdn/x.glb');
		expect(madeModelUrl('check_job', done, 'get_job')).toBe('https://three.ws/cdn/x.glb');
		expect(madeModelUrl('create_agent_persona', done, 'get_job')).toBeNull();
		expect(madeModelUrl('look_at_model', done, 'get_job')).toBeNull();
		expect(madeModelUrl('forge_free', { ...done, isError: true }, 'get_job')).toBeNull();
		expect(madeModelUrl('forge_free', { structuredContent: { status: 'pending', job_id: 'J' } }, 'get_job')).toBeNull();
		expect(madeModelUrl('forge_free', null, 'get_job')).toBeNull();
	});
});

describe('stats from real Grok surface traffic', () => {
	let sql;
	let userA;
	let userB;
	let stats;

	beforeAll(async () => {
		const { pg } = await createFullSchemaDb();
		holder.db = createPgliteSql({ pg });
		sql = holder.db.sql;
		[userA] = await sql`insert into users (email, display_name) values ('grok.stats.a@contoso.example', 'Grok Stats A') returning id`;
		[userB] = await sql`insert into users (email, display_name) values ('grok.stats.b@contoso.example', 'Grok Stats B') returning id`;
		const accountA = { userId: userA.id, source: 'oauth', scope: 'avatars:read avatars:write' };
		const accountB = { userId: userB.id, source: 'oauth', scope: 'avatars:read avatars:write' };
		const callerA = { key: `acct:${userA.id}`, kind: 'account' };
		const callerB = { key: `acct:${userB.id}`, kind: 'account' };
		const realFetch = globalThis.fetch;
		globalThis.fetch = doneForge();
		try {
			// Account A makes two models; account B makes one.
			for (const [account, caller] of [[accountA, callerA], [accountA, callerA], [accountB, callerB]]) {
				const r = await dispatch(call('forge_free', { prompt: PROMPT }), anon, mkReq(), { surface: 'grok', account, caller });
				expect(r.result.isError).toBeFalsy();
			}
			// An anonymous creator call is refused and makes nothing.
			await dispatch(call('forge_free', { prompt: PROMPT }), anon, mkReq(), { surface: 'grok', caller: { key: IP, kind: 'ip' } });
			// The free studio surface is shared with every other client: never counted as Grok.
			await dispatch(call('forge_free', { prompt: PROMPT }), anon, mkReq('/api/mcp-studio'), { surface: 'full', account: accountB, caller: callerB });
		} finally {
			globalThis.fetch = realFetch;
		}
		await waitForRows(sql, (r) => r.filter((e) => e.kind === 'tool_call' && e.tool === 'forge_free').length >= 5);
		// One of account A's models is older than a day but inside 30 days; an
		// event from 40 days ago sits outside every window.
		const [first] = await sql`select id from usage_events where meta->>'server' = 'mcp-grok' and meta ? 'glb' and user_id = ${userA.id} order by created_at limit 1`;
		await sql`update usage_events set created_at = now() - interval '3 days' where id = ${first.id}`;
		await sql`insert into usage_events (user_id, client_id, kind, tool, status, meta, created_at)
			values (${userB.id}, 'mcp-grok:account:ffffffffffffffff', 'tool_call', 'forge_free', 'ok', ${JSON.stringify({ server: 'mcp-grok', glb: 'https://three.ws/cdn/creations/old.glb' })}::jsonb, now() - interval '40 days')`;
		stats = await buildGrokStats({ sql });
	}, 180_000);

	it('records the account, a hashed client label and the model on each Grok call', async () => {
		const rows = await sql`select user_id, client_id, status, meta from usage_events where kind = 'tool_call' and meta->>'server' = 'mcp-grok' and created_at > now() - interval '30 days'`;
		const made = rows.filter((r) => r.meta.glb);
		expect(made).toHaveLength(3);
		expect(made.every((r) => /^mcp-grok:account:[0-9a-f]{16}$/.test(r.client_id))).toBe(true);
		expect(new Set(made.map((r) => r.client_id)).size).toBe(2);
		expect(made.filter((r) => r.user_id === userA.id)).toHaveLength(2);
		const refused = rows.find((r) => r.status === 'sign_in_required');
		expect(refused.client_id).toMatch(/^mcp-grok:ip:[0-9a-f]{16}$/);
		expect(refused.meta.glb).toBeUndefined();
	});

	it('counts finished Grok models per window and never the shared studio surface', () => {
		expect(stats.models).toEqual({ '24h': 2, '30d': 3 });
	});

	it('counts distinct signed-in clients over 30 days', () => {
		expect(stats.clients['30d']).toBe(2);
	});

	it('counts Grok tool calls per window', () => {
		expect(stats.tool_calls['24h']).toBe(3);
		expect(stats.tool_calls['30d']).toBe(4);
	});

	it('says what it counts and since when', () => {
		expect(stats.surface).toBe('mcp-grok');
		expect(stats.endpoint).toBe('https://three.ws/api/mcp-grok');
		expect(typeof stats.methodology.models).toBe('string');
		expect(typeof stats.methodology.clients).toBe('string');
		// The earliest attributed call inside the window: the one backdated 3 days.
		const since = Date.parse(stats.counting_since);
		expect(since).toBeLessThan(Date.now() - 2.9 * 86_400_000);
		expect(since).toBeGreaterThan(Date.now() - 3.1 * 86_400_000);
		expect(Date.parse(stats.generated_at)).toBeGreaterThan(Date.now() - 60_000);
	});

	it('serves JSON with a five minute CDN cache', async () => {
		const { status, res, body } = await invoke(statsHandler, { url: '/api/grok/stats' });
		expect(status).toBe(200);
		expect(STATS_CACHE).toMatch(/s-maxage=300/);
		expect(res.headers['cache-control']).toBe(STATS_CACHE);
		expect(res.headers['access-control-allow-origin']).toBe('*');
		expect(body.models).toEqual({ '24h': 2, '30d': 3 });
	});

	it('rejects writes', async () => {
		const { status } = await invoke(statsHandler, { method: 'POST', url: '/api/grok/stats', body: {} });
		expect(status).toBe(405);
	});

	it('never serves a user id, client label, email, prompt or model URL', async () => {
		const { body } = await invoke(statsHandler, { url: '/api/grok/stats' });
		const served = JSON.stringify(body);
		const labels = (await sql`select distinct client_id from usage_events where client_id is not null`).map((r) => r.client_id);
		expect(labels.length).toBeGreaterThan(0);
		for (const l of labels) expect(served).not.toContain(l);
		expect(served).not.toContain(String(userA.id));
		expect(served).not.toContain(String(userB.id));
		expect(served).not.toContain('contoso.example');
		expect(served).not.toContain(PROMPT);
		expect(served).not.toMatch(/\.glb/);
		expect(served).not.toContain(IP);
	});

	it('answers 503 with no numbers when the database cannot be read', async () => {
		const real = holder.db;
		holder.db = { sql: () => Promise.reject(new Error('connection refused')) };
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const { status, body } = await invoke(statsHandler, { url: '/api/grok/stats' });
			expect(status).toBe(503);
			expect(body.models).toBeUndefined();
		} finally {
			holder.db = real;
			err.mockRestore();
		}
	});
});
