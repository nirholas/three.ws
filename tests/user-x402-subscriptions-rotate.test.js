/**
 * POST /api/user/x402-subscriptions { action: 'rotate' } must not mint a fresh
 * credential from a subscription that is already revoked or expired. Rotating
 * copies name, rate limit and meta onto a brand-new key, so allowing it would
 * let an owner resurrect a key that was killed (leak response, abuse action).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { sub: null };
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async () => (state.sub ? [state.sub] : [])),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));
vi.mock('../api/_lib/auth.js', () => ({ getSessionUser: vi.fn(async () => ({ id: 'user-1' })) }));
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: vi.fn(async () => true) }));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { authIp: vi.fn(async () => ({ success: true })) },
	clientIp: () => '127.0.0.1',
}));
const createSubscription = vi.fn(async () => ({ id: 'new', key_prefix: 'x402_new', token: 'tok', rate_limit_per_minute: 60 }));
const revokeSubscription = vi.fn(async () => {});
vi.mock('../api/_lib/x402/api-keys.js', () => ({ createSubscription, revokeSubscription }));
vi.mock('../api/_lib/aws-marketplace-bridge.js', () => ({
	issueSubscriptionForCustomer: vi.fn(),
	revokeSubscriptionForCustomer: vi.fn(),
}));
vi.mock('../api/_lib/aws-marketplace-store.js', () => ({ findCustomerByHandle: vi.fn() }));

const { default: handler } = await import('../api/user/x402-subscriptions.js');

function makeRes() {
	const r = { statusCode: 200, _h: {}, _b: null, writableEnded: false, headersSent: false };
	r.setHeader = (k, v) => { r._h[k.toLowerCase()] = v; };
	r.getHeader = (k) => r._h[k.toLowerCase()];
	r.end = (b) => { r._b = b ?? r._b; r.writableEnded = true; };
	r.json = () => (r._b ? JSON.parse(r._b) : undefined);
	return r;
}
async function post(body) {
	const res = makeRes();
	await handler(
		{
			method: 'POST',
			url: '/api/user/x402-subscriptions',
			headers: { origin: 'https://three.ws', 'content-type': 'application/json' },
			socket: { remoteAddress: '127.0.0.1' },
			body,
		},
		res,
	);
	return res;
}
const base = { id: 's1', name: 'k', rate_limit_per_minute: 60, expires_at: null, revoked_at: null, meta: {}, created_by: 'user-1' };

beforeEach(() => {
	createSubscription.mockClear();
	revokeSubscription.mockClear();
});

describe('x402 subscription rotate', () => {
	it('refuses to rotate a revoked subscription', async () => {
		state.sub = { ...base, revoked_at: '2026-10-01T00:00:00Z' };
		const res = await post({ action: 'rotate', id: 's1' });
		expect(res.statusCode).toBe(409);
		expect(createSubscription).not.toHaveBeenCalled();
	});

	it('refuses to rotate an expired subscription', async () => {
		state.sub = { ...base, expires_at: '2020-01-01T00:00:00Z' };
		const res = await post({ action: 'rotate', id: 's1' });
		expect(res.statusCode).toBe(409);
		expect(createSubscription).not.toHaveBeenCalled();
	});

	it('still rotates an active subscription', async () => {
		state.sub = { ...base };
		const res = await post({ action: 'rotate', id: 's1' });
		expect(res.statusCode).toBe(200);
		expect(createSubscription).toHaveBeenCalledTimes(1);
		expect(revokeSubscription).toHaveBeenCalledWith('s1');
	});
});
