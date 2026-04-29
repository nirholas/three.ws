// GET /api/pump/relay-delegations
// Lists the user's active relay delegations.

import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { cors, json, method, wrap, error } from '../_lib/http.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rows = await sql`
		select id, agent_id, relayer_pubkey, user_wallet,
		       max_sol_lamports, spent_sol_lamports,
		       direction_filter, mint_filter, network,
		       expires_at, created_at
		from pump_trade_delegations
		where user_id=${user.id} and revoked_at is null and expires_at > now()
		order by created_at desc
	`;

	return json(res, 200, {
		data: rows.map((r) => ({
			...r,
			max_sol_lamports: r.max_sol_lamports.toString(),
			spent_sol_lamports: r.spent_sol_lamports.toString(),
		})),
	});
});
