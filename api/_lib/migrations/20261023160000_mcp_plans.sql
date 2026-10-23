begin;

-- Prepaid plans for paid MCP tools.
--
--   mcp_plans         - the catalog: a credit bundle or a time pass, its USD price
--                       and the tools it covers (empty list = every metered tool).
--   mcp_plan_balances - what an account holds after buying a plan. A bundle row
--                       counts down credits_remaining; a time pass row carries
--                       expires_at and covers unlimited calls until then.
--   mcp_credit_events - append-only history of every debit, refund, trial use and
--                       time-pass call, shown on the account page.
--   mcp_tool_trials   - free calls used per account per tool.
--
-- One credit is worth $0.001 of a tool's per-call x402 price.

create table if not exists mcp_plans (
	id               uuid primary key default gen_random_uuid(),
	slug             text not null unique,
	name             text not null,
	description      text not null default '',
	kind             text not null check (kind in ('credits', 'time')),
	credits          integer check (credits is null or credits > 0),
	duration_seconds integer check (duration_seconds is null or duration_seconds > 0),
	price_usd        numeric(20, 6) not null check (price_usd > 0),
	tools            text[] not null default '{}',
	active           boolean not null default true,
	sort_order       integer not null default 0,
	created_at       timestamptz not null default now(),
	check ((kind = 'credits' and credits is not null and duration_seconds is null)
	    or (kind = 'time' and duration_seconds is not null and credits is null))
);

create table if not exists mcp_plan_balances (
	id                uuid primary key default gen_random_uuid(),
	user_id           uuid not null references users(id) on delete cascade,
	plan_id           uuid not null references mcp_plans(id),
	kind              text not null check (kind in ('credits', 'time')),
	credits_total     integer,
	credits_remaining integer check (credits_remaining is null or credits_remaining >= 0),
	tools             text[] not null default '{}',
	expires_at        timestamptz,
	purchase_key      text not null unique,
	created_at        timestamptz not null default now()
);

create index if not exists mcp_plan_balances_user on mcp_plan_balances(user_id, created_at desc);

create table if not exists mcp_credit_events (
	id           uuid primary key default gen_random_uuid(),
	user_id      uuid not null references users(id) on delete cascade,
	balance_id   uuid references mcp_plan_balances(id) on delete set null,
	tool         text not null,
	kind         text not null check (kind in ('debit', 'refund', 'trial', 'time_pass')),
	credits      integer not null default 0,
	created_at   timestamptz not null default now()
);

create index if not exists mcp_credit_events_user on mcp_credit_events(user_id, created_at desc);

create table if not exists mcp_tool_trials (
	user_id    uuid not null references users(id) on delete cascade,
	tool       text not null,
	used       integer not null default 0 check (used >= 0),
	updated_at timestamptz not null default now(),
	primary key (user_id, tool)
);

insert into mcp_plans (slug, name, description, kind, credits, duration_seconds, price_usd, sort_order)
values
	('starter-500', 'Starter', '500 credits for any paid MCP tool. Credits do not expire.', 'credits', 500, null, 5, 10),
	('builder-3000', 'Builder', '3,000 credits for any paid MCP tool, 20% cheaper per credit than Starter.', 'credits', 3000, null, 24, 20),
	('studio-day', 'Studio day pass', 'Unlimited calls to every paid MCP tool for 24 hours.', 'time', null, 86400, 12, 30),
	('studio-month', 'Studio month', 'Unlimited calls to every paid MCP tool for 30 days.', 'time', null, 2592000, 149, 40)
on conflict (slug) do nothing;

commit;
