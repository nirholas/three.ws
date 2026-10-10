// `vanity_quote` — honest difficulty→price oracle for a vanity pattern. Read-only.
//
// Wraps GET /api/vanity/bounties?view=quote. Pure function of the pattern: the
// same prefix/suffix/ignoreCase always yields the same difficulty + suggested
// USDC bounty, so this is idempotent.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'vanity_quote',
	title: 'Quote the bounty price for a vanity pattern',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	description:
		'Quote how hard a Solana vanity address is and what to escrow for it. Give a Base58 prefix and/or suffix and get the expected attempts, rarity tier, and an honest suggested USDC bounty (atomic units) from the difficulty→price oracle. Pure function of the pattern — no wallet, no payment, fully read-only. Use this before posting a grind-bounty so you escrow a fair amount.',
	inputSchema: {
		prefix: z.string().optional().describe('Base58 prefix the address must start with (e.g. "THREE").'),
		suffix: z.string().optional().describe('Base58 suffix the address must end with.'),
		ignoreCase: z.boolean().optional().describe('Match the pattern case-insensitively (cheaper, less rare). Default false.'),
	},
	async handler(args) {
		const prefix = String(args?.prefix ?? '').trim();
		const suffix = String(args?.suffix ?? '').trim();
		if (!prefix && !suffix) {
			throw Object.assign(new Error('Provide a prefix and/or suffix to quote.'), { code: 'validation_error', status: 400 });
		}
		const data = await apiRequest('/api/vanity/bounties', {
			query: {
				view: 'quote',
				prefix: prefix || undefined,
				suffix: suffix || undefined,
				ignoreCase: args?.ignoreCase ? '1' : undefined,
			},
		});
		return {
			ok: true,
			pattern: data?.pattern,
			difficulty: data?.difficulty,
			oracle: data?.oracle,
			band: data?.band,
		};
	},
};
