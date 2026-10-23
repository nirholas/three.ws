// api/_lib/x402/prepaid-ledger.js
//
// Per-payer prepaid balance for x402 routes that opt into `mode: 'prepaid'`.
//
// Why it exists: a $0.001 call settled on-chain on its own costs more in fees
// and fee-wallet float than it earns, and a burst of them is what starved the
// settle floor in past outages (docs/ops/x402-prepaid.md). Here the buyer makes
// ONE on-chain deposit; every request after that is a database debit, and the
// seller side is paid later in one batched transfer (prepaid-settle.js).
//
// Money rules, each enforced by a single atomic SQL statement so no ordering of
// concurrent requests can break them:
//
//   · A debit never takes a balance below zero: the UPDATE's WHERE clause is the
//     guard (re-evaluated after a row-lock wait under READ COMMITTED) and the
//     column CHECK is the backstop.
//   · A debit is RESERVED while the handler runs and only COMMITTED on success.
//     A 4xx/5xx, a thrown handler, a cancelled request, or a reservation that
//     outlives PREPAID_RESERVATION_TTL_SECONDS is refunded in full. Only
//     committed debits are ever settled to the seller.
//   · A deposit is idempotent on its transaction signature.
//
// All amounts are atomics (USDC has 6 decimals) carried as BigInt in JS and as
// text across the driver so nothing passes through a lossy Number.

import { sql } from '../db.js';

/** Reservations older than this are refunded by sweepStaleReservations. */
export const PREPAID_RESERVATION_TTL_SECONDS = 600;

/** Postgres `undefined_table`: the migration has not been applied here yet. */
const UNDEFINED_TABLE = '42P01';

/** True when a ledger failure is the table being absent (deploy ran ahead of its migration). */
export function isLedgerUnavailable(err) {
	const code = err?.code || err?.sourceError?.code;
	return code === UNDEFINED_TABLE;
}

/**
 * Normalise an amount to a positive BigInt, or throw a 400-shaped error.
 * @param {string|number|bigint} value
 */
export function toAtomics(value) {
	let n;
	try {
		n = BigInt(value);
	} catch {
		throw Object.assign(new Error('amount must be an integer count of atomics'), {
			status: 400,
			code: 'bad_amount',
		});
	}
	if (n <= 0n) {
		throw Object.assign(new Error('amount must be greater than zero'), {
			status: 400,
			code: 'bad_amount',
		});
	}
	return n;
}

function big(v) {
	return v == null ? 0n : BigInt(v);
}

/**
 * Credit a deposit. Idempotent on `ref` (the deposit transaction signature):
 * crediting the same signature twice returns `{ credited: false }` and leaves
 * the balance as it was.
 *
 * @param {{ payer: string, network: string, asset: string, amountAtomics: string|number|bigint, ref: string }} args
 * @returns {Promise<{ credited: boolean, balanceAtomics: bigint }>}
 */
export async function creditDeposit({ payer, network, asset, amountAtomics, ref }) {
	const amount = toAtomics(amountAtomics).toString();
	const [row] = await sql`
		with ins as (
			insert into x402_prepaid_entries (kind, payer, network, asset, amount_atomic, ref, state)
			values ('deposit', ${payer}::text, ${network}::text, ${asset}::text, ${amount}::bigint, ${ref}::text, 'credited')
			on conflict (kind, ref) do nothing
			returning payer, network, asset, amount_atomic
		), acct as (
			insert into x402_prepaid_accounts (payer, network, asset, balance_atomic)
			select payer, network, asset, amount_atomic from ins
			on conflict (payer, network, asset) do update
				set balance_atomic = x402_prepaid_accounts.balance_atomic + excluded.balance_atomic,
					updated_at = now()
			returning balance_atomic
		)
		select (select count(*) from ins)::int as credited,
		       (select balance_atomic::text from acct) as balance
	`;
	if (row.credited > 0) {
		return { credited: true, balanceAtomics: big(row.balance) };
	}
	return { credited: false, balanceAtomics: await getBalance({ payer, network, asset }) };
}

/**
 * Reserve a debit. Returns `{ ok: false, reason: 'insufficient' }` without
 * touching anything when the balance cannot cover it.
 *
 * @param {{ payer: string, network: string, asset: string, amountAtomics: string|number|bigint,
 *           payee: string, route: string, ref: string }} args
 * @returns {Promise<{ ok: true, entryId: string, balanceAtomics: bigint } | { ok: false, reason: 'insufficient' }>}
 */
