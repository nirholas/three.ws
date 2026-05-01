import { sql } from '../_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { cors, json, error, method, wrap } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	if (!session && !bearer) return error(res, 401, 'unauthorized', 'sign in required');
	const userId = session?.id ?? bearer.userId;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const rows = await sql`
		SELECT
			rl.id,
			rl.price_usd,
			rl.status,
			rl.created_at,
			ms.name  AS skill_name,
			ai.name  AS agent_name
		FROM royalty_ledger rl
		JOIN marketplace_skills ms ON ms.id = rl.skill_id
		JOIN agent_identities   ai ON ai.id = rl.agent_id
		WHERE rl.author_user_id = ${userId}
		ORDER BY rl.created_at DESC
		LIMIT 100
	`;

	const pending_usd = rows
		.filter((r) => r.status === 'pending')
		.reduce((s, r) => s + Number(r.price_usd), 0);

	const settled_usd = rows
		.filter((r) => r.status === 'settled')
		.reduce((s, r) => s + Number(r.price_usd), 0);

	const entries = rows.map((r) => ({
		skill_name: r.skill_name,
		agent_name: r.agent_name,
		price_usd: Number(r.price_usd),
		status: r.status,
		created_at: r.created_at,
	}));

	return json(res, 200, { pending_usd, settled_usd, entries });
});
