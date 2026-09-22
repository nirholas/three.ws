// `wallet_send_preview`: the spend-nothing preview that must run before
// wallet_send. Reads the sender's live balance and applies the same cap and
// allowlist checks the send applies, without signing anything.

import { z } from 'zod';

import { previewWalletSend } from '../lib/previews.js';

export const def = {
	name: 'wallet_send_preview',
	title: 'Preview a SOL send (no funds move)',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Preview a wallet_send before it runs: the sender address, recipient, amount, network fee, the sender balance before and after, and any rule that would refuse it (spend cap, recipient allowlist, insufficient funds). Signs nothing and moves nothing. Show this to the user and get a clear yes before calling wallet_send with the returned preview_id.',
	inputSchema: {
		to: z.string().min(32).max(64).describe('Destination Solana pubkey (base58).'),
		sol: z.number().positive().describe('Amount of SOL to send.'),
		secret: z.string().optional().describe('Base58 secret of the sender. Falls back to SOLANA_SECRET_KEY env.'),
		priorityMicroLamports: z.number().int().min(0).max(10_000_000).optional().describe('Compute-unit price (default 100000).'),
	},
	async handler(args) {
		try {
			return { ok: true, preview: await previewWalletSend(args) };
		} catch (err) {
			return { ok: false, error: err.code || 'preview_failed', message: err.message };
		}
	},
};
