// Bazaar discovery + service metadata for the hosted Agent-wallet MCP endpoint.
//
// The 402 challenge an unauthenticated/unpaid caller receives carries this
// metadata so x402 facilitators (CDP Bazaar, agentic.market, x402scan) index
// /api/mcp-agent with its own service name, tags, icon, and a v2 `bazaar`
// extension describing the JSON-RPC tools/call shape. Without it the endpoint
// inherited the main /api/mcp envelope: it advertised itself as the avatar and
// model-validation server AND, worse, quoted `resource: .../api/mcp` inside
// every accepts[] entry, so a paying agent signed a payment scoped to a
// resource it never called. Mirrors api/_mcpbazaar/discovery.js and
// api/_mcp3d/discovery.js.

import { buildBazaarSchema } from '../_lib/x402-spec.js';
import { withService } from '../_lib/x402/bazaar-helpers.js';

export const RESOURCE_DESCRIPTION =
	'three.ws Agent MCP: Streamable HTTP (MCP 2025-06-18) that gives an assistant a real on-chain ' +
	'wallet on the x402 network: wallet_status (address, USDC and SOL balance, spend caps), ' +
	'find_services (search the live facilitator network for paid services), pay_quote (price a paid ' +
	'endpoint without paying), pay_and_call (call a paid x402 endpoint and settle the USDC payment ' +
	'from the signed-in user own three.ws agent wallet, bounded by their caps), provision_wallet, ' +
	'monetize_endpoint (list your own paid service) and read_resource (live three:// resources). ' +
	'An agent marketplace with USDC escrow on Solana: browse_marketplace, browse_public_agents, ' +
	'get_listing, get_marketplace_history, preview_marketplace_action, create_marketplace_listing, ' +
	'delist_marketplace_listing, place_bid, buy_now, get_my_bids, get_received_bids, ' +
	'accept_marketplace_bid, reject_marketplace_bid, withdraw_marketplace_bid, get_agent_transfer and ' +
	'resume_agent_transfer. Prediction markets settled in USDC on Solana: predictions_events, ' +
	'predictions_event, predictions_positions, predictions_open_preview, predictions_open, ' +
	'predictions_close_preview, predictions_close, predictions_redeem_preview, predictions_redeem and ' +
	'predictions_watch. Every money-moving tool needs its preview first and an explicit confirm flag. ' +
	'Connect with a three.ws account (OAuth) or pay per call in USDC on Base or Solana mainnet, no ' +
	'API key. Operated by three.ws.';

// Endpoint-level v2 bazaar discovery entry, shaped exactly like the validator
// expects (see api/_lib/x402-spec.js, bazaarExtension). The advertised example
// is find_services: a read-only search, so a facilitator probing the documented
// call can never move a caller's funds.
function agentBazaarExtension() {
	const exampleBody = {
		jsonrpc: '2.0',
		id: 1,
		method: 'tools/call',
		params: {
			name: 'find_services',
			arguments: { query: 'weather', type: 'http', limit: 5 },
		},
	};
	const exampleResponse = {
		jsonrpc: '2.0',
		id: 1,
		result: {
			content: [
				{
					type: 'text',
					text: '1. Weather Now - $0.001\n   https://api.example.com/weather',
				},
			],
			structuredContent: {
				query: 'weather',
				count: 1,
				services: [
					{
						resource: 'https://api.example.com/weather',
						name: 'Weather Now',
						price: '$0.001',
						networks: ['eip155:8453'],
					},
				],
			},
		},
	};
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
				description:
					'For tools/call: { name, arguments }. Tool names: getting_started (free), wallet_status, find_services, pay_quote, pay_and_call, provision_wallet, monetize_endpoint, read_resource, plus the marketplace and prediction-market tools, see tools/list.',
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

// The challenge override block threaded into authenticateRequest/handleSse so
// the 402 envelope advertises Agent-wallet service metadata + discovery.
export const AGENT_CHALLENGE = {
	description: RESOURCE_DESCRIPTION,
	bazaar: agentBazaarExtension(),
	...withService({
		serviceName: 'three.ws Agent MCP',
		tags: ['x402', 'mcp', 'wallet', 'payments', 'agent'],
	}),
};
