// GET    /api/agents/:id/embed-policy  — public; returns { policy } (extended normalized shape)
// PUT    /api/agents/:id/embed-policy  — owner-only; accepts extended or legacy shape
// DELETE /api/agents/:id/embed-policy  — owner-only; clears the policy

import { getSessionUser } from '../../_lib/auth.js';
import { sql } from '../../_lib/db.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { readEmbedPolicy, validateEmbedPolicy } from '../../_lib/embed-policy.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,PUT,DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'PUT', 'DELETE'])) return;

	const id = req.query?.id || new URL(req.url, 'http://x').pathname.split('/').filter(Boolean)[2];
	if (!id) return error(res, 400, 'invalid_request', 'agent id required');

	if (req.method === 'GET') {
		const policy = await readEmbedPolicy(id);
		if (policy === null) {
			// Check if agent actually exists vs column missing
			const [row] = await sql`
				SELECT id FROM agent_identities WHERE id = ${id} AND deleted_at IS NULL
			`;
			if (!row) return error(res, 404, 'not_found', 'agent not found');
		}
		return json(res, 200, { policy: policy ?? null });
	}

	const session = await getSessionUser(req);
	if (!session) return error(res, 401, 'unauthorized', 'sign in required');

	const [existing] = await sql`
		SELECT id, user_id FROM agent_identities
		WHERE id = ${id} AND deleted_at IS NULL
	`;
	if (!existing) return error(res, 404, 'not_found', 'agent not found');
	if (existing.user_id !== session.id) return error(res, 403, 'forbidden', 'not your agent');

	if (req.method === 'DELETE') {
		await sql`UPDATE agent_identities SET embed_policy = NULL WHERE id = ${id}`;
		return json(res, 200, { policy: null });
	}

	let normalized;
	try {
		normalized = validateEmbedPolicy(await readJson(req));
	} catch (err) {
		if (err.name === 'ZodError') {
			return error(res, 400, 'validation_error', err.errors[0]?.message || 'invalid policy', {
				fields: err.errors,
			});
		}
		throw err;
	}

	const [updated] = await sql`
		UPDATE agent_identities
		SET embed_policy = ${JSON.stringify(normalized)}::jsonb
		WHERE id = ${id}
		RETURNING embed_policy
	`;
	return json(res, 200, { policy: updated.embed_policy });
});
