// REST routes for the trading tool registry: /api/v1/trading/*.
//
// One route per registry entry (api/_lib/trading-tools/registry.js), so REST
// and MCP share the schema, the guard chain and the refusal codes. GET routes
// read their arguments from the query string (array arguments take a comma
// list: ?indicators=rsi,macd); POST routes read a JSON body. A designed refusal
// answers with its own status and code; anything else is a redacted 500.
//
//   GET  /api/v1/trading                     the tool list with input schemas
//   GET  /api/v1/trading/tokens/search       token_search
//   GET  /api/v1/trading/price               get_price
//   GET  /api/v1/trading/indicators          get_indicators
//   GET  /api/v1/trading/signals             get_market_signals (no mint: ecosystem view)
//   GET  /api/v1/trading/news                get_news_feed
//   GET  /api/v1/trading/arbitrage/prices    arbitrage_prices
//   GET  /api/v1/trading/arbitrage/quote     arbitrage_quote
//   POST /api/v1/trading/swap/quote          swap_quote
//   POST /api/v1/trading/swap/simulate       swap_simulate (auth)
//   POST /api/v1/trading/swap/execute        swap_execute (auth, wallet:trade, confirm_swap)

import { apiError } from '../agents-v1/http.js';
import { TRADING_TOOLS, validateToolArgs } from './registry.js';
import { describeToolError } from './context.js';

export const TRADING_BASE = '/trading';

/** Query strings carry arrays as a comma list; split them before validation. */
export function queryArgs(query, schema) {
	const out = {};
	for (const [k, v] of Object.entries(query || {})) {
		if (v === '' || v == null) continue;
		out[k] = schema?.properties?.[k]?.type === 'array' && typeof v === 'string'
			? v.split(',').map((s) => s.trim()).filter(Boolean)
			: v;
	}
	return out;
}

function routeFor(tool) {
	return {
		method: tool.method,
		path: `${TRADING_BASE}${tool.path}`,
		name: `v1.trading.${tool.name}`,
		auth: tool.auth,
		handler: async (ctx) => {
			const args = tool.method === 'GET' ? queryArgs(ctx.query, tool.inputSchema) : { ...(ctx.body || {}) };
			const bad = validateToolArgs(tool.name, args);
			if (bad) throw apiError(400, 'validation_error', bad.message, { field: bad.field });
			try {
				return await tool.run(args, { principal: ctx.principal, req: ctx.req, requestId: ctx.requestId });
			} catch (err) {
				const d = describeToolError(err);
				if (d) throw apiError(d.status, d.code, d.message, d.detail);
				throw err;
			}
		},
	};
}

const index = {
	method: 'GET',
	path: TRADING_BASE,
	name: 'v1.trading.index',
	auth: 'public',
	handler: () => ({
		tools: TRADING_TOOLS.map((t) => ({
			name: t.name,
			title: t.title,
			tier: t.tier,
			method: t.method,
			path: `/api/v1${TRADING_BASE}${t.path}`,
			auth: t.auth,
			...(t.confirmFlag ? { confirm_flag: t.confirmFlag, preview_tool: t.previewTool } : {}),
			description: t.description,
			input_schema: t.inputSchema,
		})),
		mcp: { server: '/api/mcp-agent', group: 'trading' },
		docs: '/docs/trading-tools',
	}),
};

export const tradingRoutes = [index, ...TRADING_TOOLS.map(routeFor)];
