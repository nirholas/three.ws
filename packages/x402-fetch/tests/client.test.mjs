import { test } from 'node:test';
import assert from 'node:assert/strict';

import { withX402, wrapFetchWithPayment, privateKeyToWallet } from '../src/index.js';

// Deterministic Node signer — exercises the real secp256k1 / keccak256 / EIP-712
// stack on every payment, no mock signatures.
const WALLET = privateKeyToWallet(
	'0x4646464646464646464646464646464646464646464646464646464646464646',
);

const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const PAY_TO = '0x1111111111111111111111111111111111111111';

function baseAccept(amount) {
	return {
		scheme: 'exact',
		network: 'eip155:8453',
		amount: String(amount),
		asset: USDC_BASE,
		payTo: PAY_TO,
		maxTimeoutSeconds: 60,
		extra: { name: 'USD Coin', version: '2', decimals: 6 },
	};
}

function challenge402(accepts, resourceUrl = 'https://three.ws/api/mcp') {
	return new Response(
		JSON.stringify({
			x402Version: 2,
			error: 'X-PAYMENT header is required',
			resource: { url: resourceUrl, mimeType: 'application/json' },
			accepts,
		}),
		{ status: 402, headers: { 'content-type': 'application/json' } },
	);
}

// Build a mock fetch that 402s until an X-PAYMENT header arrives, then returns
// `success`. Records every call for assertions.
function mockFetch({ accepts, success }) {
	const calls = [];
	const fn = async (input, init) => {
		const headers = new Headers(init?.headers || undefined);
		calls.push({ input, init, xPayment: headers.get('X-PAYMENT') });
		if (headers.get('X-PAYMENT')) return success();
		return challenge402(accepts);
	};
	fn.calls = calls;
	return fn;
}

test('1. valid accepts[] triggers a payment + retry, returning the 200', async () => {
	const fetchMock = mockFetch({
		accepts: [baseAccept(50_000)], // $0.05
		success: () => new Response(JSON.stringify({ ok: true, reply: 'hi' }), { status: 200 }),
	});
	const pay = withX402(fetchMock, { wallet: WALLET, maxPaymentUsd: 1 });
	const res = await pay('https://three.ws/api/mcp', { method: 'POST' });

	assert.equal(res.status, 200);
	assert.deepEqual(await res.json(), { ok: true, reply: 'hi' });
	assert.equal(fetchMock.calls.length, 2, 'one 402 + one paid retry');
});

test('2. the retried request carries a correct X-PAYMENT header', async () => {
	const fetchMock = mockFetch({
		accepts: [baseAccept(50_000)],
		success: () => new Response('{}', { status: 200 }),
	});
	const pay = withX402(fetchMock, { wallet: WALLET, maxPaymentUsd: 1 });
	await pay('https://three.ws/api/mcp', { method: 'POST' });

	const retry = fetchMock.calls[1];
	assert.ok(retry.xPayment, 'retry has an X-PAYMENT header');

	const payload = JSON.parse(Buffer.from(retry.xPayment, 'base64').toString('utf8'));
	assert.equal(payload.x402Version, 2);
	assert.equal(payload.scheme, 'exact');
	assert.equal(payload.network, 'eip155:8453');
	// v2 exact-scheme shape: top-level echoes `accepted`; payload is exactly
	// { authorization, signature } — no stray keys the CDP schema would reject.
	assert.deepEqual(
		Object.keys(payload).sort(),
		['accepted', 'network', 'payload', 'scheme', 'x402Version'],
	);
	assert.deepEqual(payload.accepted, baseAccept(50_000));
	assert.deepEqual(Object.keys(payload.payload).sort(), ['authorization', 'signature']);
	const auth = payload.payload.authorization;
	assert.equal(auth.to, PAY_TO);
	assert.equal(auth.value, '50000');
	assert.equal(auth.from, WALLET.address);
	// Numeric fields MUST be decimal strings (CDP facilitator schema requires it).
	assert.equal(auth.validAfter, '0');
	assert.equal(typeof auth.validBefore, 'string');
	assert.match(auth.nonce, /^0x[0-9a-f]{64}$/);
	// 65-byte recoverable signature (0x + 130 hex).
	assert.match(payload.payload.signature, /^0x[0-9a-f]{130}$/);
});

