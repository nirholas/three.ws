// `three-ws proxy <url>`: a stdio MCP server that forwards every message to a
// hosted three.ws server over Streamable HTTP.
//
// What it adds over talking to the server directly:
//   - Credentials come from THREE_WS_API_KEY or the credential store, and an
//     OAuth token is refreshed before it expires and again after any 401, so a
//     client that launched the proxy days ago keeps working.
//   - The tool selection from `three-ws tools` is enforced here: tools/list
//     only returns enabled tools, and a tools/call for a disabled one is
//     answered with an error that says how to enable it, without the request
//     ever reaching the server.
//
// stdout carries JSON-RPC only (one message per line, the MCP stdio framing);
// every diagnostic goes to stderr, which clients surface in their logs.

import readline from 'node:readline';
import { post, PROTOCOL_VERSION } from './mcp-http.js';
import { bearerFor } from './oauth.js';
import { readStore } from './store.js';
import { systemEnv } from './paths.js';
import { isEnabled, normalizeSelection, tierOf, TIER_LABELS } from './policy.js';

function log(msg) {
	process.stderr.write(`[three-ws proxy] ${msg}\n`);
}

export function disabledToolError(id, name, tool) {
	const tier = tool ? tierOf(tool) : null;
	return {
		jsonrpc: '2.0',
		id,
		error: {
			code: -32601,
			message: `The three.ws tool "${name}" is turned off on this machine${tier ? ` (${TIER_LABELS[tier].toLowerCase()} tools are off)` : ''}. Run \`npx three-ws tools\` to enable it.`,
			data: { tool: name, tier, enable: 'npx three-ws tools' },
		},
	};
}

/**
 * Apply the selection to one server response. Mutates and returns `msg`.
 * `knownTools` collects the annotations seen in tools/list, so a later
 * tools/call can be judged by the same tier rules.
 */
export function filterResponse(msg, requestMethod, selection, knownTools) {
	if (requestMethod !== 'tools/list' || !msg?.result?.tools) return msg;
	for (const t of msg.result.tools) knownTools.set(t.name, t);
	msg.result.tools = msg.result.tools.filter((t) => isEnabled(t, selection));
	return msg;
}

export async function runProxy({ url, server, env = systemEnv(), input = process.stdin, output = process.stdout }) {
	const staticKey = env.vars.THREE_WS_API_KEY || null;
	const store = readStore(env);
	const selection = normalizeSelection(server ? store.tools?.[server] : null);
	const origin = new URL(url).origin;
	const knownTools = new Map();
	const pending = new Map();
	let sessionId = null;
	let protocolVersion = PROTOCOL_VERSION;

	const write = (msg) => output.write(`${JSON.stringify(msg)}\n`);

	async function credential(force = false) {
		if (staticKey) return staticKey;
		try {
			return await bearerFor(env, { force, origin });
		} catch (err) {
			log(err.message);
			return null;
		}
	}

	async function forward(payload) {
		let bearer = await credential();
		let res = await post(url, payload, { bearer, sessionId, protocolVersion });
		if (res.status === 401 && !staticKey && bearer) {
			bearer = await credential(true);
			res = await post(url, payload, { bearer, sessionId, protocolVersion });
		}
		if (res.sessionId) sessionId = res.sessionId;
		return res;
	}

	async function handle(line) {
		let msg;
		try {
			msg = JSON.parse(line);
		} catch {
			write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
			return;
		}
		const batch = Array.isArray(msg) ? msg : [msg];
		const outgoing = [];
		for (const m of batch) {
			if (m?.method === 'tools/call' && m.params?.name) {
				const tool = knownTools.get(m.params.name) || { name: m.params.name };
				if (!isEnabled(tool, selection)) {
					write(disabledToolError(m.id, m.params.name, knownTools.get(m.params.name)));
					continue;
				}
			}
			if (m?.method === 'initialize' && m.params?.protocolVersion) protocolVersion = m.params.protocolVersion;
			if (m?.id !== undefined && m?.method) pending.set(m.id, m.method);
			outgoing.push(m);
		}
		if (!outgoing.length) return;
		let res;
		try {
			res = await forward(Array.isArray(msg) ? outgoing : outgoing[0]);
		} catch (err) {
			for (const m of outgoing) {
				if (m?.id === undefined) continue;
				pending.delete(m.id);
				write({ jsonrpc: '2.0', id: m.id, error: { code: -32603, message: `three.ws is unreachable: ${err.message}` } });
			}
			return;
		}
		if (res.status === 401) {
			for (const m of outgoing) {
				if (m?.id === undefined) continue;
				pending.delete(m.id);
				write({ jsonrpc: '2.0', id: m.id, error: { code: -32001, message: 'three.ws rejected the credential. Run `npx three-ws login`, then restart this client.' } });
			}
			return;
		}
		for (const reply of res.messages) {
			const method = pending.get(reply.id);
			if (reply.id !== undefined) pending.delete(reply.id);
			if (reply.result?.protocolVersion) protocolVersion = reply.result.protocolVersion;
			write(filterResponse(reply, method, selection, knownTools));
		}
		// A non-2xx with no JSON-RPC body still owes each request an answer.
		if (!res.messages.length && res.status >= 400) {
			for (const m of outgoing) {
				if (m?.id === undefined) continue;
				pending.delete(m.id);
				write({ jsonrpc: '2.0', id: m.id, error: { code: -32603, message: `three.ws answered HTTP ${res.status}` } });
			}
		}
	}

	if (!staticKey && !store.auth) log('no credential stored; keyless servers still work. Run `npx three-ws login` for the rest.');
	const rl = readline.createInterface({ input, crlfDelay: Infinity });
	const inflight = new Set();
	rl.on('line', (line) => {
		if (!line.trim()) return;
		const p = handle(line).catch((err) => log(`unexpected: ${err.stack || err.message}`));
		inflight.add(p);
		p.finally(() => inflight.delete(p));
	});
	await new Promise((resolve) => rl.once('close', resolve));
	await Promise.allSettled([...inflight]);
}
