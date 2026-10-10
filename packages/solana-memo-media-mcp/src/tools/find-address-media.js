import { z } from 'zod';
import { extractFromSignature } from './shared.js';
import { signatureMayCarryMedia } from '../lib/memos.js';
import { assertBase58, rpc } from '../lib/rpc.js';

const FETCH_CONCURRENCY = 4;

export const def = {
	name: 'find_solana_memo_media',
	title: 'Find recent memo media for a Solana address',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description: 'Scan a Solana address\'s recent confirmed transactions and return only validated image data URIs carried by SPL Memo instructions. Signatures whose memo summary holds no data URI are skipped without fetching the transaction, so a scan costs one RPC call plus one per candidate. Pass a memo program id as the address to watch every memo written to it. Use the returned signatures to verify provenance in an explorer. Use this when you have an address but no signature; for one known transaction call extract_solana_memo_media.',
	inputSchema: {
		address: z.string().trim().min(32).max(64).describe('Solana wallet, token account, or program address in base58.'),
		limit: z.number().int().min(1).max(1000).default(100).describe('Recent signatures to scan, from 1 to 1000 (default 100).'),
		before: z.string().trim().min(32).max(128).optional().describe('Continue the scan from signatures older than this one (the previous response\'s next_before).'),
	},
	async handler(args) {
		const address = assertBase58(args.address, 'address');
		const limit = args.limit ?? 100;
		const options = { limit, commitment: 'confirmed' };
		if (args.before) options.before = assertBase58(args.before, 'before');
		const signatures = (await rpc('getSignaturesForAddress', [address, options])) || [];
		const candidates = signatures.filter((item) => item?.signature && !item.err && signatureMayCarryMedia(item.memo));
		const matches = [];
		const failures = [];
		for (let index = 0; index < candidates.length; index += FETCH_CONCURRENCY) {
			const batch = candidates.slice(index, index + FETCH_CONCURRENCY);
			const results = await Promise.allSettled(batch.map((item) => extractFromSignature(item.signature)));
			results.forEach((result, offset) => {
				if (result.status === 'rejected') failures.push({ signature: batch[offset].signature, code: result.reason?.code || 'rpc_error', message: result.reason?.message || String(result.reason) });
				else if (result.value.assets.length || result.value.rejected.length) matches.push(result.value);
			});
		}
		return {
			address,
			scanned: signatures.length,
			candidates: candidates.length,
			match_count: matches.length,
			matches,
			failures,
			next_before: signatures.length === limit ? signatures.at(-1).signature : null,
		};
	},
};
