// `wallet_intel` — one wallet's realized reputation card. Read-only.
//
// Wraps GET /api/intel/smart-money?wallet=<addr>&network=mainnet.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'wallet_intel',
	title: 'Wallet reputation + smart-money card',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		"Pull one wallet's realized reputation, computed from its observed buys joined to real outcomes (graduated / pumped / rugged + ATH). Returns the realized_score (0-100), win_rate, behavioral labels, and the funder cluster it belongs to (with funder root, size, and confidence). `computed:false` means the graph has no scored history for this wallet yet. Read-only live data. Use this to vet one wallet before copying it or trusting its buys; to judge a coin by its buyers call smart_money_coin instead.",
	inputSchema: {
		wallet: z
			.string()
			.min(1)
			.describe('The wallet address to look up.'),
		network: z
			.enum(['mainnet', 'devnet'])
			.default('mainnet')
			.describe('Solana network the wallet trades on (default mainnet).'),
	},
	async handler(args) {
		const wallet = String(args?.wallet ?? '').trim();
		const network = args?.network === 'devnet' ? 'devnet' : 'mainnet';
		const data = await apiRequest('/api/intel/smart-money', { query: { wallet, network } });
		return {
			ok: true,
			address: data?.address ?? wallet,
			network: data?.network ?? network,
			computed: data?.computed ?? false,
			realized_score: data?.realized_score ?? 0,
			win_rate: data?.win_rate ?? 0,
			labels: Array.isArray(data?.labels) ? data.labels : [],
			funder_cluster: data?.cluster ?? null,
			reputation: data,
		};
	},
};
