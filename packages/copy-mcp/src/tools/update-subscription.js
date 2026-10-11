// `update_subscription` — re-tune a follow by id: pause / resume / stop it, or
// change its sizing & guard rules. Write, idempotent.
//
// The API has two write shapes on POST /api/copy/subscriptions: a status-only
// transition ({ id, status }) and a full upsert keyed on (account, leader,
// network). This tool presents a single patch-by-id surface over both:
//   • status-only change  → one status POST.
//   • guard/sizing change → fetch the current row, merge the provided fields over
//     it, and upsert. The upsert re-activates the subscription, so when the
//     caller didn't ask to activate we restore the prior (or requested) status
//     afterward — editing guards never silently un-pauses a paused follow.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';
import { shapeSubscription } from '../lib/shapes.js';

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Sizing/guard fields this tool can patch. `network` is intentionally NOT here:
// the upsert is keyed on network, so changing it would fork a new subscription
// rather than edit this one.
const CONFIG_KEYS = [
	'copier_wallet', 'sizing_rule', 'fixed_sol', 'multiplier', 'pct_balance',
	'per_trade_cap_sol', 'min_order_sol', 'daily_budget_sol', 'max_open_copies',
	'mcap_floor_usd', 'mcap_ceiling_usd', 'copy_sells', 'require_safety_pass',
	'min_oracle_score', 'perf_fee_bps', 'telegram_chat_id',
];

async function findSubscription(id) {
	const data = await apiRequest('/api/copy/subscriptions');
	const rows = Array.isArray(data?.subscriptions) ? data.subscriptions : [];
	return rows.find((r) => r.id === id) || null;
}

async function setStatus(id, status) {
	const data = await apiRequest('/api/copy/subscriptions', { method: 'POST', body: { id, status } });
	return data?.subscription;
}

export const def = {
	name: 'update_subscription',
	title: 'Update a copy-trade subscription',
	annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	description:
		'Re-tune an existing copy-trade subscription by id. Pause it (stop new copies, keep the follow), resume it, stop it, and/or change its sizing rule and guard rules (caps, daily budget, market-cap band, oracle/safety gates, performance fee). MONEY-ADJACENT: guard changes alter how much of your SOL future copies may spend (non-custodial, intents only). Only the fields you pass change; the rest are preserved. Editing guards on a paused subscription keeps it paused unless you also set status:"active". Idempotent. Returns the updated subscription. Requires THREE_WS_API_KEY. Use this to pause, resume or re-size a follow you already have (ids come from list_subscriptions); to end it outright call cancel_subscription.',
	inputSchema: {
		id: z.string().uuid().describe('UUID of the subscription to update (from list_subscriptions).'),
		status: z.enum(['active', 'paused', 'stopped']).optional().describe('Set the lifecycle status: active (resume), paused (halt new copies, keep the follow), or stopped (end it, keeps history).'),
		copier_wallet: z.string().regex(BASE58_RE, 'must be a base58 Solana address').optional().describe('Change the Solana wallet that executes mirrored trades.'),
		sizing_rule: z.enum(['fixed', 'multiplier', 'pct_balance']).optional().describe('Change the sizing rule: fixed | multiplier | pct_balance.'),
		fixed_sol: z.number().positive().optional().describe('SOL per copy when sizing_rule="fixed".'),
		multiplier: z.number().positive().optional().describe('Multiple of the leader\'s entry when sizing_rule="multiplier".'),
		pct_balance: z.number().gt(0).max(100).optional().describe('Percent of your SOL per copy when sizing_rule="pct_balance" (0–100).'),
		per_trade_cap_sol: z.number().positive().optional().describe('Hard ceiling on any single copy, in SOL (> 0).'),
		min_order_sol: z.number().min(0).optional().describe('Skip dust copies below this, in SOL. Cannot exceed per_trade_cap_sol.'),
		daily_budget_sol: z.number().positive().optional().describe('Max SOL fanned out per UTC day (> 0).'),
		max_open_copies: z.number().int().min(1).max(100).optional().describe('Cap on concurrent pending copy intents (1–100).'),
		mcap_floor_usd: z.number().nonnegative().nullable().optional().describe('Skip coins below this market cap (USD). Pass null to clear the floor.'),
		mcap_ceiling_usd: z.number().nonnegative().nullable().optional().describe('Skip coins above this market cap (USD). Pass null to clear the ceiling.'),
		copy_sells: z.boolean().optional().describe('Whether to mirror the leader\'s exits as well as entries.'),
		require_safety_pass: z.boolean().optional().describe('Skip a copy when the coin\'s safety cannot be confirmed.'),
		min_oracle_score: z.number().int().min(0).max(100).nullable().optional().describe('Skip coins below this Oracle conviction score (0–100). Pass null to clear the gate.'),
		perf_fee_bps: z.number().int().min(0).max(3000).optional().describe('Leader\'s performance fee in basis points (0–3000).'),
		telegram_chat_id: z.string().regex(/^-?[0-9]+$/, 'must be a numeric Telegram chat ID').nullable().optional().describe('Telegram chat ID for copy-intent alerts. Pass null to clear.'),
	},
	async handler(args) {
		const { id } = args;
		const touchesConfig = CONFIG_KEYS.some((k) => args[k] !== undefined);

		// Pure status change (pause / resume / stop) — single transition.
		if (!touchesConfig) {
			if (!args.status) {
				throw Object.assign(new Error('Nothing to update: pass status and/or at least one sizing/guard field.'), {
					code: 'no_changes',
					status: 400,
				});
			}
			const subscription = await setStatus(id, args.status);
			if (!subscription) {
				throw Object.assign(new Error('No such subscription.'), { code: 'not_found', status: 404 });
			}
			return { ok: true, subscription: shapeSubscription(subscription) };
		}

		// Guard/sizing change — merge over the current row, then upsert.
		const existing = await findSubscription(id);
		if (!existing) {
			throw Object.assign(new Error('No such subscription.'), { code: 'not_found', status: 404 });
		}

		const pick = (key) => (args[key] !== undefined ? args[key] : existing[key]);
		const body = {
			leader_agent_id: existing.leader_agent_id,
			network: existing.network,
			copier_wallet: pick('copier_wallet'),
			sizing_rule: pick('sizing_rule'),
			fixed_sol: pick('fixed_sol'),
			multiplier: pick('multiplier'),
			pct_balance: pick('pct_balance'),
			per_trade_cap_sol: pick('per_trade_cap_sol'),
			min_order_sol: pick('min_order_sol'),
			daily_budget_sol: pick('daily_budget_sol'),
			max_open_copies: pick('max_open_copies'),
			mcap_floor_usd: pick('mcap_floor_usd'),
			mcap_ceiling_usd: pick('mcap_ceiling_usd'),
			copy_sells: pick('copy_sells'),
			require_safety_pass: pick('require_safety_pass'),
			min_oracle_score: pick('min_oracle_score'),
			perf_fee_bps: pick('perf_fee_bps'),
			telegram_chat_id: pick('telegram_chat_id'),
		};

		const upserted = await apiRequest('/api/copy/subscriptions', { method: 'POST', body });
		let subscription = upserted?.subscription;

		// The upsert forces status='active'. Restore the intended status unless the
		// caller explicitly asked to activate.
		const desiredStatus = args.status ?? existing.status;
		if (subscription && desiredStatus !== 'active') {
			subscription = (await setStatus(id, desiredStatus)) ?? subscription;
		}

		return { ok: true, subscription: shapeSubscription(subscription) };
	},
};
