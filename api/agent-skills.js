import { sql } from '../_lib/db.js';
import { authenticateBearer, getSessionUser } from '../_lib/auth.js';
import { cors, error, json, method, readJson, wrap } from '../_lib/http.js';
import { clientIp, limits } from '../_lib/rate-limit.js';
import { z } from 'zod';

const setPriceSchema = z.object({
	skill_name: z.string().trim().min(1, 'skill name required').max(100),
	amount: z.number().int().min(0, 'amount must be positive'),
	currency_mint: z.string().trim().min(1, 'currency mint required').max(100),
	chain: z.string().trim().min(1, 'chain required').max(100),
});

export default wrap(async (req, res) => {
	const url = new URL(req.url, 'http://x');
	const parts = url.pathname.split('/').filter(Boolean);
	const agentId = parts[2];
	const action = parts[3];

	if (action === 'set-price') {
		return handleSetPrice(req, res, agentId);
	}

	return error(res, 404, 'not_found', 'unknown agent skills action');
});

async function handleSetPrice(req, res, agentId) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

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
		const msg = parsed.error.issues[0]?.message || 'validation error';
		return error(res, 400, 'validation_error', msg);
	}

	const { skill_name, amount, currency_mint, chain } = parsed.data;

	await sql`
		INSERT INTO agent_skill_prices (agent_id, skill, amount, currency_mint, chain)
		VALUES (${agentId}, ${skill_name}, ${amount}, ${currency_mint}, ${chain})
		ON CONFLICT (agent_id, skill)
		DO UPDATE SET
			amount = ${amount},
			currency_mint = ${currency_mint},
			chain = ${chain},
			updated_at = NOW()
	`;

	return json(res, 200, { data: { success: true } });
}

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(req.headers.get('authorization'));
	if (bearer) return { userId: bearer.userId };
	return null;
}
