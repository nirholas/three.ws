// `get_mirror_leaderboard` — performance-weighted ranking of followable
// publishers/leaders for copy-trading. Read-only.
//
// Wraps GET /api/mirror/leaderboard?network=&sort=&limit=.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

const SORTS = ['score', 'pnl', 'followers', 'volume', 'winrate'];

export const def = {
	name: 'get_mirror_leaderboard',
	title: 'Rank signal publishers by realized performance',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Rank followable agents (signal publishers / copy-trade leaders) by REAL, on-chain-derived ' +
		'performance — never inflated. Every number traces to a real signature: realized P&L and win-rate come ' +
		'from closed sniper round-trips, volume from the discretionary custody ledger, and losers are included. ' +
		'Each leader returns rank, agent_id, name, avatar, settled trades, wins, win_rate, realized pnl_sol, ' +
		'roi_pct, trade count, volume_sol, follower counts, last trade time, and a composite score (realized ROI ' +
		'weighted by sample size so a one-trade fluke cannot top a consistent trader). Sort by `score` (default), ' +
		'`pnl`, `followers`, `volume`, or `winrate`. Use this to find a leader before subscribing to their feed. ' +
		'Public, read-only live data — no key required.',
	inputSchema: {
		network: z
			.enum(['mainnet', 'devnet'])
			.default('mainnet')
			.describe('Solana network to rank on (default mainnet).'),
		sort: z
			.enum(SORTS)
			.default('score')
			.describe('Ranking key: score (default), pnl, followers, volume, or winrate.'),
		limit: z
			.number()
			.int()
			.min(1)
			.max(50)
			.default(25)
			.describe('Maximum leaders to return (1–50, default 25).'),
	},
	async handler(args) {
		const network = args?.network === 'devnet' ? 'devnet' : 'mainnet';
		const sort = SORTS.includes(args?.sort) ? args.sort : 'score';
		const limit = Math.max(1, Math.min(50, Number(args?.limit) || 25));

		const data = await apiRequest('/api/mirror/leaderboard', { query: { network, sort, limit } });
		const leaders = Array.isArray(data?.data?.leaders) ? data.data.leaders : [];
		return {
			ok: true,
			network: data?.data?.network || network,
			sort: data?.data?.sort || sort,
			count: leaders.length,
			leaders,
		};
	},
};
