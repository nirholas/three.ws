// Pay-per-request /api/v1/chat/completions over x402 `upto`, end to end.
//
// Real: the handler, the agent loop, the OpenAI-wire stream reader, the price
// table, the @x402/svm upto client (signs the channel open) and server scheme
// (advertises the offer, signs the claim voucher). Test-controlled: the chain
// (tests/helpers/upto-local-facilitator.js keeps every signature check real and
// replaces only the ledger) and the model upstream, a local HTTP server that
// speaks the real OpenAI chat-completions streaming wire format.

import http from 'node:http';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

import { generateKeyPairSigner } from '@solana/kit';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { UptoLocalFacilitator } from './helpers/upto-local-facilitator.js';

vi.mock('@coinbase/x402', () => ({ createCdpAuthHeaders: vi.fn(async () => ({})) }));

let upstreamUrl = '';
vi.mock('../api/_lib/llm-tool-chain.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, providerChain: () => [{ name: 'groq', url: upstreamUrl, key: 'k', model: 'local-model' }] };
});
vi.mock('../api/_lib/rate-limit.js', async (importOriginal) => {
	const actual = await importOriginal();
	const ok = async () => ({ success: true, limit: 120, remaining: 119, reset: Date.now() + 1000 });
	return { ...actual, limits: new Proxy(actual.limits, { get: (t, k) => (k === 'apiV1' || k === 'x402VerifyPenalty' ? ok : t[k]) }) };
});
vi.mock('../api/_lib/auth.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, getSessionUser: async () => null };
});
vi.mock('../api/_lib/x402/audit-log.js', () => ({ logPaymentEvent: vi.fn() }));
vi.mock('../api/_lib/usage.js', () => ({ recordEvent: vi.fn() }));

const USDC_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

let handler;
let uptoMod;
let metered;
let table;
let facilitator;
let operator;
let payer;
let server;
let upstreamMode = { kind: 'ok', usage: { prompt_tokens: 1200, completion_tokens: 300 }, deltas: ['Hello ', 'from ', 'the model.'] };
let upstreamHold = null;

