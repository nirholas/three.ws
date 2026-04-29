// GET /api/admin/pump-cron-health
//
// Aggregates last-run status / errors across the four pump-related cron tables
// so silent breakage (RPC throttling, SDK API drift) is visible. Auth: session
// + admin plan, OR `Bearer $CRON_SECRET` for monitoring scrapers.

import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { cors, json, method, wrap, error } from '../_lib/http.js';
import { env } from '../_lib/env.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const auth = req.headers.authorization || '';
	const isCron = env.CRON_SECRET && auth === `Bearer ${env.CRON_SECRET}`;
	const user = isCron ? null : await getSessionUser(req);
	if (!isCron) {
		if (!user) return error(res, 401, 'unauthorized', 'sign in required');
		if (user.plan !== 'admin') return error(res, 403, 'forbidden', 'admin only');
	}

	const [distribute, buyback, stats, trades] = await Promise.all([
		sql`
			select count(*)::int as runs_24h,
			       count(*) filter (where status='confirmed')::int as confirmed_24h,
			       count(*) filter (where status='failed')::int as failed_24h,
			       max(created_at) as last_run,
			       (array_agg(error order by created_at desc) filter (where error is not null))[1] as last_error
			from pump_distribute_runs where created_at > now() - interval '24 hours'
		`.catch(() => [{}]),
		sql`
			select count(*)::int as runs_24h,
			       count(*) filter (where status='confirmed')::int as confirmed_24h,
			       count(*) filter (where status='failed')::int as failed_24h,
			       max(created_at) as last_run,
			       (array_agg(error order by created_at desc) filter (where error is not null))[1] as last_error
			from pump_buyback_runs where created_at > now() - interval '24 hours'
		`.catch(() => [{}]),
		sql`
			select count(*)::int as tracked_mints,
			       count(*) filter (where graduated)::int as graduated,
			       count(*) filter (where error is not null)::int as errored,
			       max(refreshed_at) as last_refresh,
			       (array_agg(error order by refreshed_at desc) filter (where error is not null))[1] as last_error
			from pump_agent_stats
		`.catch(() => [{}]),
		sql`
			select count(*)::int as trades_24h,
			       count(*) filter (where direction='buy')::int as buys_24h,
			       count(*) filter (where direction='sell')::int as sells_24h,
			       max(created_at) as last_trade
			from pump_agent_trades where created_at > now() - interval '24 hours'
		`.catch(() => [{}]),
	]);

	const health = {
		distribute_payments: distribute[0] || {},
		buyback: buyback[0] || {},
		agent_stats: stats[0] || {},
		trades: trades[0] || {},
		now: new Date().toISOString(),
	};

	// Liveness threshold: stats cron should run every 10 min.
	const lastRefresh = stats[0]?.last_refresh ? new Date(stats[0].last_refresh).getTime() : 0;
	health.warnings = [];
	if (lastRefresh && Date.now() - lastRefresh > 30 * 60 * 1000) {
		health.warnings.push('pump-agent-stats cron stale (>30 min)');
	}
	if ((stats[0]?.errored || 0) > 0) {
		health.warnings.push(`${stats[0].errored} mints failed last snapshot`);
	}

	return json(res, 200, health);
});
