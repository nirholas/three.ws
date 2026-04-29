-- Migration: agent marketplace.
--
-- Adds marketplace columns to agent_identities (category, tags, is_published,
-- system_prompt, greeting, capabilities, fork_of, counters) and creates
-- agent_versions (snapshot history) and agent_bookmarks (per-user saves).
--
-- Idempotent.

begin;

alter table agent_identities
	add column if not exists category       text,
	add column if not exists tags           text[] not null default '{}',
	add column if not exists is_published   boolean not null default false,
	add column if not exists published_at   timestamptz,
	add column if not exists fork_of        uuid references agent_identities(id) on delete set null,
	add column if not exists forks_count    int not null default 0,
	add column if not exists views_count    int not null default 0,
	add column if not exists system_prompt  text,
	add column if not exists greeting       text,
	add column if not exists capabilities   jsonb not null default '{}'::jsonb;

create index if not exists agent_identities_published_idx
	on agent_identities (is_published, published_at desc)
	where deleted_at is null;

create index if not exists agent_identities_category_idx
	on agent_identities (category)
	where is_published = true and deleted_at is null;

create index if not exists agent_identities_tags_idx
	on agent_identities using gin (tags);

create index if not exists agent_identities_fork_of_idx
	on agent_identities (fork_of);

-- pg_trgm for similar-agent search by name/description.
create extension if not exists pg_trgm;

create index if not exists agent_identities_name_trgm
	on agent_identities using gin (name gin_trgm_ops);

create index if not exists agent_identities_description_trgm
	on agent_identities using gin (description gin_trgm_ops);

create table if not exists agent_versions (
	id              uuid primary key default gen_random_uuid(),
	agent_id        uuid not null references agent_identities(id) on delete cascade,
	version         int not null,
	system_prompt   text,
	greeting        text,
	category        text,
	tags            text[] not null default '{}',
	capabilities    jsonb not null default '{}'::jsonb,
	changelog       text,
	created_by      uuid references users(id) on delete set null,
	created_at      timestamptz not null default now(),
	unique (agent_id, version)
);

create index if not exists agent_versions_agent_idx
	on agent_versions (agent_id, version desc);

create table if not exists agent_bookmarks (
	user_id    uuid not null references users(id) on delete cascade,
	agent_id   uuid not null references agent_identities(id) on delete cascade,
	created_at timestamptz not null default now(),
	primary key (user_id, agent_id)
);

create index if not exists agent_bookmarks_agent_idx
	on agent_bookmarks (agent_id);

commit;
