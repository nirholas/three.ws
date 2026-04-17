// POST /api/avatars/:id/rollback
// Restores avatars.storage_key from a saved avatar_versions snapshot,
// then records the rollback as a new version row.
// Rate-limited to 10 / hour per user.

import { getSessionUser, authenticateBearer, extractBearer } from '../../_lib/auth.js';
import { sql } from '../../_lib/db.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { z } from 'zod';
import { parse } from '../../_lib/validate.js';

const bodySchema = z.object({
	versionId: z.coerce.number().int().positive(),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const id = req.query?.id;
	if (!id) return error(res, 400, 'invalid_request', 'id required');

	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	if (!session && !bearer) return error(res, 401, 'unauthorized', 'sign in required');
	const userId = session?.id ?? bearer.userId;

	const rl = await limits.avatarRollback(userId);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const { versionId } = parse(bodySchema, await readJson(req));

	const [avatar] = await sql`
		select id from avatars
		where id = ${id} and owner_id = ${userId} and deleted_at is null
		limit 1
	`;
	if (!avatar) return error(res, 404, 'not_found', 'avatar not found');

	const [ver] = await sql`
		select id, glb_url from avatar_versions
		where id = ${versionId} and avatar_id = ${id}
		limit 1
	`;
	if (!ver) return error(res, 404, 'not_found', 'version not found');

	const [updated] = await sql`
		update avatars
		set storage_key = ${ver.glb_url}, updated_at = now()
		where id = ${id} and owner_id = ${userId}
		returning id, owner_id, slug, name, description, storage_key, size_bytes,
		          content_type, source, visibility, tags, version, created_at, updated_at
	`;

	await sql`
		insert into avatar_versions (avatar_id, glb_url, metadata, created_by)
		values (
			${id},
			${ver.glb_url},
			${JSON.stringify({ rollback_of: versionId })}::jsonb,
			${userId}
		)
	`;

	return json(res, 200, { ok: true, avatar: updated });
});
