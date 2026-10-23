// @ts-check
// GET/POST /api/cron/creator-payout-distribute: record each new creator-fee
// claim's creator share and send what can be sent to the registered payout
// wallets (hourly, Cloud Scheduler). The rules live in api/_lib/creator-payouts.js.
//
// Sending is off until the operator sets CREATOR_PAYOUTS_LIVE=true; until then
// every share is recorded and held with the reason 'payouts_paused', so the
// earnings page is accurate and enabling it later sends the backlog.
//
// Response: { ok, live, ingested, agents, sent_batches, sent_sol, held_agents, failed[], promoted }.
//
// Auth: CRON_SECRET Bearer (same gate as every cron endpoint).

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { runDistribution, payoutsLive } from '../_lib/creator-payouts.js';

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;
	const out = await runDistribution();
	return json(res, 200, { ok: true, live: payoutsLive(), ...out });
});
