-- Discord Activity shared state: everyone in the same voice-channel Activity
-- instance sees the same Forge round. api/discord-activity/room.js is the only
-- reader/writer, through api/_lib/discord-activity/store.js. No wallet, coin or
-- credit columns on purpose: the Activity experience never touches either.
--
--   discord_activity_rooms          one row per Discord Activity instance
--                                    (discordSdk.instanceId), holding the
--                                    current round's phase and, once a prompt
--                                    wins the vote, that round's generation job.
--   discord_activity_participants   who is currently in the Activity, keyed by
--                                    Discord user id so a rejoin just touches
--                                    last_seen_at.
--   discord_activity_prompts        this round's Forge prompt suggestions.
--   discord_activity_votes          one vote per Discord user per round; voting
--                                    again moves the same row (re-vote, not a
--                                    second vote).
--
-- A round's prompts and votes are deleted when the room cycles back to
-- 'propose' (store.js), so these tables only ever hold the live round plus
-- whichever round is still in 'generating' or 'reveal'.

CREATE TABLE IF NOT EXISTS discord_activity_rooms (
	instance_id        text PRIMARY KEY,
	guild_id           text,
	channel_id         text,
	phase              text NOT NULL DEFAULT 'propose'
		CHECK (phase IN ('propose', 'vote', 'generating', 'reveal')),
	current_prompt_id  uuid,
	generation_job_id  text,
	generation_status  text,
	generation_glb_url text,
	generation_error   text,
	phase_started_at   timestamptz NOT NULL DEFAULT now(),
	created_at         timestamptz NOT NULL DEFAULT now(),
	updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS discord_activity_participants (
	instance_id     text NOT NULL REFERENCES discord_activity_rooms(instance_id) ON DELETE CASCADE,
	discord_user_id text NOT NULL,
	username        text,
	global_name     text,
	avatar          text,
	joined_at       timestamptz NOT NULL DEFAULT now(),
	last_seen_at    timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (instance_id, discord_user_id)
);

CREATE TABLE IF NOT EXISTS discord_activity_prompts (
	id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	instance_id     text NOT NULL REFERENCES discord_activity_rooms(instance_id) ON DELETE CASCADE,
	discord_user_id text NOT NULL,
	prompt          text NOT NULL CHECK (char_length(prompt) BETWEEN 1 AND 200),
	created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS discord_activity_prompts_instance_idx
	ON discord_activity_prompts (instance_id, created_at);

CREATE TABLE IF NOT EXISTS discord_activity_votes (
	instance_id     text NOT NULL REFERENCES discord_activity_rooms(instance_id) ON DELETE CASCADE,
	prompt_id       uuid NOT NULL REFERENCES discord_activity_prompts(id) ON DELETE CASCADE,
	discord_user_id text NOT NULL,
	created_at      timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (instance_id, discord_user_id)
);
CREATE INDEX IF NOT EXISTS discord_activity_votes_prompt_idx
	ON discord_activity_votes (prompt_id);
