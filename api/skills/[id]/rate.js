import { z } from 'zod';
import { sql } from '../../_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer } from '../../_lib/auth.js';
import { cors, json, error, method, readJson, wrap } from '../../_lib/http.js';
import { limits } from '../../_lib/rate-limit.js';
import { parse } from '../../_lib/validate.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const rateSchema = z.object({
	rating: z.number().int().min(1).max(5),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const id = req.query?.id;
	if (!id || !UUID_RE.test(id)) return error(res, 404, 'not_found', 'skill not found');

	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	if (!session && !bearer) return error(res, 401, 'unauthorized', 'sign in required');
	const userId = session?.id ?? bearer.userId;

	const rl = await limits.chatUser(userId);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const [skill] = await sql`SELECT id FROM marketplace_skills WHERE id = ${id} AND is_public = true`;
	if (!skill) return error(res, 404, 'not_found', 'skill not found');

	const { rating } = parse(rateSchema, await readJson(req));

	await sql`
		INSERT INTO skill_ratings (user_id, skill_id, rating)
		VALUES (${userId}, ${id}, ${rating})
		ON CONFLICT (user_id, skill_id) DO UPDATE SET rating = EXCLUDED.rating, created_at = now()
	`;

	const [stats] = await sql`
		SELECT
			ROUND(AVG(rating)::numeric, 1)::float AS avg_rating,
			COUNT(*)::int AS rating_count
		FROM skill_ratings
		WHERE skill_id = ${id}
	`;

	return json(res, 200, {
		avg_rating: Number(stats.avg_rating) || 0,
		rating_count: stats.rating_count || 0,
	});
});
