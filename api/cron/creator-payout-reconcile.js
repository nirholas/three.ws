// @ts-check
// GET/POST /api/cron/creator-payout-reconcile: check our creator-payout records
// against the chain and alert on drift (every three hours, Cloud Scheduler).
// Read-only on the chain; the checks are in reconcilePayouts().
//
// Response: { ok, checked: { stuck_batches, sent_signatures, vaults }, drift[] }.
//
// Auth: CRON_SECRET Bearer (same gate as every cron endpoint).

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { reconcilePayouts } from '../_lib/creator-payouts.js';

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;
	const out = await reconcilePayouts();
	return json(res, 200, out);
});
