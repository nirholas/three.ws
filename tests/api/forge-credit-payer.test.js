// Who pays when a Forge High request asks for pay_with:'credits'.
//
// Bug: the credits lane only read the browser session cookie, so a machine
// client (the Omniverse Kit extension, a script) holding a three.ws API key
// with a funded credit balance always got 401 "Sign in to pay with credits."
// The resolver must accept that key, as /api/credits already does for reading
// the balance, while refusing keys that were never granted generation rights.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { session: null, bearer: null, rows: [] };

vi.mock('../../api/_lib/auth.js', () => ({
	getSessionUser: vi.fn(async () => state.session),
	extractBearer: vi.fn((req) => {
		const h = req.headers.authorization || '';
		return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : null;
	}),
	authenticateBearer: vi.fn(async (token) => (token ? state.bearer : null)),
	hasScope: (granted, required) => String(granted || '').split(/\s+/).includes(required),
}));

vi.mock('../../api/_lib/db.js', () => ({
	sql: vi.fn(async () => state.rows),
}));

import { resolveForgeCreditPayer } from '../../api/_lib/forge-credit-payer.js';

const req = (headers = {}) => ({ headers });

beforeEach(() => {
	state.session = null;
	state.bearer = null;
	state.rows = [];
});

describe('resolveForgeCreditPayer', () => {
	it('uses the signed-in session user when there is one', async () => {
		state.session = { id: 'u-session', wallet_address: 'W1' };
		const r = await resolveForgeCreditPayer(req());
		expect(r).toEqual({ ok: true, user: { id: 'u-session', wallet_address: 'W1' }, source: 'session' });
	});

	it('accepts an API key carrying avatars:write and loads its user for the holder discount', async () => {
		state.bearer = { userId: 'u-key', scope: 'avatars:read avatars:write', source: 'apikey' };
		state.rows = [{ id: 'u-key', wallet_address: 'W2' }];
		const r = await resolveForgeCreditPayer(req({ authorization: 'Bearer sk_live_abc' }));
		expect(r).toEqual({ ok: true, user: { id: 'u-key', wallet_address: 'W2' }, source: 'bearer' });
	});

	it('refuses a key without avatars:write with a 403 the client can explain', async () => {
		state.bearer = { userId: 'u-key', scope: 'avatars:read', source: 'apikey' };
		const r = await resolveForgeCreditPayer(req({ authorization: 'Bearer sk_live_abc' }));
		expect(r).toMatchObject({ ok: false, status: 403, error: 'insufficient_scope' });
	});

	it('answers 401 invalid_api_key for a key that does not authenticate', async () => {
		state.bearer = null;
		const r = await resolveForgeCreditPayer(req({ authorization: 'Bearer sk_live_revoked' }));
		expect(r).toMatchObject({ ok: false, status: 401, error: 'invalid_api_key' });
	});

	it('answers 401 unauthorized when there is neither a session nor a key', async () => {
		const r = await resolveForgeCreditPayer(req());
		expect(r).toMatchObject({ ok: false, status: 401, error: 'unauthorized' });
	});

	it('treats a key whose account is gone as invalid', async () => {
		state.bearer = { userId: 'u-deleted', scope: 'avatars:write', source: 'apikey' };
		state.rows = [];
		const r = await resolveForgeCreditPayer(req({ authorization: 'Bearer sk_live_abc' }));
		expect(r).toMatchObject({ ok: false, status: 401, error: 'invalid_api_key' });
	});
});
