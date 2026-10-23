// MPP (Machine Payments Protocol) charge on Solana: the wire layer, both sides.
//
// MPP answers a request with `402` + `WWW-Authenticate: Payment ...`, the payer
// retries with `Authorization: Payment <credential>`, and the server confirms
// with a `Payment-Receipt` header. The Solana `charge` method (pull mode) puts a
// partially signed SPL TransferChecked transaction in the credential payload,
// which is the same transaction an x402 `exact` payment carries. So this module
// owns the framing (built on the official `mppx` core for challenge ids,
// credential and receipt encoding) and converts to and from the x402 `exact`
// requirement the platform's verify and settle path already enforces. Nothing
// here signs or settles: signing is the caller's signer, settlement is
// x402-spec.js.
//
// Server: buildSolanaChargeChallenge, parseSolanaChargeCredential,
//         solanaChargeReceiptHeader, installMppResponse.
// Buyer:  readSolanaChargeChallenges, chargeToRequirement, solanaChargeAuthorization,
//         readSolanaChargeReceipt.

import { Challenge, Credential, Receipt } from 'mppx';

import { env } from './env.js';
import { NETWORK_SOLANA_DEVNET, NETWORK_SOLANA_MAINNET, isSolanaNetwork } from './x402/solana-networks.js';

export const MPP_REALM = 'three.ws';
export const MPP_CHALLENGE_TTL_SECONDS = 300;

const NETWORK_NAMES = { [NETWORK_SOLANA_MAINNET]: 'mainnet', [NETWORK_SOLANA_DEVNET]: 'devnet' };
const NETWORK_FROM_NAME = {
	solana: NETWORK_SOLANA_MAINNET,
	mainnet: NETWORK_SOLANA_MAINNET,
	'mainnet-beta': NETWORK_SOLANA_MAINNET,
	'solana-mainnet': NETWORK_SOLANA_MAINNET,
	devnet: NETWORK_SOLANA_DEVNET,
	'solana-devnet': NETWORK_SOLANA_DEVNET,
};

function mppSecret() {
	return env.MPP_SECRET_KEY || env.A2A_MANDATE_SECRET;
}

/** CAIP-2 id for a network name carried in a challenge (`mainnet`, `devnet`, or a CAIP-2 id). */
export function networkFromName(name) {
	const v = String(name ?? 'mainnet').trim();
	return NETWORK_FROM_NAME[v] ?? v;
}

/** The first Solana `exact` requirement, the only kind a pull-mode charge can settle. */
export function pickSolanaExact(requirements, { asset } = {}) {
	return (
		(requirements || []).find(
			(r) => r.scheme === 'exact' && isSolanaNetwork(r.network) && (!asset || r.asset === asset),
		) || null
	);
}

// ── Server ───────────────────────────────────────────────────────────────────

/**
 * Build the MPP `charge` challenge for a Solana `exact` requirement. The id is an
 * HMAC over the challenge terms (mppx), so nothing is stored: a credential that
 * echoes a valid id proves we issued exactly these terms.
 * @param {{ requirement: object, description?: string, nowSec?: number, secretKey?: string }} args
 * @returns {{ id: string, expires: number, header: string, challenge: object }}
 */
export function buildSolanaChargeChallenge({
	requirement,
	description,
	nowSec = Math.floor(Date.now() / 1000),
	secretKey = mppSecret(),
}) {
	if (!requirement || !isSolanaNetwork(requirement.network)) {
		throw new Error('buildSolanaChargeChallenge: a Solana exact requirement is required');
	}
	const feePayerKey = requirement.extra?.feePayer;
	const methodDetails = {
		network: NETWORK_NAMES[requirement.network] ?? requirement.network,
		decimals: Number.isInteger(requirement.extra?.decimals) ? requirement.extra.decimals : 6,
		...(feePayerKey ? { feePayer: true, feePayerKey } : {}),
	};
	const expires = nowSec + MPP_CHALLENGE_TTL_SECONDS;
	const challenge = Challenge.from(
		{
			secretKey,
			realm: MPP_REALM,
			method: 'solana',
			intent: 'charge',
			request: {
				amount: String(requirement.amount),
				currency: requirement.asset,
				recipient: requirement.payTo,
				methodDetails,
			},
			expires: new Date(expires * 1000).toISOString(),
			...(description ? { description: String(description).slice(0, 256) } : {}),
		},
	);
	return { id: challenge.id, expires, header: Challenge.serialize(challenge), challenge };
}

