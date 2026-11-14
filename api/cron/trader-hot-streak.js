// GET /api/cron/trader-hot-streak: push a trader's hot-streak milestones to
// their followers and copiers (api/_lib/hot-streak-push.js).
//
// Runs every ~5 minutes. Idempotent: trader_streak_events holds one claimed row
// per (agent, network, triggering position), so a repeated or overlapping tick
// never notifies twice. When the migration has not been applied the tick reports
// skipped_missing_tables instead of failing.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { sql } from '../_lib/db.js';
import { insertNotification } from '../_lib/notify.js';
import { runHotStreakPush } from '../_lib/hot-streak-push.js';

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;

	const result = await runHotStreakPush({ sql, notify: insertNotification, network: 'mainnet' });
	return json(res, 200, { ok: true, ...result });
});
