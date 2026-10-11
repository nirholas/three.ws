// Revocation takes effect at once, cache or no cache.
//
// authenticateBearer caches the key row it resolves. Without the invalidation
// the revoke routes call, a revoked key would keep answering until the row
// aged out. These run the real authenticateBearer against a fake table and
// show both halves: the cache does serve a stale row when nobody tells it,
// and invalidateApiKey makes the very next call read the revoke.

import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.PUBLIC_APP_ORIGIN = 'https://three.ws';
process.env.JWT_SECRET ||= 'vitest-ephemeral-jwt-secret-00000000000000';

const hashOf = (token) => createHash('sha256').update(token).digest('hex');
const USER = '9a8b7c6d-0000-4000-8000-0000000000bb';
const TOKEN = 'sk_live_cachefixture_000000000000000000';
const ROTATED = 'sk_live_rotatedfixture_0000000000000000';
const PINNED = 'sk_live_pinnedfixture_00000000000000000';

const table = new Map();
let selects = 0;

function seed() {
	table.clear();
	table.set(hashOf(TOKEN), { id: '6f1d2c3b-0000-4000-8000-00000000cac1', user_id: USER, scope: 'read', preset: null, expires_at: null, revoked_at: null, ip_allowlist: null, overlap_until: null });
	table.set(hashOf(ROTATED), { id: '6f1d2c3b-0000-4000-8000-00000000cac2', user_id: USER, scope: 'read', preset: null, expires_at: null, revoked_at: null, ip_allowlist: null, overlap_until: new Date(Date.now() - 1000).toISOString() });
	table.set(hashOf(PINNED), { id: '6f1d2c3b-0000-4000-8000-00000000cac3', user_id: USER, scope: 'read', preset: null, expires_at: null, revoked_at: null, ip_allowlist: ['203.0.113.0/24'], overlap_until: null });
	selects = 0;
}

vi.mock('../api/_lib/db.js', () => {
	const sql = (strings, ...values) => {
		const text = Array.isArray(strings) ? strings.join('?') : String(strings);
		if (/from api_keys where token_hash/.test(text)) {
			selects++;
			const hit = values.map((v) => table.get(v)).find(Boolean);
			return Promise.resolve(hit ? [{ ...hit }] : []);
		}
		return Promise.resolve([]);
	};
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false, isStoragePressured: () => false };
});
vi.mock('../api/_lib/redis.js', () => ({ getRedis: () => null }));
vi.mock('../api/_lib/usage.js', () => ({ recordEvent: vi.fn(), logger: () => ({ info() {}, warn() {}, error() {} }) }));

const { authenticateBearer } = await import('../api/_lib/auth.js');
const { invalidateApiKey, resetApiKeyCache } = await import('../api/_lib/api-key-cache.js');

beforeEach(() => {
	seed();
	resetApiKeyCache();
});

describe('api key cache', () => {
	it('serves the second call from the cache', async () => {
		expect(await authenticateBearer(TOKEN)).toMatchObject({ userId: USER, source: 'apikey' });
		expect(await authenticateBearer(TOKEN)).toMatchObject({ userId: USER });
		expect(selects).toBe(1);
	});

	it('would keep answering a revoked key until told, which is why revoke routes invalidate', async () => {
		await authenticateBearer(TOKEN);
		table.get(hashOf(TOKEN)).revoked_at = new Date().toISOString();
		expect(await authenticateBearer(TOKEN)).not.toBeNull();
	});

	it('refuses a revoked key on the very next call after invalidateApiKey', async () => {
		const auth = await authenticateBearer(TOKEN);
		table.get(hashOf(TOKEN)).revoked_at = new Date().toISOString();
		await invalidateApiKey(auth.apiKeyId);
		expect(await authenticateBearer(TOKEN)).toBeNull();
		expect(selects).toBe(2);
	});

	it('refuses a rotated key once its overlap window has passed', async () => {
		expect(await authenticateBearer(ROTATED)).toBeNull();
	});

	it('enforces the IP allowlist from the ip option and from the request context', async () => {
		expect(await authenticateBearer(PINNED, { ip: '203.0.113.9' })).not.toBeNull();
		expect(await authenticateBearer(PINNED, { ip: '198.51.100.9' })).toBeNull();
		const { runWithRequestContext } = await import('../api/_lib/request-context.js');
		const req = { headers: {}, socket: { remoteAddress: '203.0.113.20' } };
		expect(await runWithRequestContext({ req }, () => authenticateBearer(PINNED))).not.toBeNull();
		const bad = { headers: {}, socket: { remoteAddress: '198.51.100.20' } };
		expect(await runWithRequestContext({ req: bad }, () => authenticateBearer(PINNED))).toBeNull();
	});
});
