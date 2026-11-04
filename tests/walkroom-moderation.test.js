// /play world moderation: host mute, kick, ban and player reports.
//
// The full WalkRoom needs the Colyseus runtime, so these tests drive the room's
// message handlers against a minimal stand-in (Object.create skips the Room
// constructor), exactly like walkroom-build-perms.test.js. They pin the
// server-authoritative invariants: a muted session reaches nobody, a kicked
// session is closed with a distinct code and told why, a banned identity is
// refused at join, and an unsigned operator request never reaches a room.

import crypto from 'node:crypto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WalkRoom } from '../multiplayer/src/rooms/WalkRoom.js';
import {
	ModerationStore,
	identityKeys,
	KICK_CLOSE_CODE,
	AUTO_MUTE_REPORTERS,
} from '../multiplayer/src/moderation.js';
import { verifyModerateSignature } from '../multiplayer/src/presence-token.js';
import { handleModerate } from '../multiplayer/src/moderate-route.js';

function makeClient(sessionId, userData = {}) {
	return {
		sessionId,
		userData,
		send: vi.fn(),
		leave: vi.fn(),
	};
}

function makeRoom() {
	const room = Object.create(WalkRoom.prototype);
	room.clients = [];
	room._chatCooldowns = new Map();
	room._emoteCooldowns = new Map();
	room._reactionCooldowns = new Map();
	room._voiceCounters = new Map();
	room._reportCooldowns = new Map();
	room._reports = new Map();
	room._moderation = new ModerationStore();
	room._chatStore = { append: vi.fn(async () => {}), tail: vi.fn(async () => []) };
	room.worldKey = 'test';
	Object.defineProperty(room, 'roomId', { value: 'room-1', writable: true, configurable: true });
	room.broadcast = vi.fn();
	Object.defineProperty(room, 'state', {
		value: { players: new Map(), coin: '' },
		writable: true,
		configurable: true,
	});
	return room;
}

function seat(room, sessionId, { name = sessionId, userData = {} } = {}) {
	const client = makeClient(sessionId, userData);
	room.clients.push(client);
	room.state.players.set(sessionId, { id: sessionId, name, voice: false, voiceMuted: false });
	return client;
}

describe('identityKeys', () => {
	it('builds stable keys from wallet, account uid and persistence key', () => {
		expect(identityKeys({ account: 'W1', accountUid: 'u-1', playerKey: 'guest-abc' })).toEqual([
			'acct:W1',
			'uid:u-1',
			'pk:guest-abc',
		]);
		expect(identityKeys({})).toEqual([]);
	});
});

describe('ModerationStore', () => {
	it('expires a mute after its duration and sweeps it', () => {
		let t = 1_000_000;
		const store = new ModerationStore({ now: () => t });
		store.mute(['pk:a'], { minutes: 15, reason: 'spam', by: 'ops' });
		expect(store.active(['pk:a'], 'mute')).toMatchObject({ reason: 'spam', by: 'ops' });
		t += 14 * 60_000;
		expect(store.active(['pk:a'], 'mute')).not.toBeNull();
		t += 2 * 60_000;
		expect(store.active(['pk:a'], 'mute')).toBeNull();
		expect(store.list()).toHaveLength(0);
	});

	it('matches on any one identity key and keeps mute and ban separate', () => {
		const store = new ModerationStore();
		store.ban(['acct:W1', 'pk:a'], { reason: 'abuse', by: 'ops' });
		expect(store.active(['uid:zzz', 'pk:a'], 'ban')).not.toBeNull();
		expect(store.active(['pk:a'], 'mute')).toBeNull();
		store.unban(['acct:W1']);
		expect(store.active(['pk:a'], 'ban')).toBeNull();
	});
});

