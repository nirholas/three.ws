// api/sign-review/[action]: native-signer review of sign packs.
//
//   GET  /api/sign-review/packs              packs under review (+ your grants when signed in)
//   GET  /api/sign-review/queue?pack=<id>    signs waiting for YOUR verdict (granted reviewer)
//   POST /api/sign-review/review             { pack, sign, hash, verdict, note? } (granted reviewer)
//   GET  /api/sign-review/status?pack=<id>   public aggregate counts
//   POST /api/sign-review/reviewer           { pack, user_id | email, display_name, credential_note?, revoke? } (admin)
//
// Verdicts land in the review workspace (api/_lib/sign-review.js). Nothing here
// changes what /api/sign serves: approvals go live only when exported into the
// pack's committed ledger with scripts/export-sign-reviews.mjs.

import { cors, error, json, method, readJson, wrap } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { getSessionUser } from '../_lib/auth.js';
import { isAdminUser, requireAdmin } from '../_lib/admin.js';
import { requireCsrf } from '../_lib/csrf.js';
import {
	SignReviewError,
	getReviewPack,
	grantReviewer,
	grantsFor,
	isReviewer,
	packStatus,
	packSummary,
	recordReview,
	resolveUserId,
	reviewQueue,
	reviewablePacks,
	revokeReviewer,
} from '../_lib/sign-review.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const rl = await limits.authedReadIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests; slow down');

	const action = actionOf(req);
	try {
		switch (action) {
			case 'packs':
				return await handlePacks(req, res);
			case 'queue':
				return await handleQueue(req, res);
			case 'review':
				return await handleReview(req, res);
			case 'status':
				return await handleStatus(req, res);
			case 'reviewer':
				return await handleReviewer(req, res);
			default:
				return error(res, 404, 'not_found', `unknown sign-review action "${action}"`);
		}
	} catch (err) {
		if (err instanceof SignReviewError) return error(res, err.status, err.code, err.message);
		throw err;
	}
});

function actionOf(req) {
	const fromQuery = req.query?.action;
	if (fromQuery && fromQuery !== '[action]') return String(fromQuery).toLowerCase();
	return (new URL(req.url, 'http://x').pathname.split('/').pop() || '').toLowerCase();
}

function queryOf(req) {
	return new URL(req.url, 'http://x').searchParams;
}

async function handlePacks(req, res) {
	if (!method(req, res, ['GET'])) return;
	const user = await getSessionUser(req);
	const packs = reviewablePacks().map(packSummary);
	const body = { packs, signed_in: Boolean(user) };
	if (user) {
		const granted = await grantsFor(user.id);
		const known = new Set(packs.map((p) => p.id));
		body.granted = granted.filter((id) => known.has(id));
		body.is_admin = await isAdminUser(user);
	}
	return json(res, 200, body, { 'cache-control': 'private, no-store' });
}

async function reviewerFor(req, res, packId) {
	const user = await getSessionUser(req);
	if (!user) {
		error(res, 401, 'unauthorized', 'sign in to review signs');
		return null;
	}
	const pack = getReviewPack(packId);
	if (!pack) {
		error(res, 404, 'unknown_pack', `no sign pack under review is called "${packId ?? ''}"`);
		return null;
	}
	if (!(await isReviewer(user.id, pack.id))) {
		error(res, 403, 'not_a_reviewer', `you are not a reviewer for ${pack.name}`);
		return null;
	}
	return { user, pack };
}

async function handleQueue(req, res) {
	if (!method(req, res, ['GET'])) return;
	const who = await reviewerFor(req, res, queryOf(req).get('pack'));
	if (!who) return;
	const queue = await reviewQueue(who.pack.id, who.user.id);
	return json(res, 200, queue, { 'cache-control': 'private, no-store' });
}

async function handleReview(req, res) {
	if (!method(req, res, ['POST'])) return;
	const body = await readJson(req);
	const who = await reviewerFor(req, res, body?.pack);
	if (!who) return;
	if (!(await requireCsrf(req, res, who.user.id))) return;
	const result = await recordReview({
		pack: who.pack.id,
		sign: body.sign,
		hash: body.hash,
		reviewerId: who.user.id,
		verdict: body.verdict,
		note: body.note,
	});
	return json(res, 200, result);
}

async function handleStatus(req, res) {
	if (!method(req, res, ['GET'])) return;
	const status = await packStatus(queryOf(req).get('pack'));
	return json(res, 200, status, { 'cache-control': 'public, max-age=30' });
}

async function handleReviewer(req, res) {
	if (!method(req, res, ['POST'])) return;
	const admin = await requireAdmin(req, res);
	if (!admin) return;
	if (!(await requireCsrf(req, res, admin.id))) return;
	const body = await readJson(req);
	const pack = getReviewPack(body?.pack);
	if (!pack) return error(res, 404, 'unknown_pack', `no sign pack under review is called "${body?.pack ?? ''}"`);
	const userId = await resolveUserId({ userId: body.user_id, email: body.email });
	if (body.revoke === true) {
		const row = await revokeReviewer({ pack: pack.id, userId });
		return json(res, 200, { reviewer: row, revoked: true });
	}
	const row = await grantReviewer({
		pack: pack.id,
		userId,
		displayName: body.display_name,
		credentialNote: body.credential_note,
		grantedBy: admin.id,
	});
	return json(res, 200, { reviewer: row, revoked: false });
}
