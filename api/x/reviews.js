// GET    /api/x/reviews[?agent_id=]:    list pending review drafts (optionally for one agent)
// PATCH  /api/x/reviews?id=<uuid>:      approve (publishes) or edit + approve
//                                         body: { action: 'approve'|'reject', text?, thread_parts? }
// DELETE /api/x/reviews?id=<uuid>:      reject without publishing

import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { cors, method, wrap, error, readJson, json } from '../_lib/http.js';
import { requireCsrf } from '../_lib/csrf.js';
import { isUuid } from '../_lib/validate.js';
import { publishTweet, XPostError, MAX_TWEET_LEN } from '../_lib/x-post.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,PATCH,DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'PATCH', 'DELETE'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	if (req.method === 'GET') {
		const agentFilter = new URL(req.url, 'http://x').searchParams.get('agent_id');
		if (agentFilter && !isUuid(agentFilter)) return error(res, 400, 'validation_error', 'agent_id must be a uuid');
		const rows = agentFilter
			? await sql`
				select id, trigger_id, agent_id, text, thread_parts, kind, source, source_ref, scheduled_for, reply_to_tweet_id, status, created_at
				from x_pending_reviews
				where user_id = ${user.id} and agent_id = ${agentFilter} and status = 'pending'
				order by created_at desc
				limit 50
			`
			: await sql`
				select id, trigger_id, agent_id, text, thread_parts, kind, source, source_ref, scheduled_for, reply_to_tweet_id, status, created_at
				from x_pending_reviews
				where user_id = ${user.id} and status = 'pending'
				order by created_at desc
				limit 50
			`;
		return json(res, 200, { reviews: rows });
	}

	// PATCH (approve/edit/reject) and DELETE (reject) are state-changing, so gate
	// them behind CSRF before touching the review.
	if (!(await requireCsrf(req, res, user.id))) return;

	const url = new URL(req.url, 'http://x');
	const id = url.searchParams.get('id');
	if (!id) return error(res, 400, 'validation_error', 'id required');
	// `id` addresses a uuid primary key; a junk value would reach Postgres as a
	// cast error and turn a caller mistake into a 500.
	if (!isUuid(id)) return error(res, 400, 'validation_error', 'id must be a uuid');

	// Reject: one conditional write, so a second request on the same review is a
	// clean 404 rather than a silent no-op reported as success.
	const reject = async () => {
		const done = await sql`
			update x_pending_reviews set status = 'rejected', resolved_at = now()
			where id = ${id} and user_id = ${user.id} and status = 'pending'
			returning id
		`;
		if (!done.length) return error(res, 404, 'not_found', 'review not found or already resolved');
		return json(res, 200, { rejected: id });
	};

	if (req.method === 'DELETE') return reject();

	// PATCH: approve (possibly with edits) or reject.
	const body = await readJson(req);
	const action = body?.action ?? 'approve';
	if (action === 'reject') return reject();
	if (action !== 'approve') return error(res, 400, 'validation_error', 'action must be approve or reject');

	if (body?.text !== undefined && typeof body.text !== 'string') {
		return error(res, 400, 'validation_error', 'text must be a string');
	}
	if (body?.thread_parts !== undefined) {
		if (!Array.isArray(body.thread_parts) || body.thread_parts.some((p) => typeof p !== 'string')) {
			return error(res, 400, 'validation_error', 'thread_parts must be an array of strings');
		}
	}
	const appendLink = body?.append_link === true;

	// Claim the review in the same statement that checks it is still pending. A
	// select-then-publish-then-update let two concurrent approvals of one review
	// both reach X; only the tweet-text dedup window stopped a real double post.
	const [review] = await sql`
		update x_pending_reviews set status = 'approved', resolved_at = now()
		where id = ${id} and user_id = ${user.id} and status = 'pending'
		returning id, agent_id, text, thread_parts, kind, scheduled_for, reply_to_tweet_id
	`;
	if (!review) return error(res, 404, 'not_found', 'review not found or already resolved');
	const release = () =>
		sql`update x_pending_reviews set status = 'pending', resolved_at = null where id = ${id}`.catch((e) =>
			console.error('[x-reviews] could not release review', id, e.message),
		);

	const text = typeof body?.text === 'string' ? body.text : review.text;
	const threadParts = Array.isArray(body?.thread_parts)
		? body.thread_parts
		: (Array.isArray(review.thread_parts) ? review.thread_parts : null);

	const parts = threadParts ? threadParts.map((p) => String(p).trim()).filter(Boolean) : [String(text).trim()];
	if (!parts.length || parts.some((p) => !p || p.length > MAX_TWEET_LEN)) {
		await release();
		return error(res, 400, 'validation_error', `each part must be 1 to ${MAX_TWEET_LEN} characters`);
	}

	// A draft queued with a future time is scheduled on approval, not posted now.
	if (review.scheduled_for && new Date(review.scheduled_for).getTime() > Date.now()) {
		const [row] = await sql`
			insert into x_scheduled_posts (user_id, agent_id, text, thread_parts, reply_to_tweet_id, scheduled_at, kind)
			values (${user.id}, ${review.agent_id}, ${parts[0]}, ${parts.length > 1 ? JSON.stringify(parts) : null}::jsonb,
			        ${review.reply_to_tweet_id}, ${review.scheduled_for}, ${review.kind})
			returning id, scheduled_at
		`;
		return json(res, 200, { approved: id, status: 'scheduled', scheduled_post_id: row.id, scheduled_at: row.scheduled_at });
	}

	try {
		const result = await publishTweet({
			userId: user.id,
			agentId: review.agent_id,
			kind: review.kind,
			text: parts.length > 1 ? null : parts[0],
			threadParts: parts.length > 1 ? parts : null,
			replyTo: review.reply_to_tweet_id || null,
			appendLink,
		});
		return json(res, 200, { approved: id, status: 'published', ...result });
	} catch (err) {
		// Nothing was published, so hand the review back to the queue instead of
		// leaving it marked approved with no tweet behind it.
		await release();
		if (err instanceof XPostError) return error(res, err.status, err.code, err.message, err.extra);
		console.error('[x-reviews] publish failed', err);
		return error(res, 500, 'internal_error', err.message || 'publish failed');
	}
});
