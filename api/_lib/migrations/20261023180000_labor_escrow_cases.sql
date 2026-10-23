-- Labor-market escrow with an independent evaluator: one case per funded bounty
-- (api/_lib/labor-escrow-machine.js) and its append-only, hash-chained trail.
-- Mirrors ensureEscrowTables() in api/_lib/labor-escrow-ledger.js.

create table if not exists labor_escrow_cases (
	id uuid primary key default gen_random_uuid(),
	bounty_id uuid not null unique,
	job_id uuid,
	state text not null default 'funded',
	evaluator_kind text not null default 'platform',
	evaluator_agent_id uuid,
	dispute_window_seconds integer not null default 86400,
	deadline_at timestamptz not null,
	submitted_at timestamptz, attest_by timestamptz,
	attestation jsonb, attested_at timestamptz, release_at timestamptz,
	dispute jsonb, disputed_at timestamptz, arbiter_by timestamptz,
	resolution jsonb, resolved_at timestamptz,
	outcome text, settle_sig text, paid_at timestamptz,
	notified jsonb not null default '{}',
	version integer not null default 0,
	created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create index if not exists labor_escrow_cases_open
	on labor_escrow_cases (state, updated_at) where state not in ('released','refunded');

create table if not exists labor_escrow_events (
	id bigserial primary key,
	case_id uuid not null, seq integer not null,
	from_state text, to_state text not null, event text not null,
	actor text not null, reason text, data jsonb not null default '{}',
	at text not null, prev_hash text, hash text not null,
	created_at timestamptz not null default now(),
	constraint labor_escrow_events_seq unique (case_id, seq)
);
