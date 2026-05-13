-- Drop the partial UNIQUE index that capped each user at one non-deleted agent.
-- The dashboard (Your agents → New agent) and api/agents POST handler are
-- designed for multi-agent ownership; the unique index blocked every create
-- after the first with `duplicate key value violates unique constraint
-- "agent_identities_user_unique"`. The non-unique companion index
-- `agent_identities_user` remains and continues to serve the per-user lookups
-- in handleList / handleGetOrCreateMe.
drop index if exists agent_identities_user_unique;
