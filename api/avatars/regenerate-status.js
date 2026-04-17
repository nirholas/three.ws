// GET /api/avatars/regenerate-status?jobId=<id> — poll job status

import { getSessionUser, authenticateBearer, extractBearer, hasScope } from '../_lib/auth.js';
import { cors, json, method, wrap, error } from '../_lib/http.js';
import { sql } from '../_lib/db.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	// Auth: session OR bearer
	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	if (!session && !bearer)
		return error(res, 401, 'unauthorized', 'sign in or provide a valid bearer token');
	if (bearer && !hasScope(bearer.scope, 'avatars:read')) {
		return error(res, 403, 'insufficient_scope', 'avatars:read scope required');
	}
	const userId = session?.id ?? bearer?.userId;

	const url = new URL(req.url, 'http://x');
	const jobId = url.searchParams.get('jobId');
	if (!jobId) return error(res, 400, 'invalid_request', 'jobId required');

	// Fetch job status — must be owned by the authenticated user
	const rows = await sql`
		select job_id, status, result_avatar_id, error, created_at
		from avatar_regen_jobs
		where job_id = ${jobId} and user_id = ${userId}
		limit 1
	`;

	if (!rows[0]) {
		return error(res, 404, 'not_found', 'job not found');
	}

	const job = rows[0];
	const response = {
		ok: true,
		jobId: job.job_id,
		status: job.status,
	};

	if (job.result_avatar_id) {
		response.resultAvatarId = job.result_avatar_id;
	}
	if (job.error) {
		response.error = job.error;
	}

	return json(res, 200, response);
});
