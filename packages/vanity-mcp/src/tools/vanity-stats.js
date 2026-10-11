// `vanity_stats` — live market totals. Read-only.
//
// Wraps GET /api/vanity/bounties?view=stats. Live aggregates (open count,
// escrowed, paid out) change as the market moves — NOT idempotent.

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'vanity_stats',
	title: 'Live grind-bounty market totals',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Get live totals for the grind-bounty market: how many bounties are open, how much USDC is currently escrowed, and how much has been paid out to winning workers. A quick pulse on market activity. Use this for a one-line market summary; for individual bounties call vanity_board. Read-only, no params.',
	inputSchema: {},
	async handler() {
		const data = await apiRequest('/api/vanity/bounties', { query: { view: 'stats' } });
		return { ok: true, ...data };
	},
};
