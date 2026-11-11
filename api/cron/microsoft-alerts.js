// GET /api/cron/microsoft-alerts (every 5 minutes, Cloud Scheduler)
//
// Checks the Microsoft surfaces for an unacknowledged webhook operation, any
// metering rejection, a Power Platform connector error rate over
// MS_ALERT_CONNECTOR_ERROR_RATE (default 0.05 over MS_ALERT_CONNECTOR_MIN_CALLS,
// default 20, calls in the last hour) and Teams bot 5xx. Each incident sends one
// message through sendOpsAlert and is tracked in microsoft_alert_incidents until
// it clears. Logic and dedup: api/_lib/microsoft-alerts.js. Runbook:
// docs/ops/microsoft-dashboard.md.
//
// Once a day (the 04:00 UTC tick) it also prunes microsoft_surface_events older
// than 180 days; the board reads 30 days at most.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { sql } from '../_lib/db.js';
import { runMicrosoftAlerts } from '../_lib/microsoft-alerts.js';

export const SURFACE_RETENTION_DAYS = 180;

export default wrapCron(async (req, res) => {
	if (!method(req, res, 'GET')) return;
	if (!requireCron(req, res)) return;
	const now = Date.now();
	const result = await runMicrosoftAlerts({ now });
	let pruned = null;
	const d = new Date(now);
	if (d.getUTCHours() === 4 && d.getUTCMinutes() < 5) {
		const rows = await sql`
			delete from microsoft_surface_events
			where created_at < now() - make_interval(days => ${SURFACE_RETENTION_DAYS})
			returning id
		`;
		pruned = rows.length;
	}
	return json(res, 200, { ok: true, ...result, pruned });
});
