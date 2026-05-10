/**
 * GET /api/social/posts
 *
 * List social media posts (scheduled + published + failed).
 *
 * Query params:
 *   status    filter by status: scheduled | published | failed | pending (default: all)
 *   platform  filter by platform: x | farcaster | reddit
 *   agent_id  filter by agent
 *   limit     max results (default 50, max 200)
 *   offset    pagination offset (default 0)
 *
 * Response:
 *   { posts: [...], total: number, limit, offset }
 */

import { cors, json, method, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { sql } from '../_lib/db.js';

const VALID_STATUSES = new Set(['pending', 'scheduled', 'published', 'failed', 'cancelled']);
const VALID_PLATFORMS = new Set(['x', 'farcaster', 'reddit']);

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: false })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.mcpIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const q = req.query || {};
	const status = VALID_STATUSES.has(q.status) ? q.status : null;
	const platform = VALID_PLATFORMS.has(q.platform) ? q.platform : null;
	const agentId = typeof q.agent_id === 'string' ? q.agent_id : null;
	const limit = Math.min(parseInt(q.limit || '50', 10) || 50, 200);
	const offset = Math.max(parseInt(q.offset || '0', 10) || 0, 0);

	const rows = await sql`
		select
			id, platform, content, media_urls, reply_to, settings,
			schedule_at, status, platform_post_id, platform_url,
			error_message, agent_id, created_at, published_at
		from social_posts
		where
			(${status}::text is null or status = ${status})
			and (${platform}::text is null or platform = ${platform})
			and (${agentId}::text is null or agent_id = ${agentId})
		order by
			case when status = 'scheduled' then schedule_at end asc nulls last,
			created_at desc
		limit ${limit}
		offset ${offset}
	`;

	const [{ count }] = await sql`
		select count(*)::int as count
		from social_posts
		where
			(${status}::text is null or status = ${status})
			and (${platform}::text is null or platform = ${platform})
			and (${agentId}::text is null or agent_id = ${agentId})
	`;

	return json(res, 200, {
		posts: rows.map(sanitize),
		total: count,
		limit,
		offset,
	});
});

function sanitize(row) {
	return {
		id: row.id,
		platform: row.platform,
		content: row.content,
		media_urls: row.media_urls || [],
		reply_to: row.reply_to || null,
		settings: row.settings || {},
		schedule_at: row.schedule_at || null,
		status: row.status,
		platform_post_id: row.platform_post_id || null,
		url: row.platform_url || null,
		error: row.error_message || null,
		agent_id: row.agent_id || null,
		created_at: row.created_at,
		published_at: row.published_at || null,
	};
}
