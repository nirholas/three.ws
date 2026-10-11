// `sns_resolve` — resolve a Solana .sol name to its owner wallet. Read-only.
//
// Wraps GET /api/sns?name=<label>[.sol].
//
// Proof-of-port for @three-ws/tool-sdk (see packages/tool-sdk/): this is the
// same tool as before (name, schema, description, behavior), now authored
// with defineTool/defineExecutor/toMcpTools instead of a hand-written `def`
// object. `apiRequest` already implements its own abort-timeout fetch (see
// ../lib/api.js), so it is kept as the transport — `guardedFetch` is not
// layered on top here, to avoid changing timeout/abort semantics for this
// port. The declared `network` permission documents the host it talks to.

import { z } from 'zod';

import { defineTool, defineExecutor, toMcpTools } from '@three-ws/tool-sdk';

import { apiRequest } from '../lib/api.js';
import { THREE_WS_BASE } from '../config.js';

const tool = defineTool({
	id: 'naming-mcp-sns-resolve',
	title: 'Resolve a .sol name to its owner wallet',
	description:
		'Resolve a Solana Name Service (.sol) name to the base58 wallet address that owns it. Accepts a bare label, a subdomain, or the full name with or without the trailing ".sol". Returns the owner address, or resolved:false when the name is unregistered. Mainnet only. Use this before sending to a .sol name so funds reach the wallet that owns it; for wallet to name call sns_reverse. Read-only.',
	version: '1.0.0',
	permissions: { network: [new URL(THREE_WS_BASE).hostname] },
	apis: [
		{
			name: 'sns_resolve',
			title: 'Resolve a .sol name to its owner wallet',
			description:
				'Resolve a Solana Name Service (.sol) name to the base58 wallet address that owns it. Accepts a bare label, a subdomain, or the full name with or without the trailing ".sol". Returns the owner address, or resolved:false when the name is unregistered. Mainnet only. Use this before sending to a .sol name so funds reach the wallet that owns it; for wallet to name call sns_reverse. Read-only.',
			annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
			parameters: z.object({
				name: z
					.string()
					.min(1)
					.describe('A .sol label to resolve, e.g. "bonfida", "nick.threews", or "bonfida.sol" (the .sol suffix is optional).'),
			}),
		},
	],
});

const executor = defineExecutor(tool, {
	async sns_resolve({ name }) {
		const data = await apiRequest('/api/sns', { query: { name } });
		const result = data?.data ?? {};
		return {
			ok: true,
			name: result.name ?? null,
			address: result.address ?? null,
			resolved: Boolean(result.resolved),
		};
	},
});

export const def = toMcpTools(tool, executor)[0];
