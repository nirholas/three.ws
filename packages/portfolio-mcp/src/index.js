#!/usr/bin/env node
// @three-ws/portfolio-mcp — MCP server entry point.
//
// Gives an AI agent programmatic access to its OWN trading state over stdio:
//   • get_portfolio_summary  — live holdings + USD value across the agents you own
//   • get_portfolio_history  — your portfolio value over time (snapshots)
//   • get_portfolio_asset    — one token: holdings + live market data + price chart
//   • get_trades_feed        — the public closed-trade feed (realized PnL)
//   • get_wallet_balances    — live on-chain SOL + SPL balances for any wallet
//   • send_transfer          — sign + broadcast a real SOL/SPL transfer (WRITE)
//
// Reads hit the live three.ws API (THREE_WS_BASE) and Solana RPC (SOLANA_RPC_URL).
// The account-scoped reads use your three.ws session (THREE_WS_SESSION). The one
// write, send_transfer, signs locally with SOLANA_SECRET_KEY and moves real funds.
//
// Run standalone:
//   node packages/portfolio-mcp/src/index.js
//
// Or wire into Claude Code / Cursor — see README.md.

import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { def as getPortfolioSummary } from './tools/portfolio-summary.js';
import { def as getPortfolioHistory } from './tools/portfolio-history.js';
import { def as getPortfolioAsset } from './tools/portfolio-asset.js';
import { def as getTradesFeed } from './tools/trades-feed.js';
import { def as getWalletBalances } from './tools/wallet-balances.js';
import { def as previewTransfer } from './tools/preview-transfer.js';
import { def as sendTransfer } from './tools/send-transfer.js';

// Single source of truth for the advertised server version — package.json.
const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require('../package.json');

export const TOOLS = [
	getPortfolioSummary,
	getPortfolioHistory,
	getPortfolioAsset,
	getTradesFeed,
	getWalletBalances,
	previewTransfer,
	sendTransfer,
];

/**
 * Construct a fully-registered McpServer without connecting a transport.
 * Registration is env-free, so this is safe to import from tests.
 * @returns {McpServer}
 */
export function buildServer() {
	const server = new McpServer(
		{ name: 'portfolio-mcp', title: 'three.ws Portfolio', version: PKG_VERSION },
		{
			capabilities: { tools: {} },
			instructions:
				'three.ws Portfolio MCP — an agent’s own trading state. get_portfolio_summary gives live holdings ' +
				'and USD value across the agent wallets you own; get_portfolio_history charts that value over time; ' +
				'get_portfolio_asset deep-dives one token with your holdings plus live market data and a price ' +
				'chart. get_trades_feed is the public feed of closed positions and their REALIZED PnL across all ' +
				'agents. get_wallet_balances reads live on-chain SOL + SPL balances for any Solana address straight ' +
				'from the RPC. send_transfer is the ONLY write: it signs locally and broadcasts a real, irreversible ' +
				'Solana transfer of SOL or any SPL token — it requires confirm:true and is bounded by MAX_SOL_PER_TX ' +
				'and an optional recipient allowlist. The account-scoped reads need THREE_WS_SESSION; the trade feed ' +
				'and on-chain balance reads are public; send_transfer needs SOLANA_SECRET_KEY (or a per-call secret).',
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
	console.error(`[portfolio-mcp@${PKG_VERSION}] connected over stdio with ${TOOLS.length} tools`);
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
		console.error('[portfolio-mcp] fatal:', err);
		process.exit(1);
	});
}
