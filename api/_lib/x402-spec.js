// x402 protocol — facilitator-mediated micropayments.
// Spec: https://x402.org / https://github.com/coinbase/x402
//
// This module implements the *standard* x402 wire flow used by x402scan and
// agentcash. (api/_lib/x402.js is the unrelated Pump.fun agent-skill flow.)
//
// Server flow on a paid resource:
//   1. No X-PAYMENT header → 402 with { x402Version, accepts:[paymentRequirements] }
//   2. Client retries with X-PAYMENT (base64-encoded PaymentPayload).
//   3. Server POSTs facilitator /verify with { x402Version, paymentPayload, paymentRequirements }
//      → { isValid, invalidReason?, payer? }
//   4. If isValid, do the work.
//   5. Server POSTs facilitator /settle (same body) → { success, transaction, network, payer }
//      Server attaches a base64 settlement object as `X-PAYMENT-RESPONSE` on the success reply.

import { env } from './env.js';

export const X402_VERSION = 1;

export class X402Error extends Error {
	constructor(code, message, status = 402) {
		super(message);
		this.code = code;
		this.status = status;
	}
}

// One PaymentRequirements entry per supported network.
export function paymentRequirements({ resource, description = '' } = {}) {
	const common = {
		scheme: 'exact',
		maxAmountRequired: env.X402_MAX_AMOUNT_REQUIRED,
		resource,
		description,
		mimeType: 'application/json',
		maxTimeoutSeconds: 60,
		extra: { name: 'USDC', decimals: 6 },
	};
	const out = [];
	if (env.X402_PAY_TO_SOLANA) {
		out.push({
			...common,
			network: 'solana',
			payTo: env.X402_PAY_TO_SOLANA,
			asset: env.X402_ASSET_MINT_SOLANA,
		});
	}
	if (env.X402_PAY_TO_BASE) {
		out.push({
			...common,
			network: 'base',
			payTo: env.X402_PAY_TO_BASE,
			asset: env.X402_ASSET_ADDRESS_BASE,
			extra: { name: 'USDC', version: '2', decimals: 6 },
		});
	}
	return out;
}

function facilitatorFor(network) {
	if (network === 'solana')
		return { url: env.X402_FACILITATOR_URL_SOLANA, token: env.X402_FACILITATOR_TOKEN_SOLANA };
	if (network === 'base')
		return { url: env.X402_FACILITATOR_URL_BASE, token: env.X402_FACILITATOR_TOKEN_BASE };
	throw new X402Error('unsupported_network', `unsupported network: ${network}`, 400);
}

function decodePaymentHeader(header) {
	if (!header) throw new X402Error('payment_required', 'X-PAYMENT header required', 402);
	let json;
	try {
		json = Buffer.from(String(header), 'base64').toString('utf8');
	} catch (err) {
		throw new X402Error('invalid_payment', `X-PAYMENT base64 decode failed: ${err.message}`, 400);
	}
	let payload;
	try {
		payload = JSON.parse(json);
	} catch (err) {
		throw new X402Error('invalid_payment', `X-PAYMENT JSON parse failed: ${err.message}`, 400);
	}
	if (!payload || typeof payload !== 'object') {
		throw new X402Error('invalid_payment', 'X-PAYMENT must decode to a JSON object', 400);
	}
	return payload;
}

async function callFacilitator(network, path, body) {
	const { url: base, token } = facilitatorFor(network);
	const url = `${base}${path}`;
	const headers = { 'content-type': 'application/json', accept: 'application/json' };
	if (token) headers.authorization = `Bearer ${token}`;
	let res;
	try {
		res = await fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(15_000),
		});
	} catch (err) {
		throw new X402Error(
			'facilitator_unreachable',
			`facilitator ${path} fetch failed: ${err.message}`,
			502,
		);
	}
	const text = await res.text();
	let data = {};
	if (text) {
		try {
			data = JSON.parse(text);
		} catch {
			throw new X402Error(
				'facilitator_bad_response',
				`facilitator ${path} returned non-JSON (status ${res.status})`,
				502,
			);
		}
	}
	if (!res.ok) {
		throw new X402Error(
			'facilitator_error',
			`facilitator ${path} ${res.status}: ${data.error || data.message || text.slice(0, 200)}`,
			502,
		);
	}
	return data;
}

// Match the decoded payload to one of the offered requirements (by network).
// Falls back to the first requirement when the payload omits an explicit network field.
function selectRequirement(paymentPayload, allRequirements) {
	const network = paymentPayload?.network || paymentPayload?.paymentRequirements?.network;
	if (network) {
		const found = allRequirements.find((r) => r.network === network);
		if (!found)
			throw new X402Error(
				'unsupported_network',
				`payment network "${network}" is not offered`,
				402,
			);
		return found;
	}
	return allRequirements[0];
}

// Verify a base64 X-PAYMENT header against the offered requirements.
// Returns { paymentPayload, requirement, payer } on success.
export async function verifyPayment({ paymentHeader, requirements }) {
	const all = Array.isArray(requirements) ? requirements : [requirements];
	const paymentPayload = decodePaymentHeader(paymentHeader);
	const requirement = selectRequirement(paymentPayload, all);
	const result = await callFacilitator(requirement.network, '/verify', {
		x402Version: X402_VERSION,
		paymentPayload,
		paymentRequirements: requirement,
	});
	if (!result.isValid) {
		throw new X402Error(
			'invalid_payment',
			`payment rejected: ${result.invalidReason || 'unknown reason'}`,
			402,
		);
	}
	return { paymentPayload, requirement, payer: result.payer || null };
}

// Settle the verified payment on-chain via the matching facilitator.
export async function settlePayment({ paymentPayload, requirement }) {
	const result = await callFacilitator(requirement.network, '/settle', {
		x402Version: X402_VERSION,
		paymentPayload,
		paymentRequirements: requirement,
	});
	if (!result.success) {
		throw new X402Error(
			'settle_failed',
			`settle failed: ${result.errorReason || 'unknown reason'}`,
			502,
		);
	}
	return result;
}

export function encodePaymentResponseHeader(settleResult) {
	const body = {
		success: true,
		transaction: settleResult.transaction,
		network: settleResult.network,
		payer: settleResult.payer,
	};
	return Buffer.from(JSON.stringify(body), 'utf8').toString('base64');
}

export function send402(res, requirements, error = 'X-PAYMENT header is required') {
	const accepts = Array.isArray(requirements) ? requirements : [requirements];
	res.statusCode = 402;
	res.setHeader('content-type', 'application/json; charset=utf-8');
	res.setHeader('cache-control', 'no-store');
	res.end(
		JSON.stringify({
			x402Version: X402_VERSION,
			error,
			accepts,
		}),
	);
}

// Resolve the canonical resource URL the client hit, so the facilitator can
// match the payer's signed payload against the same string we advertise.
export function resolveResourceUrl(req, path) {
	const proto = (req.headers['x-forwarded-proto'] || 'https').toString().split(',')[0].trim();
	const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString();
	if (host) return `${proto}://${host}${path}`;
	return `${env.APP_ORIGIN}${path}`;
}
