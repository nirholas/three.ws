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
	'monetize_endpoint (list your own paid service), read_resource (live three:// resources), ' +
	'get_linked_accounts (sign-in methods, wallets and linked devices) and set_external_wallet ' +
	'(attach a Solana or EVM wallet proved by a signed message). ' +
	'An agent marketplace with USDC escrow on Solana: browse_marketplace, browse_public_agents, ' +
	'get_listing, get_marketplace_history, preview_marketplace_action, create_marketplace_listing, ' +
	'delist_marketplace_listing, place_bid, buy_now, get_my_bids, get_received_bids, ' +
	'accept_marketplace_bid, reject_marketplace_bid, withdraw_marketplace_bid, get_agent_transfer and ' +
	'resume_agent_transfer. Prediction markets settled in USDC on Solana: predictions_events, ' +
	'predictions_event, predictions_positions, predictions_open_preview, predictions_open, ' +
	'predictions_close_preview, predictions_close, predictions_redeem_preview, predictions_redeem and ' +
	'predictions_watch. Perpetual futures with USDC collateral on Solana, paper or live: perps_markets, ' +
	'perps_market_data, perps_account, perps_positions, perps_order_preview, perps_action_preview, ' +
	'perps_order_execute, perps_collateral_deposit, perps_collateral_withdraw, perps_order_cancel, ' +
	'perps_flatten and perps_limits. Synthetic perps on HyperEVM, paper money only: papertrade_markets, ' +
	'papertrade_quote, papertrade_account and papertrade_protocol. ' +
	'Resting orders and DCA on any SPL token: order_preview, limit_order_create, ' +
	'stop_order_create, trailing_order_create, ladder_order_create, oco_order_create, limit_order_list, ' +
	'limit_order_cancel, limit_order_history, order_book, dca_preview, dca_create, dca_list and dca_cancel. ' +
	'Solana trading: token_search, get_price, get_indicators, get_market_signals, get_news_feed, ' +
	'arbitrage_prices, arbitrage_quote, swap_quote (every aggregator compared on net output), swap_simulate ' +
	'and swap_execute. Portfolio reads: get_portfolio, get_balance_history and get_pnl. ' +
	'Launch sniper, signal subscriptions and alert rules: sniper_status, sniper_activate_preview, ' +
	'sniper_activate, sniper_deactivate, sniper_subscribe, alert_rule_create, alert_rule_list and ' +
	'alert_rule_delete. Agent duels settled in USDC: duel_challenge, duel_accept, duel_details and ' +
	'duel_markets. Agent-to-agent commerce: invoice_create, invoice_details, invoice_list, invoice_verify, ' +
	'invoice_cancel, agent_send_preview, agent_send, offer_list, agent_sell, agent_buy, agent_buy_confirm, ' +
	'spending_check and spending_setup. ' +
	'Free-to-play Event Markets, points only: event_markets_list, event_market, event_market_pick, ' +
	'event_market_analyze, event_market_forecasters and event_market_agent_pick. ' +
	'Named commerce tools that pay a fixed three.ws x402 service from your agent wallet, each with a ' +
	'_quote counterpart that prices it without paying: weather_forecast_quote and weather_forecast, ' +
	'weather_go_no_go_quote and weather_go_no_go, carbon_now_quote and carbon_now, ' +
	'carbon_best_window_quote and carbon_best_window, domain_rdap_check_quote and domain_rdap_check, ' +
	'domain_rdap_check_bulk_quote and domain_rdap_check_bulk, research_search_quote and research_search, ' +
	'research_paper_quote and research_paper, research_bibliography_quote and research_bibliography, ' +
	'book_search_quote and book_search, book_read_quote and book_read, news_wire_search_quote and ' +
	'news_wire_search, news_wire_poll_quote and news_wire_poll, transit_plan_quote and transit_plan, ' +
	'transit_delays_quote and transit_delays, places_search_quote and places_search, and ' +
	'places_detail_quote and places_detail. ' +
	'Every money-moving tool needs its preview first and an explicit confirm flag. ' +
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
