// GET /api/cron/revenue-ledger-reconcile: bring the revenue ledger up to date
// from every income source, prove it still matches those sources, verify a
// sample of mainnet transactions on-chain, announce milestones and alert owners
// to drift. Idempotent: the ledger upsert is keyed by (source, source_ref).
// Library: api/_lib/revenue-reconcile.js. Guide: docs/revenue-ledger.md.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { runReconcile } from '../_lib/revenue-reconcile.js';

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;

	const summary = await runReconcile();
	return json(res, 200, { ok: true, ...summary }, { 'cache-control': 'no-store' });
});
