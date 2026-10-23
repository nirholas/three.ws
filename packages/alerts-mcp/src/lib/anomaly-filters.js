// Filters of a `market_anomaly` alert rule. Mirrors marketAnomalyFiltersSchema in
// the API (api/alerts/_rules.js): the API re-validates, this shapes the input.

import { z } from 'zod';

export const ANOMALY_FILTERS = z
	.object({
		processors: z
			.array(z.enum(['price', 'tvl', 'stablecoin_supply', 'stablecoin_peg', 'funding', 'open_interest']))
			.min(1)
			.optional()
			.describe('Only these detectors. Omit for all of them.'),
		min_severity: z
			.enum(['medium', 'high', 'critical'])
			.optional()
			.describe('Lowest severity to deliver (default high).'),
		subject: z
			.string()
			.max(40)
			.optional()
			.describe('Only this subject: a ticker (SOL), Solana, a stablecoin symbol or a perp (SOL-USD).'),
	})
	.strict()
	.optional()
	.describe('market_anomaly only: narrow which scanner events fire the rule.');
