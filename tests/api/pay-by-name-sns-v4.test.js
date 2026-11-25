// GET /api/x402/pay-by-name?name=<x>.sol against the REAL SNS library.
//
// Production 404'd `threews.sol` (the platform's own parent domain, which the
// pay-by-name health pipeline probes every ten minutes) because SDK v4 rejects
// ".sol" names in resolve() past its TLD cutoff slot, and the handler folded
// every resolver error, RPC outages included, into "could not resolve". The
// name must resolve through the classic registry, an unregistered name must
// stay a 404, and a lookup that could not run must say so instead of claiming
// the name does not exist.

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { createFakeSnsRpc } from '../helpers/fake-sns-rpc.js';

const sqlMock = vi.fn(async () => []);
vi.mock('../../api/_lib/db.js', () => ({ sql: (...a) => sqlMock(...a), isDbUnavailableError: () => false, isDbCapacityError: () => false }));

vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: { authIp: vi.fn(async () => ({ success: true })) },
	clientIp: () => '127.0.0.1',
}));

let rpc;
vi.mock('../../api/_lib/agent-pumpfun.js', () => ({
	solanaConnection: () => rpc.connection,
	loadAgentForSigning: vi.fn(),
}));

beforeAll(() => {
	process.env.THREEWS_SOL_PARENT_DOMAIN = 'threews.sol';
});

const { default: handler } = await import('../../api/x402/pay-by-name.js');

const OWNER = Keypair.generate().publicKey;
const SUB_OWNER = Keypair.generate().publicKey;

async function call(url) {
	const res = {
		statusCode: 200,
		_h: {},
		setHeader(k, v) { this._h[k.toLowerCase()] = v; },
		getHeader(k) { return this._h[k.toLowerCase()]; },
		end(body) { this._body = body; },
	};
	await handler({ url, method: 'GET', headers: { host: 'x' }, query: {} }, res);
	return { status: res.statusCode, body: JSON.parse(res._body) };
}

beforeEach(() => {
	rpc = createFakeSnsRpc();
	sqlMock.mockClear();
});

describe('GET /api/x402/pay-by-name (.sol, real SNS library)', () => {
	it('resolves the platform parent domain threews.sol', async () => {
		rpc.register('threews', OWNER);
		const { status, body } = await call('/api/x402/pay-by-name?name=threews.sol');
		expect(status).toBe(200);
		expect(body.data).toMatchObject({ address: OWNER.toBase58(), source: 'sns', resolved: 'threews.sol' });
	});

	it('resolves a <label>.threews.sol subdomain', async () => {
		rpc.register('threews', OWNER);
		rpc.register('nich.threews', SUB_OWNER);
		const { status, body } = await call('/api/x402/pay-by-name?name=nich.threews.sol');
		expect(status).toBe(200);
		expect(body.data.address).toBe(SUB_OWNER.toBase58());
	});

	it('404s a name nobody registered', async () => {
		const { status, body } = await call('/api/x402/pay-by-name?name=nobody-registered-this.sol');
		expect(status).toBe(404);
		expect(body.error).toBe('not_found');
	});

	it('503s, not 404s, when the name service cannot be reached', async () => {
		rpc.register('threews', OWNER);
		rpc.fail(new Error('fetch failed'));
		const { status, body } = await call('/api/x402/pay-by-name?name=threews.sol');
		expect(status).toBe(503);
		expect(body.error).toBe('sns_unavailable');
	});
});
