// api/_lib/gateway/discord-activity-store.js against a real in-process
// Postgres (PGlite): the room/participant/event tables plus the fold that
// produces one snapshot both a fresh GET and a reconnecting SSE client agree
// on. No mocked SQL semantics: this is the real jsonb insert, the real
// ON CONFLICT upsert, the real ORDER BY.

import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { createPgliteSql } from './_helpers/pglite-sql.js';

const holder = vi.hoisted(() => ({ db: null }));

vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';

const DDL = `
	create table discord_activity_rooms (
		id text primary key,
		guild_id text not null,
		channel_id text not null,
		created_at timestamptz not null default now(),
		last_active_at timestamptz not null default now()
	);
	create table discord_activity_participants (
		room_id text not null references discord_activity_rooms(id) on delete cascade,
		discord_user_id text not null,
		username text not null,
		global_name text,
		joined_at timestamptz not null default now(),
		last_seen_at timestamptz not null default now(),
		primary key (room_id, discord_user_id)
	);
	create table discord_activity_events (
		id bigserial primary key,
		room_id text not null references discord_activity_rooms(id) on delete cascade,
		kind text not null,
		actor_discord_id text,
		payload jsonb not null default '{}'::jsonb,
		created_at timestamptz not null default now()
	);
	create index discord_activity_events_room_idx on discord_activity_events (room_id, id);
`;

let store;

beforeAll(async () => {
	store = await import('../api/_lib/gateway/discord-activity-store.js');
});

beforeEach(async () => {
	holder.db = createPgliteSql();
	await holder.db.exec(DDL);
});

describe('discord-activity-store', () => {
	it('ensureRoom is idempotent and upsertParticipant tracks who is in the room', async () => {
		await store.ensureRoom({ roomId: 'inst-1', guildId: 'g1', channelId: 'c1' });
		await store.ensureRoom({ roomId: 'inst-1', guildId: 'g1', channelId: 'c1' });
		const room = await store.getRoom('inst-1');
		expect(room.id).toBe('inst-1');

		await store.upsertParticipant({ roomId: 'inst-1', discordUserId: 'u1', username: 'alice', globalName: 'Alice' });
		await store.upsertParticipant({ roomId: 'inst-1', discordUserId: 'u1', username: 'alice', globalName: 'Alice W' });
		await store.upsertParticipant({ roomId: 'inst-1', discordUserId: 'u2', username: 'bob', globalName: null });

		const participants = await store.listParticipants('inst-1');
		expect(participants).toHaveLength(2);
		expect(participants.find((p) => p.discord_user_id === 'u1').global_name).toBe('Alice W');
	});

	it('rejects an event kind outside the fixed set', async () => {
		await store.ensureRoom({ roomId: 'inst-1', guildId: 'g1', channelId: 'c1' });
		await expect(store.appendEvent({ roomId: 'inst-1', kind: 'not_a_kind', payload: {} })).rejects.toThrow(/unknown event kind/);
	});

	it('folds the event log into one snapshot that agrees with incremental SSE reads', async () => {
		await store.ensureRoom({ roomId: 'inst-1', guildId: 'g1', channelId: 'c1' });
		await store.upsertParticipant({ roomId: 'inst-1', discordUserId: 'u1', username: 'alice', globalName: 'Alice' });
		await store.appendEvent({ roomId: 'inst-1', kind: 'join', actorDiscordId: 'u1', payload: { username: 'alice' } });
		await store.appendEvent({ roomId: 'inst-1', kind: 'prompt', actorDiscordId: 'u1', payload: { text: 'a tiny dragon' } });
		await store.appendEvent({
			roomId: 'inst-1',
			kind: 'creation',
			actorDiscordId: 'u1',
			payload: { id: 'creation-1', glb_url: 'https://cdn.example/a.glb', preview_image_url: 'https://cdn.example/a.png', prompt: 'a tiny dragon' },
		});
		await store.appendEvent({ roomId: 'inst-1', kind: 'vote', actorDiscordId: 'u1', payload: { voted: true, vote_count: 1 } });
		await store.appendEvent({ roomId: 'inst-1', kind: 'agent_say', actorDiscordId: null, payload: { text: 'nice dragon' } });

		const snapshot = await store.getRoomSnapshot('inst-1');
		expect(snapshot.prompt.text).toBe('a tiny dragon');
		expect(snapshot.creation.id).toBe('creation-1');
		expect(snapshot.creation.glbUrl).toBe('https://cdn.example/a.glb');
		expect(snapshot.voteCount).toBe(1);
		expect(snapshot.agentLines).toHaveLength(1);
		expect(snapshot.participants).toEqual([{ discordUserId: 'u1', username: 'alice', globalName: 'Alice' }]);

		const tail = await store.listEvents({ roomId: 'inst-1', afterId: 0 });
		expect(tail).toHaveLength(5);
		expect(tail[tail.length - 1].kind).toBe('agent_say');
	});

	it('a new creation event clears the vote tally from the previous one', async () => {
		await store.ensureRoom({ roomId: 'inst-1', guildId: 'g1', channelId: 'c1' });
		await store.appendEvent({ roomId: 'inst-1', kind: 'creation', actorDiscordId: 'u1', payload: { id: 'c1', glb_url: 'x', preview_image_url: 'y', prompt: 'p1' } });
		await store.appendEvent({ roomId: 'inst-1', kind: 'vote', actorDiscordId: 'u1', payload: { voted: true, vote_count: 1 } });
		await store.appendEvent({ roomId: 'inst-1', kind: 'creation', actorDiscordId: 'u2', payload: { id: 'c2', glb_url: 'x2', preview_image_url: 'y2', prompt: 'p2' } });

		const snapshot = await store.getRoomSnapshot('inst-1');
		expect(snapshot.creation.id).toBe('c2');
		expect(snapshot.voteCount).toBe(0);
	});
});
