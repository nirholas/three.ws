/**
 * Persistence + escrow ledger for the grind-bounty market.
 *
 * Stores the bounty board, the escrow record (USDC the requester paid up front
 * via x402, held until a winning claim or expiry), and the single, atomic
 * open→settled transition that picks exactly one winner. Mirrors the rest of the
 * codebase: Postgres when a database is configured, an in-process Map otherwise
 * (so local/CI works).
 *
 * ── Secret-blind by construction ─────────────────────────────────────────────
 * A stored bounty NEVER holds a private key or seed, only the requester's PUBLIC
 * X25519 recipient key. A winning claim holds only the SEALED envelope (opaque
 * ciphertext addressed to the requester) plus the public address. The operator
 * therefore cannot open any wallet it brokers; `toPublicBounty()` additionally
 * strips the sealed envelope from the public board view so only the requester
 * (via the authenticated reveal path) ever receives it.
 *
 * ── Escrow lands before the bounty does ──────────────────────────────────────
 * A bounty is born `escrow_pending`: recorded, but in NO index, so it is invisible
 * to the board and to `listClaimable`, and every compare-and-set below refuses it.
 * Only `activateBounty` (called after the x402 escrow actually settled on-chain)
 * flips it to `open` and indexes it. A settle that fails is voided instead. That
 * ordering is what stops the platform paying a winner (or refunding a requester)
 * out of a bounty whose escrow was never collected.
 *
 * ── Atomic single-winner settlement ──────────────────────────────────────────
 * `claimBounty` runs a Lua compare-and-set: it flips status open→settled, records
 * the winner + claim digest, and returns "won" ONLY to the first caller. Every
 * later caller, even one with a different valid key, sees `settled` and gets
 * "lost" (idempotent: re-submitting the SAME claim digest returns "won" again so
 * a retried settle isn't a double-pay). Expiry refunds are gated by the same
 * compare-and-set on open→refunded, so a bounty can never both pay AND refund.
 *
 * Storage: Postgres is the source of truth (tables `vanity_bounties` and
 * `vanity_bounty_events`, migration 20261105120000_vanity_bounties.sql), so a
 * Redis flush or eviction cannot lose escrow, payout or refund history. Every
 * state change is ONE guarded statement (UPDATE ... WHERE status = <expected>),
 * which is what makes the open->settled and open->refunded transitions atomic.
 * Only when no database is configured (local dev, CI) does the in-process Map
 * serve, and it is never used once a database is configured.
 */

import { sql } from './db.js';
import { databaseConfigured } from './env.js';

// Statuses a bounty holds before (or instead of) going live. Neither is a real
// bounty: they never reach the board, the claim queue, or the stats totals.
const TRANSIENT_STATUSES = Object.freeze(['escrow_pending', 'void']);

/** True for a record that has not (or will never) go live on the board. */
function isTransient(rec) {
	return !!rec && TRANSIENT_STATUSES.includes(rec.status);
}

// Public board projection: the sealed envelope + escrow proof stay private.
// SECURITY: this is the privacy boundary for the board. The sealed envelope is
// only ever returned to the requester through the dedicated reveal path, never here.
const PUBLIC_FIELDS = Object.freeze([
	'id', 'protocol', 'pattern', 'recipient', 'amountAtomics', 'asset', 'network',
	'status', 'difficulty', 'createdAt', 'expiresAt', 'settledAt', 'refundedAt',
	'winnerAddress', 'winnerWorkerId', 'payoutTx', 'refundTx', 'label',
]);

// In-process store, used only when no database is configured (local dev, CI).
const mem = new Map(); // id → record

function usePg() {
	return databaseConfigured();
}

/** Project a record to its public board shape (no sealed envelope, no escrow proof). */
export function toPublicBounty(rec) {
	if (!rec || typeof rec !== 'object') return null;
	const out = {};
	for (const k of PUBLIC_FIELDS) if (rec[k] !== undefined) out[k] = rec[k];
	if (!out.id) return null;
	return out;
}

function num(v) {
	const n = Number(v);
	return Number.isFinite(n) ? n : 0;
}

function duplicate() {
	return Object.assign(new Error('bounty id collision'), { status: 409, code: 'duplicate_bounty' });
}

