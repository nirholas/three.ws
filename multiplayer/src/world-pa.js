// Presenter PA: one host speaks, every player in the coin's world hears it.
//
// Proximity voice (src/game/voice-chat.js) is a P2P mesh capped at 8 peers, which
// is right for a conversation and useless for a meetup keynote: a presenter with
// 150 people in the plaza reaches the eight nearest. The PA is the other shape.
// The host's browser encodes the microphone to Opus with WebCodecs and sends
// ~100 ms batches of frames to the room it is in; the server fans them out over
// presence pub/sub to EVERY walk_world room for that coin (General, Holders,
// and every shard past maxClients), and each room relays to its own clients.
// Audio is one-to-many and server-relayed, so the cost to each listener is one
// ~32 kbps stream no matter how many people are in the world.
//
// Who may speak: the coin's on-chain creator (verified wallet, see
// WalkRoom._isCreator), a wallet listed in PA_HOST_WALLETS, or anyone holding the
// PA_HOST_KEY secret (the guest presenter path: an event host from a partner
// community has no wallet bound to the coin). One speaker per coin at a time,
// held by a presence lock with a TTL so a crashed presenter frees the mic on
// their own. A host can take the mic from a stale or stuck holder with `force`.
//
// Everything that crosses presence is JSON-safe (frames as base64) because the
// Redis presence driver serializes with JSON.stringify; local presence passes the
// object through untouched, and both paths hand the room the same shape.

import { createHash, timingSafeEqual } from 'node:crypto';

export const PA_MAX_FRAMES = 16;          // frames per chunk message (~100 ms of 20 ms Opus frames, with slack)
export const PA_MAX_FRAME_BYTES = 1500;   // one 20 ms Opus frame at 32 kbps is ~80 bytes
export const PA_MAX_CHUNK_BYTES = 12000;
export const PA_MAX_MSGS_PER_SEC = 30;    // the client sends ~10/s
export const PA_LOCK_TTL_S = 20;
export const PA_LOCK_REFRESH_MS = 5000;
export const PA_MAX_CAPTION = 280;

const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$|^0x[0-9a-fA-F]{40}$/;

export function paTopic(coin) {
	return `pa:${coin || 'mainland'}`;
}

export function paLockKey(coin) {
	return `pa:lock:${coin || 'mainland'}`;
}

// PA_HOST_WALLETS="addr1, addr2": extra wallets allowed to take the mic in any
// world, for platform staff who run events in coins they did not create.
export function parseHostWallets(raw) {
	const out = new Set();
	for (const part of String(raw || '').split(/[\s,]+/)) {
		const w = part.trim();
		if (WALLET_RE.test(w)) out.add(w.startsWith('0x') ? w.toLowerCase() : w);
	}
	return out;
}

// Constant-time comparison of a presented host key against the configured one.
// Both sides are hashed first so the comparison never leaks the key's length.
export function hostKeyMatches(given, expected) {
	if (typeof given !== 'string' || typeof expected !== 'string') return false;
	if (expected.length < 12 || !given) return false;
	const a = createHash('sha256').update(given).digest();
	const b = createHash('sha256').update(expected).digest();
	return timingSafeEqual(a, b);
}

// The reason this client may host, or null. Order matters only for the label the
// presenter sees ("creator" reads better than "key" when both apply).
export function hostRole({ isCreator = false, account = '', key = '' } = {}, env = process.env) {
	if (isCreator) return 'creator';
	const acct = String(account || '');
	if (acct) {
		const wallets = parseHostWallets(env.PA_HOST_WALLETS);
		if (wallets.has(acct.startsWith('0x') ? acct.toLowerCase() : acct)) return 'host';
	}
	if (hostKeyMatches(key, env.PA_HOST_KEY)) return 'guest-host';
	return null;
}

function toBytes(frame) {
	if (frame instanceof Uint8Array) return frame;
	if (frame instanceof ArrayBuffer) return new Uint8Array(frame);
	if (ArrayBuffer.isView(frame)) return new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength);
	return null;
}

// A chunk from the presenter: `{ s: seq, f: [Uint8Array, ...] }`. Returns the
// cleaned chunk with frames as base64 (ready for presence), or null when any part
// is malformed or oversized. A bad chunk is dropped whole, never partially relayed.
export function validateChunk(payload) {
	if (!payload || typeof payload !== 'object') return null;
	const seq = Number(payload.s);
	if (!Number.isInteger(seq) || seq < 0 || seq > 2 ** 31) return null;
	const frames = payload.f;
	if (!Array.isArray(frames) || frames.length === 0 || frames.length > PA_MAX_FRAMES) return null;
	const out = [];
	let total = 0;
	for (const fr of frames) {
		const bytes = toBytes(fr);
		if (!bytes || bytes.byteLength === 0 || bytes.byteLength > PA_MAX_FRAME_BYTES) return null;
		total += bytes.byteLength;
		if (total > PA_MAX_CHUNK_BYTES) return null;
		out.push(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64'));
	}
	return { s: seq, f: out };
}

export function cleanCaption(text) {
	if (typeof text !== 'string') return '';
	return text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, PA_MAX_CAPTION);
}

