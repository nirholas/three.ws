#!/usr/bin/env node
// @three-ws/hq-mcp: MCP server exposing three.ws HQ's DeFi data tools over stdio.
// Read-only. Set HQ_BASE to the HQ deployment origin that serves /api/agent-tools.

import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { TOOLS } from './tools.js';

const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require('../package.json');

export { TOOLS };

export function buildServer() {
	const server = new McpServer(
		{ name: 'hq-mcp', title: 'three.ws HQ', version: PKG_VERSION },
		{
			capabilities: { tools: {} },
			instructions:
				'three.ws HQ DeFi tools. hq_top_yields, hq_chain_tvl, hq_protocol_health, hq_funding_rates, ' +
				'hq_liquidations, hq_venue_spread, hq_whale_activity and hq_gas read live market data. ' +
				'analyze_portfolio_risk scores a public wallet address (Solana first, EVM supported) or positions you supply. hq_ask answers a plain-language question. ' +
				'Every tool is read-only: nothing here signs, sends or trades. Requires HQ_BASE.',
		},
	);
	for (const tool of TOOLS) {
		server.registerTool(
			tool.name,
			{ title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
			async (args) => {
				try {
					const result = await tool.handler(args);
					return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
				} catch (err) {
					const payload = { ok: false, error: err?.code || 'unhandled', message: err?.message || String(err), ...(err?.status ? { status: err.status } : {}) };
					return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: true };
				}
			},
		);
	}
	return server;
}

async function main() {
	await buildServer().connect(new StdioServerTransport());
	console.error(`[hq-mcp@${PKG_VERSION}] connected over stdio with ${TOOLS.length} tools`);
}

function isProcessEntryPoint() {
	if (!process.argv[1]) return false;
	try {
		return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
	} catch {
		return false;
	}
}

if (isProcessEntryPoint()) {
	main().catch((err) => {
		console.error('[hq-mcp] fatal:', err);
		process.exit(1);
	});
}
