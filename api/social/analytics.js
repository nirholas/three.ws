/**
 * GET /api/social/analytics
 *
 * Post analytics with optional Pump.fun token price correlation.
 *
 * Query params:
 *   post_id      Social post DB ID (from /api/social/posts)
 *   post_url     X (Twitter) post URL for oEmbed + price correlation
 *   mint         Pump.fun token mint address for price impact correlation
 *   window_min   Price window in minutes for correlation (default 30)
 *   platform     Filter analytics by platform
 *   agent_id     Filter by agent
 *   days         Analytics window in days (default 7)
 */

import { cors, json, method, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { sql } from '../_lib/db.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: false })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.mcpIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const q = req.query || {};

	// Price correlation mode — correlate an X post URL with a Pump.fun token
	if (q.post_url && q.mint) {
		const { correlateXPost } = await import('../../src/social/x-post-impact.js');
		try {
			const result = await correlateXPost({
				postUrl: q.post_url,
				mint: q.mint,
				windowMin: parseInt(q.window_min || '30', 10),
			});
			return json(res, 200, {
				type: 'price_correlation',
				post_url: q.post_url,
				mint: q.mint,
				...result,
				summary: buildCorrelationSummary(result),
			});
		} catch (err) {
			return error(res, 502, 'correlation_failed', err.message);
		}
	}

	// Single post analytics
	if (q.post_id) {
		const [row] = await sql`
			select id, platform, content, status, platform_post_id, platform_url,
				   created_at, published_at, agent_id
			from social_posts where id = ${q.post_id}
		`;
		if (!row) return error(res, 404, 'not_found', 'post not found');

		// Fetch live engagement from X if applicable
		let engagement = null;
		if (row.platform === 'x' && row.platform_post_id) {
			engagement = await fetchXEngagement(row.platform_post_id);
		}

		return json(res, 200, {
			type: 'post',
			post: {
				id: row.id,
				platform: row.platform,
				status: row.status,
				url: row.platform_url,
				published_at: row.published_at,
			},
			engagement,
		});
	}

	// Aggregate analytics — post counts by platform + status over time
	const days = Math.min(parseInt(q.days || '7', 10) || 7, 90);
	const platform = ['x', 'farcaster', 'reddit'].includes(q.platform) ? q.platform : null;
	const agentId = typeof q.agent_id === 'string' ? q.agent_id : null;

	const rows = await sql`
		select
			platform,
			status,
			count(*)::int as count,
			date_trunc('day', coalesce(published_at, created_at)) as day
		from social_posts
		where
			created_at >= now() - (${days} || ' days')::interval
			and (${platform}::text is null or platform = ${platform})
			and (${agentId}::text is null or agent_id = ${agentId})
		group by platform, status, day
		order by day desc, platform, status
	`;

	const summary = await sql`
		select
			platform,
			count(*) filter (where status = 'published')::int as published,
			count(*) filter (where status = 'scheduled')::int as scheduled,
			count(*) filter (where status = 'failed')::int as failed
		from social_posts
		where
			created_at >= now() - (${days} || ' days')::interval
			and (${platform}::text is null or platform = ${platform})
			and (${agentId}::text is null or agent_id = ${agentId})
		group by platform
	`;

	return json(res, 200, {
		type: 'aggregate',
		window_days: days,
		summary,
		daily: rows,
	});
});

function buildCorrelationSummary({ deltaPct, deltaVolPct, post }) {
	if (deltaPct === null) return 'insufficient price data';
	const dir = deltaPct > 0 ? 'up' : deltaPct < 0 ? 'down' : 'unchanged';
	const pct = Math.abs(deltaPct).toFixed(2);
	const vol = deltaVolPct !== null ? ` Volume ${deltaVolPct > 0 ? '+' : ''}${deltaVolPct.toFixed(2)}%.` : '';
	return `Price ${dir} ${pct}% in the 30-minute window after${post?.author ? ` @${post.author}'s` : ''} post.${vol}`;
}

async function fetchXEngagement(tweetId) {
	const bearer = process.env.X_API_BEARER;
	if (!bearer) return null;
	try {
		const resp = await fetch(
			`https://api.twitter.com/2/tweets/${tweetId}?tweet.fields=public_metrics`,
			{ headers: { Authorization: `Bearer ${bearer}` } },
		);
		if (!resp.ok) return null;
		const data = await resp.json();
		return data?.data?.public_metrics || null;
	} catch {
		return null;
	}
}
