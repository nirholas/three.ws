// GET /api/cron/duels-tick: the trader-duels loop (api/_lib/trader-duels.js).
//
// Each tick voids duels whose trader went private or was deleted (refunding
// every call), resolves duels whose window closed more than the grace period
// ago from the realized P&L ledger, settles any call a crashed tick left open,
// and opens duels for the next windows from the rivalry engine. Points only:
// nothing here can move a token or touch a wallet.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { runDuelsTick } from '../_lib/trader-duels.js';

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;

	const result = await runDuelsTick({ network: 'mainnet' });
	return json(res, 200, { ok: true, ...result });
});
