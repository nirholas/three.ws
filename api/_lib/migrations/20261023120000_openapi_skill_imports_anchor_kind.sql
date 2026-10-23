-- Allow drafts generated from a Solana Anchor IDL (packages/skill-import
-- src/anchor-idl.js, POST /api/skills/import { idl_url | program_id }).
-- Same table and draft-only lifecycle as the OpenAPI imports; only the
-- allowed `kind` values widen.

ALTER TABLE openapi_skill_imports DROP CONSTRAINT IF EXISTS openapi_skill_imports_kind_check;
ALTER TABLE openapi_skill_imports
	ADD CONSTRAINT openapi_skill_imports_kind_check CHECK (kind IN ('openapi', 'declarative', 'anchor'));
