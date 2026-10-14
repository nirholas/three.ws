#!/usr/bin/env node
// @three-ws/intel-mcp — MCP server entry point.
//
// Gives any AI assistant the three.ws market-intelligence surface over stdio:
//   • smart_money_coin   — judge a coin by WHO is net-buying it (0–100 score)
//   • wallet_intel       — one wallet's realized reputation card
//   • wallet_linkage     : are these 2-10 wallets the same person (0-100 score)
//   • signal_feed        — a feed's proven accuracy + recent emissions
//   • kol_leaderboard    — ranked KOL traders by realized P&L
//   • kol_trades         — recent KOL trades on a given mint
//   • copy_smart_wallets — the ranked copy-trade Smart Money directory
//
// A thin wrapper over the PUBLIC three.ws API. No keys, no signer, no payment —
// point THREE_WS_BASE at a deployment and go.
//
// Run standalone:
//   node packages/intel-mcp/src/index.js
//
// Or wire into Claude Code / Cursor — see README.md.

import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { def as smartMoneyCoin } from './tools/smart-money-coin.js';
import { def as walletIntel } from './tools/wallet-intel.js';
import { def as walletLinkage } from './tools/wallet-linkage.js';
import { def as signalFeed } from './tools/signal-feed.js';
import { def as kolLeaderboard } from './tools/kol-leaderboard.js';
import { def as kolTrades } from './tools/kol-trades.js';
import { def as copySmartWallets } from './tools/copy-smart-wallets.js';

// Single source of truth for the advertised server version — package.json.
const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require('../package.json');

export const TOOLS = [
	smartMoneyCoin,
	walletIntel,
	walletLinkage,
	signalFeed,
	kolLeaderboard,
	kolTrades,
	copySmartWallets,
];

/**
 * Construct a fully-registered McpServer without connecting a transport.
 * Registration is env-free, so this is safe to import from tests.
 * @returns {McpServer}
 */
export function buildServer() {
	const server = new McpServer(
		{ name: 'intel-mcp', title: 'three.ws Intel', version: PKG_VERSION },
		{
			capabilities: { tools: {} },
			instructions:
				'three.ws Intel MCP — read the market the way the smart money does. smart_money_coin ' +
				'scores a coin by WHO is net-buying it (a 0–100 reputation-weighted score, funder clusters, ' +
				'and a sybil flag). wallet_intel pulls one wallet\'s realized track record (score, win rate, ' +
				'labels, funder cluster). wallet_linkage cross-checks 2-10 wallets for shared control (shared ' +
				'fee payer, first funder, token-account ownership, direct transfers, funding bursts), each ' +
				'pair scored 0-100 with evidence. signal_feed reads a feed\'s proven accuracy and recent emissions ' +
				'with realized ROI. kol_leaderboard ranks tracked KOL traders by P&L; kol_trades shows their ' +
				'recent trades on a given mint. copy_smart_wallets browses the ranked copy-trade Smart Money ' +
				'directory. All data comes live from the public three.ws API — no API key, signer, or payment ' +
				'required. Every tool is read-only.',
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
	console.error(`[intel-mcp@${PKG_VERSION}] connected over stdio with ${TOOLS.length} tools`);
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
		console.error('[intel-mcp] fatal:', err);
		process.exit(1);
	});
}
