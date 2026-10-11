// `kol_leaderboard` — the ranked KOL trader leaderboard. Read-only.
//
// Wraps GET /api/kol/leaderboard?window=7d|30d&limit=<n>.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'kol_leaderboard',
	title: 'KOL trader leaderboard',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Rank the tracked key-opinion-leader (KOL) traders by realized performance over a recent window. Returns the leaderboard rows: each tracked wallet with its P&L, win rate, and trade activity for the chosen window. Read-only live data. Use this to find the KOL traders worth watching; for what they traded on one coin call kol_trades.',
	inputSchema: {
		window: z
			.enum(['7d', '30d'])
			.default('7d')
			.describe('Performance window to rank over (default 7d).'),
		limit: z
			.number()
			.int()
			.min(1)
			.max(100)
			.optional()
			.describe('How many ranked traders to return (1–100, default 25).'),
	},
	async handler(args) {
		const window = args?.window === '30d' ? '30d' : '7d';
		const limit = args?.limit;
		const data = await apiRequest('/api/kol/leaderboard', { query: { window, limit } });
		const items = Array.isArray(data?.items) ? data.items : [];
		return {
			ok: true,
			window,
			count: items.length,
			items,
		};
	},
};
