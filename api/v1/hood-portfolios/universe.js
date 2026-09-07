// GET /api/v1/hood-portfolios/universe: every token a portfolio may hold.
//
// Free and keyless. The committed snapshot (data/hood-portfolios-universe.json) fixes
// which tokens exist; price, liquidity and 24h volume are read live on every
// request, so nothing served here is a stale number from build time.
//
// Query:
//   class=rwa-equity,crypto-major,crypto-native,stablecoin   filter by asset class
//   minLiquidity=25000                                        floor on live USD liquidity
//   limit=100                                                 cap the rows returned
//   selectable=1                                              only what a portfolio may hold

import { defineEndpoint, fail } from '../../_lib/gateway.js';
import { rateLimited } from '../../_lib/http.js';
import { limits } from '../../_lib/rate-limit.js';
import {
	ASSET_CLASSES,
	MIN_CONSTITUENT_LIQUIDITY_USD,
	liveUniverse,
	selectableUniverse,
} from '../../_lib/hood-portfolios.js';

const CACHE_CONTROL = 'public, max-age=30, s-maxage=30, stale-while-revalidate=60';

export default defineEndpoint({
	name: 'v1.hood-portfolios.universe',
	method: 'GET',
	auth: 'public',
	handler: async ({ res, query, ip }) => {
		const rl = await limits.robinhoodRead(ip);
		if (!rl.success) return rateLimited(res, rl, 'Robinhood Chain data is capped at 60 requests/min per IP');

		const classes = String(query.class || '')
			.split(',')
			.map((c) => c.trim())
			.filter(Boolean);
		for (const c of classes) {
			if (!ASSET_CLASSES.includes(c)) {
				fail(400, 'bad_class', `unknown asset class "${c}", expected one of ${ASSET_CLASSES.join(', ')}`);
			}
		}

		const limit = Math.min(Number(query.limit) || 0, 1000);
		const selectable = query.selectable === '1' || query.selectable === 'true';
		const minLiquidityUsd = selectable
			? MIN_CONSTITUENT_LIQUIDITY_USD
			: Math.max(0, Number(query.minLiquidity) || 0);

		const data = selectable && !classes.length && !limit
			? await selectableUniverse()
			: await liveUniverse({ minLiquidityUsd, classes: classes.length ? classes : null, limit });

		res.setHeader('Cache-Control', CACHE_CONTROL);
		return {
			...data,
			assetClasses: ASSET_CLASSES,
			minConstituentLiquidityUsd: MIN_CONSTITUENT_LIQUIDITY_USD,
		};
	},
});
