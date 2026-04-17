// Verify a Privy identity token and issue a 3D-Agent session.
// POST /api/auth/privy/verify — accepts { idToken }, returns session cookie + user + wallet.

import { z } from 'zod';
import { sql } from '../../_lib/db.js';
import { createSession, sessionCookie, destroySession } from '../../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { parse } from '../../_lib/validate.js';
import { verifyPrivyIdToken } from '../../_lib/privy.js';

const bodySchema = z.object({
	idToken: z.string().min(10).max(5000),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const ip = clientIp(req);
	const rl = await limits.authIp(ip);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many attempts');

	const body = parse(bodySchema, await readJson(req));

	// 1. Verify the Privy identity token.
	let privyData;
	try {
		privyData = await verifyPrivyIdToken(body.idToken);
	} catch (err) {
		const msg = err.message || String(err);
		// Distinguish between bad token format, expired, and signature failures.
		if (msg.includes('expired') || msg.includes('JWT expired')) {
			return error(res, 401, 'expired_token', 'token expired');
		}
		if (msg.includes('audience')) {
			return error(res, 401, 'wrong_audience', 'token audience mismatch');
		}
		if (msg.includes('JWKS') || msg.includes('fetch')) {
			// JWKS fetch failure is a server error, not a client token error.
			throw err;
		}
		return error(res, 401, 'invalid_token', 'token verification failed');
	}

	// 2. Privy token must have a linked wallet.
	if (!privyData.walletAddress) {
		return error(res, 400, 'no_wallet_linked', 'Privy account has no linked wallet');
	}

	// 3. Check that user_wallets.privy_user_id column exists (idempotent migration check).
	let hasPrivyUserIdColumn;
	try {
		const [row] = await sql`
			select exists(
				select 1 from information_schema.columns
				where table_name = 'user_wallets' and column_name = 'privy_user_id'
			) as exists
		`;
		hasPrivyUserIdColumn = row.exists;
	} catch {
		hasPrivyUserIdColumn = false;
	}

	if (!hasPrivyUserIdColumn) {
		return error(
			res,
			501,
			'schema_migration_required',
			'user_wallets.privy_user_id column missing',
		);
	}

	// 4. Find or create the user and wallet.
	const addrLower = privyData.walletAddress.toLowerCase();
	const privyUserId = privyData.userId;

	let [wallet] = await sql`
		select user_id from user_wallets where address = ${addrLower} limit 1
	`;
	let userId;

	if (wallet) {
		userId = wallet.user_id;
		// Update last_used_at and privy_user_id if changed.
		await sql`
			update user_wallets
			set last_used_at = now(), privy_user_id = ${privyUserId}
			where address = ${addrLower}
		`;
	} else {
		// Create a new user. Use Privy email if available; otherwise synthesize one.
		const userEmail = privyData.email || `wallet-${addrLower}@privy.local`;
		const [user] = await sql`
			insert into users (email, display_name, wallet_address)
			values (${userEmail}, ${shortAddr(privyData.walletAddress)}, ${addrLower})
			returning id
		`;
		userId = user.id;

		// Link the wallet with privy_user_id.
		await sql`
			insert into user_wallets (user_id, address, chain_id, is_primary, privy_user_id)
			values (${userId}, ${addrLower}, null, true, ${privyUserId})
		`;
	}

	// 5. Issue a session.
	await destroySession(req);
	const token = await createSession({
		userId,
		userAgent: req.headers['user-agent'],
		ip,
	});
	res.setHeader('set-cookie', sessionCookie(token));

	// 6. Return user + wallet info.
	const [userRow] = await sql`
		select id, email, display_name, plan, avatar_url, created_at
		from users where id = ${userId} limit 1
	`;

	return json(res, 200, {
		user: userRow,
		wallet: { address: privyData.walletAddress, chain_id: null },
	});
});

function shortAddr(addr) {
	return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
