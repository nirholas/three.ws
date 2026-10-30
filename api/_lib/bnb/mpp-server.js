/**
 * MPP (BNB Machine Payments Protocol) server adapter — accept BNB-ecosystem
 * payments on a paid endpoint, ADDITIVELY alongside our existing x402 stack.
 *
 * The b402 layer (`@bnb-chain/b402`) IS x402 v2 (CDP wire-shape compatible): the same
 * `X-PAYMENT` / `X-PAYMENT-RESPONSE` headers and EIP-3009 credential our Base
 * x402 path already uses. So "speaking MPP" here means advertising an extra
 * `accepts[]` entry for BNB Chain (`eip155:56`/`97`) and, when a buyer pays on a
 * BNB network, settling through the Binance OnchainPay (b402) facilitator
 * instead of our Solana/Base facilitator. The Solana/Base x402 path is untouched.
 *
 * Settlement uses the real b402 facilitator via `B402Client` (RSA "Tesla"
 * signed, `B402_*` env). WITHOUT those merchant credentials the adapter still
 * verifies credentials off-chain (recover payer, shape-gate, pin requirements,
 * replay-guard) and reports `mpp_not_configured` for the on-chain settle — it
 * never fabricates a receipt. See docs/bnb-payments.md + specs/x402-mpp-bridge.md.
 */

import {
	B402Client,
	decodeXPayment,
	isEip3009PaymentPayload,
	recoverEip3009Payer,
	encodeXPaymentResponse,
	chainIdFromNetwork,
} from '@bnb-chain/b402/server';
import { getRedis } from '../redis.js';

/** CAIP-2 networks this adapter accepts (BNB Chain only; Solana/Base stay on x402). */
export const MPP_NETWORKS = { bscMainnet: 'eip155:56', bscTestnet: 'eip155:97' };

/** Typed error for MPP verify/settle failures with a machine-readable `code`. */
export class MppError extends Error {
	constructor(message, code = 'mpp_error', status = 400) {
		super(message);
		this.name = 'MppError';
		this.code = code;
		this.status = status;
	}
}

/** Read-through env helper (kept local so this module has no env.js coupling). */
function cfg(name, fallback) {
	const v = process.env[name];
	return v == null || v === '' ? fallback : v;
}

/**
 * Whether the MPP path is enabled for outgoing challenges. It is advertised
 * whenever a BSC payout address is configured; on-chain settlement additionally
 * needs `B402_*` merchant credentials (checked at settle time).
 */
export function mppEnabled() {
	return !!cfg('X402_PAY_TO_BSC', cfg('MPP_PAY_TO_BSC'));
}

/**
 * Build the MPP `accepts[]` entry (an x402-v2 `PaymentRequirements`) advertising
 * that this route is payable on BNB Chain. Defaults to BSC testnet (00-CONTEXT:
 * writes default to testnet). The `extra` fields (token EIP-712 `name`,
 * facilitator `signerAddress`) come from the b402 `/supported` menu when a
 * client is provided; otherwise from env, so the challenge is honest about what
 * it can accept.
 *
 * @param {{ route:string, priceAtomics:string|number, network?:string, description?:string, supported?:object }} routeMeta
 * @returns {Promise<import('@bnb-chain/b402').PaymentRequirements>}
 */
export async function mppRequirements(routeMeta) {
	const network = routeMeta.network || cfg('MPP_NETWORK', MPP_NETWORKS.bscTestnet);
	const payTo = cfg('X402_PAY_TO_BSC', cfg('MPP_PAY_TO_BSC'));
	if (!payTo) throw new MppError('X402_PAY_TO_BSC is not configured', 'mpp_no_payto', 500);

	// Prefer the live /supported kind (correct token domain name + signer).
	let asset = cfg('MPP_ASSET_ADDRESS_BSC');
	let name = cfg('MPP_ASSET_NAME');
	let signerAddress = cfg('MPP_FACILITATOR_SIGNER', '0x0000000000000000000000000000000000000000');
	const kinds = routeMeta.supported?.kinds;
	if (Array.isArray(kinds)) {
		const kind = kinds.find(
			(k) => k.network === network && k?.extra?.assetTransferMethod === 'eip3009',
		);
		if (kind) {
			asset = kind.asset || asset;
			name = kind.extra?.name || name;
			signerAddress = kind.extra?.signerAddress || signerAddress;
		}
	}
	if (!asset) throw new MppError('no eip3009 asset configured for MPP (set MPP_ASSET_ADDRESS_BSC or pass /supported)', 'mpp_no_asset', 500);

	return {
		scheme: 'exact',
		network,
		amount: String(routeMeta.priceAtomics),
		asset,
		payTo,
		maxTimeoutSeconds: Number(cfg('MPP_MAX_TIMEOUT_SECONDS', '300')),
		extra: { name: name || 'USD', version: cfg('MPP_ASSET_VERSION', '1'), assetTransferMethod: 'eip3009', signerAddress },
	};
}

