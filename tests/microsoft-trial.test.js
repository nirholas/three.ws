// Microsoft Marketplace free trials (api/_lib/microsoft-trial.js and
// api/cron/microsoft-trial-reminders.js): the trial state mapping from
// Microsoft's isFreeTrial flag, conversion and cancel-during-trial detection,
// the plan price lookup, and the reminder cron's exactly-once guarantee per
// subscription and milestone.
//
// The IO tests run the real upsertSubscription, ledger and cron against an
// in-process Postgres built from the real migrations, with fetch answering as
// Microsoft's Fulfillment API does. Only the notification fan-out and audit
// writes are spied on; email goes through the real sendEmail.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createPgliteSql } from './_helpers/pglite-sql.js';

const holder = vi.hoisted(() => ({ db: null }));
vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});
const audit = vi.hoisted(() => ({ logAudit: vi.fn() }));
vi.mock('../api/_lib/audit.js', () => audit);
// insertNotification returns the user_notifications row id, a uuid string.
const NOTIFICATION_ID = 'f0183bd8-1183-4da4-a9b9-534ee39b8292';
const notify = vi.hoisted(() => ({
	insertNotification: vi.fn(async () => ({ id: 'f0183bd8-1183-4da4-a9b9-534ee39b8292', in_app: true, delivered: { push: 0 } })),
	emailAllowedForType: vi.fn(async () => true),
}));
vi.mock('../api/_lib/notify.js', () => notify);
const mail = vi.hoisted(() => ({ transport: null }));
vi.mock('../api/_lib/email.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sendEmail: (...args) => (mail.transport ? mail.transport(...args) : actual.sendEmail(...args)) };
});

import {
	nextTrialState, trialMilestone, trialDaysLeft, trialConvertsAt, planPriceFromAvailablePlans,
	formatPlanPrice, publicTrial, trialStateUnchanged, claimTrialReminder, MANAGE_IN_MICROSOFT_URL,
} from '../api/_lib/microsoft-trial.js';
import { upsertSubscription, publicSubscription } from '../api/_lib/microsoft-marketplace.js';
import { runTrialReminders, reminderDetails } from '../api/cron/microsoft-trial-reminders.js';
import { renderMicrosoftTrialEnding } from '../api/_lib/email.js';
import { categoryForType, pushPayloadFor } from '../api/_lib/notify-prefs.js';

const D = 86_400_000;
const NOW = new Date('2026-11-16T12:00:00Z');

// ── Pure rules ──────────────────────────────────────────────────────────────

describe('trial dates', () => {
	it('treats Microsoft endDate as the last trial day, so billing starts the next midnight UTC', () => {
		expect(trialConvertsAt('2026-11-30T00:00:00Z').toISOString()).toBe('2026-12-01T00:00:00.000Z');
		expect(trialConvertsAt('2026-11-30').toISOString()).toBe('2026-12-01T00:00:00.000Z');
		expect(trialConvertsAt(null)).toBeNull();
		expect(trialConvertsAt('not a date')).toBeNull();
	});

	it('counts days left including the current partial day and stops at 0', () => {
		expect(trialDaysLeft('2026-11-30T00:00:00Z', NOW)).toBe(15);
		expect(trialDaysLeft('2026-11-16T00:00:00Z', NOW)).toBe(1);
		expect(trialDaysLeft('2026-11-15T00:00:00Z', NOW)).toBe(0);
	});

	it('picks the 7 day milestone inside the last week and the 1 day milestone inside the last day', () => {
		const convertsIn = (ms) => new Date(NOW.getTime() + ms - D).toISOString().slice(0, 10);
		// trial end dates whose conversion instant is just over / under each boundary
		expect(trialMilestone('2026-11-30', NOW)).toBeNull();
		expect(trialMilestone('2026-11-22', NOW)).toBe('7d'); // converts 2026-11-23, 6.5 days away
		expect(trialMilestone('2026-11-23', NOW)).toBeNull(); // 7.5 days away
		expect(trialMilestone('2026-11-17', NOW)).toBe('7d'); // 1.5 days away
		expect(trialMilestone('2026-11-16', NOW)).toBe('1d'); // 12 hours away
		expect(trialMilestone('2026-11-15', NOW)).toBeNull(); // already converted
		expect(convertsIn(D)).toBe('2026-11-16');
	});
});