/**
 * Record a bounty. The escrow proof (x402 settlement tx + payer) is stored on the
 * record but never exposed publicly: it is the audit trail proving the requester
 * actually funded it.
 *
 * Pass `status: 'escrow_pending'` (what api/vanity/bounties.js does) to record the
 * bounty WITHOUT making it live: it stays off the board and out of the claim queue
 * until `activateBounty` confirms the escrow settled.
 *
 * @param {object} rec - fully-formed bounty record (see api/vanity/bounties.js).
 * @returns {Promise<object>} the stored record.
 */
export async function createBounty(rec) {
	const record = { ...rec, status: rec.status || 'open' };
	if (usePg()) {
		const json = JSON.stringify(record);
		const rows = await sql`
			with ins as (
				insert into vanity_bounties (id, status, record, created_at, expires_at, amount_atomics)
				values (${String(record.id)}, ${record.status}, ${json}::jsonb, ${num(record.createdAt)},
					${record.expiresAt == null ? null : num(record.expiresAt)}, ${num(record.amountAtomics)})
				on conflict (id) do nothing
				returning id
			)
			insert into vanity_bounty_events (bounty_id, kind, at, data)
			select id, 'created', ${Date.now()}, jsonb_build_object('status', ${record.status}::text) from ins
			returning bounty_id`;
		if (!rows.length) throw duplicate();
		return record;
	}
	if (mem.has(record.id)) throw duplicate();
	mem.set(record.id, record);
	return record;
}

/**
 * Atomic escrow_pending→open transition, run only once the x402 escrow has
 * really settled on-chain, so a bounty becomes board-visible and claimable at the
 * instant it becomes funded, never before. Idempotent: re-activating an
 * already-open bounty reports 'live'.
 *
 * @returns {Promise<'live'|'missing'|'ineligible'>}
 */
export async function activateBounty({ id, escrowTx, escrowNetwork }) {
	const now = Date.now();
	if (usePg()) {
		const [row] = await sql`
			with cur as (select status from vanity_bounties where id = ${String(id)}),
			upd as (
				update vanity_bounties
				set status = 'open',
					record = record || jsonb_build_object('status', 'open'::text, 'escrowSettledAt', ${now}::bigint,
						'escrowTx', ${String(escrowTx || '')}::text, 'escrowNetwork', ${String(escrowNetwork || '')}::text)
				where id = ${String(id)} and status = 'escrow_pending'
				returning id
			),
			ev as (
				insert into vanity_bounty_events (bounty_id, kind, at, data)
				select id, 'activated', ${now}, jsonb_build_object('escrowTx', ${String(escrowTx || '')}::text) from upd
				returning 1
			)
			select (select status from cur) as prev, (select count(*) from upd)::int as changed`;
		if (row.changed === 1 || row.prev === 'open') return 'live';
		return row.prev == null ? 'missing' : 'ineligible';
	}
	const rec = mem.get(String(id));
	if (!rec) return 'missing';
	if (rec.status === 'open') return 'live';
	if (rec.status !== 'escrow_pending') return 'ineligible';
	rec.status = 'open';
	rec.escrowSettledAt = now;
	rec.escrowTx = escrowTx || '';
	rec.escrowNetwork = escrowNetwork || '';
	mem.set(String(id), rec);
	return 'live';
}

/**
 * Atomic escrow_pending→void transition: the escrow settle failed, so the bounty
 * can never go live and can never be claimed or refunded. Idempotent.
 *
 * @returns {Promise<'void'|'missing'|'ineligible'>}
 */
export async function voidBounty({ id, reason }) {
	const now = Date.now();
	if (usePg()) {
		const [row] = await sql`
			with cur as (select status from vanity_bounties where id = ${String(id)}),
			upd as (
				update vanity_bounties
				set status = 'void',
					record = record || jsonb_build_object('status', 'void'::text, 'voidedAt', ${now}::bigint,
						'voidReason', ${String(reason || '')}::text)
				where id = ${String(id)} and status = 'escrow_pending'
				returning id
			),
			ev as (
				insert into vanity_bounty_events (bounty_id, kind, at, data)
				select id, 'voided', ${now}, jsonb_build_object('reason', ${String(reason || '')}::text) from upd
				returning 1
			)
			select (select status from cur) as prev, (select count(*) from upd)::int as changed`;
		if (row.changed === 1 || row.prev === 'void') return 'void';
		return row.prev == null ? 'missing' : 'ineligible';
	}
	const rec = mem.get(String(id));
	if (!rec) return 'missing';
	if (rec.status === 'void') return 'void';
	if (rec.status !== 'escrow_pending') return 'ineligible';
	rec.status = 'void';
	rec.voidedAt = now;
	rec.voidReason = reason || '';
	mem.set(String(id), rec);
	return 'void';
}

