// POST /api/avatars/view — increment view_count for a public avatar.
// Accepts { avatar_id } in the JSON body. Auth is optional; the endpoint
// rate-limits by IP to prevent trivial inflation.

import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { sql } from '../_lib/db.js';
import { limits, clientIp } from '../_lib/rate-limit.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['POST'])) return;

	// One view per IP per avatar per 30 min — light throttle.
	const ip = clientIp(req);
	const rl = await limits.publicIp(ip);
	if (!rl.success) return json(res, 200, { ok: false, reason: 'rate_limited' });

	const body = await readJson(req).catch(() => null);
	const avatarId = body?.avatar_id;
	if (!avatarId || typeof avatarId !== 'string' || avatarId.length > 100) {
		return error(res, 400, 'invalid_request', 'avatar_id required');
	}

	// Only count views for public avatars; silently ignore private/deleted.
	await sql`
		UPDATE avatars
		SET view_count = coalesce(view_count, 0) + 1
		WHERE id = ${avatarId}
		  AND visibility = 'public'
		  AND deleted_at IS NULL
	`;

	return json(res, 200, { ok: true });
});
