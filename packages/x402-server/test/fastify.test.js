// paid() on a real Fastify 5 server. Fastify hands handlers its own
// (request, reply) wrappers, not Node's (req, res); the gate must still answer
// 402 to an unpaid request and must never serve the paid body without payment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createX402Server, NETWORK_BASE_MAINNET } from '../src/index.js';

const require = createRequire(import.meta.url);
let Fastify = null;
try {
	Fastify = require('fastify');
} catch {
	Fastify = null;
}

const PAYTO = '0x00000000000000000000000000000000DeaDBeef';

// Queue-driven facilitator transport: each call to verify/settle takes the next
// scripted reply.
function facilitatorFetch(responses) {
	const queue = [...responses];
	return async () => {
		const body = queue.shift();
		return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) };
	};
}

async function start(server, opts, handler) {
	const app = Fastify();
	app.get('/paid', server.paid(opts, handler));
	await app.listen({ port: 0, host: '127.0.0.1' });
	return { app, base: `http://127.0.0.1:${app.server.address().port}` };
}

const OPTS = { price: '10000', payTo: { base: PAYTO }, network: ['base'] };

test('fastify: an unpaid request gets a 402 challenge and the paid output is not served', { skip: !Fastify }, async () => {
	let worked = false;
	const server = createX402Server({ fetch: facilitatorFetch([]) });
	const { app, base } = await start(server, OPTS, async () => {
		worked = true;
		return { secret: 'paid-output' };
	});
	try {
		const res = await fetch(`${base}/paid`);
		const text = await res.text();
		assert.equal(res.status, 402);
		assert.ok(res.headers.get('payment-required'));
		assert.equal(JSON.parse(text).x402Version, 2);
		assert.ok(!text.includes('paid-output'));
		assert.equal(worked, false);
	} finally {
		await app.close();
	}
});

test('fastify: a verified payment runs the handler, settles, and returns the receipt header', { skip: !Fastify }, async () => {
	const server = createX402Server({
		fetch: facilitatorFetch([
			{ isValid: true, payer: PAYTO },
			{ success: true, transaction: 'TX_FASTIFY', network: NETWORK_BASE_MAINNET, payer: PAYTO },
		]),
	});
	const { app, base } = await start(server, OPTS, async () => ({ secret: 'paid-output' }));
	try {
		const header = Buffer.from(
			JSON.stringify({ network: NETWORK_BASE_MAINNET, payload: { authorization: { value: '10000', to: PAYTO } } }),
		).toString('base64');
		const res = await fetch(`${base}/paid`, { headers: { 'x-payment': header } });
		assert.equal(res.status, 200);
		assert.equal((await res.json()).secret, 'paid-output');
		const receipt = JSON.parse(Buffer.from(res.headers.get('x-payment-response'), 'base64').toString());
		assert.equal(receipt.transaction, 'TX_FASTIFY');
	} finally {
		await app.close();
	}
});
