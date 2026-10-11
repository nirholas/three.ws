import { ALLOWED_MEDIA_TYPES, MAX_MEDIA_BYTES } from '../lib/media.js';
import { MEMO_PROGRAM_IDS } from '../lib/memos.js';
import { getRpcUrls } from '../lib/rpc.js';

export const def = {
	name: 'get_solana_memo_media_status',
	title: 'Solana memo media capability',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
	description: 'Report the local decoding policy, recognized memo programs, and ordered Solana RPC failover hosts. No network call is made and no data is stored. Use this to check which RPC hosts and memo programs the server will use before a scan.',
	inputSchema: {},
	handler: async () => ({
		accepted_mime_types: [...ALLOWED_MEDIA_TYPES],
		max_decoded_bytes: MAX_MEDIA_BYTES,
		memo_program_ids: [...MEMO_PROGRAM_IDS],
		rpc_hosts: getRpcUrls().map((url) => new URL(url).host),
		max_supported_transaction_version: 1,
		local_decoding: true,
		writes: false,
	}),
};
