// x402 v2 `upto` on Solana, end to end through paidEndpoint().
//
// Real: the @x402/svm upto CLIENT (builds and signs the channel open
// transaction), the @x402/svm upto SERVER scheme (advertises the offer and signs
// the claim voucher), x402-spec.js, and the paidEndpoint wrapper. Test-controlled:
// the facilitator (tests/helpers/upto-local-facilitator.js), which keeps every
// signature check real (buyer open-tx ed25519, server voucher ed25519) and
// replaces only the chain with an in-memory ledger.

import { Readable } from 'node:stream';

import { generateKeyPairSigner } from '@solana/kit';
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { UptoLocalFacilitator } from './helpers/upto-local-facilitator.js';

vi.mock('@coinbase/x402', () => ({ createCdpAuthHeaders: vi.fn(async () => ({})) }));

const USDC_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const CAP = 50_000n; // 0.05 USDC

let paidEndpoint;
let uptoMod;
let specMod;
let facilitator;
let operator;
let payer;
let payTo;

function mockReqRes({ method = 'GET', headers = {}, url = '/api/x402/upto-test' } = {}) {
	const lower = {};
	for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
	const req = Object.assign(new Readable({ read() {} }), {
		method,
		url,
		headers: lower,
		connection: { remoteAddress: '127.0.0.1' },
		socket: { remoteAddress: '127.0.0.1' },
	});
	req.push(null);
	const chunks = [];
	const resHeaders = {};
	const res = {
		statusCode: 200,
		writableEnded: false,
		setHeader(k, v) {
			resHeaders[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return resHeaders[k.toLowerCase()];
		},
		end(body) {
			if (body !== undefined) chunks.push(body);
			res.writableEnded = true;
		},
		write(chunk) {
			chunks.push(chunk);
		},
		get body() {
			return chunks.join('');
		},
		get headers() {
			return resHeaders;
		},
	};
	return { req, res };
}

function decodeHeader(res, name) {
	return JSON.parse(Buffer.from(String(res.getHeader(name)), 'base64').toString('utf8'));
}

function make402Challenge(res) {
	const header = res.getHeader('payment-required');
	return header ? decodeHeader(res, 'payment-required') : JSON.parse(res.body);
}

const BAZAAR = {
	discoverable: true,
	info: {
		input: { type: 'object', properties: {}, required: [] },
		output: { type: 'object', properties: { ok: { type: 'boolean' } } },
	},
	schema: { type: 'object' },
};

let routeSeq = 0;
function makeEndpoint({ handler, upto, siwx }) {
	routeSeq += 1;
	return paidEndpoint({
		route: `/api/x402/upto-test-${routeSeq}`,
		method: 'GET',
		networks: ['solana'],
		description: 'upto integration test',
		bazaar: BAZAAR,
		handler,
		upto,
		siwx,
	});
}

async function uptoAccept(endpoint, route) {
	const { req, res } = mockReqRes({ url: route });
	await endpoint(req, res);
	expect(res.statusCode).toBe(402);
	const challenge = make402Challenge(res);
	const accept = challenge.accepts.find((a) => a.scheme === 'upto');
	return { challenge, accept };
}

async function signPayment(accept, signer = payer) {
	const { UptoSvmScheme } = await import('@x402/svm/upto/client');
	const built = await new UptoSvmScheme(signer).createPaymentPayload(2, accept);
	return Buffer.from(
		JSON.stringify({ x402Version: 2, accepted: accept, payload: built.payload }),
	).toString('base64');
}

beforeAll(async () => {
	process.env.X402_ALLOW_MEMORY_FALLBACK = '1';
	delete process.env.DATABASE_URL;
	delete process.env.CDP_API_KEY_ID;
	delete process.env.CDP_API_KEY_SECRET;
	delete process.env.X402_BUILDER_CODE_APP;

	operator = await generateKeyPairSigner();
	payer = await generateKeyPairSigner();
	payTo = (await generateKeyPairSigner()).address;

	process.env.X402_PAY_TO_SOLANA = payTo;
	process.env.X402_ASSET_MINT_SOLANA = USDC_MAINNET;
	process.env.X402_MAX_AMOUNT_REQUIRED = '1000';
	const { generatePrivateKey } = await import('viem/accounts');
	process.env.OFFER_RECEIPT_SIGNING_PRIVATE_KEY = generatePrivateKey();

	uptoMod = await import('../api/_lib/x402/upto.js');
	specMod = await import('../api/_lib/x402-spec.js');
	({ paidEndpoint } = await import('../api/_lib/x402-paid-endpoint.js'));

	// A real blockhash-shaped value and slot so the client never needs an RPC.
	const fakeChainState = (await generateKeyPairSigner()).address;
	facilitator = new UptoLocalFacilitator({ feePayerAddress: operator.address });
	const baseExtra = facilitator.getExtra.bind(facilitator);
	facilitator.getExtra = () => ({
		...baseExtra(),
		recentBlockhash: fakeChainState,
		lastValidBlockHeight: '1000',
		recentSlot: '500',
	});

	const { UptoSvmScheme: ServerScheme } = await import('@x402/svm/upto/server');
	uptoMod.setUptoBundleForTests({
		facilitator,
		server: new ServerScheme({ receiverAuthorizerSigner: operator }),
		signer: operator,
	});
});

afterAll(() => {
	uptoMod?.setUptoBundleForTests(null);
});

beforeEach(() => {
	facilitator.events.length = 0;
});

describe('upto 402 challenge', () => {
	it('advertises the upto scheme with the cap, receiver authorizer and fee payer', async () => {
		const endpoint = makeEndpoint({
			handler: async () => ({ ok: true }),
			upto: { capAtomics: CAP, charge: () => 10_000n },
		});
		const { challenge, accept } = await uptoAccept(endpoint, '/api/x402/upto-test-1');
		console.log('402 body:\n' + JSON.stringify(challenge, null, 2));
		expect(accept).toBeTruthy();
		expect(accept.amount).toBe(String(CAP));
		expect(accept.network).toBe(SOLANA_MAINNET);
		expect(accept.asset).toBe(USDC_MAINNET);
		expect(accept.payTo).toBe(payTo);
		expect(accept.extra.receiverAuthorizer).toBe(operator.address);
		expect(accept.extra.feePayer).toBe(operator.address);
		expect(accept.extra.withdrawDelay).toBeGreaterThan(0);
		expect(accept.maxTimeoutSeconds).toBeLessThanOrEqual(uptoMod.UPTO_MAX_TIMEOUT_SECONDS);
	});
});

describe('upto extensions', () => {
	it('advertises sign-in-with-x and offer-receipt beside the upto accept', async () => {
		const endpoint = makeEndpoint({
			handler: async () => ({ ok: true }),
			upto: { capAtomics: CAP, charge: () => 1n },
			siwx: { statement: 'Sign in to re-access without paying again', ttlSeconds: 3600 },
		});
		const { challenge, accept } = await uptoAccept(endpoint, '/api/x402/upto-test-' + routeSeq);
		console.log('402 extensions:\n' + JSON.stringify(Object.keys(challenge.extensions)));
		expect(accept.scheme).toBe('upto');
		expect(challenge.extensions['sign-in-with-x']).toBeTruthy();
		expect(challenge.extensions['offer-receipt']).toBeTruthy();
	});
});

describe('llm-proxy route', () => {
	it('offers upto beside exact on the live route, with the extensions', async () => {
		const mod = await import('../api/x402/llm-proxy.js');
		const { req, res } = mockReqRes({ method: 'POST', url: '/api/x402/llm-proxy' });
		await mod.default(req, res);
		expect(res.statusCode).toBe(402);
		const challenge = JSON.parse(res.body);
		console.log('llm-proxy 402 accepts:\n' + JSON.stringify(challenge.accepts, null, 2));
		console.log('llm-proxy 402 extensions: ' + Object.keys(challenge.extensions).join(', '));
		const schemes = challenge.accepts.map((a) => a.scheme);
		expect(schemes).toContain('exact');
		expect(schemes).toContain('upto');
		expect(challenge.accepts.find((a) => a.scheme === 'upto').amount).toBe('25000');
		expect(challenge.extensions['offer-receipt']).toBeTruthy();
	});
});

describe('upto receipt', () => {
	it('returns a signed offer-receipt for the measured charge', async () => {
		const endpoint = makeEndpoint({
			handler: async () => ({ ok: true }),
			upto: { capAtomics: CAP, charge: () => 7_000n },
		});
		const route = '/api/x402/upto-test-' + routeSeq;
		const { accept } = await uptoAccept(endpoint, route);
		const header = await signPayment(accept);
		const { req, res } = mockReqRes({ url: route, headers: { 'x-payment': header } });
		await endpoint(req, res);
		expect(res.statusCode).toBe(200);
		const settled = decodeHeader(res, 'x-payment-response');
		const receipt = settled.extensions?.['offer-receipt'];
		console.log('offer-receipt:\n' + JSON.stringify(receipt, null, 2));
		expect(receipt?.info?.receipt).toBeTruthy();
		expect(receipt.info.receipt.signature).toBeTruthy();
	});
});

describe('upto settlement', () => {
	it('settles the measured amount, not the cap, and refunds the rest', async () => {
		const handler = vi.fn(async () => ({ ok: true }));
		const endpoint = makeEndpoint({
			handler,
			upto: { capAtomics: CAP, charge: () => 12_345n },
		});
		const route = '/api/x402/upto-test-' + routeSeq;
		const { accept } = await uptoAccept(endpoint, route);
		const header = await signPayment(accept);

		const { req, res } = mockReqRes({ url: route, headers: { 'x-payment': header } });
		await endpoint(req, res);

		expect(res.statusCode).toBe(200);
		expect(JSON.parse(res.body)).toEqual({ ok: true });
		expect(handler).toHaveBeenCalledTimes(1);

		const [deposit, claim] = facilitator.events;
		expect(deposit.kind).toBe('deposit');
		expect(deposit.amount).toBe(CAP);
		expect(claim.kind).toBe('claim');
		expect(claim.paid).toBe(12_345n);
		expect(claim.refunded).toBe(CAP - 12_345n);
		expect(claim.payTo).toBe(payTo);

		const receipt = decodeHeader(res, 'x-payment-response');
		expect(receipt.success).toBe(true);
	});

	it('settles nothing and refunds the whole deposit when the handler throws', async () => {
		const endpoint = makeEndpoint({
			handler: async () => {
				throw new Error('handler exploded');
			},
			upto: { capAtomics: CAP, charge: () => 10_000n },
		});
		const route = '/api/x402/upto-test-' + routeSeq;
		const { accept } = await uptoAccept(endpoint, route);
		const header = await signPayment(accept);

		const { req, res } = mockReqRes({ url: route, headers: { 'x-payment': header } });
		await endpoint(req, res).catch(() => {});

		expect(res.statusCode).toBeGreaterThanOrEqual(500);
		const paid = facilitator.events.filter((e) => e.kind === 'claim');
		expect(paid).toHaveLength(0);
		const cancel = facilitator.events.find((e) => e.kind === 'cancel');
		expect(cancel).toBeTruthy();
		expect(cancel.paid).toBe(0n);
		expect(cancel.refunded).toBe(CAP);
	});

	it('clamps a charge above the cap to the cap', async () => {
		const endpoint = makeEndpoint({
			handler: async () => ({ ok: true }),
			upto: { capAtomics: CAP, charge: () => CAP * 10n },
		});
		const route = '/api/x402/upto-test-' + routeSeq;
		const { accept } = await uptoAccept(endpoint, route);
		const header = await signPayment(accept);
		const { req, res } = mockReqRes({ url: route, headers: { 'x-payment': header } });
		await endpoint(req, res);
		expect(res.statusCode).toBe(200);
		expect(facilitator.events.find((e) => e.kind === 'claim').paid).toBe(CAP);
	});

	it('rejects a payment whose signed deposit differs from the cap', async () => {
		const endpoint = makeEndpoint({
			handler: async () => ({ ok: true }),
			upto: { capAtomics: CAP, charge: () => 1n },
		});
		const route = '/api/x402/upto-test-' + routeSeq;
		const { accept } = await uptoAccept(endpoint, route);
		const lowered = { ...accept, amount: String(CAP / 2n) };
		const header = await signPayment(lowered);
		const { req, res } = mockReqRes({ url: route, headers: { 'x-payment': header } });
		await endpoint(req, res);
		expect(res.statusCode).toBe(402);
		expect(facilitator.events).toHaveLength(0);
	});
});

describe('upto buyer', () => {
	it('refuses a cap above the agent per-call limit before signing anything', async () => {
		const { buildSolanaUptoPayload } = await import('../api/_lib/x402/a2a-client.js');
		const endpoint = makeEndpoint({
			handler: async () => ({ ok: true }),
			upto: { capAtomics: CAP, charge: () => 1n },
		});
		const { accept } = await uptoAccept(endpoint, '/api/x402/upto-test-' + routeSeq);
		await expect(
			buildSolanaUptoPayload({
				accept,
				signer: payer,
				resource: 'https://three.ws/x',
				maxPerCallAtomics: CAP - 1n,
			}),
		).rejects.toMatchObject({ code: 'cap_exceeds_limit' });
	});

	it('signs when the cap is within the per-call limit', async () => {
		const { buildSolanaUptoPayload } = await import('../api/_lib/x402/a2a-client.js');
		const endpoint = makeEndpoint({
			handler: async () => ({ ok: true }),
			upto: { capAtomics: CAP, charge: () => 1n },
		});
		const { accept } = await uptoAccept(endpoint, '/api/x402/upto-test-' + routeSeq);
		const built = await buildSolanaUptoPayload({
			accept,
			signer: payer,
			resource: 'https://three.ws/x',
			maxPerCallAtomics: CAP,
		});
		expect(built.scheme).toBe('upto');
		expect(built.payload.deposit).toBe(String(CAP));
		expect(built.payload.from).toBe(payer.address);
	});
});

describe('upto spec helpers', () => {
	it('exports the scheme helpers', () => {
		expect(typeof specMod.verifyPayment).toBe('function');
		expect(uptoMod.isUptoRequirement({ scheme: 'upto' })).toBe(true);
		expect(uptoMod.isUptoRequirement({ scheme: 'exact' })).toBe(false);
		expect(uptoMod.normaliseCharge('5', '10')).toBe(5n);
		expect(uptoMod.normaliseCharge('50', '10')).toBe(10n);
		expect(() => uptoMod.normaliseCharge('-1', '10')).toThrow(/negative/);
		expect(() => uptoMod.normaliseCharge('abc', '10')).toThrow(/integer/);
	});
});
