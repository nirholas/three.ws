-- Migration: user notifications table.
--
-- Stores in-app notifications for agent owners (payment received, withdrawal
-- completed/failed). Fire-and-forget inserts; failures are logged not thrown.

begin;

create table if not exists user_notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  type       text not null,
  payload    jsonb not null default '{}',
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists user_notifications_user_unread
  on user_notifications (user_id, read_at, created_at desc);

commit;
