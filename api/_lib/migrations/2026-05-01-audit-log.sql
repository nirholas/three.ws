-- Migration: audit log for sensitive operations.
-- Apply: psql "$DATABASE_URL" -f api/_lib/migrations/2026-05-01-audit-log.sql
-- Idempotent.
--
-- Coverage: avatar deletion (MCP + REST), API key revocation,
-- OAuth refresh-token revocation, wallet unlink. Helper: api/_lib/audit.js.
--
-- Backfill: not possible — events before 2026-05-01 have no row. Log starts
-- the day this migration is applied. Retention: 365 days, enforced by the
-- audit-log-cleanup cron (see vercel.json).

create table if not exists audit_log (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid references users(id) on delete set null,
    action      text not null,
    resource_id text,
    meta        jsonb,
    created_at  timestamptz not null default now()
);

create index if not exists audit_log_user_idx on audit_log(user_id, created_at desc);
create index if not exists audit_log_action_idx on audit_log(action, created_at desc);
