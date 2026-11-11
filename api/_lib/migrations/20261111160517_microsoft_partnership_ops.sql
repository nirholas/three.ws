-- Migration: Microsoft partnership operations (surface traffic, Partner Center analytics, alert incidents).
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261111160517_microsoft_partnership_ops.sql
-- Idempotent and additive.
--
-- The Marketplace SaaS offer already writes its own tables
-- (20261104180000_microsoft_marketplace_saas.sql). The Teams message extension
-- and the Power Platform connector wrote nothing, so nobody could tell whether
-- they were used or failing. This adds what the internal dashboard at
-- /admin/microsoft and the alert cron read:
--
--   microsoft_surface_events          one row per Teams bot activity and per
--                                     Power Platform connector call: operation,
--                                     HTTP status, latency, and the tenant or
--                                     conversation (Teams) or OAuth client and
--                                     user (connector). No message text.
--   microsoft_partner_center_reports  the scheduled query and report this
--                                     deployment created per Partner Center
--                                     analytics dataset, and the last execution
--                                     it ingested.
--   microsoft_partner_center_rows     the ingested report rows (orders, usage),
--                                     keyed so a re-delivered report upserts.
--   microsoft_alert_incidents         one row per open or resolved incident the
--                                     alert cron found, so each incident sends
--                                     exactly one message.

begin;

create table if not exists microsoft_surface_events (
	id               bigserial primary key,
	surface          text not null check (surface in ('teams_bot', 'power_platform')),
	operation        text not null,
	status           integer not null,
	latency_ms       integer,
	tenant_id        text,
	conversation_id  text,
	user_id          uuid references users(id) on delete set null,
	client_id        text,
	source           text,
	error            text,
	created_at       timestamptz not null default now()
);

create index if not exists microsoft_surface_events_surface_time
	on microsoft_surface_events (surface, created_at desc);
create index if not exists microsoft_surface_events_errors
	on microsoft_surface_events (surface, created_at desc) where status >= 500;

create table if not exists microsoft_partner_center_reports (
	dataset             text primary key,
	query_id            text,
	report_id           text,
	report_created_at   timestamptz,
	last_execution_id   text,
	last_generated_at   timestamptz,
	last_ingested_at    timestamptz,
	last_row_count      integer,
	last_error          text,
	updated_at          timestamptz not null default now()
);

create table if not exists microsoft_partner_center_rows (
	dataset          text not null,
	row_key          text not null,
	event_date       date,
	subscription_id  text,
	customer_id      text,
	customer_name    text,
	plan_id          text,
	status           text,
	quantity         numeric(18,6),
	amount           numeric(18,6),
	currency         text,
	data             jsonb not null default '{}'::jsonb,
	execution_id     text,
	ingested_at      timestamptz not null default now(),
	primary key (dataset, row_key)
);

create index if not exists microsoft_partner_center_rows_date
	on microsoft_partner_center_rows (dataset, event_date desc);

create table if not exists microsoft_alert_incidents (
	key            text primary key,
	kind           text not null,
	title          text not null,
	detail         text,
	opened_at      timestamptz not null default now(),
	last_seen_at   timestamptz not null default now(),
	resolved_at    timestamptz,
	notified_at    timestamptz,
	occurrences    integer not null default 1
);

create index if not exists microsoft_alert_incidents_open
	on microsoft_alert_incidents (opened_at desc) where resolved_at is null;

commit;
