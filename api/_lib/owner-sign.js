// Owner wallet signatures for approvals the burner policy escalates: above the
// owner's confirmAboveUsd a tap is not enough, the owner signs the request text
// (api/_lib/burner-tier.js ownerSignMessage) with a Solana wallet linked to
// their account. Pure ed25519 over the raw message bytes, which is what every
// Solana wallet's signMessage produces.

import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';
import { sql } from './db.js';

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Solana addresses linked to a user: user_wallets plus the legacy wallet_address. */
export async function ownerSolanaWallets(userId) {
	const rows = await sql`
		SELECT address FROM user_wallets WHERE user_id = ${userId} AND chain_type = 'solana'
		UNION
		SELECT wallet_address AS address FROM users WHERE id = ${userId} AND wallet_address IS NOT NULL
	`;
	return new Set(rows.map((r) => r.address).filter((a) => BASE58_RE.test(String(a || ''))));
}

function decodeSignature(sig) {
	const s = String(sig || '').trim();
	if (!s) return null;
	try {
		const raw = /^[A-Za-z0-9+/_-]+=*$/.test(s) && s.length >= 86 && !BASE58_RE.test(s)
			? Buffer.from(s, 'base64')
			: Buffer.from(bs58.decode(s));
		return raw.length === 64 ? new Uint8Array(raw) : null;
	} catch {
		return null;
	}
}

/**
 * @returns {Promise<{ ok: true, address: string } | { ok: false, reason: 'no_signature'|'bad_signature'|'wallet_not_linked'|'no_linked_wallet' }>}
 */
export async function verifyOwnerSignature({ userId, message, address, signature }) {
	if (!address || !signature) return { ok: false, reason: 'no_signature' };
	const linked = await ownerSolanaWallets(userId);
	if (linked.size === 0) return { ok: false, reason: 'no_linked_wallet' };
	if (!linked.has(String(address))) return { ok: false, reason: 'wallet_not_linked' };
	const sig = decodeSignature(signature);
	if (!sig) return { ok: false, reason: 'bad_signature' };
	let valid = false;
	try {
		valid = ed25519.verify(sig, new TextEncoder().encode(message), bs58.decode(String(address)));
	} catch {
		valid = false;
	}
	return valid ? { ok: true, address: String(address) } : { ok: false, reason: 'bad_signature' };
}
