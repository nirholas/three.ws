// Presenter PA (multiplayer/src/world-pa.js): who may take the mic, how chunks
// are validated, and the coin-wide relay through presence pub/sub, exercised
// against the real Colyseus LocalPresence the single-instance server runs on.
import { describe, it, expect, beforeEach } from 'vitest';
import { LocalPresence } from '../multiplayer/node_modules/@colyseus/core/build/presence/LocalPresence.js';
import {
	hostRole, hostKeyMatches, parseHostWallets, validateChunk, cleanCaption, RateWindow,
	registerPaHandlers, paSyncJoiner, paOnLeave, paOnDispose, paLockKey,
	PA_MAX_FRAMES, PA_MAX_FRAME_BYTES,
} from '../multiplayer/src/world-pa.js';

const MINT = 'THREEsynthetic1111111111111111111111111111';
const WALLET = 'THREEhostWa11et11111111111111111111111111';
const KEY = 'meetup-host-key-0123456789';

describe('hostRole', () => {
	it('grants the coin creator', () => {
		expect(hostRole({ isCreator: true }, {})).toBe('creator');
	});
	it('grants an allowlisted wallet and refuses others', () => {
		const env = { PA_HOST_WALLETS: `${WALLET}, not-a-wallet` };
		expect(hostRole({ account: WALLET }, env)).toBe('host');
		expect(hostRole({ account: 'THREEsomeoneE1se1111111111111111111111111' }, env)).toBeNull();
	});
	it('grants the guest-host key only on an exact match', () => {
		const env = { PA_HOST_KEY: KEY };
		expect(hostRole({ key: KEY }, env)).toBe('guest-host');
		expect(hostRole({ key: KEY + 'x' }, env)).toBeNull();
		expect(hostRole({ key: '' }, env)).toBeNull();
	});
	it('refuses a key when none (or a weak one) is configured', () => {
		expect(hostKeyMatches('short', 'short')).toBe(false);
		expect(hostRole({ key: 'anything' }, {})).toBeNull();
	});
	it('parses wallet lists with mixed separators and normalizes EVM case', () => {
		const set = parseHostWallets(`${WALLET}\n0xABCDEFabcdef0123456789012345678901234567`);
		expect(set.has(WALLET)).toBe(true);
		expect(set.has('0xabcdefabcdef0123456789012345678901234567')).toBe(true);
	});
});

describe('validateChunk', () => {
	it('accepts a batch of Opus frames and base64-encodes them for presence', () => {
		const out = validateChunk({ s: 7, f: [new Uint8Array([1, 2, 3]), new Uint8Array([4])] });
		expect(out).toEqual({ s: 7, f: ['AQID', 'BA=='] });
	});
	it('rejects malformed, empty and oversized chunks whole', () => {
		expect(validateChunk(null)).toBeNull();
		expect(validateChunk({ s: -1, f: [new Uint8Array(1)] })).toBeNull();
		expect(validateChunk({ s: 1, f: [] })).toBeNull();
		expect(validateChunk({ s: 1, f: ['not bytes'] })).toBeNull();
		expect(validateChunk({ s: 1, f: [new Uint8Array(PA_MAX_FRAME_BYTES + 1)] })).toBeNull();
		expect(validateChunk({ s: 1, f: Array.from({ length: PA_MAX_FRAMES + 1 }, () => new Uint8Array(10)) })).toBeNull();
		expect(validateChunk({ s: 1, f: Array.from({ length: PA_MAX_FRAMES }, () => new Uint8Array(PA_MAX_FRAME_BYTES)) })).toBeNull();
	});
});

describe('cleanCaption and RateWindow', () => {
	it('strips control characters and caps caption length', () => {
		expect(cleanCaption('hello\u0007\n  world')).toBe('hello world');
		expect(cleanCaption('x'.repeat(500)).length).toBe(280);
		expect(cleanCaption(42)).toBe('');
	});
	it('drops messages past the per-second limit and resets next window', () => {
		const r = new RateWindow(2, 1000);
		expect(r.allow(0)).toBe(true);
		expect(r.allow(10)).toBe(true);
		expect(r.allow(20)).toBe(false);
		expect(r.allow(1000)).toBe(true);
	});
});

// Minimal room double: the real presence, real message routing, recorded sends.
function makeRoom(presence, roomId, { creator = '' } = {}) {
	const handlers = new Map();
	const room = {
		roomId,
		presence,
		clients: [],
		sent: [],
		state: { coin: MINT, players: new Map() },
		coinCreator: creator,
		onMessage(type, fn) { handlers.set(type, fn); },
		broadcast(type, msg, opts) {
			for (const c of room.clients) if (c !== opts?.except) c.send(type, msg);
		},
		_isCreator(client) {
			const p = room.state.players.get(client.sessionId);
			return !!room.coinCreator && p?.account === room.coinCreator;
		},
		async dispatch(client, type, payload) { await handlers.get(type)(client, payload); },
	};
	registerPaHandlers(room);
	return room;
}

