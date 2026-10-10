// /api/approvals/policies: the owner's explicit auto-approve rules.
//
//   GET                       every policy on the account, live first.
//   POST   { venues, max_usd, agent_id?, team_id?, expires_at?, label? }
//                             create one. venues from VENUES in
//                             api/_lib/approvals.js; max_usd capped at
//                             AUTO_POLICY_MAX_USD.
//   DELETE ?id=<uuid>         revoke one (the row stays for the audit trail).
//
// With no policy, every gated action asks. Writes are session only + CSRF.
// Doc: docs/approvals.md.

import { getRequestUser, getSessionUser } from '../_lib/auth.js';
import { cors, json, method, wrap, error, readJson, rateLimited } from '../_lib/http.js';
import { requireCsrf } from '../_lib/csrf.js';
import { limits } from '../_lib/rate-limit.js';
import {
	listAutoPolicies,
	createAutoPolicy,
	revokeAutoPolicy,
	ApprovalError,
	VENUES,
	AUTO_POLICY_MAX_USD,
} from '../_lib/approvals.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST', 'DELETE'])) return;

	const user = req.method === 'GET' ? await getRequestUser(req) : await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.approvalsUser(user.id);
	if (!rl.success) return rateLimited(res, rl);

	try {
		if (req.method === 'GET') {
			const policies = await listAutoPolicies(user.id);
			const venues = Object.entries(VENUES).filter(([, v]) => v.auto).map(([key, v]) => ({ key, label: v.label }));
			return json(res, 200, { policies, venues, max_usd_cap: AUTO_POLICY_MAX_USD }, { 'cache-control': 'no-store' });
		}

		if (!(await requireCsrf(req, res, user.id))) return;

		if (req.method === 'POST') {
			const body = await readJson(req);
			const policy = await createAutoPolicy(user.id, body || {}, { req });
			return json(res, 201, { policy });
		}

		const id = new URL(req.url, 'http://x').searchParams.get('id') || '';
		const policy = await revokeAutoPolicy(user.id, id, { req });
		return json(res, 200, { policy });
	} catch (e) {
		if (e instanceof ApprovalError) return error(res, e.status, e.code, e.message, e.extra);
		throw e;
	}
});
