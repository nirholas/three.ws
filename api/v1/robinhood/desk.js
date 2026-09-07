// GET /api/v1/robinhood/desk - the market side of the Hood Desk.
//
// Free, keyless. One composed read so the desk boots with a single request
// instead of five: chain vitals (Blockscout + DefiLlama), the liquidity-depth
// ridge of Stock Token premium vs Chainlink NAV (one on-chain multicall plus a
// batched DexScreener snapshot), the widest tradeable dislocations, memecoin
// movers, and the newest launchpad tokens. The wallet side lives in
// api/v1/robinhood/wallet.js so this response stays publicly cacheable.

import { defineEndpoint } from '../../_lib/gateway.js';
import { rateLimited } from '../../_lib/http.js';
import { limits } from '../../_lib/rate-limit.js';
import {
	stockRegistry,
	chainlinkSnapshot,
	dexSnapshot,
	blockscoutStats,
	chainTvlCurrent,
	coingeckoCategory,
	recentLaunches,
	publicClient,
	premiumPct,
	asOf,
} from '../../_lib/robinhood.js';
import { premiumRidge, arbLeaders } from '../../_lib/robinhood-desk.js';

const CACHE_CONTROL = 'public, max-age=20, s-maxage=20, stale-while-revalidate=40';
const DISCLOSURE =
	'Stock Tokens are tokenized debt securities issued by Robinhood Assets (Jersey) Ltd and may not be offered, sold, or delivered to US persons. The desk displays them; it never routes an order into one.';

export default defineEndpoint({
	name: 'v1.robinhood.desk',
	method: 'GET',
	auth: 'public',
	handler: async ({ res, ip }) => {
		const rl = await limits.robinhoodRead(ip);
		if (!rl.success) return rateLimited(res, rl, 'Robinhood Chain data is capped at 60 requests/min per IP');

		const reg = stockRegistry();
		const addresses = reg.tokens.map((t) => t.address);
		// Every upstream is independent, and each one that fails degrades only
		// its own panel: the desk renders the vitals it got rather than 500ing
		// because DefiLlama was slow.
		const [nav, dex, stats, tvl, blockNumber, launches, memes] = await Promise.all([
			chainlinkSnapshot().catch(() => ({})),
			dexSnapshot(addresses).catch(() => ({})),
			blockscoutStats().catch(() => null),
			chainTvlCurrent().catch(() => null),
			publicClient(false).getBlockNumber().then((n) => Number(n)).catch(() => null),
			recentLaunches({ limit: 8 }).catch(() => []),
			coingeckoCategory('robinhood-chain-meme', { order: 'volume_desc', perPage: 60 }).catch(() => []),
		]);

		const rows = reg.tokens.map((t) => {
			const addrLc = t.address.toLowerCase();
			const feed = nav[addrLc] || null;
			const pair = dex[addrLc] || null;
			const navPrice = feed?.priceUsd ?? null;
			const dexPrice = pair?.priceUsd != null ? Number(pair.priceUsd) : null;
			return {
				symbol: t.symbol,
				name: (t.name || '').replace(' • Robinhood Token', ''),
				address: t.address,
				navPriceUsd: navPrice,
				dexPriceUsd: dexPrice,
				premiumPct: premiumPct(dexPrice, navPrice),
				liquidityUsd: pair?.liquidity?.usd ?? null,
				volume24hUsd: pair?.volume?.h24 ?? null,
				priceChange24hPct: pair?.priceChange?.h24 ?? null,
			};
		});

		// CoinGecko returns 168 hourly points per coin; 12 coins of that is most
		// of the response weight for a rail that draws a 90px sparkline. Every
		// third point keeps the shape at a quarter of the bytes.
		const thin = (arr, step = 3) => (Array.isArray(arr) ? arr.filter((_, i) => i % step === 0) : null);

		const movers = memes
			.map((c) => ({
				id: c.id,
				symbol: (c.symbol || '').toUpperCase(),
				name: c.name,
				image: c.image || null,
				priceUsd: c.current_price ?? null,
				marketCapUsd: c.market_cap ?? null,
				volume24hUsd: c.total_volume ?? null,
				change24hPct:
					c.price_change_percentage_24h_in_currency ?? c.price_change_percentage_24h ?? null,
				sparkline7d: thin(c.sparkline_in_7d?.price),
			}))
			.filter((c) => Number.isFinite(c.change24hPct))
			.sort((a, b) => Math.abs(b.change24hPct) - Math.abs(a.change24hPct))
			.slice(0, 12);

		const gasPrices = stats && !stats.__error ? stats.gas_prices || null : null;
		res.setHeader('cache-control', CACHE_CONTROL);
		return {
			chain: {
				name: 'Robinhood Chain',
				chainId: 4663,
				blockHeight: blockNumber ?? (stats?.total_blocks ? Number(stats.total_blocks) : null),
				averageBlockTimeMs: stats && !stats.__error ? stats.average_block_time ?? null : null,
				totalTransactions: stats && !stats.__error ? stats.total_transactions ?? null : null,
				gas: gasPrices
					? { slow: gasPrices.slow ?? null, average: gasPrices.average ?? null, fast: gasPrices.fast ?? null, unit: 'gwei' }
					: null,
				ethPriceUsd: stats && !stats.__error && stats.coin_price ? Number(stats.coin_price) : null,
				tvlUsd: tvl ?? null,
				explorer: 'https://robinhoodchain.blockscout.com',
			},
			ridge: premiumRidge(rows),
			arb: arbLeaders(rows),
			movers,
			launches,
			stockCount: rows.length,
			disclosure: DISCLOSURE,
			source: 'chainlink (on-chain) + dexscreener + blockscout + defillama + coingecko',
			asOf: asOf(),
		};
	},
});
