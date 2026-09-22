// A minimal MCP Streamable HTTP client (spec 2025-06-18): POST one JSON-RPC
// message or batch, read back either application/json or a text/event-stream
// of messages. Used by `setup`/`status` to run a real tools/list, and by the
// stdio proxy to forward a client's traffic.

import { request, ApiError, VERSION } from './http.js';

export const PROTOCOL_VERSION = '2025-06-18';

/** Parse a text/event-stream body into the JSON-RPC messages its data lines carry. */
export function parseSse(text) {
	const out = [];
	for (const block of String(text).split(/\r?\n\r?\n/)) {
		const data = block
			.split(/\r?\n/)
			.filter((line) => line.startsWith('data:'))
			.map((line) => line.slice(5).replace(/^ /, ''))
			.join('\n');
		if (!data) continue;
		try {
			const msg = JSON.parse(data);
			if (Array.isArray(msg)) out.push(...msg);
			else out.push(msg);
		} catch {
			// A non-JSON data line is a keep-alive or comment; nothing to deliver.
		}
	}
	return out;
}

/**
 * POST a JSON-RPC payload. Returns { status, messages, sessionId }.
 * `messages` is always an array (empty for 202 Accepted notifications).
 */
export async function post(url, payload, { bearer, sessionId, protocolVersion = PROTOCOL_VERSION, headers = {}, timeoutMs = 60_000 } = {}) {
	const h = {
		'content-type': 'application/json',
		accept: 'application/json, text/event-stream',
		'mcp-protocol-version': protocolVersion,
		...headers,
	};
	if (bearer) h.authorization = `Bearer ${bearer}`;
	if (sessionId) h['mcp-session-id'] = sessionId;
	const res = await request(url, { method: 'POST', headers: h, body: JSON.stringify(payload), timeoutMs });
	const nextSession = res.headers.get('mcp-session-id') || sessionId || null;
	if (res.status === 202 || res.status === 204) return { status: res.status, messages: [], sessionId: nextSession };
	const type = res.headers.get('content-type') || '';
	const text = await res.text();
	let messages = [];
	if (type.includes('text/event-stream')) messages = parseSse(text);
	else if (text) {
		try {
			const parsed = JSON.parse(text);
			messages = Array.isArray(parsed) ? parsed : [parsed];
		} catch {
			messages = [];
		}
	}
	return { status: res.status, messages, sessionId: nextSession, body: text };
}

function describeHttpFailure(url, result) {
	let detail = '';
	try {
		const body = JSON.parse(result.body || '{}');
		detail = body.error_description || body.error?.message || body.error || '';
	} catch {
		detail = '';
	}
	return `${new URL(url).pathname} answered ${result.status}${detail ? `: ${detail}` : ''}`;
}

/** initialize + notifications/initialized + tools/list; returns the tool array. */
export async function listTools(url, { bearer, headers } = {}) {
	const init = await post(url, {
		jsonrpc: '2.0',
		id: 1,
		method: 'initialize',
		params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'three-ws-cli', version: VERSION } },
	}, { bearer, headers });
	if (init.status === 401) throw new ApiError(`${new URL(url).pathname} rejected the credential (401). Run \`npx three-ws login\`.`, { status: 401, code: 'unauthorized' });
	if (init.status >= 400) throw new ApiError(describeHttpFailure(url, init), { status: init.status });
	const initMsg = init.messages.find((m) => m.id === 1);
	if (initMsg?.error) throw new ApiError(`initialize failed: ${initMsg.error.message}`);
	const protocolVersion = initMsg?.result?.protocolVersion || PROTOCOL_VERSION;
	await post(url, { jsonrpc: '2.0', method: 'notifications/initialized' }, { bearer, headers, sessionId: init.sessionId, protocolVersion });

	const tools = [];
	let cursor;
	for (let page = 0; page < 20; page++) {
		const res = await post(url, { jsonrpc: '2.0', id: 2 + page, method: 'tools/list', params: cursor ? { cursor } : {} }, { bearer, headers, sessionId: init.sessionId, protocolVersion });
		if (res.status >= 400) throw new ApiError(describeHttpFailure(url, res), { status: res.status });
		const msg = res.messages.find((m) => m.id === 2 + page);
		if (!msg) throw new ApiError(`${new URL(url).pathname} returned no tools/list response`);
		if (msg.error) throw new ApiError(`tools/list failed: ${msg.error.message}`);
		tools.push(...(msg.result?.tools || []));
		cursor = msg.result?.nextCursor;
		if (!cursor) break;
	}
	return { tools, serverInfo: initMsg?.result?.serverInfo || null };
}
