// `get_trending_agents` — agents ranked by real chat activity. Read-only.
//
// Wraps GET /api/trending?window=24h|7d|all&limit=<n>&sort=activity|trust and
// returns the agents ranking (the public /trending leaderboard's agent column).

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'get_trending_agents',
	title: 'Trending agents by activity',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		"The agents that are hot on three.ws right now, ranked by REAL chat activity. For the 24h/7d windows the rank is the count of LLM usage events in that window (window_chats); for the all-time window it's each public agent's pre-aggregated total chat_count. Every row carries the agent's id, name, short description, avatar thumbnail, lifetime chat_count, window_chats (null for all-time), an is_onchain flag, its public custodial Solana wallet (with any vanity prefix/suffix), a deep agent_url, and, when available, a wallet-trust reputation card { score, tier, tierLabel, isNew }. Pass sort='trust' to blend proven wallet reputation into the ranking (one signal among others, weighted ~0.45, never pay-to-win) instead of pure activity. Read-only live data; the ranking moves between calls. Use this to find which agents people are actually talking to right now; for coins call get_trending_coins, for the raw event stream call get_feed_events.",
	inputSchema: {
		window: z
			.enum(['24h', '7d', 'all'])
			.default('24h')
			.describe('Activity window to rank over: 24h or 7d count LLM usage events in that window; all uses lifetime chat_count (default 24h).'),
		sort: z
			.enum(['activity', 'trust'])
			.default('activity')
			.describe("Ranking mode: 'activity' ranks purely by chat volume; 'trust' blends wallet-trust reputation in as one signal (default activity)."),
		limit: z
			.number()
			.int()
			.min(1)
			.max(20)
			.optional()
			.describe('How many ranked agents to return (1–20, default 10).'),
	},
	async handler(args) {
		const window = ['24h', '7d', 'all'].includes(args?.window) ? args.window : '24h';
		const sort = args?.sort === 'trust' ? 'trust' : 'activity';
		const limit = args?.limit;
		const data = await apiRequest('/api/trending', { query: { window, sort, limit } });
		const agents = Array.isArray(data?.agents) ? data.agents : [];
		return {
			ok: true,
			window,
			sort,
			generated_at: data?.generated_at ?? null,
			count: agents.length,
			agents,
		};
	},
};
