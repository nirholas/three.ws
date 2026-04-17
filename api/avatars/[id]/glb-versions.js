// GET /api/avatars/:id/glb-versions
// Lists explicit GLB save-back snapshots for an avatar, newest first (limit 50).
// Requires auth + ownership. Distinct from /versions (parent_avatar_id lineage chain).

import { getSessionUser, authenticateBearer, extractBearer } from '../../_lib/auth.js';
import { sql } from '../../_lib/db.js';
import { cors, json, method, wrap, error } from '../../_lib/http.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const id = req.query?.id;
	if (!id) return error(res, 400, 'invalid_request', 'id required');

	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	if (!session && !bearer) return error(res, 401, 'unauthorized', 'sign in required');
	const userId = session?.id ?? bearer.userId;

	const [avatar] = await sql`
		select id from avatars
		where id = ${id} and owner_id = ${userId} and deleted_at is null
		limit 1
	`;
	if (!avatar) return error(res, 404, 'not_found', 'avatar not found');

	const rows = await sql`
		select id, glb_url, created_at, metadata
		from avatar_versions
		where avatar_id = ${id}
		order by created_at desc
		limit 50
	`;

	return json(res, 200, {
		versions: rows.map((v) => ({
			id: v.id,
			glbUrl: v.glb_url,
			createdAt: v.created_at,
			metadata: v.metadata ?? null,
		})),
	});
});
