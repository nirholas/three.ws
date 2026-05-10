/**
 * GET /api/marketplace/check-skill-access?agent_id=…&skill=…
 * Returns { has_access: boolean } for the authenticated caller.
 */

import { sql } from '../_lib/db.js';
import { authenticateBearer, extractBearer, getSessionUser } from '../_lib/auth.js';
import { cors, error, json, method, wrap } from '../_lib/http.js';
import { clientIp, limits } from '../_lib/rate-limit.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	const userId = session?.id || bearer?.userId;
	if (!userId) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.widgetRead(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url = new URL(req.url, 'http://x');
	const agentId = url.searchParams.get('agent_id');
	const skill = url.searchParams.get('skill');
	if (!agentId || !skill) {
		return error(res, 400, 'validation_error', 'agent_id and skill required');
	}

	const [row] = await sql`
		SELECT 1 AS x FROM skill_purchases
		WHERE user_id = ${userId} AND agent_id = ${agentId}
		  AND skill = ${skill} AND status = 'confirmed'
		LIMIT 1
	`;
	return json(res, 200, { data: { has_access: !!row } });
});
