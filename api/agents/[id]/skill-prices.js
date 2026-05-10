/**
 * /api/agents/:id/skill-prices
 * Per-skill price CRUD on the agent's skill catalog.
 *   POST   { skill, amount, currency_mint, chain? }  — set/update one price
 *   PUT    { skill, amount }                          — update amount only
 *   DELETE { skill }                                  — deactivate the price
 *
 * Bulk equivalent (replace-all): PUT /api/agents/:id/skills-pricing
 */

import { sql } from '../../_lib/db.js';
import { authenticateBearer, extractBearer, getSessionUser } from '../../_lib/auth.js';
import { cors, error, json, method, readJson, wrap } from '../../_lib/http.js';
import { clientIp, limits } from '../../_lib/rate-limit.js';
import { z } from 'zod';

const upsertSchema = z.object({
	skill: z.string().trim().min(1).max(100),
	amount: z.number().int().min(1),
	currency_mint: z.string().trim().min(1).max(100),
	chain: z.string().trim().min(1).max(20).default('solana'),
});

const updateSchema = z.object({
	skill: z.string().trim().min(1).max(100),
	amount: z.number().int().min(1),
});

const deleteSchema = z.object({
	skill: z.string().trim().min(1).max(100),
});

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId };
	return null;
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,PUT,DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST', 'PUT', 'DELETE'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url = new URL(req.url, 'http://x');
	const parts = url.pathname.split('/').filter(Boolean);
	const agentId = url.searchParams.get('id') || parts[2];
	if (!agentId) return error(res, 400, 'validation_error', 'agent id required');

	const [agent] = await sql`
		SELECT id, user_id FROM agent_identities
		WHERE id = ${agentId} AND deleted_at IS NULL
	`;
	if (!agent) return error(res, 404, 'not_found', 'agent not found');
	if (agent.user_id !== auth.userId) return error(res, 403, 'forbidden', 'not your agent');

	const body = await readJson(req).catch(() => null);
	if (!body) return error(res, 400, 'validation_error', 'request body required');

	if (req.method === 'POST') {
		const parsed = upsertSchema.safeParse(body);
		if (!parsed.success) {
			return error(res, 400, 'validation_error', parsed.error.issues[0]?.message || 'invalid');
		}
		const { skill, amount, currency_mint, chain } = parsed.data;
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
		return json(res, 200, { data: { ok: true } });
	}

	if (req.method === 'PUT') {
		const parsed = updateSchema.safeParse(body);
		if (!parsed.success) {
			return error(res, 400, 'validation_error', parsed.error.issues[0]?.message || 'invalid');
		}
		const { skill, amount } = parsed.data;
		const r = await sql`
			UPDATE agent_skill_prices
			SET amount = ${amount}, updated_at = now()
			WHERE agent_id = ${agentId} AND skill = ${skill}
			RETURNING agent_id
		`;
		if (r.length === 0) return error(res, 404, 'not_found', 'no existing price for this skill');
		return json(res, 200, { data: { ok: true } });
	}

	// DELETE — soft-deactivate
	const parsed = deleteSchema.safeParse(body);
	if (!parsed.success) {
		return error(res, 400, 'validation_error', parsed.error.issues[0]?.message || 'invalid');
	}
	await sql`
		UPDATE agent_skill_prices
		SET is_active = false, updated_at = now()
		WHERE agent_id = ${agentId} AND skill = ${parsed.data.skill}
	`;
	return json(res, 200, { data: { ok: true } });
});
