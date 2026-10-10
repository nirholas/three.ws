// Single source of truth for the unified three.ws API (/api/v1).
//
// Every versioned endpoint is registered here once. The discovery document
// (GET /api/v1) renders from this list, so the catalog and the live surface can
// never drift: adding a route means adding its entry here AND its handler file.
//
// Each entry:
//   id      stable usage/billing identifier (matches the handler's `name`)
//   method  HTTP method(s)
//   path    public path under the API base
//   auth    'public' | 'optional' | 'required'
//   scope   OAuth scope enforced for key/OAuth callers (when auth ≠ public)
//   summary one line, holder/developer readable
//   params  documented inputs (query for GET, body for POST)

export const API_META = {
	name: 'three.ws API',
	version: 'v1',
	base_url: '/api/v1',
	description:
		'One API for the three.ws platform: 3D generation, market & narrative intelligence, ' +
		'sentiment, and on-chain agent capabilities: one key, one rate-limit budget, one usage ledger.',
	auth: {
		scheme: 'Bearer',
		description:
			'Send a three.ws API key as `Authorization: Bearer sk_live_…`, an OAuth access token, ' +
			'or call from a signed-in browser session. Create and manage keys at /dashboard/developers.',
		scopes: [
			'avatars:read',
			'avatars:write',
			'avatars:delete',
			'profile',
			'memory:read',
			'memory:write',
			'agents:read',
			'agents:write',
			'inference',
		],
	},
	rate_limit: {
		window: '1m',
		limit: 120,
		keyed_by: 'api_key › user › ip',
		headers: ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'Retry-After'],
	},
	envelope: {
		success: '{ "data": … }',
		error: '{ "error": <code>, "error_description": <message> }',
	},
};

