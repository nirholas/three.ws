#!/usr/bin/env node
// @three-ws/trading-mcp: MCP server entry point.
//
// Quote and fill real Solana swaps from a three.ws agent wallet, through the
// same guarded executor the wallet hub and Autopilot use:
//   - quote_trade    preview a buy or sell, guard verdicts included (read-only)
//   - list_positions the wallet's valued holdings (read-only)
//   - execute_trade  fill it (REAL FUNDS, irreversible, needs confirm:true)
//
// AUTHENTICATED. THREE_WS_API_KEY is carried as a Bearer credential. Caps,
// the kill switch and the real-funds agreement are enforced server-side. The
// agent never sells $THREE.
//
//   THREE_WS_API_KEY=sk_live_... node packages/trading-mcp/src/index.js

import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { def as quoteTrade } from './tools/quote-trade.js';
import { def as listPositions } from './tools/list-positions.js';
import { def as executeTrade } from './tools/execute-trade.js';

const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require('../package.json');

export const TOOLS = [quoteTrade, listPositions, executeTrade];

/** Build a fully-registered server without connecting a transport. Env-free. */
export function buildServer() {
	const server = new McpServer(
		{ name: 'trading-mcp', title: 'three.ws Trading', version: PKG_VERSION },
		{
			capabilities: { tools: {} },
			instructions:
				'three.ws Trading MCP: guarded Solana swaps from an agent wallet. Flow: list_positions to see ' +
				'holdings, quote_trade to price a buy (amountSol) or sell (amountTokens: "all" or a token amount; ' +
				'tokenAmountRaw for exact base units), show the owner the side, ' +
				'mint, size, minimum received and guard verdict, and only after an explicit yes call execute_trade ' +
				'with confirm:true and a stable idempotencyKey. execute_trade moves REAL funds on Solana mainnet and ' +
				'cannot be undone. Per-trade cap, daily budget, price-impact breaker, rug firewall and kill switch ' +
				'are enforced server-side. The credential needs the wallet:trade grant to fill. The agent never ' +
				'sells $THREE; it only accumulates and burns it. Requires THREE_WS_API_KEY.',
		},
	);

	for (const tool of TOOLS) {
		server.registerTool(
			tool.name,
			{ title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
			async (args, extra) => {
				try {
					const result = await tool.handler(args, extra);
					const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
					return { content: [{ type: 'text', text }] };
				} catch (err) {
					const payload = {
						ok: false,
						error: err?.code || 'unhandled',
						message: err?.message || String(err),
						...(err?.status ? { status: err.status } : {}),
						...(err?.body ? { detail: err.body } : {}),
					};
					return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: true };
				}
			},
		);
	}
	return server;
}

async function main() {
	const server = buildServer();
	await server.connect(new StdioServerTransport());
	console.error(`[trading-mcp@${PKG_VERSION}] connected over stdio with ${TOOLS.length} tools`);
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
		console.error('[trading-mcp] fatal:', err);
		process.exit(1);
	});
}
