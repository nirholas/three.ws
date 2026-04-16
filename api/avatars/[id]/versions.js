// GET /api/avatars/:id/versions
// Walks parent_avatar_id upward from the given avatar to collect all ancestors
// (including self), ordered oldest first. Also includes newer versions by
// walking the full chain from the root.
//
// Response: { versions: [{ id, version, total, created_at, is_current }] }
//   is_current — true when this avatar row is the caller's agent's current avatar.
//
// Auth: optional. Unauthenticated callers get is_current: false for all rows.

import { getSessionUser, authenticateBearer, extractBearer } from '../../_lib/auth.js';
import { sql } from '../../_lib/db.js';
import { cors, json, method, wrap, error } from '../../_lib/http.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const id = req.query?.id;
	if (!id) return error(res, 400, 'invalid_request', 'id required');

	const auth = await resolveAuth(req);

	// Walk upward through parent_avatar_id to collect the full ancestor chain,
	// then walk downward from the root to collect all descendants.
	// Two-phase CTE keeps the query readable and avoids a self-join cycle.
	const rows = await sql`
		WITH RECURSIVE
		ancestors AS (
			SELECT id, parent_avatar_id, created_at
			FROM avatars
			WHERE id = ${id} AND deleted_at IS NULL
			UNION ALL
			SELECT a.id, a.parent_avatar_id, a.created_at
			FROM avatars a
			JOIN ancestors anc ON a.id = anc.parent_avatar_id
			WHERE a.deleted_at IS NULL
		),
		root AS (
			SELECT id FROM ancestors WHERE parent_avatar_id IS NULL LIMIT 1
		),
		chain AS (
			SELECT a.id, a.parent_avatar_id, a.created_at
			FROM avatars a
			JOIN root r ON a.id = r.id
			WHERE a.deleted_at IS NULL
			UNION ALL
			SELECT a.id, a.parent_avatar_id, a.created_at
			FROM avatars a
			JOIN chain c ON a.parent_avatar_id = c.id
			WHERE a.deleted_at IS NULL
		)
		SELECT id, created_at FROM chain ORDER BY created_at ASC
	`;

	// If the seed avatar wasn't found (deleted or wrong id), the ancestor CTE
	// returns empty → chain is also empty.
	if (!rows.length) return error(res, 404, 'not_found', 'avatar not found');

	// Determine the caller's current avatar so is_current can be set.
	let currentAvatarId = null;
	if (auth?.userId) {
		const [agent] = await sql`
			SELECT avatar_id FROM agent_identities
			WHERE user_id = ${auth.userId} AND deleted_at IS NULL
			ORDER BY created_at ASC LIMIT 1
		`;
		currentAvatarId = agent?.avatar_id ?? null;
	}

	const total = rows.length;
	const versions = rows.map((row, i) => ({
		id: row.id,
		version: i + 1,
		total,
		created_at: row.created_at,
		is_current: row.id === currentAvatarId,
	}));

	return json(res, 200, { versions });
});

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	return bearer ? { userId: bearer.userId } : null;
}
