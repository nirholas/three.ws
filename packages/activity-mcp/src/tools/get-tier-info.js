// `get_tier_info` — the $THREE holder tier ladder. Read-only.
//
// Wraps GET /api/leaderboard (reads its `tiers` legend; the leaderboard always
// returns the ladder, even on an empty board). The thresholds are derived purely
// from on-chain $THREE balance — the same ladder the board badges, the 3D PFP
// gate, and the share card all use.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'get_tier_info',
	title: '$THREE holder tier ladder',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		"The $THREE holder tier ladder — the membership bands a wallet earns purely from its on-chain $THREE balance. Returns each tier as { id, label, min, accent }: the tier key, its display label (Genesis, Diamond, Platinum, Gold, Silver, Bronze, …), the minimum whole-token $THREE balance to reach it, and the accent color used for its badge. Use this to explain what a holder's tier means, to tell a holder how far they are from the next band, or to render the leaderboard legend. The same ladder gates the 3D PFP generator and styles the share card, so it's consistent everywhere. Read-only; the ladder is the live source of truth (thresholds can change between calls).",
	inputSchema: {},
	async handler() {
		// limit=1 keeps the holder page tiny — we only need the `tiers` legend,
		// which the leaderboard returns on every response (even an empty board).
		const data = await apiRequest('/api/leaderboard', { query: { limit: 1 } });
		const tiers = Array.isArray(data?.tiers) ? data.tiers : [];
		return {
			ok: true,
			mint: data?.mint ?? null,
			count: tiers.length,
			tiers,
		};
	},
};
