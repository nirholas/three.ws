// Admin auth helper. Used by all /api/admin/* endpoints.
// An admin is any user whose wallet address is in ADMIN_ADDRESSES env OR who has is_admin=true in DB.

import { getSessionUser } from './auth.js';
import { sql } from './db.js';
import { error } from './http.js';

// Mirrors BUILT_IN_ADMIN_ADDRESSES in env.js (public platform-owner addresses,
// safe to commit). env.js's ADMIN_ADDRESSES getter lower-cases every entry —
// correct for EVM hex but wrong for Solana base58, which is case-sensitive:
// lowercasing widens the match to any address that case-folds to the same
// string. env.js can't hand us the raw values without changing its surface, so
// the case-preserving list is reconstructed here from the raw env var plus the
// same built-ins env.js bakes in.
const BUILT_IN_ADMIN_ADDRESSES = ['9MjzHaTB6Jko4YKo9mDzJSaGnktzhbebgsnqPpYWnXC7'];

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function adminAddressList() {
	const raw = process.env.ADMIN_ADDRESSES || '';
	return [...BUILT_IN_ADMIN_ADDRESSES, ...raw.split(',')].map((a) => a.trim()).filter(Boolean);
}

// EVM (0x…) entries compare case-insensitively — checksum casing varies per
// wallet but identifies the same account. Everything else (Solana base58)
// compares as the literal string.
function isAdminAddress(address) {
	if (!address || typeof address !== 'string') return false;
	const candidate = address.trim();
	if (!candidate) return false;
	const candidateIsEvm = EVM_ADDRESS_RE.test(candidate);
	for (const entry of adminAddressList()) {
		if (EVM_ADDRESS_RE.test(entry)) {
			if (candidateIsEvm && entry.toLowerCase() === candidate.toLowerCase()) return true;
		} else if (entry === candidate) {
			return true;
		}
	}
	return false;
}

/**
 * Silent admin predicate — resolves the admin decision for an already-loaded
 * session user WITHOUT writing any response. Shared by requireAdmin (which adds
 * the 401/403) and read-only probes (e.g. GET /api/labor/release) that only need
 * to know whether to reveal moderator controls.
 */
export async function isAdminUser(user) {
	if (!user) return false;
	if (isAdminAddress(user.wallet_address)) return true;
	if (user.is_admin) return true;
	if (adminAddressList().length > 0) {
		const wallets = await sql`select address from user_wallets where user_id = ${user.id}`;
		for (const w of wallets) {
			if (isAdminAddress(w.address)) return true;
		}
	}
	return false;
}

/**
 * Every live platform admin account: is_admin users plus accounts whose
 * primary or linked wallet is an admin address (EVM compared without case,
 * Solana exactly). Used to reach the platform owner with operator events such
 * as Microsoft Marketplace leads.
 * @returns {Promise<string[]>}
 */
export async function listAdminUserIds() {
	const list = adminAddressList();
	const exact = list.filter((a) => !EVM_ADDRESS_RE.test(a));
	const evm = list.filter((a) => EVM_ADDRESS_RE.test(a)).map((a) => a.toLowerCase());
	const rows = await sql`
		select u.id from users u
		where u.deleted_at is null and (
			u.is_admin = true
			or u.wallet_address = any(${exact})
			or lower(u.wallet_address) = any(${evm})
			or exists (
				select 1 from user_wallets w
				where w.user_id = u.id and (w.address = any(${exact}) or lower(w.address) = any(${evm}))
			)
		)
	`;
	return rows.map((r) => r.id);
}

/** True when the request is from a signed-in admin. Never writes a response. */
export async function isAdminRequest(req) {
	return isAdminUser(await getSessionUser(req));
}

export async function requireAdmin(req, res) {
	const user = await getSessionUser(req);
	if (!user) {
		error(res, 401, 'unauthorized', 'sign in required');
		return null;
	}
	if (await isAdminUser(user)) return user;
	error(res, 403, 'forbidden', 'admin access required');
	return null;
}
