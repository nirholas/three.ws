// `get_feed_events` — the site-wide live activity ticker. Read-only.
//
// Wraps GET /api/feed?limit=<n>. Returns recent platform events newest-first —
// the same stream that powers the on-site activity widget.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'get_feed_events',
	title: 'Site-wide activity feed',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		"The site-wide activity ticker, recent things that just happened across three.ws, newest-first. Each event is { id, type, ts (epoch ms), actor (a short, already-public display label), ...typeSpecific }. Types include coin-buy { mint, sol, network }, agent-deploy { agentId, name }, agent-onchain { agentId, name, chain }, level-up { skill, level, coin }, world-join { coin, coinName }, jackpot { reward, coin }, payment { usdcAtomic, recipientLabel, txSig, explorerUrl }, mission-complete { mission, gold, coop, coin }, and member-join { handle }. Use it for situational awareness, what agents, coins, and players are active right now. Read-only live data; new events arrive constantly.",
	inputSchema: {
		limit: z
			.number()
			.int()
			.min(1)
			.max(100)
			.optional()
			.describe('How many recent events to return, newest-first (1–100, default 30).'),
	},
	async handler(args) {
		const limit = args?.limit;
		const data = await apiRequest('/api/feed', { query: { limit } });
		const events = Array.isArray(data?.events) ? data.events : [];
		return {
			ok: true,
			count: events.length,
			events,
		};
	},
};
