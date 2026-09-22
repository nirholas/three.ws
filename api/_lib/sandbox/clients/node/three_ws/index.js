// three_ws: call three.ws tools from inside a sandboxed script.
//
// Every call goes over the local bridge socket ($THREE_WS_SOCKET) to the agent
// runtime, which applies the same rules as a tool call made by the model: only
// tools the run may use, the policy tiers, and no fund-moving tool from inside
// a script (those need a preview and the user's confirmation in the chat).
//
/*
 *   import { tool, fetch } from 'three_ws';
 *   const price = await tool('token_price', { id: 'solana' });
 *   const r = await fetch('https://api.coingecko.com/api/v3/ping');
 *   console.log(r.status, await r.json());
 */
'use strict';

const net = require('node:net');

let nextId = 1;

class BridgeError extends Error {
	constructor(code, message, detail) {
		super(`${code}: ${message}`);
		this.name = 'BridgeError';
		this.code = code;
		this.detail = detail || {};
	}
}

function call(payload) {
	const socketPath = process.env.THREE_WS_SOCKET;
	if (!socketPath) {
		return Promise.reject(new BridgeError('no_bridge', 'THREE_WS_SOCKET is not set: this is not running inside a three.ws sandbox'));
	}
	return new Promise((resolve, reject) => {
		const conn = net.createConnection(socketPath);
		let buf = '';
		conn.setEncoding('utf8');
		conn.on('connect', () => conn.write(`${JSON.stringify({ ...payload, id: nextId++ })}\n`));
		conn.on('data', (chunk) => {
			buf += chunk;
			const nl = buf.indexOf('\n');
			if (nl < 0) return;
			conn.end();
			let msg;
			try {
				msg = JSON.parse(buf.slice(0, nl));
			} catch {
				reject(new BridgeError('bad_response', 'the bridge answered with something that is not JSON'));
				return;
			}
			if (!msg.ok) {
				const err = msg.error || {};
				reject(new BridgeError(err.code || 'bridge_error', err.message || 'bridge call failed', err));
			} else resolve(msg.result);
		});
		conn.on('error', (e) => reject(new BridgeError('bridge_unreachable', e.message)));
		conn.on('end', () => {
			if (!buf.includes('\n')) reject(new BridgeError('bridge_closed', 'the bridge closed the connection without answering'));
		});
	});
}

/** Call a tool the run is allowed to use and resolve to its result. */
function tool(name, args) {
	return call({ op: 'tool', name, args: args || {} });
}

/** The tools this run may call: [{ name, description, tier }]. */
function tools() {
	return call({ op: 'tools' });
}

/** HTTP through the bridge. Only hosts on the run's allowlist are reachable. */
async function fetch(url, init) {
	const opts = init || {};
	let body = opts.body;
	const headers = { ...(opts.headers || {}) };
	if (opts.json !== undefined) {
		body = JSON.stringify(opts.json);
		headers['content-type'] = 'application/json';
	}
	const bodyB64 = body == null ? null : Buffer.from(typeof body === 'string' ? body : body).toString('base64');
	const raw = await call({ op: 'fetch', url, method: opts.method || 'GET', headers, body_base64: bodyB64 });
	const bytes = Buffer.from(raw.body_base64 || '', 'base64');
	return {
		status: raw.status,
		ok: raw.status >= 200 && raw.status < 300,
		url: raw.url,
		headers: raw.headers || {},
		bytes: async () => bytes,
		text: async () => bytes.toString('utf8'),
		json: async () => JSON.parse(bytes.toString('utf8')),
	};
}

/** fetch() that rejects on a non-2xx status and resolves to the parsed JSON body. */
async function fetchJson(url, init) {
	const r = await fetch(url, init);
	if (!r.ok) throw new BridgeError('http_error', `${url} answered ${r.status}`, { status: r.status });
	return r.json();
}

module.exports = { tool, tools, fetch, fetchJson, BridgeError };
