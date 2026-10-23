// api/_lib/x402/prepaid-reconcile.js
//
// Formats a prepaid ledger reconciliation (prepaid-ledger.js#reconcile) into the
// problem list, summary and printable lines shared by the nightly cron and
// scripts/x402-prepaid-reconcile.mjs.

import { reconcile } from './prepaid-ledger.js';

const usd = (a) => (Number(a) / 1e6).toFixed(6);

/**
 * @param {{ checkChain?: boolean }} [opts]  also compare the deposit wallet's
 *   real USDC balance with what the ledger says is held
 */
export async function reconcileReport({ checkChain = false } = {}) {
	const r = await reconcile();
	const problems = [];
	if (r.balanceDelta !== 0n) problems.push('balance_delta');
	if (r.batchDelta !== 0n) problems.push('batch_delta');
	if (r.settleDelta !== 0n) problems.push('settle_delta');
	if (r.driftedAccounts.length) problems.push('drifted_accounts');
	if (r.staleReservations) problems.push('stale_reservations');
	if (r.stuckBatches) problems.push('stuck_batches');

	let chainBalance = null;
	if (checkChain) {
		const { depositWalletUsdcBalance } = await import('./prepaid-chain.js');
		chainBalance = await depositWalletUsdcBalance();
		if (chainBalance !== null && chainBalance < r.heldAtomics) problems.push('wallet_short_of_held');
	}

	const lines = [
		`deposits           ${usd(r.depositsAtomics)}`,
		`debits (kept)      ${usd(r.debitsAtomics)}`,
		`refunded           ${usd(r.refundedAtomics)}`,
		`settled            ${usd(r.settledAtomics)}`,
		`payer balances     ${usd(r.balancesAtomics)}`,
		`held (owed)        ${usd(r.heldAtomics)}`,
		`balance delta      ${usd(r.balanceDelta)}   deposits - debits - balances`,
		`batch delta        ${usd(r.batchDelta)}   batched debits - batch totals`,
		`settle delta       ${usd(r.settleDelta)}   confirmed batches - their debits`,
		`drifted accounts   ${r.driftedAccounts.length}`,
		`stale reservations ${r.staleReservations}`,
		`stuck batches      ${r.stuckBatches}`,
		...(checkChain
			? [`wallet USDC        ${chainBalance === null ? 'unknown' : usd(chainBalance)}`]
			: []),
		...r.driftedAccounts.map(
			(d) => `  drift ${d.payer} expected ${usd(d.expected)} actual ${usd(d.actual)}`,
		),
		`total delta        ${usd(r.delta)}`,
		problems.length ? `PROBLEMS: ${problems.join(', ')}` : 'OK: ledger reconciles',
	];
	return {
		ok: problems.length === 0,
		problems,
		lines,
		summary: {
			deposits_usd: usd(r.depositsAtomics),
			settled_usd: usd(r.settledAtomics),
			held_usd: usd(r.heldAtomics),
			delta_usd: usd(r.delta),
			wallet_usdc: chainBalance === null ? null : usd(chainBalance),
		},
		raw: r,
	};
}