function cleanName(name) {
	return String(name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 30) || 'Host';
}

// Sliding one-second window per speaker; anything faster than the encoder could
// produce is a misbehaving client and its excess is dropped.
export class RateWindow {
	constructor(limit = PA_MAX_MSGS_PER_SEC, windowMs = 1000) {
		this.limit = limit;
		this.windowMs = windowMs;
		this.start = 0;
		this.count = 0;
	}
	allow(now = Date.now()) {
		if (now - this.start >= this.windowMs) {
			this.start = now;
			this.count = 0;
		}
		this.count += 1;
		return this.count <= this.limit;
	}
}

function parseLock(raw) {
	if (!raw) return null;
	try {
		const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
		return v && typeof v.id === 'string' ? v : null;
	} catch {
		return null;
	}
}

async function readLock(room) {
	try {
		return parseLock(await room.presence.get(paLockKey(room.state.coin)));
	} catch {
		return null;
	}
}

function writeLock(room, lock) {
	try {
		room.presence.setex(paLockKey(room.state.coin), JSON.stringify(lock), PA_LOCK_TTL_S);
	} catch (err) {
		console.warn(`[walk_world ${room.roomId}] pa lock write failed:`, err?.message);
	}
}

function publish(room, msg) {
	try {
		room.presence.publish(paTopic(room.state.coin), msg);
	} catch (err) {
		console.warn(`[walk_world ${room.roomId}] pa publish failed:`, err?.message);
	}
}

// Relay one presence message to this room's clients. Audio is never echoed back
// to the presenter's own socket: they hear themselves through their own ears.
export function relayToRoom(room, msg) {
	if (!msg || typeof msg !== 'object' || !room._pa) return;
	const speakerSid = msg.room === room.roomId ? msg.sid : '';
	const except = speakerSid ? room.clients.find((c) => c.sessionId === speakerSid) : undefined;
	switch (msg.k) {
		case 'start':
			displaceLocalSpeaker(room, msg.id);
			room._pa.live = { id: msg.id, name: msg.name, role: msg.role, at: msg.at };
			room.broadcast('pa:start', { id: msg.id, name: msg.name, role: msg.role });
			break;
		case 'chunk':
			if (!Array.isArray(msg.f)) return;
			if (!room._pa.live || room._pa.live.id !== msg.id) {
				// A room created mid-broadcast missed the start; adopt the stream.
				room._pa.live = { id: msg.id, name: msg.name || 'Host', role: msg.role || 'host', at: Date.now() };
				room.broadcast('pa:start', { id: msg.id, name: room._pa.live.name, role: room._pa.live.role });
			}
			room.broadcast(
				'pa:chunk',
				{ id: msg.id, s: msg.s, f: msg.f.map((b) => Buffer.from(String(b), 'base64')) },
				except ? { except } : undefined,
			);
			break;
		case 'caption':
			room.broadcast('pa:caption', { id: msg.id, text: msg.text, final: !!msg.final });
			break;
		case 'stop':
			displaceLocalSpeaker(room, null, msg.id);
			if (room._pa.live?.id === msg.id) room._pa.live = null;
			room.broadcast('pa:stop', { id: msg.id });
			break;
		default:
			break;
	}
}

// Another host took the mic (a forced takeover from any room for this coin), or
// a stop arrived for the stream this room's speaker owns: release the local
// speaker so their next chunk is not relayed, and tell their panel why it closed.
function displaceLocalSpeaker(room, newId, stoppedId = null) {
	const sp = room._pa.speaking;
	if (!sp) return;
	const displaced = newId ? sp.id !== newId : sp.id === stoppedId;
	if (!displaced) return;
	room._pa.speaking = null;
	const c = room.clients.find((x) => x.sessionId === sp.sid);
	c?.send('pa:state', { ok: false, live: false, reason: 'taken' });
}

