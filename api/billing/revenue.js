// GET /api/billing/revenue — aggregated earnings for the authenticated user's agents.
// Powers the agent owner revenue dashboard (Task 12).

import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { cors, json, method, wrap, error } from '../_lib/http.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_GRANULARITY = new Set(['day', 'week', 'month']);

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const q = req.query ?? {};

	// Parse and validate query params
	const agentId = q.agent_id ?? null;
	if (agentId !== null && !UUID_RE.test(agentId))
		return error(res, 400, 'validation_error', 'agent_id must be a UUID');

	const granularity = q.granularity ?? 'day';
	if (!VALID_GRANULARITY.has(granularity))
		return error(res, 400, 'validation_error', 'granularity must be day, week, or month');

	const now = new Date();
	const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

	const fromDate = q.from ? new Date(q.from) : defaultFrom;
	const toDate = q.to ? new Date(q.to) : now;

	if (isNaN(fromDate.getTime()))
		return error(res, 400, 'validation_error', 'from must be a valid ISO-8601 date');
	if (isNaN(toDate.getTime()))
		return error(res, 400, 'validation_error', 'to must be a valid ISO-8601 date');

	const agentFilter = agentId ? sql`AND re.agent_id = ${agentId}::uuid` : sql``;

	const [summaryRow] = await sql`
		SELECT
			COALESCE(SUM(re.gross_amount), 0)::bigint AS gross_total,
			COALESCE(SUM(re.fee_amount), 0)::bigint   AS fee_total,
			COALESCE(SUM(re.net_amount), 0)::bigint   AS net_total,
			COUNT(*)::int                             AS payment_count,
			MAX(re.currency_mint)                     AS currency_mint,
			MAX(re.chain)                             AS chain
		FROM agent_revenue_events re
		JOIN agent_identities ai ON ai.id = re.agent_id
		WHERE ai.user_id = ${user.id}
		  AND re.created_at BETWEEN ${fromDate} AND ${toDate}
		  ${agentFilter}
	`;

	const bySkill = await sql`
		SELECT
			re.skill,
			COALESCE(SUM(re.net_amount), 0)::bigint AS net_total,
			COUNT(*)::int                           AS count
		FROM agent_revenue_events re
		JOIN agent_identities ai ON ai.id = re.agent_id
		WHERE ai.user_id = ${user.id}
		  AND re.created_at BETWEEN ${fromDate} AND ${toDate}
		  ${agentFilter}
		GROUP BY re.skill
		ORDER BY net_total DESC
	`;

	const timeseries = await sql`
		SELECT
			date_trunc(${granularity}, re.created_at) AS period,
			COALESCE(SUM(re.net_amount), 0)::bigint   AS net_total,
			COUNT(*)::int                             AS count
		FROM agent_revenue_events re
		JOIN agent_identities ai ON ai.id = re.agent_id
		WHERE ai.user_id = ${user.id}
		  AND re.created_at BETWEEN ${fromDate} AND ${toDate}
		  ${agentFilter}
		GROUP BY period
		ORDER BY period
	`;

	return json(res, 200, {
		summary: {
			gross_total: Number(summaryRow.gross_total),
			fee_total: Number(summaryRow.fee_total),
			net_total: Number(summaryRow.net_total),
			currency_mint: summaryRow.currency_mint ?? null,
			chain: summaryRow.chain ?? null,
			payment_count: summaryRow.payment_count,
		},
		by_skill: bySkill.map((r) => ({
			skill: r.skill,
			net_total: Number(r.net_total),
			count: r.count,
		})),
		timeseries: timeseries.map((r) => ({
			period: r.period instanceof Date ? r.period.toISOString().slice(0, 10) : String(r.period),
			net_total: Number(r.net_total),
			count: r.count,
		})),
	});
});
