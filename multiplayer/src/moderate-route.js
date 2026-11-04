// POST /internal/moderate. Operator-only (HMAC-signed with the shared secret):
// mute, unmute, kick, ban, unban a player, or list who is online. The route
// logic lives here, apart from index.js, so it can be exercised without booting
// the Colyseus server. An unsigned or stale request is refused with 401 before
// it reaches any room.

import { verifyModerateSignature } from './presence-token.js';
import { moderation, applyToStore, identityKeys } from './moderation.js';

const ACTIONS = new Set(['mute', 'unmute', 'kick', 'ban', 'unban', 'list']);

function str(v, max) {
	return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** The slice of a request an instance applies to its own rooms (also the fan-out job). */
export function parseJob(body) {
	return {
		action: str(body?.action, 12),
		target: {
			name: str(body?.name, 40),
			sessionId: str(body?.sessionId, 40),
			account: str(body?.account, 80),
			playerKey: str(body?.playerKey, 80),
		},
		coin: str(body?.coin, 128),
		minutes: Number(body?.minutes) > 0 ? Math.min(Number(body.minutes), 60 * 24 * 365) : 0,
		reason: str(body?.reason, 200),
	};
}

/** Run one job against this process's rooms. Returns { matched, players }. */
export function runLocal(job, { liveWalkRooms }) {
	const rooms = liveWalkRooms(job.coin || '');
	const matched = [];
	const players = [];
	for (const room of rooms) {
		if (job.action === 'list') {
			players.push(...room.listPlayersForModeration());
			continue;
		}
		const res = room.moderate({ ...job, by: 'operator' });
		for (const m of res.matched) matched.push({ ...m, room: room.roomId });
	}
	if (job.action !== 'list' && matched.length === 0) {
		// Nobody online matches. Bans, unbans and unmutes still apply by identity,
		// so a known troublemaker can be blocked before they come back.
		const keys = identityKeys({ account: job.target.account, playerKey: job.target.playerKey });
		if (['ban', 'unban', 'unmute'].includes(job.action)) {
			applyToStore(moderation, job.action, keys, { minutes: job.minutes, reason: job.reason, by: 'operator' });
		}
	}
	return { matched, players, rooms: rooms.length };
}

export async function handleModerate(req, res, { liveWalkRooms, fanout = null }) {
	const sig = req.headers['x-moderate-signature'];
	const ts = req.headers['x-moderate-timestamp'];
	if (!verifyModerateSignature(req.body || {}, ts, sig)) {
		return res.status(401).json({ error: 'bad_signature' });
	}
	const job = parseJob(req.body);
	if (!ACTIONS.has(job.action)) return res.status(400).json({ error: 'bad_action', actions: [...ACTIONS] });
	const t = job.target;
	if (job.action !== 'list' && !t.name && !t.sessionId && !t.account && !t.playerKey) {
		return res.status(400).json({ error: 'missing_target', hint: 'give name, sessionId, account or playerKey' });
	}
	const local = runLocal(job, { liveWalkRooms });
	let { matched, players } = local;
	let instances = 1;
	if (fanout?.enabled) {
		const acks = await fanout.request('moderate', job);
		for (const a of acks) {
			if (!a || a.error) continue;
			matched = matched.concat(a.matched || []);
			players = players.concat(a.players || []);
			instances += 1;
		}
	}
	const bans = moderation.list().filter((r) => r.kind === 'ban').length;
	if (job.action === 'list') return res.json({ ok: true, players, bans, instances });
	console.log(`[multiplayer] moderate ${job.action} -> ${matched.length} match(es) on ${instances} instance(s)`);
	return res.json({ ok: true, action: job.action, matched, instances });
}
