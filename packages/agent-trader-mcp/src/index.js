#!/usr/bin/env node
// @three-ws/agent-trader-mcp: MCP server entry point. WARNING: can move real SOL.
//
// Arm an agent on Oracle calls, watch what it did, and stop it. Defaults to
// simulate; live spend is explicit, per call, and gated server-side.

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
	'WARNING: three.ws Agent Trader MCP can move real SOL. Call trader_getting_started first. agent_arm defaults to ' +
	'simulate mode, which spends nothing; live needs mode live plus confirm_live true and a signed real-funds ' +
	'agreement (risk_ack_required means sign first, nothing was armed). agent_disarm is the kill switch and needs only ' +
	'the agent id. Read agent_guardrails before arming, watch with agent_status, agent_actions and agent_positions, and ' +
	'judge with agent_performance. Every spend boundary is enforced by the server. Requires THREE_WS_API_KEY.';

/**
 * Construct a fully-registered McpServer without connecting a transport.
 * Registration needs no network or key (a key is checked when a tool runs), so this is safe to import from tests.
 * @returns {McpServer}
 */
export function buildServer() {
	const server = new McpServer(
		{ name: 'agent-trader-mcp', title: 'three.ws Agent Trader', version: PKG_VERSION },
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
	console.error(`[agent-trader-mcp@${PKG_VERSION}] connected over stdio with ${TOOLS.length} tools`);
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
		console.error('[agent-trader-mcp] fatal:', err);
		process.exit(1);
	});
}
