// A short-lived MCP client session against one external server.
//
// Sessions are opened per operation (list the tools, run one agent turn) and
// closed right after, because a Cloud Run instance serving a chat turn cannot
// hold a standing connection per agent. Streamable HTTP is tried first; a
// server that answers the initialize POST with 404 or 405, or that the catalog
// marks `sse`, gets the legacy HTTP+SSE transport.
//
// Every request goes through ./safe-fetch.js. Auth is either a static header
// (a bearer token the owner pasted) or an OAuthClientProvider (./oauth.js) that
// the SDK uses to refresh tokens on a 401.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport, SseError } from '@modelcontextprotocol/sdk/client/sse.js';
import {
	UnauthorizedError,
	discoverAuthorizationServerMetadata,
	discoverOAuthProtectedResourceMetadata,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { assertServerUrl, createSafeFetch } from './safe-fetch.js';

export const CLIENT_INFO = Object.freeze({ name: 'three.ws-agent', title: 'three.ws agent integrations', version: '1.0.0' });
export const CALL_TIMEOUT_MS = 45_000;
const LIST_TIMEOUT_MS = 20_000;
const MAX_TOOLS = 400;

export class McpConnectError extends Error {
	/**
	 * @param {string} message
	 * @param {'needs_auth'|'unreachable'|'protocol'|'blocked_url'|'tool_error'} code
	 */
	constructor(message, code) {
		super(message);
		this.name = 'McpConnectError';
		this.code = code;
	}
}

function httpStatusOf(err) {
	if (err instanceof StreamableHTTPError || err instanceof SseError) return Number(err.code) || null;
	const m = /HTTP (\d{3})/.exec(String(err?.message || ''));
	return m ? Number(m[1]) : null;
}

/** Map any transport failure onto one of the stable codes the routes report. */
export function normalizeError(err) {
	if (err instanceof McpConnectError) return err;
	if (err?.code === 'blocked_url') return new McpConnectError(err.message, 'blocked_url');
	if (err instanceof UnauthorizedError || err?.code === 'needs_auth' || httpStatusOf(err) === 401 || httpStatusOf(err) === 403) {
		return new McpConnectError('The server needs you to sign in again.', 'needs_auth');
	}
	const msg = String(err?.cause?.message || err?.message || err || 'connection failed').slice(0, 300);
	if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed|aborted|timeout|private address/i.test(msg)) {
		return new McpConnectError(`Could not reach the server: ${msg}`, 'unreachable');
	}
	return new McpConnectError(msg, 'protocol');
}

function buildTransport(kind, url, { headers, authProvider }) {
	const fetchImpl = createSafeFetch({ transport: kind });
	const requestInit = headers ? { headers } : undefined;
	if (kind === 'sse') return new SSEClientTransport(url, { fetch: fetchImpl, authProvider, requestInit });
	return new StreamableHTTPClientTransport(url, { fetch: fetchImpl, authProvider, requestInit });
}

/**
 * Open a connected client. The caller must `close()` it.
 * @param {{ url: string, transport?: string, headers?: Record<string,string>, authProvider?: object }} o
 * @returns {Promise<{ client: Client, transport: string, close: () => Promise<void> }>}
 */
export async function openSession({ url, transport = 'streamable-http', headers, authProvider }) {
	const target = assertServerUrl(url);
	const order = transport === 'sse' ? ['sse'] : ['streamable-http', 'sse'];
	let lastErr = null;
	for (const kind of order) {
		const client = new Client(CLIENT_INFO, { capabilities: {} });
		const t = buildTransport(kind, target, { headers, authProvider });
		try {
			await client.connect(t, { timeout: LIST_TIMEOUT_MS });
			return { client, transport: kind, close: () => client.close().catch(() => {}) };
		} catch (err) {
			await client.close().catch(() => {});
			lastErr = err;
			const status = httpStatusOf(err);
			// Only a "this endpoint does not speak Streamable HTTP" answer is worth
			// retrying over SSE; anything else is the real failure.
			if (!(kind === 'streamable-http' && (status === 404 || status === 405))) break;
		}
	}
	throw normalizeError(lastErr);
}

/** Every tool the server advertises, following pagination, capped at MAX_TOOLS. */
export async function listAllTools(client) {
	const tools = [];
	let cursor;
	do {
		const page = await client.listTools(cursor ? { cursor } : {}, { timeout: LIST_TIMEOUT_MS });
		tools.push(...(page.tools || []));
		cursor = page.nextCursor;
	} while (cursor && tools.length < MAX_TOOLS);
	return tools.slice(0, MAX_TOOLS);
}

/** Open, list, close. */
export async function fetchTools(opts) {
	const session = await openSession(opts);
	try {
		const tools = await listAllTools(session.client);
		const info = session.client.getServerVersion() || null;
		return { tools, serverInfo: info ? { name: info.name, version: info.version } : null, transport: session.transport };
	} catch (err) {
		throw normalizeError(err);
	} finally {
		await session.close();
	}
}

/**
 * Flatten an MCP tool result into text a model can read. Images and audio are
 * described, not inlined; embedded resources contribute their text.
 */
export function toolResultToText(result, maxChars = 16_000) {
	const parts = [];
	for (const c of result?.content || []) {
		if (c.type === 'text') parts.push(c.text);
		else if (c.type === 'resource' && c.resource?.text) parts.push(c.resource.text);
		else if (c.type === 'resource_link') parts.push(`[resource ${c.name || ''} ${c.uri}]`);
		else if (c.type === 'image' || c.type === 'audio') parts.push(`[${c.type} ${c.mimeType || ''} omitted]`);
	}
	if (!parts.length && result?.structuredContent) parts.push(JSON.stringify(result.structuredContent));
	const text = parts.join('\n').trim() || (result?.isError ? 'The tool failed without a message.' : 'The tool returned no content.');
	return text.length > maxChars ? `${text.slice(0, maxChars)}\n[truncated at ${maxChars} characters]` : text;
}

/**
 * Discover how a server wants to be authenticated, without credentials.
 * Returns { auth: 'none', tools } for an open server, { auth: 'oauth',
 * registration } for one that publishes RFC 9728 metadata, or { auth: 'bearer' }
 * for one that answers 401 with no discovery document.
 */
export async function probeServer(url, { transport = 'streamable-http' } = {}) {
	try {
		const listed = await fetchTools({ url, transport });
		return { auth: 'none', ...listed };
	} catch (err) {
		if (err.code !== 'needs_auth') throw err;
	}
	const fetchFn = createSafeFetch();
	let resource = null;
	try {
		resource = await discoverOAuthProtectedResourceMetadata(url, { fetchFn });
	} catch {
		resource = null;
	}
	const asUrl = resource?.authorization_servers?.[0] || new URL('/', url).href;
	let metadata = null;
	try {
		metadata = await discoverAuthorizationServerMetadata(asUrl, { fetchFn });
	} catch {
		metadata = null;
	}
	if (!resource && !metadata) return { auth: 'bearer', registration: null, authorizationServer: null };
	return {
		auth: 'oauth',
		registration: metadata?.registration_endpoint ? 'dynamic' : 'platform',
		authorizationServer: asUrl,
		scopes: resource?.scopes_supported || metadata?.scopes_supported || [],
	};
}
