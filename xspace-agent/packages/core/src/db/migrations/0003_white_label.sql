-- =============================================================================
-- Migration 0003: White-Label & Reseller Program
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Resellers (white-label partners)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS resellers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    tier        TEXT NOT NULL DEFAULT 'branded',       -- branded | full | enterprise_oem
    status      TEXT NOT NULL DEFAULT 'pending',       -- active | suspended | pending | churned
    config      JSONB NOT NULL DEFAULT '{}',           -- WhiteLabelConfig
    wholesale_discount REAL NOT NULL DEFAULT 0.4,      -- 0.0–1.0
    max_sub_orgs INTEGER NOT NULL DEFAULT 10,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_resellers_org ON resellers(org_id);
CREATE INDEX IF NOT EXISTS idx_resellers_status ON resellers(status);

-- ---------------------------------------------------------------------------
-- Sub-Organizations (tenants under a reseller)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sub_organizations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reseller_id     UUID NOT NULL REFERENCES resellers(id) ON DELETE CASCADE,
    parent_org_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,
    status          TEXT NOT NULL DEFAULT 'active',     -- active | suspended | pending
    plan            TEXT NOT NULL DEFAULT 'free',
    settings        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sub_orgs_reseller ON sub_organizations(reseller_id);
CREATE INDEX IF NOT EXISTS idx_sub_orgs_parent ON sub_organizations(parent_org_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_orgs_org ON sub_organizations(org_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_orgs_slug ON sub_organizations(slug);

-- ---------------------------------------------------------------------------
-- Custom Domains
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS custom_domains (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reseller_id         UUID NOT NULL REFERENCES resellers(id) ON DELETE CASCADE,
    org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    domain              TEXT NOT NULL UNIQUE,
    type                TEXT NOT NULL,                  -- dashboard | api | docs | status
    status              TEXT NOT NULL DEFAULT 'pending_verification',
    dns_record          JSONB NOT NULL DEFAULT '{}',   -- { type, name, value }
    tls_certificate_id  TEXT,
    verified_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_custom_domains_reseller ON custom_domains(reseller_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_domains_domain ON custom_domains(domain);
CREATE INDEX IF NOT EXISTS idx_custom_domains_org ON custom_domains(org_id);

-- ---------------------------------------------------------------------------
-- Agent Templates (syndicated by reseller)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reseller_id     UUID NOT NULL REFERENCES resellers(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT,
    config          JSONB NOT NULL DEFAULT '{}',
    is_default      BOOLEAN NOT NULL DEFAULT false,
    target_sub_orgs UUID[] DEFAULT '{}',               -- empty = all sub-orgs
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_templates_reseller ON agent_templates(reseller_id);

-- ---------------------------------------------------------------------------
-- Impersonation Sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS impersonation_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reseller_id     UUID NOT NULL REFERENCES resellers(id) ON DELETE CASCADE,
    admin_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_org_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    target_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_impersonation_reseller ON impersonation_sessions(reseller_id);
CREATE INDEX IF NOT EXISTS idx_impersonation_admin ON impersonation_sessions(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_impersonation_target ON impersonation_sessions(target_org_id);

-- ---------------------------------------------------------------------------
-- Track migration
-- ---------------------------------------------------------------------------
INSERT INTO _migrations (name) VALUES ('0003_white_label')
ON CONFLICT DO NOTHING;


