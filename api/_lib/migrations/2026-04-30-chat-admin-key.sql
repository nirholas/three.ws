-- Migration: store CHAT_ADMIN_KEY in DB so it can be updated without redeploy.
-- Apply: psql "$DATABASE_URL" -f api/_lib/migrations/2026-04-30-chat-admin-key.sql
-- Idempotent.

ALTER TABLE chat_brand_config ADD COLUMN IF NOT EXISTS admin_key TEXT;
