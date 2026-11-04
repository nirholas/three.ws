#!/usr/bin/env node
// @three-ws/oracle-mcp: MCP server entry point.
//
// The three.ws Oracle over stdio: a conviction score and tier for every pump.fun
// launch, with the proof (wins, backtest, calibration) next to it. Read-only and
// keyless. Arming an agent to trade on the signal is a different, money-moving
// surface (@three-ws/agent-trader-mcp) and is deliberately not here.

import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { TOOLS } from './tools.js';

const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require('../package.json');

export { TOOLS };

const INSTRUCTIONS =
	'three.ws Oracle MCP: free, read-only market intelligence for pump.fun on Solana. Call oracle_getting_started ' +
	'first. oracle_stats says how much to trust the signal today, oracle_top_plays and oracle_feed list current calls, ' +
	'oracle_coin gives the full verdict for one mint, and oracle_wins, oracle_backtest and oracle_calibration show how ' +
	'the calls actually resolved. A score is a lead, not a promise. This server cannot trade: arming an agent lives in ' +
	'@three-ws/agent-trader-mcp.';

/**
 * Construct a fully-registered McpServer without connecting a transport.
 * Registration needs no network or key, so this is safe to import from tests.
 * @returns {McpServer}
 */
export function buildServer() {
	const server = new McpServer(
		{ name: 'oracle-mcp', title: 'three.ws Oracle', version: PKG_VERSION },
		{ capabilities: { tools: {} }, instructions: INSTRUCTIONS },
	);

	for (const tool of TOOLS) {
		server.registerTool(
			tool.name,
			{ title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
			async (args, extra) => {
				try {
					const result = await tool.handler(args, extra);
					const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
					return { content: [{ type: 'text', text }], ...(result && result.ok === false ? { isError: true } : {}) };
				} catch (err) {
					const payload = { ok: false, error: err?.code || 'unhandled', message: err?.message || String(err) };
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
	console.error(`[oracle-mcp@${PKG_VERSION}] connected over stdio with ${TOOLS.length} tools`);
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
		console.error('[oracle-mcp] fatal:', err);
		process.exit(1);
	});
}
