// MCP client analytics: recording (api/_lib/mcp-clients.js) and the admin read
// (api/ops/mcp-clients.js). The database is replaced by a recorder so the tests
// can assert exactly what would be written, and, as important, what would not.

import { describe, it, expect, vi, beforeEach } from 'vitest';

let sqlCalls = [];
let sqlImpl = async () => [];
vi.mock('../api/_lib/db.js', () => ({
	sql: (strings, ...values) => {
		sqlCalls.push({ text: strings.join('?'), values });
		return sqlImpl(strings.join('?'), values);
	},
}));

let sessionUser = null;
vi.mock('../api/_lib/auth.js', async (importOriginal) => ({
	...(await importOriginal()),
	getSessionUser: vi.fn(async () => sessionUser),
}));

vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { authedReadIp: vi.fn(async () => ({ success: true, limit: 300, remaining: 299, reset: Date.now() + 1000 })) },
	clientIp: () => '127.0.0.1',
}));

const lib = await import('../api/_lib/mcp-clients.js');
const { default: handler } = await import('../api/ops/mcp-clients.js');

const SID = 'mcs_00000000-0000-4000-8000-000000000001';

function makeRes() {
	return {
		statusCode: 200,
		_h: {},
		writableEnded: false,
		setHeader(k, v) { this._h[k.toLowerCase()] = v; },
		getHeader(k) { return this._h[k.toLowerCase()]; },
		end(body) { this.writableEnded = true; this._body = body; },
	};
}

async function get(url) {
	const res = makeRes();
	await handler({ url, method: 'GET', headers: { host: 'three.ws' }, query: {} }, res);
	let body = null;
	try { body = JSON.parse(res._body); } catch { /* non-JSON */ }
	return { res, body };
}

beforeEach(() => {
	sqlCalls = [];
	sqlImpl = async () => [];
	sessionUser = null;
});

describe('normalization', () => {
	it('lowercases, trims, collapses space and caps the length', () => {
		expect(lib.normalizeClientName('  Claude-AI  ')).toBe('claude-ai');
		expect(lib.normalizeClientName('Grok   Bot')).toBe('grok bot');
		expect(lib.normalizeClientName('x'.repeat(200))).toHaveLength(64);
	});

	it('strips characters that are not part of a client name', () => {
		expect(lib.normalizeClientName('cursor<script>alert(1)</script>')).toBe('cursorscriptalert1/script');
		expect(lib.normalizeClientName('\u0000‮')).toBe('unknown');
	});

	it('maps a missing or non-string name to unknown', () => {
		for (const bad of [undefined, null, 7, {}, '', '   ']) expect(lib.normalizeClientName(bad)).toBe('unknown');
	});

	it('caps and cleans versions', () => {
		expect(lib.normalizeClientVersion('1.2.3')).toBe('1.2.3');
		expect(lib.normalizeClientVersion(2)).toBe('2');
		expect(lib.normalizeClientVersion('v'.repeat(80))).toHaveLength(32);
		expect(lib.normalizeClientVersion({})).toBe('');
	});
});

