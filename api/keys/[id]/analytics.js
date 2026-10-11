// GET /api/keys/:id/analytics?days=7: calls by route, errors, latency
// percentiles and top callers for one of the caller's keys.

import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, wrap, error, rateLimited } from '../../_lib/http.js';
import { limits } from '../../_lib/rate-limit.js';
import { isUuid } from '../../_lib/validate.js';
import { keyAnalytics, analyticsDays } from '../../_lib/dev-plans/analytics.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in to view key analytics');
	const rl = await limits.apiKeyList(user.id);
	if (!rl.success) return rateLimited(res, rl);

	const id = req.query?.id;
	if (!isUuid(id)) return error(res, 400, 'invalid_id', 'API key id must be a UUID');
	const [key] = await sql`
		select id, name, prefix, created_at, last_used_at, revoked_at, expires_at, overlap_until, rotated_from, rotated_to, ip_allowlist
		from api_keys where id = ${id} and user_id = ${user.id} limit 1
	`;
	if (!key) return error(res, 404, 'not_found', 'key not found');

	const url = new URL(req.url, 'http://internal');
	const analytics = await keyAnalytics({ userId: user.id, apiKeyId: id, days: analyticsDays(url.searchParams.get('days')) });
	res.setHeader('cache-control', 'private, no-store');
	return json(res, 200, { key, analytics });
});
