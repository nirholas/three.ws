import { z } from 'zod';
import { extractFromSignature } from './shared.js';
import { assertBase58, rpc } from '../lib/rpc.js';

export const def = {
	name: 'find_solana_memo_media',
	title: 'Find recent memo media for a Solana address',
	annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: true },
	description: 'Search a public Solana address’s recent finalized transactions and return only validated image data URIs carried by SPL Memo instructions. It is intentionally bounded to limit RPC load. Use the returned signatures to verify provenance in an explorer.',
	inputSchema: { address: z.string().trim().min(32).max(64).describe('Solana wallet, token account, or program address in base58.'), limit: z.number().int().min(1).max(20).default(10).describe('Recent finalized signatures to inspect, from 1 to 20 (default 10).') },
	async handler(args) {
		const address = assertBase58(args.address, 'address');
		const limit = args.limit ?? 10;
		const signatures = await rpc('getSignaturesForAddress', [address, { limit, commitment: 'finalized' }]);
		const matches = [];
		const failures = [];
		for (const item of signatures || []) {
			if (!item?.signature || item.err) continue;
			try {
				const result = await extractFromSignature(item.signature);
				if (result.assets.length) matches.push(result);
			} catch (error) { failures.push({ signature: item.signature, code: error.code || 'rpc_error', message: error.message }); }
		}
		return { address, inspected: (signatures || []).length, match_count: matches.length, matches, failures };
	},
};
