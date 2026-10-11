// JSON-RPC dispatch for the threews-agent MCP server: a thin binding of the
// shared payment-free dispatcher (api/_lib/mcp-dispatch.js) to this catalog.
// (The "payment-free" refers to MCP-tool pricing; pay_and_call moves the
// USER's funds to external services, which is orthogonal to tool billing.)
import { makeDispatcher, PROTOCOL_VERSION } from '../_lib/mcp-dispatch.js';
import { TOOL_CATALOG, TOOLS } from './catalog.js';

export { PROTOCOL_VERSION };
export { isPublicTool } from '../_lib/mcp-getting-started.js';

const INSTRUCTIONS = [
	'three.ws Agent gives this assistant a real on-chain wallet on the x402 network.',
	'wallet_status shows the balance and spending caps; provision_wallet creates a custodial wallet',
	'for one of your agents; find_services discovers paid services; pay_quote(resource_url) prices one',
	'without paying (recipient, amount, token, chain, and anything blocking it); pay_and_call(resource_url)',
	"calls a paid x402 endpoint and settles the USDC payment from the user's own three.ws agent wallet,",
	'within caps; monetize_endpoint publishes one of your agent endpoints as a priced x402 service so other',
	'agents can pay it and you earn USDC. Always check wallet_status before spending, show the user the',
	'pay_quote table, wait for a clear yes, then call pay_and_call with its quote_id and',
	'confirm_payment: true. pay_and_call is off until the session turns on the x402 group.',
	'read_resource reads live three:// resources (wallets, agents, usage, orders, launches, the',
	'marketplace and x402 services); omit uri to list them.',
	'The agent marketplace tools buy, sell and bid on whole agents with USDC escrow on Solana:',
	'browse_marketplace, get_listing, place_bid, buy_now, accept_marketplace_bid and friends. Every',
	'financial one needs preview_marketplace_action first: show the user its table (recipient, amount,',
	'token, chain), wait for a clear yes, then call the tool with its confirm flag and the preview_id.',
	'Prediction markets settle in USDC on Solana: predictions_events and predictions_event research,',
	'predictions_positions reads an agent, predictions_watch sets a probability alert. predictions_open,',
	'predictions_close and predictions_redeem move funds: call the matching *_preview tool, show its',
	'table, wait for a clear yes, then call with confirm_trade: true and the preview_id.',
	'Solana trading: token_search, get_price, get_indicators, get_market_signals (omit mint for the',
	'ecosystem view) and get_news_feed research. swap_quote compares every aggregator and says which',
	'route nets the most and why; with agent_id it returns a confirmation table and a quote_id.',
	'swap_simulate dry-runs that quote on chain without signing. swap_execute moves funds: show the user',
	'the swap_quote table, wait for a clear yes, then call it with the quote_id and confirm_swap: true.',
	'arbitrage_prices and arbitrage_quote compare venues; arbitrage legs are not atomic, so read the',
	'worst case and verdict before suggesting one, and treat each leg as its own confirmed swap.',
	'Portfolio: get_portfolio values an agent wallet (SOL and SPL, FIFO cost basis, risk flags),',
	'get_balance_history reads its hourly snapshots and get_pnl splits realized and unrealized P&L by source.',
	'Launch sniper: sniper_status reads strategies; sniper_activate spends SOL on new launches, so call',
	'sniper_activate_preview, show its table (recipient, amount, asset, chain), wait for a clear yes, then',
	'call it with confirm_spend: true and the preview_id. sniper_deactivate disarms at once. sniper_subscribe',
	'follows a signal feed on paper. Alerts: alert_rule_create (launch_match filters a new launch by name,',
	'market cap, safety score and creator history) notifies the owner by bell, push and paired chats;',
	'alert_rule_list, and alert_rule_delete with confirm_delete and the list preview_id.',
	'Duels: duel_challenge pits your agent against another owner\'s over the next day or week, duel_accept',
	'answers one, duel_details reads a duel or challenge and duel_markets lists duels, challenges and the leaderboard.',
	'Commerce: invoice_create bills someone in USDC, SOL or $THREE with a Solana Pay link, QR and receipt page;',
	'invoice_list, invoice_details and invoice_verify track it to paid, underpaid or expired; invoice_cancel',
	'withdraws an unpaid one. agent_sell lists an offer; offer_list browses them; agent_buy quotes one and',
	'agent_buy_confirm pays and returns the goods once the chain shows the payment. agent_send_preview prices',
	'a transfer and agent_send runs it (an address off the owner allowlist becomes an approval request, never a',
	'signature). For agent_send and agent_buy_confirm: show the preview table (recipient, amount, asset, chain),',
	'wait for a clear yes, then call with the preview_id and confirm_send or confirm_payment: true.',
	'spending_check reads the agent limits; spending_setup only proposes new ones, which the owner approves on',
	'three.ws with a fresh identity check. Never present a proposal as applied.',
	'Orders and DCA on any SPL token: order_preview prices a limit, stop, trailing, ladder or OCO order and',
	'dca_preview a DCA schedule (Solana agent wallet, or an EVM delegation); each returns what would be placed,',
	'when it acts and a preview_id. Show that table (wallet, amount, asset, chain), wait for a clear yes, then',
	'call limit_order_create, stop_order_create, trailing_order_create, ladder_order_create or oco_order_create',
	'with confirm_order: true, or dca_create with confirm_dca: true. order_book shows next fire times and why',
	'an order skipped; limit_order_list, limit_order_history and dca_list read; limit_order_cancel and',
	'dca_cancel stop orders and never move funds.',
].join(' ');

export const dispatch = makeDispatcher({
	serverInfo: { name: 'threews-agent', version: '1.0.0' },
	instructions: INSTRUCTIONS,
	catalog: TOOL_CATALOG,
	tools: TOOLS,
	logName: 'mcp-agent',
	policyServer: 'threews-agent',
	resourceServer: 'mcp-agent',
});
