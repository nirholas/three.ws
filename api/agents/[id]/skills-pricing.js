import { sql } from '../../_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer } from '../../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { z } from 'zod';

const priceSchema = z.object({
	skill: z.string().trim().min(1).max(100),
	amount: z.number().int().min(1),
	currency_mint: z.string().trim().min(1).max(100),
	chain: z.string().trim().min(1).max(20),
});

const pricingUpdateSchema = z.object({
	prices: z.array(priceSchema),
});

export default wrap(async (req, res) => {
	const url = new URL(req.url, 'http://x');
	const parts = url.pathname.split('/').filter(Boolean);
	const id = parts[2];

	if (cors(req, res, { methods: 'GET,PUT,OPTIONS', credentials: true })) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');

	const [agent] = await sql`
		SELECT id, user_id FROM agent_identities WHERE id = ${id} AND deleted_at IS NULL
	`;
	if (!agent) return error(res, 404, 'not_found', 'agent not found');
	if (agent.user_id !== auth.userId) return error(res, 403, 'forbidden', 'not your agent');

	if (req.method === 'GET') return handleGet(req, res, id);
	if (req.method === 'PUT') return handlePut(req, res, id);

	return method(req, res, ['GET', 'PUT']);
});

async function handleGet(req, res, agentId) {
	const prices = await sql`
		SELECT skill, amount, currency_mint, chain
		FROM agent_skill_prices
		WHERE agent_id = ${agentId} AND is_active = true
	`;
	return json(res, 200, { prices });
}

async function handlePut(req, res, agentId) {
	const body = await readJson(req);
	const parsed = pricingUpdateSchema.safeParse(body);
	if (!parsed.success) {
		const msg = parsed.error.issues[0]?.message || 'validation error';
		return error(res, 400, 'validation_error', msg);
	}

	const { prices } = parsed.data;

	await sql.transaction(async (tx) => {
		// Deactivate all existing prices for this agent
		await tx`
			UPDATE agent_skill_prices SET is_active = false WHERE agent_id = ${agentId}
		`;
		// Insert or update new prices
		for (const p of prices) {
			await tx`
				INSERT INTO agent_skill_prices (agent_id, skill, amount, currency_mint, chain, is_active)
				VALUES (${agentId}, ${p.skill}, ${p.amount}, ${p.currency_mint}, ${p.chain}, true)
				ON CONFLICT (agent_id, skill) DO UPDATE SET
					amount = EXCLUDED.amount,
					currency_mint = EXCLUDED.currency_mint,
					chain = EXCLUDED.chain,
					is_active = true,
					updated_at = now()
			`;
		}
	});

	return json(res, 200, { ok: true });
}

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId };
	return null;
}
