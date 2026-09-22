// GET/POST /api/cron/marketplace-escrow-sweep: the whole-agent marketplace's
// background tick (Cloud Scheduler, every 2 minutes).
//
// Refunds rejected, withdrawn and expired bids from escrow, expires listings
// past their end time, records connected-wallet escrow transfers that landed
// after the bidder closed the tab, resumes any settlement a crashed worker left
// mid-way, and closes empty escrow token accounts. Every stage is bounded and
// idempotent (api/_lib/agent-market/sweep.js), so an overlapping tick is safe.
//
// Auth: the shared, fail-closed cron gate (api/_lib/cron-auth.js).

import { cors, json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { runMarketplaceSweep } from '../_lib/agent-market/sweep.js';

export const maxDuration = 300;

export default wrapCron(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;

	const t0 = Date.now();
	const summary = await runMarketplaceSweep();
	if (summary.errors.length) console.warn('[marketplace-escrow-sweep] errors', JSON.stringify(summary.errors).slice(0, 2000));
	return json(res, 200, { ok: true, ms: Date.now() - t0, ...summary });
});
