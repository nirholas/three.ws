// /api/gateway/discord-activity-room/:id          GET  room snapshot
// /api/gateway/discord-activity-room/:id/stream    GET  SSE tail of room events
// /api/gateway/discord-activity-room/:id/prompt    POST { text }, announce the prompt the group just sent to Forge
// /api/gateway/discord-activity-room/:id/creation  POST { creation_id }, a submitted Forge job finished; share it with the room
// /api/gateway/discord-activity-room/:id/vote      POST { vote }, vote on the room's current creation
//
// :id is a Discord Activity instance id. Every call needs the Bearer session
// token minted by discord-activity-session.js, and the token's own room id
// must match :id: a session can only act in the room it was issued for.
// Forge generation itself stays on the real /api/forge and /api/forge-vote
// endpoints (called by the client through Discord's `/.proxy/` mapping); this
// handler only shares the result with everyone in the call. No coin, wallet or
// purchase path: this room is free, per the order's own scope decision.

import { cors, json, method, error, readJson, wrap } from '../../_lib/http.js';
import { limits } from '../../_lib/rate-limit.js';
import { isUuid } from '../../_lib/validate.js';
import { verifyActivitySession } from '../../_lib/gateway/discord-activity-auth.js';
import { getRoom, getRoomSnapshot, appendEvent, listEvents } from '../../_lib/gateway/discord-activity-store.js';
import { reactToEvent } from '../../_lib/gateway/discord-activity-agent.js';
import { getPublicCreation, castVote, removeVote, hashClient } from '../../_lib/forge-store.js';

const INSTANCE_RE = /^[A-Za-z0-9_-]{1,128}$/;
const HEARTBEAT_MS = 15_000;
const POLL_MS = 2_000;
const MAX_DURATION_MS = 280_000;

function voterKeyFor(discordUserId) {
	return hashClient(`discord:${discordUserId}`);
}

// The stream sub-route is read by the browser's native EventSource, which
// cannot attach an Authorization header, so it carries the session token as a
// query param instead; every other sub-route uses the real header. Both are
// the same short-lived HMAC token, scoped to one room, over HTTPS only.
function bearerToken(req, url) {
	const header = req.headers.authorization || '';
	const m = /^Bearer\s+(.+)$/i.exec(header);
	if (m) return m[1];
	return url.searchParams.get('token');
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const url = new URL(req.url, 'http://x');
	const parts = url.pathname.split('/').filter(Boolean); // ['api','gateway','discord-activity-room', ':id', sub?]
	const roomId = parts[3] || '';
	const sub = parts[4] || null;
	if (!INSTANCE_RE.test(roomId)) return error(res, 404, 'not_found', 'room not found');

	const session = verifyActivitySession(bearerToken(req, url));
	if (!session || session.roomId !== roomId) return error(res, 401, 'unauthorized', 'a valid Activity session for this room is required');

	const room = await getRoom(roomId);
	if (!room) return error(res, 404, 'not_found', 'room not found');

	if (sub === null && req.method === 'GET') return json(res, 200, { data: await getRoomSnapshot(roomId) }, { 'cache-control': 'no-store' });
	if (sub === 'stream' && req.method === 'GET') return streamRoom(req, res, roomId);
	if (sub === 'prompt' && req.method === 'POST') return submitPrompt(req, res, roomId, session);
	if (sub === 'creation' && req.method === 'POST') return shareCreation(req, res, roomId, session);
	if (sub === 'vote' && req.method === 'POST') return voteOnCreation(req, res, roomId, session);
	return error(res, 404, 'not_found', 'not found');
});

async function writeGate(res, session) {
	const rl = await limits.discordActivityWrite(session.discordUserId);
	if (!rl.success) {
		res.statusCode = 429;
		json(res, 429, { error: 'rate_limited', message: 'Slow down a little, the room can only take so many actions a minute.' });
		return false;
	}
	return true;
}

async function reactAndBroadcast(roomId, actorDiscordId, reactionEvent) {
	const { text } = await reactToEvent(reactionEvent);
	await appendEvent({ roomId, kind: 'agent_say', actorDiscordId, payload: { text } });
}