describe('nextTrialState', () => {
	const pending = { is_free_trial: true, saas_status: 'PendingFulfillmentStart', term_start: null, term_end: null };
	const trialing = { is_free_trial: true, saas_status: 'Subscribed', term_start: '2026-11-02T00:00:00Z', term_end: '2026-12-01T00:00:00Z' };

	it('never records a trial start later than the moment it is first seen', () => {
		// Microsoft's SaaS API emulator mutates its start date into the end date on
		// activation; a start in the future would skew the starts-in-window count.
		const future = { ...trialing, term_start: '2026-11-22T12:00:00Z', term_end: '2026-11-22T12:00:00Z' };
		const { columns, events } = nextTrialState(null, future, NOW);
		expect(columns.trial_started_at).toBe(NOW.toISOString());
		expect(columns.trial_ends_at).toBe('2026-11-22T12:00:00.000Z');
		expect(events).toEqual(['trial_started']);
	});

	it('does not start a trial before activation', () => {
		const { columns, events } = nextTrialState(null, pending, NOW);
		expect(events).toEqual([]);
		expect(columns).toMatchObject({ is_free_trial: true, trial_started_at: null, trial_ends_at: null });
	});

	it('starts the trial on the first Subscribed copy with isFreeTrial, from the term start', () => {
		const { columns, events } = nextTrialState({ is_free_trial: true }, trialing, NOW);
		expect(events).toEqual(['trial_started']);
		expect(columns.trial_started_at).toBe('2026-11-02T00:00:00.000Z');
		expect(columns.trial_ends_at).toBe('2026-12-01T00:00:00.000Z');
	});

	it('detects conversion when isFreeTrial flips to false on a Subscribed subscription, and keeps the trial end date', () => {
		const prev = { is_free_trial: true, trial_started_at: '2026-11-02T00:00:00Z', trial_ends_at: '2026-12-01T00:00:00Z' };
		const next = { is_free_trial: false, saas_status: 'Subscribed', term_start: '2026-12-02T00:00:00Z', term_end: '2027-01-01T00:00:00Z' };
		const { columns, events } = nextTrialState(prev, next, NOW);
		expect(events).toEqual(['trial_converted']);
		expect(columns).toMatchObject({ is_free_trial: false, trial_converted_at: NOW.toISOString(), trial_ends_at: '2026-12-01T00:00:00.000Z' });
	});

	it('detects conversion from state even when the stored flag already reads false (a missed webhook)', () => {
		const prev = { is_free_trial: false, trial_started_at: '2026-11-02T00:00:00Z', trial_ends_at: '2026-12-01T00:00:00Z' };
		const { events } = nextTrialState(prev, { is_free_trial: false, saas_status: 'Subscribed', term_start: null, term_end: null }, NOW);
		expect(events).toEqual(['trial_converted']);
	});

	it('records a cancellation during the trial, never a conversion, whatever the flag says after Unsubscribe', () => {
		const prev = { is_free_trial: true, trial_started_at: '2026-11-02T00:00:00Z', trial_ends_at: '2026-12-01T00:00:00Z' };
		for (const flag of [true, false]) {
			const { columns, events } = nextTrialState(prev, { is_free_trial: flag, saas_status: 'Unsubscribed', term_start: null, term_end: null }, NOW);
			expect(events).toEqual(['trial_cancelled']);
			expect(columns.trial_converted_at).toBeNull();
			expect(columns.trial_cancelled_at).toBe(NOW.toISOString());
		}
	});

	it('emits each outcome once: a converted trial that later unsubscribes is not a trial cancellation', () => {
		const converted = { is_free_trial: false, trial_started_at: '2026-11-02T00:00:00Z', trial_converted_at: '2026-12-02T00:00:00Z' };
		expect(nextTrialState(converted, { is_free_trial: false, saas_status: 'Subscribed' }, NOW).events).toEqual([]);
		expect(nextTrialState(converted, { is_free_trial: false, saas_status: 'Unsubscribed' }, NOW).events).toEqual([]);
	});

	it('never treats a subscription that never had a trial as converted', () => {
		expect(nextTrialState(null, { is_free_trial: false, saas_status: 'Subscribed', term_start: '2026-11-01', term_end: '2026-12-01' }, NOW))
			.toEqual({ columns: { is_free_trial: false, trial_started_at: null, trial_ends_at: null, trial_converted_at: null, trial_cancelled_at: null }, events: [] });
	});

	it('reports unchanged state so a non-trial refresh writes nothing extra', () => {
		const { columns } = nextTrialState(null, { is_free_trial: false, saas_status: 'Subscribed' }, NOW);
		expect(trialStateUnchanged({ is_free_trial: undefined }, columns)).toBe(true);
		expect(trialStateUnchanged({ is_free_trial: false }, { ...columns, is_free_trial: true })).toBe(false);
	});
});

