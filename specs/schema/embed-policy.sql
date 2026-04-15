-- Task 03 — Per-agent embed referrer allowlist
--
-- Adds an `embed_policy` column to `agent_identities` that controls where the
-- `/agent/:id/embed` page is allowed to be iframed. NULL means "no policy",
-- which preserves the current behaviour of allowing any embedding site.
--
-- When non-null, the column stores JSON of the shape:
--   { "mode": "allowlist" | "denylist", "hosts": ["example.com", "*.substack.com"] }
-- Hosts support exact matches and a single leading-wildcard segment.
--
-- No dedicated migrations directory exists in this repo yet. Apply manually
-- against the target database (e.g. Neon) before deploying the embed-policy
-- endpoint and UI:
--
--   psql "$DATABASE_URL" -f specs/schema/embed-policy.sql

ALTER TABLE agent_identities
    ADD COLUMN IF NOT EXISTS embed_policy JSONB;
