// GET /api/v1/robinhood/launches — recent launchpad activity on Robinhood Chain.
//
// Free, keyless. Newest token launches from Pons V2 (the chain's busiest
// launchpad: ETH bonding curve graduating into a locked Uniswap V4 pool), read
// over RPC from its factory's TokenLaunched logs, and The Odyssey from
// Blockscout's decoded-log API. The robinhood-feed worker adds every other
// launch venue observed on chain and grades each deployer: venue, prior
// launches, prior dev exits, a dev-sold flag. Each source fails independently,
// so one outage never empties the board. Enriched with DexScreener market data
// where a pool already exists. Newest first.

import { defineEndpoint } from '../../_lib/gateway.js';
import { rateLimited } from '../../_lib/http.js';
import { limits } from '../../_lib/rate-limit.js';
import { recentLaunches, dexSnapshot, BLOCKSCOUT_BASE, asOf } from '../../_lib/robinhood.js';
import { recentPonsLaunches } from '../../_lib/pons.js';
import { recentFeedLaunches } from '../../_lib/robinhood-feed.js';
import { fetchCoinPriceUsdOrNull } from '../../_lib/market-fallbacks.js';

const gradingOf = ({ venue, deployerRecord, devSold, devSoldPct, flags }) => ({ venue, deployerRecord, devSold, devSoldPct, flags });

const CACHE_CONTROL = 'public, max-age=30, s-maxage=30, stale-while-revalidate=45';

export default defineEndpoint({
	name: 'v1.robinhood.launches',
	method: 'GET',
	auth: 'public',
	handler: async ({ res, query, ip }) => {
		const rl = await limits.robinhoodRead(ip);
		if (!rl.success) return rateLimited(res, rl, 'Robinhood Chain data is capped at 60 requests/min per IP');

		const limit = Math.min(60, Math.max(1, Number(query.limit) || 40));
		const [pons, others, feed] = await Promise.all([
			recentPonsLaunches({ limit }).catch((err) => {
				console.error('[v1/robinhood/launches] pons read failed', err?.shortMessage || err?.message);
				return [];
			}),
			recentLaunches({ limit }).catch((err) => {
				console.error('[v1/robinhood/launches] blockscout read failed', err?.message);
				return [];
			}),
			recentFeedLaunches({ limit }).catch((err) => {
				console.error('[v1/robinhood/launches] feed worker read failed', err?.message);
				return [];
			}),
		]);
		// The worker's rows carry venue and reputation; the Pons and Odyssey rows
		// carry curve price and progress. Where both saw a token, keep the richer
		// market row and overlay the worker's grading onto it.
		const byToken = new Map([...pons, ...others].map((l) => [l.token.toLowerCase(), l]));
		for (const f of feed) {
			const key = f.token.toLowerCase();
			byToken.set(key, byToken.has(key) ? { ...byToken.get(key), ...gradingOf(f) } : f);
		}
		const launches = [...byToken.values()].sort((a, b) => b.block - a.block).slice(0, limit);
		const [dex, ethUsd] = await Promise.all([
			dexSnapshot(launches.map((l) => l.token)),
			launches.some((l) => l.priceEth != null) ? fetchCoinPriceUsdOrNull('ethereum') : null,
		]);

		const enriched = launches.map((l) => {
			const pair = dex[l.token.toLowerCase()] || null;
			// A bonding-curve coin has no DEX pair until it graduates; its price is
			// the curve's own marginal price, and its market cap prices the full
			// fixed supply the token reports on chain.
			const curveUsd = !pair && l.priceEth != null && ethUsd != null ? l.priceEth * ethUsd : null;
			return {
				launchpad: l.launchpad,
				type: l.type,
				token: l.token,
				venue: l.venue ?? null,
				deployer: l.deployer,
				deployerRecord: l.deployerRecord ?? null,
				devSold: l.devSold ?? null,
				devSoldPct: l.devSoldPct ?? null,
				flags: l.flags ?? [],
				block: l.block,
				txHash: l.txHash,
				timestamp: l.timestamp,
				symbol: pair?.baseToken?.symbol || l.symbol || null,
				name: pair?.baseToken?.name || l.name || null,
				priceUsd: pair?.priceUsd != null ? Number(pair.priceUsd) : curveUsd,
				marketCapUsd: pair?.marketCap ?? (curveUsd != null && l.totalSupply != null ? curveUsd * l.totalSupply : null),
				graduationPct: l.progressPct ?? null,
				liquidityUsd: pair?.liquidity?.usd ?? null,
				volume24hUsd: pair?.volume?.h24 ?? null,
				hasMarket: Boolean(pair),
				links: {
					token: `${BLOCKSCOUT_BASE}/token/${l.token}`,
					tx: l.txHash ? `${BLOCKSCOUT_BASE}/tx/${l.txHash}` : null,
					launchpad: l.url || null,
				},
			};
		});

		res.setHeader('cache-control', CACHE_CONTROL);
		return {
			launches: enriched,
			count: enriched.length,
			launchpads: [
				{ name: 'Pons', style: 'bonding-curve', url: 'https://ponsfamily.com' },
				{ name: 'The Odyssey', style: 'bonding-curve', url: 'https://theodyssey.fun' },
				{ name: 'Other venues', style: 'discovered on chain', url: null },
			],
			source: 'rpc (Pons factory logs, mint-log venue scan) + blockscout (on-chain logs) + dexscreener',
			asOf: asOf(),
		};
	},
});
