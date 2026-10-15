// Optional x402 pricing discount for agent-to-agent hires, gated per-service
// (agent_paid_services.reputation_discount_enabled, off by default) and sized
// by the HIRING agent's reputation tier.
//
// The paywall (api/x402/service.js) is public: any caller can hit it directly,
// so a discount can never be granted from a caller-supplied claim (that's a
// trivial discount-theft vector: spoof a high tier, pay less). Instead
// api/agents/a2a-hire.js, which has already authenticated the hirer and
// resolved their real reputation, mints a short-lived, slug-scoped voucher
// signed with the platform attester key; the paywall verifies the signature
// (not the claim) before discounting price_atomics.

import { createRequire } from 'node:module';
import { loadAttesterKeypair } from '../attest-event.js';
import { sortedStringify } from '../a2a-hire-phases.js';

const require = createRequire(import.meta.url);
const nacl = require('tweetnacl');

export const DISCOUNT_VOUCHER_HEADER = 'x-threews-reputation-voucher';

// A voucher is only valid for the single hire it was minted for: long enough
// for a2a-hire to use it immediately, short enough that a leaked header can't
// be replayed against an unrelated later hire.
const VOUCHER_TTL_MS = 5 * 60 * 1000;

// Tiers match TIERS in src/shared/agent-financial-reputation.js (the free,
// agent-page-visible "Financial reputation" score): new/emerging carry no
// discount since they have no proven settlement history yet.
const TIER_DISCOUNT_BPS = {
	new: 0,
	emerging: 0,
	established: 300,
	trusted: 1000,
	elite: 2000,
};

export function tierDiscountBps(tier) {
	return TIER_DISCOUNT_BPS[tier] ?? 0;
}

export function applyDiscountBps(priceAtomics, discountBps) {
	const price = BigInt(priceAtomics);
	const bps = Math.max(0, Math.min(10_000, Math.round(discountBps) || 0));
	if (bps === 0) return price.toString();
	return (price - (price * BigInt(bps)) / 10_000n).toString();
}

// Mint a voucher for the given slug + hirer, carrying the discount already
// resolved by the caller (a2a-hire). Returns the base64 header value, or null
// if discountBps resolves to zero (no point minting a no-op voucher).
export function signDiscountVoucher({ slug, hirerAgentId, discountBps, issuedAt = Date.now() }) {
	const bps = Math.max(0, Math.min(10_000, Math.round(discountBps) || 0));
	if (bps <= 0) return null;
	const keypair = loadAttesterKeypair();
	const payload = {
		slug,
		hirer_agent_id: hirerAgentId,
		discount_bps: bps,
		issued_at: issuedAt,
		expires_at: issuedAt + VOUCHER_TTL_MS,
		signed_by: keypair.publicKey.toBase58(),
	};
	const message = Buffer.from(sortedStringify(payload), 'utf8');
	const signature = Buffer.from(nacl.sign.detached(message, keypair.secretKey)).toString('base64');
	const envelope = { payload, signature };
	return Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64');
}

// Verify a voucher header against the CURRENT platform attester key, the
// requested slug, and expiry. Returns the discount_bps to apply, or 0 for
// any missing/malformed/expired/mis-scoped/forged voucher: fails closed to
// full price, never to a discount.
export function verifyDiscountVoucher(headerValue, { slug }) {
	if (!headerValue || typeof headerValue !== 'string') return 0;
	let envelope;
	try {
		envelope = JSON.parse(Buffer.from(headerValue, 'base64').toString('utf8'));
	} catch {
		return 0;
	}
	const { payload, signature } = envelope || {};
	if (!payload || !signature) return 0;
	if (payload.slug !== slug) return 0;
	if (!Number.isFinite(payload.expires_at) || payload.expires_at < Date.now()) return 0;
	if (!Number.isFinite(payload.discount_bps) || payload.discount_bps <= 0) return 0;
	let keypair;
	try {
		keypair = loadAttesterKeypair();
	} catch {
		return 0;
	}
	if (payload.signed_by !== keypair.publicKey.toBase58()) return 0;
	try {
		const message = Buffer.from(sortedStringify(payload), 'utf8');
		const ok = nacl.sign.detached.verify(message, Buffer.from(signature, 'base64'), keypair.publicKey.toBuffer());
		return ok ? payload.discount_bps : 0;
	} catch {
		return 0;
	}
}
