// GET /api/cron/event-markets-open: opens a market for every event that has none.
//
// Reads the event sources (api/_lib/event-markets/sources/), opens "Who wins X?" with
// the entrants as outcomes, tops up pre-lock markets with late entrants, and logs
// every event it declined to market in event_market_skips. Idempotent: a second tick
// changes nothing. Points only: nothing here can move a token or touch a wallet.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { runAutoOpen } from '../_lib/event-markets/auto-open.js';

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;

	const report = await runAutoOpen();
	return json(res, 200, { ok: report.errors.length === 0, ...report });
});
