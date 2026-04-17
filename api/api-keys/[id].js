import { sql } from '../_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer, hasScope } from '../_lib/auth.js';
import { cors, json, error, wrap, method } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['DELETE'])) return;

	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	if (!session && !bearer) return error(res, 401, 'unauthorized', 'sign in required');
	if (bearer && !hasScope(bearer.scope, 'profile'))
		return error(res, 403, 'insufficient_scope', 'requires profile scope');
	const userId = session?.id ?? bearer.userId;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const { id } = req.query;

	const [row] = await sql`
		update api_keys
		set revoked_at = now()
		where id = ${id} and user_id = ${userId} and revoked_at is null
		returning id
	`;

	if (!row) return error(res, 404, 'not_found', 'API key not found or already revoked');

	return json(res, 200, { data: { id: row.id, revoked: true } });
});
