// Make a paid Forge generation whole when it fails after the money was taken.
//
// A paid High submit (a settled $THREE payment claimed in forge_high_redemptions,
// or a prepaid-credit spend in credit_ledger) is charged immediately before the
// provider dispatch and answers 200 with a job id. The handler's own finally only
// undoes the charge when THAT response is an error, so a job that fails later
// (every failover hop refused, a stalled poll, the finalize cron timing it out
// after a restart) used to keep the payment and deliver nothing.
//
// The fix has three parts, all here:
//   1. A request scope. The submit notes what it charged (notePaidGeneration) and
//      createCreation binds that charge to the creation row it inserts
//      (bindPaidGeneration): forge_high_redemptions.job_id and
//      credit_ledger.meta.creation_id. The handler states the fact once; no lane
//      branch can forget it.
//   2. paidJobOutcome follows forge_creations.superseded_by from the bound row to
//      the last attempt, so a failure that a failover recovered is never read as
//      a loss.
//   3. Make-whole. A $THREE proof whose job failed is honored as a free retry
//      (forge-high-payment.js asks paidJobOutcome before refusing it). A credit
//      spend whose job failed is refunded by the reconciler cron
//      (api/cron/forge-paid-make-whole.js) under the same idempotency key the
//      in-request refund uses, so it can never be refunded twice.
//
// Both make-whole paths wait a grace period after the failure: a failover marks
// the old row failed a moment before it links the successor, and an honored
// retry or a refund during that gap would pay out for a model that still lands.

import { AsyncLocalStorage } from 'node:async_hooks';
import { sql } from './db.js';
import { isUuid } from './validate.js';
import { refundCredits } from './credits.js';

/** A failed job's $THREE proof is reusable this long after the failure. */
export const RELEASE_GRACE_MS = 45_000;
/** A failed job's credit spend is refunded this long after the failure. */
export const CREDIT_REFUND_GRACE_MS = 10 * 60_000;
/** How far back the reconciler looks for spends to make whole. */
const RECONCILE_LOOKBACK = '7 days';
/** Failover chains are short (a few lanes); the cap only guards a bad cycle. */
const MAX_CHAIN_DEPTH = 8;

const scope = new AsyncLocalStorage();

/**
 * Run a paid submit inside a scope that remembers what it charged.
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
export function withPaidGenerationScope(fn) {
	return scope.run({ paid: null }, fn);
}

/**
 * Record a charge taken in this request ({ highPaymentId } or { creditLedgerId }).
 * @returns {boolean} false when called outside a paid scope.
 */
export function notePaidGeneration(patch) {
	const store = scope.getStore();
	if (!store) return false;
	store.paid = { ...(store.paid || {}), ...patch };
	return true;
}

/** What this request charged, or null. */
export function currentPaidGeneration() {
	return scope.getStore()?.paid || null;
}

/**
 * Bind this request's charges to the creation row it just inserted. The latest
 * row wins, so a submit that fails over in-request ends up bound to the attempt
 * that actually runs (and the chain walk covers the rest). Best-effort: a lost
 * bind leaves the charge exactly as it was before this module existed.
 */
export async function bindPaidGeneration(creationId, { highPaymentId, creditLedgerId } = {}) {
	if (!isUuid(creationId)) return;
	if (highPaymentId) {
		try {
			await sql`
				update forge_high_redemptions set job_id = ${creationId}
				where payment_id = ${highPaymentId}
			`;
		} catch (err) {
			console.error('[forge-paid] bind payment failed:', err?.message);
		}
	}
	if (creditLedgerId) {
		try {
			await sql`
				update credit_ledger
				set meta = coalesce(meta, '{}'::jsonb) || ${JSON.stringify({ creation_id: creationId })}::jsonb
				where id = ${creditLedgerId} and kind = 'spend'
			`;
		} catch (err) {
			console.error('[forge-paid] bind credit spend failed:', err?.message);
		}
	}
}

/**
 * Classify the last row of a failover chain.
 * @returns {{ state: 'done'|'failed'|'pending'|'unknown', failedAt?: Date }}
 */
export function classifyOutcome(row) {
	if (!row) return { state: 'unknown' };
	if (row.status === 'done') return { state: 'done' };
	if (row.status === 'failed') {
		// Still pointing at a successor means the walk stopped early (depth cap or
		// a missing successor row): not enough to call it a loss.
		if (row.superseded_by) return { state: 'unknown' };
		const failedAt = row.completed_at ? new Date(row.completed_at) : null;
		return failedAt && !Number.isNaN(failedAt.getTime())
			? { state: 'failed', failedAt }
			: { state: 'unknown' };
	}
	return { state: 'pending' };
}

/** Where the generation a charge paid for ended up, following failover successors. */
export async function paidJobOutcome(creationId) {
	if (!isUuid(creationId)) return { state: 'unknown' };
	const [row] = await sql`
		with recursive chain as (
			select id, status, superseded_by, completed_at, 0 as depth
			from forge_creations where id = ${creationId}
			union all
			select c.id, c.status, c.superseded_by, c.completed_at, chain.depth + 1
			from forge_creations c
			join chain on c.id = chain.superseded_by
			where chain.depth < ${MAX_CHAIN_DEPTH}
		)
		select id, status, superseded_by, completed_at from chain order by depth desc limit 1
	`;
	return classifyOutcome(row);
}

/**
 * Refund every recent Forge credit spend whose bound generation failed and has
 * not been refunded yet. Idempotent end to end: the refund key is the one the
 * in-request refund uses, and the candidate query already skips refunded spends.
 */
export async function reconcilePaidCreditGenerations({ limit = 200, now = Date.now() } = {}) {
	const spends = await sql`
		select s.id, s.user_id, s.amount_usd, s.action, s.ref_id, s.meta->>'creation_id' as creation_id
		from credit_ledger s
		where s.kind = 'spend'
		  and s.ref_type = 'forge'
		  and s.meta ? 'creation_id'
		  and s.created_at > now() - ${RECONCILE_LOOKBACK}::interval
		  and not exists (
			select 1 from credit_ledger r
			where r.idempotency_key = 'forge:credits:refund:' || s.id::text
		  )
		order by s.created_at asc
		limit ${limit}
	`;
	const out = { checked: spends.length, refunded: 0, errors: 0 };
	for (const spend of spends) {
		try {
			const outcome = await paidJobOutcome(spend.creation_id);
			if (outcome.state !== 'failed') continue;
			if (now - outcome.failedAt.getTime() < CREDIT_REFUND_GRACE_MS) continue;
			const amountUsd = Math.abs(Number(spend.amount_usd));
			if (!(amountUsd > 0)) continue;
			await refundCredits({
				userId: spend.user_id,
				amountUsd,
				action: spend.action,
				refType: 'forge',
				refId: spend.ref_id,
				idempotencyKey: `forge:credits:refund:${spend.id}`,
				meta: { reason: 'generation_failed_after_dispatch', creation_id: spend.creation_id },
			});
			out.refunded += 1;
		} catch (err) {
			out.errors += 1;
			console.error('[forge-paid] credit make-whole failed:', spend.id, err?.message);
		}
	}
	return out;
}