describe('plan price', () => {
	const body = {
		plans: [
			{ planId: 'team', planComponents: { recurrentBillingTerms: [{ currency: 'USD', price: 79, termUnit: 'P1M' }] } },
			{
				planId: 'pro', hasFreeTrials: true,
				planComponents: { recurrentBillingTerms: [{ currency: 'usd', price: 490, termUnit: 'P1Y' }, { currency: 'USD', price: 49, termUnit: 'P1M' }] },
			},
			{ planId: 'enterprise', planComponents: { recurrentBillingTerms: [] } },
		],
	};

	it('reads the price for the subscription billing term from listAvailablePlans', () => {
		expect(planPriceFromAvailablePlans(body, 'pro', 'P1Y')).toEqual({ price: 490, currency: 'USD', term_unit: 'P1Y' });
		expect(planPriceFromAvailablePlans(body, 'pro')).toEqual({ price: 49, currency: 'USD', term_unit: 'P1M' });
	});

	it('returns null instead of inventing a price when Microsoft exposes none', () => {
		expect(planPriceFromAvailablePlans(body, 'enterprise')).toBeNull();
		expect(planPriceFromAvailablePlans(body, 'missing')).toBeNull();
		expect(planPriceFromAvailablePlans({}, 'pro')).toBeNull();
	});

	it('formats the label and only shows it for the plan it was fetched for', () => {
		expect(formatPlanPrice({ price: 49, currency: 'USD', term_unit: 'P1M' })).toBe('$49.00 per month');
		expect(formatPlanPrice({ price: 490, currency: 'EUR', term_unit: 'P1Y' })).toBe('€490.00 per year');
		const row = { is_free_trial: true, trial_ends_at: '2026-11-30T00:00:00Z', plan_id: 'team', plan_price: 49, plan_currency: 'USD', plan_term_unit: 'P1M', plan_price_plan_id: 'pro' };
		expect(publicTrial(row, NOW)).toMatchObject({ plan_price_label: null, trial_days_left: 15, trial_converts_at: '2026-12-01T00:00:00.000Z', manage_url: MANAGE_IN_MICROSOFT_URL });
		expect(publicTrial({ ...row, plan_id: 'pro' }, NOW).plan_price_label).toBe('$49.00 per month');
	});
});

