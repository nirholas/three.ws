// Microsoft Marketplace free trials on the three.ws SaaS offer.
//
// A plan with a free trial is configured in Partner Center (Plans > plan >
// Pricing and availability > Free trial, 1 to 180 days). The Fulfillment API
// then reports the subscription with isFreeTrial: true and a term covering the
// trial window. Microsoft's documented lifecycle, which this module mirrors:
//
//   - Activate starts the trial instead of paid billing.
//   - When the trial ends, or the customer upgrades to a paid plan early
//     (ChangePlan), isFreeTrial flips to false and billing starts. The end of
//     the trial also arrives as a Renew webhook.
//   - Cancelling during the trial (Unsubscribe) ends it and prevents conversion.
//
// Conversion is detected from state, not from any single webhook: every time a
// row is refreshed from Microsoft (resolve, webhook, the reminder cron) the
// stored trial columns are recomputed by nextTrialState, so a missed or
// reordered webhook still lands the right outcome on the next refresh.
//
// Pure helpers first (unit tested in tests/microsoft-trial.test.js), then the
// IO that persists the columns and audits each transition.

import { sql } from './db.js';
import { logAudit } from './audit.js';

export const DAY_MS = 86_400_000;

/** Reminder milestones, in the order they fire. */
export const TRIAL_MILESTONES = Object.freeze(['7d', '1d']);

/** The Microsoft admin surface where a buyer manages (or cancels) a SaaS subscription. */
export const MANAGE_IN_MICROSOFT_URL = 'https://portal.azure.com/#view/Microsoft_Azure_Marketplace/MarketplaceOffersBlade/selectedMenuItemId/saasResources';

function toDate(value) {
	if (value == null || value === '') return null;
	const d = value instanceof Date ? value : new Date(value);
	return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The moment paid billing starts: Microsoft's term endDate is the last valid
 * day of the trial, so billing begins at 00:00 UTC on the following day.
 * @returns {Date|null}
 */
export function trialConvertsAt(trialEndsAt) {
	const end = toDate(trialEndsAt);
	if (!end) return null;
	return new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) + DAY_MS);
}

/** Whole days of trial left, counting the current partial day. 0 once billing has started. */
export function trialDaysLeft(trialEndsAt, now = Date.now()) {
	const at = trialConvertsAt(trialEndsAt);
	if (!at) return null;
	const ms = at.getTime() - Number(now);
	return ms <= 0 ? 0 : Math.ceil(ms / DAY_MS);
}

/**
 * Which reminder is due now: '1d' inside the last 24 hours, '7d' inside the
 * last seven days, otherwise null (including after the trial has ended). A
 * cron that missed the 7 day window still sends '7d' while more than a day
 * is left, so a short trial (under 7 days) gets both reminders in order.
 */
export function trialMilestone(trialEndsAt, now = Date.now()) {
	const at = trialConvertsAt(trialEndsAt);
	if (!at) return null;
	const ms = at.getTime() - Number(now);
	if (ms <= 0) return null;
	if (ms <= DAY_MS) return '1d';
	if (ms <= 7 * DAY_MS) return '7d';
	return null;
}

/**
 * Recompute the stored trial columns from Microsoft's latest copy.
 *
 * @param {object|null} prev  the stored row before this refresh (null on first sight)
 * @param {{ is_free_trial: boolean, saas_status: string, term_start: string|null, term_end: string|null }} next
 *        the columns subscriptionColumns() derived from Microsoft's copy
 * @param {Date|number} now
 * @returns {{ columns: { is_free_trial: boolean, trial_started_at: string|null, trial_ends_at: string|null,
 *            trial_converted_at: string|null, trial_cancelled_at: string|null }, events: string[] }}
 *   events is any of 'trial_started', 'trial_converted', 'trial_cancelled', each emitted once per subscription.
 */
export function nextTrialState(prev, next, now = new Date()) {
	const nowIso = new Date(Number(now)).toISOString();
	const iso = (v) => toDate(v)?.toISOString() ?? null;
	const events = [];
	const inTrial = next.is_free_trial === true;
	const wasInTrial = prev?.is_free_trial === true;

	let startedAt = iso(prev?.trial_started_at);
	let convertedAt = iso(prev?.trial_converted_at);
	let cancelledAt = iso(prev?.trial_cancelled_at);
	// Keep the trial's end date after the trial is over so reporting can show it.
	const endsAt = inTrial ? iso(next.term_end) ?? iso(prev?.trial_ends_at) : iso(prev?.trial_ends_at);

	// The trial starts at activation: a PendingFulfillmentStart subscription on a
	// trial plan has not started anything yet.
	if (!startedAt && inTrial && next.saas_status !== 'PendingFulfillmentStart') {
		// A trial cannot start after the moment it is first seen running; clamp a
		// future term start (Microsoft's emulator reports start == end) to now.
		const termStart = iso(next.term_start);
		startedAt = termStart && termStart <= nowIso ? termStart : nowIso;
		events.push('trial_started');
	}

	const decided = Boolean(convertedAt || cancelledAt);
	if (startedAt && !decided) {
		if (next.saas_status === 'Unsubscribed' && (inTrial || wasInTrial)) {
			cancelledAt = nowIso;
			events.push('trial_cancelled');
		} else if (!inTrial && next.saas_status === 'Subscribed') {
			convertedAt = nowIso;
			events.push('trial_converted');
		}
	}

	return {
		columns: {
			is_free_trial: inTrial,
			trial_started_at: startedAt,
			trial_ends_at: endsAt,
			trial_converted_at: convertedAt,
			trial_cancelled_at: cancelledAt,
		},
		events,
	};
}