async function handleStart(room, client, payload) {
	const player = room.state.players.get(client.sessionId);
	if (!player) return;
	const role = hostRole({
		isCreator: room._isCreator(client),
		account: player.account,
		key: typeof payload?.key === 'string' ? payload.key.slice(0, 200) : '',
	});
	if (!role) {
		client.send('pa:state', { ok: false, reason: 'not-host' });
		return;
	}
	const held = await readLock(room);
	// The presenter may have left while the lock read was in flight.
	if (!room.state.players.get(client.sessionId)) return;
	const mine = held && held.room === room.roomId && held.sid === client.sessionId;
	if (held && !mine && !payload?.force) {
		client.send('pa:state', { ok: false, reason: 'busy', speaker: held.name });
		return;
	}
	if (held && !mine) publish(room, { k: 'stop', id: held.id });
	const lock = {
		id: `${room.roomId}:${client.sessionId}:${Date.now().toString(36)}`,
		room: room.roomId,
		sid: client.sessionId,
		name: cleanName(player.name),
		role,
		at: Date.now(),
	};
	writeLock(room, lock);
	room._pa.speaking = { sid: client.sessionId, id: lock.id, name: lock.name, role, rate: new RateWindow(), refreshedAt: Date.now() };
	publish(room, { k: 'start', ...lock });
	client.send('pa:state', { ok: true, live: true, id: lock.id, role });
}

function handleChunk(room, client, payload) {
	const sp = room._pa.speaking;
	if (!sp || sp.sid !== client.sessionId) return;
	const now = Date.now();
	if (!sp.rate.allow(now)) return;
	const chunk = validateChunk(payload);
	if (!chunk) return;
	if (now - sp.refreshedAt >= PA_LOCK_REFRESH_MS) {
		sp.refreshedAt = now;
		writeLock(room, { id: sp.id, room: room.roomId, sid: sp.sid, name: sp.name, role: sp.role, at: now });
	}
	publish(room, { k: 'chunk', id: sp.id, room: room.roomId, sid: sp.sid, name: sp.name, role: sp.role, ...chunk });
}

function handleCaption(room, client, payload) {
	const sp = room._pa.speaking;
	if (!sp || sp.sid !== client.sessionId) return;
	if (!sp.rate.allow(Date.now())) return;
	const text = cleanCaption(payload?.text);
	if (!text) return;
	publish(room, { k: 'caption', id: sp.id, room: room.roomId, sid: sp.sid, text, final: !!payload?.final });
}

async function stopSpeaking(room, sid) {
	const sp = room._pa.speaking;
	if (!sp || sp.sid !== sid) return false;
	room._pa.speaking = null;
	const held = await readLock(room);
	if (held?.id === sp.id) {
		try {
			room.presence.del(paLockKey(room.state.coin));
		} catch { /* the TTL frees it */ }
	}
	publish(room, { k: 'stop', id: sp.id, room: room.roomId, sid });
	return true;
}

export function registerPaHandlers(room) {
	room._pa = { live: null, speaking: null, listener: null };
	room.onMessage('pa:start', (client, payload) => {
		handleStart(room, client, payload).catch((err) => console.warn(`[walk_world ${room.roomId}] pa:start failed:`, err?.message));
	});
	room.onMessage('pa:chunk', (client, payload) => handleChunk(room, client, payload));
	room.onMessage('pa:caption', (client, payload) => handleCaption(room, client, payload));
	room.onMessage('pa:stop', (client) => {
		stopSpeaking(room, client.sessionId)
			.then((was) => { if (was) client.send('pa:state', { ok: true, live: false }); })
			.catch(() => {});
	});
	room._pa.listener = (msg) => relayToRoom(room, msg);
	try {
		room.presence.subscribe(paTopic(room.state.coin), room._pa.listener);
	} catch (err) {
		console.warn(`[walk_world ${room.roomId}] pa subscribe failed:`, err?.message);
	}
}

// A player arriving mid-keynote sees who is on the mic straight away (the audio
// itself starts with the next chunk). Reads the lock rather than local state so
// a room created after the start still knows.
export async function paSyncJoiner(room, client) {
	const live = room._pa?.live || (await readLock(room));
	if (live?.id) client.send('pa:start', { id: live.id, name: live.name || 'Host', role: live.role || 'host' });
}

export function paOnLeave(room, client) {
	if (room._pa?.speaking?.sid === client.sessionId) stopSpeaking(room, client.sessionId).catch(() => {});
}

export function paOnDispose(room) {
	if (!room._pa) return;
	const sp = room._pa.speaking;
	if (sp) stopSpeaking(room, sp.sid).catch(() => {});
	if (room._pa.listener) {
		try {
			room.presence.unsubscribe(paTopic(room.state.coin), room._pa.listener);
		} catch { /* presence already shut down */ }
	}
	room._pa.listener = null;
}