export const CATALOG = [
	{
		id: 'v1.chat.completions',
		method: 'POST',
		path: '/api/v1/chat/completions',
		auth: 'required',
		scope: 'inference',
		summary:
			'OpenAI-compatible chat completions on the three.ws agent runtime (model three-ws/agent), ' +
			'billed to account credits at the published per-token rate. Point any OpenAI client at ' +
			'https://three.ws/api/v1 with a key carrying the inference scope.',
		params: {
			messages: 'array: OpenAI chat messages [{ role, content }] (required)',
			model: 'string: three-ws/agent (default)',
			stream: 'boolean: SSE chat.completion.chunk frames (default true)',
			stream_options: 'object: { include_usage: true } adds a final usage + billing chunk',
			agent_id: 'string: bill against this agent\'s inference budget (keys from /api/me/inference/provision are already bound)',
		},
	},
	{
		id: 'v1.models',
		method: 'GET',
		path: '/api/v1/models',
		auth: 'public',
		summary: 'OpenAI-compatible model list for /api/v1/chat/completions, with published per-token prices.',
		params: {},
	},
	{
		id: 'v1.ai.text_to_3d',
		method: 'POST',
		path: '/api/v1/ai/text-to-3d',
		auth: 'public',
		summary:
			'Free text→3D: the only text-to-mesh lane in the agent-payments ecosystem; textured GLB ' +
			'from a prompt, no key, no wallet. Draft tier runs on the NVIDIA NIM TRELLIS lane; free ' +
			'per-IP quota of 10/day, then 429 pointing at the paid /api/x402/forge tiers.',
		params: { prompt: 'string: describe a single object or character (3-1000 chars, required)' },
	},
	{
		id: 'v1.ai.image',
		method: 'POST',
		path: '/api/v1/ai/image',
		auth: 'public',
		summary:
			'Text→image for agents over x402: 5 free images/day per IP, then $0.02 USDC/image, ' +
			'no API key. Runs on NVIDIA NIM / Google Vertex lanes; returns a durable image URL.',
		params: {
			prompt: 'string: image description (required, 3-2000 chars)',
			aspect_ratio: 'string: 1:1 | 16:9 | 9:16 | 4:3 | 3:4 | 3:2 | 2:3 (default 1:1)',
			seed: 'number: optional deterministic seed (honored on NIM/Replicate lanes)',
		},
	},
	{
		id: 'v1.sentiment',
		method: 'POST',
		path: '/api/v1/sentiment',
		auth: 'public',
		summary: 'Classify text sentiment (Positive / Negative / Neutral) with a deterministic score.',
		params: { text: 'string: the text to score (required)' },
	},
	{
		id: 'v1.market.intel',
		method: 'GET',
		path: '/api/v1/market/intel',
		auth: 'optional',
		scope: 'agents:read',
		summary: 'Recent narrative / market intelligence items, momentum-ranked.',
		params: {
			limit: 'number 1-50 (default 20)',
			category: 'string: filter by category (optional)',
			chain: 'string: filter by chain (optional)',
		},
	},
	{
		id: 'v1.market.projects',
		method: 'GET',
		path: '/api/v1/market/projects',
		auth: 'optional',
		scope: 'agents:read',
		summary: 'Momentum-ranked crypto projects with narrative scores.',
		params: {
			limit: 'number 1-50 (default 20)',
			page: 'number (default 1)',
			names: 'string: comma-separated project names to filter (optional)',
			chain: 'string: filter by chain (optional)',
		},
	},
	{
		id: 'v1.agents.resolve',
		method: 'GET',
		path: '/api/v1/agents/{caip}',
		auth: 'public',
		summary:
			'Resolve + verify an ERC-8004 / three.ws Card v1 agent by CAIP ref ' +
			'(eip155:<chainId>:<registry>/<tokenId>).',
		params: {
			caip:
				'path: CAIP agent ref, its "/" passed as a real path separator ' +
				'(eip155:8453:0x8004A169.../1); encoded colons are fine, an encoded slash is rejected',
		},
	},
	{
		id: 'v1.ai.tts',
		method: 'POST',
		path: '/api/v1/ai/tts',
		auth: 'public',
		summary:
			'Text-to-speech (neural Magpie voices): 10 free calls/day per IP (≤500 chars), ' +
			'then $0.005 USDC/call via x402. GET ?voices=1 lists voices. Returns base64 WAV/PCM.',
		params: {
			text: 'string: text to synthesize (required, ≤4096 chars; free tier ≤500)',
			voice: 'string: voice id (optional, default nova)',
			format: 'string: "wav" | "pcm" (optional, default wav)',
			language: 'string: BCP-47 tag (optional, default en-US)',
		},
	},
	{
		id: 'v1.ai.asr',
		method: 'POST',
		path: '/api/v1/ai/asr',
		auth: 'public',
		summary:
			'Speech-to-text (NVIDIA Riva): 5 free clips/day per IP (≤60s), then $0.01 USDC/clip ' +
			'via x402. Accepts base64 JSON or raw audio/* bytes; returns transcript + confidence.',
		params: {
			audio: 'string: base64 audio in a JSON body, or raw bytes with an audio/* Content-Type (required)',
			format: 'string: wav | pcm | flac | ogg (optional)',
			language: 'string: BCP-47 tag (optional, default en-US)',
			words: 'string: "1" for word-level timestamps (optional)',
		},
	},
	{
		id: 'v1.token.security',
		method: 'GET',
		path: '/api/v1/token/security',
		auth: 'public',
		summary:
			'Rug-check any Solana token in one free call: authority status, holder concentration, ' +
			'liquidity depth: on-chain facts, no invented scores. Composes getAccountInfo + ' +
			'getTokenLargestAccounts + DexScreener into a report agents weigh themselves; 20/min per IP.',
		params: {
			address: 'string: base58 Solana mint address (required; EVM 0x… returns 400)',
		},
	},
	{
		id: 'v1.resolve',
		method: 'GET',
		path: '/api/v1/resolve',
		auth: 'public',
		summary:
			'Free name resolution: a high-frequency agent primitive. Resolve a .eth name to its ' +
			'Ethereum address via ENS, or a .sol name to its Solana owner via SNS; reverse-resolve an ' +
			'address back to its primary name in either direction. No key, no wallet; 30/min per IP.',
		params: {
			name: 'string: a name ending in .eth (ENS) or .sol (SNS) to resolve (required unless address is passed)',
			address: 'string: 0x… Ethereum or base58 Solana address to reverse-resolve (required unless name is passed)',
			chain: 'string: "ethereum" | "solana", optional hint validated against address (auto-detected from format when omitted)',
		},
	},
	{
		id: 'v1.gas',
		method: 'GET',
		path: '/api/v1/gas',
		auth: 'public',
		summary:
			'Keyless EVM gas prices for 12 chains: normalized safe/standard/fast maxFee/maxPriorityFee ' +
			'tiers plus baseFee (gwei), from a Blocknative -> Owlracle -> Etherscan failover chain, ' +
			'cached 10s per chain.',
		params: {
			chain: 'string: chain name, alias, or numeric chainId (default ethereum); ?chains=1 lists supported chains',
		},
	},
	{
		id: 'v1.evm.swap-quote',
		method: 'GET',
		path: '/api/v1/evm/swap-quote',
		auth: 'public',
		summary:
			'Read-only EVM swap quote with keyless failover across ParaSwap, KyberSwap, and LI.FI: ' +
			'best-effort output amount, price, and gas estimate on ethereum/base/polygon/arbitrum/' +
			'optimism/bsc. No calldata, no execution, no key; 30/min per IP.',
		params: {
			chain: 'string: chain name, alias, or numeric id (ethereum | base | polygon | arbitrum | optimism | bsc), required',
			sellToken: 'string: 0x… token address to sell; 0xeeee…eeee for the native coin (required)',
			buyToken: 'string: 0x… token address to buy (required)',
			amount: 'string: sell amount in raw base units, integer string (required)',
		},
	},
	{
		id: 'v1.robinhood.chain',
		method: 'GET',
		path: '/api/v1/robinhood/chain',
		auth: 'public',
		summary:
			'Robinhood Chain (4663) stats: block height, gas, tx/address counts, and chain TVL ' +
			'(now + 90-day history). Free, keyless, real data from Blockscout + DefiLlama; 60/min per IP.',
		params: {},
	},
	{
		id: 'v1.robinhood.stocks',
		method: 'GET',
		path: '/api/v1/robinhood/stocks',
		auth: 'public',
		summary:
			'The 24/7 Robinhood Chain tokenized-equity board: live Chainlink NAV vs. deepest Uniswap ' +
			'DEX price, premium/discount, uiMultiplier, 24h volume, and liquidity for every Stock ' +
			'Token: one on-chain multicall, never 95 RPC calls. Free, keyless; 60/min per IP.',
		params: {
			q: 'string: filter by symbol or name substring (optional)',
			sort: 'string: "symbol" | "volume" | "premium" | "liquidity" (default symbol)',
			dir: 'string: "asc" | "desc" (default desc, ignored for symbol)',
		},
	},
	{
		id: 'v1.robinhood.stocks-detail',
		method: 'GET',
		path: '/api/v1/robinhood/stocks-detail',
		auth: 'public',
		summary:
			'One Robinhood Chain Stock Token in depth: Chainlink NAV + recent round history, every ' +
			'DEX pair, premium/discount, holders, recent transfers, and contract links. Display-only ' +
			'- carries the US-persons eligibility disclosure. Free, keyless; 60/min per IP.',
		params: { symbol: 'string: Stock Token ticker, e.g. "AAPL" (required)' },
	},
	{
		id: 'v1.robinhood.coins',
		method: 'GET',
		path: '/api/v1/robinhood/coins',
		auth: 'public',
		summary:
			'Robinhood Chain memecoin screener (NOXA + The Odyssey launchpads) via CoinGecko ' +
			'categories: price, market cap, 24h/7d change, 7d sparkline. Free, keyless; 60/min per IP.',
		params: {
			category: 'string: "meme" | "stocks-ecosystem" | "ecosystem" (default meme)',
			sort: 'string: "market_cap" | "volume" | "gainers" | "losers" (default market_cap)',
		},
	},
	{
		id: 'v1.robinhood.coins-detail',
		method: 'GET',
		path: '/api/v1/robinhood/coins-detail',
		auth: 'public',
		summary:
			'One Robinhood Chain coin in depth: DexScreener market data (price, mcap, FDV, ' +
			'liquidity, volume, pools) + Blockscout holders/transfers/contract links. Non-security ' +
			'token, no eligibility gate. Free, keyless; 60/min per IP.',
		params: { address: 'string: 0x… token contract address (required)' },
	},
	{
		id: 'v1.robinhood.launches',
		method: 'GET',
		path: '/api/v1/robinhood/launches',
		auth: 'public',
		summary:
			'Recent Robinhood Chain launchpad activity (NOXA instant + The Odyssey bonding-curve), ' +
			'read from on-chain logs and enriched with DexScreener market data, newest first. ' +
			'Free, keyless; 60/min per IP.',
		params: { limit: 'number 1-60 (default 40)' },
	},
	{
		id: 'v1.pump.search',
		method: 'GET',
		path: '/api/v1/pump/search',
		auth: 'public',
		summary:
			'Free text search over Solana pump.fun / meme tokens by name, symbol, or mint (Birdeye-first, ' +
			'pump.fun-fallback). Pairs with trending/curve/launches/whales below to round out the free ' +
			'pump.fun family under /api/v1. No key; 60/min per IP.',
		params: {
			q: 'string: token name, symbol, or mint to search for (required)',
			limit: 'number 1-20 (default 8)',
		},
	},
	{
		id: 'v1.pump.trending',
		method: 'GET',
		path: '/api/v1/pump/trending',
		auth: 'public',
		summary:
			'Free, momentum-ranked "what\'s hot right now" feed for Solana tokens, fuses windowed volume, ' +
			'buy pressure, a volume-spike signal, and price change across pump.fun, DexScreener, and ' +
			'(best-effort) GMGN smart money into one 0-100 score. Same engine as GET /api/crypto/trending, ' +
			'capped slimmer for this door. No key; 60/min per IP.',
		params: {
			window: 'string: "5m" | "1h" | "24h" (default "1h"), trade window the score measures',
			limit: 'number 1-25 (default 20)',
			source: 'string: "pumpfun" | "all" (default "all"), "pumpfun" restricts to the pump.fun board',
		},
	},
	{
		id: 'v1.pump.curve',
		method: 'GET',
		path: '/api/v1/pump/curve',
		auth: 'public',
		summary:
			'Free bonding-curve / graduation status for a pump.fun mint, % to graduation, SOL in the ' +
			'curve, tokens remaining, market cap, and whether it has migrated to an AMM (Raydium / ' +
			'PumpSwap). Same engine as GET /api/crypto/bonding. No key; 60/min per IP.',
		params: {
			mint: 'string: base58 Solana pump.fun mint address (required), e.g. FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump ($THREE)',
		},
	},
	{
		id: 'v1.pump.launches',
		method: 'GET',
		path: '/api/v1/pump/launches',
		auth: 'public',
		summary:
			'Free, paginated feed of every coin launched THROUGH three.ws (not a generic pump.fun-wide ' +
			'feed: the platform\'s own launch directory), joined with the launching agent. Same query as ' +
			'the /launches page. No key; 60/min per IP.',
		params: {
			limit: 'number 1-100 (default 24)',
			offset: 'number (default 0)',
			network: 'string: "mainnet" | "devnet" (default "mainnet")',
			agent_id: 'string: uuid, restrict to one launching agent (optional)',
			min_tier: 'string: "prime" | "strong" | "lean" | "watch" | "avoid", oracle conviction floor (optional)',
		},
	},
	{
		id: 'v1.tokenized.launches',
		method: 'GET',
		path: '/api/v1/tokenized/launches',
		auth: 'public',
		summary:
			'Free, paginated feed of every generated 3D asset minted as a Metaplex Core NFT THROUGH ' +
			'three.ws: the NFT analogue of GET /api/v1/pump/launches. Each entry carries baked ' +
			'provenance, royalty terms, remix lineage (parent_mint), and, for a remix, the real ' +
			'royalty settlement routed to the source creator. No key; 60/min per IP.',
		params: {
			limit: 'number 1-100 (default 24)',
			offset: 'number (default 0)',
			network: 'string: "mainnet" | "devnet" (default "mainnet")',
			agent_id: 'string: uuid, restrict to one creating agent (optional)',
		},
	},
	{
		id: 'v1.pump.whales',
		method: 'GET',
		path: '/api/v1/pump/whales',
		auth: 'public',
		summary:
			'Free whale / large-buy detection across pump.fun, facts only (which wallets moved how much ' +
			'SOL, and when), no invented bullish/bearish signal. The read version of the whale-activity ' +
			'oracle behind the paid /api/x402/pump-agent-audit; same scan engine as GET /api/crypto/whales. ' +
			'No key; 60/min per IP.',
		params: {
			mint: 'string: base58 Solana mint; omit for market-wide top whale wallets, or scope to one token (optional)',
			limit: 'number 1-25 (default 5)',
			minSol: 'number: single-buy SOL threshold to qualify as a whale (default 5)',
		},
	},
	{
		id: 'v1.agents.signup',
		method: 'POST',
		path: '/api/v1/agents/signup',
		auth: 'public',
		summary:
			'Agent self-signup. Sign a short message with an Ed25519 key (a Solana wallet key works) and get ' +
			'an agent with custodial wallets and an API key, shown once. The agent starts in paper mode with ' +
			'strict caps until a human claims it. Replay-safe (nonce per key), 300s clock window, 5/h per IP ' +
			'and 10/h per key.',
		params: {
			public_key: 'string: base58 Ed25519 public key (required)',
			name: 'string 1-100 chars: requested agent name (required)',
			timestamp: 'number: unix seconds, within 300s of server time (required)',
			nonce: 'string 16-64 chars [A-Za-z0-9_-]: single use per key (required)',
			signature: 'string: base58 signature over the signup message (required)',
		},
	},
	{
		id: 'v1.agents.claim',
		method: 'POST',
		path: '/api/v1/agents/claim',
		auth: 'required',
		scope: 'agents:write',
		summary:
			'A signed-in human claims a self-signed agent with its one-time claim code. Ownership moves to ' +
			'the caller, the agent signup key is revoked, and the freeze lifts; numeric caps and the live-perps ' +
			'lock stay until the owner raises them.',
		params: { code: 'string: the claim code returned by signup (required)' },
	},
	{
		id: 'v1.capabilities',
		method: 'GET',
		path: '/api/v1/capabilities',
		auth: 'public',
		summary:
			'Every tool by group with prices, tier and confirm rules, plan limits and approval rules, ' +
			'generated from the policy registry. Not the scoped-session-key endpoint at /api/agents/capabilities.',
		params: {},
	},
	// Solana trading tools: the same definitions the threews-agent MCP server
	// serves (api/_lib/trading-tools/registry.js). Docs: /docs/trading-tools.
	{
		id: 'v1.trading.index',
		method: 'GET',
		path: '/api/v1/trading',
		auth: 'public',
		summary: 'Every trading tool with its method, path, auth, tier and JSON input schema, plus the matching MCP server and group.',
		params: {},
	},
	{
		id: 'v1.trading.token_search',
		method: 'GET',
		path: '/api/v1/trading/tokens/search',
		auth: 'public',
		summary: 'Find Solana tokens by name, symbol or mint, with verification, liquidity and a best match.',
		params: { query: 'string: name, symbol or mint (required)', limit: 'number 1-20 (default 5)' },
	},
	{
		id: 'v1.trading.get_price',
		method: 'GET',
		path: '/api/v1/trading/price',
		auth: 'public',
		summary: 'Live USD price for one token, with its source and timestamp.',
		params: { mint: 'string: mint, symbol or SOL / USDC (required)' },
	},
	{
		id: 'v1.trading.get_indicators',
		method: 'GET',
		path: '/api/v1/trading/indicators',
		auth: 'public',
		summary: 'Technical indicators over live OHLCV candles for one token: latest value, trailing series and the last candle time.',
		params: {
			mint: 'string: token (required)',
			indicators: 'comma list of indicator names (default all)',
			interval: 'string: candle interval (default 1h)',
			period: 'number 2-200 (default 14)',
		},
	},
	{
		id: 'v1.trading.get_market_signals',
		method: 'GET',
		path: '/api/v1/trading/signals',
		auth: 'public',
		summary:
			'With mint: that token\'s live signals. Without: the Solana ecosystem view (macro, top movers, anomalies) ' +
			'derived from the pump feed, dex trades and smart-money flow, every signal with its inputs and timestamp.',
		params: {
			mint: 'string: token (optional; omit for the ecosystem view)',
			network: 'string: mainnet | devnet (default mainnet)',
			window: 'string: 15m | 1h | 6h | 24h (default 1h)',
			sections: 'comma list: macro, movers, anomalies (default all)',
		},
	},
	{
		id: 'v1.trading.get_news_feed',
		method: 'GET',
		path: '/api/v1/trading/news',
		auth: 'public',
		summary: 'Recent crypto news, optionally for one token or category, with source and publish time.',
		params: { token: 'string: symbol or mint (optional)', category: 'string (optional)', limit: 'number 1-50 (default 15)' },
	},
	{
		id: 'v1.trading.arbitrage_prices',
		method: 'GET',
		path: '/api/v1/trading/arbitrage/prices',
		auth: 'public',
		summary: 'Buy and sell price for a pair on every Solana venue that can fill it at this size, and the widest spread.',
		params: { token: 'string (required)', quote: 'string: SOL | USDC | mint (default SOL)', amount: 'number: quote-token size (default 1)' },
	},
	{
		id: 'v1.trading.arbitrage_quote',
		method: 'GET',
		path: '/api/v1/trading/arbitrage/quote',
		auth: 'public',
		summary:
			'Best two-leg route with expected profit after fees, a verdict and a simulated worst case. The legs are not ' +
			'atomic; sizes above $100 are refused unless accept_size_risk, and above $1000 always. Never executes.',
		params: {
			token: 'string (required)',
			quote: 'string: SOL | USDC | mint (default SOL)',
			amount: 'number: quote-token size (default 1)',
			accept_size_risk: 'boolean: quote between the $100 default cap and the $1000 ceiling',
		},
	},
	{
		id: 'v1.trading.swap_quote',
		method: 'POST',
		path: '/api/v1/trading/swap/quote',
		auth: 'optional',
		scope: 'wallet:read',
		summary:
			'Compare every swap aggregator for a Solana trade and rank them by net output after fees and price impact. ' +
			'With agent_id it also runs the trade guards and returns a confirmation table and a quote_id valid for 5 minutes.',
		params: {
			input_mint: 'string (required)',
			output_mint: 'string (required)',
			amount: 'number: input-token amount (or amount_raw)',
			amount_raw: 'string: base units (or amount)',
			dex: 'string: auto | jupiter | lifi | raydium | dex:<label> (default auto)',
			slippage_bps: 'number (default 100)',
			agent_id: 'string: uuid of your agent; required for a quote_id',
		},
	},
	{
		id: 'v1.trading.swap_simulate',
		method: 'POST',
		path: '/api/v1/trading/swap/simulate',
		auth: 'required',
		scope: 'wallet:read',
		summary: 'Dry-run a swap_quote on chain through the guarded executor without signing. The quote_id stays valid.',
		params: { quote_id: 'string: from swap_quote (required)' },
	},
	{
		id: 'v1.trading.swap_execute',
		method: 'POST',
		path: '/api/v1/trading/swap/execute',
		auth: 'required',
		scope: 'wallet:trade',
		summary:
			'Execute a swap_quote from the agent wallet through the guarded executor (slippage clamp, price-impact breaker, ' +
			'rug firewall, spend caps, idempotency). Re-prices first and refuses a quote that moved below the approved minimum.',
		params: { quote_id: 'string: from swap_quote (required)', confirm_swap: 'true, after the user approved the table (required)' },
	},
];
