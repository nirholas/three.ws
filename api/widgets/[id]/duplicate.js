import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, error, json, method, wrap } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.widgetWrite(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url = new URL(req.url, 'http://x');
	const parts = url.pathname.split('/').filter(Boolean);
	const id = url.searchParams.get('id') || parts[2];

	const [src] = await sql`
		SELECT id, user_id, avatar_id, type, name, config, is_public
		FROM widgets WHERE id = ${id} AND user_id = ${user.id} AND deleted_at IS NULL
	`;
	if (!src) return error(res, 404, 'not_found', 'widget not found');

	const [widget] = await sql`
		INSERT INTO widgets (user_id, avatar_id, type, name, config, is_public)
		VALUES (
			${user.id}, ${src.avatar_id}, ${src.type},
			${src.name + ' (copy)'}, ${JSON.stringify(src.config)}::jsonb, ${src.is_public}
		)
		RETURNING id, user_id, avatar_id, type, name, config, is_public,
		          view_count, created_at, updated_at
	`;

	return json(res, 201, { widget });
});
