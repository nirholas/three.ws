// MCP client analytics against the REAL migration, in an in-process Postgres
// (PGlite): an initialize issues a session id and records the client, a
// tools/call that echoes the id is counted against that client, a call with
// no issued id lands on "unknown", and the report folds the daily rows the
// way the /mcp-clients board reads them.

import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const dbState = { pg: null };

vi.mock('../api/_lib/db.js', () => {
	const sql = async (strings, ...values) => {
		const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''), '');
		const out = await dbState.pg.query(text, values);
		return out.rows;
	};
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false };
});

const analytics = await import('../api/_lib/mcp-client-analytics.js');
const { summarizeMcpClients, gatherMcpClients, windowDays, clampReportDays } = await import('../api/_lib/mcp-client-report.js');

const MIGRATION = readFileSync(
	new URL('../api/_lib/migrations/20261008200000_mcp_client_analytics.sql', import.meta.url),
	'utf8',
);

function makeRes() {
	const h = {};
	return {
		setHeader(k, v) { h[k.toLowerCase()] = v; },
		getHeader(k) { return h[k.toLowerCase()]; },
		headers: h,
	};
}

const init = (name, version = '1.0.0') => ({
	jsonrpc: '2.0',
	id: 1,
	method: 'initialize',
	params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name, version } },
});
const call = (tool, id = 2) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: tool, arguments: { q: 'secret prompt text' } } });

beforeEach(async () => {
	dbState.pg = new PGlite();
	await dbState.pg.exec(MIGRATION);
	// Drain what an earlier test queued without flushing, then start clean.
	await analytics.flushMcpClientEvents();
	await dbState.pg.exec('truncate mcp_client_sessions, mcp_client_daily');
});

describe('client name normalization', () => {
	it('trims, lowercases, strips control characters and caps the length', () => {
		expect(analytics.normalizeClientName('  Claude-AI \n')).toBe('claude-ai');
		expect(analytics.normalizeClientName('x'.repeat(200))).toHaveLength(64);
		expect(analytics.normalizeClientName('')).toBe('unknown');
		expect(analytics.normalizeClientName(42)).toBe('unknown');
		expect(analytics.normalizeClientVersion(' 1.2.3\u0007 ')).toBe('1.2.3');
	});

	it('maps known clientInfo names to one family per client', () => {
		const fam = (n) => analytics.clientFamily(analytics.normalizeClientName(n));
		expect(fam('three-ws-connector-probe')).toBe('probe');
		expect(fam('claude-ai')).toBe('claude');
		expect(fam('claude-code')).toBe('claude-code');
		expect(fam('openai-mcp')).toBe('chatgpt');
		expect(fam('cursor-vscode')).toBe('cursor');
		expect(fam('Visual Studio Code')).toBe('vscode');
		expect(fam('Grok Bot')).toBe('grok');
		expect(fam('my-own-agent')).toBe('my-own-agent');
	});

	it('names the auth kind from the resolved principal and from headers', () => {
		expect(analytics.authKindOf({ source: 'oauth' })).toBe('oauth');
		expect(analytics.authKindOf({ source: 'apikey' })).toBe('key');
		expect(analytics.authKindOf({ source: 'x402' })).toBe('x402');
		expect(analytics.authKindOf({ source: 'free' })).toBe('anonymous');
		expect(analytics.authKindFromHeaders({ headers: { authorization: 'Bearer sk_live_abc' } })).toBe('key');
		expect(analytics.authKindFromHeaders({ headers: { authorization: 'Bearer eyJhbGciOi' } })).toBe('oauth');
		expect(analytics.authKindFromHeaders({ headers: { 'x-payment': 'e30=' } })).toBe('x402');
		expect(analytics.authKindFromHeaders({ headers: {} })).toBe('anonymous');
	});
});

