// POST /api/auth/agent-signup: one account per key, whichever door it came through.
// The onboarding library and account factory are replaced so the route's own
// ordering is what is under test: challenge, cap, redeem, ownership, create.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const owners = new Map();
const created = [];
const order = [];

vi.mock('../api/_lib/rate-limit.js', async (importActual) => ({
	...(await importActual()),
	limits: new Proxy({}, { get: () => async () => ({ success: true }) }),
}));
vi.mock('../api/_lib/agent-onboarding.js', async (importActual) => ({
	...(await importActual()),
	issueChallenge: async ({ publicKey }) => ({ nonce: 'N'.repeat(32), message: `m:${publicKey}`, ttl_seconds: 300 }),
	assertUnderDailyCap: async () => order.push('cap'),
	redeemChallenge: async () => order.push('redeem'),
	walletOwner: async (k) => owners.get(k) ?? null,
	linkSignupWallet: async ({ userId, publicKey }) => {
		owners.set(publicKey, userId);
		return true;
	},
}));
vi.mock('../api/_lib/agent-signup.js', async (importActual) => ({
	...(await importActual()),
	createSelfSignedAgent: async ({ publicKey, name }) => {
		created.push(publicKey);
		return {
			agent: { id: 'agent-1', name, meta: { spend_limits: {}, trade_limits: {}, solana_address: 'AgentWallet' } },
			user: { id: `user-${created.length}` },
			key: { prefix: 'sk_live_abcd', scope: 'read agents:write' },
			apiKeySecret: 'sk_live_secret',
			claimCode: 'CLAIM',
			claimExpiresAt: '2026-10-24T00:00:00.000Z',
		};
	},
}));

const handler = (await import('../api/auth/agent-signup.js')).default;
const KEY = '11111111111111111111111111111112';

function call(body) {
	const payload = JSON.stringify(body);
	const req = {
		method: 'POST',
		url: '/api/auth/agent-signup',
		headers: { 'content-type': 'application/json', 'content-length': String(payload.length) },
		socket: { remoteAddress: '203.0.113.9' },
		rawBody: Buffer.from(payload),
	};
	const res = { statusCode: 200, headers: {}, body: '', writableEnded: false };
	res.setHeader = (k, v) => (res.headers[k.toLowerCase()] = v);
	res.getHeader = (k) => res.headers[k.toLowerCase()];
	res.writeHead = (s, h = {}) => {
		res.statusCode = s;
		for (const [k, v] of Object.entries(h)) res.setHeader(k, v);
	};
	res.end = (b = '') => {
		res.body += b;
		res.writableEnded = true;
	};
	return handler(req, res).then(() => ({ status: res.statusCode, json: res.body ? JSON.parse(res.body) : null }));
}

beforeEach(() => {
	owners.clear();
	created.length = 0;
	order.length = 0;
});

describe('agent-signup route', () => {
	it('issues a challenge for a bare public key', async () => {
		const out = await call({ public_key: KEY });
		expect(out.status).toBe(200);
		expect(out.json.challenge.nonce).toHaveLength(32);
	});

	it('creates the account once and refuses the same key a second time with 409', async () => {
		const body = { public_key: KEY, nonce: 'N'.repeat(32), signature: 'sig' };
		const first = await call(body);
		expect(first.status).toBe(201);
		expect(first.json.credentials.api_key).toBe('sk_live_secret');
		expect(first.json.account.plan).toBe('free');
		const second = await call(body);
		expect(second.status).toBe(409);
		expect(second.json.error).toBe('wallet_has_account');
		expect(created).toHaveLength(1);
	});

	it('checks the daily cap and burns the challenge before it creates anything', async () => {
		await call({ public_key: KEY, nonce: 'N'.repeat(32), signature: 'sig' });
		expect(order).toEqual(['cap', 'redeem']);
	});

	it('rejects a malformed public key', async () => {
		const out = await call({ public_key: 'nope' });
		expect(out.status).toBe(400);
		expect(created).toHaveLength(0);
	});
});
