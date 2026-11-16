-- Migration: seats and team billing for Microsoft Marketplace SaaS subscriptions.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261116151500_microsoft_saas_seats.sql
-- Idempotent and additive.
--
-- A per-user plan on Microsoft Marketplace carries a quantity (the seats the
-- customer bought). Until now the whole subscription granted its plan to the
-- one account that activated it. With this migration:
--
--   microsoft_saas_subscriptions.team_id       the team (20261010120000_teams.sql)
--                                              whose people may hold the seats.
--                                              Only the subscription owner links
--                                              it, and only to a team they own.
--   microsoft_saas_subscriptions.refreshed_at  when the row was last copied from
--                                              the Fulfillment API, so the billing
--                                              page can refresh a stale row.
--   microsoft_saas_seats                       one row per person holding a seat.
--                                              recomputeUserPlan grants a per-user
--                                              plan only to seat holders; a flat
--                                              rate plan (quantity null) still
--                                              grants its owner.
--
-- A person holds at most one Microsoft seat at a time (unique user_id), so the
-- metering cron can attribute each usage event to exactly one subscription.

begin;

alter table microsoft_saas_subscriptions
	add column if not exists team_id uuid references teams(id) on delete set null;
alter table microsoft_saas_subscriptions
	add column if not exists refreshed_at timestamptz;

create index if not exists microsoft_saas_subscriptions_team_idx
	on microsoft_saas_subscriptions (team_id) where team_id is not null;

create table if not exists microsoft_saas_seats (
	subscription_id  text        not null references microsoft_saas_subscriptions(id) on delete cascade,
	user_id          uuid        not null references users(id) on delete cascade,
	assigned_by      uuid        references users(id) on delete set null,
	assigned_at      timestamptz not null default now(),
	primary key (subscription_id, user_id)
);

create unique index if not exists microsoft_saas_seats_one_per_user
	on microsoft_saas_seats (user_id);

-- A per-user subscription linked before seats existed granted its owner the
-- plan. Give each such owner the first seat so the seat rule changes nothing
-- for them. An owner already holding a seat elsewhere keeps that one.
insert into microsoft_saas_seats (subscription_id, user_id, assigned_by, assigned_at)
select id, user_id, user_id, coalesce(activated_at, created_at)
from microsoft_saas_subscriptions
where user_id is not null and quantity > 0
on conflict do nothing;

commit;
