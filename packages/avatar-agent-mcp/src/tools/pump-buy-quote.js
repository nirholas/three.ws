// `pump_buy_quote`: the live Jupiter quote that must run before pump_buy.
// Same route, amount and slippage the buy will use; never signs.

import { z } from 'zod';

import { isValidPubkey } from '../lib/solana.js';
import { quotePumpBuy } from '../lib/previews.js';
import { THREE_MINT } from '../config.js';

export const def = {
	name: 'pump_buy_quote',
	title: 'Quote a token buy via Jupiter (no funds move)',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Quote a pump_buy before it runs: the SOL spent, the expected and minimum tokens received, price impact, route, fees, and any rule that would refuse it. Uses the live Jupiter quote for the exact amount and slippage. Signs nothing. Show it to the user, get a clear yes, then call pump_buy with the returned quote_id and the same arguments.',
	inputSchema: {
		target: z.string().describe('Target mint (base58) or "three" to use the THREE_MINT env.'),
		buySol: z.number().positive().describe('Amount of SOL to spend.'),
		buyerSecret: z.string().describe('Base58 secret of the buyer wallet (only its public key is read).'),
		slippageBps: z.number().int().min(1).max(10_000).optional().describe('Slippage in basis points (default 500 = 5%).'),
		jitoBundle: z.boolean().optional().describe('Quote the bundled mode (adds the Jito tip). Default false.'),
		jitoTipSol: z.number().min(0).optional().describe('Jito tip in SOL (default 0.005). Only used when jitoBundle=true.'),
		priorityMicroLamports: z.number().int().min(0).max(20_000_000).optional().describe('Compute-unit price (default 2_000_000).'),
	},
	async handler(args) {
		let target = args.target;
		if (target === 'three' || target === '$three') {
			if (!THREE_MINT) return { ok: false, error: 'three_mint_not_configured' };
			target = THREE_MINT;
		}
		if (!isValidPubkey(target)) return { ok: false, error: 'invalid_target' };
		try {
			return { ok: true, quote: await quotePumpBuy({ ...args, target }) };
		} catch (err) {
			return { ok: false, error: err.code || 'quote_failed', message: err.message };
		}
	},
};
