// GET /api/x/mention-decisions?agent_id=<uuid>&limit=20
//
// The owner's view of what an agent's mention-reply policy has decided
// recently: the intent the parser gave a mention, what the bot decided, the
// reply it posted (or, in dry run, would have posted), and any attached
// media. Reads x_mention_events (api/_lib/x-mention-store.js) filtered to
// account_kind 'agent' / account_ref = this agent's id, the same rows the
// settings panel (pages/agent-edit.html, Social tab) previews and the
// mention-bot health check counts.
//
// Owner only: loadOwnedAgent throws not_found for an agent the caller does
// not own, the same guard api/x/agents.js uses for every agent-scoped route.

import { getRequestUser, hasScope } from '../_lib/auth.js';
import { cors, method, wrap, error, json, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { isUuid } from '../_lib/validate.js';
import { XPostError } from '../_lib/x-post.js';
import { loadOwnedAgent } from '../_lib/x-agent-policy.js';
import { recentDecisions } from '../_lib/x-mention-store.js';

function scopeOk(user, needed) {
	return user.source !== 'bearer' || hasScope(user.scope, needed);
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const user = await getRequestUser(req, res);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');
	if (!scopeOk(user, 'agents:read')) return error(res, 403, 'insufficient_scope', 'requires agents:read');

	const url = new URL(req.url, 'http://x');
	const agentId = url.searchParams.get('agent_id');
	if (!agentId || !isUuid(agentId)) return error(res, 400, 'validation_error', 'agent_id must be a uuid');

	const rl = await limits.authedReadIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	try {
		await loadOwnedAgent(user.id, agentId);

		const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), 20);
		const rows = await recentDecisions({ kind: 'agent', ref: agentId }, { limit });
		return json(res, 200, {
			decisions: rows.map((r) => ({
				tweet_id: r.tweet_id,
				author_username: r.author_username,
				mention_text: r.mention_text,
				intent: r.intent,
				decision: r.decision,
				reason: r.reason,
				reply_text: r.reply_text,
				reply_media_url: r.reply_media_url,
				reply_link: r.reply_link,
				dry_run: r.dry_run,
				created_at: r.created_at,
				decided_at: r.decided_at,
			})),
		});
	} catch (err) {
		if (err instanceof XPostError) return error(res, err.status, err.code, err.message, err.extra);
		throw err;
	}
});
