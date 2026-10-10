// `three_price` — live USD price of $THREE plus an optional USD→$THREE quote.
// Read-only: no signer, no payment.

import { z } from 'zod';

import { fetchTokenPrice } from '../lib/token.js';

export const def = {
	name: 'three_price',
	title: 'Live $THREE price (Jupiter) + USD→$THREE quote',
	// MCP ToolAnnotations — safety hints surfaced to MCP clients.
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Return the live USD price of $THREE (Jupiter primary, Birdeye fallback). Pass `usd` to also get how much $THREE that amount buys (token amount + atomic units). Read-only, no signer or payment required. Use this to quote $THREE in USD or size a USD amount in $THREE; for a wallet\'s holdings call three_balance.',
	inputSchema: {
		usd: z.number().positive().optional().describe('Optional USD amount to quote into $THREE.'),
	},
	async handler(args) {
		const { usd } = args || {};
		const price = await fetchTokenPrice(usd);
		return {
			ok: true,
			mint: price.mint,
			price_usd: price.price_usd,
			source: price.source,
			as_of: price.as_of,
			...(price.quote ? { quote: price.quote } : {}),
		};
	},
};
