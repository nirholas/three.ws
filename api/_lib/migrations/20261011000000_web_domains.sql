-- Web domains: registrations an agent's owner buys through Google Cloud Domains
-- and the hosts that serve an agent's public page.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261011000000_web_domains.sql
-- Idempotent.
--
-- web_domain_registrations
--   One purchase. `idempotency_key` is unique per user, so a retried
--   domain_register returns the row it already produced and never charges twice.
--   price_usd       the exact yearly price Cloud Domains quoted, which is what
--                   credits were debited. Registration is for one year, and the
--                   same price is the renewal price.
--   status          quoted -> registering -> active, or failed (credits refunded).
--   operation_name  the long-running operation to poll.
--   debit_ledger_id / refund_ledger_id  the credit_ledger rows for the charge and
--                   for the refund of a registration that did not complete.
--   expires_at      end of the paid year. With auto_renew on, the renewal cron
--                   debits the same yearly price from credits 14 days before it;
--                   if credits are short it switches the registration to manual
--                   renewal at the registrar and writes `renewal_note`.
--   contact         the registrant contact the owner supplied, kept only so the
--                   status read can show what the domain was registered to. It is
--                   never returned to another account.
--
-- web_domain_hosts
--   A host (apex or subdomain) that serves an agent's public page. The Express
--   host router reads only rows whose status is `live`.
--   status          pending_dns -> pending_cert -> live, or failed.
--   cert_name       the Google-managed ssl-certificate attached to the load
--                   balancer's HTTPS proxy for this host.
--
-- Service layer: api/_lib/domains-service.js, api/_lib/domain-connect.js.
-- Routes: /api/domains/*. MCP tools: api/_mcp/tools/domains.js.
-- Doc: docs/domains.md.

create table if not exists web_domain_registrations (
	id               uuid primary key default gen_random_uuid(),
	user_id          uuid not null references users(id) on delete cascade,
	agent_id         uuid references agent_identities(id) on delete set null,
	domain_name      text not null,
	idempotency_key  text not null,
	price_usd        numeric(12, 2) not null,
	currency         text not null default 'USD',
	years            integer not null default 1,
	auto_renew       boolean not null default true,
	privacy          text not null default 'REDACTED_CONTACT_DATA',
	status           text not null default 'registering',
	operation_name   text,
	error            text,
	contact          jsonb not null default '{}'::jsonb,
	debit_ledger_id  uuid,
	refund_ledger_id uuid,
	source           text,
	created_at       timestamptz not null default now(),
	updated_at       timestamptz not null default now(),
	registered_at    timestamptz,
	expires_at       timestamptz,
	renewal_note     text,
	constraint web_domain_registrations_status_chk
		check (status in ('registering', 'active', 'failed'))
);

create unique index if not exists web_domain_registrations_user_key
	on web_domain_registrations (user_id, idempotency_key);

-- A name can be registered once. A failed attempt does not hold the name.
create unique index if not exists web_domain_registrations_live_name
	on web_domain_registrations (lower(domain_name)) where status <> 'failed';

create index if not exists web_domain_registrations_user_created
	on web_domain_registrations (user_id, created_at desc);

create table if not exists web_domain_hosts (
	id             uuid primary key default gen_random_uuid(),
	user_id        uuid not null references users(id) on delete cascade,
	agent_id       uuid not null references agent_identities(id) on delete cascade,
	host           text not null,
	registration_id uuid references web_domain_registrations(id) on delete set null,
	status         text not null default 'pending_dns',
	dns_zone       text,
	name_servers   text[] not null default '{}',
	cert_name      text,
	error          text,
	created_at     timestamptz not null default now(),
	updated_at     timestamptz not null default now(),
	live_at        timestamptz,
	constraint web_domain_hosts_status_chk
		check (status in ('pending_dns', 'pending_cert', 'live', 'failed'))
);

create unique index if not exists web_domain_hosts_host
	on web_domain_hosts (lower(host));

create index if not exists web_domain_hosts_user
	on web_domain_hosts (user_id, created_at desc);

create index if not exists web_domain_hosts_agent
	on web_domain_hosts (agent_id);
