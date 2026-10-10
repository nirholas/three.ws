// `vanity_appraise` — rarity appraisal of any Solana address. Read-only.
//
// Wraps GET /api/vanity/gallery?view=appraise. Pure math on the address (no
// persistence, no payment), so the same address always appraises the same —
// idempotent.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'vanity_appraise',
	title: 'Appraise the rarity of a Solana address',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	description:
		'Appraise how rare a Solana address is: its detected vanity pattern, rarity score, rarity bits, tier, and expected grind attempts. Pure math on the Base58 address; nothing is stored. If the address has been published to the proof-of-grind gallery, the public entry is returned too. Use this to rate an address someone already has; to price grinding a new pattern call vanity_quote. Read-only, no payment.',
	inputSchema: {
		address: z.string().min(32).max(44).describe('The Base58 Solana public key to appraise (32–44 chars).'),
		prefixLen: z.number().int().min(0).optional().describe('Override how many leading characters to treat as the pattern prefix.'),
		suffixLen: z.number().int().min(0).optional().describe('Override how many trailing characters to treat as the pattern suffix.'),
	},
	async handler(args) {
		const address = String(args?.address ?? '').trim();
		const data = await apiRequest('/api/vanity/gallery', {
			query: {
				view: 'appraise',
				address,
				prefixLen: args?.prefixLen,
				suffixLen: args?.suffixLen,
			},
		});
		return {
			ok: true,
			address,
			appraisal: data?.appraisal,
			published: data?.published ?? null,
		};
	},
};
