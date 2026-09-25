-- Per-agent inference budgets are judged against every credit_ledger row booked
-- as model spend for one agent (ref_type 'agent'): the flat three-ws/agent rate
-- ('inference.agent') and a v1 run's paid lanes ('agent_run_step'). The older
-- partial index covers only the first action, so the budget read would scan the
-- month's ledger once runs are counted too. Additive and idempotent.

CREATE INDEX IF NOT EXISTS credit_ledger_agent_spend
	ON credit_ledger (ref_id, created_at DESC)
	WHERE ref_type = 'agent';