/**
 * Full 402 challenge body advertising MPP payability for a route. Shaped like an
 * x402-v2 `PaymentRequiredBody` so any x402/b402 client understands it.
 */
export async function mppChallenge(routeMeta) {
	const requirements = await mppRequirements(routeMeta);
	return {
		x402Version: 2,
		error: 'payment required',
		accepts: [requirements],
		resource: { url: routeMeta.route, description: routeMeta.description },
	};
}

/** True when the decoded X-PAYMENT targets a BNB network this adapter owns. */
export function isMppPayment(paymentPayload) {
	const net = paymentPayload?.accepted?.network;
	return net === MPP_NETWORKS.bscMainnet || net === MPP_NETWORKS.bscTestnet;
}

/**
 * Cheap, non-throwing check: does this request carry an X-PAYMENT that decodes
 * to a BNB-network payment? Lets a dual-protocol endpoint route BNB payments to
 * the MPP path and leave every Solana/Base x402 payment to the existing stack.
 * Returns false for a missing/undecodable/non-BNB header — never throws.
 */
export function looksLikeMppPayment(req) {
	const header = getHeader(req, 'x-payment');
	if (!header) return false;
	try {
		return isMppPayment(decodeXPayment(header));
	} catch {
		return false;
	}
}

// ── replay guard ───────────────────────────────────────────────────────────
// A single-use lock on the EIP-3009 nonce (per network+asset), so a captured
// credential can't be settled twice. Backed by Redis (SET NX PX); falls back to
// a process-local map when Redis is unavailable (dev/tests) — the on-chain
// nonce is itself single-use, so this is defence-in-depth, not the sole guard.
const localReplay = new Map();
const REPLAY_TTL_MS = 15 * 60 * 1000;

async function reserveNonce(key) {
	const redis = getRedis();
	if (redis) {
		try {
			const ok = await redis.set(key, '1', { nx: true, px: REPLAY_TTL_MS });
			return ok === 'OK' || ok === true;
		} catch {
			/* fall through to local */
		}
	}
	const now = Date.now();
	const prev = localReplay.get(key);
	if (prev && prev > now) return false;
	localReplay.set(key, now + REPLAY_TTL_MS);
	return true;
}

/**
 * Verify an incoming MPP (b402) payment OFF-CHAIN (free, no gas): decode,
 * shape-gate, pin to our requirements, recover the payer, replay-guard the
 * nonce, and — when a facilitator client is configured — run the b402 `/verify`
 * signature check. Does NOT settle. The caller runs its business logic AFTER a
 * successful verify and BEFORE {@link mppSettle}, so a failed request never
 * moves funds (mirrors the x402 verify→work→settle order).
 *
 * Never throws for a normal "no/invalid payment" — returns a typed result.
 *
 * @param {{ headers: Record<string,string|undefined> | Headers }} req
 * @param {import('@bnb-chain/b402').PaymentRequirements} requirements OUR pinned requirements
 * @param {{ client?: import('@bnb-chain/b402/server').B402Client, skipReplay?: boolean }} [opts]
 * @returns {Promise<
 *   { ok:true, payload:object, payer:string, client:object|null, settleable:boolean } |
 *   { ok:false, code:string, status:number, reason:string }
 * >}
 */
