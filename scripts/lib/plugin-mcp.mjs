// MCP helpers for checking a coding-agent plugin (Cursor, Grok Build) against
// the live servers its config names. Everything here goes through the official
// @modelcontextprotocol/sdk client, so what passes is what a real MCP client
// sees: the same transport, the same 401 handling, the same discovery calls.
//
// Used by tests/cursor-plugin-tool-surface.test.js and
// scripts/cursor-plugin-session-check.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
	UnauthorizedError,
	discoverAuthorizationServerMetadata,
	discoverOAuthProtectedResourceMetadata,
	extractWWWAuthenticateParams,
} from '@modelcontextprotocol/sdk/client/auth.js';

export const CLIENT_INFO = Object.freeze({ name: 'three-ws-plugin-check', version: '1.0.0' });

// A plugin listed for coding agents must not expose anything that moves money.
// Matched against tool names and descriptions with `_` and `-` read as word
// breaks, so `pay_and_call` and `wallet-status` are caught while words that
// merely start the same ("payload", "sendable" aside) are not.
export const SPEND_WORDS = /\b(wallets?|transfer\w*|send\w*|swap\w*|trad(?:e|es|ed|er|ers|ing)|launch\w*|pay|pays|paid|paying|payments?|payout\w*|x402|withdraw\w*)\b/i;

/**
 * The MCP servers a plugin's config declares, in file order.
 * @param {string} configPath mcp.json (Cursor) or .mcp.json (Grok Build)
 * @returns {Array<{ name: string, url: string }>}
 */
export function readMcpServers(configPath) {
	const doc = JSON.parse(fs.readFileSync(configPath, 'utf8'));
	const servers = doc.mcpServers || {};
	return Object.entries(servers)
		.filter(([, s]) => s && typeof s.url === 'string')
		.map(([name, s]) => ({ name, url: s.url }));
}

/** Locate the MCP config file inside a plugin directory. */
export function pluginMcpConfig(dir) {
	// Cursor and Grok Build read mcp.json / .mcp.json; a Gemini CLI extension
	// declares its servers in gemini-extension.json under the same mcpServers key.
	for (const f of ['mcp.json', '.mcp.json', 'gemini-extension.json']) {
		const p = path.join(dir, f);
		if (fs.existsSync(p)) return p;
	}
	throw new Error(`${dir}: no mcp.json, .mcp.json or gemini-extension.json`);
}

/**
 * Tools whose name or description reads as a spend surface.
 * @param {Array<{ name: string, description?: string }>} tools
 */
export function spendSurfaceHits(tools) {
	const hits = [];
	for (const t of tools) {
		for (const [field, text] of [
			['name', t.name],
			['description', t.description || ''],
		]) {
			const m = SPEND_WORDS.exec(String(text).replace(/[_-]/g, ' '));
			if (m) hits.push({ tool: t.name, field, word: m[1] });
		}
	}
	return hits;
}

/**
 * Open an authenticated MCP session with a three.ws API key as the bearer.
 * @returns {Promise<{ client: Client, close: () => Promise<void> }>}
 */
export async function openSession(url, apiKey) {
	const transport = new StreamableHTTPClientTransport(new URL(url), {
		requestInit: { headers: { authorization: `Bearer ${apiKey}` } },
	});
	const client = new Client(CLIENT_INFO, { capabilities: {} });
	await client.connect(transport);
	return { client, close: () => client.close() };
}

/**
 * Connect without credentials, the way Cursor does on first use, and follow the
 * discovery chain the 401 hands back: WWW-Authenticate -> protected-resource
 * metadata (RFC 9728) -> authorization-server metadata (RFC 8414).
 */
export async function probeUnauthenticated(url) {
	let challenge = null;
	const recordingFetch = async (input, init) => {
		const res = await fetch(input, init);
		if (res.status === 401 && !challenge) {
			challenge = { status: res.status, header: res.headers.get('www-authenticate'), params: extractWWWAuthenticateParams(res) };
		}
		return res;
	};
	const transport = new StreamableHTTPClientTransport(new URL(url), { fetch: recordingFetch });
	const client = new Client(CLIENT_INFO, { capabilities: {} });
	let unauthorized = false;
	let connectError = null;
	try {
		await client.connect(transport);
	} catch (err) {
		connectError = err;
		// With no authProvider the SDK surfaces the 401 as StreamableHTTPError
		// code 401; with one it throws UnauthorizedError. Either means "sign in".
		unauthorized = err instanceof UnauthorizedError || (err instanceof StreamableHTTPError && err.code === 401);
	} finally {
		await client.close().catch(() => {});
	}
	if (!challenge) {
		return { unauthorized, challenge: null, resourceMetadata: null, authServer: null, error: connectError?.message || 'server accepted an unauthenticated session' };
	}
	const resourceMetadata = await discoverOAuthProtectedResourceMetadata(new URL(url), {
		resourceMetadataUrl: challenge.params.resourceMetadataUrl,
	});
	const issuer = resourceMetadata.authorization_servers?.[0];
	const authServer = issuer ? await discoverAuthorizationServerMetadata(new URL(issuer)) : null;
	return { unauthorized, challenge, resourceMetadata, authServer, error: null };
}

/** First text block of a tool result, parsed as JSON when it is JSON. */
export function toolPayload(result) {
	if (result?.structuredContent) return result.structuredContent;
	const text = (result?.content || []).find((c) => c.type === 'text')?.text;
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return { text };
	}
}
