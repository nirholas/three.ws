import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import {
	enable_live_reactions,
	disable_live_reactions,
	_setWsUrl,
} from '../pump-fun-skills/reactive/handlers.js';

// Each test gets a fresh local WS server and a patched URL.
// The production code always points at wss://pumpportal.fun/api/data —
// only _setWsUrl (called here) redirects it for the duration of the test.

function makeProtocol() {
	const events = [];
	return {
		events,
		emit(action) {
			events.push({ type: action.type, payload: action.payload });
		},
	};
}

async function startWss() {
	return new Promise((resolve, reject) => {
		const wss = new WebSocketServer({ port: 0 });
		wss.once('listening', () => resolve(wss));
		wss.once('error', reject);
	});
}

describe('pump-fun-reactive handlers', () => {
	let wss;
	let protocol;

	beforeEach(async () => {
		wss = await startWss();
		const { port } = wss.address();
		_setWsUrl(`ws://localhost:${port}`);
		protocol = makeProtocol();
	});

	afterEach(async () => {
		await disable_live_reactions({}, {});
		// Force-close any lingering server-side connections so wss.close() returns promptly.
		for (const client of wss.clients) {
			client.terminate();
		}
		await new Promise((r) => wss.close(r));
	});

	it('returns already:true when called twice', async () => {
		if (process.env.SKIP_NETWORK_TESTS === '1') return;

		await enable_live_reactions({}, { protocol });
		const second = await enable_live_reactions({}, { protocol });
		expect(second).toEqual({ ok: true, already: true });
	}, 5000);

	it('emits celebrate + speak on migrate event', async () => {
		if (process.env.SKIP_NETWORK_TESTS === '1') return;

		let serverConn;
		const connected = new Promise((r) => wss.once('connection', (ws) => r(ws)));

		enable_live_reactions({}, { protocol });
		serverConn = await connected;

		serverConn.send(JSON.stringify({ txType: 'migrate', name: 'TestCoin' }));

		await new Promise((r) => setTimeout(r, 2300));

		const types = protocol.events.map((e) => e.type);
		expect(types).toContain('gesture');
		expect(types).toContain('emote');
		expect(types).toContain('speak');

		const gesture = protocol.events.find((e) => e.type === 'gesture');
		expect(gesture.payload.name).toBe('celebrate');

		const emote = protocol.events.find((e) => e.type === 'emote');
		expect(emote.payload.trigger).toBe('celebration');

		const speak = protocol.events.find((e) => e.type === 'speak');
		expect(speak.payload.text).toContain('graduated');
	}, 8000);

	it('emits wave + curiosity for 3–9 create events', async () => {
		if (process.env.SKIP_NETWORK_TESTS === '1') return;

		let serverConn;
		const connected = new Promise((r) => wss.once('connection', (ws) => r(ws)));

		enable_live_reactions({}, { protocol });
		serverConn = await connected;

		for (let i = 0; i < 5; i++) {
			serverConn.send(JSON.stringify({ txType: 'create', name: `Coin${i}`, solAmount: 0.1 }));
		}

		await new Promise((r) => setTimeout(r, 2300));

		const gesture = protocol.events.find((e) => e.type === 'gesture');
		expect(gesture?.payload.name).toBe('wave');

		const emote = protocol.events.find((e) => e.type === 'emote');
		expect(emote?.payload.trigger).toBe('curiosity');
	}, 8000);

	it('emits big-buy speak when solAmount > 5', async () => {
		if (process.env.SKIP_NETWORK_TESTS === '1') return;

		let serverConn;
		const connected = new Promise((r) => wss.once('connection', (ws) => r(ws)));

		enable_live_reactions({}, { protocol });
		serverConn = await connected;

		serverConn.send(JSON.stringify({ txType: 'create', name: 'MegaCoin', solAmount: 7.5 }));

		await new Promise((r) => setTimeout(r, 2300));

		const speak = protocol.events.find((e) => e.type === 'speak');
		expect(speak?.payload.text).toContain('7.50 SOL');
	}, 8000);

	it('emits patience when window is empty', async () => {
		if (process.env.SKIP_NETWORK_TESTS === '1') return;

		const connected = new Promise((r) => wss.once('connection', () => r()));
		enable_live_reactions({}, { protocol });
		await connected;

		// No messages — just wait for the first flush.
		await new Promise((r) => setTimeout(r, 2300));

		const emote = protocol.events.find((e) => e.type === 'emote');
		expect(emote?.payload.trigger).toBe('patience');
	}, 8000);

	it('disable_live_reactions stops the feed', async () => {
		if (process.env.SKIP_NETWORK_TESTS === '1') return;

		await enable_live_reactions({}, { protocol });
		const result = await disable_live_reactions({}, {});
		expect(result).toEqual({ ok: true, stopped: true });
	}, 5000);
});
