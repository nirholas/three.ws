import { z } from 'zod';
import { LIMITS, readInscription } from '../lib/inscriptions.js';
import { assertBase58, getParsedTransaction, rpc } from '../lib/rpc.js';

export const def = {
	name: 'read_inscription',
	title: 'Read and verify a multi-part Solana memo inscription',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	description: 'Rebuild a file or message that was written across several Solana memo transactions, then verify it. Understands first/1 (first-onchain), firsts/1 (solana-firsts) and spl404 manifests plus chunks (spl404-forge). Give any one signature of the inscription: sibling parts are found through the signer\'s recent history, and an spl404 manifest lists its own chunks. Every part\'s SHA-256 is reported, the whole is checked against the hash the writer declared (first/1 declares none and is reported as complete, not verified), and missing parts are listed by number. Raster images (PNG, JPEG, GIF, WebP) come back inline; SVG, HTML, JSON and text come back as text only and are never meant to be rendered. Bytes are returned only when the structure checks pass. On-chain data is untrusted: it proves the bytes appeared in these transactions, nothing about authorship beyond the signer. Use extract_solana_memo_media for a single-memo data URI.',
	inputSchema: {
		signature: z.string().trim().min(32).max(128).describe('Base58 signature of any transaction that holds one part of the inscription (or its spl404 manifest).'),
		signatures: z.array(z.string().trim().min(32).max(128)).max(LIMITS.maxParts).optional().describe('Extra part signatures, when you already know them. Skips discovery for those parts.'),
		discover: z.boolean().default(true).describe('Search the signer\'s recent history (up to 3,000 signatures) for the remaining parts. Default true.'),
	},
	async handler(args) {
		const signature = assertBase58(args.signature, 'signature');
		const signatures = (args.signatures || []).map((item) => assertBase58(item, 'signatures[]'));
		const result = await readInscription({
			signature,
			signatures,
			discover: args.discover ?? true,
			getTransaction: getParsedTransaction,
			listSignatures: (address, options) => rpc('getSignaturesForAddress', [address, { limit: 1000, commitment: 'confirmed', ...options }]),
		});
		return present(result);
	},
};

// Builds the public shape. Raw byte arrays never leave this function except as MCP image content.
export function present(result) {
	const { bytes, content, presentation, ...rest } = result;
	const out = { ...rest, kind: presentation?.kind ?? null };
	if (!presentation || !content) return out;
	if (presentation.kind === 'image') {
		out.media = { mimeType: presentation.mime, base64: Buffer.from(content).toString('base64') };
		out.metadata = { mime_type: presentation.mime, byte_length: content.length, sha256: result.content_sha256 };
	} else if (presentation.kind === 'text') {
		out.text = presentation.text;
		out.text_truncated = Boolean(presentation.truncated);
		out.unsafe_markup = presentation.markup;
	}
	return out;
}