describe('auth kind, session id and the issued header', () => {
	it('names the four auth kinds plus x402', () => {
		expect(lib.authKindOf({ source: 'apikey' })).toBe('key');
		expect(lib.authKindOf({ source: 'oauth' })).toBe('oauth');
		expect(lib.authKindOf({ source: 'x402' })).toBe('x402');
		expect(lib.authKindOf({ userId: null })).toBe('anonymous');
		expect(lib.authKindOf({ userId: null }, 'tok')).toBe('install');
		expect(lib.authKindOf(undefined)).toBe('anonymous');
	});

	it('accepts only ids this server issues', () => {
		expect(lib.sessionIdOf({ headers: { 'mcp-session-id': SID } })).toBe(SID);
		expect(lib.sessionIdOf({ headers: { 'mcp-session-id': 'grk_00000000-0000-4000-8000-000000000001' } })).not.toBeNull();
		expect(lib.sessionIdOf({ headers: { 'mcp-session-id': 'drop table' } })).toBeNull();
		expect(lib.sessionIdOf({ headers: {} })).toBeNull();
	});

	it('issues a session id on initialize only, and exposes it to browsers', () => {
		const res = makeRes();
		expect(lib.issueSession(res, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).toBeNull();
		expect(res.getHeader('mcp-session-id')).toBeUndefined();
		const id = lib.issueSession(res, [{ method: 'initialize', id: 1 }]);
		expect(id).toMatch(/^mcs_[0-9a-f-]{36}$/);
		expect(res.getHeader('mcp-session-id')).toBe(id);
		expect(res.getHeader('access-control-expose-headers')).toContain('mcp-session-id');
	});
});

describe('recording', () => {
	const initBody = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: ' Probe ', version: '9.9' }, secret: 'do-not-store' } };

	it('writes a session and a daily aggregate on initialize, off the request path', async () => {
		const id = 'mcs_00000000-0000-4000-8000-0000000000a1';
		lib.trackMcp({ surface: 'mcp-studio', req: { headers: {} }, body: initBody, responses: [], auth: { userId: null }, issuedSessionId: id });
		expect(sqlCalls).toHaveLength(0);
		await lib.flushMcpTracking();
		expect(sqlCalls).toHaveLength(1);
		const call = sqlCalls[0];
		expect(call.text).toMatch(/insert into mcp_client_sessions/);
		expect(call.text).toMatch(/insert into mcp_client_daily/);
		expect(call.values).toContainEqual([id]);
		expect(call.values).toContainEqual(['probe']);
		expect(call.values).toContainEqual(['9.9']);
		expect(call.values).toContainEqual(['anonymous']);
	});

	it('never stores request bodies, arguments or secrets', async () => {
		const id = 'mcs_00000000-0000-4000-8000-0000000000a2';
		lib.trackMcp({ surface: 'mcp', req: { headers: {} }, body: initBody, auth: {}, issuedSessionId: id });
		lib.trackMcp({
			surface: 'mcp',
			req: { headers: { 'mcp-session-id': id } },
			body: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'search_catalog', arguments: { q: 'private query' } } },
			responses: [{ id: 2, result: {} }],
			auth: { source: 'apikey' },
		});
		await lib.flushMcpTracking();
		expect(JSON.stringify(sqlCalls)).not.toMatch(/do-not-store|private query|arguments/);
	});

	it('counts a call against the client its session initialized as', async () => {
		const id = 'mcs_00000000-0000-4000-8000-0000000000a3';
		lib.trackMcp({ surface: 'mcp-studio', req: { headers: {} }, body: initBody, auth: {}, issuedSessionId: id });
		const call = (n) => ({
			surface: 'mcp-studio',
			req: { headers: { 'mcp-session-id': id } },
			body: { jsonrpc: '2.0', id: n, method: 'tools/call', params: { name: 'search_catalog' } },
			responses: [{ id: n, result: {} }],
			auth: { userId: null },
		});
		lib.trackMcp(call(2));
		lib.trackMcp(call(3));
		await lib.flushMcpTracking();
		const tools = sqlCalls.find((c) => /insert into mcp_client_tool_daily/.test(c.text));
		expect(tools.values).toContainEqual(['probe']);
		expect(tools.values).toContainEqual(['search_catalog']);
		expect(tools.values).toContainEqual([2]);
		const sessionUpdate = sqlCalls.find((c) => /update mcp_client_sessions/.test(c.text));
		expect(sessionUpdate.values).toContainEqual([id]);
		expect(sessionUpdate.values).toContainEqual([2]);
	});

	it('looks a session up in the database when this process did not issue it', async () => {
		const foreign = 'mcs_00000000-0000-4000-8000-0000000000ff';
		sqlImpl = async (text) =>
			/from mcp_client_sessions/.test(text) ? [{ session_id: foreign, client_name: 'cursor', client_version: '2.1' }] : [];
		lib.trackMcp({
			surface: 'mcp',
			req: { headers: { 'mcp-session-id': foreign } },
			body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'getting_started' } },
			responses: [{ id: 1, result: {} }],
			auth: {},
		});
		await lib.flushMcpTracking();
		const daily = sqlCalls.find((c) => /insert into mcp_client_daily/.test(c.text) && /calls\)/.test(c.text));
		expect(daily.values).toContainEqual(['cursor']);
		expect(daily.values).toContainEqual(['2.1']);
	});

	it('counts a call with no session under unknown and a call to a missing tool as unknown_tool', async () => {
		lib.trackMcp({
			surface: 'mcp-3d',
			req: { headers: {} },
			body: [
				{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'a'.repeat(300) } },
				{ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'no_such_tool' } },
			],
			responses: [{ id: 2, error: { code: -32601, message: 'x' } }],
			auth: {},
		});
		await lib.flushMcpTracking();
		const tools = sqlCalls.find((c) => /insert into mcp_client_tool_daily/.test(c.text));
		expect(tools.values).toContainEqual(['unknown']);
		expect(tools.values).toContainEqual(['unknown_tool']);
	});

	it('swallows a failed write so analytics never reach a caller', async () => {
		sqlImpl = async () => {
			throw new Error('connection refused');
		};
		lib.trackMcp({ surface: 'mcp', req: { headers: {} }, body: initBody, auth: {}, issuedSessionId: 'mcs_00000000-0000-4000-8000-0000000000a9' });
		await expect(lib.flushMcpTracking()).resolves.toBeUndefined();
	});

	it('records nothing for requests that are neither initialize nor tools/call', async () => {
		lib.trackMcp({ surface: 'mcp', req: { headers: {} }, body: { jsonrpc: '2.0', id: 1, method: 'tools/list' }, auth: {} });
		await lib.flushMcpTracking();
		expect(sqlCalls).toHaveLength(0);
	});
});

