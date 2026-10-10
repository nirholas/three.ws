// `get_wallet_trades` — one KOL wallet's recent trades on a given mint. Read-only.
//
// Wraps GET /api/kol/trades?mint=<mint>&limit=100, then narrows the cross-wallet
// feed down to a single trader. The three.ws trade feed is mint-keyed (it scans
// every tracked KOL wallet for activity on one mint via Helius), so a per-wallet
// view is that feed filtered to the wallet you care about. We always pull the
// upstream max so the wallet's own slice is as complete as the feed allows.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

const UPSTREAM_MAX = 100;

export const def = {
	name: 'get_wallet_trades',
	title: "A KOL wallet's trades on a mint",
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Get one specific KOL trader\'s recent buys/sells of a given mint. The three.ws trade ' +
		'feed is scanned for that mint across all tracked wallets and narrowed to the wallet you ' +
		'pass, so you see exactly how that trader is positioning in that token — side (buy/sell), ' +
		'SOL size, token amount, per-trade price, USD value, and timestamp, newest first. Use it ' +
		'to inspect a single smart trader\'s moves before copying. For every tracked wallet\'s ' +
		'trades on a mint (not just one), use intel-mcp `kol_trades`. Read-only live data.',
	inputSchema: {
		wallet: z
			.string()
			.min(1)
			.describe('The KOL wallet address whose trades to return.'),
		mint: z
			.string()
			.min(1)
			.describe('The token mint address to scan that wallet\'s activity on.'),
		limit: z
			.number()
			.int()
			.min(1)
			.max(100)
			.optional()
			.describe('Max number of this wallet\'s trades to return (1–100, default 20).'),
	},
	async handler(args) {
		const wallet = String(args?.wallet ?? '').trim();
		const mint = String(args?.mint ?? '').trim();
		const limit = Math.min(100, Math.max(1, Number(args?.limit) || 20));

		const data = await apiRequest('/api/kol/trades', {
			query: { mint, limit: UPSTREAM_MAX },
		});
		const all = Array.isArray(data?.trades) ? data.trades : [];
		const trades = all.filter((t) => t?.wallet === wallet).slice(0, limit);

		return {
			ok: true,
			wallet,
			mint: data?.mint ?? mint,
			count: trades.length,
			trades,
		};
	},
};
