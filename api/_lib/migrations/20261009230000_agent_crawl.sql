-- Migration: the Crawl, agents that read the open web in real browsers.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261009230000_agent_crawl.sql
-- Idempotent.
--
-- crawl_missions is the roster: one row per agent sent out to read, holding the
-- topic it reads toward and the seed URLs it starts from. Only the agent's owner
-- writes a row (api/crawl/[action].js action=mission), and the always-on worker
-- (workers/agent-crawler) reads the enabled rows to decide who walks.
--
-- crawl_pages is the corpus: one row per page an agent finished reading, with a
-- short extractive gist and a token count. The full cleaned text lives in object
-- storage under text_key so the table stays small enough for Neon; a page with
-- no storage configured keeps its gist and drops the body.

create table if not exists crawl_missions (
	agent_id     uuid        primary key references agent_identities(id) on delete cascade,
	topic        text        not null check (char_length(topic) between 2 and 120),
	seeds        text[]      not null default '{}',
	enabled      boolean     not null default true,
	set_by       uuid        references users(id) on delete set null,
	pages_read   bigint      not null default 0,
	tokens_read  bigint      not null default 0,
	last_url     text,
	last_at      timestamptz,
	created_at   timestamptz not null default now(),
	updated_at   timestamptz not null default now()
);

create index if not exists crawl_missions_enabled_idx
	on crawl_missions (last_at asc nulls first)
	where enabled = true;

create table if not exists crawl_pages (
	id          bigserial   primary key,
	agent_id    uuid        not null references agent_identities(id) on delete cascade,
	url         text        not null,
	url_hash    text        not null,
	domain      text        not null,
	title       text,
	gist        text,
	tokens      integer     not null default 0,
	links_out   integer     not null default 0,
	relevance   real,
	from_url    text,
	text_key    text,
	created_at  timestamptz not null default now(),
	unique (agent_id, url_hash)
);

create index if not exists crawl_pages_created_idx on crawl_pages (created_at desc);
create index if not exists crawl_pages_agent_idx on crawl_pages (agent_id, created_at desc);
create index if not exists crawl_pages_domain_idx on crawl_pages (domain);
create index if not exists crawl_pages_url_hash_idx on crawl_pages (url_hash);
