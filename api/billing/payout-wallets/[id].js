import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, wrap, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['DELETE'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const { id } = req.query;
	const [deleted] = await sql`
		delete from agent_payout_wallets
		where id = ${id} and user_id = ${user.id}
		returning id
	`;

	if (!deleted) return error(res, 404, 'not_found', 'wallet not found');

	return json(res, 200, { id: deleted.id });
});
