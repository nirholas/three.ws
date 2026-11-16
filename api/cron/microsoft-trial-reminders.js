// @ts-check
// GET /api/cron/microsoft-trial-reminders: remind Microsoft Marketplace buyers
// before their free trial converts to the paid plan.
//
// Every hour, for each linked subscription currently in a free trial:
//
//   1. Refresh it from the Fulfillment API (upsertSubscription), which also
//      recomputes the trial columns. A trial that ended, converted early or was
//      cancelled since the last webhook is recorded here and gets no reminder.
//   2. Work out the milestone due now (trialMilestone: '7d' inside the last
//      seven days, '1d' inside the last day).
//   3. Claim the (subscription, milestone) row in microsoft_saas_trial_reminders.
//      The unique key is the idempotency guarantee: a rerun, or two overlapping
//      ticks, claims nothing new, so each milestone notifies exactly once.
//   4. Send one in-app notification (insertNotification, which also fans out to
//      push and paired chats per the user's preferences) and one email
//      (sendEmail, gated by the user's email preference for the type).
//
// An email that fails in transport, or that could not be sent because email is
// not configured, stays on the ledger as failed or pending and is retried on
// later ticks (up to EMAIL_MAX_ATTEMPTS) while the trial is still running. The
// in-app notification is never repeated.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { sql } from '../_lib/db.js';
import { insertNotification, emailAllowedForType } from '../_lib/notify.js';
import { sendEmail, renderMicrosoftTrialEnding } from '../_lib/email.js';
import { publisherConfig, getSubscription, upsertSubscription, planForMicrosoftPlan } from '../_lib/microsoft-marketplace.js';
import {
	listActiveTrials, trialMilestone, trialDaysLeft, trialConvertsAt, claimTrialReminder,
	recordTrialReminder, listRetryableTrialEmails, publicTrial,
} from '../_lib/microsoft-trial.js';

export const NOTIFICATION_TYPE = 'microsoft_trial_ending';
export const EMAIL_MAX_ATTEMPTS = 3;
const PLAN_LABEL = { pro: 'Pro', team: 'Team', enterprise: 'Enterprise' };

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;
	if (!publisherConfig()) {
		return json(res, 200, { ok: true, skipped: 'not_configured', detail: 'MS_MARKETPLACE_TENANT_ID, MS_MARKETPLACE_CLIENT_ID and MS_MARKETPLACE_CLIENT_SECRET are not set' });
	}
	const result = await runTrialReminders({ now: new Date() });
	return json(res, 200, { ok: true, ...result });
});

/**
 * One reminder pass. Exported so tests drive the real ledger and delivery
 * paths without the HTTP wrapper.
 * @param {{ now?: Date, refresh?: (id: string) => Promise<any> }} [opts]
 */
export async function runTrialReminders({ now = new Date(), refresh = refreshFromMicrosoft } = {}) {
	const out = { trials: 0, refreshed: 0, refresh_failed: 0, ended: 0, not_due: 0, already_sent: 0, notified: 0, emails: { sent: 0, pending: 0, skipped: 0, failed: 0, retried: 0 } };
	const trials = await listActiveTrials();
	out.trials = trials.length;

	for (const stored of trials) {
		let row = stored;
		try {
			row = await refresh(stored.id);
			out.refreshed += 1;
		} catch (err) {
			// Keep going on the stored copy: a reminder a few hours early is better
			// than none. The next tick refreshes again.
			out.refresh_failed += 1;
			console.warn('[microsoft-trial-reminders] refresh failed', stored.id, err?.code || err?.message);
		}
		if (!row?.is_free_trial || row.saas_status !== 'Subscribed' || !row.user_id) {
			out.ended += 1;
			continue;
		}
		const milestone = trialMilestone(row.trial_ends_at, now);
		if (!milestone) {
			out.not_due += 1;
			continue;
		}
		const claim = await claimTrialReminder({ subscriptionId: row.id, userId: row.user_id, milestone, trialEndsAt: row.trial_ends_at });
		if (!claim) {
			out.already_sent += 1;
			continue;
		}
		const details = reminderDetails(row, milestone, now);
		const notification = await insertNotification(row.user_id, NOTIFICATION_TYPE, details);
		out.notified += 1;
		const email = await deliverEmail(row.user_id, details);
		out.emails[email.status] += 1;
		await recordTrialReminder(claim.id, { notificationId: notification?.id ?? null, emailTo: email.to, emailStatus: email.status, emailError: email.error });
	}

	for (const r of await listRetryableTrialEmails({ maxAttempts: EMAIL_MAX_ATTEMPTS })) {
		if (!trialMilestone(r.sub_trial_ends_at, now)) continue;
		const row = { id: r.subscription_id, plan_id: r.plan_id, name: r.name, trial_ends_at: r.sub_trial_ends_at, is_free_trial: r.is_free_trial, plan_price: r.plan_price, plan_currency: r.plan_currency, plan_term_unit: r.plan_term_unit, plan_price_plan_id: r.plan_price_plan_id, auto_renew: r.auto_renew };
		const email = await deliverEmail(r.user_id, reminderDetails(row, r.milestone, now));
		out.emails.retried += 1;
		await recordTrialReminder(r.id, { emailTo: email.to, emailStatus: email.status, emailError: email.error });
	}
	return out;
}

async function refreshFromMicrosoft(id) {
	return upsertSubscription(await getSubscription(id));
}

/** The payload shared by the bell, push, chat and email copy. */
export function reminderDetails(row, milestone, now = new Date()) {
	const plan = planForMicrosoftPlan(row.plan_id);
	const trial = publicTrial(row, now);
	return {
		subscription_id: row.id,
		subscription_name: row.name || null,
		milestone,
		days_left: trialDaysLeft(row.trial_ends_at, now),
		trial_ends_at: new Date(row.trial_ends_at).toISOString(),
		converts_at: trialConvertsAt(row.trial_ends_at)?.toISOString() ?? null,
		plan_id: row.plan_id,
		plan_name: PLAN_LABEL[plan] || plan || row.plan_id,
		price_label: trial.plan_price_label,
		auto_renew: row.auto_renew !== false,
		manage_url: trial.manage_url,
		link: `/microsoft/activate?subscription=${encodeURIComponent(row.id)}`,
	};
}

/** @returns {Promise<{ status: 'sent'|'pending'|'skipped'|'failed', to: string|null, error: string|null }>} */
async function deliverEmail(userId, details) {
	const [user] = await sql`select email from users where id = ${userId} and deleted_at is null limit 1`;
	const to = user?.email || null;
	if (!to) return { status: 'skipped', to: null, error: 'no_email_on_account' };
	if (!(await emailAllowedForType(userId, NOTIFICATION_TYPE))) return { status: 'skipped', to, error: 'email_preference_off' };
	try {
		const sent = await sendEmail({ to, ...renderMicrosoftTrialEnding(details) });
		if (sent?.skipped) return { status: 'pending', to, error: sent.reason || 'email_not_configured' };
		if (sent?.error) return { status: 'failed', to, error: String(sent.error.message || sent.error.name || 'send_failed').slice(0, 300) };
		return { status: 'sent', to, error: null };
	} catch (err) {
		return { status: 'failed', to, error: String(err?.message || err).slice(0, 300) };
	}
}
