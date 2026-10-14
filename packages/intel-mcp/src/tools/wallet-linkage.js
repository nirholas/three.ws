// `wallet_linkage`: are these Solana wallets the same person? Read-only.
//
// Wraps GET /api/crypto/linkage?addresses=A,B[,...].

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'wallet_linkage',
	title: 'Wallet linkage: same-controller scoring across 2-10 addresses',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		"Cross-check 2 to 10 Solana addresses for shared control. Each pair gets a 0-100 score (band: none/weak/moderate/strong/confirmed) combining six real on-chain signals by noisy-OR: shared fee payer, one address's first funder being the other, both sharing a first funder, SPL token-account control, direct transfers, and a shared funder sending similar amounts in a short window. Every match comes with evidence (the signature or account that triggered it). `complete:false` on a pair's bundle means its history walk hit a time/request budget before finishing. Use this to check whether a coin's early buyers are independent, or the creator's own alts, or whether a copy-trade leader secretly controls the creator wallet of a coin they are pumping.",
	inputSchema: {
		addresses: z
			.array(z.string().min(1))
			.min(2)
			.max(10)
			.describe('2 to 10 Solana addresses to cross-check for shared control.'),
	},
	async handler(args) {
		const addresses = Array.isArray(args?.addresses) ? args.addresses.map((a) => String(a).trim()).filter(Boolean) : [];
		const data = await apiRequest('/api/crypto/linkage', { query: { addresses: addresses.join(',') } });
		return {
			ok: true,
			addresses: data?.addresses ?? addresses,
			pairs: Array.isArray(data?.pairs) ? data.pairs : [],
			complete: data?.complete ?? false,
		};
	},
};