describe('reminder copy', () => {
	const details = { days_left: 7, trial_ends_at: '2026-11-22T00:00:00.000Z', plan_name: 'Pro', price_label: '$49.00 per month', auto_renew: true, manage_url: MANAGE_IN_MICROSOFT_URL, link: '/microsoft/activate?subscription=s1' };

	it('says when the trial ends, what it converts to and where to manage it', () => {
		const email = renderMicrosoftTrialEnding(details);
		expect(email.subject).toBe('Your three.ws free trial ends in 7 days');
		expect(email.text).toContain('Pro at $49.00 per month');
		expect(email.text).toContain('November 22, 2026');
		expect(email.html).toContain(MANAGE_IN_MICROSOFT_URL.replace(/&/g, '&amp;'));
		expect(renderMicrosoftTrialEnding({ ...details, days_left: 1, price_label: null }).subject).toBe('Your three.ws free trial ends tomorrow');
		expect(renderMicrosoftTrialEnding({ ...details, price_label: null }).text).toContain('the paid Pro plan');
		expect(renderMicrosoftTrialEnding({ ...details, auto_renew: false }).text).toContain('Auto-renew is off');
		expect(`${email.subject}${email.html}${email.text}`).not.toMatch(/[\u2013\u2014]/);
	});

	it('is an account notification with push copy that names the conversion', () => {
		expect(categoryForType('microsoft_trial_ending')).toBe('account');
		const push = pushPayloadFor('microsoft_trial_ending', details, 'n1');
		expect(push.title).toBe('Your free trial ends in 7 days');
		expect(push.body).toBe('Then Pro at $49.00 per month, billed by Microsoft');
	});
});

// ── Persistence and the cron ────────────────────────────────────────────────

const TENANT = '72f988bf-86f1-41af-91ab-2d7cd011db47';
const BUYER_TENANT = '2694e9dc-29a5-4017-958d-68314a91f2d2';
const SUB_ID = 'b2c3d4e5-0000-4000-8000-000000000029';
const PUBLISHER_ENV = { MS_MARKETPLACE_TENANT_ID: TENANT, MS_MARKETPLACE_CLIENT_ID: '0b8d3f4e-1111-4c3a-9a77-5f0d2c1e9a01', MS_MARKETPLACE_CLIENT_SECRET: 'publisher-secret' };
const BASE_TABLES = `
create table users (id uuid primary key default gen_random_uuid(), email text, display_name text,
  plan text not null default 'free', email_verified boolean default false, deleted_at timestamptz);
create table user_identities (id uuid primary key default gen_random_uuid(), user_id uuid, provider text not null,
  subject text, constraint user_identities_provider_check check (provider in ('google')));
create table subscriptions (user_id uuid, plan text, status text, active_until timestamptz);`;
const MIGRATIONS = ['20261104180000_microsoft_marketplace_saas.sql', '20261116152500_microsoft_saas_free_trial.sql', '20261116162459_microsoft_trial_reminder_notification_uuid.sql']
	.map((f) => readFileSync(`api/_lib/migrations/${f}`, 'utf8'));

function microsoftSub(over = {}) {
	return {
		id: SUB_ID, name: 'Contoso three.ws trial', offerId: 'three-ws', planId: 'pro', quantity: 0,
		saasSubscriptionStatus: 'Subscribed', isFreeTrial: true,
		beneficiary: { emailId: 'buyer@contoso.example', objectId: 'oid-1', tenantId: BUYER_TENANT },
		purchaser: { emailId: 'buyer@contoso.example', objectId: 'oid-1', tenantId: BUYER_TENANT },
		term: { startDate: '2026-10-24T00:00:00Z', endDate: '2026-11-22T00:00:00Z', termUnit: 'P1M' },
		autoRenew: true, isTest: true, ...over,
	};
}

/** Answers token, Get Subscription and listAvailablePlans the way Microsoft's hosts do. */
function fakeMicrosoft(ms) {
	const calls = [];
	vi.stubGlobal('fetch', async (url, init = {}) => {
		const u = new URL(String(url));
		calls.push({ path: u.pathname, search: u.search, method: (init.method || 'GET').toUpperCase() });
		const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
		if (u.pathname.endsWith('/oauth2/v2.0/token')) return reply(200, { access_token: 'tok', expires_in: 3600 });
		if (u.pathname.endsWith('/listAvailablePlans')) {
			if (ms.plansStatus) return reply(ms.plansStatus, { message: 'unavailable' });
			return reply(200, { plans: [{ planId: 'pro', hasFreeTrials: true, planComponents: { recurrentBillingTerms: [{ currency: 'USD', price: 49, termUnit: 'P1M' }] } }] });
		}
		if (u.pathname.endsWith(`/saas/subscriptions/${SUB_ID}`)) return reply(200, ms.sub);
		return reply(404, { message: 'not found' });
	});
	return calls;
}

