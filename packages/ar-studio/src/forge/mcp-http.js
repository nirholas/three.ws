// A minimal Model Context Protocol client over HTTP, small enough to ship to a
// browser (no SDK, no dependencies, ~2 kB).
//
// The three.ws 3D Studio connector: the same endpoint ChatGPT talks to: is a
// keyless, CORS-open MCP server. Rather than inventing a private REST shape for
// generation, this package speaks MCP to it directly, so the studio's in-camera
// "type a prompt, get a model" lane IS the ChatGPT 3D Studio pipeline, byte for
// byte, and pointing it at any other MCP server is a one-line config change.
//
// Streamable HTTP servers may answer a POST with either `application/json` or an
// SSE stream; both are handled here, and the SSE branch resolves on the first
// message carrying the matching JSON-RPC id.

let nextId = 1;

/**
 * @param {object} opts
 * @param {string} opts.endpoint     MCP endpoint URL (streamable HTTP).
 * @param {Record<string,string>} [opts.headers]  Extra headers (auth, tracing).
 * @param {typeof fetch} [opts.fetchImpl]
 */
export function createMcpClient({ endpoint, headers = {}, fetchImpl } = {}) {
	if (!endpoint) throw new Error('ar-studio: MCP client needs an endpoint');
	const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
	if (!doFetch) throw new Error('ar-studio: no fetch implementation available');
	let sessionId = '';

	async function rpc(method, params, { signal } = {}) {
		const id = nextId++;
		const res = await doFetch(endpoint, {
			method: 'POST',
			signal,
			headers: {
				'content-type': 'application/json',
				accept: 'application/json, text/event-stream',
				...(sessionId ? { 'mcp-session-id': sessionId } : {}),
				...headers,
			},
			body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }),
		});
		const sid = res.headers.get('mcp-session-id');
		if (sid) sessionId = sid;
		if (!res.ok) {
			const detail = await res.text().catch(() => '');
			throw new McpError(`${method} failed (${res.status})`, { status: res.status, detail });
		}
		const body = await readBody(res, id);
		if (body?.error) throw new McpError(body.error.message || 'MCP error', { code: body.error.code });
		return body?.result ?? null;
	}

	return {
		get sessionId() { return sessionId; },
		rpc,
		/** List the server's tools. */
		listTools(opts) {
			return rpc('tools/list', undefined, opts).then((r) => r?.tools || []);
		},
		/**
		 * Call a tool. Returns the raw MCP result: `{ content, structuredContent, isError }`.
		 */
		callTool(name, args = {}, opts) {
			return rpc('tools/call', { name, arguments: args }, opts);
		},
	};
}

export class McpError extends Error {
	constructor(message, extra = {}) {
		super(message);
		this.name = 'McpError';
		Object.assign(this, extra);
	}
}

async function readBody(res, id) {
	const type = String(res.headers.get('content-type') || '');
	if (!type.includes('text/event-stream')) return res.json();
	// SSE: resolve on the first `data:` payload whose id matches this call.
	const text = await res.text();
	for (const block of text.split(/\n\n+/)) {
		const data = block
			.split('\n')
			.filter((l) => l.startsWith('data:'))
			.map((l) => l.slice(5).trim())
			.join('');
		if (!data) continue;
		try {
			const msg = JSON.parse(data);
			if (msg.id === id || msg.error) return msg;
		} catch {
			// A non-JSON keep-alive frame; keep scanning.
		}
	}
	throw new McpError('MCP stream ended without a result');
}

/** Pull the useful half out of an MCP tool result: structured data plus the text. */
export function unwrapToolResult(result) {
	const structured = result?.structuredContent ?? null;
	const text = (result?.content || [])
		.filter((c) => c?.type === 'text' && typeof c.text === 'string')
		.map((c) => c.text)
		.join('\n')
		.trim();
	return { structured, text, isError: Boolean(result?.isError) };
}
