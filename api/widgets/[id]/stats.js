/**
 * GET /api/widgets/:id/stats
 * --------------------------
 * Owner-only. Returns aggregate analytics for the widget:
 *   {
 *     view_count:     <bigint cumulative>,
 *     last_viewed_at: <iso|null>,
 *     recent_views_7d:[ { day, count }, … 8 entries ascending — UTC ],
 *     top_referers:   [ { host, count }, … up to 5 ],
 *     top_countries:  [ { country, count }, … up to 5 ],
 *     chat_count:     <int|null>            // best-effort, null when unsupported
 *   }
 *
 * Best-effort throughout: missing widget_views or chat tables don't 500 — they
 * return zero/empty arrays so the dashboard's sparkline can still render an
 * "all-zero" state without special casing.
 */

import { sql }                            from '../../_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer, hasScope } from '../../_lib/auth.js';
import { cors, json, method, wrap, error } from '../../_lib/http.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const id = idFromReq(req);
	if (!id) return error(res, 400, 'invalid_request', 'id required');

	const auth = await resolveAuth(req);
	if (!auth?.userId) return error(res, 401, 'unauthorized', 'authentication required');
	if (auth.source === 'oauth' || auth.source === 'apikey') {
		if (!hasScope(auth.scope, 'avatars:read')) return error(res, 403, 'insufficient_scope', 'avatars:read required');
	}

	// Ownership check — never 404 vs 403 leak: collapse to 404 either way.
	const [w] = await sql`
		select id, type, view_count
		from widgets
		where id = ${id} and user_id = ${auth.userId} and deleted_at is null
		limit 1
	`;
	if (!w) return error(res, 404, 'not_found', 'widget not found or not yours');

	const [recentViews, topReferers, topCountries, lastViewed, chatCount] = await Promise.all([
		recentViewsByDay(id),
		topAggregates(id, 'referer_host'),
		topAggregates(id, 'country'),
		lastViewedAt(id),
		chatCountFor(id, w.type),
	]);

	res.setHeader('cache-control', 'private, max-age=30');
	return json(res, 200, {
		stats: {
			view_count:      Number(w.view_count || 0),
			last_viewed_at:  lastViewed,
			recent_views_7d: recentViews,
			top_referers:    topReferers,
			top_countries:   topCountries,
			chat_count:      chatCount,
		},
	});
});

async function recentViewsByDay(id) {
	// Always return 8 days (today + previous 7) so the sparkline doesn't have
	// to reason about gaps. 0-fill missing days from the actual rows.
	const days = [];
	const today = startOfUtcDay(new Date());
	for (let i = 7; i >= 0; i--) {
		const d = new Date(today.getTime() - i * 86400_000);
		days.push({ day: d.toISOString().slice(0, 10), count: 0 });
	}
	try {
		const rows = await sql`
			select date_trunc('day', created_at)::date::text as day, count(*)::bigint as count
			from widget_views
			where widget_id = ${id} and created_at >= ${days[0].day}::date
			group by 1 order by 1
		`;
		const idx = new Map(days.map((d, i) => [d.day, i]));
		for (const r of rows) {
			const i = idx.get(r.day);
			if (i !== undefined) days[i].count = Number(r.count);
		}
	} catch (err) {
		if (!/relation .* does not exist/i.test(err?.message || '')) throw err;
	}
	return days;
}

async function topAggregates(id, column) {
	try {
		const rows = await sql.query(
			`select coalesce(${column}, '') as key, count(*)::bigint as count
			 from widget_views
			 where widget_id = $1 and ${column} is not null
			 group by 1 order by count desc limit 5`,
			[id],
		);
		return rows.map((r) => ({ [column === 'referer_host' ? 'host' : 'country']: r.key, count: Number(r.count) }));
	} catch (err) {
		if (/relation .* does not exist/i.test(err?.message || '')) return [];
		throw err;
	}
}

async function lastViewedAt(id) {
	try {
		const rows = await sql`select max(created_at) as t from widget_views where widget_id = ${id}`;
		return rows[0]?.t || null;
	} catch (err) {
		if (/relation .* does not exist/i.test(err?.message || '')) return null;
		throw err;
	}
}

// Talking-agent widget chats live in agent_actions (Prompt 03 will wire this).
// Until that table-or-source is finalized, return null so the UI knows to hide
// the chat stat line for non-talking-agent types and for un-instrumented ones.
async function chatCountFor(_id, type) {
	if (type !== 'talking-agent') return null;
	return null;
}

function startOfUtcDay(d) {
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function idFromReq(req) {
	const fromQuery = req.query?.id;
	if (typeof fromQuery === 'string' && fromQuery) return fromQuery;
	const path = new URL(req.url, 'http://x').pathname;
	const m = path.match(/\/api\/widgets\/([^/]+)\/stats/);
	return m ? decodeURIComponent(m[1]) : null;
}

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id, source: 'session', scope: 'avatars:read avatars:write' };
	return await authenticateBearer(extractBearer(req));
}
