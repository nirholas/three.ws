// `get_clash_leaderboard` — all-time faction war records, plus (optionally) a
// single faction's top soldiers this round. Read-only.
//
// Wraps GET /api/clash/leaderboard[?faction=<mint>].

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'get_clash_leaderboard',
	title: 'Coin Clash leaderboard',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Rank Coin Clash factions by their all-time war record. Returns `board`: factions sorted by wins then power, each with `token`, `symbol`, `image`, `members`, `w`/`l`/`d` (win/loss/draw), `battles`, cumulative `power`, and `winRate` (percent of decided battles won, or null if none decided yet). Pass `faction` (a faction mint) to also get `soldiers`: that faction\'s top rally contributors this round (wallet + power). Live data — records update as rounds settle. Use this to find the strongest armies and the heaviest hitters.',
	inputSchema: {
		faction: z
			.string()
			.min(1)
			.optional()
			.describe('Optional faction mint to also return that faction\'s top soldiers this round.'),
	},
	async handler(args) {
		const faction = args?.faction ? String(args.faction).trim() : undefined;
		const data = await apiRequest('/api/clash/leaderboard', {
			query: faction ? { faction } : undefined,
		});
		const d = data?.data ?? {};
		return {
			ok: true,
			board: Array.isArray(d.board) ? d.board : [],
			soldiers: d.soldiers ?? null,
		};
	},
};
