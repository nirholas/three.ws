// POST /api/avatars/regenerate — initiate avatar regeneration
// Pluggable provider architecture. Currently returns 501 until provider is configured.

import { getSessionUser, authenticateBearer, extractBearer, hasScope } from '../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { sql } from '../_lib/db.js';
import { env } from '../_lib/env.js';
import { parse } from '../_lib/validate.js';
import { z } from 'zod';
import { randomUUID } from 'crypto';

const regenerateSchema = z.object({
	sourceAvatarId: z.string().trim().min(1).max(100),
	mode: z.enum(['remesh', 'retex', 'rerig', 'restyle']),
	params: z.record(z.unknown()).optional(),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	// Auth: session OR bearer
	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	if (!session && !bearer)
		return error(res, 401, 'unauthorized', 'sign in or provide a valid bearer token');
	if (bearer && !hasScope(bearer.scope, 'avatars:write')) {
		return error(res, 403, 'insufficient_scope', 'avatars:write scope required');
	}
	const userId = session?.id ?? bearer?.userId;

	// Rate limit
	const rl = await limits.upload(userId);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(regenerateSchema, await readJson(req));

	// Verify source avatar exists and is owned by this user
	const rows = await sql`
		select id, name, storage_key from avatars
		where id = ${body.sourceAvatarId} and owner_id = ${userId} and deleted_at is null
		limit 1
	`;
	if (!rows[0]) {
		return error(res, 404, 'not_found', 'source avatar not found or not owned');
	}
	const sourceAvatar = rows[0];

	// Check if provider is configured
	const provider = (env.AVATAR_REGEN_PROVIDER || 'none').trim().toLowerCase();

	if (provider === 'none' || !provider) {
		return error(
			res,
			501,
			'regen_unconfigured',
			'Avatar regeneration is not yet wired to an ML backend. Set AVATAR_REGEN_PROVIDER env var.',
		);
	}

	// Provider stub — always return success with deterministic fake job
	if (provider === 'stub') {
		const jobId = `stub-${randomUUID()}`;
		// In a real implementation, this would queue the job with the ML provider
		// and store metadata in a `avatar_regen_jobs` table.
		await sql`
			insert into avatar_regen_jobs (job_id, user_id, source_avatar_id, mode, params, status, created_at)
			values (${jobId}, ${userId}, ${body.sourceAvatarId}, ${body.mode}, ${JSON.stringify(body.params ?? {})}, 'queued', now())
		`;
		return json(res, 202, {
			ok: true,
			jobId,
			status: 'queued',
			eta: null,
		});
	}

	// Unknown provider — return error
	return error(res, 501, 'regen_provider_error', `Unknown provider: ${provider}`);
});