describe('trial persistence and reminders', () => {
	let db;
	let ms;
	let calls;
	let userId;
	let saved;

	beforeAll(async () => {
		db = createPgliteSql();
		await db.exec(BASE_TABLES);
		for (const m of MIGRATIONS) await db.exec(m);
	});

	beforeEach(async () => {
		saved = Object.fromEntries([...Object.keys(PUBLISHER_ENV), 'RESEND_API_KEY', 'MS_MARKETPLACE_API_BASE', 'MS_MARKETPLACE_TOKEN_URL', 'MS_MARKETPLACE_EMULATOR'].map((k) => [k, process.env[k]]));
		for (const k of ['RESEND_API_KEY', 'MS_MARKETPLACE_API_BASE', 'MS_MARKETPLACE_TOKEN_URL', 'MS_MARKETPLACE_EMULATOR']) delete process.env[k];
		Object.assign(process.env, PUBLISHER_ENV);
		holder.db = db;
		mail.transport = null;
		audit.logAudit.mockClear();
		notify.insertNotification.mockClear();
		notify.emailAllowedForType.mockClear();
		await db.exec('truncate microsoft_saas_trial_reminders, microsoft_saas_subscriptions, users cascade');
		[{ id: userId }] = await db.sql`insert into users (email, plan) values ('buyer@contoso.example', 'pro') returning id`;
		ms = { sub: microsoftSub(), plansStatus: null };
		calls = fakeMicrosoft(ms);
	});

	afterEach(() => {
		for (const [k, v] of Object.entries(saved)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
		vi.unstubAllGlobals();
	});

	const link = () => db.sql`update microsoft_saas_subscriptions set user_id = ${userId}, activated_at = now() where id = ${SUB_ID}`;
	const stored = async () => (await db.sql`select * from microsoft_saas_subscriptions where id = ${SUB_ID}`)[0];
	const audits = () => audit.logAudit.mock.calls.map(([e]) => e.action);

	it('resolve of a pending trial stores the flag and the Partner Center price but starts nothing', async () => {
		ms.sub = microsoftSub({ saasSubscriptionStatus: 'PendingFulfillmentStart', term: { termUnit: 'P1M' } });
		const row = await upsertSubscription(ms.sub);
		expect(row).toMatchObject({ is_free_trial: true, trial_started_at: null, plan_price_plan_id: 'pro', plan_currency: 'USD' });
		expect(Number(row.plan_price)).toBe(49);
		expect(calls.filter((c) => c.path.endsWith('/listAvailablePlans'))).toHaveLength(1);
		expect(calls.find((c) => c.path.endsWith('/listAvailablePlans')).search).toContain('planId=pro');
		const pub = publicSubscription(row);
		expect(pub).toMatchObject({ is_free_trial: true, plan_price_label: '$49.00 per month', manage_url: MANAGE_IN_MICROSOFT_URL });
		expect(audits()).toEqual([]);
	});

	it('activation starts the trial once, then a refresh with isFreeTrial false records the conversion and its audit entry', async () => {
		await upsertSubscription(microsoftSub({ saasSubscriptionStatus: 'PendingFulfillmentStart', term: {} }));
		const active = await upsertSubscription(microsoftSub());
		expect(active.trial_started_at.toISOString()).toBe('2026-10-24T00:00:00.000Z');
		expect(active.trial_ends_at.toISOString()).toBe('2026-11-22T00:00:00.000Z');
		await upsertSubscription(microsoftSub());
		expect(audits()).toEqual(['microsoft_marketplace:trial_started']);
		// Price is fetched once per plan, not on every refresh.
		expect(calls.filter((c) => c.path.endsWith('/listAvailablePlans'))).toHaveLength(1);

		const converted = await upsertSubscription(microsoftSub({ isFreeTrial: false, term: { startDate: '2026-11-23T00:00:00Z', endDate: '2026-12-22T00:00:00Z', termUnit: 'P1M' } }));
		expect(converted.is_free_trial).toBe(false);
		expect(converted.trial_converted_at).toBeInstanceOf(Date);
		expect(converted.trial_ends_at.toISOString()).toBe('2026-11-22T00:00:00.000Z');
		expect(audits()).toEqual(['microsoft_marketplace:trial_started', 'microsoft_marketplace:trial_converted']);
		await upsertSubscription(microsoftSub({ isFreeTrial: false }));
		expect(audits()).toHaveLength(2);
	});

	it('an Unsubscribe during the trial records a cancellation and no conversion', async () => {
		await upsertSubscription(microsoftSub());
		const row = await upsertSubscription(microsoftSub({ saasSubscriptionStatus: 'Unsubscribed', isFreeTrial: false }));
		expect(row.trial_cancelled_at).toBeInstanceOf(Date);
		expect(row.trial_converted_at).toBeNull();
		expect(audits()).toEqual(['microsoft_marketplace:trial_started', 'microsoft_marketplace:trial_cancelled']);
	});

	it('falls back to no price when listAvailablePlans fails, and retries on the next refresh', async () => {
		ms.plansStatus = 503;
		const row = await upsertSubscription(microsoftSub());
		expect(row.plan_price).toBeNull();
		expect(publicSubscription(row).plan_price_label).toBeNull();
		ms.plansStatus = null;
		expect(Number((await upsertSubscription(microsoftSub())).plan_price)).toBe(49);
	});

	it('a subscription without a trial never calls listAvailablePlans or writes trial columns', async () => {
		const row = await upsertSubscription(microsoftSub({ isFreeTrial: undefined }));
		expect(row).toMatchObject({ is_free_trial: false, trial_started_at: null, plan_price: null });
		expect(calls.some((c) => c.path.endsWith('/listAvailablePlans'))).toBe(false);
	});

	it('the ledger claims each subscription and milestone exactly once', async () => {
		await upsertSubscription(microsoftSub());
		const args = { subscriptionId: SUB_ID, userId, milestone: '7d', trialEndsAt: '2026-11-22T00:00:00Z' };
		const [a, b] = await Promise.all([claimTrialReminder(args), claimTrialReminder(args)]);
		expect([a, b].filter(Boolean)).toHaveLength(1);
		expect(await claimTrialReminder(args)).toBeNull();
		expect(await claimTrialReminder({ ...args, milestone: '1d' })).not.toBeNull();
		await expect(claimTrialReminder({ ...args, milestone: '3d' })).rejects.toThrow('unknown trial milestone');
	});

	it('the cron sends one notification and one email per milestone, and a rerun sends nothing', async () => {
		await upsertSubscription(microsoftSub());
		await link();
		mail.transport = vi.fn(async () => ({ data: { id: 'email-1' }, error: null }));
		const at7d = new Date('2026-11-16T12:00:00Z');

		const first = await runTrialReminders({ now: at7d });
		expect(first).toMatchObject({ trials: 1, refreshed: 1, notified: 1, already_sent: 0, emails: { sent: 1 } });
		const second = await runTrialReminders({ now: new Date(at7d.getTime() + 3_600_000) });
		expect(second).toMatchObject({ notified: 0, already_sent: 1, emails: { sent: 0, retried: 0 } });
		expect(notify.insertNotification).toHaveBeenCalledTimes(1);
		expect(mail.transport).toHaveBeenCalledTimes(1);

		const [userArg, type, payload] = notify.insertNotification.mock.calls[0];
		expect(userArg).toBe(userId);
		expect(type).toBe('microsoft_trial_ending');
		expect(payload).toMatchObject({ milestone: '7d', days_left: 7, plan_name: 'Pro', price_label: '$49.00 per month', link: `/microsoft/activate?subscription=${SUB_ID}` });
		expect(mail.transport.mock.calls[0][0]).toMatchObject({ to: 'buyer@contoso.example', subject: 'Your three.ws free trial ends in 7 days' });

		const at1d = new Date('2026-11-22T06:00:00Z');
		expect(await runTrialReminders({ now: at1d })).toMatchObject({ notified: 1, emails: { sent: 1 } });
		expect(await runTrialReminders({ now: at1d })).toMatchObject({ notified: 0, already_sent: 1 });
		expect(notify.insertNotification).toHaveBeenCalledTimes(2);
		expect(notify.insertNotification.mock.calls[1][2]).toMatchObject({ milestone: '1d', days_left: 1 });

		const ledger = await db.sql`select milestone, notification_id, email_status, email_to from microsoft_saas_trial_reminders order by id`;
		expect(ledger).toEqual([
			{ milestone: '7d', notification_id: NOTIFICATION_ID, email_status: 'sent', email_to: 'buyer@contoso.example' },
			{ milestone: '1d', notification_id: NOTIFICATION_ID, email_status: 'sent', email_to: 'buyer@contoso.example' },
		]);
	});

	it('with email unconfigured the reminder is queued as a pending email row and the bell still fires once', async () => {
		await upsertSubscription(microsoftSub());
		await link();
		const now = new Date('2026-11-16T12:00:00Z');
		expect(await runTrialReminders({ now })).toMatchObject({ notified: 1, emails: { pending: 1 } });
		const [row] = await db.sql`select email_status, email_error, email_attempts, email_to from microsoft_saas_trial_reminders`;
		expect(row).toEqual({ email_status: 'pending', email_error: 'missing_api_key', email_attempts: 1, email_to: 'buyer@contoso.example' });
		expect(await runTrialReminders({ now })).toMatchObject({ notified: 0, already_sent: 1 });
		expect(notify.insertNotification).toHaveBeenCalledTimes(1);
	});

	it('retries a failed email on later ticks without repeating the notification', async () => {
		await upsertSubscription(microsoftSub());
		await link();
		const now = new Date('2026-11-16T12:00:00Z');
		mail.transport = vi.fn(async () => { throw new Error('Resend 503'); });
		expect(await runTrialReminders({ now })).toMatchObject({ notified: 1, emails: { failed: 1 } });
		mail.transport = vi.fn(async () => ({ data: { id: 'email-2' }, error: null }));
		expect(await runTrialReminders({ now: new Date(now.getTime() + 3_600_000) })).toMatchObject({ notified: 0, emails: { retried: 1 } });
		const [row] = await db.sql`select email_status, email_attempts from microsoft_saas_trial_reminders`;
		expect(row).toEqual({ email_status: 'sent', email_attempts: 2 });
		expect(notify.insertNotification).toHaveBeenCalledTimes(1);
	});

	it('honours the email preference and records the skip', async () => {
		await upsertSubscription(microsoftSub());
		await link();
		notify.emailAllowedForType.mockResolvedValueOnce(false);
		await runTrialReminders({ now: new Date('2026-11-16T12:00:00Z') });
		const [row] = await db.sql`select email_status, email_error from microsoft_saas_trial_reminders`;
		expect(row).toEqual({ email_status: 'skipped', email_error: 'email_preference_off' });
	});

	it('a trial that converted since the last webhook is recorded by the refresh and gets no reminder', async () => {
		await upsertSubscription(microsoftSub());
		await link();
		ms.sub = microsoftSub({ isFreeTrial: false });
		const out = await runTrialReminders({ now: new Date('2026-11-16T12:00:00Z') });
		expect(out).toMatchObject({ trials: 1, ended: 1, notified: 0 });
		expect((await stored()).trial_converted_at).toBeInstanceOf(Date);
		expect(audits()).toContain('microsoft_marketplace:trial_converted');
	});

	it('reminder details carry what converts and the Microsoft manage link', () => {
		const d = reminderDetails({ id: SUB_ID, plan_id: 'team', name: 'x', trial_ends_at: '2026-11-22T00:00:00Z', is_free_trial: true, auto_renew: false }, '7d', NOW);
		expect(d).toMatchObject({ plan_name: 'Team', price_label: null, auto_renew: false, manage_url: MANAGE_IN_MICROSOFT_URL, converts_at: '2026-11-23T00:00:00.000Z' });
	});
});
