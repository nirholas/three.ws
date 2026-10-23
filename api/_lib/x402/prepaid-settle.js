// api/_lib/x402/prepaid-settle.js
//
// The batcher: turns committed prepaid debits into ONE on-chain transaction per
// settlement window, paying every qualifying seller in it.
//
//   1. planSettlement  - aggregate committed, unbatched debits per payee and
//                        keep the payees whose total clears the floor. A payee
//                        below the floor is not settled; its debits roll into a
//                        later window, so no transfer is smaller than what the
//                        network charges to make it.
//   2. claimBatch      - per qualifying payee, one statement creates the batch
//                        row and stamps its debits with the batch id. A debit is
//                        therefore in at most one batch, however many crons race.
//   3. the sender      - ONE transaction carrying a transfer per claimed batch
//                        plus a memo naming the batch ids (so a transaction that
//                        landed but was never recorded can be found on-chain).
//   4. finish          - confirmed on success. A definitive failure (the chain
//                        rejected it, or it never left simulation) releases the
//                        debits for the next window. An ambiguous failure (it may
//                        have landed) parks the batches as `unconfirmed` and
//                        alerts, because re-sending could pay the seller twice.

import { randomUUID } from 'node:crypto';
import { sql } from '../db.js';

export const DEFAULT_MIN_SETTLE_ATOMICS = 1_000_000n; // 1 USDC
export const DEFAULT_MAX_PAYEES_PER_TX = 8;

/**
 * @param {Record<string, string|undefined>} [e]
 */
export function settleConfig(e = process.env) {
	const floor = e.X402_PREPAID_MIN_SETTLE_ATOMICS;
	const perTx = Number(e.X402_PREPAID_MAX_PAYEES_PER_TX);
	return {
		minSettleAtomics: floor && /^\d+$/.test(floor) ? BigInt(floor) : DEFAULT_MIN_SETTLE_ATOMICS,
		maxPayeesPerTx: Number.isInteger(perTx) && perTx > 0 && perTx <= 12 ? perTx : DEFAULT_MAX_PAYEES_PER_TX,
		live: e.X402_PREPAID_SETTLE_LIVE === '1',
	};
}

/**
 * What a window would settle, without claiming anything.
 * @param {{ minSettleAtomics?: bigint }} [opts]
 * @returns {Promise<{ settle: Array<{payee:string,network:string,asset:string,totalAtomics:bigint,count:number}>,
 *                     deferred: Array<{payee:string,network:string,asset:string,totalAtomics:bigint,count:number}> }>}
 */
export async function planSettlement({ minSettleAtomics = DEFAULT_MIN_SETTLE_ATOMICS } = {}) {
	const rows = await sql`
		select payee, network, asset, sum(amount_atomic)::text as total, count(*)::int as n
		from x402_prepaid_entries
		where kind = 'debit' and state = 'committed' and batch_id is null
		group by payee, network, asset
		order by sum(amount_atomic) desc
	`;
	const settle = [];
	const deferred = [];
	for (const r of rows) {
		const item = { payee: r.payee, network: r.network, asset: r.asset, totalAtomics: BigInt(r.total), count: r.n };
		(item.totalAtomics >= minSettleAtomics ? settle : deferred).push(item);
	}
	return { settle, deferred };
}

/**
 * Create the batch for one payee and claim its debits, atomically. Returns null
 * when nothing qualifies (another run claimed them, or the total is under the floor).
 *
 * @returns {Promise<{ id: string, payee: string, network: string, asset: string, totalAtomics: bigint, count: number } | null>}
 */
