// integrate 18: let three.ws agents pay x402 v1 sellers.
//
// Most of the open x402 bazaar, and every service in the owner's x402-suite,
// still speaks x402 v1 (`x402Version: 1`, flat network strings like
// `"solana"`, price field `maxAmountRequired`) rather than v2's CAIP-2
// network strings and `amount` field. buildPayingFetch() registers both wire
// formats on the same client via registerExactSvmScheme() (see
// ../src/lib/x402-buyer.js). These tests exercise the real @x402/core /
// @x402/svm SDK classes directly, no reimplementation of their selection or
// header-precedence logic, against a captured v1 402 shape and a
// dual-version offer, with no network call and no signing.
//
// The v1 402 body below mirrors, field for field, the real shape the owner's
// x402-domains service (an x402-suite member, read from its
// src/payments.ts `challenge()`/`buildAccepts()` functions) sends on an
// unpaid request. `payTo`/`asset` are replaced with the $THREE mint and
// clearly-synthetic placeholders, never a real third-party wallet or mint.

import test from 'node:test';
import assert from 'node:assert/strict';

import { x402Client, x402HTTPClient } from '@x402/core/client';
import { encodePaymentRequiredHeader } from '@x402/core/http';
import { registerExactSvmScheme } from '@x402/svm/exact/client';
import { generateKeyPairSigner } from '@solana/kit';

const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const SYNTH_PAYTO = 'THREEsynthetic1111111111111111111111111111';
const SYNTH_FEE_PAYER = 'THREEsynthetic3333333333333333333333333333';

// A captured v1 402 challenge body, shaped exactly like a real x402-suite
// service's unpaid response (x402Version: 1, flat `network`,
// `maxAmountRequired`, `resource` as a bare URL string).
function capturedV1Body() {
	return {
		x402Version: 1,
		error: 'X-PAYMENT header is required',
		accepts: [
			{
				scheme: 'exact',
				network: 'solana',
				maxAmountRequired: '10000',
				resource: 'https://example.invalid/v1/lookup',
				description: 'Example x402-suite style paid lookup',
				mimeType: 'application/json',
				payTo: SYNTH_PAYTO,
				maxTimeoutSeconds: 60,
				asset: THREE_MINT,
				extra: { name: 'THREE', decimals: 6, feePayer: SYNTH_FEE_PAYER },
			},
		],
	};
}

// The same offer restated in v2 shape (CAIP-2 network, `amount` instead of
// `maxAmountRequired`, structured `resource`).
function capturedV2Required() {
	return {
		x402Version: 2,
		resource: { url: 'https://example.invalid/v2/lookup' },
		accepts: [
			{
				scheme: 'exact',
				network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
				amount: '10000',
				asset: THREE_MINT,
				payTo: SYNTH_PAYTO,
				maxTimeoutSeconds: 60,
				extra: { name: 'THREE', decimals: 6, feePayer: SYNTH_FEE_PAYER },
			},
		],
	};
}

async function buildRegisteredClient() {
	const signer = await generateKeyPairSigner();
	const client = new x402Client();
	// These tests exercise protocol-version selection, not the asset
	// allowlist (default spend controls only allow USDC/the scheme's default
	// assets, and $THREE is neither here).
	client.setSpendControls(false);
	registerExactSvmScheme(client, { signer });
	return client;
}

test('v1 402 body: requirement selection returns a valid v1 requirement without signing', async () => {
	const client = await buildRegisteredClient();
	const body = capturedV1Body();

	const selected = client.selectPaymentRequirements(1, body.accepts);

	assert.equal(selected.scheme, 'exact');
	assert.equal(selected.network, 'solana');
	assert.equal(selected.maxAmountRequired, '10000');
	assert.equal(selected.asset, THREE_MINT);
	assert.equal(selected.payTo, SYNTH_PAYTO);
	// Selection is pure accept-picking: no payload, no signature, nothing
	// signer-shaped on the result.
	assert.equal('payload' in selected, false);
	assert.equal('signature' in selected, false);
});

test('v2 is preferred over v1 when a seller offers both', async () => {
	const client = await buildRegisteredClient();
	const httpClient = new x402HTTPClient(client);

	const v1Body = capturedV1Body();
	const v2Required = capturedV2Required();
	// A dual-version seller sends the v2 `PAYMENT-REQUIRED` header AND a
	// v1-shaped JSON body for legacy buyers. getPaymentRequiredResponse() must
	// pick the header (v2) over the body (v1): this is the real SDK's own
	// precedence, not reimplemented here.
	const headers = { 'payment-required': encodePaymentRequiredHeader(v2Required) };
	const getHeader = (name) => headers[name.toLowerCase()];

	const paymentRequired = httpClient.getPaymentRequiredResponse(getHeader, v1Body);
	assert.equal(paymentRequired.x402Version, 2, 'the v2 header must win over the v1 body fallback');

	const selected = client.selectPaymentRequirements(paymentRequired.x402Version, paymentRequired.accepts);
	assert.equal(selected.network, 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
	assert.equal(selected.amount, '10000');
});

test('v1 and v2 settlement receipts expose the same field names (no normalization needed)', async () => {
	// Task 3: /receipts and the session ledger must not care which protocol
	// version paid. Both the real @x402/svm v1 facilitator's settle() output
	// and the v2 scheme's settlement responses use the SAME field names
	// (success, transaction, network, payer) -- confirmed by reading
	// @x402/svm's exact/v1/facilitator source. getPaymentSettleResponse() does
	// no version-specific decoding; it just base64-decodes whichever
	// settlement header is present, so a v1 receipt already arrives in the
	// shape every downstream reader (api/agents/a2a-hire.js's
	// receiptSignature(), /api/x402/my-receipts.js) expects.
	const client = await buildRegisteredClient();
	const httpClient = new x402HTTPClient(client);

	const v1Receipt = { success: true, transaction: 'sig-v1-example', network: 'solana', payer: SYNTH_PAYTO };
	const v2Receipt = { success: true, transaction: 'sig-v2-example', network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', payer: SYNTH_PAYTO };

	const { encodePaymentResponseHeader } = await import('@x402/core/http');
	const decodedV1 = httpClient.getPaymentSettleResponse(
		(name) => (name.toLowerCase() === 'x-payment-response' ? encodePaymentResponseHeader(v1Receipt) : undefined),
	);
	const decodedV2 = httpClient.getPaymentSettleResponse(
		(name) => (name.toLowerCase() === 'payment-response' ? encodePaymentResponseHeader(v2Receipt) : undefined),
	);

	for (const receipt of [decodedV1, decodedV2]) {
		assert.equal(typeof receipt.success, 'boolean');
		assert.equal(typeof receipt.transaction, 'string');
		assert.equal(typeof receipt.network, 'string');
		assert.equal(typeof receipt.payer, 'string');
	}
});
