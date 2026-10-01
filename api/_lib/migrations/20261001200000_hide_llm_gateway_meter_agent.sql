-- Migration: take the marketplace chat bot's AI-budget meter off the public wall.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261001200000_hide_llm_gateway_meter_agent.sql
-- Idempotent.
--
-- scripts/okx-bot-llm-gateway.mjs created the meter agent (meta.purpose =
-- 'llm-gateway-meter', owned by the marketplace-chat service account) with
-- is_published = false but never set is_public, which defaults to true. So
-- /api/agents/public listed it and /api/trending ranked it #1 on the bot's own
-- traffic, with a description that says "Not a public agent". The script now
-- writes is_public = false on create and on every re-run; this corrects the one
-- row it already made (55479fa8-13c6-44b3-a245-3156f2c836e5 on 2026-10-01).
-- Nothing reads is_public on the meter's own path (the LLM proxy resolves its
-- embed policy by id alone), so metering is unaffected.
--
-- To reverse: update agent_identities set is_public = true
--   where meta->>'purpose' = 'llm-gateway-meter' and is_public = false;

update agent_identities
set is_public = false,
    updated_at = now()
where meta->>'purpose' = 'llm-gateway-meter'
  and is_public = true;
