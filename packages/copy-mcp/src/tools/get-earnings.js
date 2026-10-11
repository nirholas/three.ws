// `get_earnings` — copy-trade performance-fee accounting. Read-only.
//
// Wraps GET /api/copy/earnings. Two modes off one route:
//   • no agent_id → the authenticated copier's own fees OWED across the leaders
//     they copy, per subscription (account-scoped; needs THREE_WS_API_KEY).
//   • agent_id    → a leader's PUBLIC aggregate copy earnings (the "this trader
//     has earned X for being copied" social-proof figure; no key required).
//
// Every figure is real: realized copy profit above each subscription's
// high-water mark, charged at the leader's perf_fee_bps, settled in $THREE.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'get_earnings',
	title: 'Copy-trade earnings & fees owed',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Read copy-trade performance-fee accounting. Without agent_id: the authenticated account\'s own fees OWED across every leader they copy: a total plus a per-subscription breakdown (cumulative realized copy profit, closed copies, billable profit above the high-water mark, and the fee). With agent_id: a leader\'s PUBLIC aggregate earnings (active copiers, accrued fee, total copier profit). This is the social-proof figure: no per-copier identity exposed and no API key required. All figures are real: realized copy profit above each subscription\'s high-water mark at the leader\'s fee, settled in $THREE. Read-only. Use this to see the fees you owe the leaders you copy, or to check a leader\'s copy track record before following them with create_subscription.',
	inputSchema: {
		agent_id: z
			.string()
			.uuid()
			.optional()
			.describe('Optional leader agent UUID. Provide it for that leader\'s public aggregate earnings; omit it for your own fees-owed rollup (requires THREE_WS_API_KEY).'),
		network: z.enum(['mainnet', 'devnet']).default('mainnet').describe('Solana network for the leader aggregate (default mainnet). Ignored for your own rollup.'),
	},
	async handler(args) {
		// Public leader aggregate — no credential required.
		if (args.agent_id) {
			const data = await apiRequest('/api/copy/earnings', {
				query: { agent_id: args.agent_id, network: args.network },
				auth: false,
			});
			return {
				ok: true,
				scope: 'leader',
				agent_id: data?.agent_id ?? args.agent_id,
				network: data?.network ?? args.network,
				copiers: Number(data?.copiers) || 0,
				accrued_fee_sol: Number(data?.accrued_fee_sol) || 0,
				copier_profit_sol: Number(data?.copier_profit_sol) || 0,
			};
		}

		// The authenticated copier's own fees owed.
		const data = await apiRequest('/api/copy/earnings');
		const items = Array.isArray(data?.items) ? data.items : [];
		return {
			ok: true,
			scope: 'mine',
			total_fee_owed_sol: Number(data?.total_fee_owed_sol) || 0,
			count: items.length,
			items,
		};
	},
};
