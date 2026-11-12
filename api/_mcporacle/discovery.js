// 401/402 challenge metadata for the hosted Oracle MCP endpoint. The read tools
// are free and answer without credentials; this block is what an unauthenticated
// call to an account-scoped tool (arming an agent) sees, so the challenge names
// the Oracle server rather than inheriting the main /api/mcp envelope.

import { buildBazaarSchema } from '../_lib/x402-spec.js';
import { withService } from '../_lib/x402/bazaar-helpers.js';
import { TOOL_CATALOG } from './catalog.js';

export const RESOURCE_DESCRIPTION =
	'three.ws Oracle MCP: Streamable HTTP (MCP 2025-06-18) for the Oracle conviction signal on pump.fun launches. ' +
	'Free read tools need no account: oracle_top_plays, oracle_coin, oracle_feed, oracle_search, oracle_movers, ' +
	'oracle_wins, oracle_backtest, oracle_calibration, oracle_leaderboard, oracle_wallet, oracle_stats. ' +
	'oracle_arm_watch and oracle_watch_status need a three.ws account (OAuth) and arm an agent to act on the live stream ' +
	'inside a spend limit. Live mainnet arming additionally requires the signed real-funds agreements. Operated by three.ws.';

// Endpoint-level v2 bazaar discovery entry (shape: api/_lib/x402-spec.js
// bazaarExtension). Without it build402Body falls back to the main /api/mcp
// example, a validate_model call on a GLB, and indexers list this endpoint as
// a 3D validation server. The sample is oracle_stats: free, argument-free, and
// what a new caller should read first to judge the signal.
function oracleBazaarExtension() {
	const exampleBody = {
		jsonrpc: '2.0',
		id: 1,
		method: 'tools/call',
		params: { name: 'oracle_stats', arguments: {} },
	};
	const exampleStats = {
		network: 'mainnet',
		scored_24h: 10824,
		scored_total: 1781249,
		prime_count: 630,
		strong_count: 1652,
		agents_armed: 9,
	};
	const exampleResponse = {
		jsonrpc: '2.0',
		id: 1,
		result: {
			content: [{ type: 'text', text: JSON.stringify(exampleStats) }],
			structuredContent: exampleStats,
		},
	};
	const toolNames = TOOL_CATALOG.map((t) => t.name).join(', ');
	const requestBodySchema = {
		$schema: 'https://json-schema.org/draft/2020-12/schema',
		type: 'object',
		required: ['jsonrpc', 'method'],
		properties: {
			jsonrpc: { type: 'string', const: '2.0' },
			id: { type: ['string', 'number'] },
			method: {
				type: 'string',
				enum: ['initialize', 'tools/list', 'tools/call', 'ping'],
				description: 'MCP JSON-RPC method.',
			},
			params: {
				type: 'object',
				description: `For tools/call: { name, arguments }. Tool names: ${toolNames}. See tools/list.`,
			},
		},
	};
	const responseBodySchema = {
		$schema: 'https://json-schema.org/draft/2020-12/schema',
		type: 'object',
		properties: {
			jsonrpc: { type: 'string', const: '2.0' },
			id: { type: ['string', 'number'] },
			result: {
				type: 'object',
				properties: {
					content: {
						type: 'array',
						items: {
							type: 'object',
							required: ['type', 'text'],
							properties: {
								type: { type: 'string', enum: ['text'] },
								text: { type: 'string' },
							},
						},
					},
					structuredContent: { type: 'object' },
				},
			},
			error: {
				type: 'object',
				properties: { code: { type: 'number' }, message: { type: 'string' } },
			},
		},
	};
	return {
		discoverable: true,
		info: {
			input: { type: 'http', method: 'POST', body: exampleBody, bodyType: 'json' },
			output: { type: 'json', example: exampleResponse },
		},
		schema: buildBazaarSchema({
			method: 'POST',
			bodyType: 'json',
			bodySchema: requestBodySchema,
			outputSchema: responseBodySchema,
		}),
	};
}

export const ORACLE_CHALLENGE = {
	description: RESOURCE_DESCRIPTION,
	bazaar: oracleBazaarExtension(),
	...withService({
		serviceName: 'three.ws Oracle MCP',
		tags: ['oracle', 'mcp', 'solana', 'pump.fun', 'signals'],
	}),
};
