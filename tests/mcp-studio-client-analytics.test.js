// Client analytics on the studio surfaces (/api/mcp-studio, /api/mcp-chatgpt,
// /api/mcp-grok). Two analytics modules once migrated the same table names;
// api/_lib/mcp-clients.js won the merge and production's mcp_client_daily has
// no `client` column (see 20261015010000_mcp_client_sessions_client_nullable.sql).
// The studio handler kept calling the losing module, whose inserts name that
// column, so every flush failed and the grok surface recorded no client after
// 2026-10-23. These tests drive the real grok handler and pin that its sessions
// and calls are written through mcp-clients.js, into columns production has.

import { describe, it, expect, vi, beforeEach } from 'vitest';

let sqlCalls = [];
vi.mock('../api/_lib/db.js', () => ({
	sql: (strings, ...values) => {
		sqlCalls.push({ text: strings.join('?'), values });
		return Promise.resolve([]);
	},
}));

vi.mock('../api/_lib/rate-limit.js', async (importOriginal) => {
	const real = await importOriginal();
	const pass = async () => ({ success: true, limit: 1, remaining: 1, reset: Date.now() + 1000 });
	return {
		...real,
		limits: {
			...real.limits,
			studioIp: pass,
			studioGenBurst: pass,
			studioGenHourly: pass,
			studioGenPoolHourly: pass,
			studioGenerateGlobal: pass,
		},
	};
});

const { flushMcpTracking } = await import('../api/_lib/mcp-clients.js');
const { default: grokHandler } = await import('../api/mcp-grok.js');

function httpPair(body, headers = {}) {
	const payload = Buffer.from(JSON.stringify(body));
	const req = {
		method: 'POST',
		url: '/api/mcp-grok',
		headers: { host: 'three.ws', 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9', ...headers },
		socket: { remoteAddress: '203.0.113.9' },
		async *[Symbol.asyncIterator]() {
			yield payload;
		},
		on(event, cb) {
			if (event === 'data') cb(payload);
			if (event === 'end') cb();
			return this;
		},
	};
	const out = { headers: {}, body: '' };
	const res = {
		statusCode: 200,
		headersSent: false,
		setHeader(k, v) {
			out.headers[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return out.headers[k.toLowerCase()];
		},
		removeHeader(k) {
			delete out.headers[k.toLowerCase()];
		},
		end(chunk) {
			if (chunk) out.body += chunk;
			this.headersSent = true;
		},
		write(chunk) {
			out.body += chunk;
		},
	};
	return { req, res, out };
}

const initialize = {
	jsonrpc: '2.0',
	id: 1,
	method: 'initialize',
	params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Grok-Bot', version: '2.1.0' } },
};
const searchDocs = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'search_docs', arguments: { query: 'embed' } } };

// Columns production's tables actually carry (migration 20261009172000).
const PROD_COLUMNS = {
	mcp_client_sessions: ['session_id', 'surface', 'client_name', 'client_version', 'auth_kind', 'calls', 'created_at', 'last_seen_at'],
	mcp_client_daily: ['day', 'surface', 'client_name', 'client_version', 'auth_kind', 'sessions', 'calls'],
};

function insertColumns(text, table) {
	const m = text.match(new RegExp(`insert into ${table} \\(([^)]*)\\)`));
	return m ? m[1].split(',').map((c) => c.trim()) : null;
}

beforeEach(() => {
	sqlCalls = [];
});

describe('studio surface client analytics', () => {
	it('records a grok session and its tool calls under the client that opened it', async () => {
		const opened = httpPair(initialize);
		await grokHandler(opened.req, opened.res);
		const sid = opened.out.headers['mcp-session-id'];
		expect(sid).toMatch(/^grk_[0-9a-f-]{36}$/);

		const called = httpPair(searchDocs, { 'mcp-session-id': sid });
		await grokHandler(called.req, called.res);
		await flushMcpTracking();

		const session = sqlCalls.find((c) => c.text.includes('insert into mcp_client_sessions'));
		expect(session, 'the initialize is written as a session row').toBeDefined();
		expect(session.values.flat()).toEqual(expect.arrayContaining([sid, 'mcp-grok', 'grok-bot', '2.1.0']));

		const perTool = sqlCalls.find((c) => c.text.includes('insert into mcp_client_tool_daily'));
		expect(perTool, 'the call is written to the per-tool aggregate').toBeDefined();
		expect(perTool.values.flat()).toEqual(expect.arrayContaining(['mcp-grok', 'grok-bot', 'search_docs']));
	});

	it('writes only columns the production tables have', async () => {
		const opened = httpPair(initialize);
		await grokHandler(opened.req, opened.res);
		const called = httpPair(searchDocs, { 'mcp-session-id': opened.out.headers['mcp-session-id'] });
		await grokHandler(called.req, called.res);
		await flushMcpTracking();

		let checked = 0;
		for (const { text } of sqlCalls) {
			for (const [table, allowed] of Object.entries(PROD_COLUMNS)) {
				const cols = insertColumns(text, table);
				if (!cols) continue;
				checked += 1;
				for (const col of cols) expect(allowed, `${table}.${col}`).toContain(col);
			}
		}
		expect(checked).toBeGreaterThan(0);
	});
});
