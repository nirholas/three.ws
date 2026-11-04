#!/usr/bin/env node
// @three-ws/autopilot-mcp — MCP server entry point.
//
// An AI agent's own autonomous-execution control plane over the Model Context
// Protocol. It lets the agent manage its OWN guardrails and act within them —
// no human in the loop, but every boundary enforced server-side:
//   • get_autopilot_config / set_autopilot_config — scopes, daily SOL spend
//     cap, auto-execute flags, confirmation policy
//   • generate_proposals — turn high-salience memories into real candidate actions
//   • list_proposals / dryrun_proposal / adjust_proposal — review the queue
//   • execute_proposal — take the real action (⚠️ can move real SOL; irreversible)
//   • undo_action / dismiss_proposal — close the trust loop
//   • list_autopilot_activity — the signed receipts log
//   • compute_trust — the agent's earned reputation
//
// AUTHENTICATED + WRITE-HEAVY. Every route is owner-only; the agent's three.ws
// API key (or OAuth access token) is supplied via THREE_WS_API_KEY and carried as
// a Bearer credential. Scope/spend/confirmation enforcement lives server-side —
// this server never bypasses it. The agent spends SOL and only ever buys, holds,
// or burns $THREE — it never sells or sends it.
//
// Run standalone:
//   THREE_WS_API_KEY=sk_live_… node packages/autopilot-mcp/src/index.js
//
// Or wire into Claude Code / Cursor — see README.md.

import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { def as getConfig } from './tools/get-config.js';
import { def as setConfig } from './tools/set-config.js';
import { def as generateProposals } from './tools/generate-proposals.js';
import { def as listProposals } from './tools/list-proposals.js';
import { def as dryrunProposal } from './tools/dryrun-proposal.js';
import { def as adjustProposal } from './tools/adjust-proposal.js';
import { def as executeProposal } from './tools/execute-proposal.js';
import { def as dismissProposal } from './tools/dismiss-proposal.js';
import { def as undoAction } from './tools/undo-action.js';
import { def as listActivity } from './tools/list-activity.js';
import { def as computeTrust } from './tools/compute-trust.js';

// Single source of truth for the advertised server version — package.json.
const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require('../package.json');

export const TOOLS = [
	// Config / guardrails
	getConfig,
	setConfig,
	// Propose → review
	generateProposals,
	listProposals,
	dryrunProposal,
	adjustProposal,
	// Act → close the loop
	executeProposal,
	dismissProposal,
	undoAction,
	// Audit / reputation
	listActivity,
	computeTrust,
];

/**
 * Construct a fully-registered McpServer without connecting a transport.
 * Registration is env-free (no key needed to advertise the tool surface), so this
 * is safe to import from tests. A credential is required only when a tool runs.
 * @returns {McpServer}
 */
export function buildServer() {
	const server = new McpServer(
		{ name: 'autopilot-mcp', title: 'three.ws Autopilot', version: PKG_VERSION },
		{
			capabilities: { tools: {} },
			instructions:
				"three.ws Autopilot MCP — an agent's own execution control plane. The agent manages its OWN " +
				'autonomy boundaries and acts within them, bounded by real, server-enforced scopes and spend ' +
				'caps. Flow: get_autopilot_config to read scopes + daily SOL cap + trust; set_autopilot_config ' +
				'to grant capabilities (create_alert, briefing, wallet_transfer, trade), set auto-execute, and the daily ' +
				'spend ceiling; generate_proposals to turn high-salience memories into real, provenance-cited ' +
				'candidate actions; list_proposals to read the queue; dryrun_proposal to preview a proposal ' +
				'(scope/cap/balance checks) without acting; adjust_proposal to tune a pending one; execute_proposal ' +
				'to take the real action — ⚠️ a wallet_transfer moves REAL SOL on Solana mainnet, is ' +
				'IRREVERSIBLE, requires confirm:true, and is capped by the daily budget; undo_action reverses a ' +
				'reversible execution; dismiss_proposal drops one (both record feedback memories so the agent ' +
				'learns the boundary); list_autopilot_activity is the append-only signed receipts log; ' +
				'compute_trust is the agent\'s earned reputation. Every scope, confirmation, and spend cap is ' +
				'enforced server-side — these tools cannot bypass it. Requires THREE_WS_API_KEY (a three.ws API ' +
				'key or OAuth access token for the agent owner). The agent spends SOL and only ever buys, ' +
				'holds, or burns $THREE — it never sells or sends it.',
		},
	);

	for (const tool of TOOLS) {
		server.registerTool(
			tool.name,
			{
				title: tool.title,
				description: tool.description,
				inputSchema: tool.inputSchema,
				// MCP ToolAnnotations (readOnlyHint / destructiveHint / idempotentHint /
				// openWorldHint) — lets clients gate confirmation prompts per tool
				// instead of treating every call as a destructive write.
				annotations: tool.annotations,
			},
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
					return {
						content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
						isError: true,
					};
				}
			},
		);
	}

	return server;
}

async function main() {
	const server = buildServer();
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error(`[autopilot-mcp@${PKG_VERSION}] connected over stdio with ${TOOLS.length} tools`);
}

// Connect stdio ONLY when this file is the process entry point. Importing the
// module (tests, embedding) must not grab the transport. realpath both sides:
// npm bin shims are symlinks, so argv[1] may differ from import.meta.url.
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
		console.error('[autopilot-mcp] fatal:', err);
		process.exit(1);
	});
}
