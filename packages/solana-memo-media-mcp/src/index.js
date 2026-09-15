#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { def as decodeDataUri } from './tools/decode-data-uri.js';
import { def as extractTransaction } from './tools/extract-transaction.js';
import { def as findAddressMedia } from './tools/find-address-media.js';
import { def as status } from './tools/status.js';

const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require('../package.json');
export const TOOLS = [decodeDataUri, extractTransaction, findAddressMedia, status];

function responseFor(result) {
	const images = [];
	function publicValue(value) {
		if (Array.isArray(value)) return value.map(publicValue);
		if (!value || typeof value !== 'object') return value;
		if (value.media?.base64 && value.metadata) {
			images.push({ type: 'image', data: value.media.base64, mimeType: value.media.mimeType });
			return value.metadata;
		}
		const out = {};
		for (const [key, item] of Object.entries(value)) {
			if (key !== 'media' && key !== 'bytes') out[key] = publicValue(item);
		}
		return out;
	}
	const structured = publicValue(result);
	return { content: [{ type: 'text', text: JSON.stringify({ ok: true, ...structured }, null, 2) }, ...images], structuredContent: { ok: true, ...structured } };
}

export function buildServer() {
	const server = new McpServer(
		{ name: 'solana-memo-media-mcp', title: 'three.ws Solana Memo Media', version: PKG_VERSION },
		{ capabilities: { tools: {} }, instructions: 'Extract supported image data URIs from Solana SPL Memo instructions without copy-pasting into a converter. Every tool is read-only. Data URIs are decoded locally, limited to 256 KiB, restricted to PNG, JPEG, WebP, or GIF, and checked against their file signature before bytes are returned as MCP image content. An embedded image proves only that its bytes appeared in the specified transaction. Verify signer, signature, and context independently.' },
	);
	for (const tool of TOOLS) {
		server.registerTool(tool.name, { title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations }, async (args) => {
			try { return responseFor(await tool.handler(args)); }
			catch (error) { return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: error?.code || 'unhandled', message: error?.message || String(error) }, null, 2) }], isError: true }; }
		});
	}
	return server;
}

async function main() {
	const server = buildServer();
	await server.connect(new StdioServerTransport());
	console.error(`[solana-memo-media-mcp@${PKG_VERSION}] connected over stdio with ${TOOLS.length} tools`);
}

function isProcessEntryPoint() {
	if (!process.argv[1]) return false;
	try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; }
}
if (isProcessEntryPoint()) main().catch((error) => { console.error('[solana-memo-media-mcp] fatal:', error); process.exit(1); });
