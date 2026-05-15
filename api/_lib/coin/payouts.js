// Drain pending coin_payouts rows by signing + submitting batched SOL transfers.
//
// Called by the run-coin-payouts cron. Idempotent on tx_signature: a payout
// that was already submitted but lost in the network is re-attempted via
// signature lookup before we send another tx. (Solana doesn't have nonces,
// so the only way to avoid double-paying is to either include the same
// recent blockhash or to mark a row 'submitted' before sending and gate
// retries.) We use the second approach.

import { sql } from '../db.js';
import { loadCoinTreasury, sendSolBatched } from './treasury.js';

const PAYOUTS_PER_CYCLE_LIMIT = 200; // ~12 chunked txs; keeps cron runtime bounded

/**
 * Pull a batch of pending payouts for one coin, send via batched SystemProgram
 * transfers, and mark each row confirmed/failed.
 *
 * @param {object} coin coin_launches row
 * @returns {Promise<{ sent: number, confirmed: number, failed: number }>}
 */
export async function drainPendingPayouts(coin) {
	const pending = await sql`
		select id, kind, wallet, amount_lamports::text as amount, batch_id
		from coin_payouts
		where coin_id = ${coin.id} and status = 'pending'
		order by created_at asc
		limit ${PAYOUTS_PER_CYCLE_LIMIT}
	`;
	if (pending.length === 0) return { sent: 0, confirmed: 0, failed: 0 };

	if (!coin.is_live) {
		// Dry-run mode: mark each pending payout as confirmed with a
		// placeholder signature so the books reconcile. Useful for tests on
		// devnet or for a soft-launch where the operator wants the indexer
		// running but no on-chain spend.
		let n = 0;
		for (const p of pending) {
			await sql`
				update coin_payouts
				set status='confirmed', tx_signature=${'DRYRUN-' + p.id}, confirmed_at=now()
				where id=${p.id}
			`;
			await applyPostPayoutBookkeeping(coin.id, p);
			n++;
		}
		return { sent: 0, confirmed: n, failed: 0, dry_run: true };
	}

	const treasury = loadCoinTreasury();

	// Mark rows submitted BEFORE sending so a crash mid-flight doesn't allow
	// a second cron to re-send them. Neon HTTP client expands arrays into a
	// single Postgres array param, so we match via `= ANY($1)`.
	const ids = pending.map((p) => p.id);
	await sql`
		update coin_payouts set status='submitted', submitted_at=now()
		where id = any(${ids})
	`;

	const transfers = pending.map((p) => ({
		to: p.wallet,
		lamports: BigInt(p.amount),
		ref: p,
	}));

	const results = await sendSolBatched({
		from: treasury,
		transfers,
		network: coin.network || 'mainnet',
	});

	let confirmed = 0;
	let failed = 0;
	for (const r of results) {
		if (r.error) {
			failed += r.recipients.length;
			for (const t of r.recipients) {
				await sql`
					update coin_payouts
					set status='failed', error=${r.error.slice(0, 500)}
					where id=${t.ref.id}
				`;
				await sql`
					insert into coin_events (coin_id, kind, payload)
					values (${coin.id}, 'error', ${JSON.stringify({
						step: 'payout',
						payout_id: t.ref.id,
						kind: t.ref.kind,
						wallet: t.ref.wallet,
						amount: t.ref.amount,
						error: r.error.slice(0, 500),
					})}::jsonb)
				`;
			}
			continue;
		}
		confirmed += r.recipients.length;
		for (const t of r.recipients) {
			await sql`
				update coin_payouts
				set status='confirmed', tx_signature=${r.signature}, confirmed_at=now()
				where id=${t.ref.id}
			`;
			await applyPostPayoutBookkeeping(coin.id, t.ref);
		}
		await sql`
			insert into coin_events (coin_id, kind, payload, tx_signature)
			values (${coin.id}, 'reflection_batch', ${JSON.stringify({
				batch_kind: 'payout_tx',
				recipients: r.recipients.length,
				lamports_total: r.recipients
					.reduce((acc, t) => acc + BigInt(t.lamports), 0n)
					.toString(),
			})}::jsonb, ${r.signature})
		`;
	}

	// For each lottery payout that confirmed, mark the corresponding draw paid.
	const confirmedLotteryBatches = [
		...new Set(
			results
				.filter((r) => !r.error)
				.flatMap((r) => r.recipients)
				.filter((t) => t.ref.kind === 'lottery')
				.map((t) => t.ref.batch_id),
		),
	];
	for (const batchId of confirmedLotteryBatches) {
		const drawId = batchId.replace(/^lottery:/, '');
		await sql`
			update coin_draws set status='paid', paid_at=now()
			where coin_id=${coin.id} and draw_id=${drawId} and status='resolved'
		`;
	}

	return { sent: pending.length, confirmed, failed };
}

async function applyPostPayoutBookkeeping(coinId, payoutRow) {
	const amount = BigInt(payoutRow.amount);
	if (payoutRow.kind === 'lottery') {
		await sql`
			update coin_holders
			set total_lottery_won_lamports = total_lottery_won_lamports + ${amount.toString()}::bigint,
			    last_payout_at = now()
			where coin_id = ${coinId} and wallet = ${payoutRow.wallet}
		`;
	} else if (payoutRow.kind === 'reflection') {
		await sql`
			update coin_holders
			set accrued_reflection_lamports = greatest(accrued_reflection_lamports - ${amount.toString()}::bigint, 0),
			    total_reflection_paid_lamports = total_reflection_paid_lamports + ${amount.toString()}::bigint,
			    last_payout_at = now()
			where coin_id = ${coinId} and wallet = ${payoutRow.wallet}
		`;
	}
}