async function submitPrompt(req, res, roomId, session) {
	if (!(await writeGate(res, session))) return;
	const body = (await readJson(req, 4_096)) || {};
	const text = typeof body.text === 'string' ? body.text.trim() : '';
	if (!text) return error(res, 400, 'empty_prompt', 'text is required');
	if (text.length > 400) return error(res, 400, 'prompt_too_long', 'Keep the prompt under 400 characters.');

	await appendEvent({ roomId, kind: 'prompt', actorDiscordId: session.discordUserId, payload: { text } });
	await reactAndBroadcast(roomId, session.discordUserId, { kind: 'prompt', prompt: text });
	return json(res, 200, { data: await getRoomSnapshot(roomId) });
}

async function shareCreation(req, res, roomId, session) {
	if (!(await writeGate(res, session))) return;
	const body = (await readJson(req, 4_096)) || {};
	const creationId = typeof body.creation_id === 'string' ? body.creation_id.trim() : '';
	if (!isUuid(creationId)) return error(res, 400, 'bad_creation', 'creation_id must be a uuid');

	const creation = await getPublicCreation({ id: creationId });
	if (!creation) return error(res, 404, 'not_found', 'that creation is not a finished, public Forge result');

	await appendEvent({
		roomId,
		kind: 'creation',
		actorDiscordId: session.discordUserId,
		payload: { id: creation.id, glb_url: creation.glb_url, preview_image_url: creation.preview_image_url, prompt: creation.prompt },
	});
	await reactAndBroadcast(roomId, session.discordUserId, { kind: 'creation', prompt: creation.prompt });
	return json(res, 200, { data: await getRoomSnapshot(roomId) });
}

async function voteOnCreation(req, res, roomId, session) {
	if (!(await writeGate(res, session))) return;
	const snapshot = await getRoomSnapshot(roomId);
	if (!snapshot.creation?.id) return error(res, 409, 'no_creation', 'nothing has been shared with the room yet');

	const body = (await readJson(req, 4_096)) || {};
	const removing = body?.vote === false;
	const voterKey = voterKeyFor(session.discordUserId);
	const result = removing
		? await removeVote({ creationId: snapshot.creation.id, voterKey })
		: await castVote({ creationId: snapshot.creation.id, voterKey });
	if (!result) return error(res, 409, 'vote_failed', 'that creation can no longer be voted on');

	await appendEvent({ roomId, kind: 'vote', actorDiscordId: session.discordUserId, payload: { voted: !removing, vote_count: result.voteCount } });
	await reactAndBroadcast(roomId, session.discordUserId, { kind: 'vote', voteCount: result.voteCount });
	return json(res, 200, { data: await getRoomSnapshot(roomId) });
}

function openSse(res) {
	res.writeHead(200, {
		'Content-Type': 'text/event-stream; charset=utf-8',
		'Cache-Control': 'no-cache, no-transform',
		'X-Accel-Buffering': 'no',
		Connection: 'keep-alive',
	});
	const hb = setInterval(() => {
		try { res.write(':hb\n\n'); } catch { clearInterval(hb); }
	}, HEARTBEAT_MS);
	res.on('close', () => clearInterval(hb));
	return () => clearInterval(hb);
}

async function streamRoom(req, res, roomId) {
	const url = new URL(req.url, 'http://x');
	let cursor = Number(req.headers['last-event-id'] || url.searchParams.get('after') || 0) || 0;

	const close = openSse(res);
	let stopped = false;
	const stop = () => {
		if (stopped) return;
		stopped = true;
		clearInterval(timer);
		clearTimeout(deadline);
		close();
		if (!res.writableEnded) res.end();
	};
	const pump = async () => {
		if (stopped) return;
		try {
			const events = await listEvents({ roomId, afterId: cursor, limit: 100 });
			for (const ev of events) {
				cursor = ev.id;
				res.write(`id: ${ev.id}\ndata: ${JSON.stringify({ id: ev.id, kind: ev.kind, actor_discord_id: ev.actor_discord_id, payload: ev.payload, created_at: ev.created_at })}\n\n`);
			}
		} catch (e) {
			console.warn('[discord-activity-room] stream poll failed', e?.message);
		}
	};
	const timer = setInterval(pump, POLL_MS);
	const deadline = setTimeout(stop, MAX_DURATION_MS);
	req.on('close', stop);
	await pump();
}
