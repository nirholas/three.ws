// The service end to end with no dongle on the bus: the real HTTP server and
// WebSocket, the real session, the real adapter, an empty USB bus.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createDongle } from '../src/dongle.js';
import { createSession } from '../src/session.js';
import { createHeadUnitServer, parseControl } from '../src/server.js';
import { readConfig } from '../src/config.js';
import { bus, manualTimers } from './helpers/usb.js';

async function boot(env = {}) {
	const config = readConfig(env);
	config.port = 0;
	const dongle = createDongle({ webusb: bus(), sleep: async () => {} });
	const session = createSession({ dongle, timers: manualTimers() });
	const app = createHeadUnitServer({ config, dongle, session });
	const { port } = await app.listen();
	await session.start();
	return { app, session, base: `http://127.0.0.1:${port}`, port };
}

test('validates every control message before it can reach the car', () => {
	assert.deepEqual(parseControl('{"type":"touch","x":0.5,"y":1,"action":"down"}'), { type: 'touch', x: 0.5, y: 1, action: 'down' });
	assert.equal(parseControl('{"type":"touch","x":1.5,"y":0,"action":"down"}'), null);
	assert.equal(parseControl('{"type":"touch","x":"0.1","y":0,"action":"down"}'), null);
	assert.equal(parseControl('{"type":"touch","x":0,"y":0,"action":"drag"}'), null);
	assert.deepEqual(parseControl('{"type":"key","name":"home"}'), { type: 'key', name: 'home' });
	assert.equal(parseControl('{"type":"key","name":"wifiPair"}'), null);
	assert.equal(parseControl('not json'), null);
	assert.equal(parseControl('null'), null);
});

test('config: defaults, the headunit preset is forced, bad values refuse to boot', () => {
	const c = readConfig({});
	assert.equal(c.host, '127.0.0.1');
	assert.equal(c.port, 7300);
	assert.equal(c.driveUrl, 'https://three.ws/drive?surface=headunit');
	assert.equal(readConfig({ DRIVE_URL: 'http://localhost:5173/drive' }).driveUrl, 'http://localhost:5173/drive?surface=headunit');
	assert.throws(() => readConfig({ DRIVE_URL: 'http://evil.example/drive' }), /https/);
	assert.throws(() => readConfig({ PROJECTION_WIDTH: '12' }), /PROJECTION_WIDTH/);
	assert.throws(() => readConfig({ HAND_DRIVE: 'middle' }), /HAND_DRIVE/);
});

test('with no dongle: serves the page, reports disconnected, speaks over the socket', async () => {
	const { app, base, port } = await boot();
	try {
		const page = await fetch(`${base}/`);
		assert.equal(page.status, 200);
		assert.match(page.headers.get('content-type'), /text\/html/);
		assert.match(await page.text(), /Connect a CarPlay dongle/);

		for (const asset of ['/app.js', '/wire.js', '/h264.js', '/styles.css']) {
			assert.equal((await fetch(base + asset)).status, 200, asset);
		}
		assert.equal((await fetch(`${base}/../src/server.js`)).status, 404, 'no path escape');
		assert.equal((await fetch(`${base}/%2e%2e/package.json`)).status, 404, 'no encoded path escape');

		const state = await (await fetch(`${base}/api/state`)).json();
		assert.equal(state.state, 'disconnected');
		assert.deepEqual(state.usbIds, ['1314:1520', '1314:1521']);
		assert.equal(state.config.driveUrl, 'https://three.ws/drive?surface=headunit');

		const retried = await (await fetch(`${base}/api/retry`, { method: 'POST' })).json();
		assert.equal(retried.started, true);
		assert.equal(retried.state, 'disconnected');

		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
		const hello = await new Promise((resolve, reject) => {
			ws.once('message', (raw) => resolve(JSON.parse(raw.toString())));
			ws.once('error', reject);
		});
		assert.equal(hello.type, 'hello');
		assert.equal(hello.state, 'disconnected');
		ws.close();
	} finally {
		await app.close();
	}
});
