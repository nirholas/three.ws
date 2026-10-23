begin;

-- Outcome-weighted memory recall.
--
--   decision_recalls, which memories were recalled into a ledger decision. Kept
--                      beside agent_decisions (not on it) so the hash-chained,
--                      immutable decision row is never touched.
--   memory_outcomes , the realized result of each decision, written onto every
--                      memory that was recalled into it when the trade/order
--                      closes. Recall ranks memories by these (bounded, decayed,
--                      never zero), so losses still surface as warnings.

create table if not exists decision_recalls (
	decision_id uuid not null references agent_decisions(id) on delete cascade,
	memory_id   uuid not null references agent_memories(id) on delete cascade,
	agent_id    uuid not null,
	created_at  timestamptz not null default now(),
	primary key (decision_id, memory_id)
);

create index if not exists decision_recalls_memory on decision_recalls(memory_id);

create table if not exists memory_outcomes (
	memory_id    uuid not null references agent_memories(id) on delete cascade,
	decision_id  uuid not null references agent_decisions(id) on delete cascade,
	agent_id     uuid not null,
	pnl_usd      double precision,
	win          boolean,
	hold_seconds bigint,
	closed_at    timestamptz not null default now(),
	primary key (memory_id, decision_id)
);

create index if not exists memory_outcomes_agent on memory_outcomes(agent_id, memory_id);

commit;
