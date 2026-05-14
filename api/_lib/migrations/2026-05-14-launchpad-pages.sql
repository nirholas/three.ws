-- Migration: launchpad_pages
--
-- Backs the Launchpad Studio (src/editor/launchpad-studio.js + /launchpad).
-- A row represents one published, hosted public profile served at /p/<slug>.
-- The full editor state is persisted as JSONB so adding a new template field
-- (or a new template entirely) does not require a schema change.
--
-- Idempotent: safe to re-run.

begin;

create table if not exists launchpad_pages (
	slug          text primary key,                       -- url-safe, [a-z0-9-]{1,40}
	template      text not null,                          -- token-launchpad | paid-concierge | gated-showroom
	owner_wallet  text not null,                          -- payout address (Sol base58 or 0x EVM)
	user_id       uuid references users(id) on delete set null,
	config        jsonb not null,                         -- full editor state {identity, avatar, copy, token, skill, scene, monetize}
	is_public     boolean not null default true,
	view_count    integer not null default 0,
	created_at    timestamptz not null default now(),
	updated_at    timestamptz not null default now()
);

-- Lookups by owner (dashboard "my launchpads" view).
create index if not exists launchpad_pages_owner_wallet
	on launchpad_pages (lower(owner_wallet));

create index if not exists launchpad_pages_user_id
	on launchpad_pages (user_id) where user_id is not null;

-- Browse by template type (e.g. "show me all token launchpads").
create index if not exists launchpad_pages_template
	on launchpad_pages (template) where is_public;

commit;
