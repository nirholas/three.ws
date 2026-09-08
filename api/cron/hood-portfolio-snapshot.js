// @ts-check
// GET /api/cron/hood-portfolio-snapshot - records one day of Robinhood Chain
// prices so portfolio backtests have history to run against.
//
// Runs once a day. Robinhood Chain has no price history API and a pruned RPC,
// and reconstructing prices from Uniswap swap logs is not viable in a request:
// the chain produces ~864,000 blocks a day and `eth_getLogs` caps at a
// 500k-block span, so a single month for a single token is 50+ archival queries.
//
// The 34 registry equities that carry a Chainlink feed already have real history
// through their round data, which is addressed by id and readable at head state.
// Everything else on the chain, memecoins included, has none and never will
// retroactively. This cron is the answer to that: the chain cannot be asked what
// a token was worth last month, but it can be asked every day from now on, and
// the coverage compounds.
//
// Idempotent by UTC day, so a retry after a partial failure overwrites rather
// than duplicating.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { liveUniverse } from '../_lib/hood-portfolios.js';
import { recordDailySnapshot } from '../_lib/hood-portfolios-history.js';

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET'])) return;
	if (!requireCron(req, res)) return;

	const universe = await liveUniverse();
	const priced = universe.tokens.filter((t) => t.priceUsd > 0);

	// A snapshot of almost nothing means the upstream failed rather than that the
	// chain emptied out; recording it would write a hole into the history that
	// every future backtest reads as real.
	if (priced.length < 50) {
		json(res, 200, {
			ok: true,
			skipped: 'too_few_prices',
			priced: priced.length,
			universe: universe.tokens.length,
		});
		return;
	}

	const { key, recorded } = await recordDailySnapshot(priced);
	json(res, 200, { ok: true, key, recorded, universe: universe.tokens.length });
});
