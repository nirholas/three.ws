import { z } from 'zod';
import { decodeDataUri, mediaMetadata } from '../lib/media.js';

export const def = {
	name: 'decode_solana_memo_data_uri',
	title: 'Decode a Solana memo data URI',
	annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
	description: 'Decode and validate one base64 image data URI from a Solana memo. Only PNG, JPEG, WebP, and GIF are accepted. The bytes stay local to the MCP process, are checked against their claimed file signature, and return inline as an MCP image with byte length, SHA-256, and dimensions when available.',
	inputSchema: { dataUri: z.string().min(1).max(400_000).describe('A complete base64 image data URI from an SPL Memo instruction.') },
	async handler(args) {
		const media = decodeDataUri(args.dataUri);
		return { media, metadata: mediaMetadata(media) };
	},
};