describe('mute enforcement (a)', () => {
	let room;
	beforeEach(() => { room = makeRoom(); });

	it('does not relay a muted session\'s chat while an unmuted peer still chats', () => {
		const muted = seat(room, 's1', { name: 'loud', userData: { playerKey: 'pk1' } });
		const peer = seat(room, 's2', { name: 'calm', userData: { playerKey: 'pk2' } });
		room._moderation.mute(['pk:pk1'], { minutes: 10, reason: 'spam', by: 'ops' });

		room._handleChat(muted, { text: 'buy my thing' });
		expect(room.broadcast).not.toHaveBeenCalled();

		room._handleChat(peer, { text: 'hello' });
		expect(room.broadcast).toHaveBeenCalledWith('chat', expect.objectContaining({ id: 's2', text: 'hello' }));
	});

	it('tells the muted player once per minute why nothing is sent', () => {
		const muted = seat(room, 's1', { userData: { playerKey: 'pk1' } });
		room._moderation.mute(['pk:pk1'], { minutes: 10, reason: 'spam', by: 'ops' });
		room._handleChat(muted, { text: 'one' });
		room._handleChat(muted, { text: 'two' });
		const notices = muted.send.mock.calls.filter(([type, body]) => type === 'notice' && body.kind === 'moderation');
		expect(notices).toHaveLength(1);
		expect(notices[0][1].text).toMatch(/muted/i);
	});

	it('drops voice-state and voice-signal from a muted session', () => {
		const muted = seat(room, 's1', { userData: { account: 'W1' } });
		const peer = seat(room, 's2');
		room._moderation.mute(['acct:W1'], { minutes: 10, reason: 'abuse', by: 'ops' });

		room._actionOk = () => true;
		room._handleVoiceState(muted, { on: true });
		expect(room.state.players.get('s1').voice).toBe(false);

		room._handleVoiceSignal(muted, { to: 's2', data: { sdp: 'x' } });
		expect(peer.send).not.toHaveBeenCalled();
	});

	it('drops emotes and reactions from a muted session', () => {
		const muted = seat(room, 's1', { userData: { playerKey: 'pk1' } });
		room._moderation.mute(['pk:pk1'], { minutes: 10, reason: 'x', by: 'ops' });
		room._handleEmote(muted, { name: 'wave' });
		room._handleReaction(muted, { emoji: '🔥' });
		expect(room.state.players.get('s1').emote).toBeUndefined();
		expect(room.broadcast).not.toHaveBeenCalled();
	});

	it('lets chat flow again once the mute is lifted', () => {
		const c = seat(room, 's1', { userData: { playerKey: 'pk1' } });
		room._moderation.mute(['pk:pk1'], { minutes: 10, reason: 'x', by: 'ops' });
		room._moderation.unmute(['pk:pk1']);
		room._handleChat(c, { text: 'back' });
		expect(room.broadcast).toHaveBeenCalledWith('chat', expect.objectContaining({ text: 'back' }));
	});
});

describe('kick (c)', () => {
	it('sends a notice then closes the session with the distinct kick code', () => {
		const room = makeRoom();
		const target = seat(room, 's1', { name: 'rowdy' });
		const result = room.moderate({ action: 'kick', target: { name: 'ROWDY' }, reason: 'harassment', by: 'ops' });
		expect(result.matched).toEqual([{ sessionId: 's1', name: 'rowdy' }]);
		const noticeAt = target.send.mock.invocationCallOrder[0];
		const leaveAt = target.leave.mock.invocationCallOrder[0];
		expect(noticeAt).toBeLessThan(leaveAt);
		expect(target.send).toHaveBeenCalledWith('notice', expect.objectContaining({ kind: 'moderation', text: expect.stringMatching(/removed/i) }));
		expect(target.leave).toHaveBeenCalledWith(KICK_CLOSE_CODE, 'kicked');
		expect(KICK_CLOSE_CODE).not.toBe(1000);
	});

	it('matches by session id and by wallet, and reports no match honestly', () => {
		const room = makeRoom();
		seat(room, 's1', { name: 'a', userData: { account: 'W1' } });
		seat(room, 's2', { name: 'b' });
		expect(room.moderate({ action: 'kick', target: { sessionId: 's2' } }).matched).toHaveLength(1);
		expect(room.moderate({ action: 'mute', target: { account: 'W1' }, minutes: 5 }).matched).toHaveLength(1);
		expect(room.moderate({ action: 'kick', target: { name: 'nobody' } }).matched).toHaveLength(0);
	});
});

