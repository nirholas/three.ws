// `preview_transfer` — the preview that must run before send_transfer. Reads
// the sender's live balances and applies the same cap and allowlist rules the
// transfer applies, without signing.

import { z } from 'zod';

import { previewTransfer } from '../lib/solana.js';
import { MAX_SOL_PER_TX, RECIPIENT_ALLOWLIST } from '../lib/spend-policy.js';

export const def = {
	name: 'preview_transfer',
	title: 'Preview a SOL or SPL transfer (no funds move)',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Preview send_transfer before it runs: the sending wallet, the recipient, the asset and exact base units, what ' +
		'the sender holds, whether a recipient token account must be created and the rent that costs, the network fee, ' +
		'and every rule that would refuse the transfer (spend cap, allowlist, balance). Signs nothing. Show it to the ' +
		'user, get a clear yes, then call send_transfer with the same arguments, the returned preview_id and ' +
		'confirm_transfer: true.',
	inputSchema: {
		recipient: z.string().min(32).max(44).describe('Destination Solana pubkey (base58).'),
		amount: z
			.string()
			.regex(/^(\d+(\.\d*)?|\.\d+)$/, 'amount must be a positive decimal string, e.g. "1.5"')
			.describe('Amount in human units as a decimal string.'),
		mint: z.string().optional().describe('SPL token mint (base58). Omit or "native" for SOL.'),
		secret: z.string().optional().describe('Base58 secret of the sending wallet (only its public key is read). Falls back to SOLANA_SECRET_KEY.'),
		priorityMicroLamports: z.number().int().min(0).max(50_000_000).optional().describe('Compute-unit price (default 100000).'),
	},
	async handler(args) {
		try {
			const preview = await previewTransfer(
				{ secret: args.secret, to: args.recipient, amount: args.amount, mint: args.mint, priorityMicroLamports: args.priorityMicroLamports },
				{ maxSolPerTx: MAX_SOL_PER_TX, allowlist: RECIPIENT_ALLOWLIST },
			);
			return { ok: true, preview };
		} catch (err) {
			return { ok: false, error: err.code || 'preview_failed', message: err.message };
		}
	},
};
