// Which developer plan an account is on, and the period it covers.
//
// One row per account in dev_plan_subscriptions; an account with no row is on
// the Free plan and gets its row the first time anything asks. The row carries
// the plan in force, its 30-day period, an optional plan scheduled for the next
// period (downgrades and cancellations wait for the period to end) and how the
// next period is paid (`credits` renews itself, a wallet payment does not).
//
// Rollover is pure (planRollover) so the quota tests can drive it with a fake
// clock, and the database wrapper (getDevSubscription) applies it with a
// compare-and-set on the old period_end, so two instances seeing the same
// expired period cannot both charge the renewal.

import { sql, isDbUnavailableError } from '../db.js';
import { createCache } from '../mem-cache.js';
import { debitCredits } from '../credits.js';
import { insertNotification } from '../notify.js';
import {
	DEFAULT_DEV_PLAN_ID,
	DEV_PLAN_PERIOD_MS,
	DEV_PLAN_MANAGE_URL,
	devPlanById,
	isKnownDevPlan,
} from './config.js';

const SUBSCRIPTION_CACHE_TTL_MS = 10_000;
let cache = createCache({ max: 10_000, ttlMs: SUBSCRIPTION_CACHE_TTL_MS });

function toRecord(row) {
	const planId = isKnownDevPlan(row.plan_id) ? String(row.plan_id).toLowerCase() : DEFAULT_DEV_PLAN_ID;
	return {
		userId: row.user_id,
		planId,
		plan: devPlanById(planId),
		periodStart: new Date(row.period_start),
		periodEnd: new Date(row.period_end),
		scheduledPlanId: row.scheduled_plan_id && isKnownDevPlan(row.scheduled_plan_id) ? row.scheduled_plan_id : null,
		renewWith: row.renew_with || null,
		paidUsd: Number(row.paid_usd || 0),
	};
}

/**
 * What the subscription becomes once its period has ended. Pure.
 *
 * - A scheduled plan takes over. A paid plan with no schedule renews itself.
 * - A paid next period needs payment: `credits` renews from the balance, any
 *   other method lapses to Free because the wallet is not ours to charge.
 * - Free advances by whole periods, so a dormant account's period boundaries
 *   stay aligned to its first call rather than to whenever it came back.
 *
 * @returns {{ changed: boolean, planId: string, periodStart: Date, periodEnd: Date,
 *   scheduledPlanId: null, renewWith: string|null, needsPayment: boolean, lapses: boolean }}
 */
export function planRollover(sub, now = new Date()) {
	const nowMs = now.getTime();
	if (sub.periodEnd.getTime() > nowMs) {
		return { changed: false, planId: sub.planId, periodStart: sub.periodStart, periodEnd: sub.periodEnd, scheduledPlanId: sub.scheduledPlanId, renewWith: sub.renewWith, needsPayment: false, lapses: false };
	}
	const nextId = sub.scheduledPlanId || sub.planId;
	const next = devPlanById(nextId);
	const paid = next.priceUsd > 0;
	const renewsFromCredits = paid && sub.renewWith === 'credits';
	const lapses = paid && !renewsFromCredits;
	const planId = lapses ? DEFAULT_DEV_PLAN_ID : next.id;
	let periodStart = sub.periodEnd;
	let periodEnd = new Date(periodStart.getTime() + DEV_PLAN_PERIOD_MS);
	if (planId === DEFAULT_DEV_PLAN_ID) {
		// Whole periods forward, never a period that is already over.
		const periodsBehind = Math.floor((nowMs - periodStart.getTime()) / DEV_PLAN_PERIOD_MS);
		periodStart = new Date(periodStart.getTime() + periodsBehind * DEV_PLAN_PERIOD_MS);
		periodEnd = new Date(periodStart.getTime() + DEV_PLAN_PERIOD_MS);
	}
	return {
		changed: true,
		planId,
		periodStart,
		periodEnd,
		scheduledPlanId: null,
		renewWith: planId === DEFAULT_DEV_PLAN_ID ? null : sub.renewWith,
		needsPayment: renewsFromCredits,
		lapses,
	};
}

