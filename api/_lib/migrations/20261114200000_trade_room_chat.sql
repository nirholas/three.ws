-- Live spectator chat for trade rooms (/trade-rooms/:agentId).
--
-- One row per message. A room is its leader agent (agent_id). Moderation never
-- deletes: the room owner hiding a message, or its author removing it, stamps
-- hidden_at / hidden_by, and every reader filters on hidden_at is null.
create table if not exists trade_room_messages (
	id          uuid primary key default gen_random_uuid(),
	agent_id    uuid not null references agent_identities(id) on delete cascade,
	user_id     uuid not null references users(id) on delete cascade,
	body        text not null check (char_length(body) between 1 and 280),
	created_at  timestamptz not null default now(),
	hidden_at   timestamptz,
	hidden_by   uuid references users(id) on delete set null
);

-- Recent-messages read and the stream's since-cursor poll.
create index if not exists trade_room_messages_room_created_idx
	on trade_room_messages (agent_id, created_at desc);

-- The stream's moderation poll only ever looks at rows that were hidden.
create index if not exists trade_room_messages_room_hidden_idx
	on trade_room_messages (agent_id, hidden_at desc)
	where hidden_at is not null;

-- Duplicate-message guard and per-user history.
create index if not exists trade_room_messages_user_idx
	on trade_room_messages (user_id, created_at desc);