describe('retention', () => {
	it('deletes raw sessions past 30 days and nothing else', async () => {
		sqlImpl = async () => [{}, {}];
		const out = await lib.purgeExpiredMcpSessions();
		expect(out).toEqual({ deleted: 2 });
		expect(sqlCalls[0].text).toMatch(/delete from mcp_client_sessions/);
		expect(sqlCalls[0].values).toContain(30);
		expect(sqlCalls[0].text).not.toMatch(/mcp_client_daily|mcp_client_tool_daily/);
	});
});

describe('report', () => {
	it('clamps the window', () => {
		expect(lib.clampReportDays(undefined)).toBe(30);
		expect(lib.clampReportDays('0')).toBe(1);
		expect(lib.clampReportDays('9999')).toBe(365);
		expect(lib.clampReportDays('abc')).toBe(30);
	});

	it('ranks clients by calls with versions, auth kinds, top tools and a zero-filled daily series', async () => {
		const today = new Date().toISOString().slice(0, 10);
		sqlImpl = async (text) => {
			if (/from mcp_client_tool_daily/.test(text)) {
				return [
					{ client_name: 'grok bot', tool: 'generate_3d', calls: 8 },
					{ client_name: 'grok bot', tool: 'search_catalog', calls: 4 },
					{ client_name: 'claude', tool: 'search_catalog', calls: 3 },
				];
			}
			return [
				{ day: today, surface: 'mcp-grok', client_name: 'grok bot', client_version: '1.0', auth_kind: 'anonymous', sessions: 5, calls: 12 },
				{ day: today, surface: 'mcp', client_name: 'claude', client_version: '3.0', auth_kind: 'oauth', sessions: 2, calls: 3 },
				{ day: today, surface: 'mcp', client_name: 'unknown', client_version: '', auth_kind: 'anonymous', sessions: 0, calls: 5 },
			];
		};
		const r = await lib.gatherMcpClients({ days: 3 });
		expect(r.window_days).toBe(3);
		expect(r.clients.map((c) => c.client)).toEqual(['grok bot', 'unknown', 'claude']);
		expect(r.clients[0]).toMatchObject({ sessions: 5, calls: 12, share_of_calls: 0.6 });
		expect(r.clients[0].top_tools[0]).toEqual({ tool: 'generate_3d', calls: 8 });
		expect(r.clients[0].versions[0]).toMatchObject({ version: '1.0', calls: 12 });
		expect(r.totals).toMatchObject({ clients: 3, sessions: 7, calls: 20, unattributed_calls: 5, unattributed_share: 0.25 });
		expect(r.daily).toHaveLength(3);
		expect(r.daily[2]).toMatchObject({ day: today, calls: 20 });
		expect(r.daily[0].calls).toBe(0);
	});

	it('reports an empty window as zeros, not an error', async () => {
		const r = await lib.gatherMcpClients({ days: 7 });
		expect(r.totals).toMatchObject({ clients: 0, sessions: 0, calls: 0, unattributed_share: null });
		expect(r.clients).toEqual([]);
		expect(r.daily).toHaveLength(7);
	});
});

describe('GET /api/ops/mcp-clients', () => {
	it('answers 401 without a session', async () => {
		const { res, body } = await get('/api/ops/mcp-clients');
		expect(res.statusCode).toBe(401);
		expect(body.error).toBe('unauthorized');
	});

	it('answers 403 to a signed-in non-admin', async () => {
		sessionUser = { id: 'u1', wallet_address: null, is_admin: false };
		const { res, body } = await get('/api/ops/mcp-clients?days=30');
		expect(res.statusCode).toBe(403);
		expect(body.error).toBe('forbidden');
		expect(sqlCalls.some((c) => /mcp_client/.test(c.text))).toBe(false);
	});

	it('serves the report to an admin, uncached', async () => {
		sessionUser = { id: 'u2', wallet_address: null, is_admin: true };
		const { res, body } = await get('/api/ops/mcp-clients?days=7');
		expect(res.statusCode).toBe(200);
		expect(body.ok).toBe(true);
		expect(body.window_days).toBe(7);
		expect(res.getHeader('cache-control')).toBe('private, no-store');
	});

	it('names the migration when the tables are missing', async () => {
		sessionUser = { id: 'u2', wallet_address: null, is_admin: true };
		sqlImpl = async () => {
			throw Object.assign(new Error('relation "mcp_client_daily" does not exist'), { code: '42P01' });
		};
		const { res, body } = await get('/api/ops/mcp-clients');
		expect(res.statusCode).toBe(503);
		expect(body.error_description).toContain('20261009172000_mcp_client_analytics.sql');
	});
});
