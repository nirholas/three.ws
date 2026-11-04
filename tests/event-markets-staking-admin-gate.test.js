// The staking admin route reads every pool and flips the kill switch, so it must
// be admin-only: no session is 401, a signed-in non-admin is 403, and in neither
// case does it touch the chain or the pool reconciliation.

import { Readable } from 'node:stream';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { user: null };
const reconcile = vi.fn(async () => []);

vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: vi.fn(async () => state.user),
	authenticateBearer: vi.fn(async () => null),
	extractBearer: vi.fn(() => null),
}));
vi.mock('../api/_lib/db.js', () => ({ sql: Object.assign(vi.fn(async () => []), { transaction: vi.fn() }) }));
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: vi.fn(async () => true) }));
vi.mock('../api/_lib/event-markets/staking/reconcile-all.js', () => ({ reconcileAll: reconcile }));
vi.mock('../api/_lib/event-markets/staking/chain.js', () => ({ readConfig: vi.fn(async () => null) }));
vi.mock('../api/_lib/event-markets/staking/store.js', () => ({
	getSettings: vi.fn(async () => ({ stakesEnabled: true })),
	setStakesEnabled: vi.fn(async () => {}),
}));

const handler = (await import('../api/event-markets/staking-admin.js')).default;

async function call(method, body) {
	const raw = body === undefined ? null : JSON.stringify(body);
	const req = Readable.from(raw == null ? [] : [Buffer.from(raw)]);
	req.method = method;
	req.url = '/api/event-markets/staking-admin';
	req.headers = { host: 'localhost', ...(raw == null ? {} : { 'content-type': 'application/json' }) };
	const res = {
		statusCode: 200, headers: {}, body: '', writableEnded: false,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		end(c) { if (c !== undefined) this.body += c; this.writableEnded = true; },
	};
	await handler(req, res);
	return res;
}

beforeEach(() => { state.user = null; reconcile.mockClear(); });

describe('staking admin route is admin-gated', () => {
	it('answers 401 with no session on GET and POST', async () => {
		expect((await call('GET')).statusCode).toBe(401);
		expect((await call('POST', { action: 'pause' })).statusCode).toBe(401);
		expect(reconcile).not.toHaveBeenCalled();
	});
	it('answers 403 for a signed-in non-admin', async () => {
		state.user = { id: 'u1', wallet_address: '11111111111111111111111111111111', is_admin: false };
		expect((await call('GET')).statusCode).toBe(403);
		expect(reconcile).not.toHaveBeenCalled();
	});
	it('serves the reconciliation to an admin', async () => {
		state.user = { id: 'a1', wallet_address: '9MjzHaTB6Jko4YKo9mDzJSaGnktzhbebgsnqPpYWnXC7', is_admin: true };
		const res = await call('GET');
		expect(res.statusCode).toBe(200);
		expect(JSON.parse(res.body).all_ok).toBe(true);
		expect(reconcile).toHaveBeenCalledOnce();
	});
});
