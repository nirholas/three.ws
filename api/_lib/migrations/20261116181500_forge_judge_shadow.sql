-- Migration: shadow log for the Forge physical-plausibility judge (NVIDIA Cosmos Reason).
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261116181500_forge_judge_shadow.sql
-- Idempotent and additive (one new table, no backfill).
--
--   forge_judge_shadow   one row per model the Forge quality gate judged with BOTH
--                        the current vision judge and Cosmos Reason. Written by
--                        api/_lib/forge-judge-shadow.js from the live gate (source
--                        'forge') and by scripts/cosmos-judge-eval.mjs (source
--                        'eval'). Both verdicts are stored as structured fields
--                        only; the model's reasoning trace is never stored.
--                        /admin/forge-judge lists the disagreements with their
--                        renders and records a human label for tuning.

create table if not exists forge_judge_shadow (
	id            bigserial   primary key,
	created_at    timestamptz not null default now(),
	-- forge | eval
	source        text        not null,
	creation_id   text,
	glb_url       text        not null,
	prompt        text,
	subject       text,
	-- R2 keys of the judging views (front, right, back, left).
	render_keys   text[]      not null default '{}',
	-- The current judge's verdict (score, defects, pass, provider, latency).
	current       jsonb,
	-- The Cosmos verdict (plausible, issues, prompt_match, confidence, pass, latency).
	cosmos        jsonb,
	current_pass  boolean,
	cosmos_pass   boolean,
	-- Both judges answered and reached opposite pass decisions.
	disagree      boolean     not null default false,
	-- FORGE_COSMOS_JUDGE mode in force: off | shadow | veto | tiebreak | primary.
	mode          text        not null,
	-- Which judge's decision shipped: current | cosmos.
	applied       text        not null default 'current',
	-- Ground truth: accepted | rejected. From the Forge keep/throw-away button
	-- (labelled_by 'forge-user') or an operator in the admin view.
	human_label   text,
	labelled_by   text,
	labelled_at   timestamptz
);

create index if not exists forge_judge_shadow_created_idx on forge_judge_shadow (created_at desc);
create index if not exists forge_judge_shadow_disagree_idx on forge_judge_shadow (created_at desc) where disagree;
create unique index if not exists forge_judge_shadow_eval_creation_idx on forge_judge_shadow (creation_id) where source = 'eval';
