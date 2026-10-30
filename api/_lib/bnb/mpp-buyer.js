/**
 * MPP (BNB Machine Payments Protocol / b402) buyer client — lets our agents PAY
 * any MPP-protected endpoint in the BNB ecosystem, the mirror of `mpp-server.js`
 * and the sibling of `api/_lib/x402-buyer-fetch.js` (whose return shape it
 * matches: `{ ok, result, response, ... }`).
 *
 * b402 is x402 v2, so the 402 → sign EIP-3009 → retry-with-`X-PAYMENT` dance is
 * the same one our Base x402 buyer runs — this module just targets BNB networks
 * (`eip155:56` / `eip155:97`) and signs with `@bnb-chain/b402`'s
 * `buildEip3009Payment`. A HARD `maxSpend` cap is enforced BEFORE any signature:
 * an endpoint quoting above the cap is refused with zero payment attempted.
 *
 * The caller injects the signing account; no private key is read here.
 *
 * @example
 *   import { mppFetch } from '../_lib/bnb/mpp-buyer.js';
 *   import { privateKeyToAccount } from 'viem/accounts';
 *   const account = privateKeyToAccount(process.env.BNB_TESTNET_DEPLOYER_KEY);
 *   const res = await mppFetch('https://three.ws/api/x402/three-intel', { method: 'GET' }, {
 *     account, maxSpend: '20000', network: 'eip155:97',
 *   });
 *   if (res.ok) console.log(res.result, res.settlement);
 */

import { buildEip3009Payment, encodeXPayment, decodeXPaymentResponse } from '@bnb-chain/b402';

/** CAIP-2 networks this buyer will pay on. */
export const MPP_BUYER_NETWORKS = ['eip155:56', 'eip155:97'];

/** Thrown only for programmer errors (missing account). Payment DECISIONS return objects. */
export class MppBuyerError extends Error {
	constructor(message, code = 'mpp_buyer_error') {
		super(message);
		this.name = 'MppBuyerError';
		this.code = code;
	}
}

function b64decode(s) {
	if (!s) return null;
	try {
		return JSON.parse(Buffer.from(s, 'base64').toString('utf8'));
	} catch {
		return null;
	}
}

function safeJson(text) {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

function bodyToInit(method, body, headers = {}) {
	if (body == null) return { method, headers };
	if (typeof body === 'string' || body instanceof ArrayBuffer || body instanceof Uint8Array) {
		return { method, headers, body };
	}
	return { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) };
}

/** Pick a payable BNB eip3009 `exact` requirement from the 402 menu. */
function selectRequirement(accepts, network) {
	const payable = accepts.filter(
		(a) =>
			a &&
			a.scheme === 'exact' &&
			MPP_BUYER_NETWORKS.includes(a.network) &&
			(a.extra?.assetTransferMethod ? a.extra.assetTransferMethod === 'eip3009' : true),
	);
	if (network) return payable.find((a) => a.network === network) || null;
	return payable[0] || null;
}

/**
 * Pay an MPP-protected endpoint. Handles the 402 → pay → retry loop with a hard
 * spend cap and bounded retries.
 *
 * @param {string} url
 * @param {{ method?:string, body?:any, headers?:object, fetchImpl?:Function }} [opts]
 * @param {{ account: import('viem').LocalAccount, maxSpend: string|bigint, network?:string, fetchImpl?:Function }} pay
 * @returns {Promise<
 *   { ok:true, result:any, response:Response, requirement:object, payment:object, settlement:object|undefined } |
 *   { ok:false, abort:true, code:string, reason:string } |
 *   { ok:false, status:number, error:string }
 * >}
 */
export async function mppFetch(url, opts = {}, pay = {}) {
	const { account, maxSpend, network } = pay;
	const fetchImpl = pay.fetchImpl || opts.fetchImpl || globalThis.fetch;
	if (!account || typeof account.signTypedData !== 'function') {
		throw new MppBuyerError('mppFetch requires a viem account (LocalAccount) in the third argument', 'bad_account');
	}
	if (maxSpend == null) {
		throw new MppBuyerError('mppFetch requires a maxSpend cap (atomic units) — refusing to pay uncapped', 'no_cap');
	}
	const cap = BigInt(maxSpend);

	const init = bodyToInit(opts.method || 'GET', opts.body, opts.headers);
	const probe = await fetchImpl(url, init);
	if (probe.status !== 402) {
		const text = await probe.text();
		return { ok: probe.ok, status: probe.status, result: safeJson(text) ?? text, response: probe };
	}

	// Parse the 402 challenge (JSON body, or the PAYMENT-REQUIRED header).
	const challenge =
		safeJson(await probe.clone().text()) || b64decode(probe.headers.get('payment-required'));
	if (!challenge || !Array.isArray(challenge.accepts)) {
		return { ok: false, status: 402, error: 'invalid_402_body' };
	}

	const requirement = selectRequirement(challenge.accepts, network);
	if (!requirement) {
		// Either no BNB network offered, or only unsupported credential types.
		const hasBnb = challenge.accepts.some((a) => MPP_BUYER_NETWORKS.includes(a?.network));
		return {
			ok: false,
			abort: true,
			code: hasBnb ? 'unsupported_credential' : 'no_bnb_requirement',
			reason: hasBnb
				? 'endpoint offers a BNB network but only via an unsupported credential (this client signs eip3009 only)'
				: 'endpoint does not offer a BNB (eip155:56/97) payment option',
		};
	}

	// HARD cap — refuse before signing anything.
	const price = BigInt(requirement.amount);
	if (price > cap) {
		return {
			ok: false,
			abort: true,
			code: 'over_budget',
			reason: `quote ${price} exceeds maxSpend ${cap} (atomic units) — no payment sent`,
		};
	}

	// Sign the EIP-3009 credential and attach it.
	let payment;
	try {
		payment = await buildEip3009Payment({ account, requirements: requirement, resourceUrl: url });
	} catch (e) {
		return { ok: false, abort: true, code: 'sign_failed', reason: `could not sign credential: ${e.message}` };
	}
	const header = encodeXPayment(payment);

	const paidInit = bodyToInit(opts.method || 'GET', opts.body, { ...opts.headers, 'X-PAYMENT': header });
	const paidRes = await fetchImpl(url, paidInit);

	if (paidRes.status === 402) {
		// Server still says unpaid — do NOT retry-forever; surface it.
		const text = await paidRes.text();
		return { ok: false, status: 402, error: safeJson(text)?.error || 'payment_rejected', response: paidRes };
	}
	if (!paidRes.ok) {
		const text = await paidRes.text();
		return { ok: false, status: paidRes.status, error: safeJson(text)?.error || `http_${paidRes.status}`, response: paidRes };
	}

	const text = await paidRes.text();
	const settlement = decodeXPaymentResponse(paidRes.headers.get('x-payment-response'));
	return {
		ok: true,
		result: safeJson(text) ?? text,
		response: paidRes,
		requirement,
		payment,
		settlement,
	};
}
