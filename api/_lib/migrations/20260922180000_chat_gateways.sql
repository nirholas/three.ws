-- Chat gateways: talk to your agent from Telegram and Discord.
--
-- The gateway worker (workers/agent-gateway) and the webhook receivers
-- (api/gateway/telegram.js, api/gateway/discord.js) share these tables through
-- api/_lib/gateway/. docs/chat-gateways.md is the user-facing guide.
--
--   agent_messages.channel  which surface a thread message came from (web, api,
--                           telegram, discord). The thread itself is created by
--                           20260922130000_agents_v1_api.sql; one thread per
--                           (agent, owner) spans every surface.
--   gateway_links           a paired chat: which platform identity and chat talk
--                           to which account, and the chat's default agent. One
--                           live link per chat, so a chat can never be paired to
--                           two accounts at once.
--   gateway_pair_codes      eight-character pairing codes, either printed by the
--                           bot (/start, /three link) and redeemed on
--                           /settings/connections, or generated on the site and
--                           pasted into the chat. Only the sha256 is stored.
--   gateway_inbox           webhook deliveries waiting for the worker. The
--                           receivers verify the platform signature, insert a row
--                           and answer at once; the worker claims rows one chat
--                           at a time so replies never overtake each other.
--   gateway_previews        a financial proposal rendered with Approve and Cancel
--                           buttons. Only a button press carrying this id, from
--                           the linked platform user, inside its ten-minute life,
--                           can execute it.

ALTER TABLE agent_messages ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'api';
DO $$ BEGIN
	ALTER TABLE agent_messages ADD CONSTRAINT agent_messages_channel_check CHECK (channel ~ '^[a-z0-9_-]{1,24}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS gateway_links (
	id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	platform          text NOT NULL CHECK (platform IN ('telegram', 'discord')),
	platform_user_id  text NOT NULL,
	platform_username text,
	chat_id           text NOT NULL,
	chat_type         text,
	chat_title        text,
	user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	default_agent_id  uuid REFERENCES agent_identities(id) ON DELETE SET NULL,
	context_reset_at  timestamptz,
	notify            boolean NOT NULL DEFAULT true,
	created_at        timestamptz NOT NULL DEFAULT now(),
	last_seen_at      timestamptz,
	revoked_at        timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS gateway_links_chat_live_uidx
	ON gateway_links (platform, chat_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS gateway_links_user_idx
	ON gateway_links (user_id, created_at DESC) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS gateway_pair_codes (
	id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	code_hash         text NOT NULL UNIQUE,
	origin            text NOT NULL CHECK (origin IN ('chat', 'site')),
	platform          text CHECK (platform IN ('telegram', 'discord')),
	platform_user_id  text,
	platform_username text,
	chat_id           text,
	chat_type         text,
	chat_title        text,
	user_id           uuid REFERENCES users(id) ON DELETE CASCADE,
	created_at        timestamptz NOT NULL DEFAULT now(),
	expires_at        timestamptz NOT NULL,
	redeemed_at       timestamptz,
	link_id           uuid REFERENCES gateway_links(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS gateway_pair_codes_user_idx ON gateway_pair_codes (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS gateway_inbox (
	id            bigserial PRIMARY KEY,
	platform      text NOT NULL CHECK (platform IN ('telegram', 'discord')),
	dedupe_key    text NOT NULL,
	chat_key      text NOT NULL,
	payload       jsonb NOT NULL,
	status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'done', 'failed')),
	attempts      int NOT NULL DEFAULT 0,
	locked_until  timestamptz,
	last_error    text,
	created_at    timestamptz NOT NULL DEFAULT now(),
	finished_at   timestamptz,
	UNIQUE (platform, dedupe_key)
);
CREATE INDEX IF NOT EXISTS gateway_inbox_open_idx ON gateway_inbox (id) WHERE status IN ('queued', 'processing');
CREATE INDEX IF NOT EXISTS gateway_inbox_chat_idx ON gateway_inbox (chat_key, id) WHERE status IN ('queued', 'processing');

CREATE TABLE IF NOT EXISTS gateway_previews (
	id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	link_id      uuid NOT NULL REFERENCES gateway_links(id) ON DELETE CASCADE,
	user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	agent_id     uuid NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
	kind         text NOT NULL CHECK (kind IN ('buy', 'sell', 'limits')),
	proposal     jsonb NOT NULL,
	message_ref  jsonb,
	status       text NOT NULL DEFAULT 'pending'
		CHECK (status IN ('pending', 'executing', 'executed', 'failed', 'cancelled', 'expired')),
	result       jsonb,
	created_at   timestamptz NOT NULL DEFAULT now(),
	expires_at   timestamptz NOT NULL,
	decided_at   timestamptz
);
CREATE INDEX IF NOT EXISTS gateway_previews_link_idx ON gateway_previews (link_id, created_at DESC);
