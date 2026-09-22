-- Agent mail: a real email inbox for every agent (api/_lib/mail/, docs/agent-mail.md).
--
-- An owner provisions one mailbox per agent, <local>@agents.three.ws. Inbound
-- mail arrives through the provider's signed webhook (api/mail/inbound.js);
-- outbound mail is metered per send and charged from the owner's credits or the
-- agent's own USDC wallet, always after a quote the caller confirmed.
--
--   agent_mailboxes       one row per provisioned address. status 'active' is
--                         the only state that receives or sends; 'disabled'
--                         keeps the history and frees nothing (addresses are
--                         never reissued to a different agent).
--   agent_mail_messages   every message in and out. Bodies are stored as the
--                         provider delivered them and are untrusted data
--                         everywhere they are read. Attachments live in object
--                         storage; `attachments` holds their keys and metadata.
--                         thread_id groups a conversation (In-Reply-To and
--                         References first, normalized subject as a fallback).
--   agent_mail_sends      the billing and delivery record for each outbound
--                         message and for the provisioning charge: what it
--                         cost, how it was paid (a credit ledger id or an
--                         on-chain signature), and the provider's delivery
--                         status as its webhooks report it.
--   agent_mail_quotes     the preview a financial action must cite. A quote
--                         binds the price, the payment source and (for a send)
--                         a hash of the exact content, expires after ten
--                         minutes, and is consumed once.

create table if not exists agent_mailboxes (
	id           uuid primary key default gen_random_uuid(),
	agent_id     uuid not null references agent_identities(id) on delete cascade,
	user_id      uuid not null references users(id) on delete cascade,
	address      text not null unique,
	local_part   text not null,
	domain       text not null,
	display_name text,
	status       text not null default 'active' check (status in ('active', 'disabled')),
	created_at   timestamptz not null default now(),
	updated_at   timestamptz not null default now()
);

create unique index if not exists agent_mailboxes_one_active_per_agent
	on agent_mailboxes (agent_id) where status = 'active';
create index if not exists agent_mailboxes_user_idx on agent_mailboxes (user_id);

create table if not exists agent_mail_messages (
	id                  uuid primary key default gen_random_uuid(),
	mailbox_id          uuid not null references agent_mailboxes(id) on delete cascade,
	direction           text not null check (direction in ('in', 'out')),
	thread_id           uuid not null,
	from_address        text not null,
	from_name           text,
	to_addresses        text[] not null default '{}',
	cc_addresses        text[] not null default '{}',
	reply_to            text[] not null default '{}',
	subject             text not null default '',
	text_body           text,
	html_body           text,
	attachments         jsonb not null default '[]'::jsonb,
	message_id          text,
	in_reply_to         text,
	references_ids      text[] not null default '{}',
	provider            text not null,
	provider_message_id text,
	read_at             timestamptz,
	spam_score          real,
	spam_verdict        text,
	virus_verdict       text,
	auth_results        jsonb not null default '{}'::jsonb,
	delivery_status     text,
	deleted_at          timestamptz,
	created_at          timestamptz not null default now()
);

create unique index if not exists agent_mail_messages_provider_uniq
	on agent_mail_messages (mailbox_id, direction, provider_message_id)
	where provider_message_id is not null;
create index if not exists agent_mail_messages_mailbox_idx
	on agent_mail_messages (mailbox_id, created_at desc) where deleted_at is null;
create index if not exists agent_mail_messages_thread_idx on agent_mail_messages (mailbox_id, thread_id);
create index if not exists agent_mail_messages_message_id_idx
	on agent_mail_messages (mailbox_id, message_id) where message_id is not null;
create index if not exists agent_mail_messages_unread_idx
	on agent_mail_messages (mailbox_id) where direction = 'in' and read_at is null and deleted_at is null;

create table if not exists agent_mail_quotes (
	id             uuid primary key default gen_random_uuid(),
	user_id        uuid not null references users(id) on delete cascade,
	agent_id       uuid not null references agent_identities(id) on delete cascade,
	kind           text not null check (kind in ('create', 'send')),
	price_usd      numeric(20, 6) not null,
	payment_source text not null check (payment_source in ('credits', 'wallet')),
	payload_hash   text not null,
	payload        jsonb not null default '{}'::jsonb,
	expires_at     timestamptz not null,
	consumed_at    timestamptz,
	created_at     timestamptz not null default now()
);

create index if not exists agent_mail_quotes_expires_idx on agent_mail_quotes (expires_at);

create table if not exists agent_mail_sends (
	id                uuid primary key default gen_random_uuid(),
	mailbox_id        uuid references agent_mailboxes(id) on delete set null,
	agent_id          uuid not null references agent_identities(id) on delete cascade,
	user_id           uuid not null references users(id) on delete cascade,
	kind              text not null check (kind in ('create', 'send')),
	quote_id          uuid unique references agent_mail_quotes(id) on delete set null,
	message_row_id    uuid references agent_mail_messages(id) on delete set null,
	cost_usd          numeric(20, 6) not null,
	payment_source    text not null check (payment_source in ('credits', 'wallet')),
	credit_ledger_id  uuid,
	signature         text,
	status            text not null default 'charging'
	                  check (status in ('charging', 'charge_failed', 'sending', 'sent', 'delivered',
	                                    'delayed', 'bounced', 'complained', 'failed', 'provisioned', 'refunded')),
	provider          text,
	provider_id       text,
	error_code        text,
	error_message     text,
	created_at        timestamptz not null default now(),
	updated_at        timestamptz not null default now()
);

create index if not exists agent_mail_sends_provider_idx on agent_mail_sends (provider_id) where provider_id is not null;
create index if not exists agent_mail_sends_mailbox_idx on agent_mail_sends (mailbox_id, created_at desc);
