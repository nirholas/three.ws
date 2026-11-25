// The free Crypto Data API names its token parameter two ways: /bonding and
// /whales read `mint`, while /holders, /security, /due-diligence and /token
// read `address`. A caller who learned the API from one family and called the
// other got `400 missing_address` for a mint it had plainly passed, and the
// error text itself says "Pass a Solana token mint". Production logged that
// exact 400 for real mints dozens of times every twelve hours. `mint` is now an
// accepted alias on every endpoint whose subject is a token mint.
//
// A malformed value proves the parameter was read without touching the
// network: a read parameter fails validation (`invalid_address`), an unread one
// fails as missing.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../api/_lib/http.js', () => ({
	wrap: (fn) => fn,
	cors: () => false,
	method: () => true,
	rateLimited: (res) => {
		res._json = { status: 429, body: { error: 'rate_limited' } };
		return res;
	},
	error: (res, status, code, message, extra = {}) => {
		res._json = { status, body: { error: code, error_description: message, ...extra } };
		return res;
	},
	json: (res, status, body, headers = {}) => {
		res._json = { status, body, headers };
		return res;
	},
}));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: new Proxy({}, { get: () => async () => ({ success: true }) }),
	clientIp: () => '203.0.113.7',
}));

const ENDPOINTS = ['holders', 'security', 'due-diligence', 'token'];

async function call(name, query) {
	const { default: handler } = await import(`../api/crypto/${name}.js`);
	const res = { setHeader() {}, end() {}, statusCode: 200 };
	await handler({ method: 'GET', url: `/api/crypto/${name}?${query}`, headers: {} }, res);
	return res._json;
}

describe('Crypto Data API token endpoints accept `mint` as well as `address`', () => {
	for (const name of ENDPOINTS) {
		it(`/api/crypto/${name} reads ?mint=`, async () => {
			const out = await call(name, 'mint=not-a-mint!!');
			expect(out.status).toBe(400);
			expect(out.body.error).toBe('invalid_address');
		});

		it(`/api/crypto/${name} still answers missing_address when neither is passed`, async () => {
			const out = await call(name, '');
			expect(out.body.error).toBe('missing_address');
			expect(out.body.error_description).toMatch(/`mint`/);
		});
	}
});
