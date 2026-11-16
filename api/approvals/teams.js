// /api/approvals/teams: Microsoft Teams as an approval channel.
//
//   GET                       { linked, identity, installed, chats, bot_configured,
//                               enabled, install_url }: what the Microsoft Teams
//                               panel on /approvals renders.
//   PUT    { enabled }        turn Teams approval cards on or off.
//   POST   { action: 'test' } send a labelled test approval to Teams. It runs
//                             nothing when approved and expires in 15 minutes.
//
// Writes are session only + CSRF. Doc: docs/approvals.md, "Approving from
// Microsoft Teams". The cards and the invoke handler are api/_lib/teams-approvals.js.

import { getRequestUser, getSessionUser } from '../_lib/auth.js';
import { cors, json, method, wrap, error, readJson, rateLimited } from '../_lib/http.js';
import { requireCsrf } from '../_lib/csrf.js';
import { limits } from '../_lib/rate-limit.js';
import { ApprovalError } from '../_lib/approvals.js';
import { sendTestApproval, setTeamsApprovalsEnabled, teamsApprovalStatus } from '../_lib/teams-approvals.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,PUT,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'PUT', 'POST'])) return;

	const user = req.method === 'GET' ? await getRequestUser(req) : await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.approvalsUser(user.id);
	if (!rl.success) return rateLimited(res, rl);

	try {
		if (req.method === 'GET') {
			return json(res, 200, await teamsApprovalStatus(user.id), { 'cache-control': 'no-store' });
		}

		if (!(await requireCsrf(req, res, user.id))) return;
		const body = (await readJson(req)) || {};

		if (req.method === 'PUT') {
			if (typeof body.enabled !== 'boolean') return error(res, 400, 'invalid_body', 'enabled must be true or false');
			await setTeamsApprovalsEnabled(user.id, body.enabled);
			return json(res, 200, await teamsApprovalStatus(user.id));
		}

		if (body.action !== 'test') return error(res, 400, 'invalid_action', 'action must be "test"');
		const sent = await sendTestApproval(user.id);
		if (!sent.delivered) {
			return error(res, 502, 'teams_delivery_failed', 'Teams did not accept the test card. Open the three.ws chat in Teams once, then try again.', sent);
		}
		return json(res, 201, sent);
	} catch (e) {
		if (e instanceof ApprovalError) return error(res, e.status, e.code, e.message, e.extra);
		throw e;
	}
});