test('3. a 402 with no matching network/asset throws descriptively', async () => {
	const solanaOnly = [
		{
			scheme: 'exact',
			network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
			amount: '50000',
			asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
			payTo: 'SoLPayToAddr1111111111111111111111111111111',
			extra: { name: 'USDC', decimals: 6 },
		},
	];
	const fetchMock = mockFetch({ accepts: solanaOnly, success: () => new Response('{}') });
	const pay = withX402(fetchMock, { wallet: WALLET, maxPaymentUsd: 1 });

	await assert.rejects(
		() => pay('https://three.ws/api/mcp'),
		/no supported network\/asset was found in accepts\[\]\. Supported: USDC on Base mainnet\./,
	);
});

test('4. maxPaymentUsd is enforced — a $5 challenge throws when the limit is $1', async () => {
	const fetchMock = mockFetch({
		accepts: [baseAccept(5_000_000)], // $5.00
		success: () => new Response('{}', { status: 200 }),
	});
	const pay = withX402(fetchMock, { wallet: WALLET, maxPaymentUsd: 1 });

	await assert.rejects(
		() => pay('https://three.ws/api/mcp'),
		/exceeds maxPaymentUsd limit of \$1\.0000/,
	);
	assert.equal(fetchMock.calls.length, 1, 'never retried — no payment signed');
});

test('5. a successful payment → 200 returns the 200 response body', async () => {
	const fetchMock = mockFetch({
		accepts: [baseAccept(10_000)],
		success: () =>
			new Response(JSON.stringify({ content: 'unlocked', tx: '0xabc' }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			}),
	});
	const pay = wrapFetchWithPayment(fetchMock, WALLET, { maxPaymentUsd: 1 });
	const res = await pay('https://three.ws/api/mcp');

	assert.equal(res.status, 200);
	assert.deepEqual(await res.json(), { content: 'unlocked', tx: '0xabc' });
});

test('6. non-402 responses (200, 404, 500) pass through unchanged', async () => {
	for (const status of [200, 404, 500]) {
		let calls = 0;
		const passthrough = async () => {
			calls++;
			return new Response(JSON.stringify({ status }), { status });
		};
		const pay = withX402(passthrough, { wallet: WALLET, maxPaymentUsd: 1 });
		const res = await pay('https://three.ws/api/x');
		assert.equal(res.status, status);
		assert.deepEqual(await res.json(), { status });
		assert.equal(calls, 1, `status ${status}: no payment attempt, single call`);
	}
});

test('onPayment callback fires before signing with USD amount + recipient', async () => {
	const seen = [];
	const fetchMock = mockFetch({
		accepts: [baseAccept(50_000)],
		success: () => new Response('{}', { status: 200 }),
	});
	const pay = withX402(fetchMock, {
		wallet: WALLET,
		maxPaymentUsd: 1,
		onPayment: (info) => seen.push(info),
	});
	await pay('https://three.ws/api/mcp');

	assert.equal(seen.length, 1);
	assert.equal(seen[0].amount, 0.05);
	assert.equal(seen[0].to, PAY_TO);
	assert.equal(seen[0].requestUrl, 'https://three.ws/api/mcp');
});

test('hostile extra.decimals cannot defeat maxPaymentUsd', async () => {
	for (const decimals of [30, 'abc', -5, 1e9, null]) {
		const accept = baseAccept(5_000_000_000); // $5000 on real USDC
		accept.extra = { ...accept.extra, decimals };
		const fetchMock = mockFetch({
			accepts: [accept],
			success: () => new Response('{}', { status: 200 }),
		});
		const pay = withX402(fetchMock, { wallet: WALLET, maxPaymentUsd: 1 });
		await assert.rejects(() => pay('https://three.ws/api/mcp'), /exceeds maxPaymentUsd/);
		assert.equal(fetchMock.calls.length, 1, `no payment signed for decimals=${decimals}`);
	}
});

test('an unpinned asset is refused instead of being signed', async () => {
	const accept = baseAccept(50_000);
	accept.asset = '0x2222222222222222222222222222222222222222';
	const fetchMock = mockFetch({
		accepts: [accept],
		success: () => new Response('{}', { status: 200 }),
	});
	const pay = withX402(fetchMock, { wallet: WALLET, maxPaymentUsd: 1 });
	await assert.rejects(() => pay('https://three.ws/api/mcp'), /no supported network\/asset/);
	assert.equal(fetchMock.calls.length, 1);
});
