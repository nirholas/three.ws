-- Learned skills (source 'experience', api/_lib/agent-learning/skill-drafts.js)
-- were allowed by 20260922190000_agent_memory_learning.sql, then
-- 20261011013000_skill_imports.sql rebuilt the check with 'external' and
-- dropped 'experience', so every learned-skill draft insert failed with
-- agent_custom_skills_source_check. Allow all four sources.
ALTER TABLE agent_custom_skills DROP CONSTRAINT IF EXISTS agent_custom_skills_source_check;
ALTER TABLE agent_custom_skills
	ADD CONSTRAINT agent_custom_skills_source_check CHECK (source IN ('custom', 'community', 'external', 'experience'));
