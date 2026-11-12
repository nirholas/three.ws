-- Migration: a lifetime spend cap on copy_subscriptions, set at the Follow tap.
-- Apply: npm run db:migrate (applies immediately; read npm run db:status first).
-- Idempotent.
--
-- per_trade_cap_sol bounds one copy and daily_budget_sol bounds one day, but a
-- follower who taps Follow on an agent page wants one number that bounds the
-- whole relationship: "never put more than X SOL behind this agent". That is
-- spend_cap_sol. api/_lib/copy-engine.js skips any copy the remaining cap cannot
-- cover (skip_reason spend_cap_exceeded / spend_cap_reached), and
-- api/cron/copy-fanout.js measures what has been spent as the planned SOL of
-- every pending or acted buy intent created since spend_cap_set_at, so a fresh
-- Follow (or a raised cap) starts its own counter instead of inheriting history.
--
-- NULL means uncapped, which is what every existing row had, so no backfill is
-- needed and no live subscription changes behavior.

begin;

alter table copy_subscriptions
    add column if not exists spend_cap_sol    numeric,
    add column if not exists spend_cap_set_at timestamptz;

alter table copy_subscriptions drop constraint if exists copy_subscriptions_spend_cap_positive;
alter table copy_subscriptions
    add constraint copy_subscriptions_spend_cap_positive
    check (spend_cap_sol is null or spend_cap_sol > 0);

commit;
