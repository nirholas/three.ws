-- Migration: drop unused relayer-trade tables.
-- Apply: psql "$DATABASE_URL" -f api/_lib/migrations/2026-04-29-drop-pump-relay.sql
-- Idempotent.
--
-- Tables introduced by 2026-04-29-pump-relay-delegations.sql were for a
-- shared custodial relayer pattern. That model is wrong for a multi-tenant
-- site (one user's SOL would fund another's trades). Trading goes through
-- /api/pump/{buy,sell}-prep where the user's own wallet signs.

begin;

drop table if exists pump_relay_trades;
drop table if exists pump_trade_delegations;

commit;
