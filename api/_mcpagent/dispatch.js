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
	'for one of your agents; find_services discovers paid services; pay_and_call(resource_url) calls a',
	"paid x402 endpoint and settles the USDC payment from the user's own three.ws agent wallet, within",
	'caps; monetize_endpoint publishes one of your agent endpoints as a priced x402 service so other',
	'agents can pay it and you earn USDC. Always check wallet_status before spending, and confirm the',
	'price with the user when it is non-trivial.',
	'The agent marketplace tools buy, sell and bid on whole agents with USDC escrow on Solana:',
	'browse_marketplace, get_listing, place_bid, buy_now, accept_marketplace_bid and friends. Every',
	'financial one needs preview_marketplace_action first: show the user its table (recipient, amount,',
	'token, chain), wait for a clear yes, then call the tool with its confirm flag and the preview_id.',
	'Prediction markets settle in USDC on Solana: predictions_events and predictions_event research,',
	'predictions_positions reads an agent, predictions_watch sets a probability alert. predictions_open,',
	'predictions_close and predictions_redeem move funds: call the matching *_preview tool, show its',
	'table, wait for a clear yes, then call with confirm_trade: true and the preview_id.',
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
