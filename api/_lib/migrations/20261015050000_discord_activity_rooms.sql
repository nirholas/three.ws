-- Discord Activity shared state (work order 088-partners-05): one row per
-- Discord Activity instance (a voice-channel session), an append-only event
-- log participants poll/stream for the shared scene, and the roster of who is
-- in it. instance_id is Discord's own opaque activity-instance id, so it is
-- text, not a uuid; guild_id/channel_id are Discord snowflakes (text, they
-- exceed JS safe-integer range).
create table if not exists discord_activity_rooms (
	id            text        primary key,
	guild_id      text        not null,
	channel_id    text        not null,
	created_at    timestamptz not null default now(),
	last_active_at timestamptz not null default now()
);

create table if not exists discord_activity_participants (
	room_id         text        not null references discord_activity_rooms(id) on delete cascade,
	discord_user_id text        not null,
	username        text        not null,
	global_name     text,
	joined_at       timestamptz not null default now(),
	last_seen_at    timestamptz not null default now(),
	primary key (room_id, discord_user_id)
);

-- kind: 'join' | 'prompt' | 'creation' | 'vote' | 'agent_say'. payload shape
-- depends on kind; the store module is the only reader/writer so the shape
-- lives there, not in a check constraint.
create table if not exists discord_activity_events (
	id                bigserial   primary key,
	room_id           text        not null references discord_activity_rooms(id) on delete cascade,
	kind              text        not null,
	actor_discord_id  text,
	payload           jsonb       not null default '{}'::jsonb,
	created_at        timestamptz not null default now()
);

create index if not exists discord_activity_events_room_idx
	on discord_activity_events (room_id, id);
