// GET /api/x/analytics — recent posts with engagement metrics
// Optional: ?agent_id=<id> to filter

import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { cors, method, wrap, error, json } from '../_lib/http.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const url = new URL(req.url, 'http://x');
	const agentId = url.searchParams.get('agent_id');

	const rows = agentId
		? await sql`
			select id, tweet_id, text, agent_id, metrics, metrics_fetched_at, created_at
			from x_posts where user_id = ${user.id} and agent_id = ${agentId}
			order by created_at desc limit 50
		`
		: await sql`
			select id, tweet_id, text, agent_id, metrics, metrics_fetched_at, created_at
			from x_posts where user_id = ${user.id}
			order by created_at desc limit 50
		`;

	// Roll up totals.
	const totals = rows.reduce((acc, r) => {
		const m = r.metrics || {};
		acc.likes      += m.like_count || 0;
		acc.retweets   += m.retweet_count || 0;
		acc.replies    += m.reply_count || 0;
		acc.quotes     += m.quote_count || 0;
		acc.impressions += m.impression_count || 0;
		acc.posts++;
		return acc;
	}, { posts: 0, likes: 0, retweets: 0, replies: 0, quotes: 0, impressions: 0 });

	return json(res, 200, { totals, posts: rows });
});
