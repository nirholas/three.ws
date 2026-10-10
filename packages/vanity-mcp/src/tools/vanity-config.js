// `vanity_config` — market payout availability + asset/network metadata. Read-only.
//
// Wraps GET /api/vanity/bounties?view=config. Reflects live deployment config
// (which escrow networks are wired, whether payouts are configured), so it can
// change between deploys — NOT idempotent.

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'vanity_config',
	title: 'Bounty market config: payout + asset metadata',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Read the grind-bounty market configuration: whether on-chain payouts are configured (can a winner actually be paid?), the settlement asset (USDC) and its decimals, which escrow networks are live (Base / Solana), the pricing band (floor + max atomics), the bounty protocol version, and the sealed-envelope scheme. Call this before posting a bounty to confirm the market can pay out. Read-only, no params.',
	inputSchema: {},
	async handler() {
		const data = await apiRequest('/api/vanity/bounties', { query: { view: 'config' } });
		return { ok: true, ...data };
	},
};
