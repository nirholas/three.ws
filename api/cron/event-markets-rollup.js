// GET /api/cron/event-markets-rollup: settles resolved Event Markets into the
// scoring ledger, refreshes per-account stats and ranks, awards pick badges,
// and (for ended seasons) awards season badges and proposes the reward table.
// Idempotent: rerunning with nothing new writes nothing. It never pays anyone;
// payout proposals wait for the owner (scripts/event-markets-season-payouts.mjs).

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { runRollup } from '../_lib/event-markets/rollup.js';

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;
	const full = new URL(req.url, 'http://x').searchParams.get('full') === '1';
	const result = await runRollup({ full });
	return json(res, 200, { ok: true, ...result });
});
