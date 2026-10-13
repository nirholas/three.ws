// Persistence for the Discord Activity shared Forge room (work order
// 088-partners-05). One room per Discord Activity instance (a voice-channel
// session); state is derived from an append-only event log so every
// participant's SSE tail and every fresh snapshot agree with each other.
// Tables: 20261015050000_discord_activity_rooms.sql.

import { sql } from '../db.js';

export const EVENT_KINDS = ['join', 'prompt', 'creation', 'vote', 'agent_say'];
const MAX_RECENT_EVENTS = 200;

export async function ensureRoom({ roomId, guildId, channelId }) {
	const [row] = await sql`
		INSERT INTO discord_activity_rooms (id, guild_id, channel_id)
		VALUES (${roomId}, ${guildId}, ${channelId})
		ON CONFLICT (id) DO UPDATE SET last_active_at = now()
		RETURNING *`;
	return row;
}

export async function getRoom(roomId) {
	const [row] = await sql`SELECT * FROM discord_activity_rooms WHERE id = ${roomId}`;
	return row || null;
}

export async function upsertParticipant({ roomId, discordUserId, username, globalName }) {
	const [row] = await sql`
		INSERT INTO discord_activity_participants (room_id, discord_user_id, username, global_name)
		VALUES (${roomId}, ${discordUserId}, ${username}, ${globalName ?? null})
		ON CONFLICT (room_id, discord_user_id)
		DO UPDATE SET username = ${username}, global_name = ${globalName ?? null}, last_seen_at = now()
		RETURNING *`;
	return row;
}

export async function listParticipants(roomId) {
	return sql`
		SELECT discord_user_id, username, global_name, joined_at, last_seen_at
		FROM discord_activity_participants
		WHERE room_id = ${roomId}
		ORDER BY joined_at ASC`;
}

export async function appendEvent({ roomId, kind, actorDiscordId = null, payload = {} }) {
	if (!EVENT_KINDS.includes(kind)) throw new Error(`unknown event kind: ${kind}`);
	const [row] = await sql`
		INSERT INTO discord_activity_events (room_id, kind, actor_discord_id, payload)
		VALUES (${roomId}, ${kind}, ${actorDiscordId}, ${JSON.stringify(payload)}::jsonb)
		RETURNING *`;
	await sql`UPDATE discord_activity_rooms SET last_active_at = now() WHERE id = ${roomId}`;
	return row;
}

export async function listEvents({ roomId, afterId = 0, limit = MAX_RECENT_EVENTS }) {
	return sql`
		SELECT id, kind, actor_discord_id, payload, created_at
		FROM discord_activity_events
		WHERE room_id = ${roomId} AND id > ${afterId}
		ORDER BY id ASC
		LIMIT ${Math.min(limit, MAX_RECENT_EVENTS)}`;
}

/**
 * The current scene, folded from the event log: the latest prompt, the latest
 * completed creation, the vote tally for that creation, and the last few agent
 * lines. One fold keeps the GET snapshot and every SSE reconnect's "catch me up"
 * read in agreement, since both derive from the same rows.
 */
export async function getRoomSnapshot(roomId) {
	const [participants, events] = await Promise.all([
		listParticipants(roomId),
		sql`SELECT id, kind, actor_discord_id, payload, created_at FROM discord_activity_events WHERE room_id = ${roomId} ORDER BY id DESC LIMIT ${MAX_RECENT_EVENTS}`,
	]);
	const ordered = [...events].reverse();
	let prompt = null;
	let creation = null;
	const votes = new Map();
	const agentLines = [];
	for (const ev of ordered) {
		if (ev.kind === 'prompt') prompt = { text: ev.payload.text, actorDiscordId: ev.actor_discord_id, createdAt: ev.created_at };
		else if (ev.kind === 'creation') {
			creation = { id: ev.payload.id, glbUrl: ev.payload.glb_url, previewImageUrl: ev.payload.preview_image_url, prompt: ev.payload.prompt, actorDiscordId: ev.actor_discord_id, createdAt: ev.created_at };
			votes.clear();
		} else if (ev.kind === 'vote') votes.set(ev.actor_discord_id, ev.payload.voted !== false);
		else if (ev.kind === 'agent_say') agentLines.push({ text: ev.payload.text, createdAt: ev.created_at });
	}
	return {
		roomId,
		participants: participants.map((p) => ({ discordUserId: p.discord_user_id, username: p.username, globalName: p.global_name })),
		prompt,
		creation,
		voteCount: [...votes.values()].filter(Boolean).length,
		agentLines: agentLines.slice(-5),
		lastEventId: events[0]?.id || 0,
	};
}
