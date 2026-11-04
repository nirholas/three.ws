// GET /api/usage/summary: per-user usage numbers for the dashboard.
//
// Returns three blocks:
//   plan   the caller's plan quota row (limits, not consumption)
//   counts avatar count / stored bytes / MCP tool calls in 24h / events in 30d
//   llm    LLM calls, tokens, and a per-model breakdown for the current month
//
// The `llm` block powers the "LLM usage" panel in /dashboard/settings; the
// counts block powers the avatar-quota gate on /create.

import { usageSummary } from '../_lib/usage-summary.js';
import { getSessionUser, authenticateBearer, extractBearer, hasScope } from '../_lib/auth.js';
import { cors, json, method, wrap, error } from '../_lib/http.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	let userId = null;
	const session = await getSessionUser(req);
	if (session) userId = session.id;
	else {
		const bearer = await authenticateBearer(extractBearer(req));
		if (bearer && hasScope(bearer.scope, 'profile')) userId = bearer.userId;
	}
	if (!userId) return error(res, 401, 'unauthorized', 'authentication required');

	const summary = await usageSummary(userId);
	if (!summary) return error(res, 500, 'internal', 'plan quota record missing for user');
	return json(res, 200, summary);
});
