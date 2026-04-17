-- Avatar GLB snapshot history for save-back rollback.
-- Idempotent — safe to re-run.
-- Run via: psql $DATABASE_URL -f scripts/migrations/add-avatar-versions.sql
--       or: node scripts/apply-schema.mjs (picks up this file automatically if wired)

create table if not exists avatar_versions (
    id            bigserial primary key,
    avatar_id     uuid not null references avatars(id) on delete cascade,
    glb_url       text not null,
    metadata      jsonb,
    created_at    timestamptz not null default now(),
    created_by    uuid references users(id)
);

create index if not exists avatar_versions_avatar_id_idx on avatar_versions(avatar_id, created_at desc);
