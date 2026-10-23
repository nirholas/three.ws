// GET /api/cron/x402-prepaid-settle: one prepaid settlement window.
//
// Refunds reservations left behind by dead requests, then pays every seller whose
// committed prepaid debits clear the floor in ONE on-chain transaction. Moving
// real USDC is gated on the owner: unless X402_PREPAID_SETTLE_LIVE=1 this only
// plans the window and reports what it WOULD settle.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { sendOpsAlert } from '../_lib/alerts.js';
import { sweepStaleReservations } from '../_lib/x402/prepaid-ledger.js';
import { runSettlementWindow, settleConfig } from '../_lib/x402/prepaid-settle.js';
import { loadSettler, sendBatchTransfers } from '../_lib/x402/prepaid-chain.js';

const usd = (atomics) => (Number(atomics) / 1e6).toFixed(6);

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;

	const cfg = settleConfig();
	const refundedStale = await sweepStaleReservations();

	const settlerReady = cfg.live ? Boolean(await loadSettler()) : false;
	const dryRun = !cfg.live || !settlerReady;
	const out = await runSettlementWindow({
		send: sendBatchTransfers,
		minSettleAtomics: cfg.minSettleAtomics,
		maxPayeesPerTx: cfg.maxPayeesPerTx,
		dryRun,
	});

	if (cfg.live && !settlerReady) {
		await sendOpsAlert(
			'x402 prepaid settle blocked',
			'X402_PREPAID_SETTLE_LIVE=1 but X402_PREPAID_SETTLER_SECRET_BASE58 is missing or unreadable; debits are accruing unsettled.',
		);
	}
	for (const group of out.unconfirmed) {
		await sendOpsAlert(
			'x402 prepaid settle unconfirmed',
			`batches ${group.batches.map((b) => b.id).join(',')} may have landed (${group.error}). Look the batch ids up in the memo of recent settler transactions before any retry; re-sending could pay twice.`,
		);
	}
	for (const group of out.failed) {
		await sendOpsAlert(
			'x402 prepaid settle failed',
			`transaction rejected (${group.error}); ${group.batches.length} payee batches released to the next window.`,
		);
	}

	return json(res, 200, {
		ok: true,
		mode: dryRun ? 'plan_only' : 'live',
		refunded_stale_reservations: refundedStale,
		floor_usd: usd(cfg.minSettleAtomics),
		would_settle: out.plan.settle.map((p) => ({ payee: p.payee, usd: usd(p.totalAtomics), debits: p.count })),
		deferred_below_floor: out.plan.deferred.map((p) => ({ payee: p.payee, usd: usd(p.totalAtomics), debits: p.count })),
		transactions: out.transactions.map((t) => ({
			signature: t.signature,
			payees: t.batches.map((b) => ({ payee: b.payee, usd: usd(b.totalAtomics) })),
		})),
		unconfirmed: out.unconfirmed.length,
		failed: out.failed.length,
	});
});
