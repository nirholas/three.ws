// Remote tools: every three.ws MCP server the config names, mounted over
// Streamable HTTP with the account's bearer credential.
//
// Each tool is classified for the approval gate from the policy block every
// three.ws server stamps on tools/list (`_meta['three.ws/policy'].tier`), and
// from the standard MCP annotations when a server predates the policy:
//   read       readOnlyHint, or policy tier read
//   write      policy tier write, or no hint at all
//   financial  policy tier financial, or destructiveHint
//
// A tool name defined by two servers is mounted once (first server wins) and
// the duplicate is reported, never silently shadowed.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { USER_AGENT, VERSION } from './http.js';

const CONNECT_TIMEOUT_MS = 20_000;
const CALL_TIMEOUT_MS = 120_000;

export function classifyMcpTool(tool) {
	const tier = tool?._meta?.['three.ws/policy']?.tier;
	if (tier === 'financial') return 'financial';
	if (tier === 'read') return 'read';
	if (tier === 'write') return 'write';
	const a = tool?.annotations || {};
	if (a.destructiveHint === true) return 'financial';
	if (a.readOnlyHint === true) return 'read';
	return 'write';
}

/** Flatten an MCP tool result into something a model reads well. */
export function flattenToolResult(result) {
	const parts = [];
	for (const c of result?.content || []) {
		if (c.type === 'text') parts.push(c.text);
		else if (c.type === 'resource' && c.resource?.text) parts.push(c.resource.text);
		else if (c.type === 'resource_link') parts.push(`[resource] ${c.uri}`);
		else if (c.type === 'image') parts.push(`[image ${c.mimeType || ''}]`);
	}
	const out = { text: parts.join('\n').trim() };
	if (result?.structuredContent !== undefined) out.data = result.structuredContent;
	if (result?.isError) out.error = true;
	return out;
}

function serverUrl(origin, server) {
	return /^https?:\/\//.test(server) ? server : `${origin}${server.startsWith('/') ? '' : '/'}${server}`;
}

async function withTimeout(promise, ms, what) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Connect to every configured server. Never throws for one bad server: its
 * failure is reported in `servers[i].error` and the rest still mount.
 */
export async function connectMcp({ origin, servers, token }) {
	const mounted = [];
	const tools = new Map();
	const duplicates = [];

	await Promise.all(
		servers.map(async (server) => {
			const url = serverUrl(origin, server);
			const entry = { server, url, client: null, toolCount: 0, error: null };
			mounted.push(entry);
			const headers = { 'user-agent': USER_AGENT };
			if (token) headers.authorization = `Bearer ${token}`;
			try {
				const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } });
				const client = new Client({ name: 'three-ws-agent', version: VERSION }, { capabilities: {} });
				await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, `connecting to ${server}`);
				const listed = [];
				let cursor;
				do {
					const page = await withTimeout(client.listTools(cursor ? { cursor } : {}), CONNECT_TIMEOUT_MS, `listing tools on ${server}`);
					listed.push(...(page.tools || []));
					cursor = page.nextCursor;
				} while (cursor);
				entry.client = client;
				entry.tools = listed;
				entry.toolCount = listed.length;
			} catch (err) {
				entry.error = String(err?.message || err).slice(0, 300);
			}
		}),
	);

	// Mount in config order so "first server wins" is deterministic.
	const ordered = servers.map((s) => mounted.find((m) => m.server === s));
	for (const entry of ordered) {
		for (const t of entry.tools || []) {
			if (tools.has(t.name)) {
				duplicates.push({ name: t.name, kept: tools.get(t.name).server, dropped: entry.server });
				continue;
			}
			tools.set(t.name, {
				name: t.name,
				server: entry.server,
				description: t.description || t.title || t.name,
				inputSchema: t.inputSchema || { type: 'object', properties: {} },
				toolClass: classifyMcpTool(t),
				client: entry.client,
			});
		}
	}

	async function call(name, args, { signal } = {}) {
		const tool = tools.get(name);
		if (!tool) throw new Error(`unknown remote tool ${name}`);
		const result = await tool.client.callTool({ name, arguments: args || {} }, undefined, { signal, timeout: CALL_TIMEOUT_MS });
		return flattenToolResult(result);
	}

	async function close() {
		await Promise.all(ordered.map((m) => m.client?.close().catch(() => {})));
	}

	return { servers: ordered.map(({ server, url, toolCount, error }) => ({ server, url, toolCount, error })), tools, duplicates, call, close };
}
