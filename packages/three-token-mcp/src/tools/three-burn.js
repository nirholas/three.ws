// `three_burn` — the headline. Burn a USD-denominated amount of $THREE on-chain,
// split between the incinerator and the treasury per the live public config.
// EXECUTION ACTION. Signs and broadcasts a Solana mainnet transaction.

import { z } from 'zod';

import { burnThree } from '../lib/token.js';
import { REQUIRE_CONFIRM } from '../config.js';

export const def = {
	name: 'three_burn',
	title: 'Burn $THREE on-chain (incinerator + treasury split)',
	// MCP ToolAnnotations — EXECUTION: moves real value on Solana mainnet, irreversible.
	annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
	description:
		'Burn a USD-denominated amount of the $THREE your wallet holds. Quotes USD→$THREE via Jupiter, then sends ONE Solana transaction that splits it between the incinerator (burn) and the three.ws treasury, per the live public token config. EXECUTION ACTION. Signs and broadcasts on Solana mainnet, IRREVERSIBLE: pass confirm:true. Capped by MAX_BURN_USD. The resolved mint is asserted to be canonical $THREE before signing. Requires a signer (SOLANA_SECRET_KEY env or the `secret` arg) holding enough $THREE. Returns the tx signature, the burned/treasury breakdown, and a Solscan link. Use this when the person explicitly asks to burn and has approved the USD amount; check three_balance first.',
	inputSchema: {
		usd: z.number().positive().describe('USD value of $THREE to burn (priced live via Jupiter).'),
		burnBps: z
			.number()
			.min(0)
			.max(10000)
			.optional()
			.describe(
				'Share routed to the incinerator in basis points. Default 5000 (50% burn / 50% treasury). 10000 = burn everything.',
			),
		memo: z.string().max(120).optional().describe('Optional note appended to the on-chain memo.'),
		secret: z
			.string()
			.optional()
			.describe('Base58 signer override. Defaults to SOLANA_SECRET_KEY. Treat like cash.'),
		confirm: z
			.boolean()
			.optional()
			.describe('Must be true to execute this irreversible burn (when REQUIRE_CONFIRM is on).'),
	},
	async handler(args) {
		const { usd, burnBps, memo, secret, confirm } = args || {};
		if (REQUIRE_CONFIRM && confirm !== true) {
			return {
				ok: false,
				error: 'confirmation_required',
				message:
					'three_burn is IRREVERSIBLE — it destroys $THREE on Solana mainnet. ' +
					'Re-issue the call with `confirm: true` to proceed. ' +
					'(Set REQUIRE_CONFIRM=0 on the MCP server to disable this prompt.)',
			};
		}
		return burnThree({ usd, burnBps, memo, secret });
	},
};
