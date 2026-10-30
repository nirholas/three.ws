/**
 * MPP (b402) buyer client — unit tests.
 *
 * A fake fetch stands in for an MPP-protected server (402 → 200). The signing
 * account is synthetic and the credential is really signed, so the happy path
 * exercises `buildEip3009Payment` end-to-end. The load-bearing assertion is the
 * hard `maxSpend` cap: an over-quote must be refused with ZERO network payment.
 */

import { describe, it, expect } from 'vitest';
import { getAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { encodeXPaymentResponse } from '@bnb-chain/b402/server';
import { mppFetch, MppBuyerError, MPP_BUYER_NETWORKS } from '../api/_lib/bnb/mpp-buyer.js';

const account = privateKeyToAccount(generatePrivateKey());
const URL = 'https://three.ws/api/x402/three-intel';
const PAYTO = getAddress('0x000000000000000000000000000000000000beef');
const ASSET = getAddress('0x0000000000000000000000000000000000005535');

function requirement(over = {}) {
	return {
		scheme: 'exact',
		network: 'eip155:97',
		amount: '10000',
		asset: ASSET,
		payTo: PAYTO,
		maxTimeoutSeconds: 300,
		extra: { name: 'USD', version: '1', assetTransferMethod: 'eip3009', signerAddress: PAYTO },
		...over,
	};
}

function makeServer({ accepts, settle = true } = {}) {
	let calls = 0;
	const menu = accepts || [requirement()];
	const fetchImpl = async (_url, init) => {
		calls++;
		const h = init.headers || {};
		const hasPayment = h['X-PAYMENT'] || h['x-payment'];
		if (!hasPayment) {
			return new Response(JSON.stringify({ x402Version: 2, accepts: menu }), {
				status: 402,
				headers: { 'content-type': 'application/json' },
			});
		}
		const headers = { 'content-type': 'application/json' };
		if (settle) {
			headers['x-payment-response'] = encodeXPaymentResponse({
				success: true,
				transaction: '0x' + 'a'.repeat(64),
				network: 'eip155:97',
				payer: account.address,
			});
		}
		return new Response(JSON.stringify({ symbol: 'THREE', signal: 'bullish' }), { status: 200, headers });
	};
	return { fetchImpl, calls: () => calls };
}

describe('mppFetch — happy path', () => {
	it('pays the 402 and returns the 200 body + settlement', async () => {
		const srv = makeServer();
		const out = await mppFetch(URL, { method: 'GET' }, { account, maxSpend: '20000', fetchImpl: srv.fetchImpl });
		expect(out.ok).toBe(true);
		expect(out.result).toMatchObject({ symbol: 'THREE', signal: 'bullish' });
		expect(out.settlement).toBeTruthy();
		expect(srv.calls()).toBe(2); // probe + paid
	});
});

describe('mppFetch — maxSpend cap (load-bearing)', () => {
	it('refuses an over-budget quote with zero payment attempted', async () => {
		const srv = makeServer({ accepts: [requirement({ amount: '999999' })] });
		const out = await mppFetch(URL, { method: 'GET' }, { account, maxSpend: '10000', fetchImpl: srv.fetchImpl });
		expect(out).toMatchObject({ ok: false, abort: true, code: 'over_budget' });
		expect(srv.calls()).toBe(1); // only the probe — no payment sent
	});
});

describe('mppFetch — unsupported / missing requirements', () => {
	it('refuses when the only BNB option is a non-eip3009 credential', async () => {
		const srv = makeServer({ accepts: [requirement({ extra: { ...requirement().extra, assetTransferMethod: 'permit2-exact' } })] });
		const out = await mppFetch(URL, {}, { account, maxSpend: '20000', fetchImpl: srv.fetchImpl });
		expect(out).toMatchObject({ ok: false, abort: true, code: 'unsupported_credential' });
		expect(srv.calls()).toBe(1);
	});

	it('refuses when no BNB network is offered', async () => {
		const srv = makeServer({ accepts: [requirement({ network: 'eip155:8453' })] });
		const out = await mppFetch(URL, {}, { account, maxSpend: '20000', fetchImpl: srv.fetchImpl });
		expect(out).toMatchObject({ ok: false, abort: true, code: 'no_bnb_requirement' });
	});
});

describe('mppFetch — passthrough + validation', () => {
	it('returns a non-402 response as-is without paying', async () => {
		const fetchImpl = async () => new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
		const out = await mppFetch(URL, {}, { account, maxSpend: '20000', fetchImpl });
		expect(out.ok).toBe(true);
		expect(out.result).toMatchObject({ ok: 1 });
	});

	it('surfaces a still-402 after payment as payment_rejected (bounded, no infinite retry)', async () => {
		let calls = 0;
		const fetchImpl = async () => {
			calls++;
			return new Response(JSON.stringify({ x402Version: 2, accepts: [requirement()], error: 'still_unpaid' }), {
				status: 402,
				headers: { 'content-type': 'application/json' },
			});
		};
		const out = await mppFetch(URL, {}, { account, maxSpend: '20000', fetchImpl });
		expect(out.ok).toBe(false);
		expect(out.status).toBe(402);
		expect(calls).toBe(2); // probe + one paid attempt, then stop
	});

	it('throws MppBuyerError when no account is supplied', async () => {
		await expect(mppFetch(URL, {}, { maxSpend: '10000' })).rejects.toBeInstanceOf(MppBuyerError);
	});

	it('throws MppBuyerError when maxSpend is omitted', async () => {
		await expect(mppFetch(URL, {}, { account })).rejects.toMatchObject({ code: 'no_cap' });
	});

	it('exports the two BNB networks', () => {
		expect(MPP_BUYER_NETWORKS).toEqual(['eip155:56', 'eip155:97']);
	});
});
