// GET /api/cron/revenue-reinvest: run every active, owner-confirmed reinvest
// rule for its last complete period, and settle legs that were waiting on an
// approval. Idempotent: one live run per (rule, period) and one idempotency key
// per leg, so overlapping ticks never send twice.
// Library: api/_lib/revenue-reinvest.js. Guide: docs/revenue-ledger.md.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { runDueRules } from '../_lib/revenue-reinvest.js';

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;

	const summary = await runDueRules();
	return json(res, 200, { ok: true, ...summary }, { 'cache-control': 'no-store' });
});
