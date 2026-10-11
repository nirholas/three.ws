// /api/approvals: the owner's approval inbox.
//
//   GET  ?status=pending|done|denied|expired|all&agent=<uuid>&cursor=&limit=
//        One page of requests, newest first, with per-status counts and the
//        agents that have asked. Session or bearer (read-only).
//   POST { action: 'bulk_deny', ids: [uuid, ...] }
//        Deny many pending requests at once. Session only + CSRF: a decision
//        about the owner's money is never made by a machine credential, which
//        an agent could hold.
//
// Library + semantics: api/_lib/approvals.js. Doc: docs/approvals.md.

import { getRequestUser, getSessionUser } from '../_lib/auth.js';
import { cors, json, method, wrap, error, readJson, rateLimited } from '../_lib/http.js';
import { requireCsrf } from '../_lib/csrf.js';
import { limits } from '../_lib/rate-limit.js';
import { listApprovals, bulkDeny, ApprovalError } from '../_lib/approvals.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const user = req.method === 'GET' ? await getRequestUser(req) : await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.approvalsUser(user.id);
	if (!rl.success) return rateLimited(res, rl);

	try {
		if (req.method === 'GET') {
			const params = new URL(req.url, 'http://x').searchParams;
			const out = await listApprovals(user.id, {
				group: params.get('status') || 'pending',
				agentId: params.get('agent') || null,
				limit: Number.parseInt(params.get('limit') || '30', 10),
				cursor: params.get('cursor') || null,
			});
			return json(res, 200, out, { 'cache-control': 'no-store' });
		}

		if (!(await requireCsrf(req, res, user.id))) return;
		const body = await readJson(req);
		if (body?.action !== 'bulk_deny') return error(res, 400, 'invalid_action', 'action must be "bulk_deny"');
		const out = await bulkDeny(user.id, body.ids, { via: 'web', req });
		return json(res, 200, out);
	} catch (e) {
		if (e instanceof ApprovalError) return error(res, e.status, e.code, e.message, e.extra);
		throw e;
	}
});
