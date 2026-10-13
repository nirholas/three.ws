// Shared state for one Discord Activity instance: a room everyone in the
// voice channel polls and writes into. The phase loop (propose → vote →
// generating → reveal → propose) advances lazily on read, the same pattern
// Forge job polling already uses elsewhere in this codebase — no cron, no
// background worker, just "has enough wall-clock time passed" checked on the
// next GET. That keeps a Discord Activity, which has no server of its own,
// in lock-step across every participant's client.

import { sql } from '../db.js';

export class RoomError extends Error {
	constructor(code, message, status = 400) {
		super(message);
		this.code = code;
		this.status = status;
	}
}

export const PHASES = Object.freeze(['propose', 'vote', 'generating', 'reveal']);

// How long each phase runs before the lazy advancer moves it on. Generating
// has no fixed duration of its own: it ends when a client reports the Forge
// job finished (or GENERATING_STUCK_MS elapses with no job ever reported).
export const PROPOSE_MS = 45_000;
export const VOTE_MS = 30_000;
export const REVEAL_MS = 20_000;
const GENERATING_STUCK_MS = 120_000;
const MAX_PROMPTS_PER_ROOM = 16;

function normalizeInstanceId(instanceId) {
	const id = String(instanceId || '').trim();
	if (!id || id.length > 64) throw new RoomError('invalid_instance', 'instance_id is required.');
	return id;
}

export async function getOrCreateRoom({ instanceId, guildId = null, channelId = null }) {
	const id = normalizeInstanceId(instanceId);
	const [row] = await sql`
		INSERT INTO discord_activity_rooms (instance_id, guild_id, channel_id)
		VALUES (${id}, ${guildId}, ${channelId})
		ON CONFLICT (instance_id) DO UPDATE SET
			guild_id = COALESCE(discord_activity_rooms.guild_id, EXCLUDED.guild_id),
			channel_id = COALESCE(discord_activity_rooms.channel_id, EXCLUDED.channel_id)
		RETURNING *`;
	return row;
}

export async function touchParticipant({ instanceId, discordUserId, username = null, globalName = null, avatar = null }) {
	const id = normalizeInstanceId(instanceId);
	const userId = String(discordUserId || '').trim();
	if (!userId) throw new RoomError('invalid_user', 'discord_user_id is required.');
	await sql`
		INSERT INTO discord_activity_participants (instance_id, discord_user_id, username, global_name, avatar)
		VALUES (${id}, ${userId}, ${username}, ${globalName}, ${avatar})
		ON CONFLICT (instance_id, discord_user_id) DO UPDATE SET
			username = EXCLUDED.username,
			global_name = EXCLUDED.global_name,
			avatar = EXCLUDED.avatar,
			last_seen_at = now()`;
}

async function listParticipants(instanceId) {
	return sql`
		SELECT discord_user_id, username, global_name, avatar, last_seen_at
		FROM discord_activity_participants
		WHERE instance_id = ${instanceId}
		ORDER BY joined_at ASC`;
}

async function listPromptsWithVotes(instanceId) {
	return sql`
		SELECT p.id, p.discord_user_id, p.prompt, p.created_at,
		       COUNT(v.discord_user_id)::int AS votes
		FROM discord_activity_prompts p
		LEFT JOIN discord_activity_votes v ON v.prompt_id = p.id
		WHERE p.instance_id = ${instanceId}
		GROUP BY p.id
		ORDER BY p.created_at ASC`;
}

async function clearRound(instanceId) {
	await sql`DELETE FROM discord_activity_votes WHERE instance_id = ${instanceId}`;
	await sql`DELETE FROM discord_activity_prompts WHERE instance_id = ${instanceId}`;
}

