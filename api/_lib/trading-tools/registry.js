// The trading tool registry: one definition per tool, served by both the
// threews-agent MCP server (api/_mcpagent/trading-tools.js) and the REST API
// (api/v1/trading/[...path].js), so the two surfaces can never disagree about
// what a tool takes, what it does, or how it refuses.
//
// Each entry:
//   name         the MCP tool name (the policy row in packages/mcp-policy/src/table.js)
//   title        one human line
//   tier         'read' | 'financial' (swap_execute is the only one that moves funds)
//   method/path  the REST route under /api/v1/trading
//   auth         REST auth: 'public' reads anyone may call, 'optional' when an
//                account unlocks more (swap_quote with agent_id), 'required'
//   description  model-facing text, also the REST summary
//   inputSchema  JSON Schema; REST validates query and body against the same one
//   run(args, ctx)  ctx = { principal, req }; returns plain JSON or throws a
//                designed refusal (ToolInputError / PreviewError) that
//                describeToolError() turns into a status, code and message

import Ajv from 'ajv';
import addFormats from 'ajv-formats';

import { tokenSearch, getPrice, getIndicators, getMarketSignals, getNewsFeed, INDICATORS, INDICATOR_INTERVALS } from './market.js';
import { getEcosystemSignals, ECOSYSTEM_WINDOWS, ECOSYSTEM_SECTIONS } from './ecosystem.js';
import { arbitragePrices, arbitrageQuote, ARB_SIZE_CAP_USD, ARB_HARD_CAP_USD } from './arbitrage.js';
import { swapQuote, swapExecute, DEFAULT_SWAP_SLIPPAGE_BPS } from './swap.js';
import { SWAP_DEX_CHOICES } from './swap-routes.js';
import { networkArg } from './context.js';

const mintProp = (what) => ({ type: 'string', minLength: 1, maxLength: 64, description: `${what}: a mint address, a symbol, or SOL / USDC.` });
const amountProp = { type: 'number', exclusiveMinimum: 0, description: 'Amount of the input token in whole units (0.5 = half a SOL).' };
const agentIdProp = { type: 'string', format: 'uuid', description: 'The agent whose Solana wallet would fill the swap. wallet_status lists yours.' };
const quoteIdProp = { type: 'string', minLength: 8, maxLength: 4096, description: 'quote_id from swap_quote, issued in the last five minutes.' };

const SWAP_INPUT = {
	type: 'object',
	properties: {
		input_mint: mintProp('Token to pay with'),
		output_mint: mintProp('Token to receive'),
		amount: amountProp,
		amount_raw: { type: 'string', pattern: '^[0-9]{1,30}$', description: 'Amount in base units instead of amount, for exact sizing.' },
		dex: {
			type: 'string',
			maxLength: 70,
			default: 'auto',
			description: `Route choice: ${SWAP_DEX_CHOICES.join(', ')}, or dex:<label> for one venue (the labels arbitrage_prices returns). auto compares every aggregator and takes the best net output.`,
		},
		slippage_bps: { type: 'integer', minimum: 1, maximum: 5000, default: DEFAULT_SWAP_SLIPPAGE_BPS, description: 'Worst price you accept, in basis points (100 = 1%).' },
		agent_id: agentIdProp,
	},
	required: ['input_mint', 'output_mint'],
	additionalProperties: false,
};

