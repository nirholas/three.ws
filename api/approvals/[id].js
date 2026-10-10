// /api/approvals/:id: one approval request.
//
//   GET  ?t=<link token>
//        The request with its confirmation table. With ?t= (the signed deep link
//        every delivery carries) the response also says whether the link still
//        matches the request on file (link_verified / link_problem).
//   POST { decision: 'approve'|'deny', payload_hash, token?, via? }
//        Decide. Approve needs the payload_hash the owner was shown; a mismatch
//        is 409 and nothing runs, an expired request is 410. A repeat approve
//        returns the request's current state with idempotent: true.
//        Session only + CSRF. `via` records the surface: 'web' (default) or
//        'push' (the service worker's Approve/Deny buttons). Chat and mobile
//        decisions are made server-side by their own gateways.
//
// Library + semantics: api/_lib/approvals.js. Doc: docs/approvals.md.

import { getRequestUser, getSessionUser } from '../_lib/auth.js';
import { cors, json, method, wrap, error, readJson, rateLimited } from '../_lib/http.js';
import { requireCsrf } from '../_lib/csrf.js';
import { limits } from '../_lib/rate-limit.js';
import { getApproval, decideApproval, ApprovalError } from '../_lib/approvals.js';

const BROWSER_VIAS = new Set(['web', 'push']);

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const user = req.method === 'GET' ? await getRequestUser(req) : await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.approvalsUser(user.id);
	if (!rl.success) return rateLimited(res, rl);

	const id = String(req.query?.id || '');
	try {
		if (req.method === 'GET') {
			const token = new URL(req.url, 'http://x').searchParams.get('t');
			const request = await getApproval(user.id, id, { token });
			return json(res, 200, { request }, { 'cache-control': 'no-store' });
		}

		if (!(await requireCsrf(req, res, user.id))) return;
		const body = await readJson(req);
		const via = BROWSER_VIAS.has(body?.via) ? body.via : 'web';
		const out = await decideApproval({
			userId: user.id,
			id,
			decision: body?.decision,
			payloadHash: body?.payload_hash ?? null,
			token: body?.token || null,
			via,
			req,
		});
		return json(res, 200, out);
	} catch (e) {
		if (e instanceof ApprovalError) return error(res, e.status, e.code, e.message, e.extra);
		throw e;
	}
});
