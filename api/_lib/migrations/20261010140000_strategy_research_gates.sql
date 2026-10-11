-- Migration: Strategy Object v2 settings (research gates, price impact, ask mode).
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261010140000_strategy_research_gates.sql
-- Idempotent.
--
-- strategy_candidate_decisions
--   One row per (equip, mint): the latest verdict the equipped-strategy runtime
--   reached for a candidate that passed the entry filter. `decision` is
--   blocked (a research gate refused it), approval (ask mode filed an approval
--   request), executed, skipped (a spend guard refused it), or failed.
--   `check_name` is the gate or guard that decided it and `reason` says why in
--   plain language; `report` is the cited gate report the decision was made on.
--   A coin re-evaluated on a later sweep updates its row (seen_count counts the
--   sweeps), so the log stays bounded while a coin that later clears a gate shows
--   its newest verdict.
--
-- Backfill: every stored Strategy Object config and every equip snapshot that
-- has no `mode` becomes version 2 in ask mode. Ask is the conservative default:
-- an existing strategy now files an approval request for each buy until its
-- owner explicitly switches it to auto. Configs that already carry a mode are
-- left untouched.

create table if not exists strategy_candidate_decisions (
	id            bigserial   primary key,
	equip_id      uuid        not null references agent_strategy_equips(id) on delete cascade,
	strategy_id   uuid,
	agent_id      uuid        not null references agent_identities(id) on delete cascade,
	owner_id      uuid        not null references users(id) on delete cascade,
	network       text        not null default 'mainnet',
	mint          text        not null,
	decision      text        not null check (decision in ('blocked', 'approval', 'executed', 'skipped', 'failed')),
	check_name    text,
	reason        text,
	blocked_by    jsonb       not null default '[]'::jsonb,
	report        jsonb,
	approval_id   uuid,
	signature     text,
	seen_count    int         not null default 1,
	created_at    timestamptz not null default now(),
	updated_at    timestamptz not null default now()
);

create unique index if not exists strategy_candidate_decisions_equip_mint_idx
	on strategy_candidate_decisions (equip_id, mint);
create index if not exists strategy_candidate_decisions_agent_idx
	on strategy_candidate_decisions (agent_id, updated_at desc);
create index if not exists strategy_candidate_decisions_owner_idx
	on strategy_candidate_decisions (owner_id, updated_at desc);

update agent_strategies
	set config = config || '{"version": 2, "mode": "ask"}'::jsonb
	where not (config ? 'mode');

update agent_strategy_equips
	set config_snapshot = config_snapshot || '{"version": 2, "mode": "ask"}'::jsonb
	where config_snapshot is not null and not (config_snapshot ? 'mode');
