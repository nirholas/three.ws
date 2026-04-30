import { sql } from '../../../_lib/db.js';
import { cors, json, method, wrap, error } from '../../../_lib/http.js';
import { limits, clientIp } from '../../../_lib/rate-limit.js';

// GET /api/agents/:id/pricing — public for all agents (x402 manifest reads this)
export default wrap(async (req, res, id) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.pricingPerIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const [agent] = await sql`
		SELECT id FROM agent_identities WHERE id = ${id} AND deleted_at IS NULL
	`;
	if (!agent) return error(res, 404, 'not_found', 'agent not found');

	const prices = await sql`
		SELECT id, skill, currency_mint, chain, amount, is_active
		FROM agent_skill_prices
		WHERE agent_id = ${id} AND is_active = true
		ORDER BY skill
	`;

	return json(res, 200, { prices });
});
