import { z } from 'zod';
import { extractFromSignature } from './shared.js';

export const def = {
	name: 'extract_solana_memo_media',
	title: 'Extract media from a Solana transaction memo',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	description: 'Fetch a confirmed Solana transaction (legacy, v0, or v1), inspect top-level and inner SPL Memo instructions, and render every supported embedded image data URI inline. The response identifies the source signature, fee payer, slot, and transaction version, and reports rejected media without returning unsafe bytes. This is chain data, not a claim of authorship or safety. Use this when you have a transaction signature; to scan an address for media call find_solana_memo_media.',
	inputSchema: { signature: z.string().trim().min(32).max(128).describe('Solana transaction signature in base58.') },
	handler: (args) => extractFromSignature(args.signature),
};
