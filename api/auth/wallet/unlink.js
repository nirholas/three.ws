// Unlink a wallet address from the current session-authenticated account.

import { z } from 'zod';
import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { parse } from '../../_lib/validate.js';

const bodySchema = z.object({
	address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many attempts');

	const body = parse(bodySchema, await readJson(req));
	const addrLower = body.address.toLowerCase();

	// 1. Confirm this wallet belongs to the current user.
	const [walletRow] = await sql`
		select address, is_primary
		from user_wallets
		where user_id = ${user.id} and address = ${addrLower}
		limit 1
	`;
	if (!walletRow) return error(res, 404, 'not_found', 'wallet not linked to your account');

	// 2. Refuse if this is the last auth method available.
	const [userRow] = await sql`
		select password_hash from users where id = ${user.id} limit 1
	`;
	const hasPassword = !!userRow?.password_hash;

	if (!hasPassword) {
		const [{ count }] = await sql`
			select count(*)::int as count from user_wallets where user_id = ${user.id}
		`;
		if (count <= 1) {
			return error(
				res,
				409,
				'last_auth_method',
				'cannot remove your only authentication method',
			);
		}
	}

	// 3. If removing the primary wallet, promote the most-recently-used remaining one.
	if (walletRow.is_primary) {
		await sql`
			update user_wallets
			set is_primary = true
			where user_id = ${user.id}
			  and address != ${addrLower}
			  and address = (
				  select address from user_wallets
				  where user_id = ${user.id} and address != ${addrLower}
				  order by last_used_at desc nulls last
				  limit 1
			  )
		`;
	}

	// 4. Delete the wallet row.
	await sql`
		delete from user_wallets where user_id = ${user.id} and address = ${addrLower}
	`;

	return json(res, 200, { ok: true });
});
