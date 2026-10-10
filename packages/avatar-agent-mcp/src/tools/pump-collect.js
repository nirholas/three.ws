// `pump_collect_fees` — atomically collect a pump.fun coin's creator-fee
// vault and route the SOL to a safe destination, all in a single tx
// inside a Jito bundle.
//
// Useful when the creator key is shared or potentially leaked: even if
// another holder of the key tries to collect concurrently, the bundle's
// atomicity prevents any tx from interleaving between the collect and
// the drain.
//
// EXECUTION ACTION.

import { z } from 'zod';

import { atomicCollect } from '../lib/atomic-collect.js';
import { assertRecipientAllowed, confirmationGate } from '../lib/spend-policy.js';

export const def = {
	name: 'pump_collect_fees',
	title: 'Atomic pump.fun creator-fee collection (Jito bundle)',
	// MCP ToolAnnotations — EXECUTION: moves real value on Solana mainnet, irreversible.
	annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
	description:
		'Collect a pump.fun coin\'s creator-fee vault and route the SOL to a safe destination, atomically, in a single tx inside a Jito bundle. Funder pays the fee + Jito tip; creator signs collectCoinCreatorFee + drain to DESTINATION. The bundle\'s atomicity blocks any competing collector from interleaving even if the creator key is leaked. EXECUTION ACTION. Call this after pump_collect_preview has been shown to the user and they said yes, and never without that yes.',
	inputSchema: {
		funderSecret: z.string().describe('Base58 secret of the funder (pays fee + tip).'),
		creatorSecret: z.string().describe('Base58 secret of the coin creator (signs collect + drain).'),
		destination: z.string().describe('Pubkey to receive the collected SOL.'),
		jitoTipSol: z.number().min(0).optional().describe('Jito tip in SOL (default 0.005).'),
		priorityMicroLamports: z.number().int().min(0).max(20_000_000).optional()
			.describe('Compute-unit priority price (default 3_000_000).'),
		bufferLamports: z.number().int().min(0).optional()
			.describe('Lamports to leave in the creator wallet (default 890880, rent-exempt minimum).'),
		minVaultSol: z.number().min(0).optional()
			.describe('Abort if the vault holds less than this (default 0.001).'),
		confirm: z.boolean().optional().describe('Must be true to execute this irreversible collect+drain (when REQUIRE_CONFIRM is on).'),
	},
	async handler(args) {
		const gate = confirmationGate(args.confirm, 'pump_collect_fees (vault drain)');
		if (gate) return gate;
		try {
			assertRecipientAllowed(args.destination, 'pump_collect_fees destination');
			return await atomicCollect({
				funderSecret: args.funderSecret,
				creatorSecret: args.creatorSecret,
				destination: args.destination,
				jitoTipSol: args.jitoTipSol,
				priorityMicroLamports: args.priorityMicroLamports,
				bufferLamports: args.bufferLamports,
				minVaultSol: args.minVaultSol,
			});
		} catch (err) {
			return { ok: false, error: err.code || 'collect_failed', message: err.message };
		}
	},
};
