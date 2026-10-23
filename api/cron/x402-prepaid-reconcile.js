// GET /api/cron/x402-prepaid-reconcile: nightly prepaid ledger integrity check.
//
// Deposits - debits - balances, batches vs the debits they claim, and settled vs
// confirmed batches must all be zero; no reservation may be stale and no batch
// stuck. Anything else alerts through the ops channel. Read-only.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { sendOpsAlert } from '../_lib/alerts.js';
import { isLedgerUnavailable } from '../_lib/x402/prepaid-ledger.js';
import { reconcileReport } from '../_lib/x402/prepaid-reconcile.js';

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;

	let report;
	try {
		report = await reconcileReport({ checkChain: true });
	} catch (err) {
		if (isLedgerUnavailable(err)) {
			return json(res, 200, { ok: true, skipped: 'prepaid ledger migration not applied' });
		}
		throw err;
	}
	if (!report.ok) {
		await sendOpsAlert('x402 prepaid ledger out of balance', report.lines.join('\n'), {
			signature: `x402-prepaid-reconcile:${report.problems.join(',')}`,
		});
	}
	return json(res, 200, { ok: report.ok, problems: report.problems, ...report.summary });
});