/** True when nextTrialState would change nothing worth a write. */
export function trialStateUnchanged(prev, columns) {
	const same = (a, b) => (toDate(a)?.getTime() ?? null) === (toDate(b)?.getTime() ?? null);
	return (prev?.is_free_trial === true) === columns.is_free_trial
		&& same(prev?.trial_started_at, columns.trial_started_at)
		&& same(prev?.trial_ends_at, columns.trial_ends_at)
		&& same(prev?.trial_converted_at, columns.trial_converted_at)
		&& same(prev?.trial_cancelled_at, columns.trial_cancelled_at);
}

/**
 * The recurring price Partner Center publishes for a plan, from a
 * listAvailablePlans response. Prefers the billing term the subscription is on
 * (P1M, P1Y...). Returns null when Microsoft exposes no price for the plan, so
 * callers show the plan name instead of inventing a number.
 *
 * @returns {{ price: number, currency: string, term_unit: string|null }|null}
 */
export function planPriceFromAvailablePlans(body, planId, termUnit = null) {
	const plans = Array.isArray(body?.plans) ? body.plans : [];
	const plan = plans.find((p) => p?.planId === planId);
	const terms = Array.isArray(plan?.planComponents?.recurrentBillingTerms) ? plan.planComponents.recurrentBillingTerms : [];
	const priced = terms.filter((t) => Number.isFinite(Number(t?.price)) && Number(t.price) > 0 && typeof t?.currency === 'string' && t.currency);
	if (!priced.length) return null;
	const term = priced.find((t) => termUnit && t.termUnit === termUnit) || priced.find((t) => t.termUnit === 'P1M') || priced[0];
	return { price: Number(term.price), currency: term.currency.toUpperCase(), term_unit: term.termUnit || null };
}

const TERM_LABEL = Object.freeze({ P1M: 'per month', P1Y: 'per year', P2Y: 'every 2 years', P3Y: 'every 3 years' });

/** "$49.00 per month" style label for a stored plan price, or null. */
export function formatPlanPrice({ price, currency, term_unit } = {}) {
	if (price == null || !currency) return null;
	let amount;
	try {
		amount = Number(price).toLocaleString('en-US', { style: 'currency', currency });
	} catch {
		amount = `${Number(price).toFixed(2)} ${currency}`;
	}
	const per = TERM_LABEL[term_unit];
	return per ? `${amount} ${per}` : amount;
}

/** Trial fields for the public subscription shape (landing page, banner, billing). */
export function publicTrial(row, now = Date.now()) {
	const priceLabel = row.plan_price != null && row.plan_price_plan_id === row.plan_id
		? formatPlanPrice({ price: row.plan_price, currency: row.plan_currency, term_unit: row.plan_term_unit })
		: null;
	return {
		is_free_trial: row.is_free_trial === true,
		trial_started_at: row.trial_started_at ?? null,
		trial_ends_at: row.trial_ends_at ?? null,
		trial_converts_at: row.is_free_trial === true ? trialConvertsAt(row.trial_ends_at)?.toISOString() ?? null : null,
		trial_days_left: row.is_free_trial === true ? trialDaysLeft(row.trial_ends_at, now) : null,
		trial_converted_at: row.trial_converted_at ?? null,
		trial_cancelled_at: row.trial_cancelled_at ?? null,
		plan_price_label: priceLabel,
		manage_url: MANAGE_IN_MICROSOFT_URL,
	};
}

// ── IO ──────────────────────────────────────────────────────────────────────

/**
 * Persist the trial columns after a refresh from Microsoft, fetch the plan's
 * published price while the subscription is in trial, and audit each
 * transition once. Called by upsertSubscription with the row as it was before
 * the refresh. Never throws for a price lookup failure: the copy falls back to
 * the plan name and the next refresh tries again.
 *
 * @param {object|null} prev   stored row before the refresh
 * @param {object} row         stored row after the refresh
 * @param {object} sub         Microsoft's subscription object
 * @param {{ now?: Date, listAvailablePlans?: Function }} [opts]
 */
