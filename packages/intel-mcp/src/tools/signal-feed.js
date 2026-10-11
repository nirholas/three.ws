// `signal_feed` — one signal feed's track record + recent emissions. Read-only.
//
// Wraps GET /api/signals/feed?slug=<slug>&network=mainnet.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'signal_feed',
	title: 'Signal feed track record + recent signals',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		"Read one signal feed's public detail: the publisher's verified track record, the feed's proven accuracy (hit-rate, average realized ROI, follower ROI, emit→fill latency), pricing, and the recent emission log, every signal with its realized outcome and the on-chain tx that proves it. Read-only live data. Use this to judge a feed's proven accuracy and price before subscribing to it.",
	inputSchema: {
		slug: z
			.string()
			.min(1)
			.describe('The feed slug (its public identifier on three.ws).'),
		network: z
			.enum(['mainnet', 'devnet'])
			.default('mainnet')
			.describe('Solana network the feed publishes on (default mainnet).'),
	},
	async handler(args) {
		const slug = String(args?.slug ?? '').trim();
		const network = args?.network === 'devnet' ? 'devnet' : 'mainnet';
		const data = await apiRequest('/api/signals/feed', { query: { slug, network } });
		const feed = data?.feed;
		if (!feed) {
			throw Object.assign(new Error(`No signal feed found with slug "${slug}".`), {
				code: 'not_found',
				status: 404,
			});
		}
		const recent = Array.isArray(feed.recent_signals) ? feed.recent_signals : [];
		return {
			ok: true,
			slug,
			network,
			feed,
			recent_signal_count: recent.length,
		};
	},
};
