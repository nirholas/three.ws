// Thin client for three.ws's MCP JSON-RPC servers and its public chat API.
// No SDK dependency here on purpose: both /api/mcp-studio (free) and /api/mcp
// (paid, x402-gated) speak plain JSON-RPC 2.0 "tools/call" over HTTPS, and
// /api/chat is a plain SSE POST. Framework adapters (ai-sdk, langchain) wrap
// these calls in their own tool shape; this file is the one place that knows
// the wire format, so neither adapter can drift from the live API.

const DEFAULT_BASE_URL = 'https://three.ws';
const FREE_MCP_PATH = '/api/mcp-studio';
const PAID_MCP_PATH = '/api/mcp';
const CHAT_PATH = '/api/chat';

/**
 * Call a tool on a three.ws MCP JSON-RPC server.
 * @param {object} opts
 * @param {string} [opts.baseUrl]
 * @param {'free'|'paid'} [opts.surface] which server to call
 * @param {string} opts.tool the MCP tool name, e.g. "forge_free"
 * @param {object} opts.args the tool's arguments
 * @param {string} [opts.apiKey] bearer token for the paid server
 * @param {string} [opts.xPayment] a pre-signed X-PAYMENT header value for an
 *   x402-gated tool. three.ws never signs a payment on the caller's behalf;
 *   obtain this from an x402 client (e.g. the `x402-fetch` package) wired to
 *   the caller's own wallet, then pass the resulting header value through.
 * @returns {Promise<{ok: true, result: object} | {ok: false, paymentRequired: true, challenge: object} | {ok: false, error: string}>}
 */
export async function callThreeWsTool({ baseUrl = DEFAULT_BASE_URL, surface = 'free', tool, args, apiKey, xPayment }) {
	const path = surface === 'paid' ? PAID_MCP_PATH : FREE_MCP_PATH;
	const headers = { 'content-type': 'application/json' };
	if (apiKey) headers.authorization = `Bearer ${apiKey}`;
	if (xPayment) headers['x-payment'] = xPayment;

	const res = await fetch(`${baseUrl}${path}`, {
		method: 'POST',
		headers,
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: Date.now(),
			method: 'tools/call',
			params: { name: tool, arguments: args },
		}),
	});

	if (res.status === 402) {
		const challenge = await res.json().catch(() => null);
		return { ok: false, paymentRequired: true, challenge };
	}
	if (!res.ok) {
		return { ok: false, error: `three.ws ${surface} MCP ${res.status}: ${await res.text().catch(() => res.statusText)}` };
	}

	const body = await res.json();
	if (body.error) return { ok: false, error: body.error.message || JSON.stringify(body.error) };
	const result = body.result;
	if (result?.isError) {
		const text = result.content?.find((c) => c.type === 'text')?.text || 'tool call failed';
		return { ok: false, error: text };
	}
	return { ok: true, result };
}

/** Pull the plain-text answer out of an MCP tool result's content blocks. */
export function toolResultText(result) {
	return (result?.content || [])
		.filter((c) => c.type === 'text')
		.map((c) => c.text)
		.join('\n');
}

/**
 * Send one message to a three.ws agent (or the default viewer agent) and
 * return its full reply. Streams the real SSE response and resolves once the
 * "done" event lands; does not fabricate a reply on network failure.
 * @param {object} opts
 * @param {string} [opts.baseUrl]
 * @param {string} opts.message
 * @param {string} [opts.agentId] a three.ws agent UUID; omitted = default agent
 * @param {Array<{role: string, content: string}>} [opts.history]
 */
export async function callThreeWsChat({ baseUrl = DEFAULT_BASE_URL, message, agentId, history }) {
	const res = await fetch(`${baseUrl}${CHAT_PATH}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ message, ...(agentId ? { agentId } : {}), ...(history ? { history } : {}) }),
	});
	if (!res.ok) throw new Error(`three.ws chat ${res.status}: ${await res.text().catch(() => res.statusText)}`);

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let done = null;
	while (true) {
		const { value, done: streamDone } = await reader.read();
		if (streamDone) break;
		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split('\n\n');
		buffer = lines.pop();
		for (const line of lines) {
			const payload = line.replace(/^data: /, '').trim();
			if (!payload) continue;
			const event = JSON.parse(payload);
			if (event.type === 'done') done = event;
			if (event.type === 'error') throw new Error(event.error || 'three.ws chat stream error');
		}
	}
	if (!done) throw new Error('three.ws chat stream ended without a done event');
	return done;
}