export const TRADING_TOOLS = [
	{
		name: 'token_search',
		title: 'Search Solana tokens',
		tier: 'read',
		method: 'GET',
		path: '/tokens/search',
		auth: 'public',
		description:
			'Find a Solana token by symbol, name or mint. Returns the candidates ranked by liquidity with price, market cap, holders and a safety read (mint and freeze authority, holder concentration), so you can pick the real one by mint before quoting. Call this first when the user names a token by symbol or name, so every later tool gets the right mint. Use this when the user names a token by symbol or name and you need its exact mint before any other trading tool.',
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string', minLength: 1, maxLength: 80, description: 'Symbol, name or mint address.' },
				limit: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
			},
			required: ['query'],
			additionalProperties: false,
		},
		run: (a) => tokenSearch({ query: a.query, limit: a.limit }),
	},
	{
		name: 'get_price',
		title: 'Live token price',
		tier: 'read',
		method: 'GET',
		path: '/price',
		auth: 'public',
		description: 'Live USD and SOL price for one Solana token with its 24h change, market cap, liquidity, volume and the source that answered. Use this for a quick price check on one token. Use this when you need the current price of one token.',
		inputSchema: {
			type: 'object',
			properties: { mint: mintProp('Token') },
			required: ['mint'],
			additionalProperties: false,
		},
		run: (a) => getPrice({ mint: a.mint }),
	},
	{
		name: 'get_indicators',
		title: 'Technical indicators',
		tier: 'read',
		method: 'GET',
		path: '/indicators',
		auth: 'public',
		description: `Technical indicators (${INDICATORS.join(', ')}) computed over live OHLCV candles for one token, with the latest value and a trailing series for each, and the time of the last candle. Use this when the user asks for technical analysis or a trend read on a token. Use this when the user asks for a technical read (trend, momentum, overbought or oversold) on a token.`,
		inputSchema: {
			type: 'object',
			properties: {
				mint: mintProp('Token'),
				indicators: { type: 'array', items: { type: 'string', enum: [...INDICATORS] }, uniqueItems: true, description: 'Which indicators; all when omitted.' },
				interval: { type: 'string', enum: [...INDICATOR_INTERVALS], default: '1h' },
				period: { type: 'integer', minimum: 2, maximum: 200, default: 14 },
			},
			required: ['mint'],
			additionalProperties: false,
		},
		run: (a) => getIndicators({ mint: a.mint, indicators: a.indicators, interval: a.interval, period: a.period }),
	},
	{
		name: 'get_market_signals',
		title: 'Market signals',
		tier: 'read',
		method: 'GET',
		path: '/signals',
		auth: 'public',
		description:
			'With a mint: the live signal read for that token (launchpad price and graduation, smart-money score, dev-dump flag, momentum, conviction score). Without one: the Solana ecosystem read from the launch, trade and smart-money data the platform ingests: macro readings (launch rate, graduation rate, net SOL flow, active wallets) against their baselines, top movers, and anomalies with z-scores. Every signal carries its inputs and as_of time. Use this to judge whether a token, or the market as a whole, is heating up or cooling down before trading. Use this when deciding whether a token is worth trading, or with no mint when the user asks what the Solana market is doing right now.',
		inputSchema: {
			type: 'object',
			properties: {
				mint: { ...mintProp('Token'), description: 'Token to read. Omit for the ecosystem view.' },
				network: { type: 'string', enum: ['mainnet', 'devnet'], default: 'mainnet', description: 'Token reads only.' },
				window: { type: 'string', enum: Object.keys(ECOSYSTEM_WINDOWS), default: '1h', description: 'Ecosystem view only: the window compared against its baseline.' },
				sections: { type: 'array', items: { type: 'string', enum: [...ECOSYSTEM_SECTIONS] }, uniqueItems: true, description: 'Ecosystem view only: which sections; all when omitted.' },
			},
			additionalProperties: false,
		},
		run: (a) => (a.mint
			? getMarketSignals({ mint: a.mint, network: networkArg(a.network) })
			: getEcosystemSignals({ window: a.window || '1h', sections: a.sections })),
	},
	{
		name: 'get_news_feed',
		title: 'Crypto news feed',
		tier: 'read',
		method: 'GET',
		path: '/news',
		auth: 'public',
		description: 'The aggregated crypto news feed, optionally filtered to one token (a mint is resolved to its ticker first) or a category, with source, publish time, tickers and sentiment per article. Use this when the user asks what is happening with a token or the market, or to check the news before a trade. Use this when the user asks what is being said about a token or the market.',
		inputSchema: {
			type: 'object',
			properties: {
				token: { type: 'string', maxLength: 64, description: 'Ticker or mint to filter by.' },
				category: { type: 'string', maxLength: 40 },
				limit: { type: 'integer', minimum: 1, maximum: 50, default: 15 },
			},
			additionalProperties: false,
		},
		run: (a) => getNewsFeed({ token: a.token || null, category: a.category || null, limit: a.limit }),
	},
	{
		name: 'arbitrage_prices',
		title: 'Cross-venue prices',
		tier: 'read',
		method: 'GET',
		path: '/arbitrage/prices',
		auth: 'public',
		description:
			'Buy and sell price for one pair on every Solana venue that can fill it at this size (discovered live, fees and price impact included), the aggregated best route as a baseline, and the widest cross-venue spread. Venue ids (dex:<label>) can be passed straight to swap_quote as dex. Use this to compare venues for a pair before choosing where to swap, or to spot a cross-venue spread. Use this when the user wants to know which venue prices a token best, or to pick a venue for swap_quote.',
		inputSchema: {
			type: 'object',
			properties: {
				token: mintProp('Token to price'),
				quote: { ...mintProp('Quote token'), default: 'SOL' },
				amount: { ...amountProp, default: 1, description: 'Size in the quote token.' },
			},
			required: ['token'],
			additionalProperties: false,
		},
		run: (a) => arbitragePrices({ token: a.token, quote: a.quote, amount: a.amount }),
	},
	{
		name: 'arbitrage_quote',
		title: 'Two-leg arbitrage quote',
		tier: 'read',
		method: 'GET',
		path: '/arbitrage/quote',
		auth: 'public',
		description:
			`The best buy-here, sell-there route for a pair with expected profit after network fees, a verdict (viable, risk_exceeds_edge, unprofitable), and a simulated worst case from real re-quotes: both legs at their slippage floor, and the spread closing to the weakest venue. The legs are NOT atomic: leg 2 can fail or reprice after leg 1 fills. Sizes above $${ARB_SIZE_CAP_USD} are refused unless accept_size_risk is true, and above $${ARB_HARD_CAP_USD} always. Never executes; each leg comes back as swap_quote arguments. Use this after arbitrage_prices shows a spread, to judge whether it is worth trading. Use this when the user asks whether a cross-venue arbitrage exists, and read its verdict and worst case before suggesting one.`,
		inputSchema: {
			type: 'object',
			properties: {
				token: mintProp('Token to route through'),
				quote: { ...mintProp('Quote token'), default: 'SOL' },
				amount: { ...amountProp, default: 1, description: 'Size in the quote token.' },
				accept_size_risk: { type: 'boolean', default: false, description: `Quote above the $${ARB_SIZE_CAP_USD} default cap (up to $${ARB_HARD_CAP_USD}). Set only when the user asked for that size knowing the legs are not atomic.` },
			},
			required: ['token'],
			additionalProperties: false,
		},
		run: (a) => arbitrageQuote({ token: a.token, quote: a.quote, amount: a.amount, accept_size_risk: a.accept_size_risk === true }),
	},
	{
		name: 'swap_quote',
		title: 'Compare swap routes',
		tier: 'read',
		method: 'POST',
		path: '/swap/quote',
		auth: 'optional',
		description:
			'Quote a Solana swap on every aggregator at once and return each route with its net output after fees and price impact, which one won and why. With agent_id it also runs the full trade guard chain against that agent wallet and returns the confirmation table (wallet, pay, receive at least, route, fees) and a quote_id valid for five minutes. Show the user that table before swap_execute. Call this first for any swap; swap_simulate and swap_execute need its quote_id. Use this first for any swap, whether the user wants a price comparison or to trade.',
		inputSchema: SWAP_INPUT,
		run: (a, ctx) => swapQuote(a, ctx),
	},
	{
		name: 'swap_simulate',
		title: 'Simulate a quoted swap',
		tier: 'read',
		method: 'POST',
		path: '/swap/simulate',
		auth: 'required',
		description:
			'Dry run of a swap_quote: re-prices the pinned route, runs every guard (spend caps, price-impact breaker, rug firewall, balance), builds the exact transaction and simulates it on chain. Nothing is signed or sent and the quote_id stays valid, so the user can still confirm it. Use this after swap_quote when you want proof the transaction would land before asking the user to confirm. Use this after swap_quote when the user wants proof the swap would land before confirming it.',
		inputSchema: {
			type: 'object',
			properties: { quote_id: quoteIdProp },
			required: ['quote_id'],
			additionalProperties: false,
		},
		run: (a, ctx) => swapExecute({ quote_id: a.quote_id, dry_run: true }, ctx),
	},
	{
		name: 'swap_execute',
		title: 'Execute a quoted swap',
		tier: 'financial',
		confirmFlag: 'confirm_swap',
		previewTool: 'swap_quote',
		method: 'POST',
		path: '/swap/execute',
		auth: 'required',
		description:
			'Fill a swap_quote from the agent wallet, signed server-side by its custodial key. Moves real funds: call swap_quote with agent_id, show the user its confirmation table, and call this only after a clear yes, with that quote_id and confirm_swap: true. The route is re-priced first and refused if it would deliver less than the confirmed minimum; a quote older than five minutes is refused. Each quote fills at most once. Call this after the user said yes to a swap_quote confirmation table. Use this after the user approved a swap_quote confirmation table, never before.',
		inputSchema: {
			type: 'object',
			properties: {
				quote_id: quoteIdProp,
				confirm_swap: { type: 'boolean', description: 'Must be true. Set it only after the user saw the swap_quote confirmation table and said yes.' },
			},
			required: ['quote_id', 'confirm_swap'],
			additionalProperties: false,
		},
		run: (a, ctx) => swapExecute({ quote_id: a.quote_id, confirm_swap: a.confirm_swap }, ctx),
	},
];

export const TRADING_TOOLS_BY_NAME = new Map(TRADING_TOOLS.map((t) => [t.name, t]));

const ajv = new Ajv({ allErrors: true, useDefaults: true, coerceTypes: 'array', strict: false });
addFormats(ajv);
const validators = new Map(TRADING_TOOLS.map((t) => [t.name, ajv.compile(t.inputSchema)]));

/**
 * Validate (and coerce, and default) a tool's arguments in place. Returns null
 * when valid, or a readable message naming the first bad field.
 */
export function validateToolArgs(name, args) {
	const v = validators.get(name);
	if (!v || v(args)) return null;
	const e = v.errors?.[0];
	const field = e?.instancePath ? e.instancePath.replace(/^\//, '').replace(/\//g, '.') : e?.params?.missingProperty || e?.params?.additionalProperty || 'input';
	return { field, message: `${field}: ${e?.message || 'is invalid'}` };
}
