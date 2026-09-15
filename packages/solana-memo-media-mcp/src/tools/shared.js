import { decodeDataUri, mediaMetadata } from '../lib/media.js';
import { memoPayloads } from '../lib/memos.js';
import { assertBase58, getParsedTransaction } from '../lib/rpc.js';

export async function extractFromSignature(value) {
	const signature = assertBase58(value, 'signature');
	const transaction = await getParsedTransaction(signature);
	if (!transaction) { const error = new Error('Transaction was not found.'); error.code = 'transaction_not_found'; throw error; }
	const assets = [];
	const rejected = [];
	for (const payload of memoPayloads(transaction)) {
		if (!payload.startsWith('data:')) continue;
		try { const media = decodeDataUri(payload); assets.push({ media, metadata: mediaMetadata(media, { source: 'spl_memo' }) }); }
		catch (error) { rejected.push({ code: error.code || 'invalid_data_uri', message: error.message }); }
	}
	return { signature, slot: transaction.slot ?? null, block_time: transaction.blockTime ?? null, assets, rejected };
}
