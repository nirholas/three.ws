// POST /api/gateway/discord-activity-session: an instance id that already
// belongs to one guild/channel must not mint a session for a different one.
// Only the room store is stubbed (offline); Discord's endpoint is a fetch spy and
// the session signing is real.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'node:stream';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.DISCORD_CLIENT_SECRET = 'test-client-secret';

const store = vi.hoisted(() => ({ room: null, participants: 0, events: 0 }));
vi.mock('../api/_lib/gateway/discord-activity-store.js', () => ({
	ensureRoom: async ({ roomId, guildId, channelId }) => {
		store.room ||= { id: roomId, guild_id: guildId, channel_id: channelId };
		return store.room;
	},
	upsertParticipant: async () => { store.participants++; },
	appendEvent: async () => { store.events++; },
}));

const { default: handler } = await import('../api/gateway/discord-activity-session.js');

function mockRes() {
	return {
		statusCode: 200, _headers: {}, _body: '',
		setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
		getHeader(k) { return this._headers[k.toLowerCase()]; },
		end(b) { this._body = b || ''; },
		get headersSent() { return false; },
		get writableEnded() { return false; },
		get json() { try { return JSON.parse(this._body); } catch { return null; } },
	};
}

async function post(body) {
	const req = Readable.from([Buffer.from(JSON.stringify(body))]);
	req.method = 'POST';
	req.url = '/api/gateway/discord-activity-session';
	req.headers = { origin: 'http://localhost:3000', 'content-type': 'application/json' };
	const res = mockRes();
	await handler(req, res);
	return { status: res.statusCode, body: res.json };
}

describe('discord-activity-session room binding', () => {
	let fetchSpy;
	beforeEach(() => {
		store.room = null; store.participants = 0; store.events = 0;
		fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
			ok: true,
			json: async () => ({ application: { id: 'test-client-id' }, user: { id: '42', username: 'eve' } }),
		});
	});
	afterEach(() => fetchSpy.mockRestore());

	const base = { instance_id: 'inst-1', guild_id: '111', channel_id: '222', access_token: 't' };

	it('mints a session for the guild/channel the room was created with', async () => {
		expect((await post(base)).status).toBe(200);
		expect((await post(base)).status).toBe(200);
	});

	it('refuses a session for an existing instance id claimed under another guild or channel', async () => {
		await post(base);
		const squat = await post({ ...base, guild_id: '999', channel_id: '888' });
		expect(squat.status).toBe(403);
		expect(squat.body.session_token).toBeUndefined();
		expect(store.participants).toBe(1);
		expect(store.events).toBe(1);
	});
});
