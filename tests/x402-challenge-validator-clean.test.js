// External x402 directory validators (402index confirmed) reject a whole 402
// challenge when any accepts[] entry carries amount "0". Endpoints that declare
// authHints used to append such entries by default. These tests pin the clean
// default, the opt-in path, and that the free Bearer auth path still works
// either way.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { mockReqRes, readChallenge } from './helpers/x402-mock-http.js';

vi.mock('@coinbase/x402', () => ({ createCdpAuthHeaders: vi.fn(async () => ({})) }));

const USDC_SOLANA = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const PAY_TO_BASE = '0x1111111111111111111111111111111111111111';
const PAY_TO_SOLANA = 'wwwwwDxFWRn7grgr3Esrsg5C6NvDoDHSA4gaCffccrU';

const BAZAAR = {
	discoverable: true,
	info: {
		input: { type: 'object', properties: {}, required: [] },
		output: { type: 'object', properties: { ok: { type: 'boolean' } } },
	},
	schema: { type: 'object' },
};

let paidEndpoint;
let mintAccessToken;
let seq = 0;

function makeEndpoint(handler = async () => ({ ok: true })) {
	seq += 1;
	return paidEndpoint({
		route: `/api/x402/auth-hint-clean-${seq}`,
		method: 'GET',
		networks: ['solana', 'base'],
		description: 'auth hints test',
		bazaar: BAZAAR,
		requiredScope: 'x402:bypass',
		authHints: {
			oauth2: { requiredScope: 'read:agent-reputation', tokenType: 'Bearer' },
			siwx: true,
		},
		handler,
	});
}

beforeAll(async () => {
	process.env.X402_ALLOW_MEMORY_FALLBACK = '1';
	delete process.env.DATABASE_URL;
	delete process.env.CDP_API_KEY_ID;
	delete process.env.CDP_API_KEY_SECRET;
	delete process.env.X402_BUILDER_CODE_APP;
	process.env.X402_PAY_TO_SOLANA = PAY_TO_SOLANA;
	process.env.X402_ASSET_MINT_SOLANA = USDC_SOLANA;
	process.env.X402_PAY_TO_BASE = PAY_TO_BASE;
	process.env.X402_ASSET_ADDRESS_BASE = USDC_BASE;
	process.env.JWT_SECRET = 'test-secret-for-auth-hints-0123456789abcdef';
	process.env.ISSUER = 'https://three.ws';
	process.env.MCP_RESOURCE = 'https://three.ws/mcp';
	({ paidEndpoint } = await import('../api/_lib/x402-paid-endpoint.js'));
	({ mintAccessToken } = await import('../api/_lib/auth.js'));
});

afterEach(() => {
	delete process.env.X402_AUTH_HINT_ACCEPTS;
});

async function challengeFor(endpoint) {
	const { req, res } = mockReqRes({ url: `/api/x402/auth-hint-clean-${seq}` });
	await endpoint(req, res);
	expect(res.statusCode).toBe(402);
	return readChallenge(res);
}

const amountOf = (a) => String(a.amount ?? a.maxAmountRequired ?? '');

describe('402 challenge for a route that declares authHints', () => {
	it('with default env has no zero-amount or authRequired accepts and no auth-hints extension', async () => {
		delete process.env.X402_AUTH_HINT_ACCEPTS;
		const challenge = await challengeFor(makeEndpoint());
		expect(challenge.accepts.length).toBeGreaterThan(0);
		for (const a of challenge.accepts) {
			expect(amountOf(a)).not.toBe('0');
			expect(Number(amountOf(a))).toBeGreaterThan(0);
			expect(a.extra?.authRequired).toBeUndefined();
		}
		expect(challenge.extensions?.['auth-hints']).toBeUndefined();
	});

	it('still emits the legacy zero-amount accepts and extension when X402_AUTH_HINT_ACCEPTS=true', async () => {
		process.env.X402_AUTH_HINT_ACCEPTS = 'true';
		const challenge = await challengeFor(makeEndpoint());
		expect(challenge.accepts.some((a) => amountOf(a) === '0')).toBe(true);
		expect(challenge.extensions?.['auth-hints']).toBeDefined();
	});
});

describe('free auth path is independent of the advertisement flag', () => {
	for (const flag of ['true', 'false', undefined]) {
		it(`a valid Bearer reaches the handler with no payment (flag=${flag})`, async () => {
			if (flag === undefined) delete process.env.X402_AUTH_HINT_ACCEPTS;
			else process.env.X402_AUTH_HINT_ACCEPTS = flag;
			const handler = vi.fn(async () => ({ ok: true }));
			const endpoint = makeEndpoint(handler);
			const token = await mintAccessToken({
				userId: '00000000-0000-4000-8000-000000000001',
				scope: 'read:agent-reputation',
			});
			const { req, res } = mockReqRes({
				url: `/api/x402/auth-hint-clean-${seq}`,
				headers: { authorization: `Bearer ${token}` },
			});
			await endpoint(req, res);
			expect(res.statusCode).toBe(200);
			expect(handler).toHaveBeenCalledTimes(1);
			expect(res.getHeader('x-payment-bypass')).toBe('auth-hints:oauth2');
		});
	}

	it('a Bearer with the wrong scope is refused, not charged and not served', async () => {
		const handler = vi.fn(async () => ({ ok: true }));
		const endpoint = makeEndpoint(handler);
		const token = await mintAccessToken({
			userId: '00000000-0000-4000-8000-000000000001',
			scope: 'profile',
		});
		const { req, res } = mockReqRes({
			url: `/api/x402/auth-hint-clean-${seq}`,
			headers: { authorization: `Bearer ${token}` },
		});
		await endpoint(req, res);
		expect(res.statusCode).toBe(403);
		expect(handler).not.toHaveBeenCalled();
	});
});
