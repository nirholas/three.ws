/**
 * Owner guardrails for an agent's chat: NemoGuard jailbreak detection, content
 * safety on input and output, and topic control. All off unless the owner
 * turns them on here.
 *
 * Routes (vercel.json maps /api/agents/:id/guardrails to this file):
 *   GET  /api/agents/:id/guardrails   settings, limits, block counts (30 days)
 *   PUT  /api/agents/:id/guardrails   { jailbreak, safety, topics: { enabled, allowed[], redirect } }
 *
 * Owner-only. Browsers use the session cookie (PUT carries CSRF); API keys and
 * OAuth tokens need agents:read / agents:write. Enforcement lives in
 * api/_lib/chat-guardrails.js; docs/agent-guardrails.md is the guide.
 */

import { getRequestUser, hasScope } from '../../_lib/auth.js';
import { cors, json, wrap, error, readJson, rateLimited } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { requireCsrf } from '../../_lib/csrf.js';
import { isUuid } from '../../_lib/validate.js';
import { sql } from '../../_lib/db.js';
import { CustomSkillError, requireOwnedAgent } from '../../_lib/agent-custom-skills.js';
import {
	GUARD_MODELS,
	INPUT_BUDGET_MS,
	LIMITS,
	guardKey,
	guardStats,
	guardrailsSchema,
	normalizeGuardrails,
	topicRedirect,
} from '../../_lib/chat-guardrails.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,PUT,OPTIONS', credentials: true })) return;

	const url = new URL(req.url, 'http://x');
	const parts = url.pathname.split('/').filter(Boolean);
	const agentId = url.searchParams.get('id') || parts[2] || null;
	if (!agentId || !isUuid(agentId)) return error(res, 400, 'validation_error', 'valid agent id required');
	if (req.method !== 'GET' && req.method !== 'PUT') return error(res, 405, 'method_not_allowed', 'method not allowed');

	const write = req.method === 'PUT';
	const user = await getRequestUser(req, res);
	if (!user) return error(res, 401, 'unauthorized', 'sign in or send a bearer token');
	if (user.source === 'bearer' && !hasScope(user.scope, write ? 'agents:write' : 'agents:read')) {
		return error(res, 403, 'insufficient_scope', `this token needs ${write ? 'agents:write' : 'agents:read'}`);
	}
	if (write) {
		const rl = await limits.authIp(clientIp(req));
		if (!rl.success) return rateLimited(res, rl);
		if (!(await requireCsrf(req, res, user.id))) return;
	}

	try {
		await requireOwnedAgent(agentId, user.id);
	} catch (err) {
		if (err instanceof CustomSkillError) return error(res, err.status, err.code, err.message);
		throw err;
	}

	if (write) {
		const body = await readJson(req);
		const parsed = guardrailsSchema.safeParse(body && typeof body === 'object' ? body : {});
		if (!parsed.success) {
			const issue = parsed.error.issues[0];
			return error(res, 400, 'validation_error', `${issue.path.join('.') || 'body'}: ${issue.message}`);
		}
		const settings = normalizeGuardrails(parsed.data);
		if (parsed.data.topics.enabled && !settings.topics.enabled) {
			return error(res, 400, 'validation_error', 'topics.allowed: add at least one topic before turning topic control on');
		}
		await sql`
			UPDATE agent_identities
			SET meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{guardrails}', ${JSON.stringify(settings)}::jsonb, true),
			    updated_at = now()
			WHERE id = ${agentId} AND user_id = ${user.id} AND deleted_at IS NULL
		`;
	}

	const [row] = await sql`
		SELECT avatar_id, meta->'guardrails' AS guardrails FROM agent_identities WHERE id = ${agentId}
	`;
	const settings = normalizeGuardrails(row?.guardrails);
	const stats = await guardStats(sql, [agentId, row?.avatar_id]);
	return json(res, 200, {
		data: {
			settings,
			redirect_preview: topicRedirect(settings),
			stats,
			limits: LIMITS,
			budget_ms: INPUT_BUDGET_MS,
			models: GUARD_MODELS,
			available: Boolean(guardKey()),
		},
	});
});
