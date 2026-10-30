/**
 * MPP (BNB Machine Payments Protocol / b402) server adapter — unit tests.
 *
 * Credentials are REAL: `buildEip3009Payment` signs an actual EIP-712
 * TransferWithAuthorization with a synthetic account, so `mppVerify`'s
 * `recoverEip3009Payer` runs the true recovery path (no faked signatures).
 * On-chain settlement is exercised with an injected facilitator client — the
 * real b402 `/settle` needs merchant RSA creds we don't ship in tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { buildEip3009Payment, encodeXPayment } from '@bnb-chain/b402';
import {
	mppRequirements,
	mppChallenge,
	mppVerify,
	mppSettle,
	mppVerifyAndSettle,
	looksLikeMppPayment,
	isMppPayment,
	MPP_NETWORKS,
	MppError,
} from '../api/_lib/bnb/mpp-server.js';

const account = privateKeyToAccount(generatePrivateKey());
const ROUTE = '/api/x402/three-intel';
const PAYTO = getAddress('0x000000000000000000000000000000000000beef');
const ASSET = getAddress('0x0000000000000000000000000000000000005535'); // synthetic eip3009 token

function reqObj({ amount = '10000', network = MPP_NETWORKS.bscTestnet } = {}) {
	return {
		scheme: 'exact',
		network,
		amount,
		asset: ASSET,
		payTo: PAYTO,
		maxTimeoutSeconds: 300,
		extra: { name: 'USD', version: '1', assetTransferMethod: 'eip3009', signerAddress: PAYTO },
	};
}

async function header(requirements) {
	const payload = await buildEip3009Payment({ account, requirements, resourceUrl: ROUTE });
	return { header: encodeXPayment(payload), payload };
}

beforeEach(() => {
	process.env.X402_PAY_TO_BSC = PAYTO;
	process.env.MPP_ASSET_ADDRESS_BSC = ASSET;
	process.env.MPP_NETWORK = MPP_NETWORKS.bscTestnet;
	delete process.env.B402_BASE_URL; // ensure no real facilitator
});

describe('mppRequirements / mppChallenge', () => {
	it('emits a spec-shaped 402 for the route (testnet default)', async () => {
		const challenge = await mppChallenge({ route: ROUTE, priceAtomics: '10000', description: 'oracle' });
		expect(challenge.x402Version).toBe(2);
		expect(Array.isArray(challenge.accepts)).toBe(true);
		const [r] = challenge.accepts;
		expect(r.network).toBe(MPP_NETWORKS.bscTestnet);
		expect(r.payTo).toBe(PAYTO);
		expect(r.amount).toBe('10000');
		expect(r.extra.assetTransferMethod).toBe('eip3009');
	});

	it('prefers a live /supported kind for asset name + signer', async () => {
		const r = await mppRequirements({
			route: ROUTE,
			priceAtomics: '10000',
			supported: { kinds: [{ network: MPP_NETWORKS.bscTestnet, asset: ASSET, extra: { name: 'United Stables', signerAddress: '0xabc', assetTransferMethod: 'eip3009' } }] },
		});
		expect(r.extra.name).toBe('United Stables');
		expect(r.extra.signerAddress).toBe('0xabc');
	});

	it('throws MppError when no payTo is configured', async () => {
		delete process.env.X402_PAY_TO_BSC;
		delete process.env.MPP_PAY_TO_BSC;
		await expect(mppRequirements({ route: ROUTE, priceAtomics: '10000' })).rejects.toBeInstanceOf(MppError);
	});
});

describe('mppVerify — real EIP-3009 credential', () => {
	it('verifies a valid credential and recovers the payer', async () => {
		const requirements = reqObj();
		const { header: h } = await header(requirements);
		const out = await mppVerify({ headers: { 'x-payment': h } }, requirements);
		expect(out.ok).toBe(true);
		expect(out.payer.toLowerCase()).toBe(account.address.toLowerCase());
	});

	it('rejects a missing X-PAYMENT with 402', async () => {
		const out = await mppVerify({ headers: {} }, reqObj());
		expect(out).toMatchObject({ ok: false, code: 'no_payment', status: 402 });
	});

	it('rejects an offer whose amount does not match our requirements', async () => {
		const { header: h } = await header(reqObj({ amount: '999999' }));
		const out = await mppVerify({ headers: { 'x-payment': h } }, reqObj({ amount: '10000' }));
		expect(out).toMatchObject({ ok: false, code: 'offer_mismatch' });
	});

	it('rejects a non-BNB network payment (leaves it to x402)', async () => {
		const { header: h } = await header(reqObj({ network: 'eip155:8453' }));
		const out = await mppVerify({ headers: { 'x-payment': h } }, reqObj({ network: 'eip155:8453' }));
		// pin passes network equality but isMppPayment gate rejects non-BNB.
		expect(out.ok).toBe(false);
		expect(['wrong_network', 'offer_mismatch']).toContain(out.code);
	});

	it('rejects an undecodable header', async () => {
		const out = await mppVerify({ headers: { 'x-payment': 'not-base64-json!!' } }, reqObj());
		expect(out.ok).toBe(false);
		expect(['bad_payment', 'unsupported_credential']).toContain(out.code);
	});

	it('replay: the same credential is rejected the second time', async () => {
		const requirements = reqObj();
		const { header: h } = await header(requirements);
		const first = await mppVerify({ headers: { 'x-payment': h } }, requirements);
		expect(first.ok).toBe(true);
		const second = await mppVerify({ headers: { 'x-payment': h } }, requirements);
		expect(second).toMatchObject({ ok: false, code: 'replay', status: 409 });
	});
});

describe('mppSettle', () => {
	it('returns mpp_not_configured (503) without merchant credentials', async () => {
		const requirements = reqObj();
		const { payload } = await header(requirements);
		const out = await mppSettle(payload, requirements, { client: null });
		expect(out).toMatchObject({ ok: false, code: 'mpp_not_configured', status: 503 });
	});

	it('settles via an injected facilitator client and encodes the response header', async () => {
		const requirements = reqObj();
		const { payload } = await header(requirements);
		const client = {
			async verify() { return { isValid: true }; },
			async settle() { return { success: true, transaction: '0x' + 'f'.repeat(64), network: requirements.network, payer: account.address }; },
		};
		const out = await mppSettle(payload, requirements, { client });
		expect(out.ok).toBe(true);
		expect(typeof out.paymentResponseHeader).toBe('string');
		expect(out.paymentResponseHeader.length).toBeGreaterThan(0);
	});

	it('surfaces a facilitator transport error as 502 (unknown state)', async () => {
		const requirements = reqObj();
		const { payload } = await header(requirements);
		const client = { async settle() { throw new Error('network down'); } };
		const out = await mppSettle(payload, requirements, { client });
		expect(out).toMatchObject({ ok: false, code: 'facilitator_unreachable', status: 502 });
	});
});

describe('mppVerifyAndSettle (convenience)', () => {
	it('verify + settle happy path with an injected client', async () => {
		const requirements = reqObj();
		const { header: h } = await header(requirements);
		const client = {
			async verify() { return { isValid: true }; },
			async settle() { return { success: true, transaction: '0x' + 'a'.repeat(64) }; },
		};
		const out = await mppVerifyAndSettle({ headers: { 'x-payment': h } }, requirements, { client });
		expect(out.ok).toBe(true);
		expect(out.payer.toLowerCase()).toBe(account.address.toLowerCase());
	});
});

describe('looksLikeMppPayment / isMppPayment', () => {
	it('true for a BNB-network payment header, false otherwise', async () => {
		const { header: h } = await header(reqObj());
		expect(looksLikeMppPayment({ headers: { 'x-payment': h } })).toBe(true);
		expect(looksLikeMppPayment({ headers: {} })).toBe(false);
		expect(looksLikeMppPayment({ headers: { 'x-payment': 'junk' } })).toBe(false);
	});

	it('isMppPayment matches the two BNB networks', () => {
		expect(isMppPayment({ accepted: { network: MPP_NETWORKS.bscMainnet } })).toBe(true);
		expect(isMppPayment({ accepted: { network: MPP_NETWORKS.bscTestnet } })).toBe(true);
		expect(isMppPayment({ accepted: { network: 'eip155:8453' } })).toBe(false);
	});
});