describe('ban at join (d)', () => {
	it('refuses a banned wallet in onAuth with a typed error before a seat is taken', () => {
		const room = makeRoom();
		room._moderation.ban(['acct:W1'], { reason: 'abuse', by: 'ops' });
		const client = makeClient('s9', { account: 'W1' });
		expect(() => room._assertNotBanned(client, {})).toThrow(/^banned/);
	});

	it('refuses a banned guest by the id sealed in its guest token', async () => {
		const { signGuestToken, newGuestId } = await import('../multiplayer/src/guest-token.js');
		const gid = newGuestId();
		const room = makeRoom();
		room._moderation.ban([`pk:${gid}`], { reason: 'abuse', by: 'ops' });
		expect(() => room._assertNotBanned(makeClient('s9'), { guestToken: signGuestToken(gid) })).toThrow(/^banned/);
		expect(() => room._assertNotBanned(makeClient('s9'), {})).not.toThrow();
	});

	it('a ban applied to a live player also kicks them', () => {
		const room = makeRoom();
		const c = seat(room, 's1', { name: 'rowdy', userData: { account: 'W1' } });
		room.moderate({ action: 'ban', target: { name: 'rowdy' }, reason: 'abuse', by: 'ops' });
		expect(c.leave).toHaveBeenCalledWith(KICK_CLOSE_CODE, 'banned');
		expect(room._moderation.active(['acct:W1'], 'ban')).not.toBeNull();
	});
});

describe('player reports', () => {
	let room;
	beforeEach(() => { room = makeRoom(); });

	it('acknowledges a report and rejects self-reports and unknown targets', () => {
		const a = seat(room, 's1', { userData: { playerKey: 'pk1' } });
		seat(room, 's2', { userData: { playerKey: 'pk2' } });
		room._handleReport(a, { targetSessionId: 's2', reason: 'spam' });
		expect(a.send).toHaveBeenCalledWith('report-result', { ok: true });
		room._handleReport(a, { targetSessionId: 's1', reason: 'spam' });
		expect(a.send).toHaveBeenLastCalledWith('report-result', { ok: false, error: 'invalid_target' });
		room._handleReport(a, { targetSessionId: 'ghost', reason: 'spam' });
		expect(a.send).toHaveBeenLastCalledWith('report-result', { ok: false, error: 'invalid_target' });
	});

	it('rate limits a reporter', () => {
		const a = seat(room, 's1', { userData: { playerKey: 'pk1' } });
		seat(room, 's2', { userData: { playerKey: 'pk2' } });
		seat(room, 's3', { userData: { playerKey: 'pk3' } });
		room._handleReport(a, { targetSessionId: 's2', reason: 'spam' });
		room._handleReport(a, { targetSessionId: 's3', reason: 'spam' });
		expect(a.send).toHaveBeenLastCalledWith('report-result', { ok: false, error: 'rate_limited' });
	});

	it('auto-mutes for 10 minutes once 3 distinct reporters flag one target, and never bans', () => {
		expect(AUTO_MUTE_REPORTERS).toBe(3);
		const target = seat(room, 'sT', { name: 'rowdy', userData: { playerKey: 'pkT' } });
		for (const n of [1, 2, 3]) {
			const r = seat(room, `r${n}`, { userData: { playerKey: `pkr${n}` } });
			expect(room._moderation.active(['pk:pkT'], 'mute')).toBeNull();
			room._handleReport(r, { targetSessionId: 'sT', reason: 'harassment' });
		}
		const mute = room._moderation.active(['pk:pkT'], 'mute');
		expect(mute).not.toBeNull();
		expect(mute.by).toBe('auto-report');
		expect(mute.until - Date.now()).toBeGreaterThan(9 * 60_000);
		expect(mute.until - Date.now()).toBeLessThanOrEqual(10 * 60_000);
		expect(room._moderation.active(['pk:pkT'], 'ban')).toBeNull();
		expect(target.send).toHaveBeenCalledWith('notice', expect.objectContaining({ kind: 'moderation' }));
	});

	it('counts one reporter once however many times they report', () => {
		seat(room, 'sT', { userData: { playerKey: 'pkT' } });
		const r = seat(room, 'r1', { userData: { playerKey: 'pkr1' } });
		for (let i = 0; i < 4; i++) {
			room._reportCooldowns.clear();
			room._handleReport(r, { targetSessionId: 'sT', reason: 'spam' });
		}
		expect(room._moderation.active(['pk:pkT'], 'mute')).toBeNull();
	});
});

