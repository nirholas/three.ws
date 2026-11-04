// @ts-check
// GET /api/cron/growth-payouts: the $THREE payout leg of the first-rug softener
// and the early-leader program (docs/growth-programs.md).
//
// Each tick enrolls newly qualified early leaders and pays each program's queue
// within its rolling cap, but only for a program whose arm flag
// (RUG_SOFTENER_ENABLED, EARLY_LEADER_ENABLED) is exactly "1"/"true". Disarmed,
// the tick is a dry run: it reports the queue, the cap headroom, and who would
// be enrolled, and changes nothing.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { payoutsPaused } from '../_lib/payout-kill-switch.js';
import { runPayoutPrograms } from '../_lib/growth-programs/index.js';

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;

	if (await payoutsPaused()) return json(res, 200, { ok: true, paused: true, reason: 'payouts_paused' });

	const result = await runPayoutPrograms();
	return json(res, 200, { ok: true, ...result });
});
