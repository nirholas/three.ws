// GET /api/sniper/close lists the caller's live sniper positions on one agent so
// the wallet hub's "Sell all" can route sniper-held coins through the close path.
// It must be owner-scoped (the query filters by the caller's user_id), refuse an
// anonymous caller, and never touch the sell path.

import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.PUBLIC_APP_ORIGIN = 'https://three.ws';

vi.mock('../api/_lib/zauth.js', () => ({ instrument: () => {}, drain: async () => {} }));
vi.mock('../api/_lib/sentry.js', () => ({ captureException: () => {} }));

const sqlCalls = [];
let sqlRows = [];
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...values) => { sqlCalls.push({ text: strings.join('?'), values }); return sqlRows; }),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
	isStoragePressured: () => false,
}));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: {
		authedReadIp: vi.fn(async () => ({ success: true })),
		tradePerUser: vi.fn(async () => ({ success: true })),
		authIp: vi.fn(async () => ({ success: true })),
	},
	clientIp: () => '127.0.0.1',
}));

const principal = { session: null, bearer: null };
vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: vi.fn(async () => principal.session),
	authenticateBearer: vi.fn(async () => principal.bearer),
	extractBearer: vi.fn(() => (principal.bearer ? 'bearer-token' : null)),
}));

const executeSell = vi.fn();
vi.mock('../workers/agent-sniper/executor.js', () => ({ executeSell: (...a) => executeSell(...a) }));

const { default: handler } = await import('../api/sniper/close.js');

const AGENT = '11111111-2222-4333-8444-555555555555';

function makeRes() {
	const r = { statusCode: 200, _h: {}, _b: '' };
	r.setHeader = (k, v) => { r._h[k.toLowerCase()] = v; };
	r.getHeader = (k) => r._h[k.toLowerCase()];
	r.end = (b) => { r._b = b ?? ''; };
	return r;
}

async function get(qs) {
	const req = {
		method: 'GET',
		url: `/api/sniper/close${qs}`,
		headers: { origin: 'https://three.ws' },
		socket: { remoteAddress: '127.0.0.1' },
	};
	const res = makeRes();
	await handler(req, res);
	return { status: res.statusCode, body: res._b ? JSON.parse(res._b) : null };
}

beforeEach(() => {
	principal.session = null;
	principal.bearer = null;
	sqlCalls.length = 0;
	sqlRows = [];
	executeSell.mockClear();
});

describe('GET /api/sniper/close', () => {
	it('refuses an anonymous caller', async () => {
		const { status } = await get(`?agent_id=${AGENT}`);
		expect(status).toBe(401);
		expect(sqlCalls).toHaveLength(0);
	});

	it('rejects a malformed agent id', async () => {
		principal.session = { id: 'user-1' };
		const { status } = await get('?agent_id=not-a-uuid');
		expect(status).toBe(400);
	});

	it('lists live positions scoped to the caller and never sells', async () => {
		principal.session = { id: 'user-1' };
		sqlRows = [
			{ id: 'p1', mint: 'THREEsynthetic1111111111111111111111111111A', symbol: 'SYN', name: 'Syn', status: 'open', base_amount: 42n, opened_at: '2026-11-05T00:00:00Z' },
			{ id: 'p2', mint: 'THREEsynthetic1111111111111111111111111111B', symbol: null, name: null, status: 'closing', base_amount: null, opened_at: null },
		];
		const { status, body } = await get(`?agent_id=${AGENT}&network=mainnet`);
		expect(status).toBe(200);
		expect(body.data.positions).toEqual([
			{ id: 'p1', mint: 'THREEsynthetic1111111111111111111111111111A', symbol: 'SYN', name: 'Syn', status: 'open', base_amount: '42', opened_at: '2026-11-05T00:00:00Z' },
			{ id: 'p2', mint: 'THREEsynthetic1111111111111111111111111111B', symbol: null, name: null, status: 'closing', base_amount: null, opened_at: null },
		]);
		expect(sqlCalls).toHaveLength(1);
		expect(sqlCalls[0].text).toMatch(/user_id = \?/);
		expect(sqlCalls[0].values).toEqual(expect.arrayContaining([AGENT, 'user-1', 'mainnet']));
		expect(sqlCalls[0].text).not.toMatch(/UPDATE/i);
		expect(executeSell).not.toHaveBeenCalled();
	});

	it('lets any authenticated bearer read (a read moves no funds)', async () => {
		principal.bearer = { userId: 'user-2', scope: 'agents:read', source: 'oauth', clientId: 'c' };
		const { status } = await get(`?agent_id=${AGENT}`);
		expect(status).toBe(200);
		expect(sqlCalls[0].values).toEqual(expect.arrayContaining(['user-2']));
	});
});
