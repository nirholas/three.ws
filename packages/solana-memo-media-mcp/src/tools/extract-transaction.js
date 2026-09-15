import { z } from 'zod';
import { decodeDataUri, mediaMetadata } from '../lib/media.js';
import { memoPayloads } from '../lib/memos.js';
import { assertBase58, getParsedTransaction } from '../lib/rpc.js';

export const def = {
	name: 'extract_solana_memo_media',
	title: 'Extract media from a Solana transaction memo',
	annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: true },
	description: 'Fetch a finalized Solana transaction, inspect top-level and inner SPL Memo instructions, and render every supported embedded image data URI inline. The response always identifies the source signature and reports rejected media without returning unsafe bytes. This is chain data, not a claim of authorship or safety.',
	inputSchema: { signature: z.string().trim().min(32).max(128).describe('Finalized Solana transaction signature in base58.') },
	async handler(args) {
		const signature = assertBase58(args.signature, 'signature');
		const transaction = await getParsedTransaction(signature);
		if (!transaction) {
			const error = new Error('Transaction was not found or is not available from the configured RPC endpoints.');
			error.code = 'transaction_not_found';
			throw error;
		}
		const payloads = memoPayloads(transaction);
		const assets = [];
		const rejected = [];
		for (const payload of payloads) {
			if (!payload.startsWith('data:')) continue;
			try { const media = decodeDataUri(payload); assets.push({ media, metadata: mediaMetadata(media, { source: 'spl_memo' }) }); }
			catch (error) { rejected.push({ code: error.code || 'invalid_data_uri', message: error.message }); }
		}
		return { signature, slot: transaction.slot ?? null, block_time: transaction.blockTime ?? null, memo_count: payloads.length, assets, rejected };
	},
};
