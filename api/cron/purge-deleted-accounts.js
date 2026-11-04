// @ts-check
// GET /api/cron/purge-deleted-accounts: the permanent half of account deletion.
//
// DELETE /api/auth/me soft-deletes an account. The privacy policy (section 5)
// promises the account is permanently purged 30 days later. This daily tick
// runs api/_lib/account-purge.js over every account past that window: object
// storage first, then the rows in one transaction, then a non-identifying
// receipt in account_purge_log. An account that fails stays soft-deleted, is
// recorded in account_purge_failures, and is retried on the next tick.
//
// The response and the ops alert carry counts and hashed references only,
// never an email, wallet, username or raw user id.
//
// Not gated on write capacity: a purge frees storage, so it should still run
// when the database is near its cap.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { sendOpsAlert } from '../_lib/alerts.js';
import { purgeDeletedAccounts, PURGE_AFTER_DAYS } from '../_lib/account-purge.js';

// wrapCron allows 120s; stop starting new accounts well before that.
const BUDGET_MS = 90_000;
const BATCH = 25;

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;

	const result = await purgeDeletedAccounts({ olderThanDays: PURGE_AFTER_DAYS, limit: BATCH, budgetMs: BUDGET_MS });

	if (result.failed.length) {
		const byCode = {};
		for (const f of result.failed) byCode[f.code] = (byCode[f.code] || 0) + 1;
		await sendOpsAlert(
			'Account purge: some deleted accounts could not be purged',
			`${result.failed.length} of ${result.scanned} failed and stay queued for retry. ` +
				Object.entries(byCode)
					.map(([code, n]) => `${code} x${n}`)
					.join(', '),
			{ signature: `account-purge:${Object.keys(byCode).sort().join(',')}` },
		);
	}

	return json(res, 200, {
		ok: result.failed.length === 0,
		scanned: result.scanned,
		purged: result.purged,
		deferred: result.deferred,
		r2_objects: result.r2_objects,
		failed: result.failed,
	});
});