export async function syncTrialState(prev, row, sub, { now = new Date(), listAvailablePlans = null } = {}) {
	const { columns, events } = nextTrialState(prev, {
		is_free_trial: sub.isFreeTrial === true,
		saas_status: row.saas_status,
		term_start: row.term_start,
		term_end: row.term_end,
	}, now);

	let current = row;
	if (!trialStateUnchanged(row, columns)) {
		const [updated] = await sql`
			update microsoft_saas_subscriptions set
				is_free_trial = ${columns.is_free_trial},
				trial_started_at = coalesce(trial_started_at, ${columns.trial_started_at}),
				trial_ends_at = ${columns.trial_ends_at},
				trial_converted_at = coalesce(trial_converted_at, ${columns.trial_converted_at}),
				trial_cancelled_at = coalesce(trial_cancelled_at, ${columns.trial_cancelled_at}),
				updated_at = now()
			where id = ${row.id}
			returning *
		`;
		current = updated || row;
	}

	if (current.is_free_trial && listAvailablePlans && current.plan_price_plan_id !== current.plan_id) {
		current = await refreshPlanPrice(current, sub, listAvailablePlans);
	}

	for (const event of events) {
		logAudit({
			userId: current.user_id || null,
			action: `microsoft_marketplace:${event}`,
			resourceId: current.id,
			meta: {
				plan_id: current.plan_id,
				status: current.saas_status,
				trial_ends_at: current.trial_ends_at,
				...(event === 'trial_converted' ? { converted_at: current.trial_converted_at } : {}),
				...(event === 'trial_cancelled' ? { cancelled_at: current.trial_cancelled_at } : {}),
			},
		});
	}
	return current;
}

async function refreshPlanPrice(row, sub, listAvailablePlans) {
	let body;
	try {
		body = await listAvailablePlans(row.id, row.plan_id);
	} catch (err) {
		// The price is optional copy: a timeout or a 4xx/5xx leaves the plan name
		// in place and the next refresh tries again.
		console.warn('[microsoft-trial] listAvailablePlans failed', row.id, err?.code || err?.message);
		return row;
	}
	const price = planPriceFromAvailablePlans(body, row.plan_id, sub.term?.termUnit || null);
	const [updated] = await sql`
		update microsoft_saas_subscriptions set
			plan_price = ${price?.price ?? null}, plan_currency = ${price?.currency ?? null},
			plan_term_unit = ${price?.term_unit ?? null}, plan_price_plan_id = ${row.plan_id}
		where id = ${row.id}
		returning *
	`;
	return updated || row;
}

/** Linked subscriptions currently in a free trial, soonest end first. */
export async function listActiveTrials(limit = 200) {
	return sql`
		select * from microsoft_saas_subscriptions
		where is_free_trial and user_id is not null and saas_status = 'Subscribed' and trial_ends_at is not null
		order by trial_ends_at asc
		limit ${limit}
	`;
}

/**
 * Claim the reminder for one subscription and milestone. Returns the new
 * ledger row, or null when it was already claimed (the idempotency guarantee:
 * the unique key means a rerun, or two overlapping cron ticks, notify once).
 */
export async function claimTrialReminder({ subscriptionId, userId, milestone, trialEndsAt }) {
	if (!TRIAL_MILESTONES.includes(milestone)) throw new Error(`unknown trial milestone ${milestone}`);
	const [row] = await sql`
		insert into microsoft_saas_trial_reminders (subscription_id, user_id, milestone, trial_ends_at)
		values (${subscriptionId}, ${userId}, ${milestone}, ${new Date(trialEndsAt).toISOString()})
		on conflict (subscription_id, milestone) do nothing
		returning *
	`;
	return row || null;
}

export async function recordTrialReminder(id, { notificationId = null, emailTo = null, emailStatus, emailError = null }) {
	await sql`
		update microsoft_saas_trial_reminders set
			notification_id = coalesce(${notificationId}, notification_id),
			email_to = coalesce(${emailTo}, email_to),
			email_status = ${emailStatus},
			email_error = ${emailError},
			email_attempts = email_attempts + 1,
			updated_at = now()
		where id = ${id}
	`;
}

/**
 * Reminders whose email has not gone out yet (a transport failure, or email
 * not configured when the reminder fired), for a bounded retry on later ticks
 * while the trial is still running.
 */
export async function listRetryableTrialEmails({ maxAttempts = 3, limit = 50 } = {}) {
	return sql`
		select r.*, s.plan_id, s.name, s.trial_ends_at as sub_trial_ends_at, s.is_free_trial, s.saas_status,
			s.plan_price, s.plan_currency, s.plan_term_unit, s.plan_price_plan_id, s.auto_renew
		from microsoft_saas_trial_reminders r
		join microsoft_saas_subscriptions s on s.id = r.subscription_id
		where r.email_status in ('pending', 'failed') and r.email_attempts < ${maxAttempts}
			and s.is_free_trial and s.saas_status = 'Subscribed'
		order by r.updated_at asc
		limit ${limit}
	`;
}