// Moves a room's phase forward if enough time has elapsed, performing at most
// one transition per call (another call a few seconds later advances again).
// Returns the possibly-updated room row.
async function advanceIfDue(room) {
	const elapsed = Date.now() - new Date(room.phase_started_at).getTime();

	if (room.phase === 'propose') {
		if (elapsed < PROPOSE_MS) return room;
		const prompts = await listPromptsWithVotes(room.instance_id);
		if (prompts.length === 0) {
			// Nobody has proposed anything yet; keep waiting instead of advancing
			// into an empty vote with nothing to vote on.
			const [row] = await sql`
				UPDATE discord_activity_rooms SET phase_started_at = now(), updated_at = now()
				WHERE instance_id = ${room.instance_id} RETURNING *`;
			return row;
		}
		const [row] = await sql`
			UPDATE discord_activity_rooms
			SET phase = 'vote', phase_started_at = now(), updated_at = now()
			WHERE instance_id = ${room.instance_id} RETURNING *`;
		return row;
	}

	if (room.phase === 'vote') {
		if (elapsed < VOTE_MS) return room;
		const prompts = await listPromptsWithVotes(room.instance_id);
		if (prompts.length === 0) {
			const [row] = await sql`
				UPDATE discord_activity_rooms
				SET phase = 'propose', phase_started_at = now(), updated_at = now()
				WHERE instance_id = ${room.instance_id} RETURNING *`;
			return row;
		}
		// Winner is the most-voted prompt; ties and a voteless round both fall
		// back to whichever prompt was proposed first, so the loop always
		// progresses even if nobody votes.
		const winner = prompts.reduce((best, p) => (p.votes > best.votes ? p : best), prompts[0]);
		const [row] = await sql`
			UPDATE discord_activity_rooms
			SET phase = 'generating', current_prompt_id = ${winner.id},
			    generation_job_id = NULL, generation_status = NULL,
			    generation_glb_url = NULL, generation_error = NULL,
			    phase_started_at = now(), updated_at = now()
			WHERE instance_id = ${room.instance_id} RETURNING *`;
		return row;
	}

	if (room.phase === 'generating') {
		const done = room.generation_status === 'completed' || room.generation_status === 'failed';
		const stuck = !room.generation_job_id && elapsed > GENERATING_STUCK_MS;
		if (!done && !stuck) return room;
		const [row] = await sql`
			UPDATE discord_activity_rooms
			SET phase = 'reveal',
			    generation_status = ${stuck ? 'failed' : room.generation_status},
			    generation_error = ${stuck ? 'No client started a Forge job in time.' : room.generation_error},
			    phase_started_at = now(), updated_at = now()
			WHERE instance_id = ${room.instance_id} RETURNING *`;
		return row;
	}

	// reveal
	if (elapsed < REVEAL_MS) return room;
	await clearRound(room.instance_id);
	const [row] = await sql`
		UPDATE discord_activity_rooms
		SET phase = 'propose', current_prompt_id = NULL,
		    generation_job_id = NULL, generation_status = NULL,
		    generation_glb_url = NULL, generation_error = NULL,
		    phase_started_at = now(), updated_at = now()
		WHERE instance_id = ${room.instance_id} RETURNING *`;
	return row;
}

export async function getRoomState(instanceId) {
	const id = normalizeInstanceId(instanceId);
	const [existing] = await sql`SELECT * FROM discord_activity_rooms WHERE instance_id = ${id}`;
	if (!existing) throw new RoomError('not_found', 'No room for that instance_id yet. POST action=join first.', 404);

	let room = existing;
	// A room idle for a long time (everyone left) can need more than one hop to
	// catch up; three is enough to reach 'propose' from any phase. advanceIfDue
	// returns the SAME object reference when nothing changed, so that is the
	// fixed-point check.
	for (let i = 0; i < 3; i++) {
		const next = await advanceIfDue(room);
		const settled = next === room;
		room = next;
		if (settled) break;
	}

	const [participants, prompts] = await Promise.all([listParticipants(id), listPromptsWithVotes(id)]);
	return {
		instanceId: room.instance_id,
		guildId: room.guild_id,
		channelId: room.channel_id,
		phase: room.phase,
		phaseStartedAt: room.phase_started_at,
		phaseMsRemaining: phaseMsRemaining(room),
		currentPromptId: room.current_prompt_id,
		generation: {
			jobId: room.generation_job_id,
			status: room.generation_status,
			glbUrl: room.generation_glb_url,
			error: room.generation_error,
		},
		participants: participants.map((p) => ({
			discordUserId: p.discord_user_id,
			username: p.username,
			globalName: p.global_name,
			avatar: p.avatar,
		})),
		prompts: prompts.map((p) => ({
			id: p.id,
			discordUserId: p.discord_user_id,
			prompt: p.prompt,
			votes: p.votes,
		})),
	};
}

