-- More chat gateways: Slack, WhatsApp, Signal, SMS and email-as-chat on the same
-- gateway tables as Telegram and Discord (20260922180000_chat_gateways.sql), plus
-- spoken replies and a per-account notification channel (docs/chat-gateways.md).
--
--   platform checks       widened on gateway_links, gateway_pair_codes and
--                         gateway_inbox so every channel shares one pairing,
--                         queue and approval path.
--   voice_replies         the owner turned on spoken replies for this chat: the
--                         agent's text reply is followed by the same reply as
--                         audio on channels that can play it.
--   preferred             the one chat the owner wants notifications in. When an
--                         account has a preferred chat, notifications go there
--                         only; otherwise every chat with notify on gets them.
--   gateway_reply_codes   SMS, Signal and email have no buttons. A preview there
--                         is answered by replying "APPROVE 123456" or
--                         "CANCEL 123456": a six-digit code bound to one chat and
--                         one preview, stored as a sha256, single use, and dead
--                         when the preview behind it expires. Free text never
--                         matches a code.

ALTER TABLE gateway_links DROP CONSTRAINT IF EXISTS gateway_links_platform_check;
ALTER TABLE gateway_links ADD CONSTRAINT gateway_links_platform_check
	CHECK (platform IN ('telegram', 'discord', 'slack', 'whatsapp', 'signal', 'sms', 'email'));

ALTER TABLE gateway_pair_codes DROP CONSTRAINT IF EXISTS gateway_pair_codes_platform_check;
ALTER TABLE gateway_pair_codes ADD CONSTRAINT gateway_pair_codes_platform_check
	CHECK (platform IN ('telegram', 'discord', 'slack', 'whatsapp', 'signal', 'sms', 'email'));

ALTER TABLE gateway_inbox DROP CONSTRAINT IF EXISTS gateway_inbox_platform_check;
ALTER TABLE gateway_inbox ADD CONSTRAINT gateway_inbox_platform_check
	CHECK (platform IN ('telegram', 'discord', 'slack', 'whatsapp', 'signal', 'sms', 'email'));

ALTER TABLE gateway_links ADD COLUMN IF NOT EXISTS voice_replies boolean NOT NULL DEFAULT false;
ALTER TABLE gateway_links ADD COLUMN IF NOT EXISTS preferred boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS gateway_links_one_preferred_uidx
	ON gateway_links (user_id) WHERE preferred AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS gateway_reply_codes (
	id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	link_id     uuid NOT NULL REFERENCES gateway_links(id) ON DELETE CASCADE,
	preview_id  uuid NOT NULL REFERENCES gateway_previews(id) ON DELETE CASCADE,
	code_hash   text NOT NULL,
	created_at  timestamptz NOT NULL DEFAULT now(),
	expires_at  timestamptz NOT NULL,
	used_at     timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS gateway_reply_codes_link_code_uidx
	ON gateway_reply_codes (link_id, code_hash);
CREATE INDEX IF NOT EXISTS gateway_reply_codes_preview_idx ON gateway_reply_codes (preview_id);
