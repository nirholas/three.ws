#!/usr/bin/env node
// @three-ws/x402-mcp — MCP server entry point.
//
// Gives any AI assistant a self-custodial x402 wallet over stdio:
//   • x402_wallet     — the wallet's address + SOL/USDC balance (read-only)
//   • find_services   — search the live x402 bazaar for paid services (read-only)
//   • inspect_endpoint— read an endpoint's price/requirements without paying (read-only)
//   • pay_and_call    — pay an x402 endpoint in USDC and return its result (execution)
//   • spending_report: this wallet's local spend ledger, totaled by merchant/day (read-only)
//   • one named tool per entry in tools.json (weather_forecast, domain_rdap_check, book_read, ...),
//     each a fixed-endpoint, fixed-price wrapper around pay_and_call (execution)
//
// Self-custodial: payments are signed by YOUR Solana key (SOLANA_SECRET_KEY),
// not a custodial wallet. The read tools work with no key. Real @x402/* libs do
// the 402 dance + Solana `exact` settlement — nothing is mocked.
//
// Run standalone:
//   SOLANA_SECRET_KEY=<base58> node packages/x402-mcp/src/index.js
//
// Or wire into Claude Code / Cursor — see README.md.

import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { def as x402Wallet } from './tools/x402-wallet.js';
import { def as findServices } from './tools/find-services.js';
import { def as inspectEndpoint } from './tools/inspect-endpoint.js';
import { def as payAndCall } from './tools/pay-and-call.js';
import { def as spendingReport } from './tools/spending-report.js';
import { NAMED_SERVICE_TOOLS } from './tools/named-services.js';

const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require('../package.json');

export const TOOLS = [x402Wallet, findServices, inspectEndpoint, payAndCall, spendingReport, ...NAMED_SERVICE_TOOLS];

/**
 * Construct a fully-registered McpServer without connecting a transport or
 * requiring a signer. Registration is env-free; only pay_and_call (and
 * x402_wallet defaulting to the signer) needs SOLANA_SECRET_KEY. Safe to import
 * from tests.
 * @returns {McpServer}
 */
export function buildServer() {
	const server = new McpServer(
		{ name: 'x402-mcp', title: 'x402 Wallet', version: PKG_VERSION },
		{
			capabilities: { tools: {} },
			instructions:
				'x402 buyer MCP — give the agent a self-custodial wallet that can pay for anything on the x402 ' +
				'network. find_services searches the live bazaar (PayAI + Coinbase CDP). inspect_endpoint reads ' +
				"any endpoint's price/requirements WITHOUT paying. x402_wallet shows the signer wallet's address " +
				'and SOL/USDC balance. pay_and_call is an EXECUTION ACTION: it pays an x402 endpoint in USDC from ' +
				'your Solana key (SOLANA_SECRET_KEY or a per-call `secret`) and returns the result, bounded by ' +
				'MAX_PAY_USD and gated by REQUIRE_CONFIRM. Prefer a named tool (weather_forecast, domain_rdap_check, ' +
				'book_read, and the rest listed in tools.json) over pay_and_call when one covers the endpoint: it ' +
				"carries a fixed description and price ceiling. Settlement is the Solana `exact` scheme via the real " +
				"@x402 libraries, never a wallet you do not control. spending_report reads this wallet's local " +
				'ledger back, totaled by merchant and day.',
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
	console.error(`[x402-mcp@${PKG_VERSION}] connected over stdio with ${TOOLS.length} tools`);
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
		console.error('[x402-mcp] fatal:', err);
		process.exit(1);
	});
}
