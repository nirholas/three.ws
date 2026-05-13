// GET    /api/x/reviews                — list pending review drafts
// PATCH  /api/x/reviews?id=<uuid>      — approve (publishes) or edit + approve
//                                         body: { action: 'approve'|'reject', text?, thread_parts? }
// DELETE /api/x/reviews?id=<uuid>      — reject without publishing

import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { cors, method, wrap, error, readJson, json } from '../_lib/http.js';
import { publishTweet, XPostError } from '../_lib/x-post.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,PATCH,DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'PATCH', 'DELETE'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	if (req.method === 'GET') {
		const rows = await sql`
			select id, trigger_id, agent_id, text, thread_parts, status, created_at
			from x_pending_reviews
			where user_id = ${user.id} and status = 'pending'
			order by created_at desc
			limit 50
		`;
		return json(res, 200, { reviews: rows });
	}

	const url = new URL(req.url, 'http://x');
	const id = url.searchParams.get('id');
	if (!id) return error(res, 400, 'validation_error', 'id required');

	const rows = await sql`
		select * from x_pending_reviews
		where id = ${id} and user_id = ${user.id} and status = 'pending'
		limit 1
	`;
	const review = rows[0];
	if (!review) return error(res, 404, 'not_found', 'review not found or already resolved');

	if (req.method === 'DELETE') {
		await sql`update x_pending_reviews set status = 'rejected', resolved_at = now() where id = ${id}`;
		return json(res, 200, { rejected: id });
	}

	// PATCH — approve (possibly with edits)
	const body = await readJson(req);
	const action = body?.action || 'approve';
	if (action === 'reject') {
		await sql`update x_pending_reviews set status = 'rejected', resolved_at = now() where id = ${id}`;
		return json(res, 200, { rejected: id });
	}
	if (action !== 'approve') return error(res, 400, 'validation_error', 'action must be approve or reject');

	const text = typeof body?.text === 'string' ? body.text : review.text;
	const threadParts = Array.isArray(body?.thread_parts) ? body.thread_parts : (Array.isArray(review.thread_parts) ? review.thread_parts : null);
	const appendLink = body?.append_link === true;

	try {
		const result = await publishTweet({
			userId: user.id,
			agentId: review.agent_id,
			text: threadParts ? null : text,
			threadParts,
			appendLink,
		});
		await sql`update x_pending_reviews set status = 'approved', resolved_at = now() where id = ${id}`;
		return json(res, 200, { approved: id, ...result });
	} catch (err) {
		if (err instanceof XPostError) return error(res, err.status, err.code, err.message, err.extra);
		return error(res, 500, 'internal_error', err.message || 'publish failed');
	}
});
