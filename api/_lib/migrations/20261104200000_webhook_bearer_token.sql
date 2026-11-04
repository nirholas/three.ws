-- Migration: an optional bearer token on developer webhooks.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261104200000_webhook_bearer_token.sql
-- Idempotent.
--
-- Some receivers authenticate the caller with a static bearer key rather than
-- by verifying a signature. The one this exists for is a Grok Bot routine
-- webhook trigger: Grok hands out a URL and a key, and starts the routine only
-- for a POST carrying `Authorization: Bearer <key>`. Storing that key on the
-- endpoint lets any three.ws event (a finished run, a fired automation, a
-- pending approval) wake a Grok Bot routine directly.
--
-- The token is a credential for someone else's system, so it is stored
-- AES-256-GCM encrypted (api/_lib/webhook-auth.js), is write-only through
-- every API, and is never returned. Deliveries still carry the Standard
-- Webhooks signature headers; the bearer is an addition, not a replacement.

ALTER TABLE developer_webhooks ADD COLUMN IF NOT EXISTS auth_token_enc text;
