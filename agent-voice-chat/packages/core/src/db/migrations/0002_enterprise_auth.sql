-- =============================================================================
-- Migration 0002: Enterprise Authentication
-- Adds refresh_tokens, user_sessions, saml_configs, oidc_configs, mfa_secrets
-- =============================================================================

-- Add new columns to users table for auth
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until timestamp with time zone;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at timestamp with time zone;

-- ---------------------------------------------------------------------------
-- Refresh Tokens
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  family_id uuid NOT NULL,
  device_info text,
  ip_address inet,
  is_revoked boolean NOT NULL DEFAULT false,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_refresh_tokens_family ON refresh_tokens(family_id);

-- ---------------------------------------------------------------------------
-- User Sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  refresh_token_id uuid REFERENCES refresh_tokens(id) ON DELETE SET NULL,
  device_info text,
  ip_address inet,
  user_agent text,
  last_active_at timestamp with time zone DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

CREATE INDEX idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_org ON user_sessions(org_id);

-- ---------------------------------------------------------------------------
-- SAML Configurations (per-organization)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS saml_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  entry_point text NOT NULL,
  issuer text NOT NULL,
  cert text NOT NULL,
  callback_url text NOT NULL,
  signature_algorithm text NOT NULL DEFAULT 'sha256',
  want_authn_response_signed boolean NOT NULL DEFAULT true,
  want_assertions_signed boolean NOT NULL DEFAULT true,
  email_attribute text NOT NULL DEFAULT 'email',
  first_name_attribute text NOT NULL DEFAULT 'firstName',
  last_name_attribute text NOT NULL DEFAULT 'lastName',
  groups_attribute text,
  jit_provisioning boolean NOT NULL DEFAULT true,
  default_role text NOT NULL DEFAULT 'member',
  enforce_sso boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE UNIQUE INDEX idx_saml_configs_org ON saml_configs(org_id);

-- ---------------------------------------------------------------------------
-- OIDC Configurations (per-organization)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS oidc_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  issuer_url text NOT NULL,
  client_id text NOT NULL,
  client_secret_encrypted text NOT NULL,
  scopes text[] NOT NULL DEFAULT ARRAY['openid', 'profile', 'email'],
  callback_url text NOT NULL,
  email_claim text NOT NULL DEFAULT 'email',
  name_claim text NOT NULL DEFAULT 'name',
  groups_claim text,
  jit_provisioning boolean NOT NULL DEFAULT true,
  default_role text NOT NULL DEFAULT 'member',
  enforce_sso boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE UNIQUE INDEX idx_oidc_configs_org ON oidc_configs(org_id);

-- ---------------------------------------------------------------------------
-- MFA Secrets
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mfa_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  secret_encrypted text NOT NULL,
  recovery_codes_encrypted text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);

CREATE UNIQUE INDEX idx_mfa_secrets_user ON mfa_secrets(user_id);

-- ---------------------------------------------------------------------------
-- OAuth Accounts (link social logins to users)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS oauth_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_account_id text NOT NULL,
  email text,
  display_name text,
  access_token_encrypted text,
  refresh_token_encrypted text,
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE(provider, provider_account_id)
);

CREATE INDEX idx_oauth_accounts_user ON oauth_accounts(user_id);
CREATE UNIQUE INDEX idx_oauth_accounts_provider ON oauth_accounts(provider, provider_account_id);


