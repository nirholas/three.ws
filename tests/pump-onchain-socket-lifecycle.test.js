// The pump.fun trade firehose rode web3.js's Connection.onLogs, which hands the
// socket to rpc-websockets with max_reconnects Infinity and a fixed 1s retry.
// Production on 2026-11-25 showed what that costs:
//
// 1. api.mainnet-beta.solana.com closes a busy logsSubscribe socket with a close
//    frame carrying code 1006 (reserved, never legal on the wire) every 10 to 30
//    seconds. The ws library rejects the frame, web3.js prints
//    "ws error: Invalid WebSocket frame: invalid status code 1006" and waits a
//    full second before resubscribing: 219 error lines in under three hours and a
//    second of trades lost on every drop.
// 2. When the lane then refuses the upgrade (HTTP 429), rpc-websockets retries
//    every second, forever, and removeOnLogsListener does not stop it, so a torn
//    down connection keeps hammering the lane for the life of the instance (the
//    "ws error: Unexpected server response: 429" bursts at 1/s).
//
// These tests run the real module against a local ws server that reproduces
// both behaviours.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { WebSocketServer } from 'ws';

vi.mock('../api/_lib/solana/connection.js', () => ({
	solanaRpcEndpoints: () => [],
	resolveWsEndpoint: (u) => String(u).replace(/^http/, 'ws'),
}));

// A close frame (opcode 0x8, FIN) with a 2-byte payload holding code 1006, sent
// unmasked as a server would. This is the exact frame the public lane sends.
const CLOSE_1006 = Buffer.from([0x88, 0x02, 0x03, 0xee]);

let server;
let wss;
let port;
const lane = { refuse: false, upgrades: 0, subscribes: 0 };

function waitFor(pred, ms = 5_000) {
	const started = Date.now();
	return new Promise((resolve, reject) => {
		const tick = () => {
			if (pred()) return resolve(Date.now() - started);
			if (Date.now() - started > ms) return reject(new Error('timed out waiting'));
			setTimeout(tick, 10);
		};
		tick();
	});
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function dropAll() {
	for (const client of wss.clients) client._socket.write(CLOSE_1006);
}

beforeEach(async () => {
	vi.resetModules();
	lane.refuse = false;
	lane.upgrades = 0;
	lane.subscribes = 0;
	server = http.createServer();
	wss = new WebSocketServer({ noServer: true });
	server.on('upgrade', (req, socket, head) => {
		lane.upgrades++;
		if (lane.refuse) {
			socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
			return;
		}
		wss.handleUpgrade(req, socket, head, (ws) => {
			ws.on('error', () => {});
			ws.on('message', (raw) => {
				let msg;
				try { msg = JSON.parse(String(raw)); } catch { return; }
				if (msg.method === 'logsSubscribe') {
					lane.subscribes++;
					ws.send(JSON.stringify({ jsonrpc: '2.0', result: 7000 + lane.subscribes, id: msg.id }));
				} else if (msg.id != null) {
					ws.send(JSON.stringify({ jsonrpc: '2.0', result: true, id: msg.id }));
				}
			});
		});
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	port = server.address().port;
	vi.stubEnv('PUMP_ONCHAIN_WS_URLS', `http://127.0.0.1:${port}`);
});

afterEach(async () => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	for (const client of wss.clients) client.terminate();
	await new Promise((r) => server.close(r));
});

async function attach() {
	const { subscribePumpOnchainTrades } = await import('../api/_lib/pump-onchain-trades.js');
	const detach = subscribePumpOnchainTrades({ onTrade: () => {} });
	await waitFor(() => lane.subscribes >= 1, 15_000);
	return detach;
}

describe('pump firehose socket lifecycle', () => {
	it('stops every upgrade attempt once the last consumer detaches', async () => {
		const detach = await attach();
		lane.refuse = true;
		dropAll();
		await pause(300);
		detach();
		const before = lane.upgrades;
		await pause(3_000);
		expect(lane.upgrades - before).toBe(0);
	}, 30_000);

	it('resubscribes on the same lane well inside a second after a 1006 drop', async () => {
		const detach = await attach();
		dropAll();
		const took = await waitFor(() => lane.subscribes >= 2, 5_000);
		detach();
		expect(took).toBeLessThan(800);
	}, 30_000);

	it('logs repeated drops once instead of one error line per drop', async () => {
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
		const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const detach = await attach();
		for (let i = 2; i <= 4; i++) {
			dropAll();
			await waitFor(() => lane.subscribes >= i, 5_000);
		}
		detach();
		const lines = [...errors.mock.calls, ...warns.mock.calls].map((c) => c.join(' '));
		expect(lines.filter((l) => /ws error/.test(l))).toEqual([]);
		expect(lines.filter((l) => /1006/.test(l)).length).toBeLessThanOrEqual(1);
	}, 30_000);
});
