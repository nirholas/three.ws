// GET /api/v1/robinhood/paired-markets: what a paired coin can trade against.
//
// Free, keyless. Every quote asset registered on the paired launchpad
// (tokenized stocks, WETH, stablecoins, chain coins), read live from the
// contract's quote registry, with its class, live USD price, and the dollar
// market cap a pool in it opens at. Plus the launchpad's live terms.

import { defineEndpoint } from '../../_lib/gateway.js';
import { rateLimited } from '../../_lib/http.js';
import { limits } from '../../_lib/rate-limit.js';
import { asOf } from '../../_lib/robinhood.js';
import { launchpadConfig } from '../../_lib/paired-launchpad.js';
import { CLASS_LABELS, pairedMarkets } from '../../_lib/paired-markets.js';

const CACHE_CONTROL = 'public, max-age=30, s-maxage=30, stale-while-revalidate=60';

export default defineEndpoint({
	name: 'v1.robinhood.paired-markets',
	method: 'GET',
	auth: 'public',
	handler: async ({ res, ip }) => {
		const rl = await limits.robinhoodRead(ip);
		if (!rl.success) return rateLimited(res, rl, 'Robinhood Chain data is capped at 60 requests/min per IP');

		const [config, markets] = await Promise.all([launchpadConfig(), pairedMarkets()]);
		res.setHeader('cache-control', CACHE_CONTROL);
		return {
			config,
			markets,
			classes: CLASS_LABELS,
			count: markets.length,
			source: 'paired launchpad quote registry (on-chain) + dexscreener + chainlink',
			asOf: asOf(),
		};
	},
});
