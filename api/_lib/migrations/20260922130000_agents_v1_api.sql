-- Agents v1 REST API: lifecycle status, runs and their steps, chat history,
-- the unified automation object, and short link codes.
--
-- Every table here backs a route family under /api/v1 (api/v1/rest.js). The
-- service layer lives in api/_lib/agents-v1/.

-- ── lifecycle ────────────────────────────────────────────────────────────────
-- `running` lets scheduled automations, wallet intents and runs execute.
-- `stopped` pauses all of them without deleting anything. The wallet-intent
-- execution context (api/_lib/wallet-intents.js buildExecContext), the
-- automation engine and the run driver all read this column.
ALTER TABLE agent_identities ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'running';
ALTER TABLE agent_identities ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;
DO $$ BEGIN
	ALTER TABLE agent_identities ADD CONSTRAINT agent_identities_status_check CHECK (status IN ('running', 'stopped'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── runs ─────────────────────────────────────────────────────────────────────
-- A run is a goal the agent pursues through the server-side tool loop, one
-- checkpointed step at a time. `checkpoint` holds the AgentRuntime state and
-- next context between steps so any instance can resume it; `lease_until`
-- keeps two drivers (the SSE stream and the cron) from stepping it at once.
CREATE TABLE IF NOT EXISTS agent_runs (
	id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	agent_id             uuid NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
	user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	goal                 text NOT NULL,
	status               text NOT NULL DEFAULT 'queued'
		CHECK (status IN ('scheduled', 'queued', 'running', 'paused', 'completed', 'failed', 'cancelled', 'budget_exhausted')),
	model                text,
	temperature          real,
	tools_allowed        text[],
	max_steps            int NOT NULL DEFAULT 12 CHECK (max_steps BETWEEN 1 AND 60),
	step_count           int NOT NULL DEFAULT 0,
	budget_credits_usd   numeric(20, 6) NOT NULL DEFAULT 0,
	budget_usd           numeric(20, 6) NOT NULL DEFAULT 0,
	spent_credits_usd    numeric(20, 6) NOT NULL DEFAULT 0,
	spent_usd            numeric(20, 6) NOT NULL DEFAULT 0,
	schedule_cron        text,
	scheduled_for        timestamptz,
	checkpoint           jsonb,
	result               text,
	error                text,
	source               text NOT NULL DEFAULT 'api',
	automation_id        uuid,
	trigger_key          text,
	lease_owner          text,
	lease_until          timestamptz,
	cancel_requested_at  timestamptz,
	created_at           timestamptz NOT NULL DEFAULT now(),
	updated_at           timestamptz NOT NULL DEFAULT now(),
	started_at           timestamptz,
	finished_at          timestamptz
);
CREATE INDEX IF NOT EXISTS agent_runs_agent_idx ON agent_runs (agent_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS agent_runs_user_idx ON agent_runs (user_id, created_at DESC);
-- One run per automation fire: a retried sweep can never start the same run twice.
CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_trigger_uidx ON agent_runs (automation_id, trigger_key)
	WHERE automation_id IS NOT NULL AND trigger_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS agent_runs_due_idx ON agent_runs (status, scheduled_for)
	WHERE status IN ('scheduled', 'queued', 'running');

CREATE TABLE IF NOT EXISTS agent_run_steps (
	id              bigserial PRIMARY KEY,
	run_id          uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
	seq             int NOT NULL,
	kind            text NOT NULL
		CHECK (kind IN ('status', 'model_call', 'tool_call', 'tool_result', 'tool_blocked', 'final', 'error')),
	provider        text,
	model           text,
	tool_name       text,
	input           jsonb,
	output          jsonb,
	input_tokens    int,
	output_tokens   int,
	cost_micro_usd  bigint,
	latency_ms      int,
	created_at      timestamptz NOT NULL DEFAULT now(),
	UNIQUE (run_id, seq)
);

-- ── chat history ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_messages (
	id              bigserial PRIMARY KEY,
	agent_id        uuid NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
	user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	role            text NOT NULL CHECK (role IN ('user', 'assistant')),
	content         text NOT NULL,
	model           text,
	provider        text,
	input_tokens    int,
	output_tokens   int,
	cost_micro_usd  bigint,
	charged_usd     numeric(20, 6) NOT NULL DEFAULT 0,
	free_tier       boolean NOT NULL DEFAULT false,
	tool_calls      jsonb NOT NULL DEFAULT '[]'::jsonb,
	signatures      text[] NOT NULL DEFAULT '{}',
	created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_messages_thread_idx ON agent_messages (agent_id, user_id, id DESC);
CREATE INDEX IF NOT EXISTS agent_messages_user_day_idx ON agent_messages (user_id, created_at) WHERE role = 'user';

-- ── automations ──────────────────────────────────────────────────────────────
-- One trigger, one action. Spend and notify actions execute through a backing
-- wallet intent (trigger_type 'on_automation', never swept on its own) so they
-- inherit the intent engine's caps, spend policy and custody ledger. The
-- `agent_prompt` action starts an agent run.
CREATE TABLE IF NOT EXISTS agent_automations (
	id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	agent_id        uuid NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
	user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	title           text,
	trigger_type    text NOT NULL
		CHECK (trigger_type IN ('price_threshold', 'schedule', 'balance_below', 'tip_received', 'launch_matching', 'graduation', 'whale_buy')),
	trigger_config  jsonb NOT NULL DEFAULT '{}'::jsonb,
	action_type     text NOT NULL CHECK (action_type IN ('agent_prompt', 'swap', 'transfer', 'notify')),
	action_config   jsonb NOT NULL DEFAULT '{}'::jsonb,
	trigger_once    boolean NOT NULL DEFAULT false,
	enabled         boolean NOT NULL DEFAULT true,
	intent_id       uuid,
	state           jsonb NOT NULL DEFAULT '{}'::jsonb,
	fire_count      int NOT NULL DEFAULT 0,
	last_fired_at   timestamptz,
	last_checked_at timestamptz,
	last_status     text,
	last_note       text,
	source          text NOT NULL DEFAULT 'api',
	created_at      timestamptz NOT NULL DEFAULT now(),
	updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_automations_agent_idx ON agent_automations (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_automations_live_idx ON agent_automations (trigger_type) WHERE enabled = true;

-- ── link codes ───────────────────────────────────────────────────────────────
-- An eight-character code pairs a device or chat gateway to an account for ten
-- minutes. Only the sha256 of the code is stored; redemption is single use.
CREATE TABLE IF NOT EXISTS account_link_codes (
	id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	code_hash    text NOT NULL UNIQUE,
	user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	agent_id     uuid REFERENCES agent_identities(id) ON DELETE SET NULL,
	label        text,
	scopes       text NOT NULL,
	created_at   timestamptz NOT NULL DEFAULT now(),
	expires_at   timestamptz NOT NULL,
	redeemed_at  timestamptz,
	link_id      uuid
);
CREATE INDEX IF NOT EXISTS account_link_codes_user_idx ON account_link_codes (user_id, created_at DESC);

-- A redeemed code becomes a link: which device or gateway identity is paired,
-- and the API key it was issued (revoking the link revokes the key).
CREATE TABLE IF NOT EXISTS account_links (
	id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	agent_id     uuid REFERENCES agent_identities(id) ON DELETE SET NULL,
	kind         text NOT NULL,
	external_id  text,
	label        text,
	api_key_id   uuid REFERENCES api_keys(id) ON DELETE SET NULL,
	created_at   timestamptz NOT NULL DEFAULT now(),
	last_seen_at timestamptz,
	revoked_at   timestamptz
);
CREATE INDEX IF NOT EXISTS account_links_user_idx ON account_links (user_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS account_links_external_uidx ON account_links (kind, external_id)
	WHERE revoked_at IS NULL AND external_id IS NOT NULL;
