// /api/agent-screen-browse: autonomous browsing runs on the agent-screen pool.
//
//   Owner, with session and CSRF:
//     { op:'start', agentId, goal, startUrl, allowedDomains?, maxSteps? } -> { job }
//     { op:'status', jobId } -> { job }   steps so far, final status, result
//   Pool worker, with the SCREEN_WORKER_SECRET bearer:
//     { op:'claim' } -> { job | null }
//     { op:'report', jobId, status, steps, result? } -> { ok }
//
// The pool enforces the browsing policy (workers/agent-screen-pool/tasks/
// browse-policy.js); the owner's take-over uses the existing control lease.

import { timingSafeEqual } from 'node:crypto';
import { cors, error, json, method, rateLimited, readJson, wrap } from './_lib/http.js';
import { getSessionUser, extractBearer } from './_lib/auth.js';
import { requireCsrf } from './_lib/csrf.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { BrowseError, claimBrowse, enqueueBrowse, readBrowse, reportBrowse } from './_lib/agent-screen-browse.js';

const WORKER_SECRET = process.env.SCREEN_WORKER_SECRET || '';

function isPoolWorker(bearer) {
	if (!bearer || !WORKER_SECRET || WORKER_SECRET.length < 16) return false;
	const a = Buffer.from(bearer);
	const b = Buffer.from(WORKER_SECRET);
	return a.length === b.length && timingSafeEqual(a, b);
}

function fail(res, err) {
	if (err instanceof BrowseError) return error(res, err.status, err.code, err.message);
	throw err;
}

export default wrap(async function handleAgentScreenBrowse(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	let body;
	try {
		body = await readJson(req, 128_000);
	} catch {
		return error(res, 400, 'invalid_body', 'request body must be valid JSON under 128 KB');
	}
	const op = body?.op;

	try {
		if (op === 'claim' || op === 'report') {
			if (!isPoolWorker(extractBearer(req))) return error(res, 401, 'unauthorized', 'pool worker secret required');
			if (op === 'claim') return json(res, 200, { job: await claimBrowse() });
			if (typeof body.jobId !== 'string') return error(res, 400, 'missing_job_id', 'jobId is required');
			await reportBrowse(body);
			return json(res, 200, { ok: true });
		}

		if (op !== 'start' && op !== 'status') return error(res, 400, 'bad_op', 'op must be start | status');
		const rl = await limits.apiIp(clientIp(req), { limit: 120, window: '60s' });
		if (!rl.success) return rateLimited(res, rl, 'browse rate limit exceeded');
		const auth = await getSessionUser(req, res);
		const userId = auth?.id;
		if (!userId) return error(res, 401, 'unauthorized', 'sign in to run a browsing agent');
		if (!(await requireCsrf(req, res, userId))) return;

		if (op === 'status') {
			if (typeof body.jobId !== 'string') return error(res, 400, 'missing_job_id', 'jobId is required');
			return json(res, 200, { job: await readBrowse({ jobId: body.jobId, userId }) });
		}
		const job = await enqueueBrowse({ userId, agentId: String(body.agentId || '').trim(), goal: body.goal, startUrl: body.startUrl, allowedDomains: body.allowedDomains, maxSteps: body.maxSteps });
		const { userId: _omit, ...view } = job;
		return json(res, 202, { job: view });
	} catch (err) {
		return fail(res, err);
	}
});
