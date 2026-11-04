-- Sniper "paid-intel" arm: an entry mode that buys its signals over x402 and
-- records the payment signature behind every decision.
--
-- decision_mode is an unconstrained TEXT column (see
-- 20260719120000_sniper_llm_experiments.sql), so 'paid_intel' needs no change
-- to it. This migration adds only:
--   * agent_sniper_strategies.intel_daily_cap_atomic: the arm's own daily USDC
--     spend cap for signal purchases (6-decimal atomics). NULL means the arm
--     has no signal budget and skips every cycle. Written by
--     scripts/sniper-paid-intel-arm.mjs, never by the strategy upsert, so the
--     existing arms and API are untouched.
--   * sniper_paid_intel_decisions: one row per candidate decision (buy or
--     skip) with the x402 receipts that paid for it.
--
-- Additive and idempotent, safe to re-run.
ALTER TABLE agent_sniper_strategies
	ADD COLUMN IF NOT EXISTS intel_daily_cap_atomic BIGINT;

CREATE TABLE IF NOT EXISTS sniper_paid_intel_decisions (
	id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
	ts                    TIMESTAMPTZ NOT NULL DEFAULT now(),
	strategy_id           UUID NOT NULL,
	agent_id              UUID NOT NULL,
	network               TEXT NOT NULL,
	mint                  TEXT,
	decision              TEXT NOT NULL,
	reason                TEXT,
	agreeing_signals      TEXT[] NOT NULL DEFAULT '{}',
	intel_spend_atomic    BIGINT,
	intel_signal_receipts JSONB
);

CREATE INDEX IF NOT EXISTS sniper_paid_intel_decisions_strategy_ts_idx
	ON sniper_paid_intel_decisions (strategy_id, ts DESC);
CREATE INDEX IF NOT EXISTS sniper_paid_intel_decisions_strategy_mint_idx
	ON sniper_paid_intel_decisions (strategy_id, mint);
