// Cross-instance WebSocket tunnel for Cloud Run.
//
// Colyseus hands a joining client `/<processId>/<roomId>` and expects the load
// balancer to route that socket to the process that owns the room. Cloud Run
// has one URL and no per-instance routing, so with more than one instance the
// socket lands on a random instance that does not host the room and the seat
// reservation expires. This module makes any instance able to serve any room:
//
//   client --ws--> gateway instance --Redis--> host instance --loopback ws--> room
//
// The gateway (the instance Cloud Run picked) sees an upgrade for a processId
// that is not its own, asks the host over Redis to open a loopback WebSocket to
// its own server (so the room's real onAuth/onJoin run exactly as for a direct
// client), and relays frames both ways. Frames are binary Redis pub/sub
// messages, so Colyseus' binary patches are not re-encoded.
//
// Only active with the Redis presence (REDIS_URI). Without it there is one
// instance and upgrades are never intercepted.

import crypto from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';

const T_OPEN = 1; // gateway -> host: JSON { path, origin, protocol }
const T_ACCEPT = 2; // host -> gateway
const T_REJECT = 3; // host -> gateway: JSON { status, reason }
const T_TEXT = 4; // both ways: utf8 message
const T_BINARY = 5; // both ways: binary message
const T_CLOSE = 6; // both ways: uint16 code + utf8 reason
const T_KEEPALIVE = 7; // gateway -> host: the client socket is still open

const KEEPALIVE_MS = 10_000;
const REAP_MS = 45_000;
const OPEN_TIMEOUT_MS = 8_000;

const hostChannel = (processId) => `three-ws:tunnel:h:${processId}`;
const gatewayChannel = (instanceId) => `three-ws:tunnel:g:${instanceId}`;

function encode(type, id, body) {
	const idBuf = Buffer.from(id, 'utf8');
	const payload = body == null ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(body);
	return Buffer.concat([Buffer.from([type, idBuf.length]), idBuf, payload]);
}

function decode(buf) {
	const type = buf[0];
	const idLen = buf[1];
	return { type, id: buf.subarray(2, 2 + idLen).toString('utf8'), body: buf.subarray(2 + idLen) };
}

function closeBody(code, reason) {
	const r = Buffer.from(String(reason || '').slice(0, 100), 'utf8');
	const head = Buffer.alloc(2);
	head.writeUInt16BE(Number.isInteger(code) && code >= 1000 && code < 5000 ? code : 1011);
	return Buffer.concat([head, r]);
}

function parseClose(body) {
	if (body.length < 2) return { code: 1011, reason: '' };
	return { code: body.readUInt16BE(0), reason: body.subarray(2).toString('utf8') };
}

// A close code a socket may legally send. 1005/1006 are reserved for local use.
function sendableCode(code) {
	return (code >= 1000 && code <= 1003) || (code >= 1007 && code <= 1014) || (code >= 3000 && code < 5000) ? code : 1011;
}

/**
 * @param {object} o
 * @param {import('node:http').Server} o.httpServer
 * @param {object} o.presence      the RedisPresence (its `pub` client is reused, `sub` is duplicated)
 * @param {string} o.processId     matchMaker.processId of this process
 * @param {string} o.instanceId    unique per container instance
 * @param {number|string} o.port   the port this server listens on (loopback target)
 */
