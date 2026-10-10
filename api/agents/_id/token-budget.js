// /api/agents/:id/token-budget: the owner's hourly, daily and per-run token
// ceilings on one agent (api/_lib/token-budgets.js).
//
//   GET    /api/agents/:id/token-budget          owner: the caps, each window's
//                                                use, extension and alerts, and
//                                                the pause if the agent is paused
//   PUT    /api/agents/:id/token-budget          owner: { hourly, daily, per_run }
//                                                (tokens; null or omitted = no cap)
//                                                → replace the caps. A pause the
//                                                new caps clear is lifted.
//   DELETE /api/agents/:id/token-budget          owner: remove every cap
//   POST   /api/agents/:id/token-budget/resume   owner: lift a token-ceiling pause
//                                                and restart the agent; 409
//                                                still_capped when the window is
//                                                still full
//   POST   /api/agents/:id/token-budget/extend   owner: { window?, extra_tokens? }
//                                                → the "extend once" approval for
//                                                the paused window (or the named
//                                                one), approved in the same call
//                                                and applied; 409 already_extended
//                                                the second time
//
// Bearer callers need `wallet:write` to change caps, resume or extend and
// `wallet:read` (or `profile`) to read; a browser session is the owner itself.

import { getSessionUser, authenticateBearer, extractBearer, hasScope } from '../../_lib/auth.js';
import { sql } from '../../_lib/db.js';
import { cors, error, json, method, readJson, wrap, rateLimited } from '../../_lib/http.js';
import { requireCsrf } from '../../_lib/csrf.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { tokenBudgetStatus, setTokenBudget, resumeTokenBudget, extendTokenBudgetOnce } from '../../_lib/token-budgets.js';

async function resolveCaller(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id, scope: null };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId, scope: bearer.scope || '' };
	return null;
}

function scopeOk(caller, ...scopes) {
	if (caller.scope === null) return true;
	return scopes.some((s) => hasScope(caller.scope, s));
}

async function ownedAgent(agentId, userId) {
	const [row] = await sql`
		SELECT id, user_id, name, status, meta FROM agent_identities WHERE id = ${agentId} AND deleted_at IS NULL
	`;
	if (!row) return { status: 404, code: 'not_found', message: 'agent not found' };
	if (String(row.user_id) !== String(userId)) return { status: 403, code: 'forbidden', message: 'not your agent' };
	return { agent: row };
}

function sendTyped(res, err) {
	if (err?.expose && err.status) {
		return error(res, err.status, err.code, err.message, err.detail || {});
	}
	throw err;
}

async function readModel(agent) {
	const [fresh] = await sql`SELECT id, user_id, name, status, meta FROM agent_identities WHERE id = ${agent.id}`;
	return {
		agent: { id: fresh.id, name: fresh.name, status: fresh.status || null },
		token_budget: await tokenBudgetStatus({ agent: fresh }),
	};
}

export const handleTokenBudget = wrap(async (req, res, agentId, action) => {
	if (cors(req, res, { methods: 'GET,PUT,POST,DELETE,OPTIONS', credentials: true })) return;

	const caller = await resolveCaller(req);
	if (!caller) return error(res, 401, 'unauthorized', 'sign in, or send a three.ws API key as a Bearer token');

	const owned = await ownedAgent(agentId, caller.userId);
	if (owned.status) return error(res, owned.status, owned.code, owned.message);
	const agent = owned.agent;

	if (!action) {
		if (!method(req, res, ['GET', 'PUT', 'DELETE'])) return;
		if (req.method === 'GET') {
			if (!scopeOk(caller, 'wallet:read', 'wallet:write', 'profile')) {
				return error(res, 403, 'insufficient_scope', 'reading a token budget needs the wallet:read scope');
			}
			const rl = await limits.authedReadIp(clientIp(req));
			if (!rl.success) return rateLimited(res, rl);
			return json(res, 200, await readModel(agent));
		}
		if (!scopeOk(caller, 'wallet:write')) {
			return error(res, 403, 'insufficient_scope', 'changing a token budget needs the wallet:write scope');
		}
		if (!(await requireCsrf(req, res, caller.userId))) return;
		const rl = await limits.authIp(clientIp(req));
		if (!rl.success) return rateLimited(res, rl);
		const body = req.method === 'DELETE' ? null : (await readJson(req).catch(() => null)) || {};
		try {
			const out = await setTokenBudget({ userId: caller.userId, agent, budget: req.method === 'DELETE' ? null : body.tokenBudget ?? body.token_budget ?? body, req });
			return json(res, 200, { ...(await readModel(agent)), resumed: out.resumed });
		} catch (err) {
			return sendTyped(res, err);
		}
	}

	if (action !== 'resume' && action !== 'extend') return error(res, 404, 'not_found', `unknown token-budget route: ${action}`);
	if (!method(req, res, ['POST'])) return;
	if (!scopeOk(caller, 'wallet:write')) {
		return error(res, 403, 'insufficient_scope', `${action === 'resume' ? 'resuming' : 'extending'} an agent needs the wallet:write scope`);
	}
	if (!(await requireCsrf(req, res, caller.userId))) return;
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);
	const body = (await readJson(req).catch(() => null)) || {};
	try {
		if (action === 'resume') {
			const out = await resumeTokenBudget({ userId: caller.userId, agent, req });
			return json(res, 200, { ...(await readModel(agent)), resumed: out.resumed, note: out.note });
		}
		const out = await extendTokenBudgetOnce({
			userId: caller.userId,
			agent,
			window: body.window ? String(body.window) : null,
			extraTokens: body.extra_tokens ?? body.extraTokens ?? null,
			req,
		});
		return json(res, 200, { ...(await readModel(agent)), extension: out });
	} catch (err) {
		return sendTyped(res, err);
	}
});
