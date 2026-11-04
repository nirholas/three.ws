-- Inference cost per LLM verdict in the sniper experiment ledger.
--
-- The experiment asks whether agents profit on new coins; net profit has to
-- subtract what the judge spent. Tokens and the provider-reported USD cost are
-- written by workers/agent-sniper/llm-judge.js next to each verdict and read by
-- scripts/sniper-experiment-report.mjs. NULL means the provider reported
-- nothing (rows from before this column, and free-chain fallback answers).
--
-- Additive and idempotent, safe to re-run.
ALTER TABLE sniper_llm_verdicts ADD COLUMN IF NOT EXISTS input_tokens  INTEGER;
ALTER TABLE sniper_llm_verdicts ADD COLUMN IF NOT EXISTS output_tokens INTEGER;
ALTER TABLE sniper_llm_verdicts ADD COLUMN IF NOT EXISTS cost_usd      NUMERIC;
