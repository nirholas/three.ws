// GET /api/cron/ops-alerts-digest (hourly, Cloud Scheduler)
//
// Emails the warn-level ops alerts of the last hour as ONE digest (grouped by
// title, with counts and the oldest unresolved item) instead of one email per
// alert. Critical alerts are emailed as they fire by sendOpsAlert; this run only
// covers warns, which api/_lib/alerts.js holds back from email on purpose.
//
// At most one digest per clock hour (cache key alert:digest:email:<hour>), and
// a failed send does not consume the hour, so the next tick retries. With no
// OPS_ALERT_EMAILS or RESEND_API_KEY it answers 200 with reason
// email_unconfigured; the alerts_push subsystem is where that gap is reported.

import { sendWarnDigest } from '../_lib/alerts.js';
import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';

export default wrapCron(async (req, res) => {
	if (!method(req, res, 'GET')) return;
	if (!requireCron(req, res)) return;
	const result = await sendWarnDigest();
	return json(res, 200, { ok: true, ...result });
});