/**
 * Parse and authenticate an `Authorization: Payment` credential for the Solana
 * charge method: the echoed challenge id must be the HMAC of exactly its terms and
 * still inside its lifetime, and the payload must carry a transaction.
 * @returns {{ ok: true, challenge: object, request: object, transaction: string, source?: string } | { ok: false, code: string, message: string }}
 */
export function parseSolanaChargeCredential(
	authorization,
	{ nowSec = Math.floor(Date.now() / 1000), secretKey = mppSecret() } = {},
) {
	let credential;
	try {
		credential = Credential.deserialize(String(authorization || '').trim());
	} catch {
		return { ok: false, code: 'invalid_credential', message: 'Authorization must be "Payment <base64url credential>"' };
	}
	const { challenge, payload } = credential;
	if (challenge.method !== 'solana' || challenge.intent !== 'charge') {
		return { ok: false, code: 'unsupported_method', message: 'this server accepts only the solana charge method' };
	}
	const expiresMs = challenge.expires ? Date.parse(challenge.expires) : NaN;
	if (!Number.isFinite(expiresMs) || nowSec * 1000 >= expiresMs) {
		return { ok: false, code: 'challenge_expired', message: 'the payment challenge has expired, request a new one' };
	}
	if (!Challenge.verify(challenge, { secretKey })) {
		return { ok: false, code: 'challenge_mismatch', message: 'credential does not match a challenge issued by this server' };
	}
	if (!payload || payload.type !== 'transaction' || typeof payload.transaction !== 'string' || !payload.transaction) {
		return { ok: false, code: 'invalid_credential', message: 'payload must be { type: "transaction", transaction: <base64> }' };
	}
	return {
		ok: true,
		challenge,
		request: challenge.request,
		transaction: payload.transaction,
		...(credential.source ? { source: credential.source } : {}),
	};
}

/**
 * True when a credential's terms are exactly the requirement's, so a challenge
 * issued for one price or payee cannot redeem another.
 */
export function chargeMatchesRequirement(request, requirement) {
	return (
		String(request?.amount) === String(requirement.amount) &&
		request?.recipient === requirement.payTo &&
		request?.currency === requirement.asset &&
		networkFromName(request?.methodDetails?.network) === requirement.network
	);
}

/** The x402 payment payload that settles a parsed charge credential. */
export function chargeToX402Payment({ requirement, transaction }) {
	return { x402Version: 2, accepted: requirement, payload: { transaction } };
}

/** The `Payment-Receipt` header value for a settled charge. */
export function solanaChargeReceiptHeader({ transaction, network, payer, nowSec = Math.floor(Date.now() / 1000) }) {
	return Receipt.serialize(
		Receipt.from({
			method: 'solana',
			reference: transaction,
			status: 'success',
			timestamp: new Date(nowSec * 1000).toISOString(),
			...(network ? { network } : {}),
			...(payer ? { payer } : {}),
		}),
	);
}

/**
 * Make a response speak MPP without touching the handler that produces it: a 402
 * gains the `WWW-Authenticate: Payment` challenge, and a settled 200 (which
 * already carries `x-payment-response`) gains `Payment-Receipt`. Installed once
 * per request, before anything is written.
 * @param {import('node:http').ServerResponse} res
 * @param {{ challengeHeader: string }} args
 */
