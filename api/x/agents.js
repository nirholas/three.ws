// Per-agent X posting: connection, policy, compose. docs/x-posting-policy.md.
//
// GET    /api/x/agents                      every owned agent with its posting state
// GET    /api/x/agents?agent_id=<uuid>      one agent: connection, policy, cadence, queue size
// PUT    /api/x/agents?agent_id=<uuid>      update the posting policy (partial)
//                                             body: { enabled?, allowed_kinds?, review_before_post?,
//                                                     max_posts_per_day?, min_interval_min?,
//                                                     tone_guidance?, banned_terms?, max_hashtags?,
//                                                     allow_links? }
// POST   /api/x/agents?agent_id=<uuid>      ask the agent to post, through its policy
//                                             body: { kind, text? | thread_parts?, reply_to_tweet_id?,
//                                                     scheduled_at? }
// DELETE /api/x/agents?agent_id=<uuid>      disconnect the agent's own X account
//
// Cookie sessions (CSRF on writes) and bearer tokens (agents:read / agents:write)
// both work, so the settings page, the CLI and MCP clients share one surface.

import { getRequestUser, hasScope } from '../_lib/auth.js';
import { cors, method, wrap, error, readJson, json, rateLimited } from '../_lib/http.js';
import { requireCsrf } from '../_lib/csrf.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { isUuid } from '../_lib/validate.js';
import { XPostError } from '../_lib/x-post.js';
import {
	disconnectAgentX,
	getAgentXState,
	listAgentXStates,
	requestAgentPost,
	saveAgentPolicy,
} from '../_lib/x-agent-policy.js';

function scopeOk(user, needed) {
	return user.source !== 'bearer' || hasScope(user.scope, needed);
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,PUT,POST,DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'PUT', 'POST', 'DELETE'])) return;

	const user = await getRequestUser(req, res);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const agentId = new URL(req.url, 'http://x').searchParams.get('agent_id');
	if (agentId !== null && !isUuid(agentId)) return error(res, 400, 'validation_error', 'agent_id must be a uuid');

	try {
		if (req.method === 'GET') {
			if (!scopeOk(user, 'agents:read')) return error(res, 403, 'insufficient_scope', 'requires agents:read');
			const rl = await limits.authedReadIp(clientIp(req));
			if (!rl.success) return rateLimited(res, rl);
			if (!agentId) return json(res, 200, { agents: await listAgentXStates(user.id) });
			return json(res, 200, await getAgentXState({ userId: user.id, agentId }));
		}

		if (!agentId) return error(res, 400, 'validation_error', 'agent_id is required');
		if (!scopeOk(user, 'agents:write')) return error(res, 403, 'insufficient_scope', 'requires agents:write');
		if (!(await requireCsrf(req, res, user.id))) return;
		const rl = await limits.xAgentPost(user.id);
		if (!rl.success) return rateLimited(res, rl);

		if (req.method === 'DELETE') {
			return json(res, 200, await disconnectAgentX({ userId: user.id, agentId }));
		}

		const body = (await readJson(req)) || {};

		if (req.method === 'PUT') {
			const policy = await saveAgentPolicy({ userId: user.id, agentId, patch: body });
			return json(res, 200, { policy });
		}

		const result = await requestAgentPost({
			userId: user.id,
			agentId,
			kind: body.kind,
			text: typeof body.text === 'string' ? body.text : null,
			threadParts: Array.isArray(body.thread_parts) ? body.thread_parts : null,
			replyTo: typeof body.reply_to_tweet_id === 'string' ? body.reply_to_tweet_id : null,
			scheduledAt: typeof body.scheduled_at === 'string' ? body.scheduled_at : null,
			source: user.source === 'bearer' ? 'api' : 'settings',
		});
		return json(res, result.status === 'published' ? 201 : 202, result);
	} catch (err) {
		if (err instanceof XPostError) return error(res, err.status, err.code, err.message, err.extra);
		throw err;
	}
});
