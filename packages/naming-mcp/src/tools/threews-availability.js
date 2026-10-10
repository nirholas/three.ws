// `threews_availability` — check whether <label>.threews.sol is free to claim
// as an agent identity. Read-only.
//
// Wraps GET /api/threews/subdomain?label=<label>.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'threews_availability',
	title: 'Check if a *.threews.sol agent identity is available',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Check whether "<label>.threews.sol" is available to claim as a three.ws agent identity. Returns the full domain, availability, the current owner wallet if taken, the on-chain check status ("ok" or "unavailable" if the Solana RPC was degraded), and the public showcase URL for a claimed handle. Minting the subdomain is an authenticated write on the HTTP API; this tool is the public read. Use this before claiming a *.threews.sol handle for an agent to confirm it is free. Read-only.',
	inputSchema: {
		label: z
			.string()
			.min(1)
			.describe('The label to check, e.g. "nick" for "nick.threews.sol" (1–63 chars of [a-z0-9-]).'),
	},
	async handler(args) {
		const label = String(args?.label ?? '').trim();
		const data = await apiRequest('/api/threews/subdomain', { query: { label } });
		const result = data?.data ?? {};
		return {
			ok: true,
			full: result.full ?? null,
			label: result.label ?? null,
			available: Boolean(result.available),
			owner: result.owner ?? null,
			on_chain_check: result.on_chain_check ?? null,
			showcase_url: result.showcase_url ?? null,
		};
	},
};
