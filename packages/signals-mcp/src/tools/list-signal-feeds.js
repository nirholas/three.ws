// `list_signal_feeds` — the public signal-feed directory. Read-only.
//
// Wraps GET /api/signals/marketplace?network=&sort=&limit=.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

const SORTS = ['edge', 'roi', 'hitrate', 'subscribers', 'newest'];

export const def = {
	name: 'list_signal_feeds',
	title: 'Browse the signal-feed marketplace',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Discover copy-trade signal feeds on three.ws. Returns the public directory of active feeds, each ' +
		'ranked by its PROVEN realized edge (hit-rate × realized ROI, confidence-regressed toward the ' +
		"publisher's verified track-record score until enough signals have closed — a thin feed riding one " +
		'lucky call can never top a deep, consistent one). For each feed you get its numeric `id` (pass this ' +
		'to subscribe_signal), `slug`, title, the publisher (name, verified badge, track-record score, realized ' +
		'SOL P&L), pricing (per-signal and per-epoch USDC), and proven stats (closed signals, hit-rate, average ' +
		'realized %, active subscribers, executed fills, avg emit→fill latency, avg follower ROI). Sort by ' +
		'`edge` (default), `roi`, `hitrate`, `subscribers`, or `newest`. Public, read-only live data; no key required. ' +
		'Use this to choose a feed before subscribe_signal; to rank the publishers themselves call get_mirror_leaderboard.',
	inputSchema: {
		network: z
			.enum(['mainnet', 'devnet'])
			.default('mainnet')
			.describe('Solana network the feeds publish on (default mainnet).'),
		sort: z
			.enum(SORTS)
			.default('edge')
			.describe(
				'Ranking key: edge (proven realized edge, default), roi (avg realized %), hitrate, subscribers, or newest.',
			),
		limit: z
			.number()
			.int()
			.min(1)
			.max(100)
			.default(60)
			.describe('Maximum feeds to return (1–100, default 60).'),
	},
	async handler(args) {
		const network = args?.network === 'devnet' ? 'devnet' : 'mainnet';
		const sort = SORTS.includes(args?.sort) ? args.sort : 'edge';
		const limit = Math.max(1, Math.min(100, Number(args?.limit) || 60));

		const data = await apiRequest('/api/signals/marketplace', { query: { network, sort, limit } });
		const feeds = Array.isArray(data?.feeds) ? data.feeds : [];
		return {
			ok: true,
			network: data?.network || network,
			sort: data?.sort || sort,
			count: feeds.length,
			feeds,
		};
	},
};
