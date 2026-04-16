// GET /api/agents/check-name?name=<name>[&agent_id=<excludeId>]
// Returns { available: boolean } — scoped to the caller's user_id.

import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { sql }   from '../_lib/db.js';
import { cors, json, method, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const session = await getSessionUser(req);
	const bearer  = session ? null : await authenticateBearer(extractBearer(req));
	if (!session && !bearer) return error(res, 401, 'unauthorized', 'sign in required');
	const userId = session?.id ?? bearer.userId;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url      = new URL(req.url, 'http://x');
	const name     = (url.searchParams.get('name') || '').trim();
	const agentId  = (url.searchParams.get('agent_id') || '').trim() || null;

	if (!name)         return error(res, 400, 'validation_error', 'name is required');
	if (name.length > 120) return error(res, 400, 'validation_error', 'name too long');

	// Exclude the agent being edited so renaming to the same name is always "available".
	const [conflict] = agentId
		? await sql`
			SELECT id FROM agent_identities
			WHERE user_id = ${userId}
			  AND lower(name) = lower(${name})
			  AND id != ${agentId}
			  AND deleted_at IS NULL
		`
		: await sql`
			SELECT id FROM agent_identities
			WHERE user_id = ${userId}
			  AND lower(name) = lower(${name})
			  AND deleted_at IS NULL
		`;

	return json(res, 200, { available: !conflict });
});
