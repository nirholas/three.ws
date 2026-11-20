// Direct JSON-RPC calls to the three.ws MCP server. Grok makes the model
// through xAI; the server uses these calls only to check the three.ws key
// and to follow a long render's progress between Grok's rounds, with the
// same key and the same tools Grok is allowed to use.

import { readSSE } from '../shared/sse.js';
import { AppError, threeWsBadKey } from './errors.mjs';

let nextId = 1;

function threeWsUnavailable(detail) {
	return new AppError('three_ws_unavailable', {
		title: 'Could not reach three.ws',
		message: `The three.ws MCP server did not answer${detail ? ` (${detail})` : ''}.`,
		fix: 'Check this machine\'s internet connection and three.ws/status, then send again.',
		status: 502,
		retryable: true,
		link: 'https://three.ws/status',
	});
}

async function readRpcReply(res, id) {
	const type = res.headers.get('content-type') || '';
	if (type.includes('text/event-stream')) {
		for await (const evt of readSSE(res.body)) {
			try {
				const msg = JSON.parse(evt.data);
				if (msg && msg.id === id) return msg;
			} catch {
				continue;
			}
		}
		return null;
	}
	return res.json();
}

/** One JSON-RPC request. Returns `result`; throws an AppError on transport or auth failure. */
export async function rpc({ url, apiKey, method, params, signal, fetchImpl = fetch }) {
	const id = nextId++;
	let res;
	try {
		res = await fetchImpl(url, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'application/json, text/event-stream',
				...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
			},
			body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
			signal,
		});
	} catch (err) {
		if (signal?.aborted) throw err;
		throw threeWsUnavailable(err?.message);
	}
	if (res.status === 401 || res.status === 403) {
		await res.body?.cancel().catch(() => {});
		throw threeWsBadKey();
	}
	if (!res.ok) {
		await res.body?.cancel().catch(() => {});
		throw threeWsUnavailable(`HTTP ${res.status}`);
	}
	const msg = await readRpcReply(res, id);
	if (!msg) throw threeWsUnavailable('empty reply');
	if (msg.error) throw threeWsUnavailable(String(msg.error.message || msg.error.code || 'JSON-RPC error'));
	return msg.result;
}

/** tools/call, returning the MCP result ({ content, structuredContent, isError }). */
export function callTool({ url, apiKey, name, args, signal, fetchImpl }) {
	return rpc({ url, apiKey, method: 'tools/call', params: { name, arguments: args }, signal, fetchImpl });
}

/** tools/list: the cheapest call that proves a key is accepted. */
export async function listTools({ url, apiKey, signal, fetchImpl }) {
	const result = await rpc({ url, apiKey, method: 'tools/list', params: {}, signal, fetchImpl });
	return Array.isArray(result?.tools) ? result.tools : [];
}