async function applyRollover(sub, now) {
	const next = planRollover(sub, now);
	if (!next.changed) return sub;
	let planId = next.planId;
	let renewWith = next.renewWith;
	let paidUsd = 0;
	let ledgerId = null;
	if (next.needsPayment) {
		const plan = devPlanById(planId);
		try {
			const debit = await debitCredits({
				userId: sub.userId,
				amountUsd: plan.priceUsd,
				action: 'dev_plan_renew',
				refType: 'dev_plan',
				refId: plan.id,
				idempotencyKey: `devplan:renew:${sub.userId}:${sub.periodEnd.toISOString()}`,
				meta: { plan: plan.id, period_start: next.periodStart.toISOString(), period_end: next.periodEnd.toISOString() },
			});
			paidUsd = plan.priceUsd;
			ledgerId = debit.ledgerId || null;
		} catch (err) {
			if (err?.status !== 402) throw err;
			planId = DEFAULT_DEV_PLAN_ID;
			renewWith = null;
			insertNotification(sub.userId, 'dev_plan_lapsed', {
				plan: plan.id,
				reason: 'insufficient_credits',
				required_usd: plan.priceUsd,
				manage_url: DEV_PLAN_MANAGE_URL,
			});
		}
	} else if (next.lapses) {
		insertNotification(sub.userId, 'dev_plan_lapsed', {
			plan: sub.scheduledPlanId || sub.planId,
			reason: 'period_ended',
			manage_url: DEV_PLAN_MANAGE_URL,
		});
	}
	// Compare-and-set on the period that just ended: whoever loses the race
	// re-reads the winner's row below.
	const rows = await sql`
		update dev_plan_subscriptions
		set plan_id = ${planId}, period_start = ${next.periodStart.toISOString()}, period_end = ${next.periodEnd.toISOString()},
			scheduled_plan_id = null, renew_with = ${renewWith}, paid_usd = ${paidUsd}, updated_at = now()
		where user_id = ${sub.userId} and period_end = ${sub.periodEnd.toISOString()}
		returning *
	`;
	if (rows[0] && paidUsd > 0) {
		await sql`
			insert into dev_plan_receipts (user_id, plan_id, kind, asset, amount_usd, ledger_id, period_start, period_end)
			values (${sub.userId}, ${planId}, 'renew', 'credits', ${paidUsd}, ${ledgerId}, ${next.periodStart.toISOString()}, ${next.periodEnd.toISOString()})
		`;
	}
	if (rows[0]) return toRecord(rows[0]);
	const fresh = await sql`select * from dev_plan_subscriptions where user_id = ${sub.userId} limit 1`;
	return fresh[0] ? toRecord(fresh[0]) : sub;
}

async function loadSubscription(userId) {
	let rows = await sql`select * from dev_plan_subscriptions where user_id = ${userId} limit 1`;
	if (!rows[0]) {
		rows = await sql`
			insert into dev_plan_subscriptions (user_id) values (${userId})
			on conflict (user_id) do update set updated_at = dev_plan_subscriptions.updated_at
			returning *
		`;
	}
	return toRecord(rows[0]);
}

/**
 * The account's current subscription, rolled over if its period has ended.
 * Cached for ten seconds per account; every write path invalidates it.
 * Returns the Free plan on a database outage so the gateway can fail open.
 */
export async function getDevSubscription(userId, { now = new Date(), fresh = false } = {}) {
	if (!fresh) {
		const hit = cache.get(userId);
		if (hit && hit.periodEnd.getTime() > now.getTime()) return hit;
	}
	let sub;
	try {
		sub = await loadSubscription(userId);
		if (sub.periodEnd.getTime() <= now.getTime()) sub = await applyRollover(sub, now);
	} catch (err) {
		if (!isDbUnavailableError(err)) throw err;
		const periodStart = new Date(Math.floor(now.getTime() / DEV_PLAN_PERIOD_MS) * DEV_PLAN_PERIOD_MS);
		return {
			userId,
			planId: DEFAULT_DEV_PLAN_ID,
			plan: devPlanById(DEFAULT_DEV_PLAN_ID),
			periodStart,
			periodEnd: new Date(periodStart.getTime() + DEV_PLAN_PERIOD_MS),
			scheduledPlanId: null,
			renewWith: null,
			paidUsd: 0,
			degraded: true,
		};
	}
	cache.set(userId, sub);
	return sub;
}

/** Write the plan in force. Used by billing after a confirmed payment. */
export async function setDevSubscription(userId, { planId, periodStart, periodEnd, renewWith, paidUsd, scheduledPlanId = null }) {
	const rows = await sql`
		insert into dev_plan_subscriptions (user_id, plan_id, period_start, period_end, scheduled_plan_id, renew_with, paid_usd)
		values (${userId}, ${planId}, ${periodStart.toISOString()}, ${periodEnd.toISOString()}, ${scheduledPlanId}, ${renewWith}, ${paidUsd})
		on conflict (user_id) do update set
			plan_id = excluded.plan_id, period_start = excluded.period_start, period_end = excluded.period_end,
			scheduled_plan_id = excluded.scheduled_plan_id, renew_with = excluded.renew_with, paid_usd = excluded.paid_usd, updated_at = now()
		returning *
	`;
	invalidateDevSubscription(userId);
	return toRecord(rows[0]);
}

/** Name the plan that takes over when the current period ends (or clear it). */
export async function scheduleDevPlan(userId, scheduledPlanId) {
	const rows = await sql`
		update dev_plan_subscriptions set scheduled_plan_id = ${scheduledPlanId}, updated_at = now()
		where user_id = ${userId} returning *
	`;
	invalidateDevSubscription(userId);
	return rows[0] ? toRecord(rows[0]) : null;
}

export function invalidateDevSubscription(userId) {
	cache.delete(userId);
}

export function resetDevSubscriptionCache() {
	cache = createCache({ max: 10_000, ttlMs: SUBSCRIPTION_CACHE_TTL_MS });
}
