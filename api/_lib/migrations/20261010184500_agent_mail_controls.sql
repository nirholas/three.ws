-- Agent mail controls: the owner's guardrails and routing rules for an agent's
-- mailbox (api/_lib/mail/controls.js, api/_lib/mail/rules.js, docs/agent-mail.md).
--
--   agent_mail_policies     one row per agent. allowlist_enabled restricts
--                           every outbound send to the addresses and @domains in
--                           `allowlist`; daily_send_cap is the owner's own ceiling
--                           on sends per rolling 24 hours, applied on top of the
--                           platform's warm-up limits (null means the warm-up
--                           limit alone). No row means no allowlist and no cap.
--   agent_mail_rules        "when mail arrives from X, do Y". A rule matches on
--                           the sender (an address or an @domain) and optionally
--                           a subject substring. mode 'approve' parks every match
--                           for the owner to approve before anything runs;
--                           mode 'auto' starts an agent run at once. The run uses
--                           the read-only tool registry and receives the message
--                           only as delimited, untrusted data.
--   agent_mail_rule_events  one row per (rule, message) match, so a message never
--                           fires the same rule twice. status tracks the match
--                           from pending through approval or dismissal to the run
--                           it started.

create table if not exists agent_mail_policies (
	agent_id          uuid primary key references agent_identities(id) on delete cascade,
	user_id           uuid not null references users(id) on delete cascade,
	allowlist_enabled boolean not null default false,
	allowlist         text[] not null default '{}',
	daily_send_cap    integer check (daily_send_cap is null or (daily_send_cap >= 0 and daily_send_cap <= 10000)),
	updated_at        timestamptz not null default now()
);

create table if not exists agent_mail_rules (
	id            uuid primary key default gen_random_uuid(),
	agent_id      uuid not null references agent_identities(id) on delete cascade,
	user_id       uuid not null references users(id) on delete cascade,
	name          text not null,
	enabled       boolean not null default true,
	match_from    text not null,
	match_subject text,
	mode          text not null default 'approve' check (mode in ('approve', 'auto')),
	prompt        text not null,
	fire_count    integer not null default 0,
	last_fired_at timestamptz,
	created_at    timestamptz not null default now(),
	updated_at    timestamptz not null default now()
);

create index if not exists agent_mail_rules_agent_idx on agent_mail_rules (agent_id) where enabled;

create table if not exists agent_mail_rule_events (
	id          uuid primary key default gen_random_uuid(),
	rule_id     uuid not null references agent_mail_rules(id) on delete cascade,
	agent_id    uuid not null references agent_identities(id) on delete cascade,
	user_id     uuid not null references users(id) on delete cascade,
	message_id  uuid not null references agent_mail_messages(id) on delete cascade,
	status      text not null default 'pending'
	            check (status in ('pending', 'approved', 'dismissed', 'run_started', 'failed')),
	run_id      uuid,
	error       text,
	created_at  timestamptz not null default now(),
	decided_at  timestamptz,
	unique (rule_id, message_id)
);

create index if not exists agent_mail_rule_events_agent_idx
	on agent_mail_rule_events (agent_id, created_at desc);
create index if not exists agent_mail_rule_events_pending_idx
	on agent_mail_rule_events (user_id) where status = 'pending';
