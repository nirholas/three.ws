// `x402_wallet` — show a Solana wallet's address + SOL/USDC balance. Read-only.
//
// With no `address`, it derives the address from the configured signer
// (SOLANA_SECRET_KEY) so you can confirm the agent's spending wallet is funded
// before pay_and_call. Pass `address` to inspect any wallet without a key.

import { z } from 'zod';

import { getBalances } from '../lib/solana.js';
import { getSigner } from '../lib/x402-buyer.js';
import { SOLANA_DEFAULT_SECRET } from '../config.js';

export const def = {
	name: 'x402_wallet',
	title: "The agent's x402 spending wallet (address + balance)",
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		"Show a Solana wallet's address and live SOL + USDC balance. With no `address`, derives the wallet from the configured signer (SOLANA_SECRET_KEY). Call this before pay_and_call to confirm there's USDC to spend. Read-only; never moves funds.",
	inputSchema: {
		address: z
			.string()
			.min(32)
			.max(64)
			.optional()
			.describe('Base58 Solana address to inspect. Omit to use the configured signer wallet.'),
	},
	async handler(args) {
		let address = args?.address ? String(args.address).trim() : '';
		let from_signer = false;
		if (!address) {
			if (!SOLANA_DEFAULT_SECRET) {
				throw Object.assign(
					new Error('No address given and no SOLANA_SECRET_KEY configured. Pass `address` or set a signer.'),
					{ code: 'no_signer' },
				);
			}
			const signer = await getSigner();
			address = String(signer.address);
			from_signer = true;
		}
		const { sol, usdc } = await getBalances(address);
		return {
			ok: true,
			address,
			from_signer,
			sol,
			usdc,
			can_pay: from_signer || Boolean(SOLANA_DEFAULT_SECRET),
		};
	},
};
