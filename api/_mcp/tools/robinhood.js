// Robinhood Chain (4663) read-only MCP tools: chain stats, token prices, recent
// launchpad launches and a wallet's holdings. Every tool is a thin front door
// onto api/_lib/robinhood.js (the same module behind /api/v1/robinhood/*), so
// the MCP surface shares its RPC failover list, caches and Chainlink/DexScreener
// readers with the REST surface and never opens a second chain client.
//
// Nothing here signs, sends or writes: all four are readOnlyHint tools.

import {
	asOf,
	blockscoutAddressTokens,
	blockscoutStats,
	chainTvlCurrent,
	chainlinkSnapshot,
	dexSnapshot,
	erc20Metadata,
	findStock,
	publicClient,
	recentLaunches,
	stockRegistry,
} from '../../_lib/robinhood.js';
import { normalizeAddress, toUnits } from '../../_lib/robinhood-desk.js';
import { clientIp, limits } from '../../_lib/rate-limit.js';

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

const ADDRESS = { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$', description: 'A 20-byte Robinhood Chain (4663) address.' };

function ok(structured) {
	return { content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }], structuredContent: structured };
}

function bad(error, message) {
	return { content: [{ type: 'text', text: `Error (${error}): ${message}` }], structuredContent: { error, message }, isError: true };
}

// Same 60/min per-IP bucket the REST surface uses. `req` is absent under
// non-HTTP dispatch (unit tests), where there is no IP to meter.
async function metered(req) {
	if (!req) return null;
	const rl = await limits.robinhoodRead(clientIp(req));
	return rl.success ? null : bad('rate_limited', 'Robinhood Chain data is capped at 60 requests/min per IP.');
}

const num = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);

async function chainStats() {
	const [stats, tvl, blockNumber] = await Promise.all([
		blockscoutStats().catch(() => null),
		chainTvlCurrent().catch(() => null),
		publicClient(false)
			.getBlockNumber()
			.then((n) => Number(n))
			.catch(() => null),
	]);
	const s = stats && !stats.__error ? stats : null;
	return {
		chain: { name: 'Robinhood Chain', chainId: 4663, type: 'Arbitrum Orbit L2', gasToken: 'ETH', explorer: 'https://robinhoodchain.blockscout.com' },
		blockHeight: blockNumber ?? (s?.total_blocks ? Number(s.total_blocks) : null),
		averageBlockTimeMs: num(s?.average_block_time),
		totalTransactions: s?.total_transactions ?? null,
		totalAddresses: s?.total_addresses ?? null,
		gasGwei: s?.gas_prices ? { slow: s.gas_prices.slow ?? null, average: s.gas_prices.average ?? null, fast: s.gas_prices.fast ?? null } : null,
		ethPriceUsd: num(s?.coin_price),
		tvl,
		asOf: asOf(),
	};
}

async function tokenPrices({ symbols = [], addresses = [] }) {
	const wanted = new Map();
	const unknown = [];
	for (const sym of symbols) {
		const stock = findStock(sym);
		if (stock) wanted.set(stock.address.toLowerCase(), stock);
		else unknown.push(sym);
	}
	const invalid = [];
	for (const a of addresses) {
		const addr = normalizeAddress(a);
		if (!addr) invalid.push(a);
		else if (!wanted.has(addr)) {
			const stock = stockRegistry().tokens.find((t) => t.address.toLowerCase() === addr);
			wanted.set(addr, stock || null);
		}
	}
	const list = [...wanted.keys()];
	const [nav, dex] = await Promise.all([
		[...wanted.values()].some((s) => s?.feed) ? chainlinkSnapshot().catch(() => ({})) : {},
		dexSnapshot(list).catch(() => ({})),
	]);
	const prices = list.map((address) => {
		const stock = wanted.get(address);
		const feed = stock ? nav[address] || null : null;
		const pair = dex[address] || null;
		const navPriceUsd = feed?.priceUsd ?? null;
		const dexPriceUsd = num(pair?.priceUsd);
		return {
			address,
			symbol: stock?.symbol || pair?.baseToken?.symbol || null,
			name: stock?.name || pair?.baseToken?.name || null,
			kind: stock ? 'stock-token' : 'coin',
			priceUsd: navPriceUsd ?? dexPriceUsd,
			priceSource: navPriceUsd != null ? 'chainlink-nav' : dexPriceUsd != null ? 'dex' : null,
			navPriceUsd,
			navUpdatedAt: feed?.updatedAt ?? null,
			dexPriceUsd,
			change24hPct: num(pair?.priceChange?.h24),
			liquidityUsd: num(pair?.liquidity?.usd),
			volume24hUsd: num(pair?.volume?.h24),
		};
	});
	return { prices, notFound: { symbols: unknown, invalidAddresses: invalid }, asOf: asOf() };
}

