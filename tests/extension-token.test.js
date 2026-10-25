// The walk extension token is a stateless 30-day JWT with no refresh-token
// row. Revocation works only through the oauth_client_revocations cutoff, so
// the client id it carries must be the one account recovery stamps.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { decodeJwt } from 'jose';

process.env.APP_ORIGIN = 'https://three.ws';
process.env.JWT_SECRET ||= 'vitest-ephemeral-jwt-secret-00000000000000';

const statements = [];
vi.mock('../api/_lib/db.js', () => ({
	sql: async (strings, ...values) => {
		const text = strings.join(' ').replace(/\s+/g, ' ').trim();
		statements.push({ text, values });
		if (/from users/i.test(text)) return [{ id: 'user-1', username: 'ada', display_name: 'Ada' }];
		if (/from oauth_client_revocations/i.test(text)) return [{ one: 1 }];
		return [];
	},
}));
vi.mock('../api/_lib/zauth.js', () => ({ instrument: () => {}, drain: async () => {} }));
vi.mock('../api/_lib/sentry.js', () => ({ captureException: () => {} }));
vi.mock('../api/_lib/rate-limit.js', () => ({ limits: { authIp: async () => ({ success: true }) }, clientIp: () => '127.0.0.1' }));
vi.mock('../api/_lib/auth.js', async () => {
	const actual = await vi.importActual('../api/_lib/auth.js');
	return { ...actual, getSessionUser: vi.fn(async () => ({ id: 'user-1' })) };
});

const auth = await vi.importActual('../api/_lib/auth.js');
const { default: handler } = await import('../api/auth/extension-token.js');

function makeRes() {
	const r = { statusCode: 200, _h: {}, _b: null };
	r.setHeader = (k, v) => { r._h[k.toLowerCase()] = v; };
	r.getHeader = (k) => r._h[k.toLowerCase()];
	r.end = (b) => { r._b = b; };
	Object.defineProperty(r, 'json', { value: () => JSON.parse(r._b) });
	return r;
}

beforeEach(() => { statements.length = 0; });

describe('walk extension token revocation', () => {
	it('mints a token whose client id is the one account recovery revokes', async () => {
		const res = makeRes();
		await handler({ method: 'POST', url: '/api/auth/extension-token', headers: { origin: 'https://three.ws', 'content-type': 'application/json' }, socket: { remoteAddress: '127.0.0.1' } }, res);
		expect(res.statusCode).toBe(200);
		const payload = decodeJwt(res.json().token);
		expect(payload.client_id).toBe(auth.WALK_EXTENSION_CLIENT_ID);
		expect(payload.client_id).toBe('walk-extension');
	});

	it('a minted token is dead once a cutoff row exists for its client', async () => {
		const res = makeRes();
		await handler({ method: 'POST', url: '/api/auth/extension-token', headers: { origin: 'https://three.ws', 'content-type': 'application/json' }, socket: { remoteAddress: '127.0.0.1' } }, res);
		const payload = decodeJwt(res.json().token);
		expect(await auth.oauthGrantRevoked(payload)).toBe(true);
		const q = statements.find((s) => /from oauth_client_revocations/.test(s.text));
		expect(q.values).toEqual(expect.arrayContaining(['user-1', 'walk-extension']));
	});
});
