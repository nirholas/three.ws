// The CSRF guard skips the token check for bearer-authenticated requests, because
// a bearer credential cannot ride along on a cross-site request the way a cookie
// does. getRequestUser prefers the session cookie, though, so the exemption must
// follow the credential that actually authenticated: a request carrying the
// victim's cookie plus a junk "Bearer x" header used to run as the victim with
// the token check skipped.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ consumed: null }));
const bearers = vi.hoisted(() => new Map());

vi.mock('../api/_lib/db.js', () => ({
	sql: async (strings, ...values) => {
		const text = strings.join('?');
		if (/DELETE FROM csrf_tokens/.test(text)) {
			const [token, userId] = values;
			if (db.consumed && db.consumed.token === token && db.consumed.userId === userId) {
				db.consumed = null;
				return [{ user_id: userId }];
			}
			return [];
		}
		return [];
	},
}));

vi.mock('../api/_lib/auth.js', () => ({
	extractBearer: (req) => {
		const h = req.headers.authorization || '';
		return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : null;
	},
	hasSessionCookie: (req) => /(?:^|;\s*)__Host-sid=/.test(req.headers.cookie || ''),
	authenticateBearer: async (token) => bearers.get(token) || null,
}));

const { checkCsrf } = await import('../api/_lib/csrf.js');

const VICTIM = 'user-victim';
const ATTACKER = 'user-attacker';

function req(headers) {
	return { headers };
}

describe('checkCsrf bearer exemption', () => {
	beforeEach(() => {
		db.consumed = null;
		bearers.clear();
		bearers.set('victim-key', { userId: VICTIM, source: 'apikey' });
		bearers.set('attacker-key', { userId: ATTACKER, source: 'apikey' });
	});

	it('exempts a bearer request that carries no session cookie', async () => {
		const verdict = await checkCsrf(req({ authorization: 'Bearer victim-key' }), VICTIM);
		expect(verdict.ok).toBe(true);
	});

	it('rejects a cookie-authenticated request that adds a junk bearer header', async () => {
		const verdict = await checkCsrf(
			req({ authorization: 'Bearer x', cookie: '__Host-sid=victim-session' }),
			VICTIM,
		);
		expect(verdict).toMatchObject({ ok: false, code: 'csrf_missing' });
	});

	it("rejects a cookie session paired with another account's valid key", async () => {
		const verdict = await checkCsrf(
			req({ authorization: 'Bearer attacker-key', cookie: '__Host-sid=victim-session' }),
			VICTIM,
		);
		expect(verdict.ok).toBe(false);
	});

	it("exempts a signed-in user calling with their own key (the API playground)", async () => {
		const verdict = await checkCsrf(
			req({ authorization: 'Bearer victim-key', cookie: '__Host-sid=victim-session' }),
			VICTIM,
		);
		expect(verdict.ok).toBe(true);
	});

	it('still accepts a valid CSRF token on a cookie request', async () => {
		db.consumed = { token: 'tok123', userId: VICTIM };
		const verdict = await checkCsrf(
			req({ cookie: '__Host-sid=victim-session', 'x-csrf-token': 'tok123' }),
			VICTIM,
		);
		expect(verdict.ok).toBe(true);
	});
});