/** Full record (including the sealed envelope + escrow proof). Server-side only. */
export async function getBountyRecord(id) {
	const key = String(id || '');
	if (!key) return null;
	if (usePg()) {
		const [row] = await sql`select record from vanity_bounties where id = ${key}`;
		return row ? parse(row.record) : null;
	}
	return mem.get(key) || null;
}

/** Public projection of one bounty (no sealed envelope). */
export async function getBounty(id) {
	return toPublicBounty(await getBountyRecord(id));
}

/**
 * Atomic open→settled transition: the first caller wins; any later caller, even
 * with a different valid key, loses. Re-submitting the SAME claim digest returns
 * 'won' again so a retried settle is not a double-pay.
 *
 * @returns {Promise<'won'|'lost'|'missing'|'closed'>}
 */
export async function claimBounty({ id, claimDigest, winnerAddress, workerId, sealedSecret }) {
	const now = Date.now();
	if (usePg()) {
		const worker = String(workerId || 'anon');
		const [row] = await sql`
			with cur as (select status, record->>'claimDigest' as digest from vanity_bounties where id = ${String(id)}),
			upd as (
				update vanity_bounties
				set status = 'settled',
					record = record || jsonb_build_object('status', 'settled'::text, 'claimDigest', ${String(claimDigest)}::text,
						'winnerAddress', ${String(winnerAddress)}::text, 'winnerWorkerId', ${worker}::text,
						'settledAt', ${now}::bigint, 'sealedSecret', ${JSON.stringify(sealedSecret ?? null)}::jsonb)
				where id = ${String(id)} and status = 'open' and (expires_at is null or ${now}::bigint <= expires_at)
				returning id
			),
			ev as (
				insert into vanity_bounty_events (bounty_id, kind, at, data)
				select id, 'settled', ${now}, jsonb_build_object('winnerAddress', ${String(winnerAddress)}::text,
					'winnerWorkerId', ${worker}::text, 'claimDigest', ${String(claimDigest)}::text) from upd
				returning 1
			)
			select (select status from cur) as prev, (select digest from cur) as digest, (select count(*) from upd)::int as changed`;
		if (row.changed === 1) return 'won';
		if (row.prev == null) return 'missing';
		if (row.prev === 'settled') return row.digest === String(claimDigest) ? 'won' : 'lost';
		return 'closed';
	}
	const rec = mem.get(String(id));
	if (!rec) return 'missing';
	if (rec.status === 'settled') return rec.claimDigest === claimDigest ? 'won' : 'lost';
	if (rec.status !== 'open') return 'closed';
	if (rec.expiresAt && now > rec.expiresAt) return 'closed';
	rec.status = 'settled';
	rec.claimDigest = claimDigest;
	rec.winnerAddress = winnerAddress;
	rec.winnerWorkerId = workerId || 'anon';
	rec.settledAt = now;
	rec.sealedSecret = sealedSecret;
	mem.set(String(id), rec);
	return 'won';
}

/**
 * Record the on-chain payout of a settled bounty and credit the worker's total.
 * Re-recording replaces the payout columns, so the leaderboard never double-counts.
 */
export async function recordPayout({ id, payoutTx, workerId, amountAtomics }) {
	const now = Date.now();
	if (usePg()) {
		const worker = workerId && amountAtomics ? String(workerId) : null;
		const amount = workerId && amountAtomics ? num(amountAtomics) : null;
		const [row] = await sql`
			with upd as (
				update vanity_bounties
				set payout_tx = ${String(payoutTx)}, payout_worker_id = ${worker}, payout_amount_atomics = ${amount},
					record = record || jsonb_build_object('payoutTx', ${String(payoutTx)}::text, 'payoutAt', ${now}::bigint)
				where id = ${String(id)}
				returning record
			),
			ev as (
				insert into vanity_bounty_events (bounty_id, kind, at, data)
				select ${String(id)}, 'payout', ${now}, jsonb_build_object('payoutTx', ${String(payoutTx)}::text) from upd
				returning 1
			)
			select record from upd`;
		return row ? parse(row.record) : null;
	}
	const rec = mem.get(String(id));
	if (!rec) return null;
	rec.payoutTx = payoutTx;
	rec.payoutAt = now;
	mem.set(String(id), rec);
	return rec;
}

