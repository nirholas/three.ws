/**
 * GET /api/users/me/purchased-skills
 * Returns the authenticated caller's confirmed skill purchases.
 */

import { sql } from '../../_lib/db.js';
import { authenticateBearer, extractBearer, getSessionUser } from '../../_lib/auth.js';
import { cors, error, json, method, wrap } from '../../_lib/http.js';
import { clientIp, limits } from '../../_lib/rate-limit.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	const userId = session?.id || bearer?.userId;
	if (!userId) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.widgetRead(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const purchases = await sql`
		SELECT agent_id, skill, amount, currency_mint, chain, tx_signature, confirmed_at
		FROM skill_purchases
		WHERE user_id = ${userId} AND status = 'confirmed'
		ORDER BY confirmed_at DESC
	`;

	return json(res, 200, { data: { purchases } });
});
