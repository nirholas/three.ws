// `subscribe_signal` — subscribe one of your agents to a signal feed (create or
// update the subscription). Account-scoped write, idempotent upsert.
//
// Wraps POST /api/signals/subscribe (Authorization: Bearer <THREE_WS_API_KEY>).

import { z } from 'zod';

import { apiRequest, requireApiKey } from '../lib/api.js';

export const def = {
	name: 'subscribe_signal',
	title: 'Subscribe an agent to a signal feed',
	annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	description:
		'Subscribe one of YOUR agents to a signal feed so it copy-trades the publisher. Idempotent: a feed is ' +
		'keyed by (subscriber agent, feed) — re-calling updates the existing subscription instead of creating a ' +
		'duplicate. A new subscription starts at the current emission head, so it is never charged for or made to ' +
		'mirror signals emitted before it subscribed.\n\n' +
		'PAYMENT & RISK: `mode:"simulate"` (default) mirrors WITHOUT paying or trading — it sizes and labels the ' +
		'orders for trust-building, spends nothing. `mode:"live"` BOTH pays the publisher in USDC (x402, ' +
		'per-signal or per-epoch per the feed pricing) AND auto-mirrors real on-chain trades from the subscriber ' +
		"agent's custodial wallet, within its spend policy. Money moves at delivery time (when the publisher emits " +
		'a signal), not at the moment you call this tool. Use set_subscription_status with killed:true to halt all ' +
		'further pay/trade instantly. Requires THREE_WS_API_KEY; the agent must be owned by that account. ' +
		'Use this after picking a feed with list_signal_feeds; start in simulate mode and switch to live only on the owner\'s explicit say-so.',
	inputSchema: {
		agent_id: z
			.string()
			.min(1)
			.describe('ID of the subscriber agent (must be owned by the authenticated account). This agent pays and mirrors.'),
		feed_id: z
			.number()
			.int()
			.positive()
			.describe('Numeric feed id to follow (from list_signal_feeds — the `id` field). The feed must be active.'),
		mode: z
			.enum(['simulate', 'live'])
			.default('simulate')
			.describe('simulate = no pay, no trade (default, safe). live = pays USDC AND auto-mirrors real trades.'),
		billing: z
			.enum(['per_signal', 'per_epoch'])
			.default('per_signal')
			.describe('How live mode is charged: per_signal (each entry) or per_epoch (a flat fee per epoch window).'),
		base_sol: z
			.number()
			.min(0.001)
			.max(10)
			.optional()
			.describe('Base order size in SOL before the per-signal size multiple/scaling (0.001–10, default 0.05).'),
		size_scaling: z
			.number()
			.min(0.01)
			.max(20)
			.optional()
			.describe('Multiplier applied on top of the base size (0.01–20, default 1).'),
		max_per_trade_sol: z
			.number()
			.min(0.001)
			.max(50)
			.optional()
			.describe('Hard cap on any single mirrored order in SOL (0.001–50, default 0.25).'),
		slippage_bps: z
			.number()
			.int()
			.min(0)
			.max(5000)
			.optional()
			.describe('Max slippage in basis points for mirrored trades (0–5000, default 300 = 3%).'),
		firewall_level: z
			.enum(['block', 'warn'])
			.default('block')
			.describe('Risk firewall on mirrored buys: block (refuse risky trades, default) or warn (allow with a flag).'),
		copy_exits: z
			.boolean()
			.default(true)
			.describe('Mirror the publisher\'s exits too (sell when they sell). Default true.'),
	},
	async handler(args) {
		requireApiKey();
		const body = {
			agent_id: String(args?.agent_id ?? '').trim(),
			feed_id: Number(args?.feed_id),
			mode: args?.mode === 'live' ? 'live' : 'simulate',
			billing: args?.billing === 'per_epoch' ? 'per_epoch' : 'per_signal',
			firewall_level: args?.firewall_level === 'warn' ? 'warn' : 'block',
			copy_exits: args?.copy_exits !== false,
		};
		if (args?.base_sol != null) body.base_sol = Number(args.base_sol);
		if (args?.size_scaling != null) body.size_scaling = Number(args.size_scaling);
		if (args?.max_per_trade_sol != null) body.max_per_trade_sol = Number(args.max_per_trade_sol);
		if (args?.slippage_bps != null) body.slippage_bps = Math.round(Number(args.slippage_bps));

		const data = await apiRequest('/api/signals/subscribe', { method: 'POST', body });
		return {
			ok: true,
			subscription: data?.subscription ?? null,
		};
	},
};
