-- Device links for the `three-ws` CLI (api/cli/[action].js, /cli/authorize).
--
-- `three-ws login --key` (and `setup` when the loopback OAuth redirect cannot
-- reach the terminal, e.g. over SSH) starts a link: the CLI receives a secret
-- device code it keeps to itself and a short user code it prints next to a URL.
-- The person opens /cli/authorize, signs in, checks that the code on the page is
-- the one in their terminal, and approves the scopes. The CLI polls with the
-- device code and, on the first poll after approval, receives a freshly minted
-- API key exactly once. This is the RFC 8628 device authorization grant shape,
-- issuing a three.ws API key instead of an OAuth token.
--
--   device_code_hash  sha256 of the device code. The plaintext is only ever in
--                     the CLI's memory, so a read of this table cannot finish a
--                     link that somebody else started.
--   user_code         What the person types or compares, XXXX-XXXX from an
--                     unambiguous consonant alphabet. Unique while it lives.
--   requested_scope   What the CLI asked for. The approver may narrow it.
--   granted_scope     What the approver allowed; the minted key carries this.
--   status            pending -> approved | denied, then approved -> consumed
--                     when the key is handed over. A consumed row never mints
--                     again, which is what makes the key single delivery.
--   api_key_id        The key this link minted, so /settings can say which
--                     machine a key came from and revoking it is one click.

create table if not exists cli_link_requests (
	id                uuid primary key default gen_random_uuid(),
	device_code_hash  text not null unique,
	user_code         text not null unique,
	client_name       text not null,
	hostname          text,
	requested_scope   text not null,
	granted_scope     text,
	user_id           uuid references users(id) on delete cascade,
	status            text not null default 'pending'
	                  check (status in ('pending', 'approved', 'denied', 'consumed')),
	api_key_id        uuid references api_keys(id) on delete set null,
	created_ip        text,
	created_at        timestamptz not null default now(),
	expires_at        timestamptz not null,
	decided_at        timestamptz,
	consumed_at       timestamptz,
	last_polled_at    timestamptz
);

create index if not exists cli_link_requests_expires_idx on cli_link_requests (expires_at);
create index if not exists cli_link_requests_user_idx on cli_link_requests (user_id) where user_id is not null;
