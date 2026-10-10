-- Migration: the destination whitelist. Every address an agent wallet may send
-- funds to, with a label, per-destination caps, and a cooldown before a new
-- address becomes usable, so a stolen session or a prompt-injected agent cannot
-- add an attacker address and drain the wallet in one minute.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261010160000_destination_whitelist.sql
-- Idempotent.
--
-- destination_whitelist_entries
--   status        proposed  an agent or API credential asked for the address; it
--                           is inert until the owner approves it with step-up.
--                 pending   approved, serving its cooldown. activates_at says
--                           when it becomes usable. The owner can cancel it.
--                 active    usable as a destination.
--                 cancelled a pending or proposed entry the owner cancelled.
--                 removed   a previously active entry the owner removed.
--   address_key   the comparison key: the canonical form of the address (base58
--                 for Solana, EIP-55 checksummed for EVM) lower-cased for EVM.
--                 Every lookup goes through this column, never the display value.
--   per_tx_cap_usd / daily_cap_usd
--                 optional ceilings that apply to this destination only, on top
--                 of the agent's global limits.
--   proposed_by   owner (session with step-up) | agent | api_key | oauth |
--                 legacy (grandfathered from meta.spend_limits.withdraw_allowlist).
--
-- destination_whitelist_settings
--   One row per agent. cooldown_seconds is owner-configurable and never below an
--   hour. enforced says whether outbound sends are restricted to active entries.
--   A change that LOOSENS protection (a shorter cooldown, turning enforcement
--   off) is not applied at once: it is parked in pending_change with the time it
--   takes effect, one full current cooldown away, so an attacker cannot shorten
--   the cooldown and add an address in the same minute. Tightening is instant.
--
-- destination_stepup_grants
--   A one-time permission to run ONE whitelist operation, minted after the owner
--   re-authenticates (password, wallet signature or emailed code). Bound to the
--   session, the user, the agent and a hash of the exact operation, so a grant
--   for "add address A" can never authorise "add address B". Used once.

create table if not exists destination_whitelist_entries (
	id            uuid primary key default gen_random_uuid(),
	agent_id      uuid not null references agent_identities(id) on delete cascade,
	user_id       uuid not null,
	chain         text not null check (chain in ('solana', 'evm')),
	address       text not null,
	address_key   text not null,
	label         text,
	per_tx_cap_usd numeric,
	daily_cap_usd  numeric,
	status        text not null check (status in ('proposed', 'pending', 'active', 'cancelled', 'removed')),
	proposed_by   text not null default 'owner',
	note          text,
	created_at    timestamptz not null default now(),
	updated_at    timestamptz not null default now(),
	approved_at   timestamptz,
	activates_at  timestamptz,
	activated_at  timestamptz,
	cancelled_at  timestamptz,
	removed_at    timestamptz
);

create unique index if not exists destination_whitelist_live_uq
	on destination_whitelist_entries (agent_id, chain, address_key)
	where status in ('proposed', 'pending', 'active');

create index if not exists destination_whitelist_agent_idx
	on destination_whitelist_entries (agent_id, status, created_at desc);

create index if not exists destination_whitelist_due_idx
	on destination_whitelist_entries (activates_at)
	where status = 'pending';

create table if not exists destination_whitelist_settings (
	agent_id         uuid primary key references agent_identities(id) on delete cascade,
	user_id          uuid not null,
	cooldown_seconds integer not null default 86400 check (cooldown_seconds >= 3600),
	enforced         boolean not null default false,
	pending_change   jsonb,
	updated_at       timestamptz not null default now()
);

create table if not exists destination_stepup_grants (
	id          uuid primary key default gen_random_uuid(),
	user_id     uuid not null,
	session_id  uuid not null,
	agent_id    uuid not null,
	op_hash     text not null,
	method      text not null check (method in ('password', 'wallet', 'email_code')),
	expires_at  timestamptz not null,
	used_at     timestamptz,
	created_at  timestamptz not null default now()
);

create index if not exists destination_stepup_lookup_idx
	on destination_stepup_grants (user_id, session_id, op_hash)
	where used_at is null;

-- One-time email codes for the email_code step-up method. Only the hash is stored.
create table if not exists destination_stepup_codes (
	id          uuid primary key default gen_random_uuid(),
	user_id     uuid not null,
	session_id  uuid not null,
	op_hash     text not null,
	code_hash   text not null,
	attempts    integer not null default 0,
	expires_at  timestamptz not null,
	used_at     timestamptz,
	created_at  timestamptz not null default now()
);

create index if not exists destination_stepup_codes_lookup_idx
	on destination_stepup_codes (user_id, session_id, op_hash)
	where used_at is null;

-- Grandfather every existing Solana withdraw allowlist: each address becomes an
-- active entry (no cooldown, the owner already trusted it) and enforcement stays
-- on, so nothing that was protected becomes less protected.
insert into destination_whitelist_entries
	(agent_id, user_id, chain, address, address_key, label, status, proposed_by, approved_at, activates_at, activated_at)
select a.id, a.user_id, 'solana', e.addr, e.addr, null, 'active', 'legacy', now(), now(), now()
from agent_identities a
cross join lateral jsonb_array_elements_text(
	case when jsonb_typeof(a.meta #> '{spend_limits,withdraw_allowlist}') = 'array'
	     then a.meta #> '{spend_limits,withdraw_allowlist}' else '[]'::jsonb end
) as e(addr)
where a.deleted_at is null
  and length(e.addr) between 32 and 44
on conflict do nothing;

insert into destination_whitelist_entries
	(agent_id, user_id, chain, address, address_key, label, status, proposed_by, approved_at, activates_at, activated_at)
select a.id, a.user_id, 'evm', e.addr, lower(e.addr), null, 'active', 'legacy', now(), now(), now()
from agent_identities a
cross join lateral jsonb_array_elements_text(
	case when jsonb_typeof(a.meta #> '{evm_spend_limits,withdraw_allowlist}') = 'array'
	     then a.meta #> '{evm_spend_limits,withdraw_allowlist}' else '[]'::jsonb end
) as e(addr)
where a.deleted_at is null
  and e.addr ~* '^0x[0-9a-f]{40}$'
on conflict do nothing;

insert into destination_whitelist_settings (agent_id, user_id, enforced)
select distinct on (agent_id) agent_id, user_id, true
from destination_whitelist_entries
where proposed_by = 'legacy'
on conflict (agent_id) do nothing;
