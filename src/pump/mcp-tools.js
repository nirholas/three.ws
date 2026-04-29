// Shared, runtime-agnostic MCP tool definitions for the pump.fun MCP server.
// Imported by both the Vercel handler (api/pump-fun-mcp.js) and the
// Cloudflare Workers mirror (workers/pump-fun-mcp/worker.js).
// No imports — pure data and pure helpers only.

export const TOOLS = [
	{
		name: 'searchTokens',
		description: 'Search pump.fun tokens by name, symbol, or mint address.',
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string' },
				limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
			},
			required: ['query'],
		},
	},
	{
		name: 'getTokenDetails',
		description: 'Full details for a specific pump.fun token by mint address.',
		inputSchema: {
			type: 'object',
			properties: { mint: { type: 'string' } },
			required: ['mint'],
		},
	},
	{
		name: 'getBondingCurve',
		description:
			'Bonding curve analysis: real reserves, virtual reserves, and graduation progress (on-chain).',
		inputSchema: {
			type: 'object',
			properties: {
				mint: { type: 'string' },
				network: { type: 'string', enum: ['mainnet', 'devnet'], default: 'mainnet' },
			},
			required: ['mint'],
		},
	},
	{
		name: 'getTokenTrades',
		description: 'Recent buy/sell history for a token.',
		inputSchema: {
			type: 'object',
			properties: {
				mint: { type: 'string' },
				limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
			},
			required: ['mint'],
		},
	},
	{
		name: 'getTrendingTokens',
		description: 'Top pump.fun tokens by market cap.',
		inputSchema: {
			type: 'object',
			properties: { limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 } },
		},
	},
	{
		name: 'getNewTokens',
		description: 'Most recently launched pump.fun tokens.',
		inputSchema: {
			type: 'object',
			properties: { limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 } },
		},
	},
	{
		name: 'getGraduatedTokens',
		description: 'Tokens that graduated from the bonding curve to Raydium AMM.',
		inputSchema: {
			type: 'object',
			properties: { limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 } },
		},
	},
	{
		name: 'getKingOfTheHill',
		description: 'Highest-market-cap token still on the bonding curve.',
		inputSchema: { type: 'object', properties: {} },
	},
	{
		name: 'kol_radar',
		description:
			'gmgn radar signals: early-detection patterns filtered by category, sorted by score desc.',
		inputSchema: {
			type: 'object',
			properties: {
				category: {
					type: 'string',
					enum: ['pump-fun', 'new-mints', 'volume-spike'],
					default: 'pump-fun',
				},
				limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
			},
		},
	},
	{
		name: 'getCreatorProfile',
		description: 'All tokens by a creator wallet, with rug-pull risk flags.',
		inputSchema: {
			type: 'object',
			properties: { creator: { type: 'string' } },
			required: ['creator'],
		},
	},
	{
		name: 'getTokenHolders',
		description: 'Top holders of a token with concentration analysis (on-chain).',
		inputSchema: {
			type: 'object',
			properties: {
				mint: { type: 'string' },
				limit: { type: 'integer', minimum: 1, maximum: 20, default: 10 },
				network: { type: 'string', enum: ['mainnet', 'devnet'], default: 'mainnet' },
			},
			required: ['mint'],
		},
	},
];

export function rpcError(code, message) {
	const err = new Error(message);
	err.rpcCode = code;
	return err;
}

export function rpcEnvelope(id, result, errObj) {
	if (errObj) {
		return { jsonrpc: '2.0', id: id ?? null, error: errObj };
	}
	return { jsonrpc: '2.0', id: id ?? null, result };
}