async function walletHoldings({ address }) {
	const owner = normalizeAddress(address);
	const [nativeWei, balances] = await Promise.all([
		publicClient(false).getBalance({ address: owner }).then((v) => v.toString()).catch(() => null),
		blockscoutAddressTokens(owner).catch(() => []),
	]);
	const held = balances
		.map((b) => ({
			address: normalizeAddress(b?.token?.address_hash || b?.token?.address),
			raw: b?.value ?? null,
			type: b?.token?.type || 'ERC-20',
			decimals: b?.token?.decimals != null ? Number(b.token.decimals) : null,
			symbol: b?.token?.symbol || null,
			name: b?.token?.name || null,
		}))
		.filter((t) => t.address && t.raw && t.type === 'ERC-20');

	const gaps = held.filter((t) => t.decimals == null || !t.symbol).map((t) => t.address);
	const stockByAddress = new Map(stockRegistry().tokens.map((t) => [t.address.toLowerCase(), t]));
	const [meta, dex, nav] = await Promise.all([
		erc20Metadata(gaps).catch(() => ({})),
		dexSnapshot(held.map((t) => t.address)).catch(() => ({})),
		held.some((t) => stockByAddress.has(t.address)) ? chainlinkSnapshot().catch(() => ({})) : {},
	]);

	const positions = held.map((t) => {
		const fallback = meta[t.address] || {};
		const decimals = t.decimals ?? fallback.decimals ?? null;
		const stock = stockByAddress.get(t.address) || null;
		const feed = stock ? nav[t.address] || null : null;
		const pair = dex[t.address] || null;
		// ERC-8056: a Stock Token's true position is raw x uiMultiplier / 1e18; its
		// Chainlink NAV is already multiplier-adjusted, so the multiplier touches
		// the balance once and never the price.
		const rawUnits = decimals != null ? toUnits(t.raw, decimals) : null;
		const multiplier = feed?.uiMultiplier ? Number(feed.uiMultiplier) / 1e18 : 1;
		const amount = rawUnits != null ? rawUnits * multiplier : null;
		const navPriceUsd = feed?.priceUsd ?? null;
		const dexPriceUsd = num(pair?.priceUsd);
		const priceUsd = navPriceUsd ?? dexPriceUsd;
		return {
			address: t.address,
			symbol: t.symbol || fallback.symbol || pair?.baseToken?.symbol || null,
			name: t.name || fallback.name || pair?.baseToken?.name || null,
			kind: stock ? 'stock-token' : 'coin',
			rawBalance: String(t.raw),
			decimals,
			amount,
			priceUsd,
			priceSource: navPriceUsd != null ? 'chainlink-nav' : dexPriceUsd != null ? 'dex' : null,
			valueUsd: amount != null && priceUsd != null ? amount * priceUsd : null,
		};
	});
	positions.sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));
	return {
		address: owner,
		nativeEth: nativeWei != null ? { wei: nativeWei, amount: toUnits(nativeWei, 18) } : null,
		positions,
		pricedValueUsd: positions.reduce((sum, p) => sum + (p.valueUsd || 0), 0),
		unpricedCount: positions.filter((p) => p.valueUsd == null).length,
		asOf: asOf(),
	};
}