function join(room, sessionId, { account = '', name = sessionId } = {}) {
	const client = { sessionId, inbox: [], send(type, msg) { client.inbox.push({ type, msg }); } };
	room.clients.push(client);
	room.state.players.set(sessionId, { account, name });
	return client;
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const types = (c) => c.inbox.map((m) => m.type);

describe('PA relay across rooms for one coin', () => {
	let presence; let general; let holders; let host; let fan; let holder;
	beforeEach(() => {
		presence = new LocalPresence();
		general = makeRoom(presence, 'general-1', { creator: WALLET });
		holders = makeRoom(presence, 'holders-1', { creator: WALLET });
		host = join(general, 'host', { account: WALLET, name: 'Nich' });
		fan = join(general, 'fan');
		holder = join(holders, 'holder');
	});

	it('refuses a non-host and never touches the lock', async () => {
		await general.dispatch(fan, 'pa:start', {});
		expect(fan.inbox.at(-1)).toEqual({ type: 'pa:state', msg: { ok: false, reason: 'not-host' } });
		expect(await presence.get(paLockKey(MINT))).toBeUndefined();
	});

	it('fans audio to every room for the coin, but not back to the presenter', async () => {
		await general.dispatch(host, 'pa:start', {});
		await flush();
		expect(host.inbox.find((m) => m.type === 'pa:state').msg).toMatchObject({ ok: true, live: true, role: 'creator' });
		expect(fan.inbox.find((m) => m.type === 'pa:start').msg).toMatchObject({ name: 'Nich', role: 'creator' });
		expect(holder.inbox.find((m) => m.type === 'pa:start')).toBeTruthy();

		await general.dispatch(host, 'pa:chunk', { s: 0, f: [new Uint8Array([9, 8, 7])] });
		const got = holder.inbox.find((m) => m.type === 'pa:chunk').msg;
		expect(got.s).toBe(0);
		expect([...got.f[0]]).toEqual([9, 8, 7]);
		expect(fan.inbox.some((m) => m.type === 'pa:chunk')).toBe(true);
		expect(types(host)).not.toContain('pa:chunk');
	});

	it('ignores chunks and captions from anyone but the live speaker', async () => {
		await general.dispatch(host, 'pa:start', {});
		await general.dispatch(fan, 'pa:chunk', { s: 0, f: [new Uint8Array([1])] });
		await general.dispatch(fan, 'pa:caption', { text: 'spoof' });
		expect(types(holder)).not.toContain('pa:chunk');
		expect(types(holder)).not.toContain('pa:caption');
	});

	it('holds the mic against a second host unless they force a takeover', async () => {
		const guest = join(holders, 'guest', { name: 'Jessica' });
		const env = process.env.PA_HOST_KEY;
		process.env.PA_HOST_KEY = KEY;
		try {
			await general.dispatch(host, 'pa:start', {});
			await holders.dispatch(guest, 'pa:start', { key: KEY });
			expect(guest.inbox.at(-1).msg).toMatchObject({ ok: false, reason: 'busy', speaker: 'Nich' });

			await holders.dispatch(guest, 'pa:start', { key: KEY, force: true });
			expect(guest.inbox.at(-1).msg).toMatchObject({ ok: true, live: true, role: 'guest-host' });
			expect(host.inbox.some((m) => m.type === 'pa:state' && m.msg.reason === 'taken')).toBe(true);

			// The displaced host's late chunks no longer reach anyone.
			const before = fan.inbox.filter((m) => m.type === 'pa:chunk').length;
			await general.dispatch(host, 'pa:chunk', { s: 5, f: [new Uint8Array([1])] });
			expect(fan.inbox.filter((m) => m.type === 'pa:chunk').length).toBe(before);
		} finally {
			if (env === undefined) delete process.env.PA_HOST_KEY; else process.env.PA_HOST_KEY = env;
		}
	});

	it('frees the mic and clears every banner when the presenter leaves', async () => {
		await general.dispatch(host, 'pa:start', {});
		paOnLeave(general, host);
		await flush();
		expect(types(holder)).toContain('pa:stop');
		expect(await presence.get(paLockKey(MINT))).toBeUndefined();
	});

	it('tells a late joiner who is on the mic, even in a room created after the start', async () => {
		await general.dispatch(host, 'pa:start', {});
		const late = makeRoom(presence, 'general-2', { creator: WALLET });
		const newcomer = join(late, 'newcomer');
		await paSyncJoiner(late, newcomer);
		expect(newcomer.inbox[0]).toMatchObject({ type: 'pa:start', msg: { name: 'Nich' } });
	});

	it('stops relaying into a disposed room', async () => {
		paOnDispose(holders);
		await general.dispatch(host, 'pa:start', {});
		expect(types(holder)).not.toContain('pa:start');
	});
});
