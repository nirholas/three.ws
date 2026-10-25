// DELETE /api/api-keys/:id must evict the key from the auth cache, as the
// sibling /api/keys/:id route does; otherwise a revoked key keeps
// authenticating from cache for the cache TTL.

import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET ||= 'vitest-ephemeral-jwt-secret-00000000000000';
vi.mock('../api/_lib/zauth.js', () => ({ instrument: () => {}, drain: async () => {} }));
vi.mock('../api/_lib/sentry.js', () => ({ captureException: () => {} }));
vi.mock('../api/_lib/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: vi.fn(async () => true) }));
vi.mock('../api/_lib/rate-limit.js', () => ({ limits: { authIp: async () => ({ success: true }) }, clientIp: () => '127.0.0.1' }));
const rows = [];
vi.mock('../api/_lib/db.js', () => ({ sql: async () => rows.shift() ?? [] }));
vi.mock('../api/_lib/auth.js', async () => {
	const actual = await vi.importActual('../api/_lib/auth.js');
	return { ...actual, getSessionUser: vi.fn(async () => ({ id: 'user-1' })) };
});
const invalidateApiKey = vi.fn(async () => {});
vi.mock('../api/_lib/api-key-cache.js', async () => {
	const actual = await vi.importActual('../api/_lib/api-key-cache.js');
	return { ...actual, invalidateApiKey: (...a) => invalidateApiKey(...a) };
});

const { default: handler } = await import('../api/api-keys/[id].js');
const ID = '11111111-1111-4111-8111-111111111111';

function makeRes() {
	const r = { statusCode: 200, _h: {}, _b: null };
	r.setHeader = (k, v) => { r._h[k.toLowerCase()] = v; };
	r.getHeader = (k) => r._h[k.toLowerCase()];
	r.end = (b) => { r._b = b; };
	return r;
}
const req = () => ({ method: 'DELETE', url: `/api/api-keys/${ID}`, query: { id: ID }, headers: { origin: 'https://three.ws' }, socket: { remoteAddress: '127.0.0.1' } });

beforeEach(() => { rows.length = 0; invalidateApiKey.mockClear(); });

describe('DELETE /api/api-keys/:id', () => {
	it('evicts the revoked key from the cache', async () => {
		rows.push([{ id: ID }]);
		const res = makeRes();
		await handler(req(), res);
		expect(res.statusCode).toBe(200);
		expect(invalidateApiKey).toHaveBeenCalledWith(ID);
	});

	it('does nothing to the cache when no key was revoked', async () => {
		rows.push([]);
		const res = makeRes();
		await handler(req(), res);
		expect(res.statusCode).toBe(404);
		expect(invalidateApiKey).not.toHaveBeenCalled();
	});
});
