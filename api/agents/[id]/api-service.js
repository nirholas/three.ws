// GET|PUT /api/agents/:id/api-service
//
// Owner switch for selling a whole agent as a paid x402 API (the Earn tab's
// "Sell this agent as an API" card). GET returns the stored config, the stable
// endpoint URL, where the money settles, whether the agent can be sold (and if
// not, why, in plain sentences), and the service's earnings from
// agent_revenue_events. PUT validates and stores { active, price_usd,
// description } on meta.api_service. Activation is refused, with the reason,
// when the agent is private, has no brain, or has no Solana payout address.

import { getSessionUser, authenticateBearer, extractBearer, hasScope } from '../../_lib/auth.js';
import { cors, error, json, readJson, respondError, wrap } from '../../_lib/http.js';
import { requireCsrf } from '../../_lib/csrf.js';
import { isUuid } from '../../_lib/validate.js';
import { getFeeBps } from '../../_lib/fee.js';
import {
	AgentServiceError,
	CALL_INPUT_SCHEMA,
	DESCRIPTION_MAX,
	MAX_PRICE_USD,
	MIN_PRICE_USD,
	agentApiEarnings,
	agentServiceUrl,
	loadServiceAgent,
	readServiceConfig,
	resolveServicePayTo,
	saveServiceConfig,
	sellability,
	validateServiceConfig,
} from '../../_lib/agent-api-service.js';

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	// Selling the agent as a paid API (and its price) is an agents:write change;
	// reading the config is agents:read. A narrower key gets neither.
	const needed = req.method === 'GET' ? 'agents:read' : 'agents:write';
	if (bearer) return hasScope(bearer.scope, needed) ? { userId: bearer.userId } : { userId: null, scopeNeeded: needed };
	return null;
}

async function snapshot(agent) {
	const [payTo, earnings] = await Promise.all([
		resolveServicePayTo(agent.id),
		agentApiEarnings(agent.id),
	]);
	return {
		service: readServiceConfig(agent),
		endpoint_url: agentServiceUrl(agent.id),
		pay_to: payTo,
		sellable: sellability(agent, { solanaPayTo: payTo.solana }),
		limits: {
			min_price_usd: MIN_PRICE_USD,
			max_price_usd: MAX_PRICE_USD,
			description_max: DESCRIPTION_MAX,
			fee_bps: getFeeBps(),
		},
		input_schema: CALL_INPUT_SCHEMA,
		earnings,
	};
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,PUT,OPTIONS', credentials: true })) return;
	if (req.method !== 'GET' && req.method !== 'PUT') {
		res.setHeader('allow', 'GET,PUT,OPTIONS');
		return error(res, 405, 'method_not_allowed', 'use GET or PUT');
	}

	const url = new URL(req.url, 'http://x');
	const id = req.query?.id || url.searchParams.get('id') || url.pathname.split('/').filter(Boolean)[2];

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');
	if (auth.scopeNeeded) return error(res, 403, 'insufficient_scope', `this token needs the ${auth.scopeNeeded} scope`);
	if (!isUuid(id)) return error(res, 404, 'not_found', 'agent not found');
	if (req.method === 'PUT' && !(await requireCsrf(req, res, auth.userId))) return;

	let agent;
	try {
		agent = await loadServiceAgent(id);
	} catch (err) {
		return respondError(res, 502, 'agent_lookup_failed', err);
	}
	// A non-owner learns nothing about whether the agent exists.
	if (!agent || String(agent.user_id) !== String(auth.userId)) {
		return error(res, 404, 'not_found', 'agent not found');
	}

	if (req.method === 'GET') {
		return json(res, 200, await snapshot(agent), { 'cache-control': 'private, no-store' });
	}

	let next;
	try {
		next = validateServiceConfig(await readJson(req, 8 * 1024));
	} catch (err) {
		if (err instanceof AgentServiceError) return error(res, err.status, err.code, err.message);
		if (err?.status) return error(res, err.status, 'invalid_body', err.message);
		throw err;
	}

	if (next.active) {
		const payTo = await resolveServicePayTo(agent.id);
		const sell = sellability(agent, { solanaPayTo: payTo.solana });
		if (!sell.ok) {
			return error(res, 409, 'not_sellable', sell.reasons[0], { reasons: sell.reasons });
		}
	}

	const saved = await saveServiceConfig(agent.id, next);
	if (!saved) return error(res, 404, 'not_found', 'agent not found');
	const fresh = await loadServiceAgent(agent.id);
	return json(res, 200, await snapshot(fresh || agent), { 'cache-control': 'private, no-store' });
});
