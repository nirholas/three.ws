// `pump_launch_preview`: every SOL line a launch costs the funder, checked
// against its live balance and the spend cap, before pump_launch runs.

import { z } from 'zod';

import { previewPumpLaunch } from '../lib/previews.js';

export const def = {
	name: 'pump_launch_preview',
	title: 'Preview a coin launch (no funds move)',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Preview a pump_launch before it runs: the funder and creator addresses, the creator rent transfer, the dev buy, the Jito tip, the total the funder pays, its balance, and any rule that would refuse the launch. Signs nothing, uploads nothing, mints nothing. Show it to the user, get a clear yes, then call pump_launch with the returned preview_id and the same arguments.',
	inputSchema: {
		name: z.string().min(1).max(32).describe('Coin name.'),
		symbol: z.string().min(1).max(10).describe('Coin symbol.'),
		funderSecret: z.string().describe('Base58 secret of the funder (only its public key and balance are read).'),
		creatorSecret: z.string().describe('Base58 secret of the creator (only its public key is read).'),
		rentSol: z.number().min(0).optional().describe('SOL the funder sends the creator for rent (default 0.035).'),
		devBuySol: z.number().min(0).optional().describe('SOL the creator spends on a dev buy (default 0).'),
		jitoTipSol: z.number().min(0).optional().describe('Jito tip in SOL (default 0.005).'),
	},
	async handler(args) {
		try {
			return { ok: true, preview: await previewPumpLaunch(args) };
		} catch (err) {
			return { ok: false, error: err.code || 'preview_failed', message: err.message };
		}
	},
};
