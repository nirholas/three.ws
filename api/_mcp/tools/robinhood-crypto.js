// Robinhood Crypto connector MCP tools: the signed-in owner's own Robinhood
// Crypto account, through the API key they pasted at three.ws/settings/robinhood.
// Crypto pairs only (ASSET-USD symbols).
//
// Every tool calls api/_lib/robinhood/service.js, the same service behind
// /api/v1/robinhood/crypto/*, so the spend caps, the order ledger and the
// secret handling are identical on both surfaces.
//
// robinhood_place_order is financial tier and verifies its own preview: the
// policy layer enforces the group enablement and confirm_order, and the service
// checks the preview_id against the ledger (owner, five minute expiry, single
// use), re-prices, and reserves the spend against the owner's caps before it
// signs. Connector keys never see it (see movesValue in api/_mcp/policy.js).
//
// Robinhood Chain (4663) on-chain reads live in ./robinhood.js; these tools are
// the brokerage account, not the chain.

import * as connector from '../../_lib/robinhood/service.js';

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const MONEY = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

const PAIR = { type: 'string', pattern: '^[A-Za-z0-9]{2,10}-USD$', description: 'A Robinhood Crypto pair in the form ASSET-USD (the asset code, a hyphen, USD).' };

function ok(structured) {
	return { content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }], structuredContent: structured };
}

function fail(e) {
	if (e instanceof connector.ConnectorError) {
		const structured = { error: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) };
		return { content: [{ type: 'text', text: `Error (${e.code}): ${e.message}` }], structuredContent: structured, isError: true };
	}
	throw e;
}

function tool(def, run) {
	return {
		group: 'robinhood',
		...def,
		async handler(args, auth) {
			if (!auth?.userId) {
				return fail(new connector.ConnectorError(401, 'unauthorized', 'Connect a three.ws account (OAuth or API key) to use your Robinhood Crypto account.'));
			}
			try {
				return ok(await run(args || {}, auth.userId));
			} catch (e) {
				return fail(e);
			}
		},
	};
}

export const toolDefs = [
	tool(
		{
			name: 'robinhood_holdings',
			title: 'Robinhood Crypto holdings',
			scope: 'wallet:read',
			annotations: READ,
			description:
				"The owner's Robinhood Crypto account holdings: each asset's total and tradable quantity, priced at Robinhood's live bid (what selling would fetch), sorted by value, with a total. Needs the owner's API key connected at three.ws/settings/robinhood; returns not_connected otherwise. Use this when the owner asks what crypto they hold on Robinhood. For an on-chain Robinhood Chain wallet use robinhood_wallet_holdings instead.",
			inputSchema: { type: 'object', properties: {}, additionalProperties: false },
		},
		(_a, userId) => connector.holdings({ userId }),
	),
	tool(
		{
			name: 'robinhood_quote',
			title: 'Robinhood Crypto quote',
			scope: 'wallet:read',
			annotations: READ,
			description:
				"Live best bid, ask and mid price from Robinhood Crypto for up to 50 pairs, read through the owner's connected API key, plus any pair Robinhood did not return. Use this to check a price before previewing an order.",
			inputSchema: {
				type: 'object',
				properties: { symbols: { type: 'array', items: PAIR, minItems: 1, maxItems: 50 } },
				required: ['symbols'],
				additionalProperties: false,
			},
		},
		(a, userId) => connector.quote({ userId, symbols: a.symbols }),
	),
	tool(
		{
			name: 'robinhood_preview_order',
			title: 'Preview a Robinhood Crypto order',
			scope: 'wallet:trade',
			annotations: WRITE,
			description:
				"Price and size one Robinhood Crypto order and check it against the owner's per-order and daily spend caps. Give quantity (asset units) or amount_usd (rounded down to the pair's quantity step). Returns a preview_id valid five minutes, a confirm table (pair, side, quantity, estimated price and total) and the caps left today. Moves nothing. Show the confirm table to the owner, then call robinhood_place_order only after they say yes. A buy over a cap is refused here with over_per_order_cap or over_daily_cap. Use this when the owner wants to buy or sell crypto on Robinhood, before robinhood_place_order.",
			inputSchema: {
				type: 'object',
				properties: {
					symbol: PAIR,
					side: { type: 'string', enum: ['buy', 'sell'] },
					type: { type: 'string', enum: ['market', 'limit'], default: 'market' },
					quantity: { type: 'string', pattern: '^\\d+(\\.\\d{1,18})?$', description: 'Asset units, as a decimal string. Give this or amount_usd.' },
					amount_usd: { type: 'number', exclusiveMinimum: 0, maximum: 10000, description: 'Dollars to trade. Give this or quantity.' },
					limit_price: { type: 'string', pattern: '^\\d+(\\.\\d{1,18})?$', description: 'Required for a limit order: the USD price per unit.' },
				},
				required: ['symbol', 'side'],
				additionalProperties: false,
			},
		},
		(a, userId) =>
			connector.previewOrder({
				userId,
				source: 'mcp',
				symbol: a.symbol,
				side: a.side,
				type: a.type || 'market',
				quantity: a.quantity,
				amountUsd: a.amount_usd,
				limitPrice: a.limit_price,
			}),
	),
	tool(
		{
			name: 'robinhood_place_order',
			title: 'Place a Robinhood Crypto order',
			tier: 'financial',
			confirmFlag: 'confirm_order',
			previewTool: 'robinhood_preview_order',
			scope: 'wallet:trade',
			annotations: MONEY,
			description:
				"Place the Robinhood Crypto order a preview describes, in the owner's own account, signed with their key. Needs the preview_id from robinhood_preview_order (under five minutes old, single use) and confirm_order: true, which you may only send after the owner explicitly approved that preview's confirm table. A market buy whose price moved more than 2% since the preview is refused with price_moved; preview again. Spend is reserved against the daily cap before the order is sent. Returns the ledger entry with Robinhood's order id and state. Use this when the owner has approved the exact preview and wants it placed.",
			inputSchema: {
				type: 'object',
				properties: {
					preview_id: { type: 'string', format: 'uuid', description: 'The preview_id from robinhood_preview_order.' },
					confirm_order: { type: 'boolean', description: 'Must be true, and only after the owner said yes to the preview.' },
				},
				required: ['preview_id', 'confirm_order'],
				additionalProperties: false,
			},
		},
		(a, userId) => connector.placeOrder({ userId, previewId: a.preview_id, confirmOrder: a.confirm_order }),
	),
];