describe('trackMcpRequest', () => {
	it('issues an exposed Mcp-Session-Id on initialize and nothing on other methods', () => {
		const res = makeRes();
		const sid = analytics.trackMcpRequest({ body: init('probe'), req: { headers: {} }, res, surface: 'mcp-studio' });
		expect(sid).toMatch(/^mcs_[0-9a-f-]{36}$/);
		expect(res.headers['mcp-session-id']).toBe(sid);
		expect(res.headers['access-control-expose-headers']).toContain('mcp-session-id');
		expect(analytics.isIssuedSessionId(sid)).toBe(true);

		const res2 = makeRes();
		expect(analytics.trackMcpRequest({ body: call('search_catalog'), req: { headers: {} }, res: res2, surface: 'mcp' })).toBeNull();
		expect(res2.headers['mcp-session-id']).toBeUndefined();
	});

	it('keeps the grk_ prefix the grok rate caps key on', () => {
		const res = makeRes();
		const sid = analytics.trackMcpRequest({ body: init('grok'), req: { headers: {} }, res, surface: 'mcp-grok', sessionPrefix: 'grk' });
		expect(sid).toMatch(/^grk_[0-9a-f-]{36}$/);
	});

	it('records the session, then counts echoed calls against its client', async () => {
		const res = makeRes();
		const sid = analytics.trackMcpRequest({
			body: init('  Three-WS-Connector-Probe ', '1.0.0'),
			req: { headers: {} },
			res,
			surface: 'mcp-studio',
			authKind: 'install',
		});
		await analytics.flushMcpClientEvents();
		for (const tool of ['search_catalog', 'search_catalog', 'getting_started']) {
			analytics.trackMcpRequest({ body: call(tool), req: { headers: { 'mcp-session-id': sid } }, res: makeRes(), surface: 'mcp-studio', authKind: 'install' });
		}
		const out = await analytics.flushMcpClientEvents();
		expect(out.failed).toBe(0);

		const { rows: [session] } = await dbState.pg.query('select * from mcp_client_sessions where session_id = $1', [sid]);
		expect(session).toMatchObject({
			surface: 'mcp-studio',
			client: 'probe',
			client_name: 'three-ws-connector-probe',
			client_version: '1.0.0',
			auth_kind: 'install',
			calls: 3,
			tool_calls: { search_catalog: 2, getting_started: 1 },
		});

		const { rows: daily } = await dbState.pg.query('select * from mcp_client_daily');
		expect(daily).toHaveLength(1);
		expect(daily[0]).toMatchObject({ client: 'probe', sessions: 1, calls: 3, tools: { search_catalog: 2, getting_started: 1 } });
	});

	it('never stores a request body or a tool argument', async () => {
		const res = makeRes();
		const sid = analytics.trackMcpRequest({ body: [init('claude-ai'), call('text_to_3d', 3)], req: { headers: {} }, res, surface: 'mcp-3d', auth: { source: 'oauth' } });
		await analytics.flushMcpClientEvents();
		const { rows } = await dbState.pg.query('select row_to_json(s)::text as j from mcp_client_sessions s');
		expect(rows[0].j).not.toContain('secret prompt text');
		const { rows: [s] } = await dbState.pg.query('select calls, auth_kind from mcp_client_sessions where session_id = $1', [sid]);
		// The batch opened the session and called a tool in one request.
		expect(s).toEqual({ calls: 1, auth_kind: 'oauth' });
	});

	it('counts a call with no issued session id under "unknown"', async () => {
		analytics.trackMcpRequest({ body: call('getting_started'), req: { headers: { 'mcp-session-id': 'forged-id' } }, res: makeRes(), surface: 'mcp', auth: { source: 'x402' } });
		await analytics.flushMcpClientEvents();
		const { rows } = await dbState.pg.query('select client, client_name, auth_kind, calls, sessions, tools from mcp_client_daily');
		expect(rows).toEqual([{ client: 'unknown', client_name: 'unknown', auth_kind: 'x402', calls: 1, sessions: 0, tools: { getting_started: 1 } }]);
	});

	it('folds invented tool names past 200 into "(other)"', async () => {
		const many = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`t${i}`, 1]));
		const { rows: [r] } = await dbState.pg.query('select mcp_tool_count_add($1::jsonb, $2, 1) as j', [JSON.stringify(many), 'brand_new']);
		expect(r.j['(other)']).toBe(1);
		expect(r.j.brand_new).toBeUndefined();
		const { rows: [r2] } = await dbState.pg.query('select mcp_tool_count_add($1::jsonb, $2, 4) as j', [JSON.stringify(many), 't7']);
		expect(r2.j.t7).toBe(5);
	});
});

