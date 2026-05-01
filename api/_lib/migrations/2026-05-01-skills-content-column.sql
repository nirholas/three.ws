-- Migration: add `content` to marketplace_skills, allow content-only skills.
-- Apply: psql "$DATABASE_URL" -f api/_lib/migrations/2026-05-01-skills-content-column.sql
-- Idempotent.

alter table marketplace_skills
    add column if not exists content text;

alter table marketplace_skills
    alter column schema_json drop not null;

do $$ begin
    alter table marketplace_skills
        add constraint marketplace_skills_has_payload
        check (schema_json is not null or content is not null);
exception when duplicate_object then null; end $$;
