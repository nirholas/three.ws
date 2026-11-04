// GET /api/cron/event-markets-staking-reconcile: every staked pool's ledger against the chain.
//
// Syncs each pool's ledger from on-chain events, then checks the invariant
// vault == totalStaked - feePaid - paidOut and that recorded stakes and payouts equal
// the chain's. A short vault or any mismatch alerts through the ops channel. Does
// nothing when no pool exists, so it is safe to schedule before staking is switched
// on. Writes only the ledger rows the chain already proves; it never moves funds.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { sendOpsAlert } from '../_lib/alerts.js';
import { reconcileAll } from '../_lib/event-markets/staking/reconcile-all.js';

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;

	const pools = await reconcileAll();
	const bad = pools.filter((p) => !p.ok);
	if (bad.length) {
		const lines = bad.map((p) => `${p.slug || p.market_id} (${p.cluster}, ${p.token}): ${p.problems.map((x) => x.code).join(', ')}`);
		await sendOpsAlert('Staked event market reconciliation mismatch', lines.join('\n'), {
			signature: `event-markets-staking-reconcile:${bad.map((p) => p.market_id).sort().join(',')}`,
		});
	}
	return json(res, 200, { ok: bad.length === 0, pools: pools.length, mismatched: bad.length }, { 'cache-control': 'no-store' });
});
