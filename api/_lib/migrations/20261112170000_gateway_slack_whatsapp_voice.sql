-- Slack, WhatsApp and voice adapters on the agent gateway (docs/gateways.md).
--
--   platform checks         widened with 'voice' on gateway_links,
--                           gateway_pair_codes and gateway_inbox. Voice has two
--                           legs: the browser voice panel on
--                           /settings/connections (chat_id `web:<user id>`) and
--                           phone calls through Twilio (chat_id = the caller's
--                           E.164 number), both on the same pairing and approvals.
--   gateway_voice_turns     one row per spoken turn on a phone call. The webhook
--                           queues the recording, the worker runs the turn and
--                           writes the reply text and an MP3 clip here, and the
--                           call's poll leg plays it. `clip_id` is the
--                           unguessable id Twilio fetches the clip by. Rows are
--                           pruned by the worker after a day.
--   gateway_slack_installs  one row per Slack workspace that installed the app
--                           through OAuth (Add to Slack). The bot token is
--                           sealed with the secret box (api/_lib/secret-box.js),
--                           never stored in plaintext.

ALTER TABLE gateway_links DROP CONSTRAINT IF EXISTS gateway_links_platform_check;
ALTER TABLE gateway_links ADD CONSTRAINT gateway_links_platform_check
	CHECK (platform IN ('telegram', 'discord', 'slack', 'whatsapp', 'signal', 'sms', 'email', 'voice'));

ALTER TABLE gateway_pair_codes DROP CONSTRAINT IF EXISTS gateway_pair_codes_platform_check;
ALTER TABLE gateway_pair_codes ADD CONSTRAINT gateway_pair_codes_platform_check
	CHECK (platform IN ('telegram', 'discord', 'slack', 'whatsapp', 'signal', 'sms', 'email', 'voice'));

ALTER TABLE gateway_inbox DROP CONSTRAINT IF EXISTS gateway_inbox_platform_check;
ALTER TABLE gateway_inbox ADD CONSTRAINT gateway_inbox_platform_check
	CHECK (platform IN ('telegram', 'discord', 'slack', 'whatsapp', 'signal', 'sms', 'email', 'voice'));

CREATE TABLE IF NOT EXISTS gateway_voice_turns (
	id          text PRIMARY KEY,
	call_sid    text NOT NULL,
	caller      text NOT NULL,
	status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed')),
	reply_text  text,
	clip_id     uuid UNIQUE,
	clip        bytea,
	clip_mime   text,
	created_at  timestamptz NOT NULL DEFAULT now(),
	finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS gateway_voice_turns_created_idx ON gateway_voice_turns (created_at);

CREATE TABLE IF NOT EXISTS gateway_slack_installs (
	team_id      text PRIMARY KEY,
	team_name    text,
	bot_user_id  text,
	bot_token    text NOT NULL,
	installed_by uuid REFERENCES users(id) ON DELETE SET NULL,
	created_at   timestamptz NOT NULL DEFAULT now(),
	updated_at   timestamptz NOT NULL DEFAULT now(),
	revoked_at   timestamptz
);
