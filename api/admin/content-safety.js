// /api/admin/content-safety: the review queue for models the public-listing
// safety screen stopped (api/_lib/content-safety.js).
//
//   GET   ?status=attention|held|blocked&limit=50
//         models the screen blocked (forced private) or held (could not be
//         screened in time), newest first, each with its latest automatic
//         verdict, plus counts per safety status.
//   POST  { id, action: 'approve'|'remove', note }
//         'approve' marks the model clear (a held model then goes public by
//         itself, a blocked one stays private until its maker publishes it).
//         'remove' runs the full moderator delete. A model with a CSAM verdict
//         cannot be removed here: removal destroys the evidence the legal report
//         needs, so that path is docs/ops/content-safety.md, run by the owner.
//
// Auth: authorizeOps (a signed-in platform admin with a second factor, or the
// ops secret). Every decision lands in content_safety_reviews with the actor.

import { error, json, method, rateLimited, readJson, wrap } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { authorizeOps } from '../_lib/ops-auth.js';
import { respondMfaRequired } from '../_lib/admin-mfa.js';
import { isUuid } from '../_lib/validate.js';
import { sql } from '../_lib/db.js';
import { deleteCreation } from '../_lib/forge-store.js';
import { adminDecision, listAttention, safetyCounts } from '../_lib/content-safety-store.js';

const NO_STORE = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' };
const LIST_STATUSES = ['attention', 'held', 'blocked'];

export default wrap(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	const rl = await limits.authedReadIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);
	const auth = await authorizeOps(req);
	if (auth.mfaRequired) return respondMfaRequired(res);
	if (!auth.ok) return error(res, 401, 'unauthorized', 'admin session or ops secret required');

	if (req.method === 'GET') {
		const url = new URL(req.url, 'http://local');
		const status = url.searchParams.get('status') || 'attention';
		if (!LIST_STATUSES.includes(status)) {
			return error(res, 400, 'validation_error', `status must be one of ${LIST_STATUSES.join(', ')}`);
		}
		const [items, counts] = await Promise.all([
			listAttention({ status, limit: url.searchParams.get('limit') }),
			safetyCounts(),
		]);
		return json(res, 200, { ok: true, status, items, counts }, NO_STORE);
	}

	const body = (await readJson(req).catch(() => null)) || {};
	if (!isUuid(body.id)) return error(res, 400, 'validation_error', 'id must be a creation id');
	if (body.action !== 'approve' && body.action !== 'remove') {
		return error(res, 400, 'validation_error', "action must be 'approve' or 'remove'");
	}
	const note = String(body.note || '').trim().slice(0, 1000);
	if (!note) return error(res, 400, 'validation_error', 'say why (note) before deciding');

	if (body.action === 'remove') {
		const [csam] = await sql`select 1 from content_safety_reviews where subject_id = ${body.id} and csam limit 1`;
		if (csam) {
			return error(res, 409, 'evidence_hold', 'This model has a CSAM verdict and must be preserved for the legal report. Follow docs/ops/content-safety.md before any removal.');
		}
	}

	const decided = await adminDecision({ id: body.id, action: body.action, note, actor: auth.actor });
	if (!decided.ok) return error(res, 404, 'not_found', 'no model with that id');
	if (body.action === 'remove') {
		const outcome = await deleteCreation({ id: body.id, moderator: true });
		if (outcome !== 'deleted' && outcome !== 'not_found') {
			return error(res, 503, 'delete_failed', 'The model could not be deleted right now. Nothing else changed; try again shortly.');
		}
		return json(res, 200, { ok: true, outcome }, NO_STORE);
	}
	return json(res, 200, { ok: true, outcome: 'approved' }, NO_STORE);
});
