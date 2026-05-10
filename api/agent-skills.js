/**
 * POST /api/agents/:agentId/skills/set-price
 * Routed via vercel.json: /api/agents/([^/]+)/skills/set-price → /api/agent-skills?agentId=$1&action=set-price
 * Single-skill price upsert. For bulk replacement use PUT /api/agents/:id/skills-pricing.
 */
import { sql } from './_lib/db.js';
import { authenticateBearer, extractBearer, getSessionUser } from './_lib/auth.js';
import { cors, error, json, method, readJson, wrap } from './_lib/http.js';
import { clientIp, limits } from './_lib/rate-limit.js';
import { z } from 'zod';

const setPriceSchema = z.object({
	skill: z.string().trim().min(1, 'skill required').max(100),
	amount: z.number().int().min(0, 'amount must be non-negative'),
	currency_mint: z.string().trim().min(1, 'currency_mint required').max(100),
	chain: z.string().trim().min(1, 'chain required').max(20).default('solana'),
});

export default wrap(async (req, res) => {
	const url = new URL(req.url, 'http://x');
	const agentId = url.searchParams.get('agentId') || url.pathname.split('/').filter(Boolean)[2];
	const action  = url.searchParams.get('action')  || url.pathname.split('/').filter(Boolean)[4];

	if (action === 'set-price') return handleSetPrice(req, res, agentId);

	return error(res, 404, 'not_found', 'unknown agent skills action');
});

async function handleSetPrice(req, res, agentId) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	if (!agentId) return error(res, 400, 'validation_error', 'agentId required');

	const [agent] = await sql`
		SELECT id, user_id FROM agent_identities
		WHERE id = ${agentId} AND deleted_at IS NULL
	`;
	if (!agent) return error(res, 404, 'not_found', 'agent not found');
	if (agent.user_id !== auth.userId) return error(res, 403, 'forbidden', 'not your agent');

	const body = await readJson(req).catch(() => null);
	if (!body) return error(res, 400, 'validation_error', 'request body required');

	const parsed = setPriceSchema.safeParse(body);
	if (!parsed.success) {
		return error(res, 400, 'validation_error', parsed.error.issues[0]?.message || 'validation error');
	}

	const { skill, amount, currency_mint, chain } = parsed.data;

	if (amount === 0) {
		await sql`
			UPDATE agent_skill_prices SET is_active = false, updated_at = now()
			WHERE agent_id = ${agentId} AND skill = ${skill}
		`;
	} else {
		await sql`
			INSERT INTO agent_skill_prices (agent_id, skill, amount, currency_mint, chain, is_active)
			VALUES (${agentId}, ${skill}, ${amount}, ${currency_mint}, ${chain}, true)
			ON CONFLICT (agent_id, skill) DO UPDATE SET
				amount        = EXCLUDED.amount,
				currency_mint = EXCLUDED.currency_mint,
				chain         = EXCLUDED.chain,
				is_active     = true,
				updated_at    = now()
		`;
	}

	return json(res, 200, { data: { ok: true } });
}

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId };
	return null;
}
