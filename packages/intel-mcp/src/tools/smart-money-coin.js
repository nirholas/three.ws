// `smart_money_coin` — judge a coin by WHO is net-buying it. Read-only.
//
// Wraps GET /api/intel/smart-money?mint=<addr>&network=mainnet.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'smart_money_coin',
	title: 'Smart-money score for a coin',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Assess a coin by WHO is net-buying it right now. Returns a 0-100 smart_money_score computed from real observed buys joined to real outcomes, the reputable buyers in the book (with realized score, win rate, and labels), the funder clusters behind them, and a sybil_flag when one cluster dominates the order book. `computed:false` means the graph has no on-chain history for this mint yet. Read-only live data. Use this before buying a coin to see whether reputable wallets or a single sybil cluster is behind the bid; for one wallet\'s record call wallet_intel.',
	inputSchema: {
		mint: z
			.string()
			.min(1)
			.describe('The token mint address to assess (any runtime mint).'),
		network: z
			.enum(['mainnet', 'devnet'])
			.default('mainnet')
			.describe('Solana network the mint lives on (default mainnet).'),
	},
	async handler(args) {
		const mint = String(args?.mint ?? '').trim();
		const network = args?.network === 'devnet' ? 'devnet' : 'mainnet';
		const data = await apiRequest('/api/intel/smart-money', { query: { mint, network } });
		return {
			ok: true,
			mint: data?.mint ?? mint,
			network: data?.network ?? network,
			computed: data?.computed ?? false,
			smart_money_score: data?.smart_money_score ?? 0,
			reputable_buyers: data?.count ?? 0,
			sybil_flag: data?.sybil_flag ?? false,
			sybil_share: data?.sybil_share ?? 0,
			wallets: Array.isArray(data?.wallets) ? data.wallets : [],
			clusters: Array.isArray(data?.clusters) ? data.clusters : [],
		};
	},
};
