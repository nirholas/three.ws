// Admin auth helper. Used by all /api/admin/* endpoints.
// An admin is any user whose wallet address is in ADMIN_ADDRESSES env OR who has is_admin=true in DB.

import { getSessionUser } from './auth.js';
import { sql } from './db.js';
import { env } from './env.js';
import { error } from './http.js';

export async function requireAdmin(req, res) {
	const user = await getSessionUser(req);
	if (!user) {
		error(res, 401, 'unauthorized', 'sign in required');
		return null;
	}

	// Fast path: env-based admin list (wallet address match).
	if (user.wallet_address && env.ADMIN_ADDRESSES.has(user.wallet_address.toLowerCase())) {
		return user;
	}

	// DB flag: is_admin column.
	if (user.is_admin) return user;

	// Check wallet addresses linked to this user against env list.
	if (env.ADMIN_ADDRESSES.size > 0) {
		const wallets = await sql`
			select address from user_wallets where user_id = ${user.id}
		`;
		for (const w of wallets) {
			if (env.ADMIN_ADDRESSES.has(w.address.toLowerCase())) return user;
		}
	}

	error(res, 403, 'forbidden', 'admin access required');
	return null;
}
