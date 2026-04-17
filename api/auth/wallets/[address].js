// Unlink a wallet from authenticated user.
// Refuse if it's the only wallet AND user has no email+password.

import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, wrap, error } from '../../_lib/http.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['DELETE'])) return;

	const session = await getSessionUser(req);
	if (!session) return error(res, 401, 'unauthorized', 'sign in required');

	const { address } = req.query;
	if (!address) return error(res, 400, 'missing_address', 'address required');

	const addrLower = address.toLowerCase();

	// 1. Check that this wallet belongs to the user.
	const [wallet] = await sql`
		select id from user_wallets
		where user_id = ${session.id} and address = ${addrLower}
		limit 1
	`;
	if (!wallet) return error(res, 404, 'not_found', 'wallet not found');

	// 2. Check if this is the only wallet.
	const [count] = await sql`
		select count(*) as n from user_wallets
		where user_id = ${session.id}
	`;
	const walletCount = count.n;

	if (walletCount === 1) {
		// 3. If only wallet, check if user has password-based auth.
		const [user] = await sql`
			select password_hash from users where id = ${session.id} limit 1
		`;
		if (!user.password_hash) {
			return error(
				res,
				400,
				'cannot_remove_last_wallet',
				'cannot remove the last wallet if account has no password',
			);
		}
	}

	// 4. Delete the wallet.
	await sql`delete from user_wallets where user_id = ${session.id} and address = ${addrLower}`;

	return json(res, 200, { removed: true });
});
