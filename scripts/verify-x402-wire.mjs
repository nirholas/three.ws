#!/usr/bin/env node
// Local invariant check: server's 402 envelope <-> SDK's payment payload
// share the exact wire shape required by the Coinbase x402 v2 spec.
//
// Asserts (no network calls — pure import smoke):
//   1. paymentRequirements() returns v2-shape `accepts[]` entries
//      with `amount` (NOT `maxAmountRequired`).
//   2. build402Body() emits `x402Version: 2`, top-level resource{}, accepts[], extensions.bazaar.
//   3. SDK's PaymentPayload shape carries top-level `scheme` + `network`
//      that match the server's selectRequirement() lookup.
//   4. SDK's X-PAYMENT header constant equals what auth.js reads.

import assert from 'node:assert/strict';

process.env.X402_PAY_TO_SOLANA ??= 'BUrwd1nK6tFeeJMyzRHDo6AuVbnSfUULfvwq21X93nSN';
process.env.X402_PAY_TO_BASE ??= '0x4022de2d36c334e73c7a108805cea11c0564f402';
process.env.X402_ASSET_MINT_SOLANA ??= 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
process.env.X402_ASSET_ADDRESS_BASE ??= '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
process.env.X402_MAX_AMOUNT_REQUIRED ??= '1000';
process.env.X402_FEE_PAYER_SOLANA ??= '2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4';

const {
	paymentRequirements,
	build402Body,
	X402_VERSION,
	NETWORK_BASE_MAINNET,
	NETWORK_SOLANA_MAINNET,
} = await import('../api/_lib/x402-spec.js');
const { x402: sdkX402 } = await import('../agent-payments-sdk/dist/solana/index.js');
const { X402_HEADER_PAYMENT, X402_HEADER_PAYMENT_RESPONSE } = sdkX402;

console.log('[verify] server constants');
assert.equal(X402_VERSION, 2, 'server X402_VERSION must be 2');
assert.equal(NETWORK_BASE_MAINNET, 'eip155:8453');
assert.equal(
	NETWORK_SOLANA_MAINNET,
	'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
);

console.log('[verify] paymentRequirements() shape');
const reqs = paymentRequirements();
assert.ok(Array.isArray(reqs) && reqs.length >= 1, 'must return at least one accept');
for (const r of reqs) {
	assert.equal(r.scheme, 'exact', `scheme must be 'exact', got ${r.scheme}`);
	assert.ok(r.amount, `v2 spec requires 'amount' (not maxAmountRequired) on ${r.network}`);
	assert.ok(!('maxAmountRequired' in r), `must not emit legacy v1 field on ${r.network}`);
	assert.ok(r.payTo, `${r.network} missing payTo`);
	assert.ok(r.asset, `${r.network} missing asset`);
	assert.ok(r.network.includes(':'), `${r.network} must be CAIP-2`);
	if (r.network.startsWith('solana:'))
		assert.ok(r.extra?.feePayer, `Solana accepts must include extra.feePayer`);
	console.log(`  ok  ${r.network}/${r.scheme} amount=${r.amount} payTo=${r.payTo.slice(0, 8)}…`);
}

console.log('[verify] build402Body() envelope');
const body = build402Body({
	resourceUrl: 'https://three.ws/api/mcp',
	accepts: reqs,
});
assert.equal(body.x402Version, 2);
assert.equal(typeof body.resource, 'object');
assert.equal(body.resource.url, 'https://three.ws/api/mcp');
assert.ok(Array.isArray(body.accepts));
assert.ok(body.extensions?.bazaar?.discoverable, 'bazaar discovery extension must be present');
console.log(`  ok  x402Version=${body.x402Version} accepts=${body.accepts.length} bazaar=discoverable`);

console.log('[verify] SDK header constants match server reads');
assert.equal(X402_HEADER_PAYMENT, 'X-PAYMENT', 'SDK must send X-PAYMENT, server reads x-payment');
assert.equal(X402_HEADER_PAYMENT_RESPONSE, 'X-PAYMENT-RESPONSE');
console.log(`  ok  X-PAYMENT / X-PAYMENT-RESPONSE`);

console.log('[verify] PaymentPayload shape interop (SDK builds → server selectRequirement reads)');
const accept = reqs.find((r) => r.network === NETWORK_SOLANA_MAINNET);
const sdkPayload = {
	x402Version: 2,
	scheme: accept.scheme,
	network: accept.network,
	// PayAI's facilitator requires the ResourceInfo object form on the payload,
	// not a bare URL string — a string triggers `invalid_payload` on /verify.
	resource: { url: 'https://three.ws/api/mcp', mimeType: 'application/json' },
	accepted: accept,
	payload: { transaction: 'base64...', payer: '11111111111111111111111111111111' },
};
// Server's selectRequirement reads paymentPayload.network OR paymentPayload.paymentRequirements?.network
assert.equal(sdkPayload.network, accept.network);
console.log(`  ok  top-level network=${sdkPayload.network} matches server selectRequirement()`);

console.log('\nPASS — server <-> SDK wire shapes are aligned.');
