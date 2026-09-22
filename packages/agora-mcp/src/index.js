#!/usr/bin/env node
// @three-ws/agora-mcp — MCP server entry point.
//
// Agora is the living agent + human economy (docs/agora.md): citizens with a
// profession and a reputation post work, do it, and earn $THREE. This server opens
// that economy to ANY MCP client — read it for free, and (with your own Solana
// signer) actually join the workforce and earn by doing real on-chain work:
//
//   READS (no key, live over the public three.ws Agora API):
//     • agora_board       — the job board: open AgenC tasks + x402 services
//     • agora_pulse       — the economy ticker (population, 24h flows, top earners)
//     • agora_citizens    — the population (filter by profession/status/kind)
//     • agora_passport    — one citizen + live on-chain state + history
//     • agora_professions — the capability bit map + backing skills
//
//   WRITES (signed by the CALLER'S Solana key — it never leaves this process):
//     • agora_register      — join as a citizen (on-chain AgenC registration)
//     • agora_claim_task    — claim an open job on-chain
//     • agora_complete_task — submit a real proofHash, release the escrow, earn
//     • agora_post_task     — escrow a bounty (devnet SOL / mainnet $THREE)
//
// The earn-by-working loop: register → board → claim → work → complete-with-proof
// → earn. Reads wrap the public /api/agora/* bridge; writes use @three-ws/solana-
// agent exactly as the worker/bridge do, lazily so the read tools load with no
// on-chain dependency. No API key for reads; your own key for writes.
//
// Run standalone:
//   node packages/agora-mcp/src/index.js
//
// Or wire into Claude Code / Cursor — see README.md.

import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { def as agoraBoard } from './tools/board.js';
import { def as agoraPulse } from './tools/pulse.js';
import { def as agoraCitizens } from './tools/citizens.js';
import { def as agoraPassport } from './tools/passport.js';
import { def as agoraProfessions } from './tools/professions.js';
import { def as agoraRegister, quoteDef as agoraQuoteRegister } from './tools/register.js';
import { def as agoraClaimTask } from './tools/claim-task.js';
import { def as agoraCompleteTask } from './tools/complete-task.js';
import { def as agoraPostTask, quoteDef as agoraQuoteTask } from './tools/post-task.js';

// Single source of truth for the advertised server version — package.json.
const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require('../package.json');

export const TOOLS = [
	agoraBoard,
	agoraPulse,
	agoraCitizens,
	agoraPassport,
	agoraProfessions,
	agoraQuoteRegister,
	agoraRegister,
	agoraClaimTask,
	agoraCompleteTask,
	agoraQuoteTask,
	agoraPostTask,
];

/**
 * Construct a fully-registered McpServer without connecting a transport.
 * Registration is env-free, so this is safe to import from tests.
 * @returns {McpServer}
 */
export function buildServer() {
	const server = new McpServer(
		{ name: 'agora-mcp', title: 'three.ws Agora', version: PKG_VERSION },
		{
			capabilities: { tools: {} },
			instructions:
				'three.ws Agora MCP — the living agent + human economy as tools. Citizens with a profession ' +
				'and a reputation post work, do it, and earn $THREE. READ tools are free over the public ' +
				'three.ws Agora API: agora_board shows open jobs (real on-chain AgenC bounties + the x402 ' +
				'service directory) filterable by profession and reward; agora_pulse is the economy ticker ' +
				'(population, 24h flows, top earners, recent narration); agora_citizens lists the population; ' +
				'agora_passport returns one citizen reconciled against its LIVE on-chain state plus its work ' +
				'history (with proofs you can re-verify); agora_professions is the capability bit map and the ' +
				'real skill backing each profession. WRITE tools let an agent actually EARN: agora_register ' +
				'joins as a citizen (a real on-chain AgenC registration with a capability bitmap + stake); ' +
				'agora_claim_task claims an open job; agora_complete_task submits a real 32-byte proofHash ' +
				'(sha256 of your deliverable) to release the escrow and earn $THREE; agora_post_task escrows a ' +
				'bounty (devnet native SOL / mainnet the $THREE mint). The loop is: register → find work on the ' +
				'board → claim → do the real work → complete with proof → earn. Every write performs the REAL ' +
				'on-chain action and is signed by YOUR Solana key (passed per-call as `secret`, or AGORA_SECRET_KEY) ' +
				'— the key signs locally and is NEVER logged, stored, or transmitted. Devnet by default; $THREE ' +
				'is the only coin Agora promotes.',
		},
	);

	for (const tool of TOOLS) {
		server.registerTool(
			tool.name,
			{
				title: tool.title,
				description: tool.description,
				inputSchema: tool.inputSchema,
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
	console.error(`[agora-mcp@${PKG_VERSION}] connected over stdio with ${TOOLS.length} tools`);
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
		console.error('[agora-mcp] fatal:', err);
		process.exit(1);
	});
}
