// GET    /api/agents/:id/embed-policy  — public; returns { policy } (or { policy: null })
// PUT    /api/agents/:id/embed-policy  — owner-only; sets the policy
// DELETE /api/agents/:id/embed-policy  — owner-only; clears the policy
//
// Policy shape when non-null:
//   { mode: "allowlist" | "denylist", hosts: ["example.com", "*.substack.com"] }
// `hosts` supports exact match and a single leading-wildcard segment ("*.foo.com").

import { z } from 'zod';
import { getSessionUser } from '../../_lib/auth.js';
import { sql } from '../../_lib/db.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { parse } from '../../_lib/validate.js';

// Hostnames are ASCII only here — policy authors enter punycoded forms.
// Allow a single leading "*." wildcard segment; otherwise require conventional
// dot-separated labels. Cap at 253 chars (DNS max).
const hostPattern = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

const policySchema = z.object({
	mode: z.enum(['allowlist', 'denylist']),
	hosts: z
		.array(
			z
				.string()
				.trim()
				.toLowerCase()
				.min(1)
				.max(253)
				.regex(hostPattern, 'invalid host; use example.com or *.example.com'),
		)
		.max(100),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,PUT,DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'PUT', 'DELETE'])) return;

	const id = req.query?.id || new URL(req.url, 'http://x').pathname.split('/').filter(Boolean)[2];
	if (!id) return error(res, 400, 'invalid_request', 'agent id required');

	if (req.method === 'GET') {
		const [row] = await sql`
			SELECT embed_policy FROM agent_identities
			WHERE id = ${id} AND deleted_at IS NULL
		`;
		if (!row) return error(res, 404, 'not_found', 'agent not found');
		return json(res, 200, { policy: row.embed_policy ?? null });
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

	const policy = parse(policySchema, await readJson(req));
	const [updated] = await sql`
		UPDATE agent_identities
		SET embed_policy = ${sql.json(policy)}
		WHERE id = ${id}
		RETURNING embed_policy
	`;
	return json(res, 200, { policy: updated.embed_policy });
});
