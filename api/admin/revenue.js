// GET /api/admin/revenue — platform fee income aggregated across all agents.
// Admin-only. Query params: from, to (ISO-8601 dates).

import { sql } from '../_lib/db.js';
import { cors, json, method, wrap, error } from '../_lib/http.js';
import { requireAdmin } from '../_lib/admin.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;
	if (!(await requireAdmin(req, res))) return;

	const q = req.query ?? {};
	const now = new Date();
	const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

	const fromDate = q.from ? new Date(q.from) : defaultFrom;
	const toDate = q.to ? new Date(q.to) : now;

	if (isNaN(fromDate.getTime()))
		return error(res, 400, 'validation_error', 'from must be a valid ISO-8601 date');
	if (isNaN(toDate.getTime()))
		return error(res, 400, 'validation_error', 'to must be a valid ISO-8601 date');

	const [{ total_fee_collected }] = await sql`
		SELECT COALESCE(SUM(fee_amount), 0)::bigint AS total_fee_collected
		FROM agent_revenue_events
		WHERE created_at BETWEEN ${fromDate} AND ${toDate}
	`;

	const byCurrency = await sql`
		SELECT currency_mint, chain, SUM(fee_amount)::bigint AS total
		FROM agent_revenue_events
		WHERE created_at BETWEEN ${fromDate} AND ${toDate}
		GROUP BY currency_mint, chain
		ORDER BY total DESC
	`;

	const byDay = await sql`
		SELECT date_trunc('day', created_at)::date AS date,
		       SUM(fee_amount)::bigint              AS fee_total
		FROM agent_revenue_events
		WHERE created_at BETWEEN ${fromDate} AND ${toDate}
		GROUP BY 1
		ORDER BY 1
	`;

	return json(res, 200, {
		total_fee_collected: Number(total_fee_collected),
		by_currency: byCurrency.map((r) => ({
			currency_mint: r.currency_mint,
			chain: r.chain,
			total: Number(r.total),
		})),
		by_day: byDay.map((r) => ({
			date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date),
			fee_total: Number(r.fee_total),
		})),
	});
});
