// `sns_reverse` — reverse-lookup a wallet to its primary .sol name. Read-only.
//
// Wraps GET /api/sns?address=<base58>.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'sns_reverse',
	title: 'Reverse-lookup a wallet to its primary .sol name',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Reverse-lookup a Solana wallet to the primary .sol name it has set as its favorite. Returns the name, or resolved:false when the wallet has no favorite domain (a routine, expected answer, not an error). Mainnet only. Use this to show a readable name for a wallet address; for name to wallet call sns_resolve. Read-only.',
	inputSchema: {
		address: z
			.string()
			.min(1)
			.describe('A base58 Solana public key, e.g. "HKKp49qGWXd639QsuH7JiLijfVW5UtCVY4s1n2HANwEA".'),
	},
	async handler(args) {
		const address = String(args?.address ?? '').trim();
		const data = await apiRequest('/api/sns', { query: { address } });
		const result = data?.data ?? {};
		return {
			ok: true,
			address: result.address ?? null,
			name: result.name ?? null,
			resolved: Boolean(result.resolved),
		};
	},
};
