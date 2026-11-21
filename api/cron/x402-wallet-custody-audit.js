// api/cron/x402-wallet-custody-audit.js
//
// Daily custody and data sweep for the x402 loop.
//
// 1. Wallet custody: decrypt both key copies of every loop wallet (payer pool
//    and fresh one-shot wallets), prove each opens to its row's pubkey, backfill
//    the Cloud KMS backup copy for wallets minted before it existed, and page
//    ops on any wallet whose key no longer opens. See
//    api/_lib/x402/wallet-custody.js.
// 2. Paid-data spool: replay every paid response that was spooled to object
//    storage while the database refused it, so the bought data lands in
//    x402_paid_responses. See drainPaidSpool in api/_lib/x402/paid-responses.js.
//
// Alerts carry pubkeys only, never key material. The same work runs by hand with
// `npm run x402:wallet-custody` and `npm run x402:paid-data -- ingest-spool`.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { sendOpsAlert } from '../_lib/alerts.js';
import { sql } from '../_lib/db.js';
import { ensurePoolSchema } from '../_lib/x402/pool.js';
import { ensureFreshSchema } from '../_lib/x402/fresh-workers/wallets.js';
import { auditWalletCustody, custodyNeedsAttention } from '../_lib/x402/wallet-custody.js';
import { drainPaidSpool, ensurePaidResponsesSchema } from '../_lib/x402/paid-responses.js';

const LIST_LIMIT = 20;
// The function limit is 120s (vercel.json). The audit gets 80s, leaving the
// spool drain and the response room; whatever it does not reach leads tomorrow.
const CUSTODY_BUDGET_MS = 80_000;

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;

	const custody = await runCustody();
	const spool = await runSpool();
	return json(res, 200, { ok: !custody.error && !spool.error, custody, spool });
});

async function runCustody() {
	try {
		await ensurePoolSchema(sql);
		await ensureFreshSchema(sql);
		const report = await auditWalletCustody({ sql, limit: 2000, deadlineAt: Date.now() + CUSTODY_BUDGET_MS });
		if (custodyNeedsAttention(report)) await alertCustody(report);
		return report;
	} catch (err) {
		const message = String(err?.message || err).slice(0, 300);
		await sendOpsAlert('x402 wallet custody audit could not run', `The daily key audit failed before finishing: ${message}`, { signature: 'x402-wallet-custody:audit-failed' });
		return { error: message };
	}
}

const listed = (rows) => rows.slice(0, LIST_LIMIT).map((r) => `${r.table}:${r.pubkey} (${r.primary ?? r.backup}${r.backup && r.primary ? `/${r.backup}` : ''})`).join(', ')
	+ (rows.length > LIST_LIMIT ? `, and ${rows.length - LIST_LIMIT} more` : '');

const reasons = (rows) => {
	const distinct = [...new Set(rows.map((r) => r.error).filter(Boolean))].slice(0, 3);
	return distinct.length ? `Reason: ${distinct.join(' | ')}. ` : '';
};

async function alertCustody(report) {
	if (report.unrecoverable.length) {
		await sendOpsAlert(
			`x402 custody: ${report.unrecoverable.length} wallet key(s) open from neither copy`,
			`These loop wallets cannot be signed for. Do not send value to them. ${listed(report.unrecoverable)}. ` +
			'Check WALLET_ENCRYPTION_KEY against x402_wallet_key_history and the KMS key in X402_WALLET_BACKUP_KMS_KEY.',
			{ signature: 'x402-wallet-custody:unrecoverable' },
		);
	}
	if (report.primary_broken.length) {
		await sendOpsAlert(
			`x402 custody: ${report.primary_broken.length} wallet(s) open only from the KMS backup`,
			`The primary copy no longer opens (WALLET_ENCRYPTION_KEY changed?); signing still works from the backup. ${listed(report.primary_broken)}. ` +
			'Restore the env key, or if it was rotated on purpose re-seal from the backup with `npm run x402:wallet-custody -- --prod-env --reseal-primary`.',
			{ signature: 'x402-wallet-custody:primary-broken' },
		);
	}
	if (report.backup_broken.length) {
		await sendOpsAlert(
			`x402 custody: ${report.backup_broken.length} wallet backup copy fault(s)`,
			`The KMS backup is wrong, unopenable, or could not be written. ${listed(report.backup_broken)}. ` +
			`${reasons(report.backup_broken)}` +
			'Check that the runtime service account holds cloudkms.cryptoKeyEncrypterDecrypter on X402_WALLET_BACKUP_KMS_KEY.',
			{ signature: 'x402-wallet-custody:backup-broken' },
		);
	}
	if (report.backup_key_configured && report.missing_backup > 0 && !report.backup_broken.length) {
		await sendOpsAlert(
			`x402 custody: ${report.missing_backup} wallet(s) still have one key copy`,
			'The backfill did not reach them this run. Run `npm run x402:wallet-custody -- --prod-env --backfill` to finish it.',
			{ signature: 'x402-wallet-custody:missing-backup' },
		);
	}
}

async function runSpool() {
	try {
		await ensurePaidResponsesSchema(sql);
		const out = await drainPaidSpool({ sql, limit: 500 });
		if (out.failed.length) {
			await sendOpsAlert(
				`x402 paid data: ${out.failed.length} spooled response(s) would not ingest`,
				`They stay in object storage untouched. First: ${out.failed.slice(0, 5).map((f) => `${f.key} (${f.error})`).join('; ')}. ` +
				'Inspect with `npm run x402:paid-data -- ingest-spool --prod-env`.',
				{ signature: 'x402-paid-data:spool-failed' },
			);
		}
		return out;
	} catch (err) {
		return { error: String(err?.message || err).slice(0, 300) };
	}
}
