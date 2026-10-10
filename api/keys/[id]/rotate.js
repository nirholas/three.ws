// POST /api/keys/:id/rotate: mint a replacement for a key and give the old one
// an overlap window. Body: { overlap_hours? } (default 24, max 168, 0 revokes
// the old key now). The old key keeps answering until overlap_until, so a
// deploy can move to the new secret without a gap; the new key carries the
// same name, scopes, preset, environment and expiry.

import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { logAudit } from '../../_lib/audit.js';
import { mintApiKey } from '../../_lib/api-keys.js';
import { invalidateApiKey } from '../../_lib/api-key-cache.js';
import { cors, json, method, wrap, error, rateLimited, readJson } from '../../_lib/http.js';
import { requireCsrf } from '../../_lib/csrf.js';
import { limits } from '../../_lib/rate-limit.js';
import { isUuid } from '../../_lib/validate.js';

export const DEFAULT_OVERLAP_HOURS = 24;
export const MAX_OVERLAP_HOURS = 168;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in to manage API keys');
	if (!(await requireCsrf(req, res, user.id))) return;
	const rl = await limits.apiKeyManage(user.id);
	if (!rl.success) return rateLimited(res, rl);

	const id = req.query?.id;
	if (!isUuid(id)) return error(res, 400, 'invalid_id', 'API key id must be a UUID');
	const body = (await readJson(req)) || {};
	const rawHours = body.overlap_hours == null ? DEFAULT_OVERLAP_HOURS : Number(body.overlap_hours);
	if (!Number.isFinite(rawHours) || rawHours < 0 || rawHours > MAX_OVERLAP_HOURS)
		return error(res, 400, 'validation_error', `overlap_hours must be between 0 and ${MAX_OVERLAP_HOURS}`);

	const [old] = await sql`
		select id, name, prefix, scope, preset, expires_at, revoked_at, rotated_to, ip_allowlist
		from api_keys where id = ${id} and user_id = ${user.id} limit 1
	`;
	if (!old) return error(res, 404, 'not_found', 'key not found');
	if (old.revoked_at) return error(res, 409, 'revoked', 'a revoked key cannot be rotated; mint a new one');
	if (old.rotated_to) return error(res, 409, 'already_rotated', 'this key was already rotated; rotate its replacement instead');

	const environment = old.prefix.startsWith('sk_test_') ? 'test' : 'live';
	const { row, secret } = await mintApiKey({
		userId: user.id,
		name: old.name,
		scopes: String(old.scope || '').split(/\s+/).filter(Boolean),
		expiresAt: old.expires_at,
		environment,
		req,
		via: 'rotate',
		preset: old.preset,
	});
	const overlapUntil = new Date(Date.now() + rawHours * 3_600_000).toISOString();
	await sql`update api_keys set rotated_from = ${old.id}, ip_allowlist = ${old.ip_allowlist} where id = ${row.id}`;
	await sql`
		update api_keys set rotated_to = ${row.id}, overlap_until = ${overlapUntil},
			revoked_at = case when ${rawHours} = 0 then now() else revoked_at end
		where id = ${old.id}
	`;
	// The old row is cached for authentication; refresh it so the overlap
	// deadline (or the immediate revoke) holds on the very next call.
	await invalidateApiKey(old.id);
	logAudit({ userId: user.id, action: 'rotate_api_key', resourceId: old.id, meta: { replacement: row.id, overlap_hours: rawHours }, req });

	return json(res, 201, {
		key: { ...row, rotated_from: old.id, ip_allowlist: old.ip_allowlist, secret },
		previous: { id: old.id, overlap_until: overlapUntil, revoked: rawHours === 0 },
	});
});