function startUpstream() {
	server = http.createServer((req, res) => {
		req.resume();
		req.on('end', async () => {
			if (upstreamMode.kind === 'down') {
				res.writeHead(500, { 'content-type': 'application/json' });
				return res.end(JSON.stringify({ error: { message: 'upstream unavailable' } }));
			}
			res.writeHead(200, { 'content-type': 'text/event-stream' });
			const frame = (delta, extra = {}) =>
				`data: ${JSON.stringify({ id: 'up-1', object: 'chat.completion.chunk', model: 'local-model', choices: [{ index: 0, delta, finish_reason: null }], ...extra })}\n\n`;
			for (const d of upstreamMode.deltas) res.write(frame({ content: d }));
			if (upstreamMode.kind === 'hold') {
				await new Promise((r) => (upstreamHold = r));
			}
			res.write(`data: ${JSON.stringify({ id: 'up-1', object: 'chat.completion.chunk', model: 'local-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
			res.write(`data: ${JSON.stringify({ id: 'up-1', object: 'chat.completion.chunk', model: 'local-model', choices: [], usage: upstreamMode.usage })}\n\n`);
			res.write('data: [DONE]\n\n');
			res.end();
		});
	});
	return new Promise((resolve) =>
		server.listen(0, '127.0.0.1', () => {
			upstreamUrl = `http://127.0.0.1:${server.address().port}/v1/chat/completions`;
			resolve();
		}),
	);
}

function mockReqRes({ headers = {}, body }) {
	const lower = { 'content-type': 'application/json' };
	for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
	const req = Object.assign(new Readable({ read() {} }), {
		method: 'POST',
		url: '/api/v1/chat/completions',
		headers: lower,
		connection: { remoteAddress: '127.0.0.1' },
		socket: { remoteAddress: '127.0.0.1' },
	});
	req.push(JSON.stringify(body));
	req.push(null);
	const chunks = [];
	const resHeaders = {};
	const res = Object.assign(new EventEmitter(), {
		statusCode: 200,
		writableEnded: false,
		headersSent: false,
		setHeader(k, v) {
			resHeaders[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return resHeaders[k.toLowerCase()];
		},
		write(chunk) {
			res.headersSent = true;
			chunks.push(String(chunk));
			return true;
		},
		end(chunk) {
			if (chunk !== undefined) chunks.push(String(chunk));
			res.headersSent = true;
			res.writableEnded = true;
			res.emit('close');
		},
	});
	Object.defineProperties(res, {
		body: { get: () => chunks.join('') },
		headers: { get: () => resHeaders },
	});
	return { req, res };
}

async function sign(accept) {
	const { UptoSvmScheme } = await import('@x402/svm/upto/client');
	const built = await new UptoSvmScheme(payer).createPaymentPayload(2, accept);
	return Buffer.from(JSON.stringify({ x402Version: 2, accepted: accept, payload: built.payload })).toString('base64');
}

async function challengeFor(body) {
	const { req, res } = mockReqRes({ body });
	await handler(req, res);
	expect(res.statusCode).toBe(402);
	const challenge = JSON.parse(res.body);
	return { res, challenge, accept: challenge.accepts.find((a) => a.scheme === 'upto') };
}

const MESSAGES = [{ role: 'user', content: 'Say hello.' }];

beforeAll(async () => {
	process.env.X402_ALLOW_MEMORY_FALLBACK = '1';
	delete process.env.DATABASE_URL;
	operator = await generateKeyPairSigner();
	payer = await generateKeyPairSigner();
	process.env.X402_PAY_TO_SOLANA = (await generateKeyPairSigner()).address;
	process.env.X402_ASSET_MINT_SOLANA = USDC_MAINNET;
	process.env.X402_UPTO_ENABLED = 'true';
	process.env.X402_FEE_PAYER_SECRET_BASE58 = 'unused-because-the-bundle-is-installed';
	const { generatePrivateKey } = await import('viem/accounts');
	process.env.OFFER_RECEIPT_SIGNING_PRIVATE_KEY = generatePrivateKey();

	await startUpstream();

	uptoMod = await import('../api/_lib/x402/upto.js');
	metered = await import('../api/_lib/metered-router.js');
	table = await import('../api/_lib/pricing/inference-models.js');

	const chainState = (await generateKeyPairSigner()).address;
	facilitator = new UptoLocalFacilitator({ feePayerAddress: operator.address });
	const baseExtra = facilitator.getExtra.bind(facilitator);
	facilitator.getExtra = () => ({ ...baseExtra(), recentBlockhash: chainState, lastValidBlockHeight: '1000', recentSlot: '500' });
	const { UptoSvmScheme: ServerScheme } = await import('@x402/svm/upto/server');
	uptoMod.setUptoBundleForTests({
		facilitator,
		server: new ServerScheme({ receiverAuthorizerSigner: operator }),
		signer: operator,
	});

	({ default: handler } = await import('../api/v1/chat/completions.js'));
});

afterAll(async () => {
	uptoMod?.setUptoBundleForTests(null);
	await new Promise((r) => server.close(r));
});

beforeEach(() => {
	facilitator.events.length = 0;
	upstreamMode = { kind: 'ok', usage: { prompt_tokens: 1200, completion_tokens: 300 }, deltas: ['Hello ', 'from ', 'the model.'] };
});

describe('unauthenticated request', () => {
	it('answers a valid 402 with an upto offer sized to the worst case', async () => {
		const body = { model: 'three-ws/agent', messages: MESSAGES, stream: false };
		const { res, challenge, accept } = await challengeFor(body);
		console.log('402 accepts:\n' + JSON.stringify(challenge.accepts, null, 2));
		expect(res.headers['payment-required']).toBeTruthy();
		expect(challenge.x402Version).toBe(2);
		expect(accept.scheme).toBe('upto');
		expect(accept.network).toMatch(/^solana:/);
		expect(accept.asset).toBe(USDC_MAINNET);
		expect(accept.amount).toBe(String(metered.worstCaseAtomics(table.inferenceModelRow('three-ws/agent'), body)));
		expect(accept.extra.receiverAuthorizer).toBe(operator.address);
	});

	it('sizes the cap to the request: a longer prompt asks for a larger cap', async () => {
		const small = await challengeFor({ messages: MESSAGES });
		const big = await challengeFor({ messages: [{ role: 'user', content: 'x'.repeat(40_000) }] });
		expect(BigInt(big.accept.amount)).toBeGreaterThan(BigInt(small.accept.amount));
	});

	it('refuses naming an agent without an owner', async () => {
		const { req, res } = mockReqRes({ body: { messages: MESSAGES, agent_id: '00000000-0000-4000-8000-000000000000' } });
		await handler(req, res);
		expect(res.statusCode).toBe(401);
		expect(JSON.parse(res.body).error).toBe('sign_in_required');
	});
});

describe('metered settlement', () => {
	it('settles measured tokens times the published price and refunds the rest of the cap', async () => {
		const body = { model: 'three-ws/agent', messages: MESSAGES, stream: false };
		const { accept } = await challengeFor(body);
		const { req, res } = mockReqRes({ body, headers: { 'x-payment': await sign(accept) } });
		await handler(req, res);

		expect(res.statusCode).toBe(200);
		const out = JSON.parse(res.body);
		expect(out.usage.prompt_tokens).toBe(1200);
		expect(out.usage.completion_tokens).toBe(300);

		// 1200 in at 0.5 and 300 out at 2.0 USD per million tokens = 0.0012 USD.
		const row = table.inferenceModelRow('three-ws/agent');
		const expected = BigInt(Math.round(((1200 * row.input_usd_per_mtok + 300 * row.output_usd_per_mtok) / 1e6) * 1e6));
		expect(expected).toBe(1200n);
		const [deposit, claim] = facilitator.events;
		expect(deposit.kind).toBe('deposit');
		expect(deposit.amount).toBe(BigInt(accept.amount));
		expect(claim.kind).toBe('claim');
		expect(claim.paid).toBe(expected);
		console.log('settlement events: ' + JSON.stringify(facilitator.events, (k, v) => (typeof v === 'bigint' ? String(v) : v)));

		const settled = JSON.parse(Buffer.from(res.headers['x-payment-response'], 'base64').toString('utf8'));
		expect(settled.charged_atomics).toBe('1200');
		expect(settled.refunded_atomics).toBe(String(BigInt(accept.amount) - 1200n));
	});

	it('settles on stream close and reports the charge in the usage chunk', async () => {
		const body = { model: 'three-ws/agent', messages: MESSAGES, stream: true, stream_options: { include_usage: true } };
		const { accept } = await challengeFor(body);
		const { req, res } = mockReqRes({ body, headers: { 'x-payment': await sign(accept) } });
		await handler(req, res);

		expect(res.statusCode).toBe(200);
		expect(res.body).toContain('Hello ');
		expect(res.body).toContain('data: [DONE]');
		const claim = facilitator.events.find((e) => e.kind === 'claim');
		expect(claim.paid).toBe(1200n);
		const usageFrame = res.body.split('\n').filter((l) => l.startsWith('data: {')).map((l) => JSON.parse(l.slice(6))).find((f) => f.usage);
		expect(usageFrame.billing.charged_atomics).toBe('1200');
		expect(usageFrame.billing.paid_via).toBe('x402-upto');
	});

	it('charges only the tokens already sent when the client drops the stream', async () => {
		upstreamMode = { kind: 'hold', usage: { prompt_tokens: 5000, completion_tokens: 5000 }, deltas: ['A'.repeat(40)] };
		const body = { model: 'three-ws/agent', messages: MESSAGES, stream: true };
		const { accept } = await challengeFor(body);
		const { req, res } = mockReqRes({ body, headers: { 'x-payment': await sign(accept) } });
		const running = handler(req, res);

		await vi.waitFor(() => expect(res.body).toContain('AAAA'));
		res.emit('close');
		await vi.waitFor(() => expect(facilitator.events.some((e) => e.kind === 'claim')).toBe(true));

		const row = table.inferenceModelRow('three-ws/agent');
		const expected = metered.chargeAtomics(row, metered.promptTokensOf(body), 10);
		const claim = facilitator.events.find((e) => e.kind === 'claim');
		expect(claim.paid).toBe(expected);
		expect(claim.paid).toBeLessThan(5000n);

		upstreamHold?.();
		await running;
		expect(facilitator.events.filter((e) => e.kind === 'claim')).toHaveLength(1);
	});

	it('returns the whole deposit when the completion fails before any token', async () => {
		upstreamMode = { kind: 'down', deltas: [] };
		const body = { model: 'three-ws/agent', messages: MESSAGES, stream: false };
		const { accept } = await challengeFor(body);
		const { req, res } = mockReqRes({ body, headers: { 'x-payment': await sign(accept) } });
		await handler(req, res);
		expect(res.statusCode).toBeGreaterThanOrEqual(500);
		expect(facilitator.events.map((e) => e.kind)).toEqual(['deposit', 'cancel']);
	});

	it('never charges above the cap', () => {
		const row = table.inferenceModelRow('three-ws/agent');
		const cap = metered.worstCaseAtomics(row, { messages: MESSAGES });
		expect(uptoMod.normaliseCharge(metered.chargeAtomics(row, 10_000_000, 10_000_000), cap)).toBe(cap);
	});
});

describe('deployment without upto', () => {
	it('keeps answering 401 missing_api_key when pay-per-request is not enabled', async () => {
		const saved = process.env.X402_UPTO_ENABLED;
		process.env.X402_UPTO_ENABLED = 'false';
		uptoMod.setUptoBundleForTests(null);
		try {
			const { req, res } = mockReqRes({ body: { messages: MESSAGES } });
			await handler(req, res);
			expect(res.statusCode).toBe(401);
			expect(JSON.parse(res.body).error).toBe('missing_api_key');
		} finally {
			process.env.X402_UPTO_ENABLED = saved;
		}
	});
});