export function installTunnel({ httpServer, presence, processId, instanceId, port }) {
	const pub = presence.pub;
	const sub = presence.sub.duplicate();
	const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

	/** gateway side: id -> { client, opened, timer, keepalive, hostPid } */
	const outbound = new Map();
	/** host side: id -> { socket, replyTo, lastSeen } */
	const inbound = new Map();

	const send = (channel, frame) => pub.publish(channel, frame).catch((err) => {
		console.warn('[tunnel] publish failed:', err?.message || err);
	});

	sub.subscribe(hostChannel(processId), gatewayChannel(instanceId));
	sub.on('messageBuffer', (channelBuf, buf) => {
		const channel = channelBuf.toString('utf8');
		let frame;
		try { frame = decode(buf); } catch { return; }
		if (channel === hostChannel(processId)) onHostFrame(frame);
		else if (channel === gatewayChannel(instanceId)) onGatewayFrame(frame);
	});

	// ---- host side: a peer asks us to open a loopback socket to our own rooms

	function onHostFrame({ type, id, body }) {
		if (type === T_OPEN) return openLoopback(id, body);
		const t = inbound.get(id);
		if (!t) return;
		t.lastSeen = Date.now();
		if (type === T_TEXT) t.socket.send(body.toString('utf8'));
		else if (type === T_BINARY) t.socket.send(body, { binary: true });
		else if (type === T_CLOSE) {
			const { code, reason } = parseClose(body);
			try { t.socket.close(sendableCode(code), reason); } catch { t.socket.terminate(); }
		}
	}

	function openLoopback(id, body) {
		let req;
		try { req = JSON.parse(body.toString('utf8')); } catch { return; }
		const replyTo = req.replyTo;
		const headers = req.origin ? { origin: req.origin } : {};
		const socket = new WebSocket(`ws://127.0.0.1:${port}${req.path}`, req.protocol ? [req.protocol] : undefined, { headers, perMessageDeflate: false });
		const t = { socket, replyTo, lastSeen: Date.now() };
		inbound.set(id, t);
		let opened = false;

		socket.on('open', () => {
			opened = true;
			send(replyTo, encode(T_ACCEPT, id));
		});
		socket.on('unexpected-response', (_req, res) => {
			send(replyTo, encode(T_REJECT, id, JSON.stringify({ status: res.statusCode, reason: res.statusMessage || 'rejected' })));
			res.resume();
			inbound.delete(id);
		});
		socket.on('message', (data, isBinary) => {
			const buf = Buffer.isBuffer(data) ? data : Buffer.concat(data);
			send(replyTo, encode(isBinary ? T_BINARY : T_TEXT, id, buf));
		});
		socket.on('close', (code, reason) => {
			inbound.delete(id);
			if (opened) send(replyTo, encode(T_CLOSE, id, closeBody(code, reason?.toString())));
		});
		socket.on('error', (err) => {
			if (!opened) {
				send(replyTo, encode(T_REJECT, id, JSON.stringify({ status: 502, reason: err.message })));
				inbound.delete(id);
			}
		});
	}

	// ---- gateway side: relay frames from the host back to the client

	function onGatewayFrame({ type, id, body }) {
		const t = outbound.get(id);
		if (!t) return;
		if (type === T_ACCEPT) return t.onAccept();
		if (type === T_REJECT) return t.onReject(JSON.parse(body.toString('utf8')));
		const ws = t.client;
		if (!ws || ws.readyState !== WebSocket.OPEN) return;
		if (type === T_TEXT) ws.send(body.toString('utf8'));
		else if (type === T_BINARY) ws.send(body, { binary: true });
		else if (type === T_CLOSE) {
			const { code, reason } = parseClose(body);
			ws.close(sendableCode(code), reason);
		}
	}

	function tunnelUpgrade(req, socket, head, hostPid) {
		const id = crypto.randomUUID();
		const hostCh = hostChannel(hostPid);
		let settled = false;
		const t = { client: null };
		outbound.set(id, t);

		const fail = (status, reason) => {
			if (settled) return;
			settled = true;
			clearTimeout(openTimer);
			outbound.delete(id);
			if (socket.writable) socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
			else socket.destroy();
		};
		const openTimer = setTimeout(() => fail(504, 'room host did not answer'), OPEN_TIMEOUT_MS);

		t.onReject = ({ status, reason }) => fail(Number(status) || 502, String(reason || 'rejected').replace(/[\r\n]/g, ' '));
		t.onAccept = () => {
			if (settled) return;
			settled = true;
			clearTimeout(openTimer);
			wss.handleUpgrade(req, socket, head, (client) => {
				t.client = client;
				let closed = false;
				let alive = true;
				const finish = (code, reason) => {
					if (closed) return;
					closed = true;
					clearInterval(beat);
					outbound.delete(id);
					send(hostCh, encode(T_CLOSE, id, closeBody(code, reason)));
				};
				client.on('message', (data, isBinary) => {
					const buf = Buffer.isBuffer(data) ? data : Buffer.concat(data);
					send(hostCh, encode(isBinary ? T_BINARY : T_TEXT, id, buf));
				});
				client.on('pong', () => { alive = true; });
				client.on('close', (code, reason) => finish(code, reason?.toString()));
				client.on('error', () => finish(1011, 'client socket error'));
				const beat = setInterval(() => {
					if (!alive) { client.terminate(); return; }
					alive = false;
					try { client.ping(); } catch { /* socket already closing */ }
					send(hostCh, encode(T_KEEPALIVE, id));
				}, KEEPALIVE_MS);
				beat.unref?.();
			});
		};

		send(hostCh, encode(T_OPEN, id, JSON.stringify({
			path: req.url,
			origin: req.headers.origin || '',
			protocol: String(req.headers['sec-websocket-protocol'] || '').split(',')[0].trim(),
			replyTo: gatewayChannel(instanceId),
		})));
	}

	// ---- intercept upgrades for rooms owned by a peer process

	const originalEmit = httpServer.emit.bind(httpServer);
	httpServer.emit = function (event, req, socket, head, ...rest) {
		if (event === 'upgrade') {
			const m = /^\/([^/?#]+)\/([^/?#]+)(?:\?|$)/.exec(req.url || '');
			if (m && m[1] !== processId) {
				socket.on('error', () => {});
				tunnelUpgrade(req, socket, head, m[1]);
				return true;
			}
		}
		return originalEmit(event, req, socket, head, ...rest);
	};

	// Host side: drop loopback sockets whose gateway vanished (instance killed).
	const reaper = setInterval(() => {
		const cutoff = Date.now() - REAP_MS;
		for (const [id, t] of inbound) {
			if (t.lastSeen < cutoff) {
				inbound.delete(id);
				t.socket.terminate();
			}
		}
	}, KEEPALIVE_MS);
	reaper.unref?.();

	return {
		stats: () => ({ outbound: outbound.size, inbound: inbound.size }),
		dispose: async () => {
			clearInterval(reaper);
			httpServer.emit = originalEmit;
			for (const t of outbound.values()) t.client?.terminate();
			for (const t of inbound.values()) t.socket.terminate();
			outbound.clear();
			inbound.clear();
			try { sub.disconnect(); } catch { /* already closed */ }
			wss.close();
		},
	};
}
