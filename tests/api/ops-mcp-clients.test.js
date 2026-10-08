// GET /api/ops/mcp-clients is admin only: 401 with no session, 403 for a
// signed-in user who is not an admin, and the report for an admin. The admin
// decision is the real requireAdmin; only the session lookup and the
// database are stubbed.

import { describe, it, expect, vi, beforeEach } from 'vitest';

let sessionUser = null;
vi.mock('../../api/_lib/auth.js', () => ({
	getSessionUser: vi.fn(async () => sessionUser),
}));

vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: { authedReadIp: vi.fn(async () => ({ success: true, limit: 300, remaining: 299, reset: Date.now() + 1000 })) },
	clientIp: () => '127.0.0.1',
}));

const sqlCalls = [];
vi.mock('../../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings) => {
		const text = strings.join('?');
		sqlCalls.push(text);
		if (text.includes('from user_wallets')) return [];
		if (text.includes('from mcp_client_daily')) {
			return [{ day: new Date().toISOString().slice(0, 10), surface: 'mcp-studio', client: 'probe', client_name: 'three-ws-connector-probe', client_version: '1.0.0', auth_kind: 'anonymous', sessions: 2, calls: 4, tools: { search_catalog: 4 } }];
		}
		return [];
	}),
}));

const { default: handler } = await import('../../api/ops/mcp-clients.js');

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

async function get(url = '/api/ops/mcp-clients?days=30') {
	const res = makeRes();
	await handler({ method: 'GET', url, headers: { host: 'localhost' } }, res);
	return { status: res.statusCode, body: res._body ? JSON.parse(res._body) : null };
}

beforeEach(() => {
	sessionUser = null;
	sqlCalls.length = 0;
});

describe('GET /api/ops/mcp-clients', () => {
	it('answers 401 without a session and reads nothing', async () => {
		const r = await get();
		expect(r.status).toBe(401);
		expect(sqlCalls.some((q) => q.includes('mcp_client_daily'))).toBe(false);
	});

	it('answers 403 to a signed-in user who is not an admin', async () => {
		sessionUser = { id: 'u1', wallet_address: 'NotAnAdminWa11et1111111111111111111111111111', is_admin: false };
		const r = await get();
		expect(r.status).toBe(403);
		expect(r.body.error).toBe('forbidden');
		expect(sqlCalls.some((q) => q.includes('mcp_client_daily'))).toBe(false);
	});

	it('serves the report to an admin', async () => {
		sessionUser = { id: 'u2', wallet_address: null, is_admin: true };
		const r = await get('/api/ops/mcp-clients?days=7');
		expect(r.status).toBe(200);
		expect(r.body.window_days).toBe(7);
		expect(r.body.clients[0]).toMatchObject({ client: 'probe', sessions: 2, calls: 4 });
	});

	it('refuses anything but GET', async () => {
		sessionUser = { id: 'u2', is_admin: true };
		const res = makeRes();
		await handler({ method: 'POST', url: '/api/ops/mcp-clients', headers: {} }, res);
		expect(res.statusCode).toBe(405);
	});
});
