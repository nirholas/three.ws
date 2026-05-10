/**
 * GET  /api/social/posts/:id  — fetch a single post record
 * DELETE /api/social/posts/:id — cancel a scheduled post (cannot delete published)
 */

import { cors, json, method, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { sql } from '../_lib/db.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,DELETE,OPTIONS', credentials: false })) return;

	const rl = await limits.mcpIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const id = req.query?.id;
	if (!id || typeof id !== 'string') return error(res, 400, 'missing_id', 'post id required');

	if (req.method === 'GET') {
		const [row] = await sql`
			select id, platform, content, media_urls, reply_to, settings,
				   schedule_at, status, platform_post_id, platform_url,
				   error_message, agent_id, created_at, published_at
			from social_posts where id = ${id}
		`;
		if (!row) return error(res, 404, 'not_found', 'post not found');
		return json(res, 200, sanitize(row));
	}

	if (req.method === 'DELETE') {
		const [row] = await sql`
			select id, status from social_posts where id = ${id}
		`;
		if (!row) return error(res, 404, 'not_found', 'post not found');
		if (row.status === 'published') {
			return error(res, 409, 'already_published', 'published posts cannot be deleted');
		}
		if (row.status === 'cancelled') {
			return error(res, 409, 'already_cancelled', 'post is already cancelled');
		}

		await sql`
			update social_posts set status = 'cancelled'
			where id = ${id} and status in ('pending', 'scheduled')
		`;
		return json(res, 200, { ok: true, id, status: 'cancelled' });
	}

	return error(res, 405, 'method_not_allowed', 'use GET or DELETE');
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