describe('the report', () => {
	it('clamps the window', () => {
		expect(clampReportDays(undefined)).toBe(30);
		expect(clampReportDays('')).toBe(30);
		expect(clampReportDays('0')).toBe(1);
		expect(clampReportDays('9999')).toBe(365);
		expect(windowDays(3, new Date('2026-10-08T12:00:00Z'))).toEqual(['2026-10-06', '2026-10-07', '2026-10-08']);
	});

	it('groups per client with top tools, auth mix and a zero-filled daily series', () => {
		const today = new Date('2026-10-08T12:00:00Z');
		const rows = [
			{ day: '2026-10-08', surface: 'mcp-grok', client: 'grok', client_name: 'grok bot', client_version: '0.9', auth_kind: 'anonymous', sessions: 3, calls: 7, tools: { text_to_3d: 5, get_job: 2 } },
			{ day: '2026-10-07', surface: 'mcp', client: 'claude', client_name: 'claude-ai', client_version: '0.1.0', auth_kind: 'oauth', sessions: 1, calls: 1, tools: { list_my_avatars: 1 } },
			{ day: '2026-10-08', surface: 'mcp', client: 'unknown', client_name: 'unknown', client_version: '', auth_kind: 'x402', sessions: 0, calls: 2, tools: { getting_started: 2 } },
		];
		const r = summarizeMcpClients(rows, { days: 3, today });
		expect(r.totals).toEqual({ sessions: 4, calls: 10, clients: 2, unattributed_calls: 2 });
		expect(r.clients[0]).toMatchObject({ client: 'grok', sessions: 3, calls: 7, calls_per_session: 2.3, top_tools: [{ tool: 'text_to_3d', calls: 5 }, { tool: 'get_job', calls: 2 }] });
		expect(r.daily.map((d) => d.day)).toEqual(['2026-10-06', '2026-10-07', '2026-10-08']);
		expect(r.daily[0].clients).toEqual({});
		expect(r.daily[2].clients.grok).toEqual({ sessions: 3, calls: 7 });
		expect(r.tools[0]).toEqual({ tool: 'text_to_3d', calls: 5 });
	});

	it('reads the real table end to end', async () => {
		const res = makeRes();
		const sid = analytics.trackMcpRequest({ body: init('three-ws-connector-probe'), req: { headers: {} }, res, surface: 'mcp-studio' });
		await analytics.flushMcpClientEvents();
		analytics.trackMcpRequest({ body: call('search_catalog'), req: { headers: { 'mcp-session-id': sid } }, res: makeRes(), surface: 'mcp-studio' });
		await analytics.flushMcpClientEvents();
		const r = await gatherMcpClients({ days: 30 });
		expect(r.ok).toBe(true);
		expect(r.clients.map((c) => c.client)).toEqual(['probe']);
		expect(r.clients[0]).toMatchObject({ sessions: 1, calls: 1, auth: { anonymous: 2 } });
	});

	it('names the failed read instead of reporting an empty window', async () => {
		await dbState.pg.exec('drop table mcp_client_daily');
		const r = await gatherMcpClients({ days: 7 });
		expect(r.ok).toBe(false);
		expect(r.degraded[0].error).toMatch(/does not exist/);
	});
});
