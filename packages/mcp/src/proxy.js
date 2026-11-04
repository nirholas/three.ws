// Stdio to Streamable HTTP proxy for the unified three.ws MCP endpoint.
//
// Reads newline-delimited JSON-RPC from `input`, POSTs each message to the
// endpoint, and writes every JSON-RPC message the server answers (plain JSON or
// an SSE stream) to `output`, one per line. The Mcp-Session-Id the server issues
// on initialize is replayed on every later request. No dependencies.

import { createInterface } from 'node:readline';

export const DEFAULT_ENDPOINT = 'https://three.ws/mcp';

const PROTOCOL_HEADER = 'mcp-protocol-version';

/** Pull JSON-RPC messages out of an SSE body. */
function* sseMessages(text) {
	for (const event of text.split(/\r?\n\r?\n/)) {
		const data = event
			.split(/\r?\n/)
			.filter((l) => l.startsWith('data:'))
			.map((l) => l.slice(5).replace(/^ /, ''))
			.join('\n');
		if (data) yield data;
	}
}

function errorReply(id, code, message) {
	return { jsonrpc: '2.0', id, error: { code, message } };
}

/**
 * Create a proxy. `send(line)` forwards one inbound line; replies go to `write`.
 * @param {{endpoint?: string, apiKey?: string, write: (msg: object) => void, fetchImpl?: typeof fetch}} opts
 */
export function createProxy({ endpoint = DEFAULT_ENDPOINT, apiKey, write, fetchImpl = fetch }) {
	let sessionId = null;
	let protocolVersion = null;

	async function send(line) {
		const trimmed = line.trim();
		if (!trimmed) return;
		let msg;
		try {
			msg = JSON.parse(trimmed);
		} catch {
			write(errorReply(null, -32700, 'Parse error: input is not valid JSON.'));
			return;
		}
		const id = msg && typeof msg === 'object' && 'id' in msg ? msg.id : undefined;
		const headers = {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
		};
		if (apiKey) headers.authorization = `Bearer ${apiKey}`;
		if (sessionId) headers['mcp-session-id'] = sessionId;
		if (protocolVersion) headers[PROTOCOL_HEADER] = protocolVersion;

		let res;
		try {
			res = await fetchImpl(endpoint, { method: 'POST', headers, body: trimmed });
		} catch (err) {
			if (id !== undefined) {
				write(errorReply(id, -32000, `Could not reach ${endpoint}: ${err.message}. Check your network and retry.`));
			}
			return;
		}

		const issued = res.headers.get('mcp-session-id');
		if (issued) sessionId = issued;
		if (msg?.method === 'initialize' && res.ok) {
			protocolVersion = msg.params?.protocolVersion ?? protocolVersion;
		}

		const body = await res.text();
		if (res.status === 202 || !body.trim()) return;

		const type = res.headers.get('content-type') || '';
		const chunks = type.includes('text/event-stream') ? [...sseMessages(body)] : [body];
		let delivered = false;
		for (const chunk of chunks) {
			try {
				const parsed = JSON.parse(chunk);
				for (const m of Array.isArray(parsed) ? parsed : [parsed]) {
					write(m);
					delivered = true;
				}
			} catch {
				// A non-JSON chunk is reported below if nothing parseable arrived.
			}
		}
		if (!delivered && id !== undefined) {
			const hint = res.status === 401 || res.status === 403
				? ' Set THREE_WS_API_KEY to a key from https://three.ws/dashboard/api-keys.'
				: '';
			write(errorReply(id, -32000, `${endpoint} answered HTTP ${res.status} with no JSON-RPC body.${hint}`));
		}
	}

	return { send };
}

/** Run the proxy over a pair of streams until `input` closes. */
export async function runStdio({ input = process.stdin, output = process.stdout, env = process.env, fetchImpl } = {}) {
	const proxy = createProxy({
		endpoint: env.THREE_WS_MCP_URL || DEFAULT_ENDPOINT,
		apiKey: env.THREE_WS_API_KEY,
		write: (m) => output.write(`${JSON.stringify(m)}\n`),
		fetchImpl,
	});
	const pending = new Set();
	const rl = createInterface({ input, crlfDelay: Infinity });
	for await (const line of rl) {
		const p = proxy.send(line).finally(() => pending.delete(p));
		pending.add(p);
	}
	await Promise.all(pending);
}
