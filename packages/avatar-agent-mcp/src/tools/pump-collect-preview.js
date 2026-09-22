// `pump_collect_preview` — reads the creator-fee vault and shows exactly how
// much SOL pump_collect_fees would move to the destination.

import { z } from 'zod';

import { previewPumpCollect } from '../lib/previews.js';

export const def = {
	name: 'pump_collect_preview',
	title: 'Preview a creator-fee collection (no funds move)',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Preview pump_collect_fees before it runs: the live creator-fee vault balance, the creator balance, the rent buffer kept behind, the exact SOL that would reach the destination, the Jito tip, and any rule that would refuse it. Signs nothing. Show it to the user, get a clear yes, then call pump_collect_fees with the returned preview_id and the same arguments.',
	inputSchema: {
		funderSecret: z.string().describe('Base58 secret of the funder (only its public key and balance are read).'),
		creatorSecret: z.string().describe('Base58 secret of the coin creator (only its public key is read).'),
		destination: z.string().min(32).max(64).describe('Where the collected SOL would go (base58).'),
		jitoTipSol: z.number().min(0).optional().describe('Jito tip in SOL (default 0.005).'),
		bufferLamports: z.number().int().min(0).optional().describe('Lamports left on the creator (floored at rent-exempt).'),
		minVaultSol: z.number().min(0).optional().describe('Skip when the vault holds less than this (default 0.001).'),
	},
	async handler(args) {
		try {
			return { ok: true, preview: await previewPumpCollect(args) };
		} catch (err) {
			return { ok: false, error: err.code || 'preview_failed', message: err.message };
		}
	},
};