/**
 * Atomic open→refunded transition once a bounty has expired unclaimed. Gated like
 * the settle, so a bounty can never both pay AND refund. Idempotent.
 *
 * @returns {Promise<'refundable'|'missing'|'ineligible'>}
 */
export async function markRefundable(id) {
	const now = Date.now();
	if (usePg()) {
		const [row] = await sql`
			with cur as (select status from vanity_bounties where id = ${String(id)}),
			upd as (
				update vanity_bounties
				set status = 'refunded',
					record = record || jsonb_build_object('status', 'refunded'::text, 'refundedAt', ${now}::bigint)
				where id = ${String(id)} and status = 'open' and expires_at is not null and ${now}::bigint > expires_at
				returning id
			),
			ev as (
				insert into vanity_bounty_events (bounty_id, kind, at, data)
				select id, 'refundable', ${now}, '{}'::jsonb from upd
				returning 1
			)
			select (select status from cur) as prev, (select count(*) from upd)::int as changed`;
		if (row.changed === 1 || row.prev === 'refunded') return 'refundable';
		return row.prev == null ? 'missing' : 'ineligible';
	}
	const rec = mem.get(String(id));
	if (!rec) return 'missing';
	if (rec.status === 'refunded') return 'refundable';
	if (rec.status !== 'open') return 'ineligible';
	if (!rec.expiresAt || now <= rec.expiresAt) return 'ineligible';
	rec.status = 'refunded';
	rec.refundedAt = now;
	mem.set(String(id), rec);
	return 'refundable';
}

/** Record the on-chain refund of an expired bounty. */
export async function recordRefund({ id, refundTx }) {
	const now = Date.now();
	if (usePg()) {
		const [row] = await sql`
			with upd as (
				update vanity_bounties
				set refund_tx = ${String(refundTx)},
					record = record || jsonb_build_object('refundTx', ${String(refundTx)}::text, 'refundAt', ${now}::bigint)
				where id = ${String(id)}
				returning record
			),
			ev as (
				insert into vanity_bounty_events (bounty_id, kind, at, data)
				select ${String(id)}, 'refund', ${now}, jsonb_build_object('refundTx', ${String(refundTx)}::text) from upd
				returning 1
			)
			select record from upd`;
		return row ? parse(row.record) : null;
	}
	const rec = mem.get(String(id));
	if (!rec) return null;
	rec.refundTx = refundTx;
	rec.refundAt = now;
	mem.set(String(id), rec);
	return rec;
}

/**
 * Board query. `status`: 'open' (default, unexpired), 'settled', or anything else
 * for every real (non-transient) bounty. `sort`: 'recency' (default), 'reward',
 * 'expiry'. Returns public projections only.
 */
export async function queryBounties(q = {}) {
	const status = q.status || 'open';
	const sort = q.sort || 'recency';
	const limit = Math.max(1, Math.min(60, Number(q.limit) || 24));
	const offset = Math.max(0, Number(q.offset) || 0);
	const now = Date.now();

	if (usePg()) {
		const where =
			status === 'open'
				? sql`status = 'open' and expires_at > ${now}`
				: status === 'settled'
					? sql`status = 'settled'`
					: sql`status not in ('escrow_pending', 'void')`;
		const order =
			sort === 'reward'
				? sql`amount_atomics desc, created_at desc`
				: sort === 'expiry'
					? sql`expires_at asc nulls last`
					: sql`created_at desc`;
		const [rows, [count]] = await Promise.all([
			sql`select record from vanity_bounties where ${where} order by ${order} limit ${limit} offset ${offset}`,
			sql`select count(*)::int as total from vanity_bounties where ${where}`,
		]);
		const total = count?.total || 0;
		return { bounties: rows.map((r) => toPublicBounty(parse(r.record))), total, hasMore: offset + limit < total };
	}

	let filtered = [...mem.values()].filter((r) => !isTransient(r));
	if (status === 'open') filtered = filtered.filter((r) => r.status === 'open' && r.expiresAt > now);
	else if (status === 'settled') filtered = filtered.filter((r) => r.status === 'settled');

	filtered.sort((a, b) => {
		if (sort === 'reward') return (b.amountAtomics || 0) - (a.amountAtomics || 0);
		if (sort === 'expiry') return (a.expiresAt || 0) - (b.expiresAt || 0);
		return (b.createdAt || 0) - (a.createdAt || 0);
	});

	const total = filtered.length;
	const page = filtered.slice(offset, offset + limit).map(toPublicBounty);
	return { bounties: page, total, hasMore: offset + limit < total };
}

