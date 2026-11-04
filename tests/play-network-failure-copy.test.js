// @vitest-environment jsdom
//
// Work order 256, audit 06: every /play network boundary must tell the player
// what happened in words they can act on. Before this, a dropped connection
// surfaced the browser's own error text ("Failed to fetch", Safari's "Load
// failed", "http 502") inside friend actions, DMs, the war portal, avatar
// uploads and NPC chat; one missed matchmaking poll threw the player out of the
// war queue; an NPC stream that died mid-reply had its real error replaced by
// "They went quiet"; and the aixbt pay demo promised "No funds moved" even after
// the transfer had been signed and sent.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const apiFetch = vi.fn();
vi.mock('../src/api.js', () => ({ apiFetch: (...a) => apiFetch(...a) }));

import { netErrorMessage, isNetworkFailure, NET_UNREACHABLE, NET_SERVER } from '../src/game/net-error.js';

const offline = () => new TypeError('Failed to fetch');

describe('netErrorMessage', () => {
	it('turns every browser spelling of a dropped connection into one actionable line', () => {
		for (const err of [new TypeError('Failed to fetch'), new TypeError('Load failed'), new TypeError('NetworkError when attempting to fetch resource.')]) {
			expect(isNetworkFailure(err)).toBe(true);
			expect(netErrorMessage(err, 'x')).toBe(NET_UNREACHABLE);
		}
	});

	it('reads a 5xx, by status or by a raw "http 502" message, as the server having trouble', () => {
		expect(netErrorMessage(Object.assign(new Error('boom'), { status: 503 }), 'x')).toBe(NET_SERVER);
		expect(netErrorMessage(new Error('http 502'), 'x')).toBe(NET_SERVER);
		expect(netErrorMessage(new Error('HTTP 500'), 'x')).toBe(NET_SERVER);
	});

	it('keeps a real server explanation and swaps internal jargon for the fallback', () => {
		expect(netErrorMessage(new Error('You are already friends.'), 'fallback')).toBe('You are already friends.');
		expect(netErrorMessage(new Error('request failed'), 'Try again.')).toBe('Try again.');
		expect(netErrorMessage(new Error('thread 404'), 'Try again.')).toBe('Try again.');
		expect(netErrorMessage(null, 'Try again.')).toBe('Try again.');
	});
});

describe('friends client', () => {
	let client;
	beforeEach(async () => {
		apiFetch.mockReset();
		const { FriendsClient } = await import('../src/friends.js');
		client = new FriendsClient();
	});

	it('says the server could not be reached when a friend action drops', async () => {
		apiFetch.mockRejectedValueOnce(offline());
		await expect(client.sendRequest('u1')).rejects.toThrow(NET_UNREACHABLE);
	});

	it('says the same when a DM cannot be sent', async () => {
		apiFetch.mockRejectedValueOnce(offline());
		await expect(client.sendDM('u1', 'hi')).rejects.toThrow(NET_UNREACHABLE);
	});

	it('records a failed thread load so the panel can offer Retry instead of "Loading messages" forever', async () => {
		apiFetch.mockRejectedValueOnce(offline());
		await client.loadThread('u1');
		expect(client.threadError('u1')).toBe(NET_UNREACHABLE);
		apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: { messages: [] } }), { status: 200 }));
		await client.loadThread('u1');
		expect(client.threadError('u1')).toBeNull();
	});
});

describe('war portal matchmaking queue', () => {
	let proto;
	beforeEach(async () => {
		({ WarPortal: { prototype: proto } } = await import('../src/game/war-portal.js'));
	});
	const portal = () => ({
		_disposed: false,
		_queue: { status: 'waiting', waiting: 1 },
		_queueError: '',
		_queueMisses: 0,
		_renderPanel: vi.fn(),
		_handoff: vi.fn(),
		_queueRequest: vi.fn(async () => { throw offline(); }),
	});

	it('rides out a dropped poll and keeps the player in the queue', async () => {
		const p = portal();
		await proto._pollQueue.call(p);
		expect(p._queue?.status).toBe('waiting');
		expect(p._queueError).toBe('');
		expect(p._queueHiccup).toBe(true);
	});

	it('gives up after repeated drops with a readable reason, not "Failed to fetch"', async () => {
		const p = portal();
		for (let i = 0; i < 3; i++) await proto._pollQueue.call(p);
		expect(p._queue).toBeNull();
		expect(p._queueError).toBe(NET_UNREACHABLE);
	});
});

describe('avatar upload', () => {
	afterEach(() => vi.restoreAllMocks());
	it('explains a dropped connection while preparing the upload', async () => {
		globalThis.fetch = vi.fn(async () => { throw offline(); });
		const { uploadGlb } = await import('../src/game/avatar-upload.js');
		await expect(uploadGlb({ name: 'a.glb', size: 10 }, () => {})).rejects.toThrow(NET_UNREACHABLE);
	});
});

describe('avatar resolution', () => {
	it('reports when an avatar id could not be resolved, so the switcher never claims a swap that fell back to the default', async () => {
		globalThis.fetch = vi.fn(async () => { throw offline(); });
		const { resolveAvatar, AVATAR_DEFAULT } = await import('../src/game/avatar-rig.js');
		await expect(resolveAvatar('abc123')).resolves.toEqual({ url: AVATAR_DEFAULT, fallback: true });
		await expect(resolveAvatar('/avatars/x.glb')).resolves.toEqual({ url: '/avatars/x.glb', fallback: false });
		await expect(resolveAvatar('')).resolves.toEqual({ url: AVATAR_DEFAULT, fallback: false });
	});
});

describe('NPC chat stream', () => {
	it('keeps the real error when the reply stream dies, instead of overwriting it with an empty done', async () => {
		const { streamReply } = await import('../src/game/npc/npc-chat.js');
		const body = new ReadableStream({ start(c) { c.error(offline()); } });
		globalThis.fetch = vi.fn(async () => new Response(body, { status: 200 }));
		const onError = vi.fn();
		const onDone = vi.fn();
		await streamReply({ provider: 'p', messages: [], system: '', onChunk() {}, onDone, onError });
		expect(onError).toHaveBeenCalledWith(NET_UNREACHABLE);
		expect(onDone).not.toHaveBeenCalled();
	});

	it('explains a request that never reached the server', async () => {
		const { streamReply } = await import('../src/game/npc/npc-chat.js');
		globalThis.fetch = vi.fn(async () => { throw offline(); });
		const onError = vi.fn();
		await streamReply({ provider: 'p', messages: [], system: '', onChunk() {}, onDone() {}, onError });
		expect(onError).toHaveBeenCalledWith(NET_UNREACHABLE);
	});
});

describe('aixbt pay demo failure copy', () => {
	it('only promises "no funds moved" before the transfer was signed', async () => {
		const { paymentFailureCopy } = await import('../src/game/npc/npc-aixbt.js');
		expect(paymentFailureCopy(offline(), 'challenge').noFunds).toBe(true);
		expect(paymentFailureCopy(offline(), 'challenge').text).toContain('No funds moved');
		const late = paymentFailureCopy(offline(), 'verified');
		expect(late.noFunds).toBe(false);
		expect(late.text).not.toContain('No funds moved');
		expect(late.text).toMatch(/may still settle|check/i);
		expect(late.text).not.toContain('Failed to fetch');
	});
});
