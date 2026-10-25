// GET|PUT /api/mcp-tools -> api/mcp-tools.js
//
// The writer behind /settings/mcp-tools. Every hosted MCP server refuses a
// disabled tool with a link to that page, and api/_mcp/policy.js reads the
// mcp_tool_settings table this endpoint writes ({ groups: {id: bool}, tools }).
//
// Mocks: sql (an in-memory account row so a PUT then GET round-trips), auth,
// csrf, rate-limit and the policy module's cache (spied so the test can assert
// a save invalidates it). Offline, no DATABASE_URL or Redis needed.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { GROUPS, SETTINGS_URL } from '@three-ws/mcp-policy';

const db = { row: null };
const sqlCalls = [];
vi.mock('../../api/_lib/db.js', () => ({
	sql: vi.fn((strings, ...values) => {
		const text = strings.join(' ? ');
		sqlCalls.push({ text, values });
		if (/insert into mcp_tool_settings/i.test(text)) {
			db.row = JSON.parse(values[1]);
			return Promise.resolve([]);
		}
		if (/from mcp_tool_settings/i.test(text)) {
			return Promise.resolve(db.row ? [{ settings: db.row }] : []);
		}
		return Promise.resolve([]);
	}),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));

const authState = { user: null };
vi.mock('../../api/_lib/auth.js', () => ({
	getRequestUser: vi.fn(async () => authState.user),
}));

vi.mock('../../api/_lib/csrf.js', () => ({
	requireCsrf: vi.fn(async () => true),
}));

const rlState = { success: true, limit: 60, remaining: 0, reset: 0 };
vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: { notifPrefsWrite: vi.fn(async () => rlState) },
	clientIp: vi.fn(() => '127.0.0.1'),
}));

const invalidate = vi.fn();
vi.mock('../../api/_mcp/policy.js', () => ({
	loadToolSettings: vi.fn(async () => ({ account: db.row, key: null })),
	invalidateToolSettings: (...a) => invalidate(...a),
}));

const { default: handler } = await import('../../api/mcp-tools.js');

const USER = { id: '00000000-0000-0000-0000-0000000000c1' };

function makeRes() {
	return {
		statusCode: 200,
		_h: {},
		setHeader(k, v) { this._h[k.toLowerCase()] = v; },
		getHeader(k) { return this._h[k.toLowerCase()]; },
		end(body) { this._body = body; },
	};
}
async function call({ method = 'GET', body } = {}) {
	const res = makeRes();
	const req = {
		method,
		query: {},
		url: '/api/mcp-tools',
		headers: body === undefined ? {} : { 'content-type': 'application/json' },
	};
	if (body !== undefined) req.body = body;
	await handler(req, res);
	let parsed = null;
	try { parsed = JSON.parse(res._body); } catch {}
	return { res, body: parsed };
}

beforeEach(() => {
	sqlCalls.length = 0;
	db.row = null;
	authState.user = USER;
	rlState.success = true;
	invalidate.mockClear();
});

describe('GET /api/mcp-tools', () => {
	it('401s for an anonymous caller', async () => {
		authState.user = null;
		const { res } = await call();
		expect(res.statusCode).toBe(401);
	});

	it('returns every group and an empty account map when nothing is saved', async () => {
		const { res, body } = await call();
		expect(res.statusCode).toBe(200);
		expect(body.groups).toEqual(JSON.parse(JSON.stringify(GROUPS)));
		expect(body.account).toEqual({});
		expect(body.key).toBeNull();
	});
});

describe('PUT /api/mcp-tools', () => {
	it('stores a group choice and reflects it on the next GET, leaving the rest unset', async () => {
		const put = await call({ method: 'PUT', body: { groups: { trading: false } } });
		expect(put.res.statusCode).toBe(200);
		const { body } = await call();
		expect(body.account).toEqual({ trading: false });
	});

	it('merges into the saved groups and keeps a saved tools map intact', async () => {
		db.row = { groups: { wallet: true }, tools: { swap_quote: true } };
		await call({ method: 'PUT', body: { groups: { trading: true } } });
		expect(db.row).toEqual({ groups: { wallet: true, trading: true }, tools: { swap_quote: true } });
	});

	it('returns a group to its default when sent null', async () => {
		db.row = { groups: { wallet: true, trading: false } };
		await call({ method: 'PUT', body: { groups: { wallet: null } } });
		expect(db.row.groups).toEqual({ trading: false });
	});

	it('rejects an unknown group id instead of storing it', async () => {
		const { res } = await call({ method: 'PUT', body: { groups: { not_a_group: true } } });
		expect(res.statusCode).toBeGreaterThanOrEqual(400);
		expect(res.statusCode).toBeLessThan(500);
		expect(db.row).toBeNull();
		expect(invalidate).not.toHaveBeenCalled();
	});

	it('rejects a non-boolean value', async () => {
		const { res } = await call({ method: 'PUT', body: { groups: { trading: 'yes' } } });
		expect(res.statusCode).toBe(400);
		expect(db.row).toBeNull();
	});

	it('drops the cached settings exactly once per successful write', async () => {
		await call({ method: 'PUT', body: { groups: { wallet: true } } });
		expect(invalidate).toHaveBeenCalledTimes(1);
		expect(invalidate).toHaveBeenCalledWith(USER.id);
	});

	it('answers 429 when the write budget is spent, without writing', async () => {
		rlState.success = false;
		const { res } = await call({ method: 'PUT', body: { groups: { wallet: true } } });
		expect(res.statusCode).toBe(429);
		expect(db.row).toBeNull();
	});
});

describe('/settings/mcp-tools page route', () => {
	const routes = JSON.parse(readFileSync('vercel.json', 'utf8')).routes.filter((r) => r.src && r.dest);
	const path = new URL(SETTINGS_URL).pathname;

	it('is the path every refusal message quotes', () => {
		expect(path).toBe('/settings/mcp-tools');
	});

	it('routes to its own page ahead of the /settings catch-all', () => {
		const idx = routes.findIndex((r) => new RegExp(`^${r.src}$`).test(path));
		expect(idx).toBeGreaterThan(-1);
		expect(routes[idx].dest).toBe('/settings/mcp-tools/index.html');
		expect(idx).toBeLessThan(routes.findIndex((r) => r.src === '/settings/(.*)'));
		expect(existsSync('public/settings/mcp-tools/index.html')).toBe(true);
	});
});
