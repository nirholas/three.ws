-- Task 03 — Per-agent embed referrer allowlist
--
-- MERGED into api/_lib/schema.sql on 2026-04-17. This file is kept for
-- historical reference and as a one-shot ALTER for any database that was
-- provisioned before the canonical schema picked up this column.
--
-- Adds an `embed_policy` JSONB column to `agent_identities`. NULL means
-- "no policy" — preserves the legacy "embed anywhere" behaviour.
--
-- Apply once against any pre-existing database that wasn't reset:
--   psql "$DATABASE_URL" -f specs/schema/embed-policy.sql
-- Or just re-run `node scripts/apply-schema.mjs` (idempotent).

ALTER TABLE agent_identities
    ADD COLUMN IF NOT EXISTS embed_policy JSONB;
