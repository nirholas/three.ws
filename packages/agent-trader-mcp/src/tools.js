// The agent-trader tools. WARNING: arm and guardrails can move real SOL when an
// agent is armed in live mode. Defaults are the safe ones: mode is simulate,
// live needs an explicit confirm_live, disarm needs only an agent id.
//
// Every boundary (per-trade SOL, daily SOL cap, max open, the signed real-funds
// agreement) is enforced by the three.ws backend. These tools surface a refusal
// verbatim (risk_ack_required plus the signing link) and never decide it.

import { z } from 'zod';

import { apiRequest } from './lib/api.js';

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const AGENT_ID = z.string().uuid().describe('UUID of a three.ws agent you own.');
const NETWORK = z.enum(['mainnet', 'devnet']).default('mainnet').describe('Solana network. Default mainnet.');
const TIERS = ['prime', 'strong', 'lean', 'watch'];
const CATEGORIES = ['meme', 'tech', 'ai', 'culture', 'community', 'political', 'news', 'animal', 'celebrity', 'utility', 'unknown'];

export const GETTING_STARTED_TEXT = [
	'WARNING: this server can move real SOL. An agent armed in live mode buys from its own custodial Solana wallet.',
	'',
	'Safe defaults: agent_arm uses mode "simulate" (no spend). Going live needs mode "live" AND confirm_live true, a signed real-funds agreement on the account, and stays inside the per-trade, daily and max-open caps the server enforces.',
	'',
	'Flow:',
	'1. agent_guardrails: read the spend limits and kill switch for the agent first.',
	'2. agent_arm in simulate mode. Watch it with agent_status, agent_actions and agent_positions.',
	'3. agent_performance: the track record. Only consider live once simulate results justify it.',
	'4. agent_disarm: the kill switch. It needs only the agent id and stops the agent on mainnet and devnet.',
	'',
	'If agent_arm returns risk_ack_required, the account has not signed the Terms, Risk Disclosure and Agent Wallet Agreement. Nothing was armed. Open the signing link in the response, sign, then retry.',
	'',
	'For read-only market data with no key, use @three-ws/oracle-mcp.',
].join('\n');

/**
 * Turn a thrown API error into a payload that keeps the server's refusal intact.
 * The upstream body is merged at the top level so risk_ack_required and the
 * signing link reach the model exactly as the server wrote them.
 */
export function refusal(err) {
	const body = err?.body && typeof err.body === 'object' ? err.body : {};
	return {
		ok: false,
		...body,
		error: body.error || err?.code || 'unhandled',
		message: body.message || body.error_description || err?.message || String(err),
		...(err?.status ? { status: err.status } : {}),
	};
}

async function guarded(fn) {
	try {
		return await fn();
	} catch (err) {
		return refusal(err);
	}
}

const WATCH = '/api/oracle/watch';