function phaseMsRemaining(room) {
	const duration = { propose: PROPOSE_MS, vote: VOTE_MS, generating: null, reveal: REVEAL_MS }[room.phase];
	if (duration == null) return null;
	const elapsed = Date.now() - new Date(room.phase_started_at).getTime();
	return Math.max(0, duration - elapsed);
}

export async function addPrompt({ instanceId, discordUserId, prompt }) {
	const id = normalizeInstanceId(instanceId);
	const text = String(prompt || '').trim();
	if (!text || text.length > 200) throw new RoomError('invalid_prompt', 'prompt must be 1-200 characters.');
	const [room] = await sql`SELECT phase FROM discord_activity_rooms WHERE instance_id = ${id}`;
	if (!room) throw new RoomError('not_found', 'No room for that instance_id yet.', 404);
	if (room.phase !== 'propose') throw new RoomError('wrong_phase', 'This round is not accepting prompts right now.', 409);
	const [{ count }] = await sql`SELECT count(*)::int FROM discord_activity_prompts WHERE instance_id = ${id}`;
	if (count >= MAX_PROMPTS_PER_ROOM) throw new RoomError('room_full', 'This round already has the maximum number of prompts.', 409);
	const [row] = await sql`
		INSERT INTO discord_activity_prompts (instance_id, discord_user_id, prompt)
		VALUES (${id}, ${String(discordUserId)}, ${text}) RETURNING id`;
	return row.id;
}

export async function castVote({ instanceId, discordUserId, promptId }) {
	const id = normalizeInstanceId(instanceId);
	const userId = String(discordUserId || '').trim();
	if (!userId || !promptId) throw new RoomError('invalid_vote', 'discord_user_id and prompt_id are required.');
	const [room] = await sql`SELECT phase FROM discord_activity_rooms WHERE instance_id = ${id}`;
	if (!room) throw new RoomError('not_found', 'No room for that instance_id yet.', 404);
	if (room.phase !== 'vote') throw new RoomError('wrong_phase', 'Voting is not open right now.', 409);
	const [prompt] = await sql`SELECT id FROM discord_activity_prompts WHERE id = ${promptId} AND instance_id = ${id}`;
	if (!prompt) throw new RoomError('invalid_prompt', 'That prompt is not part of this round.', 404);
	await sql`
		INSERT INTO discord_activity_votes (instance_id, prompt_id, discord_user_id)
		VALUES (${id}, ${promptId}, ${userId})
		ON CONFLICT (instance_id, discord_user_id) DO UPDATE SET prompt_id = EXCLUDED.prompt_id, created_at = now()`;
}

// First client to report a job_id for the room's current round wins the
// right to drive the generation; everyone else's report of the same job_id
// is accepted as a status update, and a mismatched job_id is rejected so a
// late straggler from the PREVIOUS round can't overwrite the live one.
export async function reportGeneration({ instanceId, promptId, jobId, status, glbUrl = null, error = null }) {
	const id = normalizeInstanceId(instanceId);
	const [room] = await sql`SELECT phase, current_prompt_id, generation_job_id FROM discord_activity_rooms WHERE instance_id = ${id}`;
	if (!room) throw new RoomError('not_found', 'No room for that instance_id yet.', 404);
	if (room.phase !== 'generating') {
		// allow trailing status updates to land even if a client is slightly late
		if (room.phase !== 'reveal') throw new RoomError('wrong_phase', 'No generation is running for this round.', 409);
	}
	if (String(room.current_prompt_id) !== String(promptId)) {
		throw new RoomError('stale_round', "That prompt is not the current round's winner.", 409);
	}
	if (room.generation_job_id && String(room.generation_job_id) !== String(jobId)) {
		throw new RoomError('job_taken', "Another client already started this round's generation.", 409);
	}
	await sql`
		UPDATE discord_activity_rooms
		SET generation_job_id = ${String(jobId)}, generation_status = ${String(status)},
		    generation_glb_url = ${glbUrl}, generation_error = ${error}, updated_at = now()
		WHERE instance_id = ${id}`;
}
