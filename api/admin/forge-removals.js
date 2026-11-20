// /api/admin/forge-removals: the review queue for forge model removal requests
// (issue #639), behind /admin/forge-removals.
//
//   GET   ?status=open|removed|dismissed|all&limit=50
//         requests newest first, each with what is left of its model (prompt,
//         preview, visibility, or creation_exists: false once it is gone), plus
//         per-status counts.
//   POST  { id, action: 'remove'|'dismiss', resolution }
//         'remove' runs the full delete an owner gets (mesh, preview, delivery
//         variants, source uploads, row) under the moderator grant and closes
//         every open request on that model. 'dismiss' closes this request only.
//
// Store: api/_lib/forge-removal-requests.js. Auth: authorizeOps (a signed-in
// platform admin with a second factor, or the ops secret). Reporter keys are
// hashed at write time and never returned.

import { error, json, method, rateLimited, readJson, wrap } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { authorizeOps } from '../_lib/ops-auth.js';
import { respondMfaRequired } from '../_lib/admin-mfa.js';
import { isUuid } from '../_lib/validate.js';
import { deleteCreation } from '../_lib/forge-store.js';
import { REMOVAL_STATUSES, listRemovalRequests, removalRequestCounts, resolveRemovalRequest } from '../_lib/forge-removal-requests.js';

const NO_STORE = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' };

export default wrap(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	const rl = await limits.authedReadIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);
	const auth = await authorizeOps(req);
	if (auth.mfaRequired) return respondMfaRequired(res);
	if (!auth.ok) return error(res, 401, 'unauthorized', 'admin session or ops secret required');

	if (req.method === 'GET') {
		const url = new URL(req.url, 'http://local');
		const status = url.searchParams.get('status') || 'open';
		if (status !== 'all' && !REMOVAL_STATUSES.includes(status)) {
			return error(res, 400, 'validation_error', `status must be one of ${[...REMOVAL_STATUSES, 'all'].join(', ')}`);
		}
		const [requests, counts] = await Promise.all([
			listRemovalRequests({ status, limit: url.searchParams.get('limit') }),
			removalRequestCounts(),
		]);
		return json(res, 200, { ok: true, status, requests, counts }, NO_STORE);
	}

	const body = (await readJson(req).catch(() => null)) || {};
	if (!isUuid(body.id)) return error(res, 400, 'validation_error', 'id must be a removal request id');
	if (body.action !== 'remove' && body.action !== 'dismiss') {
		return error(res, 400, 'validation_error', "action must be 'remove' or 'dismiss'");
	}
	const resolution = String(body.resolution || '').trim().slice(0, 1000);
	if (!resolution) return error(res, 400, 'validation_error', 'say why (resolution) before closing the request');

	const out = await resolveRemovalRequest({ id: body.id, action: body.action, resolution, reviewedBy: auth.actor, deleteCreation });
	if (!out) return error(res, 404, 'not_found', 'no removal request with that id');
	if (body.action === 'remove' && out.outcome !== 'deleted' && out.outcome !== 'not_found') {
		return error(res, 503, 'delete_failed', 'The model could not be deleted right now. Nothing changed; try again shortly.');
	}
	return json(res, 200, { ok: true, request: out.request, outcome: out.outcome }, NO_STORE);
});
