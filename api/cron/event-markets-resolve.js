// GET /api/cron/event-markets-resolve: locks markets at locks_at and settles them
// from our own data at resolves_at.
//
// Each tick locks due markets, asks each due market's resolver for a result, writes
// the winner and the evidence it read in one statement, retries markets whose source
// is not ready, and voids (refunding every pick) on a tie, no data, a cancelled
// event or the documented timeout. Then it runs the rollup so settled picks are
// scored straight away. Idempotent: a second tick over resolved markets changes
// nothing. Points only: nothing here can move a token or touch a wallet.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { tickMarkets } from '../_lib/event-markets/lifecycle.js';
import { runRollup } from '../_lib/event-markets/rollup.js';

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;

	const report = await tickMarkets();
	let rollup = null;
	if (report.resolved.length || report.voided.length) {
		try {
			rollup = await runRollup();
		} catch (err) {
			report.errors.push(`rollup: ${err?.message || err}`);
		}
	}
	return json(res, 200, { ok: report.errors.length === 0, ...report, rollup }, { 'cache-control': 'no-store' });
});