export async function claimBatch({ payee, network, asset, minSettleAtomics = DEFAULT_MIN_SETTLE_ATOMICS }) {
	const id = randomUUID();
	const rows = await sql`
		with picked as (
			update x402_prepaid_entries e
			set batch_id = ${id}::uuid
			where e.kind = 'debit' and e.state = 'committed' and e.batch_id is null
			  and e.payee = ${payee}::text and e.network = ${network}::text and e.asset = ${asset}::text
			  and (
				select coalesce(sum(amount_atomic), 0) from x402_prepaid_entries f
				where f.kind = 'debit' and f.state = 'committed' and f.batch_id is null
				  and f.payee = ${payee}::text and f.network = ${network}::text and f.asset = ${asset}::text
			  ) >= ${minSettleAtomics.toString()}::bigint
			returning e.amount_atomic
		), tot as (
			select coalesce(sum(amount_atomic), 0) as total, count(*)::int as n from picked
		)
		insert into x402_prepaid_batches (id, payee, network, asset, total_atomic, debit_count, status)
		select ${id}::uuid, ${payee}::text, ${network}::text, ${asset}::text, total, n, 'pending'
		from tot where n > 0
		returning id, total_atomic::text as total, debit_count
	`;
	if (!rows.length) return null;
	return { id, payee, network, asset, totalAtomics: BigInt(rows[0].total), count: rows[0].debit_count };
}

async function markConfirmed(ids, signature) {
	await sql`
		update x402_prepaid_batches
		set status = 'confirmed', tx_signature = ${signature}::text, settled_at = now()
		where id = any(${ids}::uuid[]) and status = 'pending'
	`;
}

async function releaseBatches(ids, message) {
	await sql`
		with b as (
			update x402_prepaid_batches
			set status = 'failed', error = ${String(message).slice(0, 500)}::text
			where id = any(${ids}::uuid[]) and status = 'pending'
			returning id
		)
		update x402_prepaid_entries set batch_id = null where batch_id in (select id from b)
	`;
}

async function parkBatches(ids, message) {
	await sql`
		update x402_prepaid_batches
		set status = 'unconfirmed', error = ${String(message).slice(0, 500)}::text
		where id = any(${ids}::uuid[]) and status = 'pending'
	`;
}

/** Errors the chain layer raises when the transaction definitively did not land. */
export function isDefinitiveFailure(err) {
	return err?.code === 'TX_ERR' || err?.code === 'SIM_FAILED' || err?.code === 'PRE_SEND';
}

/**
 * Run one settlement window.
 *
 * `send` receives the claimed batches (<= maxPayeesPerTx) and must resolve to the
 * transaction signature once it is confirmed, or throw. Pass `dryRun: true` to
 * plan and return without claiming or sending anything.
 *
 * @param {{
 *   send: (batches: Array<{id:string,payee:string,network:string,asset:string,totalAtomics:bigint}>) => Promise<string>,
 *   minSettleAtomics?: bigint, maxPayeesPerTx?: number, dryRun?: boolean,
 * }} args
 */
export async function runSettlementWindow({
	send,
	minSettleAtomics = DEFAULT_MIN_SETTLE_ATOMICS,
	maxPayeesPerTx = DEFAULT_MAX_PAYEES_PER_TX,
	dryRun = false,
}) {
	const plan = await planSettlement({ minSettleAtomics });
	const out = { plan, transactions: [], unconfirmed: [], failed: [] };
	if (dryRun) return out;

	for (let i = 0; i < plan.settle.length; i += maxPayeesPerTx) {
		const claimed = [];
		for (const p of plan.settle.slice(i, i + maxPayeesPerTx)) {
			const batch = await claimBatch({ ...p, minSettleAtomics });
			if (batch) claimed.push(batch);
		}
		if (!claimed.length) continue;
		const ids = claimed.map((b) => b.id);
		try {
			const signature = await send(claimed);
			await markConfirmed(ids, signature);
			out.transactions.push({ signature, batches: claimed });
		} catch (err) {
			if (isDefinitiveFailure(err)) {
				await releaseBatches(ids, err.message);
				out.failed.push({ batches: claimed, error: err.message });
			} else {
				await parkBatches(ids, err?.message || String(err));
				out.unconfirmed.push({ batches: claimed, error: err?.message || String(err) });
			}
		}
	}
	return out;
}
