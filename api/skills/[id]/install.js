import { sql } from '../../_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer } from '../../_lib/auth.js';
import { cors, json, error, method, wrap } from '../../_lib/http.js';
import { limits } from '../../_lib/rate-limit.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST', 'DELETE'])) return;

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

	if (req.method === 'POST') {
		// Atomically insert and increment only if the row is new
		await sql`
			WITH ins AS (
				INSERT INTO skill_installs (user_id, skill_id)
				VALUES (${userId}, ${id})
				ON CONFLICT (user_id, skill_id) DO NOTHING
				RETURNING id
			)
			UPDATE marketplace_skills
			SET install_count = install_count + 1
			WHERE marketplace_skills.id = ${id} AND EXISTS (SELECT 1 FROM ins)
		`;
		return json(res, 200, { installed: true });
	}

	// DELETE — uninstall
	await sql`
		WITH del AS (
			DELETE FROM skill_installs
			WHERE user_id = ${userId} AND skill_id = ${id}
			RETURNING id
		)
		UPDATE marketplace_skills
		SET install_count = GREATEST(0, install_count - 1)
		WHERE marketplace_skills.id = ${id} AND EXISTS (SELECT 1 FROM del)
	`;
	return json(res, 200, { installed: false });
});
