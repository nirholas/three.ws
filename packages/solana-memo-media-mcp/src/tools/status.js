import { getRpcUrls } from '../lib/rpc.js';

export const def = {
	name: 'get_solana_memo_media_status',
	title: 'Solana memo media capability',
	annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
	description: 'Report the local decoding policy and ordered Solana RPC failover hosts. No network call is made and no data is stored.',
	inputSchema: {},
	async handler() { return { ok: true, accepted_mime_types: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], max_decoded_bytes: 262144, rpc_hosts: getRpcUrls().map((url) => new URL(url).host), local_decoding: true, writes: false }; },
};
