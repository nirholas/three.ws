// `get_fee_info` — the current platform fee rate. Public, no auth. Read-only.
//
// Wraps GET /api/billing/fee-info. The platform's cut on marketplace sales, used
// to reason about net vs gross before a charge settles. This is the one read on
// this server that needs no session — it returns no private data.

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'get_fee_info',
	title: 'Current platform fee rate',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'The current three.ws platform fee rate — the cut taken on marketplace sales, so an agent can reason about ' +
		'net vs gross before a charge settles. Returns `fee_bps` (basis points, e.g. 250 = 2.5%) and `fee_percent` ' +
		'(the same rate as a human string, e.g. "2.5"). Public: needs no session or credential. Read-only. ' +
		'Use this to work out what a seller nets from a marketplace sale before quoting a price.',
	inputSchema: {},
	async handler() {
		const data = await apiRequest('/api/billing/fee-info');
		return {
			ok: true,
			fee_bps: data?.fee_bps ?? null,
			fee_percent: data?.fee_percent ?? null,
		};
	},
};
