-- Agent CI/CD & Versioning
-- Adds version control and deployment tracking for agent configurations

CREATE TABLE IF NOT EXISTS agent_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  config JSONB NOT NULL,
  changelog TEXT,
  created_by UUID REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'draft',
  test_results JSONB,
  promoted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agent_id, version)
);

CREATE INDEX IF NOT EXISTS idx_agent_versions_org ON agent_versions(org_id);
CREATE INDEX IF NOT EXISTS idx_agent_versions_agent_status ON agent_versions(agent_id, status);

CREATE TABLE IF NOT EXISTS agent_deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  version_id UUID NOT NULL REFERENCES agent_versions(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  environment TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  deployed_by UUID REFERENCES users(id),
  deployed_at TIMESTAMPTZ DEFAULT NOW(),
  rolled_back_at TIMESTAMPTZ,
  rollback_reason TEXT,
  metrics JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_deployments_agent_env ON agent_deployments(agent_id, environment);
CREATE INDEX IF NOT EXISTS idx_agent_deployments_org ON agent_deployments(org_id);
CREATE INDEX IF NOT EXISTS idx_agent_deployments_status ON agent_deployments(status);