export const toolDefs = [
	{
		name: 'robinhood_chain_stats',
		title: 'Robinhood Chain stats',
		group: 'robinhood',
		annotations: READ,
		description:
			'Live Robinhood Chain (chain id 4663, an Arbitrum Orbit L2 with ETH gas) health: current block height read from the chain RPC, average block time, total transactions and addresses, gas prices in gwei, the ETH price and chain TVL. Use this to check the chain is up or to get a block number.',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
		async handler(_args, _auth, req) {
			const blocked = await metered(req);
			return blocked || ok(await chainStats());
		},
	},
	{
		name: 'robinhood_token_prices',
		title: 'Robinhood Chain token prices',
		group: 'robinhood',
		annotations: READ,
		description:
			'Live USD prices for tokens on Robinhood Chain. Pass registry Stock Token tickers in symbols (priced from the Chainlink NAV feed, uiMultiplier-correct) and/or any token contract addresses (priced from the deepest DEX pool). Each price reports its source, 24h change and pool liquidity; a token with no feed and no pool comes back with a null price, never a guess. Use this when you need current USD prices for Stock Tokens or other tokens on Robinhood Chain.',
		inputSchema: {
			type: 'object',
			properties: {
				symbols: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 16 }, maxItems: 30, description: 'Stock Token tickers, for example ["AAPL","TSLA"].' },
				addresses: { type: 'array', items: ADDRESS, maxItems: 30, description: 'Token contract addresses.' },
			},
			additionalProperties: false,
		},
		async handler(args, _auth, req) {
			const symbols = args.symbols || [];
			const addresses = args.addresses || [];
			if (!symbols.length && !addresses.length) return bad('missing_input', 'Pass at least one ticker in symbols or one contract address in addresses.');
			const blocked = await metered(req);
			return blocked || ok(await tokenPrices({ symbols, addresses }));
		},
	},
	{
		name: 'robinhood_recent_launches',
		title: 'Recent Robinhood Chain launches',
		group: 'robinhood',
		annotations: READ,
		description:
			'The newest coins launched on Robinhood Chain launchpads (The Odyssey bonding curves), newest first, read from the factory contracts via the indexer. Each row has the token, launchpad, block and transaction. For every venue with deployer and dev-sold flags use /api/v1/robinhood/launches. Use this to see which coins just launched on Robinhood Chain launchpads.',
		inputSchema: {
			type: 'object',
			properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
			additionalProperties: false,
		},
		async handler(args, _auth, req) {
			const blocked = await metered(req);
			if (blocked) return blocked;
			const launches = await recentLaunches({ limit: args.limit || 20 });
			return ok({ launches, count: launches.length, asOf: asOf() });
		},
	},
	{
		name: 'robinhood_wallet_holdings',
		title: 'Robinhood Chain wallet holdings',
		group: 'robinhood',
		annotations: READ,
		description:
			'Everything a wallet holds on Robinhood Chain: native ETH plus every ERC-20, priced from the Chainlink NAV (Stock Tokens, multiplier-correct per ERC-8056) or the deepest DEX pool. Unpriced tokens are listed with a null value and counted in unpricedCount, never valued at zero. Read-only: any public address can be inspected, no signature needed. Use this when you need a priced balance sheet of everything an address holds on Robinhood Chain.',
		inputSchema: { type: 'object', properties: { address: ADDRESS }, required: ['address'], additionalProperties: false },
		async handler(args, _auth, req) {
			if (!normalizeAddress(args.address)) return bad('invalid_address', 'address must be a 20-byte 0x-prefixed Robinhood Chain address.');
			const blocked = await metered(req);
			return blocked || ok(await walletHoldings(args));
		},
	},
];
