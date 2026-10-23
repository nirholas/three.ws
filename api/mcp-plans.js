/**
 * GET  /api/mcp-plans : the plan catalog, per-tool credit costs, and (signed in)
 *                       the caller's balances, trials and call history.
 * POST /api/mcp-plans { plan, idempotency_key } : buy a plan with prepaid USD
 *                       credits (top up at /credits). Idempotent on the key.
 *
 * The meter that spends these balances is api/_lib/mcp-credits.js, wired into
 * the /api/mcp dispatcher.
 */

import { getRequestUser, hasScope } from './_lib/auth.js';
import { cors, json, wrap, error, readJson } from './_lib/http.js';
import { requireCsrf } from './_lib/csrf.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { listPlans, purchasePlan, accountSummary, toolCreditTable } from './_lib/mcp-plans.js';
import { trialCallsPerTool, CREDIT_USD } from './_lib/mcp-credits.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (req.method !== 'GET' && req.method !== 'POST') {
		return error(res, 405, 'method_not_allowed', 'method not allowed');
	}

	const user = await getRequestUser(req, res);

	if (req.method === 'GET') {
		const catalog = {
			creditUsd: CREDIT_USD,
			trialCallsPerTool: trialCallsPerTool(),
			plans: await listPlans(),
			tools: toolCreditTable(),
		};
		if (!user) return json(res, 200, { data: catalog }, { 'cache-control': 'no-store' });
		const account = await accountSummary(user.id);
		return json(res, 200, { data: { ...catalog, account } }, { 'cache-control': 'no-store' });
	}

	if (!user) return error(res, 401, 'unauthorized', 'sign in to buy a plan');
	if (user.source === 'bearer' && !hasScope(user.scope, 'wallet:write')) {
		return error(res, 403, 'insufficient_scope', 'this token needs wallet:write');
	}
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests, try again shortly');
	if (!(await requireCsrf(req, res, user.id))) return;

	const body = await readJson(req);
	const slug = typeof body?.plan === 'string' ? body.plan.trim() : '';
	const key = typeof body?.idempotency_key === 'string' ? body.idempotency_key.trim() : '';
	if (!slug) return error(res, 400, 'validation_error', 'plan is required');
	if (key.length < 8 || key.length > 128) {
		return error(res, 400, 'validation_error', 'idempotency_key must be 8 to 128 characters');
	}

	try {
		const out = await purchasePlan({ userId: user.id, slug, idempotencyKey: key });
		return json(res, out.replay ? 200 : 201, { data: { ...out, account: await accountSummary(user.id) } });
	} catch (err) {
		if (err.code === 'insufficient_credits') {
			return json(res, 402, {
				error: 'insufficient_credits',
				error_description: 'not enough prepaid balance, top up at /credits',
				available_usd: err.available_usd,
				required_usd: err.required_usd,
				topup_url: '/credits',
			});
		}
		if (err.status && err.status < 500) return error(res, err.status, err.code || 'error', err.message);
		throw err;
	}
});