/** Open, unexpired bounties soonest-expiring first: what a grinder claims from. */
export async function listClaimable(limit = 30) {
	const now = Date.now();
	const n = Math.max(1, Math.min(60, limit));
	if (usePg()) {
		const rows = await sql`
			select record from vanity_bounties
			where status = 'open' and expires_at > ${now}
			order by expires_at asc limit ${n}`;
		return rows.map((r) => toPublicBounty(parse(r.record)));
	}
	return [...mem.values()]
		.filter((r) => r.status === 'open' && r.expiresAt > now)
		.sort((a, b) => a.expiresAt - b.expiresAt)
		.slice(0, limit)
		.map(toPublicBounty);
}

/** Aggregate board stats over every real (non-transient) bounty. */
export async function bountyStats() {
	const now = Date.now();
	if (usePg()) {
		const [r] = await sql`
			select
				count(*) filter (where status = 'open' and expires_at > ${now})::int as open,
				coalesce(sum(amount_atomics) filter (where status = 'open' and expires_at > ${now}), 0)::text as open_escrow,
				count(*) filter (where status = 'settled')::int as settled,
				coalesce(sum(amount_atomics) filter (where status = 'settled'), 0)::text as paid_out,
				count(*)::int as total
			from vanity_bounties
			where status not in ('escrow_pending', 'void')`;
		return {
			open: r.open,
			openEscrowAtomics: Number(r.open_escrow),
			settled: r.settled,
			paidOutAtomics: Number(r.paid_out),
			total: r.total,
		};
	}
	const real = [...mem.values()].filter((r) => !isTransient(r));
	let open = 0, openEscrow = 0, settled = 0, paidOut = 0;
	for (const r of real) {
		if (r.status === 'open' && r.expiresAt > now) { open++; openEscrow += r.amountAtomics || 0; }
		if (r.status === 'settled') { settled++; paidOut += r.amountAtomics || 0; }
	}
	return { open, openEscrowAtomics: openEscrow, settled, paidOutAtomics: paidOut, total: real.length };
}

/** Top earning workers by recorded payout. */
export async function topGrinders(limit = 10) {
	const n = Math.max(1, Math.min(50, Number(limit) || 10));
	if (usePg()) {
		const rows = await sql`
			select payout_worker_id as worker_id, sum(payout_amount_atomics)::text as earned
			from vanity_bounties
			where payout_worker_id is not null and payout_tx is not null
			group by payout_worker_id
			order by sum(payout_amount_atomics) desc, payout_worker_id asc
			limit ${n}`;
		return rows.map((r) => ({ workerId: String(r.worker_id), earnedAtomics: Number(r.earned) || 0 }));
	}
	const tally = new Map();
	for (const r of mem.values()) {
		if (r.status === 'settled' && r.payoutTx && r.winnerWorkerId) {
			tally.set(r.winnerWorkerId, (tally.get(r.winnerWorkerId) || 0) + (r.amountAtomics || 0));
		}
	}
	return [...tally.entries()]
		.map(([workerId, earnedAtomics]) => ({ workerId, earnedAtomics }))
		.sort((a, b) => b.earnedAtomics - a.earnedAtomics)
		.slice(0, n);
}

function parse(raw) {
	if (!raw) return null;
	if (typeof raw === 'object') return raw;
	try { return JSON.parse(raw); } catch { return null; }
}

/** Test seam: drop every in-memory record (the Postgres path is untouched). */
export function __resetMemoryStore() {
	mem.clear();
}

export { PUBLIC_FIELDS };