export function installMppResponse(res, { challengeHeader }) {
	const end = res.end.bind(res);
	res.end = (...args) => {
		try {
			if (res.statusCode === 402) {
				res.setHeader('www-authenticate', challengeHeader);
			} else if (res.statusCode >= 200 && res.statusCode < 300) {
				const settlement = decodeSettlement(res.getHeader('x-payment-response'));
				if (settlement?.transaction) {
					res.setHeader(
						'payment-receipt',
						solanaChargeReceiptHeader({
							transaction: settlement.transaction,
							network: settlement.network,
							payer: settlement.payer,
						}),
					);
				}
			}
		} catch {
			// headers already sent: the body still ships, the receipt is advisory
		}
		return end(...args);
	};
}

function decodeSettlement(header) {
	if (!header) return null;
	try {
		return JSON.parse(Buffer.from(String(header), 'base64').toString('utf8'));
	} catch {
		return null;
	}
}

// ── Buyer ────────────────────────────────────────────────────────────────────

/**
 * Every Solana charge challenge on a 402 response, each with the x402-shaped
 * requirement the platform's guard layers already understand.
 * @param {Headers} headers
 * @param {{ nowSec?: number }} [opts]
 * @returns {{ challenge: object, requirement: object, expired: boolean }[]}
 */
export function readSolanaChargeChallenges(headers, { nowSec = Math.floor(Date.now() / 1000) } = {}) {
	const raw = headers.get('www-authenticate');
	if (!raw || !/\bpayment\b/i.test(raw)) return [];
	let challenges;
	try {
		challenges = Challenge.fromHeadersList(headers);
	} catch {
		return [];
	}
	const out = [];
	for (const challenge of challenges) {
		if (challenge.method !== 'solana' || challenge.intent !== 'charge') continue;
		const requirement = chargeToRequirement(challenge);
		if (!requirement) continue;
		const expiresMs = challenge.expires ? Date.parse(challenge.expires) : NaN;
		out.push({ challenge, requirement, expired: Number.isFinite(expiresMs) && nowSec * 1000 >= expiresMs });
	}
	return out;
}

/**
 * An MPP solana charge expressed as the x402 `exact` requirement it settles as,
 * or null when it asks for something a pull-mode SPL charge cannot do (native
 * SOL, confidential transfers, splits).
 */
export function chargeToRequirement(challenge) {
	const request = challenge.request ?? {};
	const details = request.methodDetails ?? {};
	if (!request.currency || request.currency === 'sol') return null;
	if (details.confidential || (Array.isArray(details.splits) && details.splits.length > 0)) return null;
	if (!/^\d+$/.test(String(request.amount ?? '')) || typeof request.recipient !== 'string') return null;
	if (details.feePayer && typeof details.feePayerKey !== 'string') return null;
	return {
		scheme: 'exact',
		network: networkFromName(details.network),
		asset: request.currency,
		payTo: request.recipient,
		amount: String(request.amount),
		maxTimeoutSeconds: MPP_CHALLENGE_TTL_SECONDS,
		extra: {
			...(details.feePayerKey ? { feePayer: details.feePayerKey } : {}),
			...(Number.isInteger(details.decimals) ? { decimals: details.decimals } : {}),
			...(details.tokenProgram ? { tokenProgram: details.tokenProgram } : {}),
		},
	};
}

/**
 * The `Authorization` header value that redeems a challenge with a signed
 * transaction (base64 wire format).
 */
export function solanaChargeAuthorization({ challenge, transaction, source }) {
	return Credential.serialize(
		Credential.from({
			challenge,
			payload: { type: 'transaction', transaction },
			...(source ? { source } : {}),
		}),
	);
}

/** Decoded `Payment-Receipt` from a response, or null. */
export function readSolanaChargeReceipt(response) {
	const header = response.headers.get('payment-receipt');
	if (!header) return null;
	try {
		return Receipt.deserialize(header);
	} catch {
		return null;
	}
}
