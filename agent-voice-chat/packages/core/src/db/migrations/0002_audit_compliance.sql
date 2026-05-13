-- Migration: 0002_audit_compliance
-- Description: Enhance audit_logs for compliance (hash chain, severity, GDPR)
-- Created: 2026-03-23

-- Add new columns to audit_logs
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS actor_type TEXT NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS actor_user_agent TEXT,
  ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'info',
  ADD COLUMN IF NOT EXISTS changes JSONB,
  ADD COLUMN IF NOT EXISTS request_id TEXT,
  ADD COLUMN IF NOT EXISTS geo_location JSONB,
  ADD COLUMN IF NOT EXISTS prev_hash TEXT,
  ADD COLUMN IF NOT EXISTS entry_hash TEXT;

-- Rename user_id to actor_id for broader actor support
ALTER TABLE audit_logs RENAME COLUMN user_id TO actor_id;

-- Rename ip_address to actor_ip for consistency
ALTER TABLE audit_logs RENAME COLUMN ip_address TO actor_ip;

-- Make resource_id TEXT instead of UUID (some resources use non-UUID IDs)
ALTER TABLE audit_logs ALTER COLUMN resource_id TYPE TEXT USING resource_id::TEXT;

-- Additional indexes for compliance queries
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_severity ON audit_logs(severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_request_id ON audit_logs(request_id);


