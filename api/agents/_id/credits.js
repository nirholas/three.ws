// /api/agents/:id/credits: the agent-side surface of self-funded inference.
//
//   GET  /api/agents/:id/credits                 owner: credits, burn rate, days left,
//                                                this agent's inference budget and
//                                                spend, recent top-ups, auto-fund rule
//   POST /api/agents/:id/credits/topup/preview   owner: { amount_usdc } → single-use
//                                                preview (recipient, amount, token,
//                                                chain, credits). Nothing moves.
//   POST /api/agents/:id/credits/topup           owner: { preview_id, confirm_deposit: true }
//                                                → USDC agent wallet → treasury through
//                                                the self-facilitator, credits booked
//   GET  /api/agents/:id/credits/auto-fund       owner: the credits_below rule, or null
//   PUT  /api/agents/:id/credits/auto-fund       owner: { enabled, threshold_usd, amount_usdc }
//                                                → create or update that rule
//
// Bearer callers need `wallet:write` to move funds or change the rule and
// `wallet:read` (or `profile`) to read; a browser session is the owner itself.
// The move is api/_lib/inference-topup.js; the read model is
// api/_lib/inference-billing.js; the rule is api/_lib/inference-autofund.js over
// api/_lib/wallet-intents.js.

import { getSessionUser, authenticateBearer, extractBearer, hasScope } from '../../_lib/auth.js';
import { sql } from '../../_lib/db.js';
import { cors, error, json, method, readJson, wrap, rateLimited } from '../../_lib/http.js';
import { requireCsrf } from '../../_lib/csrf.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { inferenceUsage, autoFundIntent } from '../../_lib/inference-billing.js';
import { previewTopup, executeTopup, reconcilePendingTopups } from '../../_lib/inference-topup.js';
import { saveAutoFund } from '../../_lib/inference-autofund.js';

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
		SELECT id, user_id, name, meta FROM agent_identities WHERE id = ${agentId} AND deleted_at IS NULL
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

export const handleCredits = wrap(async (req, res, agentId, action, sub) => {
	if (cors(req, res, { methods: 'GET,POST,PUT,OPTIONS', credentials: true })) return;

	const caller = await resolveCaller(req);
	if (!caller) return error(res, 401, 'unauthorized', 'sign in, or send a three.ws API key as a Bearer token');

	const owned = await ownedAgent(agentId, caller.userId);
	if (owned.status) return error(res, owned.status, owned.code, owned.message);
	const agent = owned.agent;

	// GET /credits
	if (!action) {
		if (!method(req, res, ['GET'])) return;
		if (!scopeOk(caller, 'wallet:read', 'wallet:write', 'profile')) {
			return error(res, 403, 'insufficient_scope', 'reading credits needs the wallet:read scope');
		}
		const rl = await limits.authedReadIp(clientIp(req));
		if (!rl.success) return rateLimited(res, rl);
		await reconcilePendingTopups(caller.userId);
		return json(res, 200, await inferenceUsage({ userId: caller.userId, agent }));
	}

	if (action === 'auto-fund') return handleAutoFund(req, res, caller, agent);

	if (action !== 'topup') return error(res, 404, 'not_found', `unknown credits route: ${action}`);
	if (!method(req, res, ['POST'])) return;
	if (!scopeOk(caller, 'wallet:write')) {
		return error(res, 403, 'insufficient_scope', 'moving funds from an agent wallet needs the wallet:write scope');
	}
	if (!(await requireCsrf(req, res, caller.userId))) return;
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const body = (await readJson(req).catch(() => null)) || {};
	try {
		if (sub === 'preview') {
			const preview = await previewTopup({
				userId: caller.userId,
				agentId: agent.id,
				amountUsdc: body.amount_usdc ?? body.amount,
			});
			return json(res, 200, preview);
		}
		if (sub) return error(res, 404, 'not_found', `unknown topup route: ${sub}`);
		const result = await executeTopup({
			userId: caller.userId,
			previewId: body.preview_id,
			confirmDeposit: body.confirm_deposit,
			sources: ['owner'],
			agentId: agent.id,
		});
		return json(res, result.status === 'pending' ? 202 : 200, result);
	} catch (err) {
		return sendTyped(res, err);
	}
});

async function handleAutoFund(req, res, caller, agent) {
	if (!method(req, res, ['GET', 'PUT'])) return;
	if (req.method === 'GET') {
		if (!scopeOk(caller, 'wallet:read', 'wallet:write', 'profile')) {
			return error(res, 403, 'insufficient_scope', 'reading the auto-fund rule needs the wallet:read scope');
		}
		return json(res, 200, { auto_fund: await autoFundIntent(agent.id) });
	}

	if (!scopeOk(caller, 'wallet:write')) {
		return error(res, 403, 'insufficient_scope', 'changing the auto-fund rule needs the wallet:write scope');
	}
	if (!(await requireCsrf(req, res, caller.userId))) return;
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const body = (await readJson(req).catch(() => null)) || {};
	try {
		return json(res, 200, await saveAutoFund({ agentId: agent.id, userId: caller.userId, input: body }));
	} catch (err) {
		return sendTyped(res, err);
	}
}
