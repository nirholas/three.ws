// api/_mcpagent/catalog.js — the wire contract + argument validators behind the
// agent-wallet MCP server (/api/mcp-agent). The catalog module is what turns a
// tool definition into (a) the tools/list payload external agents integrate
// against and (b) the compiled Ajv validator every tools/call argument set has
// to pass before a handler can touch a wallet. Both are asserted here directly;
// handler behaviour lives in mcp-agent.test.js.

import { describe, it, expect } from 'vitest';

import { TOOL_CATALOG, TOOLS } from '../../api/_mcpagent/catalog.js';

describe('agent-wallet MCP catalog', () => {
	it('leads with the free getting_started tool, then the wallet, marketplace, prediction, perps and Papertrade toolsets', () => {
		expect(TOOL_CATALOG.map((t) => t.name)).toEqual([
			'getting_started',
			// Wallet and x402 (api/_mcpagent/tools.js)
			'wallet_status',
			'find_services',
			'pay_quote',
			'pay_and_call',
			'provision_wallet',
			'monetize_endpoint',
			'read_resource',
			'get_linked_accounts',
			'set_external_wallet',
			// Agent marketplace (api/_mcpagent/marketplace-tools.js)
			'browse_marketplace',
			'browse_public_agents',
			'get_listing',
			'get_marketplace_history',
			'preview_marketplace_action',
			'create_marketplace_listing',
			'delist_marketplace_listing',
			'place_bid',
			'buy_now',
			'get_my_bids',
			'get_received_bids',
			'accept_marketplace_bid',
			'reject_marketplace_bid',
			'withdraw_marketplace_bid',
			'get_agent_transfer',
			'resume_agent_transfer',
			// Prediction markets (api/_mcpagent/predictions-tools.js)
			'predictions_events',
			'predictions_event',
			'predictions_positions',
			'predictions_open_preview',
			'predictions_open',
			'predictions_close_preview',
			'predictions_close',
			'predictions_redeem_preview',
			'predictions_redeem',
			'predictions_watch',
			// Perpetual futures (api/_mcpagent/perps-tools.js)
			'perps_markets',
			'perps_market_data',
			'perps_account',
			'perps_positions',
			'perps_order_preview',
			'perps_action_preview',
			'perps_order_execute',
			'perps_collateral_deposit',
			'perps_collateral_withdraw',
			'perps_order_cancel',
			'perps_flatten',
			'perps_limits',
			// Papertrade synthetic perps on HyperEVM (api/_mcpagent/papertrade-tools.js)
			'papertrade_markets',
			'papertrade_quote',
			'papertrade_account',
			'papertrade_protocol',
			// Solana trading (api/_mcpagent/trading-tools.js over api/_lib/trading-tools/registry.js)
			'token_search',
			'get_price',
			'get_indicators',
			'get_market_signals',
			'get_news_feed',
			'arbitrage_prices',
			'arbitrage_quote',
			'swap_quote',
			'swap_simulate',
			'swap_execute',
			// Portfolio reads (api/_mcpagent/portfolio-tools.js)
			'get_portfolio',
			'get_balance_history',
			'get_pnl',
			// Launch sniper, signal subscriptions and alert rules (api/_mcpagent/sniper-alert-tools.js)
			'sniper_status',
			'sniper_activate_preview',
			'sniper_activate',
			'sniper_deactivate',
			'sniper_subscribe',
			'alert_rule_create',
			'alert_rule_list',
			'alert_rule_delete',
			// Agent duels (api/_mcpagent/duels-tools.js)
			'duel_challenge',
			'duel_accept',
			'duel_details',
			'duel_markets',
			// Agent commerce (api/_mcpagent/commerce-tools.js)
			'invoice_create',
			'invoice_details',
			'invoice_list',
			'invoice_verify',
			'invoice_cancel',
			'agent_send_preview',
			'agent_send',
			'offer_list',
			'agent_sell',
			'agent_buy',
			'agent_buy_confirm',
			'spending_check',
			'spending_setup',
			// Resting orders and DCA (api/_mcpagent/orders-tools.js)
			'order_preview',
			'limit_order_create',
			'stop_order_create',
			'trailing_order_create',
			'ladder_order_create',
			'oco_order_create',
			'limit_order_list',
			'limit_order_cancel',
			'limit_order_history',
			'order_book',
			'dca_preview',
			'dca_create',
			'dca_list',
			'dca_cancel',
		]);
	});

	it('quotes with the same arguments pay_and_call spends with', () => {
		const quote = { resource_url: 'https://a.test/x', method: 'POST', body: { q: 1 }, max_usd: 0.05 };
		expect(TOOLS.pay_quote.validate({ ...quote })).toBe(true);
		expect(TOOLS.pay_and_call.validate({ ...quote })).toBe(true);
		expect(TOOLS.pay_quote.validate({ resource_url: 'not a url' })).toBe(false);
		expect(TOOLS.pay_quote.validate({})).toBe(false);
	});

	it('gives every catalog entry a handler in the dispatch map', () => {
		for (const tool of TOOL_CATALOG) {
			expect(typeof TOOLS[tool.name]?.handler).toBe('function');
		}
		// And nothing extra: the dispatch map and the wire catalog are one list.
		expect(Object.keys(TOOLS).sort()).toEqual(TOOL_CATALOG.map((t) => t.name).sort());
	});

	it('compiles a validator for each tool that declares an input schema', () => {
		for (const tool of TOOL_CATALOG) {
			if (!tool.inputSchema) continue;
			expect(typeof TOOLS[tool.name].validate).toBe('function');
		}
	});

	// ── validators: the accept path ──────────────────────────────────────────
	it('fills schema defaults into the arguments the handler will read', () => {
		const args = { query: 'weather' };
		expect(TOOLS.find_services.validate(args)).toBe(true);
		// Ajv runs with useDefaults, so the handler sees the declared defaults
		// instead of having to re-derive them.
		expect(args).toMatchObject({ query: 'weather', type: 'http', limit: 15 });

		const monetize = {
			agent_id: '11111111-1111-1111-1111-111111111111',
			name: 'Weather API',
			description: 'Live weather',
			price_usdc: 0.01,
			target_url: 'https://api.example.com/weather',
		};
		expect(TOOLS.monetize_endpoint.validate(monetize)).toBe(true);
		// Base is the default payout rail; a solana default here would have sent
		// every default-network call down the wrong payout path.
		expect(monetize).toMatchObject({ method: 'POST', network: 'base' });
	});

	// ── validators: the reject path ──────────────────────────────────────────
	it('rejects arguments that would otherwise reach a wallet', () => {
		// Unknown property: additionalProperties is closed on every tool.
		expect(TOOLS.pay_and_call.validate({ resource_url: 'https://a.test/x', evil: 1 })).toBe(
			false,
		);
		// Missing the one required argument.
		expect(TOOLS.pay_and_call.validate({})).toBe(false);
		// Not a URI.
		expect(TOOLS.pay_and_call.validate({ resource_url: 'not a url' })).toBe(false);
		// Not a uuid: provision_wallet would otherwise query agent_identities with junk.
		expect(TOOLS.provision_wallet.validate({ agent_id: 'nope' })).toBe(false);
		// A price the atomic conversion cannot express in integer notation.
		expect(TOOLS.find_services.validate({ query: 'x', max_price_usdc: 1e21 })).toBe(false);
		// A free service is not a service: price must be above zero.
		expect(
			TOOLS.monetize_endpoint.validate({
				agent_id: '11111111-1111-1111-1111-111111111111',
				name: 'Svc',
				description: 'desc',
				price_usdc: 0,
				target_url: 'https://api.example.com/x',
			}),
		).toBe(false);
	});

	it('reports why an argument set failed so the dispatcher can quote it', () => {
		TOOLS.pay_and_call.validate({ resource_url: 123 });
		expect(TOOLS.pay_and_call.validate.errors?.[0]).toMatchObject({
			instancePath: '/resource_url',
		});
	});
});