export async function reserveDebit({ payer, network, asset, amountAtomics, payee, route, ref }) {
	const amount = toAtomics(amountAtomics).toString();
	const [row] = await sql`
		with acct as (
			update x402_prepaid_accounts
			set balance_atomic = balance_atomic - ${amount}::bigint, updated_at = now()
			where payer = ${payer}::text and network = ${network}::text and asset = ${asset}::text
			  and balance_atomic >= ${amount}::bigint
			returning balance_atomic
		), ins as (
			insert into x402_prepaid_entries
				(kind, payer, network, asset, amount_atomic, ref, state, payee, route)
			select 'debit', ${payer}::text, ${network}::text, ${asset}::text, ${amount}::bigint,
			       ${ref}::text, 'reserved', ${payee}::text, ${route}::text
			from acct
			returning id
		)
		select (select id::text from ins) as id, (select balance_atomic::text from acct) as balance
	`;
	if (!row?.id) return { ok: false, reason: 'insufficient' };
	return { ok: true, entryId: row.id, balanceAtomics: big(row.balance) };
}

/**
 * Commit a reserved debit after the handler succeeded. Returns false when the
 * reservation is no longer pending (already refunded by the stale sweep).
 * @param {string} entryId
 */
export async function commitDebit(entryId) {
	const rows = await sql`
		update x402_prepaid_entries
		set state = 'committed', resolved_at = now()
		where id = ${entryId}::bigint and kind = 'debit' and state = 'reserved'
		returning id
	`;
	return rows.length === 1;
}

/**
 * Refund a reserved debit: the entry flips to `refunded` and the amount returns
 * to the balance in one statement. A committed debit is never refunded here.
 * Returns the new balance, or null when the reservation was not pending.
 *
 * @param {string} entryId
 * @param {string} reason  short machine tag: handler_error, client_cancelled, stale_reservation
 * @returns {Promise<bigint|null>}
 */
export async function refundDebit(entryId, reason) {
	const rows = await sql`
		with e as (
			update x402_prepaid_entries
			set state = 'refunded', resolved_at = now(), refund_reason = ${reason}::text
			where id = ${entryId}::bigint and kind = 'debit' and state = 'reserved'
			returning payer, network, asset, amount_atomic
		)
		update x402_prepaid_accounts a
		set balance_atomic = a.balance_atomic + e.amount_atomic, updated_at = now()
		from e
		where a.payer = e.payer and a.network = e.network and a.asset = e.asset
		returning a.balance_atomic::text as balance
	`;
	return rows.length === 1 ? big(rows[0].balance) : null;
}

/**
 * Refund every reservation older than the TTL (a process that died mid-request).
 * One statement, so a request that commits concurrently either wins or is refunded.
 * @param {{ olderThanSeconds?: number }} [opts]
 * @returns {Promise<number>} reservations refunded
 */
export async function sweepStaleReservations({ olderThanSeconds = PREPAID_RESERVATION_TTL_SECONDS } = {}) {
	const rows = await sql`
		with e as (
			update x402_prepaid_entries
			set state = 'refunded', resolved_at = now(), refund_reason = 'stale_reservation'
			where kind = 'debit' and state = 'reserved'
			  and created_at < now() - make_interval(secs => ${Number(olderThanSeconds)}::double precision)
			returning payer, network, asset, amount_atomic
		), per_acct as (
			select payer, network, asset, sum(amount_atomic) as amt from e group by 1, 2, 3
		), upd as (
			update x402_prepaid_accounts a
			set balance_atomic = a.balance_atomic + p.amt, updated_at = now()
			from per_acct p
			where a.payer = p.payer and a.network = p.network and a.asset = p.asset
			returning 1
		)
		select count(*)::int as n from e
	`;
	return rows[0]?.n ?? 0;
}

/**
 * @param {{ payer: string, network: string, asset: string }} key
 * @returns {Promise<bigint>} 0n for a payer with no account
 */
export async function getBalance({ payer, network, asset }) {
	const rows = await sql`
		select balance_atomic::text as balance from x402_prepaid_accounts
		where payer = ${payer}::text and network = ${network}::text and asset = ${asset}::text
	`;
	return big(rows[0]?.balance);
}

