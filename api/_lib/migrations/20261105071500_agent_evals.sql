-- Agent evals: one row per scored run of a task suite against an agent.
--
-- The report column holds the full three-ws/eval-report@1 document (every task's
-- checks and trace) written by api/_lib/evals/runner.js; summary and the scalar
-- columns are copied out of it so the Evaluate tab's history chart and list read
-- narrow rows. config_version is the content hash of the prompt, tools and
-- temperature that were scored, so a score history is per configuration version.
CREATE TABLE IF NOT EXISTS agent_evals (
	id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	agent_id        uuid NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
	user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	suite           text NOT NULL,
	suite_version   int NOT NULL DEFAULT 1,
	model           text NOT NULL,
	config_version  text NOT NULL,
	status          text NOT NULL DEFAULT 'running'
		CHECK (status IN ('running', 'completed', 'failed')),
	score           numeric(6, 4),
	pass_rate       numeric(6, 4),
	cost_usd        numeric(12, 6),
	summary         jsonb,
	report          jsonb,
	error           text,
	created_at      timestamptz NOT NULL DEFAULT now(),
	finished_at     timestamptz
);

CREATE INDEX IF NOT EXISTS agent_evals_agent_idx ON agent_evals (agent_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS agent_evals_running_idx ON agent_evals (agent_id) WHERE status = 'running';
