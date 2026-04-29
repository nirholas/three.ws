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
	{
		name: 'pumpfun_vanity_mint',
		description:
			'Generate a Solana keypair whose address ends/starts with a vanity pattern. Returns publicKey + secretKey (base58). Caller must save the secret key immediately — it is never stored. Hard timeout: 60 s.',
		inputSchema: {
			type: 'object',
			properties: {
				suffix: { type: 'string', description: 'Desired address suffix (case-insensitive by default)' },
				prefix: { type: 'string', description: 'Desired address prefix (case-insensitive by default)' },
				caseSensitive: { type: 'boolean', default: false },
				maxAttempts: { type: 'integer', default: 5000000 },
			},
		},
	},
	{
		name: 'pumpfun_watch_whales',
		description:
			'Collect whale trades on a pump.fun token for a short window (max 10 s). Returns all trades whose USD value meets minUsd.',
		inputSchema: {
			type: 'object',
			properties: {
				mint: { type: 'string', description: 'SPL mint pubkey (base58)' },
				minUsd: { type: 'number', description: 'Minimum trade value in USD (default 5000)' },
				durationMs: {
					type: 'number',
					description: 'Collection window in ms (default 5000, max 10000)',
				},
			},
			required: ['mint'],
		},
	},
	{
		name: 'pumpfun_list_claims',
		description:
			'List recent pump.fun fee-claim events for a creator wallet (on-chain, no indexer needed). Returns signature, mint, lamports, and Unix timestamp for each claim.',
		inputSchema: {
			type: 'object',
			properties: {
				creator: { type: 'string', description: 'Creator wallet address (base58)' },
				limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
				network: { type: 'string', enum: ['mainnet', 'devnet'], default: 'mainnet' },
			},
			required: ['creator'],
		},
	},
	{
		name: 'pumpfun_watch_claims',
		description:
			'Return all pump.fun fee-claim events for a creator wallet within a look-back window (durationMs). Useful for batch collection after a delay.',
		inputSchema: {
			type: 'object',
			properties: {
				creator: { type: 'string', description: 'Creator wallet address (base58)' },
				durationMs: {
					type: 'number',
					description: 'Look-back window in ms (default 300000 = 5 min, max 1800000)',
				},
				network: { type: 'string', enum: ['mainnet', 'devnet'], default: 'mainnet' },
			},
			required: ['creator'],
		},
	},
	{
		name: 'sns_resolve',
		description: 'Resolve a .sol Solana Name Service domain to its owner wallet address.',
		inputSchema: {
			type: 'object',
			properties: {
				name: { type: 'string', description: '.sol domain name, e.g. "bonfida.sol"' },
			},
			required: ['name'],
		},
	},
	{
		name: 'sns_reverseLookup',
		description: 'Reverse-lookup a Solana wallet address to its primary .sol domain name.',
		inputSchema: {
			type: 'object',
			properties: {
				address: { type: 'string', description: 'Base58 Solana wallet address' },
			},
			required: ['address'],
		},
	},
	{
		name: 'kol_leaderboard',
		description:
			'Top KOL traders ranked by P&L for a given time window. Returns wallet, pnlUsd, winRate, trades, rank.',
		inputSchema: {
			type: 'object',
			properties: {
				window: { type: 'string', enum: ['24h', '7d', '30d'], default: '7d' },
				limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
			},
		},
	},
];

	{
		name: 'social_cashtag_sentiment',
		description:
			'Score social-post sentiment for a cashtag using a deterministic lexicon. Returns score (-1..1), positive/negative/neutral percentages, and example posts.',
		inputSchema: {
			type: 'object',
			properties: {
				posts: {
					type: 'array',
					description: 'Array of post objects. Each must have a text field; id, ts, and author are optional.',
					items: {
						type: 'object',
						properties: {
							id: { type: 'string' },
							ts: { type: 'string' },
							text: { type: 'string' },
							author: { type: 'string' },
						},
						required: ['text'],
					},
				},
			},
			required: ['posts'],
		},
	},

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
