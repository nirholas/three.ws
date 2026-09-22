-- The always-on strategy loop: a running agent observes, reasons and acts on a
-- cadence, one bounded tick at a time, executed by workers/strategy-loop.
--
-- Library: api/_lib/strategy-loop/. Routes: /api/v1/agents/:id/loop.
-- Guide: docs/agent-runtime.md "The strategy loop".

-- ── lifecycle ────────────────────────────────────────────────────────────────
-- The loop only ticks an agent whose lifecycle status is 'running'. The agents
-- v1 migration (20260922130000_agents_v1_api.sql) introduces the same column;
-- both statements are idempotent so either migration may land first.
ALTER TABLE agent_identities ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'running';
ALTER TABLE agent_identities ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;
DO $$ BEGIN
	ALTER TABLE agent_identities ADD CONSTRAINT agent_identities_status_check CHECK (status IN ('running', 'stopped'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── loop settings ────────────────────────────────────────────────────────────
-- One row per agent that has a loop. `enabled` is the owner's switch; the
-- agent's lifecycle status gates it too, so `stop` halts the loop without
-- losing its settings. Caps are per UTC day and apply to loop ticks only,
-- never to manual chat. `paused_*` records why the loop is waiting and until
-- when (a hit cap waits for the next UTC day, a frozen wallet re-checks every
-- interval); the worker clears it once the reason is gone.
CREATE TABLE IF NOT EXISTS agent_loops (
	agent_id              uuid PRIMARY KEY REFERENCES agent_identities(id) ON DELETE CASCADE,
	user_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	enabled               boolean NOT NULL DEFAULT false,
	strategy_id           text,
	goal                  text,
	interval_seconds      int NOT NULL DEFAULT 300 CHECK (interval_seconds BETWEEN 60 AND 86400),
	tools                 text[] NOT NULL DEFAULT '{}',
	financial_enabled     boolean NOT NULL DEFAULT false,
	max_steps             int NOT NULL DEFAULT 12 CHECK (max_steps BETWEEN 3 AND 40),
	daily_credit_cap_usd  numeric(20, 6) NOT NULL DEFAULT 0.5 CHECK (daily_credit_cap_usd >= 0),
	daily_usdc_cap_usd    numeric(20, 6) NOT NULL DEFAULT 0 CHECK (daily_usdc_cap_usd >= 0),
	next_tick_at          timestamptz,
	last_tick_at          timestamptz,
	last_tick_status      text,
	consecutive_errors    int NOT NULL DEFAULT 0,
	errors_alerted_at     timestamptz,
	paused_reason         text,
	paused_detail         text,
	paused_at             timestamptz,
	paused_until          timestamptz,
	created_at            timestamptz NOT NULL DEFAULT now(),
	updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_loops_due_idx ON agent_loops (next_tick_at) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS agent_loops_user_idx ON agent_loops (user_id);

-- ── leases ───────────────────────────────────────────────────────────────────
-- A worker owns an agent's loop while lease_until is in the future and extends
-- it with a heartbeat. A worker that dies stops heartbeating, the lease lapses,
-- and the next worker to sweep claims the agent and resumes its open tick from
-- the checkpoint. `claims` counts ownership grants, `reclaims` the ones that
-- took over a lapsed lease held by a different worker.
CREATE TABLE IF NOT EXISTS agent_leases (
	agent_id      uuid PRIMARY KEY REFERENCES agent_identities(id) ON DELETE CASCADE,
	worker_id     text NOT NULL,
	leased_at     timestamptz NOT NULL DEFAULT now(),
	heartbeat_at  timestamptz NOT NULL DEFAULT now(),
	lease_until   timestamptz NOT NULL,
	tick_id       uuid,
	claims        int NOT NULL DEFAULT 1,
	reclaims      int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS agent_leases_worker_idx ON agent_leases (worker_id);

-- ── ticks ────────────────────────────────────────────────────────────────────
-- One tick per (agent, slot): the slot is the scheduled time, so a retried or
-- reclaimed tick can never run twice. `checkpoint` is the agent loop's
-- { state, context } after the last completed step, which is all a new worker
-- needs to resume. `previews` holds trade previews issued inside the tick,
-- keyed by preview id, so an execute after a crash still finds its preview.
CREATE TABLE IF NOT EXISTS agent_loop_ticks (
	id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	agent_id           uuid NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
	user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	slot               timestamptz NOT NULL,
	status             text NOT NULL DEFAULT 'running'
		CHECK (status IN ('running', 'completed', 'failed', 'cancelled', 'budget_exhausted')),
	strategy_id        text,
	goal               text NOT NULL,
	checkpoint         jsonb,
	previews           jsonb NOT NULL DEFAULT '{}'::jsonb,
	step_count         int NOT NULL DEFAULT 0,
	event_seq          int NOT NULL DEFAULT 0,
	spent_credits_usd  numeric(20, 6) NOT NULL DEFAULT 0,
	spent_usd          numeric(20, 6) NOT NULL DEFAULT 0,
	actions            int NOT NULL DEFAULT 0,
	summary            text,
	error              text,
	worker_id          text,
	attempts           int NOT NULL DEFAULT 1,
	started_at         timestamptz NOT NULL DEFAULT now(),
	updated_at         timestamptz NOT NULL DEFAULT now(),
	finished_at        timestamptz,
	UNIQUE (agent_id, slot)
);
CREATE INDEX IF NOT EXISTS agent_loop_ticks_agent_idx ON agent_loop_ticks (agent_id, started_at DESC);
CREATE INDEX IF NOT EXISTS agent_loop_ticks_open_idx ON agent_loop_ticks (agent_id) WHERE status = 'running';

CREATE TABLE IF NOT EXISTS agent_loop_tick_steps (
	id              bigserial PRIMARY KEY,
	tick_id         uuid NOT NULL REFERENCES agent_loop_ticks(id) ON DELETE CASCADE,
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
	cost_usd        numeric(20, 6),
	latency_ms      int,
	created_at      timestamptz NOT NULL DEFAULT now(),
	UNIQUE (tick_id, seq)
);
