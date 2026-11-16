-- Migration: Microsoft Marketplace free trials on the SaaS offer.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261116152500_microsoft_saas_free_trial.sql
-- Idempotent and additive.
--
-- A plan with a free trial (Partner Center: Plans > plan > Pricing and
-- availability > Free trial) reaches us exactly like a paid plan, except that
-- the Fulfillment API marks the subscription isFreeTrial: true and its term
-- covers the trial window. When the trial ends or the customer upgrades early,
-- Microsoft flips isFreeTrial to false and starts billing; if the customer
-- cancels during the trial, the subscription goes Unsubscribed and never
-- converts. api/_lib/microsoft-trial.js derives the columns below from
-- Microsoft's copy on every resolve, webhook and refresh:
--
--   is_free_trial        Microsoft's current isFreeTrial flag.
--   trial_started_at     first time the activated subscription was seen in trial.
--   trial_ends_at        last day of the trial (the trial term's endDate); kept
--                        after the trial ends so reporting can show it.
--   trial_converted_at   when the flag flipped to false on a Subscribed row.
--   trial_cancelled_at   when the subscription went Unsubscribed during trial.
--   plan_price, plan_currency, plan_term_unit, plan_price_plan_id
--                        the recurring price Partner Center publishes for the
--                        plan (listAvailablePlans), so the activation page and
--                        banner can say what the trial converts to. Null when
--                        Microsoft does not expose a price for the plan.
--
--   microsoft_saas_trial_reminders  one row per subscription and milestone
--                        (7 days and 1 day before the trial ends). The unique
--                        key makes the reminder cron idempotent: a rerun claims
--                        nothing new, so each milestone notifies exactly once.

begin;

alter table microsoft_saas_subscriptions add column if not exists is_free_trial boolean not null default false;
alter table microsoft_saas_subscriptions add column if not exists trial_started_at timestamptz;
alter table microsoft_saas_subscriptions add column if not exists trial_ends_at timestamptz;
alter table microsoft_saas_subscriptions add column if not exists trial_converted_at timestamptz;
alter table microsoft_saas_subscriptions add column if not exists trial_cancelled_at timestamptz;
alter table microsoft_saas_subscriptions add column if not exists plan_price numeric(12,2);
alter table microsoft_saas_subscriptions add column if not exists plan_currency text;
alter table microsoft_saas_subscriptions add column if not exists plan_term_unit text;
alter table microsoft_saas_subscriptions add column if not exists plan_price_plan_id text;

create index if not exists microsoft_saas_subscriptions_trial_idx
	on microsoft_saas_subscriptions (trial_ends_at) where is_free_trial and user_id is not null;

create table if not exists microsoft_saas_trial_reminders (
	id               bigserial primary key,
	subscription_id  text        not null references microsoft_saas_subscriptions(id) on delete cascade,
	user_id          uuid        references users(id) on delete set null,
	milestone        text        not null check (milestone in ('7d', '1d')),
	trial_ends_at    timestamptz not null,
	notification_id  bigint,
	email_to         text,
	email_status     text        not null default 'pending'
		check (email_status in ('pending', 'sent', 'skipped', 'failed')),
	email_error      text,
	email_attempts   integer     not null default 0,
	created_at       timestamptz not null default now(),
	updated_at       timestamptz not null default now(),
	unique (subscription_id, milestone)
);

create index if not exists microsoft_saas_trial_reminders_retry_idx
	on microsoft_saas_trial_reminders (updated_at) where email_status in ('pending', 'failed');

commit;
