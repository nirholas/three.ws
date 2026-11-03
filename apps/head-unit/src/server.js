// The head unit service: owns the USB dongle, serves the page, and streams the
// projected screen and its audio to that page over one WebSocket.
//
//   GET  /             the head unit page (public/index.html)
//   GET  /<asset>      the page's own scripts and styles
//   GET  /api/state    the session snapshot plus the page's config
//   POST /api/retry    probe the dongle now instead of waiting
//   WS   /ws           state (JSON) and media (binary, see public/wire.js) out;
//                      touch and key input (JSON) in
//
// It binds to loopback by default: the page is a car's own screen, and a touch
// forwarded from anywhere else would be a stranger's finger on the dashboard.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { HandDriveType } from 'node-carplay/node';
import { ALLOWED_KEYS, createDongle } from './dongle.js';
import { createSession } from './session.js';
import { readConfig } from './config.js';
import { encodeAudio, encodeVideo } from '../public/wire.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.svg': 'image/svg+xml',
};
// A client this far behind on video is skipped until it drains, so one slow
// tab cannot grow the service's memory without bound.
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
const TOUCH_ACTIONS = new Set(['down', 'move', 'up']);

/** Validate one inbound control message. Returns null for anything malformed. */
export function parseControl(text) {
	let msg;
	try {
		msg = JSON.parse(text);
	} catch {
		return null;
	}
	if (!msg || typeof msg !== 'object') return null;
	if (msg.type === 'touch') {
		const { x, y, action } = msg;
		if (!TOUCH_ACTIONS.has(action)) return null;
		if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
		return { type: 'touch', x, y, action };
	}
	if (msg.type === 'key' && ALLOWED_KEYS.includes(msg.name)) return { type: 'key', name: msg.name };
	if (msg.type === 'retry') return { type: 'retry' };
	return null;
}

/**
 * @param {object} opts
 * @param {ReturnType<typeof readConfig>} opts.config
 * @param {ReturnType<typeof createDongle>} opts.dongle
 * @param {ReturnType<typeof createSession>} opts.session
 */
export function createHeadUnitServer({ config, dongle, session }) {
	const pageConfig = {
		driveUrl: config.driveUrl,
		hand: config.hand,
		projection: { width: config.projection.width, height: config.projection.height },
		boxName: config.boxName,
	};
	const statePayload = () => ({ ...session.snapshot(), config: pageConfig });

	const server = http.createServer(async (req, res) => {
		const url = new URL(req.url, 'http://local');
		try {
			if (url.pathname === '/api/state' && req.method === 'GET') return json(res, 200, statePayload());
			if (url.pathname === '/api/retry' && req.method === 'POST') {
				const started = await session.retryNow();
				return json(res, 200, { started, ...statePayload() });
			}
			if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
			return await serveStatic(url.pathname, res);
		} catch (err) {
			return json(res, 500, { error: err.message });
		}
	});

	const wss = new WebSocketServer({ server, path: '/ws' });
	const send = (ws, data) => ws.readyState === ws.OPEN && ws.send(data);
	const broadcast = (data, isVideo = false) => {
		for (const ws of wss.clients) {
			if (isVideo && ws.bufferedAmount > MAX_BUFFERED_BYTES) continue;
			send(ws, data);
		}
	};

	const off = [
		session.onChange((snap) => broadcast(JSON.stringify({ type: 'state', ...snap }))),
		dongle.onPhone((phone) => broadcast(JSON.stringify({ type: 'phone', phone }))),
		dongle.onVideo((video) => broadcast(encodeVideo(video), true)),
		dongle.onAudio((audio) => {
			if (audio.kind === 'pcm') broadcast(encodeAudio(audio));
			else broadcast(JSON.stringify({ type: 'audio', ...audio }));
		}),
	];

	wss.on('connection', (ws) => {
		send(ws, JSON.stringify({ type: 'hello', ...statePayload() }));
		// A page that joins mid-stream has no keyframe to start from: ask for one.
		dongle.sendKey('frame');
		ws.on('message', (raw, isBinary) => {
			if (isBinary) return;
			const msg = parseControl(raw.toString('utf8'));
			if (!msg) return;
			if (msg.type === 'touch') dongle.sendTouch(msg.x, msg.y, msg.action);
			else if (msg.type === 'key') dongle.sendKey(msg.name);
			else if (msg.type === 'retry') session.retryNow();
		});
	});

	return {
		server,
		listen: () =>
			new Promise((resolve, reject) => {
				server.once('error', reject);
				server.listen(config.port, config.host, () => resolve(server.address()));
			}),
		async close() {
			for (const fn of off) fn();
			for (const ws of wss.clients) ws.terminate();
			await new Promise((r) => wss.close(r));
			await new Promise((r) => server.close(r));
		},
	};
}

function json(res, status, body) {
	res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
	res.end(JSON.stringify(body));
}

async function serveStatic(pathname, res) {
	const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
	const file = path.resolve(PUBLIC_DIR, rel);
	const type = TYPES[path.extname(file)];
	if (!file.startsWith(PUBLIC_DIR) || !type) return json(res, 404, { error: 'Not found' });
	let body;
	try {
		body = await readFile(file);
	} catch {
		return json(res, 404, { error: 'Not found' });
	}
	res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
	res.end(body);
}

async function main() {
	const config = readConfig();
	const { webusb } = await import('usb');
	const { NodeMicrophone } = await import('node-carplay/node');
	const dongle = createDongle({
		webusb,
		config: {
			width: config.projection.width,
			height: config.projection.height,
			fps: config.projection.fps,
			dpi: config.projection.dpi,
			nightMode: config.nightMode,
			boxName: config.boxName,
			hand: config.hand === 'rhd' ? HandDriveType.RHD : HandDriveType.LHD,
		},
		createMicrophone: config.microphone ? () => new NodeMicrophone() : null,
	});
	const session = createSession({ dongle });
	const app = createHeadUnitServer({ config, dongle, session });
	const address = await app.listen();
	console.log(`[head-unit] http://${address.address}:${address.port}/  agent ${config.driveUrl}`);
	// Log what changed, not every probe: with no dongle the session cycles
	// probing/disconnected every few seconds and the journal should stay quiet.
	dongle.onInfo((info) => {
		if (info.firmware) console.log(`[head-unit] dongle firmware ${info.firmware}`);
		if (info.bluetoothAddress) console.log(`[head-unit] dongle bluetooth ${info.bluetoothAddress}`);
	});
	let lastLine = '';
	session.onChange((s) => {
		if (s.state === 'probing') return;
		const line = `[head-unit] ${s.state}${s.phone ? ` (${s.phone.type})` : ''}${s.error ? `: ${s.error}` : ''}`;
		if (line !== lastLine) console.log(line);
		lastLine = line;
	});
	session.start();

	const shutdown = async () => {
		await session.stop();
		await app.close();
		process.exit(0);
	};
	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((err) => {
		console.error(`[head-unit] failed to start: ${err.message}`);
		process.exit(1);
	});
}
