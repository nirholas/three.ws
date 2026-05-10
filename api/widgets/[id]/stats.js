/**
 * Widget stats — GET /api/widgets/:id/stats
 * Owner-only analytics: view counts, referrers, countries, last viewed.
 */

import { sql } from '../../_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer, hasScope } from '../../_lib/auth.js';
import { cors, error, json, method, wrap } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) {
		return { userId: session.id, source: 'session', scope: 'avatars:read avatars:write' };
	}
	return authenticateBearer(extractBearer(req));
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');
	if (!hasScope(auth.scope, 'avatars:read')) return error(res, 403, 'insufficient_scope', 'avatars:read required');

	const rl = await limits.widgetRead(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url = new URL(req.url, 'http://x');
	const parts = url.pathname.split('/').filter(Boolean);
	const id = url.searchParams.get('id') || parts[2];

	const [widget] = await sql`
		SELECT id, type, view_count FROM widgets
		WHERE id = ${id} AND user_id = ${auth.userId} AND deleted_at IS NULL
	`;
	if (!widget) return error(res, 404, 'not_found', 'widget not found');

	// Build 8-day window (today + 7 days back)
	const today = new Date();
	const days = Array.from({ length: 8 }, (_, i) => {
		const d = new Date(today);
		d.setDate(d.getDate() - (7 - i));
		return d.toISOString().slice(0, 10);
	});

	const [recentRows, refererRows, countryRows, lastViewedRow] = await Promise.all([
		sql`SELECT date::text, count::int FROM widget_views WHERE widget_id = ${id} AND date >= NOW() - INTERVAL '7 days' ORDER BY date`.catch(() => []),
		sql`SELECT referer, count::int FROM widget_referers WHERE widget_id = ${id} ORDER BY count DESC LIMIT 10`.catch(() => []),
		sql`SELECT country, count::int FROM widget_countries WHERE widget_id = ${id} ORDER BY count DESC LIMIT 10`.catch(() => []),
		sql`SELECT MAX(viewed_at) AS last_viewed FROM widget_view_log WHERE widget_id = ${id}`.catch(() => []),
	]);

	const viewMap = Object.fromEntries((recentRows || []).map(r => [r.date, r.count]));
	const recent_views_7d = days.map(date => ({ date, count: viewMap[date] ?? 0 }));

	return json(res, 200, {
		stats: {
			view_count: widget.view_count ?? 0,
			recent_views_7d,
			top_referers: refererRows || [],
			top_countries: countryRows || [],
			last_viewed_at: lastViewedRow?.[0]?.last_viewed ?? null,
			chat_count: null,
		},
	});
});
