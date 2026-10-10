// `get_wallet_balances` — live on-chain SOL + SPL balances for any Solana pubkey,
// read straight from the RPC. Read-only, no session needed.
//
// Where get_portfolio_summary aggregates the wallets you own (priced in USD via
// the three.ws API), this reads ONE address directly from the chain — the raw,
// authoritative on-chain truth for the agent's own signing wallet, available
// without a session.

import { z } from 'zod';

import { getBalanceSol, getTokenBalances, isValidPubkey } from '../lib/solana.js';
import { SOLANA_RPC_URL } from '../config.js';

export const def = {
	name: 'get_wallet_balances',
	title: 'Live on-chain balances for a Solana wallet',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Read live, on-chain balances for any Solana pubkey directly from the RPC: the native SOL balance plus ' +
		'every non-zero SPL token position (classic SPL and Token-2022), each with mint, raw amount, ui_amount, ' +
		'decimals, and which token program owns it. This is the raw on-chain truth (no USD pricing). Use it to ' +
		'confirm the agent’s own signing wallet before a send_transfer, or to check any address. No session ' +
		'required. Read-only.',
	inputSchema: {
		address: z.string().min(32).max(44).describe('Base58 Solana pubkey to read balances for.'),
		include_tokens: z
			.boolean()
			.default(true)
			.describe('Include SPL/Token-2022 positions (default true). Set false for just the SOL balance.'),
	},
	async handler(args) {
		const address = String(args?.address ?? '').trim();
		if (!isValidPubkey(address)) {
			return { ok: false, error: 'invalid_pubkey', message: `not a valid Solana pubkey: ${address}` };
		}
		const includeTokens = args?.include_tokens !== false;
		const [sol, tokens] = await Promise.all([
			getBalanceSol(address),
			includeTokens ? getTokenBalances(address) : Promise.resolve(null),
		]);
		return {
			ok: true,
			address,
			sol: sol.sol,
			lamports: sol.lamports,
			token_count: tokens ? tokens.length : null,
			tokens,
			rpc: SOLANA_RPC_URL,
			explorer: `https://solscan.io/account/${address}`,
			fetched_at: new Date().toISOString(),
		};
	},
};
