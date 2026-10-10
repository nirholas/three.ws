-- Migration: account linking (Telegram sign-in, link codes, linked devices,
-- proved external payout wallets).
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261011003000_account_linking.sql
-- Idempotent.
--
-- Library: api/_lib/account-link/*.js. Docs: docs/chat-gateways.md and
-- docs/authentication.md.
--
--   user_identities.provider   widened so Telegram can be a sign-in method
--                              beside Google. `subject` is the numeric Telegram
--                              user id, which never changes; the username can.
--   telegram_login_tokens      one row per magic link (/start tl_...) or
--                              per widget round trip. The browser holds only
--                              a poll secret; the bot chat holds the token.
--                              Both are stored hashed, used once, and expire
--                              in minutes.
--   telegram_login_replays     every accepted widget payload, keyed by the hash
--                              Telegram signed, so the same payload can never
--                              open a session twice inside the freshness window.
--   account_link_codes         short-lived one-time codes minted on the site
--                              that link a phone, desktop app, CLI or Telegram
--                              chat. The device claims the code, the signed-in
--                              session sees what is asking and confirms, and
--                              only then is a credential issued.
--   account_linked_devices     one row per link, pointing at the credential it
--                              produced (a session, an API key or a gateway
--                              link) so the account page can list and revoke.
--   agent_payout_wallets       gains proof and cooldown columns: a wallet set
--                              through the proved flow records the signature,
--                              and a replacement only takes effect after a
--                              cooldown and (for an agent-initiated change)
--                              the owner's approval.

alter table user_identities drop constraint if exists user_identities_provider_check;
alter table user_identities add constraint user_identities_provider_check
	check (provider in ('google', 'telegram'));

create table if not exists telegram_login_tokens (
	id               uuid primary key default gen_random_uuid(),
	token_hash       text unique,
	poll_secret_hash text not null unique,
	intent           text not null check (intent in ('login', 'link')),
	user_id          uuid references users(id) on delete cascade,
	next             text,
	claims           jsonb,
	status           text not null default 'issued'
	                 check (status in ('issued', 'claimed', 'completed', 'expired')),
	created_at       timestamptz not null default now(),
	expires_at       timestamptz not null,
	claimed_at       timestamptz,
	completed_at     timestamptz,
	result_user_id   uuid references users(id) on delete cascade
);
create index if not exists telegram_login_tokens_expires_idx on telegram_login_tokens (expires_at);

create table if not exists telegram_login_replays (
	payload_hash text primary key,
	auth_date    timestamptz not null,
	created_at   timestamptz not null default now()
);
create index if not exists telegram_login_replays_auth_date_idx on telegram_login_replays (auth_date);

create table if not exists account_link_codes (
	id                 uuid primary key default gen_random_uuid(),
	code_hash          text not null unique,
	user_id            uuid not null references users(id) on delete cascade,
	device_kind        text not null check (device_kind in ('phone', 'desktop', 'cli', 'telegram')),
	label              text,
	requested_scope    text,
	status             text not null default 'issued'
	                   check (status in ('issued', 'claimed', 'confirmed', 'rejected', 'consumed', 'expired')),
	claim              jsonb,
	claim_secret_hash  text unique,
	result_kind        text check (result_kind in ('session', 'api_key', 'gateway_link')),
	result_id          uuid,
	result_secret      text,
	device_id          uuid,
	created_at         timestamptz not null default now(),
	expires_at         timestamptz not null,
	claimed_at         timestamptz,
	decided_at         timestamptz,
	consumed_at        timestamptz
);
create index if not exists account_link_codes_user_idx on account_link_codes (user_id, created_at desc);

create table if not exists account_linked_devices (
	id              uuid primary key default gen_random_uuid(),
	user_id         uuid not null references users(id) on delete cascade,
	kind            text not null check (kind in ('phone', 'desktop', 'cli', 'telegram')),
	label           text not null,
	meta            jsonb not null default '{}'::jsonb,
	credential_kind text not null check (credential_kind in ('session', 'api_key', 'gateway_link')),
	credential_id   uuid not null,
	link_code_id    uuid references account_link_codes(id) on delete set null,
	linked_at       timestamptz not null default now(),
	revoked_at      timestamptz
);
create index if not exists account_linked_devices_user_idx on account_linked_devices (user_id, linked_at desc);
create unique index if not exists account_linked_devices_credential_uidx
	on account_linked_devices (credential_kind, credential_id);

alter table agent_payout_wallets add column if not exists effective_at timestamptz not null default now();
alter table agent_payout_wallets add column if not exists approved_at timestamptz;
alter table agent_payout_wallets add column if not exists approval_request_id uuid;
alter table agent_payout_wallets add column if not exists proof_chain text;
alter table agent_payout_wallets add column if not exists proof_signature_hash text;
alter table agent_payout_wallets add column if not exists verified_at timestamptz;
alter table agent_payout_wallets add column if not exists set_by text;
-- Wallets that existed before this migration were set by their owner in a
-- signed-in session and have been paying out all along: they stay approved.
update agent_payout_wallets set approved_at = created_at where approved_at is null;
