// PUT /api/agents/:id/animations — owner-only; atomically replaces meta.animations
//
// Uses jsonb_set so the rest of `meta` (including encrypted_wallet_key) is never
// read by the client or overwritten. The generic PUT /api/agents/:id handler
// overwrites `meta` wholesale which would leak/clobber sibling fields — this
// endpoint exists specifically to avoid that.

import { getSessionUser, authenticateBearer, extractBearer } from '../../_lib/auth.js';
import { sql } from '../../_lib/db.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { z } from 'zod';

const animationEntrySchema = z.object({
	name: z.string().trim().min(1).max(60),
	url: z
		.string()
		.trim()
		.min(1)
		.max(2048)
		.refine(
			(u) => /^(https?|ipfs|ar):\/\//.test(u) || u.startsWith('/') || /^u\//.test(u),
			'url must be http, https, ipfs, ar, a root-relative path, or a storage key',
		),
	loop: z.boolean().default(true),
	clipName: z.string().trim().max(120).optional(),
	source: z.enum(['mixamo', 'preset', 'custom']),
	addedAt: z.string().optional(),
});

const bodySchema = z.object({
	animations: z.array(animationEntrySchema).max(30),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'PUT,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['PUT'])) return;

	const id = req.query?.id || new URL(req.url, 'http://x').pathname.split('/').filter(Boolean)[2];
	if (!id) return error(res, 400, 'invalid_request', 'agent id required');

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');

	const [existing] = await sql`
		SELECT id, user_id FROM agent_identities
		WHERE id = ${id} AND deleted_at IS NULL
	`;
	if (!existing) return error(res, 404, 'not_found', 'agent not found');
	if (existing.user_id !== auth.userId) return error(res, 403, 'forbidden', 'not your agent');

	let parsed;
	try {
		parsed = bodySchema.parse(await readJson(req));
	} catch (err) {
		if (err.name === 'ZodError') {
			return error(res, 400, 'validation_error', err.errors[0]?.message || 'invalid body', {
				fields: err.errors,
			});
		}
		throw err;
	}

	await sql`
		UPDATE agent_identities
		SET meta = jsonb_set(
			COALESCE(meta, '{}'::jsonb),
			'{animations}',
			${JSON.stringify(parsed.animations)}::jsonb,
			true
		)
		WHERE id = ${id}
	`;

	return json(res, 200, { animations: parsed.animations });
});

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId };
	return null;
}
