-- Migration: day-0 NIM release evaluations.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261116170833_nim_release_evals.sql
-- Idempotent and additive (one new table, no backfill).
--
--   nim_release_evals   one row per NVIDIA NIM model id the catalog watch in
--                       /api/cron/free-model-audit saw appear. The audit only
--                       inserts a queued row (unique on model_id, so a second
--                       sighting is a no-op); /api/cron/nim-release-eval claims
--                       one row per run, classifies the model by probing it,
--                       runs the lane's eval set (data/evals/<lane>/) against it
--                       and the lane's current first rung, and stores the
--                       verdict, the full report, the config diff that would
--                       wire it, and a post draft. Nothing in this table is read
--                       by a production lane: applying a diff is a human step.

create table if not exists nim_release_evals (
	id              bigserial   primary key,
	model_id        text        not null unique,
	owned_by        text,
	-- catalog-watch (the audit cron) | backfill | manual (admin requeue / CLI)
	source          text        not null default 'catalog-watch',
	-- queued | running | done | failed
	status          text        not null default 'queued'
	                check (status in ('queued', 'running', 'done', 'failed')),
	attempts        integer     not null default 0,
	-- chat | vision | embeddings | rerank | safety, null when no lane answered
	lane            text,
	classification  jsonb,
	-- adopt | hold | reject | skip
	verdict         text,
	report          jsonb,
	report_md       text,
	config_diff     text,
	post_draft      text,
	last_error      text,
	created_at      timestamptz not null default now(),
	started_at      timestamptz,
	completed_at    timestamptz,
	updated_at      timestamptz not null default now()
);

create index if not exists nim_release_evals_queue_idx on nim_release_evals (status, created_at);
create index if not exists nim_release_evals_recent_idx on nim_release_evals (created_at desc);
