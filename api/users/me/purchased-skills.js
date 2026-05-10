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
		SELECT
			sp.id,
			sp.agent_id,
			sp.skill,
			sp.status,
			sp.kind,
			sp.amount,
			sp.currency_mint,
			sp.chain,
			sp.tx_signature,
			sp.confirmed_at,
			sp.valid_until,
			sp.trial_remaining,
			sp.created_at,
			ai.name AS agent_name,
			ai.thumbnail_url AS agent_thumbnail
		FROM skill_purchases sp
		LEFT JOIN agent_identities ai ON ai.id = sp.agent_id
		WHERE sp.user_id = ${userId} AND sp.status IN ('confirmed', 'trial')
		ORDER BY sp.confirmed_at DESC NULLS LAST, sp.created_at DESC
	`;

	return json(res, 200, { data: { purchases } });
});
