-- Migration: agent run receipts and end-of-run summaries.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261010163000_agent_run_receipts.sql
-- Idempotent.
--
-- agent_run_steps.receipt
--   A sha256 hex digest that chains every step of a run to the one before it:
--   sha256(prev_receipt | run_id | seq | kind | tool | input | output). A replay
--   or an MCP client can recompute the chain from the step rows and prove that
--   no tool call or tool result was edited, dropped or reordered after the
--   fact. Rows written before this migration keep a null receipt; the chain
--   starts at the first step written after it.
--
-- agent_runs.summary
--   A plain-language account of how a run ended (status, turns, tool calls by
--   name, spend against budget, duration and the result or error), written once
--   when the run reaches a terminal status. The agent page replay view and the
--   MCP run tools show it verbatim.

alter table agent_run_steps add column if not exists receipt text;
alter table agent_runs add column if not exists summary text;