export const TOOLS = [
	{
		name: 'trader_getting_started',
		title: 'Agent trader getting started',
		description:
			'Explain how to arm an agent on the Oracle, watch it, and stop it, and say plainly that this server can move real SOL. Use this first when you have not armed an agent before.',
		annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
		inputSchema: {},
		async handler() {
			return GETTING_STARTED_TEXT;
		},
	},
	{
		name: 'agent_arm',
		title: 'Arm an agent on the Oracle',
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
		description:
			'Arm an agent to buy coins that cross a conviction score, from its own custodial wallet. Mode defaults to simulate, which spends nothing. Live mode spends real SOL and needs mode live plus confirm_live true, and the server also requires a signed real-funds agreement: an unsigned account gets risk_ack_required and a signing link, and nothing is armed. Use this when the owner wants an agent to act on Oracle calls; read agent_guardrails first.',
		inputSchema: {
			agent_id: AGENT_ID,
			mode: z.enum(['simulate', 'live']).default('simulate').describe('simulate (default) spends nothing. live spends real SOL.'),
			confirm_live: z.boolean().optional().describe('Must be true to arm live. Ignored in simulate.'),
			network: NETWORK,
			min_score: z.number().int().min(0).max(100).optional().describe('Minimum conviction score (default 80).'),
			min_tier: z.enum(TIERS).optional().describe('Minimum tier (default strong).'),
			categories: z.array(z.enum(CATEGORIES)).optional().describe('Only these narratives. Empty means all.'),
			per_trade_sol: z.number().min(0.001).max(5).optional().describe('SOL per buy (default 0.05, max 5).'),
			max_daily_sol: z.number().min(0.001).max(50).optional().describe('Daily SOL ceiling (default the larger of 0.5 and ten buys).'),
			max_open: z.number().int().min(1).max(50).optional().describe('Most open positions at once (default 5).'),
			require_smart_money: z.boolean().optional().describe('Require a proven wallet in the coin (default true).'),
			size_scaling: z.boolean().optional().describe('Scale buy size with score.'),
		},
		async handler(args = {}) {
			const mode = args.mode === 'live' ? 'live' : 'simulate';
			if (mode === 'live' && args.confirm_live !== true) {
				return {
					ok: false,
					error: 'confirm_live_required',
					message:
						'Live mode spends real SOL from the agent wallet. Nothing was armed. Call again with mode "live" and confirm_live true only when the owner has said yes, or arm in simulate mode.',
				};
			}
			return guarded(async () => {
				const body = {
					agent_id: args.agent_id,
					armed: true,
					mode,
					network: args.network || 'mainnet',
					min_score: args.min_score,
					min_tier: args.min_tier,
					categories: args.categories,
					per_trade_sol: args.per_trade_sol,
					max_daily_sol: args.max_daily_sol,
					max_open: args.max_open,
					require_smart_money: args.require_smart_money,
					size_scaling: args.size_scaling,
				};
				for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
				const data = await apiRequest(WATCH, { method: 'POST', body });
				return { ok: true, ...data };
			});
		},
	},
	{
		name: 'agent_disarm',
		title: 'Disarm an agent (kill switch)',
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
		description:
			'Stop an agent from acting on the Oracle. The kill switch: it needs only the agent id, keeps the agent\'s other settings, and disarms it on mainnet and devnet. Use this when something looks wrong or the owner wants the agent to stop buying.',
		inputSchema: { agent_id: AGENT_ID },
		async handler(args = {}) {
			const results = {};
			let failed = false;
			for (const network of ['mainnet', 'devnet']) {
				const out = await guarded(async () => {
					let current = null;
					try {
						current = (await apiRequest(WATCH, { query: { agent_id: args.agent_id, network } }))?.watch ?? null;
					} catch {
						current = null;
					}
					// Re-save the existing knobs so a disarm never resets the agent's
					// configuration to defaults. If the read failed, disarm anyway.
					const body = { agent_id: args.agent_id, network, armed: false };
					if (current) {
						for (const k of ['mode', 'min_score', 'min_tier', 'categories', 'per_trade_sol', 'max_daily_sol', 'max_open', 'require_smart_money', 'size_scaling']) {
							if (current[k] !== undefined && current[k] !== null) body[k] = current[k];
						}
					}
					const data = await apiRequest(WATCH, { method: 'POST', body });
					return { ok: true, armed: data?.watch?.armed ?? false };
				});
				if (out.ok === false) failed = true;
				results[network] = out;
			}
			return { ok: !failed, agent_id: args.agent_id, results, ...(failed ? { message: 'At least one network did not confirm the disarm. Call agent_disarm again, or use agent_status to check.' } : { message: 'Agent disarmed. It will not place new buys.' }) };
		},
	},
	{
		name: 'agent_status',
		title: 'Agent watch status',
		annotations: READ,
		description:
			'Read whether an agent is armed, in which mode, with which score floor and spend caps, plus its recent actions and summary. Use this to confirm an arm or disarm took effect.',
		inputSchema: { agent_id: AGENT_ID, network: NETWORK },
		async handler(args = {}) {
			return guarded(async () => ({ ok: true, ...(await apiRequest(WATCH, { query: { agent_id: args.agent_id, network: args.network } })) }));
		},
	},
	{
		name: 'agent_actions',
		title: 'Agent actions',
		annotations: READ,
		description:
			'List what an agent actually did on Oracle calls: coin, score, size, mode and outcome, newest first. Use this to audit an agent or to see why it did or did not buy.',
		inputSchema: {
			agent_id: AGENT_ID,
			network: NETWORK,
			mode: z.enum(['live', 'simulate']).optional(),
			outcome: z.enum(['win', 'loss', 'flat', 'open']).optional(),
			limit: z.number().int().min(1).max(100).default(25),
			before: z.string().optional().describe('Pagination cursor (an ISO time) from the last row.'),
		},
		async handler(args = {}) {
			return guarded(async () => ({
				ok: true,
				...(await apiRequest('/api/oracle/activity', {
					auth: false,
					query: { agent_id: args.agent_id, network: args.network, mode: args.mode, outcome: args.outcome, limit: args.limit ?? 25, before: args.before },
				})),
			}));
		},
	},
	{
		name: 'agent_performance',
		title: 'Agent track record',
		annotations: READ,
		description:
			'Read an agent\'s win rate, realized profit and loss and ROI with its recent actions. An agent with no history returns an empty summary, which means no track record yet. Use this before moving an agent from simulate to live.',
		inputSchema: { agent_id: AGENT_ID, network: NETWORK, limit: z.number().int().min(1).max(100).default(20) },
		async handler(args = {}) {
			return guarded(async () => ({
				ok: true,
				...(await apiRequest('/api/oracle/agent-stats', { auth: false, query: { agent_id: args.agent_id, network: args.network, limit: args.limit ?? 20 } })),
			}));
		},
	},
	{
		name: 'agent_positions',
		title: 'Agent open positions',
		annotations: READ,
		description:
			'List the positions an agent currently holds from Oracle calls (actions whose outcome is still open). Use this to see exposure before changing guardrails or disarming.',
		inputSchema: { agent_id: AGENT_ID, network: NETWORK, mode: z.enum(['live', 'simulate']).optional(), limit: z.number().int().min(1).max(100).default(50) },
		async handler(args = {}) {
			return guarded(async () => ({
				ok: true,
				...(await apiRequest('/api/oracle/activity', {
					auth: false,
					query: { agent_id: args.agent_id, network: args.network, mode: args.mode, outcome: 'open', limit: args.limit ?? 50 },
				})),
			}));
		},
	},
	{
		name: 'agent_guardrails',
		title: 'Agent spend guardrails',
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
		description:
			'Read the agent\'s trade guardrails (per-trade SOL cap, daily budget, price impact, slippage, concurrency, due-diligence limits, kill switch) and today\'s spend, or change them by passing fields. With no field it only reads. A cleared cap is sent as null and is a real relaxation, so only do that when the owner asks. Use this before arming, and to tighten limits or flip the kill switch.',
		inputSchema: {
			agent_id: AGENT_ID,
			network: NETWORK,
			per_trade_sol: z.number().min(0).nullable().optional().describe('Per-trade SOL cap. null clears it.'),
			daily_budget_sol: z.number().min(0).nullable().optional().describe('Daily SOL budget. null clears it.'),
			max_price_impact_pct: z.number().min(0).max(100).optional(),
			max_slippage_bps: z.number().min(0).max(10000).optional(),
			max_concurrent: z.number().int().min(1).nullable().optional(),
			max_insider_pct: z.number().min(0).max(100).nullable().optional(),
			max_sniper_pct: z.number().min(0).max(100).nullable().optional(),
			max_bundler_pct: z.number().min(0).max(100).nullable().optional(),
			max_fresh_wallet_pct: z.number().min(0).max(100).nullable().optional(),
			kill_switch: z.boolean().optional().describe('true halts all discretionary trades for the agent.'),
		},
		async handler(args = {}) {
			const { agent_id, network, ...patch } = args;
			for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];
			const path = `/api/agents/${encodeURIComponent(agent_id)}/trade/limits`;
			return guarded(async () => {
				if (Object.keys(patch).length === 0) {
					return { ok: true, ...(await apiRequest(path, { query: { network } })) };
				}
				return { ok: true, ...(await apiRequest(path, { method: 'PUT', body: patch })) };
			});
		},
	},
];