describe('POST /internal/moderate (e)', () => {
	const SECRET = 'test-secret';
	function sign(body, ts, secret = SECRET) {
		const hash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('base64url');
		return crypto.createHmac('sha256', secret).update(`moderate:${ts}:${hash}`).digest('base64url');
	}
	function fakeRes() {
		const res = { statusCode: 200, body: null };
		res.status = (c) => { res.statusCode = c; return res; };
		res.json = (b) => { res.body = b; return res; };
		return res;
	}

	beforeEach(() => {
		process.env.MULTIPLAYER_SHARED_SECRET = SECRET;
	});

	it('verifyModerateSignature accepts a fresh correct signature and rejects stale or wrong ones', () => {
		const body = { action: 'list' };
		const ts = Math.floor(Date.now() / 1000);
		expect(verifyModerateSignature(body, ts, sign(body, ts))).toBe(true);
		expect(verifyModerateSignature(body, ts, sign(body, ts, 'other'))).toBe(false);
		expect(verifyModerateSignature(body, ts - 600, sign(body, ts - 600))).toBe(false);
		expect(verifyModerateSignature({ action: 'ban' }, ts, sign(body, ts))).toBe(false);
		expect(verifyModerateSignature(body, ts, undefined)).toBe(false);
	});

	it('answers 401 for a wrong or stale signature before any room is touched', async () => {
		const rooms = vi.fn(() => []);
		const body = { action: 'list' };
		const ts = Math.floor(Date.now() / 1000);

		const wrong = fakeRes();
		await handleModerate({ body, headers: { 'x-moderate-timestamp': String(ts), 'x-moderate-signature': sign(body, ts, 'bad') } }, wrong, { liveWalkRooms: rooms });
		expect(wrong.statusCode).toBe(401);

		const stale = fakeRes();
		await handleModerate({ body, headers: { 'x-moderate-timestamp': String(ts - 900), 'x-moderate-signature': sign(body, ts - 900) } }, stale, { liveWalkRooms: rooms });
		expect(stale.statusCode).toBe(401);

		expect(rooms).not.toHaveBeenCalled();
	});

	it('applies a signed mute to the matching live player and lists it', async () => {
		const room = makeRoom();
		seat(room, 's1', { name: 'rowdy', userData: { playerKey: 'pk1' } });
		const deps = { liveWalkRooms: () => [room] };
		const body = { action: 'mute', name: 'rowdy', minutes: 15, reason: 'spam' };
		const ts = Math.floor(Date.now() / 1000);
		const res = fakeRes();
		await handleModerate({ body, headers: { 'x-moderate-timestamp': String(ts), 'x-moderate-signature': sign(body, ts) } }, res, deps);
		expect(res.statusCode).toBe(200);
		expect(res.body.matched).toEqual([{ sessionId: 's1', name: 'rowdy', room: expect.anything() }]);
		expect(room._moderation.active(['pk:pk1'], 'mute')).not.toBeNull();

		const listBody = { action: 'list' };
		const listRes = fakeRes();
		await handleModerate({ body: listBody, headers: { 'x-moderate-timestamp': String(ts), 'x-moderate-signature': sign(listBody, ts) } }, listRes, deps);
		expect(listRes.body.players).toEqual([expect.objectContaining({ sessionId: 's1', name: 'rowdy', muted: true })]);
	});

	it('rejects an unknown action with 400 once the signature is good', async () => {
		const body = { action: 'explode' };
		const ts = Math.floor(Date.now() / 1000);
		const res = fakeRes();
		await handleModerate({ body, headers: { 'x-moderate-timestamp': String(ts), 'x-moderate-signature': sign(body, ts) } }, res, { liveWalkRooms: () => [] });
		expect(res.statusCode).toBe(400);
	});
});
