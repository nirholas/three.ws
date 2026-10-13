// A deleted account must not keep a working credential.
//
// DELETE /api/auth/me revoked sessions and OAuth refresh tokens but left the
// account's API keys alive, and authenticateBearer never asked whether the key's
// owner still exists. A person who deleted their account (or an operator who
// removed an abusive one) therefore kept a bearer credential that still
// resolved to the dead user id on every key-authenticated route.

import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.PUBLIC_APP_ORIGIN = 'https://three.ws';
process.env.APP_ORIGIN = 'https://three.ws';
process.env.JWT_SECRET ||= 'vitest-ephemeral-jwt-secret-00000000000000';

const hashOf = (t) => createHash('sha256').update(t).digest('hex');
const TOKEN = 'sk_live_deletedowner_00000000000000000';
const KEY_ID = '6f1d2c3b-0000-4000-8000-00000000d311';

let ownerDeleted = false;
const statements = [];

vi.mock('../api/_lib/db.js', () => {
	const sql = (strings, ...values) => {
		const text = (Array.isArray(strings) ? strings.join('?') : String(strings)).replace(/\s+/g, ' ');
		statements.push(text);
		if (/from api_keys where token_hash/.test(text)) {
			if (values.includes(hashOf(TOKEN)) === false) return Promise.resolve([]);
			// A real database applies the owner-liveness predicate; model it.
			if (ownerDeleted && /deleted_at is null/.test(text)) return Promise.resolve([]);
			return Promise.resolve([{ id: KEY_ID, user_id: 'user-1', scope: 'read', preset: null, expires_at: null, revoked_at: null, ip_allowlist: null, overlap_until: null }]);
		}
		if (/select username from users/.test(text)) return Promise.resolve([{ username: 'ada' }]);
		if (/returning id/i.test(text)) return Promise.resolve([{ id: KEY_ID }]);
		return Promise.resolve([]);
	};
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false, isStoragePressured: () => false };
});
vi.mock('../api/_lib/redis.js', () => ({ getRedis: () => null }));
vi.mock('../api/_lib/usage.js', () => ({ recordEvent: vi.fn(), logger: () => ({ info() {}, warn() {}, error() {} }) }));
vi.mock('../api/_lib/zauth.js', () => ({ instrument: () => {}, drain: async () => {} }));
vi.mock('../api/_lib/sentry.js', () => ({ captureException: () => {} }));
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: async () => true }));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { authIp: async () => ({ success: true }) },
	clientIp: () => '127.0.0.1',
}));
vi.mock('../api/_lib/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('../api/_lib/email.js', () => ({ sendPasswordResetEmail: vi.fn(), sendVerificationEmail: vi.fn() }));
vi.mock('../api/_lib/seed-default-agent.js', () => ({ seedDefaultAgent: vi.fn() }));
vi.mock('../api/_lib/legal.js', () => ({ tosAcceptanceFromBody: vi.fn(() => null), recordTosAcceptance: vi.fn(), TOS_VERSION: 2 }));
vi.mock('../api/_lib/home/members.js', () => ({ revokeAllMemberships: async () => ({ removedFrom: [], ownedHomes: [] }) }));

const realAuth = await vi.importActual('../api/_lib/auth.js');
vi.mock('../api/_lib/auth.js', async () => {
	const actual = await vi.importActual('../api/_lib/auth.js');
	return {
		...actual,
		getSessionUser: async () => ({ id: 'user-1', email: 'ada@example.com' }),
		sessionCookie: () => '__Host-sid=; Max-Age=0',
	};
});

const { authenticateBearer } = realAuth;
const { resetApiKeyCache } = await import('../api/_lib/api-key-cache.js');
const { default: handler } = await import('../api/auth/[action].js');

beforeEach(() => {
	ownerDeleted = false;
	statements.length = 0;
	resetApiKeyCache();
});

describe('credentials of a deleted account', () => {
	it('authenticateBearer refuses an API key whose owner is deleted', async () => {
		expect(await authenticateBearer(TOKEN)).toMatchObject({ userId: 'user-1' });
		resetApiKeyCache();
		ownerDeleted = true;
		expect(await authenticateBearer(TOKEN)).toBeNull();
	});

	it('DELETE /api/auth/me revokes the account API keys', async () => {
		const res = { statusCode: 200, _h: {}, setHeader(k, v) { this._h[k] = v; }, getHeader(k) { return this._h[k]; }, end(b) { this._b = b; } };
		await handler({
			method: 'DELETE', url: '/api/auth/me', query: { action: 'me' },
			headers: { 'content-type': 'application/json', origin: 'https://three.ws' },
			socket: { remoteAddress: '127.0.0.1' }, body: JSON.stringify({ confirm: 'delete my account' }),
		}, res);
		expect(res.statusCode).toBe(200);
		expect(statements.some((s) => /update api_keys set revoked_at = now\(\)/.test(s))).toBe(true);
		expect(statements.some((s) => /insert into oauth_client_revocations/.test(s))).toBe(true);
	});
});