/**
 * Reconciliation. Every figure is computed from the journal and compared with
 * the stored balances and batches, so a code path that edited one without the
 * other shows up as a non-zero delta.
 *
 *   balanceDelta = deposits - (reserved + committed debits) - sum(balances)
 *   batchDelta   = committed debits with a batch - non-failed batch totals
 *   settleDelta  = confirmed batch totals - committed debits in confirmed batches
 *
 * `held` is what the platform still owes: payers' spendable balances plus
 * in-flight reservations plus committed debits not yet confirmed to the seller
 * (deposits - settled by construction, so balanceDelta covers it).
 *
 * @returns {Promise<{
 *   depositsAtomics: bigint, debitsAtomics: bigint, refundedAtomics: bigint,
 *   settledAtomics: bigint, balancesAtomics: bigint, heldAtomics: bigint,
 *   balanceDelta: bigint, batchDelta: bigint, settleDelta: bigint,
 *   delta: bigint, driftedAccounts: Array<{payer:string,network:string,asset:string,expected:bigint,actual:bigint}>,
 *   staleReservations: number, stuckBatches: number, ok: boolean }>}
 */
export async function reconcile({ stuckBatchMinutes = 30 } = {}) {
	const [t] = await sql`
		select
			coalesce((select sum(amount_atomic) from x402_prepaid_entries where kind = 'deposit'), 0)::text as deposits,
			coalesce((select sum(amount_atomic) from x402_prepaid_entries where kind = 'debit' and state in ('reserved', 'committed')), 0)::text as debits,
			coalesce((select sum(amount_atomic) from x402_prepaid_entries where kind = 'debit' and state = 'refunded'), 0)::text as refunded,
			coalesce((select sum(balance_atomic) from x402_prepaid_accounts), 0)::text as balances,
			coalesce((select sum(amount_atomic) from x402_prepaid_entries where kind = 'debit' and state = 'committed' and batch_id is not null), 0)::text as batched,
			coalesce((select sum(total_atomic) from x402_prepaid_batches where status <> 'failed'), 0)::text as batch_totals,
			coalesce((select sum(total_atomic) from x402_prepaid_batches where status = 'confirmed'), 0)::text as settled,
			coalesce((select sum(e.amount_atomic) from x402_prepaid_entries e join x402_prepaid_batches b on b.id = e.batch_id
			          where e.kind = 'debit' and e.state = 'committed' and b.status = 'confirmed'), 0)::text as settled_entries,
			(select count(*) from x402_prepaid_entries where state = 'reserved'
			   and created_at < now() - make_interval(secs => ${PREPAID_RESERVATION_TTL_SECONDS}::double precision))::int as stale,
			(select count(*) from x402_prepaid_batches where status in ('pending', 'unconfirmed')
			   and created_at < now() - make_interval(mins => ${Number(stuckBatchMinutes)}::double precision))::int as stuck
	`;
	const drifted = await sql`
		select a.payer, a.network, a.asset,
		       (coalesce(d.dep, 0) - coalesce(x.deb, 0))::text as expected,
		       a.balance_atomic::text as actual
		from x402_prepaid_accounts a
		left join (select payer, network, asset, sum(amount_atomic) dep from x402_prepaid_entries
		           where kind = 'deposit' group by 1, 2, 3) d using (payer, network, asset)
		left join (select payer, network, asset, sum(amount_atomic) deb from x402_prepaid_entries
		           where kind = 'debit' and state in ('reserved', 'committed') group by 1, 2, 3) x using (payer, network, asset)
		where a.balance_atomic <> coalesce(d.dep, 0) - coalesce(x.deb, 0)
		limit 20
	`;
	const deposits = big(t.deposits);
	const debits = big(t.debits);
	const balances = big(t.balances);
	const settled = big(t.settled);
	const held = balances + (debits - settled);
	const balanceDelta = deposits - debits - balances;
	const batchDelta = big(t.batched) - big(t.batch_totals);
	const settleDelta = settled - big(t.settled_entries);
	const abs = (n) => (n < 0n ? -n : n);
	const delta = abs(balanceDelta) + abs(batchDelta) + abs(settleDelta);
	return {
		depositsAtomics: deposits,
		debitsAtomics: debits,
		refundedAtomics: big(t.refunded),
		settledAtomics: settled,
		balancesAtomics: balances,
		heldAtomics: held,
		balanceDelta,
		batchDelta,
		settleDelta,
		delta,
		driftedAccounts: drifted.map((r) => ({
			payer: r.payer,
			network: r.network,
			asset: r.asset,
			expected: big(r.expected),
			actual: big(r.actual),
		})),
		staleReservations: t.stale,
		stuckBatches: t.stuck,
		ok: delta === 0n && drifted.length === 0 && t.stale === 0 && t.stuck === 0,
	};
}
