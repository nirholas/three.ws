// GET /api/cron/forge-paid-make-whole: refund prepaid credits for paid Forge
// High generations that failed after the submit was charged.
//
// The submit debits credits immediately before dispatch and refunds them in the
// same request only when that response is an error. A job that was dispatched
// (200) and failed later, on the poll path or when the finalize cron timed it out
// after a restart, kept the spend. The submit now binds each spend to its
// creation row (api/_lib/forge-paid-generation.js), and this cron refunds every
// spend whose last attempt failed more than ten minutes ago, under the same
// idempotency key the in-request refund uses, so no spend is ever refunded twice.
//
// $THREE pay-per-use needs no cron: the same proof is honored as a free retry
// once its job failed (api/_lib/forge-high-payment.js).
//
// Auth: the shared, fail-closed cron gate (api/_lib/cron-auth.js).

import { cors, json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { reconcilePaidCreditGenerations } from '../_lib/forge-paid-generation.js';

export default wrapCron(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;

	const out = await reconcilePaidCreditGenerations();
	return json(res, 200, { ok: true, ...out });
});