export async function mppVerify(req, requirements, opts = {}) {
	const header = getHeader(req, 'x-payment');
	if (!header) return fail('no_payment', 402, 'missing X-PAYMENT header');

	let payload;
	try {
		payload = decodeXPayment(header);
	} catch (e) {
		return fail('bad_payment', 400, `undecodable X-PAYMENT: ${e.message}`);
	}

	// Shape-gate attacker-controlled input BEFORE reading nested fields.
	if (!isEip3009PaymentPayload(payload)) {
		return fail('unsupported_credential', 400, 'only exact/eip3009 payloads are accepted on the MPP path');
	}
	if (!isMppPayment(payload)) {
		return fail('wrong_network', 400, `payment network ${payload?.accepted?.network} is not a BNB network`);
	}

	// Pin every buyer-echoed field to OUR requirements — reject a self-consistent
	// payload that names a different recipient/asset/amount/network locally.
	const a = payload.accepted;
	const mismatch = pin(a, requirements);
	if (mismatch) return fail('offer_mismatch', 400, `payment ${mismatch} does not match this resource`);

	// Recover the payer from the signature and confirm it matches authorization.from.
	let payer;
	try {
		payer = await recoverEip3009Payer(payload);
	} catch (e) {
		return fail('bad_signature', 400, `signature recovery failed: ${e.message}`);
	}
	const from = payload.payload?.authorization?.from;
	if (!from || payer.toLowerCase() !== from.toLowerCase()) {
		return fail('bad_signature', 400, 'recovered signer does not match authorization.from');
	}

	// Replay guard on the nonce.
	if (!opts.skipReplay) {
		const nonce = payload.payload.authorization.nonce;
		const key = `mpp:nonce:${a.network}:${a.asset}:${nonce}`.toLowerCase();
		const fresh = await reserveNonce(key);
		if (!fresh) return fail('replay', 409, 'this payment credential was already used');
	}

	const client = opts.client || B402Client.fromEnv();
	if (client) {
		try {
			const verify = await client.verify({ x402Version: 2, paymentPayload: payload, paymentRequirements: requirements });
			if (verify && verify.isValid === false) {
				return fail('verify_failed', 402, verify.invalidReason || 'facilitator rejected the credential');
			}
		} catch (e) {
			return fail('facilitator_unreachable', 502, `b402 /verify error: ${e.message}`);
		}
	}

	return { ok: true, payload, payer, client: client || null, settleable: !!client };
}

/**
 * Settle a verified MPP payment ON-CHAIN via the b402 facilitator. Call ONLY
 * after {@link mppVerify} succeeded and the resource's work is done. Without
 * merchant credentials this returns `mpp_not_configured` (503) — it never
 * fabricates a receipt.
 *
 * @param {object} payload the verified PaymentPayload from mppVerify
 * @param {import('@bnb-chain/b402').PaymentRequirements} requirements
 * @param {{ client?: object|null }} [opts]
 * @returns {Promise<{ ok:true, settlement:object, paymentResponseHeader:string } | { ok:false, code:string, status:number, reason:string }>}
 */
export async function mppSettle(payload, requirements, opts = {}) {
	const client = opts.client || B402Client.fromEnv();
	if (!client) {
		return fail(
			'mpp_not_configured',
			503,
			'MPP credential verified but on-chain settlement is unconfigured — set B402_BASE_URL / B402_CLIENT_ID / B402_ACCESS_TOKEN / B402_PRIVATE_KEY',
		);
	}
	try {
		const settlement = await client.settle({ x402Version: 2, paymentPayload: payload, paymentRequirements: requirements });
		if (settlement && settlement.success === false) {
			return fail('settle_failed', 402, settlement.errorReason || 'facilitator settlement failed');
		}
		return { ok: true, settlement, paymentResponseHeader: encodeXPaymentResponse(settlement) };
	} catch (e) {
		// A settle-phase transport error means UNKNOWN state — surface 502 so the
		// caller reconciles on-chain rather than assuming unpaid.
		return fail('facilitator_unreachable', 502, `b402 /settle error: ${e.message}`);
	}
}

/**
 * Convenience: verify + settle in one call (no business logic between). Handy
 * for tests and fire-and-forget callers; HTTP endpoints should instead
 * verify → do work → settle so a failed request never charges.
 */
export async function mppVerifyAndSettle(req, requirements, opts = {}) {
	const verified = await mppVerify(req, requirements, opts);
	if (!verified.ok) return verified;
	const settled = await mppSettle(verified.payload, requirements, { client: verified.client });
	if (!settled.ok) return settled;
	return { ok: true, settlement: settled.settlement, payer: verified.payer, paymentResponseHeader: settled.paymentResponseHeader };
}

/** Compare a buyer-echoed offer against our requirements; return the first mismatched field name or null. */
function pin(offer, req) {
	if (offer.network !== req.network) return 'network';
	if (offer.asset?.toLowerCase() !== req.asset?.toLowerCase()) return 'asset';
	if (offer.payTo?.toLowerCase() !== req.payTo?.toLowerCase()) return 'payTo';
	if (String(offer.amount) !== String(req.amount)) return 'amount';
	if (offer.scheme !== req.scheme) return 'scheme';
	// chainId sanity: network must decode to a real EIP-155 id.
	try {
		chainIdFromNetwork(offer.network);
	} catch {
		return 'network';
	}
	return null;
}

function getHeader(req, name) {
	const h = req?.headers;
	if (!h) return undefined;
	if (typeof h.get === 'function') return h.get(name) || undefined;
	return h[name] ?? h[name.toLowerCase()] ?? undefined;
}

function fail(code, status, reason) {
	return { ok: false, code, status, reason };
}
