// PUT /api/keys/:id/allowlist: restrict a key to a set of caller addresses.
// Body: { ip_allowlist: ['203.0.113.7', '2001:db8::/32', ...] }; an empty
// list removes the restriction. Takes effect on the next call.

import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { logAudit } from '../../_lib/audit.js';
import { invalidateApiKey } from '../../_lib/api-key-cache.js';
import { normalizeIpAllowlist, IP_ALLOWLIST_MAX_RULES } from '../../_lib/ip-allowlist.js';
import { cors, json, method, wrap, error, rateLimited, readJson } from '../../_lib/http.js';
import { requireCsrf } from '../../_lib/csrf.js';
import { limits } from '../../_lib/rate-limit.js';
import { isUuid } from '../../_lib/validate.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'PUT,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['PUT'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in to manage API keys');
	if (!(await requireCsrf(req, res, user.id))) return;
	const rl = await limits.apiKeyManage(user.id);
	if (!rl.success) return rateLimited(res, rl);

	const id = req.query?.id;
	if (!isUuid(id)) return error(res, 400, 'invalid_id', 'API key id must be a UUID');
	const body = (await readJson(req)) || {};
	const list = body.ip_allowlist;
	if (!Array.isArray(list)) return error(res, 400, 'validation_error', 'ip_allowlist must be an array of IPs or CIDR ranges');
	if (list.length > IP_ALLOWLIST_MAX_RULES) return error(res, 400, 'validation_error', `at most ${IP_ALLOWLIST_MAX_RULES} rules`);
	const { rules, invalid } = normalizeIpAllowlist(list);
	if (invalid.length) return error(res, 400, 'validation_error', `not an IP or CIDR range: ${invalid.join(', ')}`);

	const rows = await sql`
		update api_keys set ip_allowlist = ${rules.length ? rules : null}
		where id = ${id} and user_id = ${user.id} and revoked_at is null
		returning id, ip_allowlist
	`;
	if (!rows[0]) return error(res, 404, 'not_found', 'key not found or revoked');
	await invalidateApiKey(rows[0].id);
	logAudit({ userId: user.id, action: 'api_key_allowlist', resourceId: id, meta: { rules: rules.length }, req });
	return json(res, 200, { id: rows[0].id, ip_allowlist: rows[0].ip_allowlist || [] });
});
