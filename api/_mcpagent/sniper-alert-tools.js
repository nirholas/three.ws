// threews-agent MCP: the launch sniper, signal-feed subscriptions, and pump
// alert rules.
//
// Thin adapters over the stores the human surfaces use, so an agent's change is
// the row the dashboard would have written:
//   api/_lib/sniper-control.js               /sniper and POST /api/sniper/strategy
//   api/_lib/signal-subscription-control.js  /signals and POST /api/signals/subscribe
//   api/_lib/pump-alert-rules.js             /pump-dashboard and /api/alerts/rules
//
//   read       sniper_status, sniper_activate_preview, alert_rule_list
//   write      sniper_deactivate, sniper_subscribe (paper mode only),
//              alert_rule_create
//   financial  sniper_activate: arms a strategy that spends SOL from the agent's
//              wallet on new launches. Needs confirm_spend: true and a
//              preview_id from sniper_activate_preview for the same agent,
//              network and sizing, and on mainnet the signed real-funds
//              agreement.
//              alert_rule_delete: cannot be undone. Needs confirm_delete: true
//              and a preview_id from alert_rule_list for the same rule_id.
//
// Alert rules created here deliver to the owner: the bell, Web Push and the
// iOS app, and the Telegram and Discord chats the owner paired, each gated by
// the owner's notification preferences (api/_lib/alert-delivery.js). Webhook
// and per-rule Telegram targets are configured on /pump-dashboard by the owner,
// never by an agent.

import { hasScope } from '../_lib/auth.js';
import { limits } from '../_lib/rate-limit.js';
import { currentSignatureFor, agreementRequirement } from '../_lib/real-funds-agreement.js';
import {
	SNIPER_TRIGGERS, SniperControlError, sniperStatus, previewActivation, activateSniper, deactivateSniper,
} from '../_lib/sniper-control.js';
import {
	SignalSubscriptionError, listSignalSubscriptions, listSubscribableFeeds, loadSignalSubscription,
	loadSubscribableFeed, existingSubscription, subscriptionKnobs, upsertSignalSubscription,
	setSignalSubscriptionStatus, setSignalSubscriptionKilled,
} from '../_lib/signal-subscription-control.js';
import {
	AlertRuleError, MAX_RULES_PER_USER, listAlertRules, createAlertRule, deleteAlertRule,
} from '../_lib/pump-alert-rules.js';
import { describeLaunchFilters, LAUNCH_RISK_FLAGS } from '../_lib/pump-alert-eval.js';
import { RULE_KINDS } from '../alerts/_rules.js';
import { isUuid } from '../_lib/validate.js';
import { sql } from '../_lib/db.js';

// Stored state, no chain reads: the same arguments read the same rows.
const STORED_READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
// Reads the live wallet balance over RPC, so the answer moves.
const LIVE_READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true };
// Arms a worker that buys launches on chain from the agent's wallet.
const ARM = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true };
// Settings writes that converge: repeating the call leaves the same state.
const SETTLE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
// Each call adds a new row.
const CREATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
// Removes a row for good; a second call finds nothing to remove.
const DELETE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };

const TRADE_SCOPES = ['wallet:trade', 'agents:write'];

function refusal(text, reason, extra = {}) {
	return { content: [{ type: 'text', text }], structuredContent: { ok: false, reason, ...extra }, isError: true };
}

async function enforce(auth) {
	const rl = await limits.mcpAgent(auth.userId || auth.rateKey || 'anon');
	if (!rl.success) {
		throw Object.assign(new Error('rate_limited'), { code: -32000, data: { retry_after: Math.ceil((rl.reset - Date.now()) / 1000) } });
	}
}

const anyScope = (granted, scopes) => scopes.some((s) => hasScope(granted, s));

/**
 * Sign-in, scope and error handling shared by every tool here. `scopes` is a
 * list where any one grant suffices. A designed store error becomes a designed
 * tool result; anything else reaches the dispatcher's sanitizer.
 */
async function run(auth, { scopes }, fn) {
	await enforce(auth);
	if (!auth.userId) return refusal('Sign in to three.ws to act on your agents.', 'auth_required', { signed_in: false });
	if (!anyScope(auth.scope, scopes)) {
		return refusal(`This action needs the ${scopes.join(' or ')} scope. Re-authorize with it granted.`, 'insufficient_scope', { required: scopes[0] });
	}
	try {
		return await fn();
	} catch (err) {
		if (err instanceof SniperControlError || err instanceof SignalSubscriptionError || err instanceof AlertRuleError) {
			return refusal(err.message, err.code, err.issues ? { issues: err.issues } : {});
		}
		if (err?.code === 'validation_error' && err.status === 400) {
			return refusal(err.message, 'validation_error', err.issues ? { issues: err.issues } : {});
		}
		throw err;
	}
}

async function requireAgreement(userId) {
	let signed;
	try {
		signed = await currentSignatureFor(userId);
	} catch {
		return refusal('Could not verify your signed real-funds agreements, so nothing was armed. Try again in a moment.', 'agreement_check_unavailable');
	}
	if (signed) return null;
	const r = agreementRequirement();
	return refusal(`Sign the real-funds agreements before arming a mainnet sniper. Nothing was armed. Sign at ${r.sign_url}`, 'risk_ack_required', r);
}

const ok = (lines, structured) => ({ content: [{ type: 'text', text: lines.filter(Boolean).join('\n') }], structuredContent: structured });
const sol = (n) => (n == null ? 'n/a' : `${Number(n).toFixed(4)} SOL`);

const agentIdProp = { type: 'string', format: 'uuid', description: 'The agent whose sniper to act on. wallet_status or three://agents lists yours.' };
const networkProp = { type: 'string', enum: ['mainnet', 'devnet'], default: 'mainnet', description: 'Solana cluster. devnet arms a strategy with no real funds at risk.' };
const sizingProps = {
	per_trade_sol: { type: 'number', exclusiveMinimum: 0, maximum: 100, description: 'SOL spent on each launch the strategy buys.' },
	daily_budget_sol: { type: 'number', exclusiveMinimum: 0, maximum: 1000, description: 'Most SOL the strategy may commit per UTC day. Must be at least per_trade_sol.' },
	stop_loss_pct: { type: 'number', exclusiveMinimum: 0, maximum: 95, description: 'Mandatory stop loss. Keeps the stored value (30 for a new strategy) when omitted.' },
	take_profit_pct: { type: 'number', exclusiveMinimum: 0, maximum: 10000, description: 'Optional take profit. Keeps the stored value when omitted.' },
	trigger: { type: 'string', enum: SNIPER_TRIGGERS, description: 'What makes a launch a candidate. Keeps the stored trigger (new_mint for a new strategy) when omitted.' },
	max_concurrent_positions: { type: 'integer', minimum: 1, maximum: 50, description: 'Open positions allowed at once.' },
};

function strategyLine(s) {
	const state = s.armed ? 'ARMED' : s.kill_switch ? 'killed' : 'off';
	return `- ${s.agent_name} on ${s.network}: ${state}. ${sol(s.per_trade_sol)} per trade, ${sol(s.daily_budget_sol)} a day (${sol(s.spent_today_sol)} committed today), stop loss ${s.stop_loss_pct}%, trigger ${s.trigger}. Positions: ${s.positions.open} open, ${s.positions.closed} closed, realized ${sol(s.positions.realized_pnl_sol)}.`;
}

function ruleLine(r) {
	const state = r.enabled ? 'on' : 'paused';
	const fired = r.last_fired_at ? `, last fired ${new Date(r.last_fired_at).toISOString()}` : ', never fired';
	return `- [${r.id}] ${r.label || r.kind} (${r.kind}, ${state}${fired})${r.kind === 'launch_match' && r.filters ? `: ${describeLaunchFilters(r.filters)}` : ''}`;
}

function subscriptionLine(s) {
	const state = s.killed ? 'KILLED' : s.status;
	return `- #${s.id} ${s.subscriber_name || s.subscriber_agent_id} follows "${s.feed?.title || s.feed_id}" (${s.mode}, ${state}, ${s.network}), base ${sol(s.base_sol)}, max ${sol(s.max_per_trade_sol)} per trade. Executed ${s.stats?.executed ?? 0}.`;
}

export const sniperAlertToolDefs = [
	{
		name: 'sniper_status',
		title: 'Sniper status',
		group: 'trading',
		tier: 'read',
		annotations: STORED_READ,
		description: "Your agents' launch-sniper strategies: armed or not, sizing, today's committed spend against the daily budget, stop loss and trigger, open and closed positions with realized P&L, and whether the sniper worker is live and on which network. Use this to check whether an agent's sniper is armed and how it is performing.",
		inputSchema: {
			type: 'object',
			properties: { agent_id: { ...agentIdProp, description: 'Narrow to one agent. Omit for every agent you own.' }, network: { type: 'string', enum: ['mainnet', 'devnet'] } },
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, { scopes: ['wallet:read', 'wallet:trade'] }, async () => {
			const st = await sniperStatus({ userId: auth.userId, agentId: args.agent_id || null, network: args.network || null });
			const w = st.worker;
			return ok([
				`Sniper worker: ${w.state}${w.network ? ` on ${w.network}` : ''}${w.global_kill ? ' (operator kill switch on)' : ''}.`,
				st.strategies.length ? `${st.armed_count} of ${st.strategies.length} strategies armed:` : 'No sniper strategies yet. sniper_activate_preview shows what arming one would do.',
				...st.strategies.map(strategyLine),
			], st);
		}),
	},
	{
		name: 'sniper_activate_preview',
		title: 'Preview arming the sniper',
		group: 'trading',
		tier: 'read',
		annotations: LIVE_READ,
		description: "What sniper_activate would arm, without writing anything: the agent and its wallet with its live SOL balance, the per-trade size and daily budget, the trigger and exits, what the SOL is spent on, whether real funds are at risk, and every check that would block it. Show this to the user before arming. Call this before sniper_activate, every time.",
		inputSchema: {
			type: 'object',
			properties: { agent_id: agentIdProp, network: networkProp, ...sizingProps },
			required: ['agent_id', 'per_trade_sol', 'daily_budget_sol'],
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, { scopes: ['wallet:read', 'wallet:trade'] }, async () => {
			const network = args.network || 'mainnet';
			const p = await previewActivation({ userId: auth.userId, agentId: args.agent_id, network, input: args });
			return ok([
				`Arm the ${p.trigger} sniper for ${p.agent.name} on Solana ${network}${p.real_funds ? ' (REAL FUNDS)' : ' (devnet, no real funds)'}.`,
				`Spends: up to ${sol(p.per_trade_sol)} per launch and ${sol(p.daily_budget_sol)} per UTC day, in ${p.asset}, from the agent wallet ${p.agent.wallet || '(none yet)'}.`,
				`Recipient: ${p.recipient}.`,
				`Exits: stop loss ${p.stop_loss_pct}%${p.take_profit_pct != null ? `, take profit ${p.take_profit_pct}%` : ''}. Up to ${p.max_concurrent_positions} open at once. Fires on ${p.trigger_description}.`,
				`Wallet balance: ${p.wallet_sol == null ? 'unreadable right now' : sol(p.wallet_sol)}.`,
				'Checks:',
				...p.checks.map((c) => `  ${c.ok ? '[ok]' : '[blocked]'} ${c.label}`),
				p.executable ? null : `Blocked by: ${p.blocked_by.join(', ')}. Fix that before arming.`,
			], p);
		}),
	},
	{
		name: 'sniper_activate',
		title: 'Arm the sniper',
		group: 'trading',
		tier: 'financial',
		confirmFlag: 'confirm_spend',
		previewTool: 'sniper_activate_preview',
		annotations: ARM,
		description: "Arm one of your agents' launch sniper with the sizing sniper_activate_preview showed: the worker then buys launches that pass the strategy's filters from the agent's own wallet, inside the daily budget, with a mandatory stop loss. Only the previewed knobs change; every other dashboard setting keeps its stored value. Mainnet needs your signed real-funds agreement. Treasury auto-funding is never switched on here. Call this after the owner approved what sniper_activate_preview showed.",
		inputSchema: {
			type: 'object',
			properties: { agent_id: agentIdProp, network: networkProp, ...sizingProps },
			required: ['agent_id', 'per_trade_sol', 'daily_budget_sol'],
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, { scopes: TRADE_SCOPES }, async () => {
			const network = args.network || 'mainnet';
			if (network === 'mainnet') {
				const blocked = await requireAgreement(auth.userId);
				if (blocked) return blocked;
			}
			const s = await activateSniper({ userId: auth.userId, agentId: args.agent_id, network, input: args });
			return ok([
				`Armed. ${s.agent_name} snipes ${s.trigger} launches on Solana ${network} with ${sol(s.per_trade_sol)} per trade and ${sol(s.daily_budget_sol)} a day, stop loss ${s.stop_loss_pct}%.`,
				'sniper_status shows its positions; sniper_deactivate disarms it at any time.',
			], { ok: true, strategy: s });
		}),
	},
	{
		name: 'sniper_deactivate',
		title: 'Disarm the sniper',
		group: 'trading',
		tier: 'write',
		annotations: SETTLE,
		description: "Disarm one of your agents' launch sniper so it opens no new positions. With kill: true the kill switch is set as well, which the dashboard shows and a later arm clears. Open positions keep their stop loss and exits. Repeating the call is harmless. Use this when the owner wants the sniper to stop buying, or with kill: true to stop it hard.",
		inputSchema: {
			type: 'object',
			properties: { agent_id: agentIdProp, network: networkProp, kill: { type: 'boolean', default: false, description: 'Also set the kill switch.' } },
			required: ['agent_id'],
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, { scopes: TRADE_SCOPES }, async () => {
			const network = args.network || 'mainnet';
			const s = await deactivateSniper({ userId: auth.userId, agentId: args.agent_id, network, kill: args.kill === true });
			if (!s.existed) return ok([`No ${network} sniper strategy exists for that agent, so there is nothing to disarm.`], { ok: true, ...s });
			return ok([`Disarmed ${s.agent_name} on ${network}${s.kill_switch ? ' and set the kill switch' : ''}. ${s.positions.open} positions remain open under their exits.`], { ok: true, strategy: s });
		}),
	},
	{
		name: 'sniper_subscribe',
		title: 'Follow a signal feed',
		group: 'trading',
		tier: 'write',
		annotations: SETTLE,
		description: "Copy another agent's published trade signals. action 'list' shows your subscriptions and the active public feeds you could follow. 'subscribe' starts (or updates) a paper-mode subscription for one of your agents: it mirrors the feed's entries and exits on paper with your sizing, paying nothing and trading nothing, so you can judge the feed first. 'pause', 'resume', 'stop' and 'kill' control an existing subscription. Live mode, which pays the feed in USDC and trades real funds, is switched on by the owner on /signals. Use this when the owner wants an agent to follow another trader's signals, starting on paper.",
		inputSchema: {
			type: 'object',
			properties: {
				action: { type: 'string', enum: ['list', 'subscribe', 'pause', 'resume', 'stop', 'kill'], default: 'list' },
				agent_id: { ...agentIdProp, description: 'subscribe: the agent that follows the feed.' },
				feed_id: { type: 'integer', minimum: 1, description: 'subscribe: the feed to follow (list shows them).' },
				subscription_id: { type: 'integer', minimum: 1, description: 'pause, resume, stop, kill: the subscription to change.' },
				network: { type: 'string', enum: ['mainnet', 'devnet'], default: 'mainnet', description: 'list: which feeds to show.' },
				base_sol: { type: 'number', minimum: 0.001, maximum: 10, description: 'Paper size of a 1x signal, in SOL.' },
				size_scaling: { type: 'number', minimum: 0.01, maximum: 20, description: 'Multiplier on the publisher\'s conviction.' },
				max_per_trade_sol: { type: 'number', minimum: 0.001, maximum: 50, description: 'Cap on any single mirrored entry.' },
				copy_exits: { type: 'boolean', default: true, description: 'Mirror the publisher\'s exits too.' },
			},
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, { scopes: TRADE_SCOPES }, async () => {
			const action = args.action || 'list';
			const userId = auth.userId;
			if (action === 'list') {
				const [subscriptions, feeds] = await Promise.all([
					listSignalSubscriptions(userId),
					listSubscribableFeeds({ network: args.network || 'mainnet', limit: 20 }),
				]);
				return ok([
					subscriptions.length ? `Your subscriptions (${subscriptions.length}):` : 'No subscriptions yet.',
					...subscriptions.map(subscriptionLine),
					feeds.length ? `Active public feeds on ${args.network || 'mainnet'}:` : `No public feeds are publishing on ${args.network || 'mainnet'} right now. Feeds appear on /signals as agents publish them.`,
					...feeds.map((f) => `- feed ${f.id} "${f.title}" by ${f.publisher_name}: ${f.price_per_signal_usdc} USDC per signal live, ${f.subscribers} followers (${f.url})`),
				], { subscriptions, feeds });
			}
			if (action === 'subscribe') {
				if (!isUuid(args.agent_id || '')) return refusal('subscribe needs agent_id, the agent that follows the feed.', 'invalid_agent');
				if (!args.feed_id) return refusal('subscribe needs feed_id. action "list" shows the feeds you can follow.', 'invalid_feed');
				const { owns, name } = await ownsAgent(userId, args.agent_id);
				if (!owns) return refusal('That agent is not one of yours.', 'not_your_agent');
				const feed = await loadSubscribableFeed(args.feed_id, args.agent_id);
				const current = await existingSubscription(args.agent_id, feed.id);
				if (current?.mode === 'live' && current.status !== 'stopped') {
					return refusal(`${name} already follows this feed live. Change a live subscription on /signals.`, 'live_subscription_exists', { subscription_id: Number(current.id) });
				}
				const subscription = await upsertSignalSubscription({ userId, agentId: args.agent_id, feed, knobs: subscriptionKnobs({ ...args, mode: 'simulate' }) });
				return ok([
					`${name} now follows "${feed.title}" on paper (#${subscription.id}): base ${sol(subscription.base_sol)}, max ${sol(subscription.max_per_trade_sol)} per trade, exits ${subscription.copy_exits ? 'copied' : 'not copied'}.`,
					'Nothing is paid and nothing trades in paper mode. The owner can switch it live on /signals.',
				], { ok: true, subscription, feed: { id: Number(feed.id), slug: feed.slug, title: feed.title, url: `/signals/${feed.slug}` } });
			}
			if (!args.subscription_id) return refusal(`${action} needs subscription_id. action "list" shows yours.`, 'invalid_id');
			const current = await loadSignalSubscription(args.subscription_id, userId);
			if (!current) return refusal('No subscription with that id is yours.', 'not_found');
			if (action === 'kill') {
				const subscription = await setSignalSubscriptionKilled({ userId, subId: args.subscription_id, killed: true });
				return ok([`Killed subscription #${subscription.id}. Nothing further is paid or mirrored.`], { ok: true, subscription });
			}
			if (action === 'resume' && current.mode === 'live') {
				return refusal('This is a live subscription, which pays and trades real funds. Resume it on /signals, where the real-funds agreement is checked.', 'live_resume_requires_owner', { subscription_id: Number(current.id) });
			}
			const status = action === 'resume' ? 'active' : action === 'stop' ? 'stopped' : 'paused';
			const subscription = await setSignalSubscriptionStatus({ userId, subId: args.subscription_id, status });
			return ok([`Subscription #${subscription.id} is now ${subscription.status}.`], { ok: true, subscription });
		}),
	},
	{
		name: 'alert_rule_create',
		title: 'Create an alert rule',
		group: 'intelligence',
		tier: 'write',
		annotations: CREATE,
		description: `Create a pump.fun alert rule that notifies you (the bell, push to your devices, and the Telegram or Discord chats you paired, per your notification preferences). Kinds: launch_match (a new launch passing filters: name_pattern with * and | wildcards, market cap band in USD, min_safety_score 0 to 100, creator history, excluded risk flags, required socials), new_mint, graduation (target_mint or target_agent), price_above and price_below (target_mint + threshold in USD), whale_buy (target_mint + threshold in SOL), market_price (target_market + target_side + direction + threshold probability). Up to ${MAX_RULES_PER_USER} rules. Use this when the user wants to hear about a launch, a graduation, a price level or a whale buy without trading.`,
		inputSchema: {
			type: 'object',
			properties: {
				kind: { type: 'string', enum: RULE_KINDS },
				label: { type: 'string', maxLength: 80 },
				filters: {
					type: 'object',
					description: 'launch_match only. Set at least one.',
					properties: {
						name_pattern: { type: 'string', maxLength: 120, description: 'Matched against name and symbol, case-insensitive. * is any text, | separates alternatives: "*cat*|*dog*".' },
						min_market_cap_usd: { type: 'number', minimum: 0 },
						max_market_cap_usd: { type: 'number', minimum: 0 },
						min_safety_score: { type: 'number', minimum: 0, maximum: 100, description: 'Coin intel quality score.' },
						min_creator_graduated: { type: 'integer', minimum: 0, description: 'The creator\'s earlier launches that graduated.' },
						max_creator_launches: { type: 'integer', minimum: 0, description: 'Skip serial launchers with more earlier launches than this.' },
						exclude_risk_flags: { type: 'array', items: { type: 'string', enum: LAUNCH_RISK_FLAGS } },
						require_socials: { type: 'boolean' },
					},
					additionalProperties: false,
				},
				target_mint: { type: 'string', maxLength: 64 },
				target_agent: { type: 'string', format: 'uuid' },
				target_market: { type: 'string', maxLength: 128 },
				target_side: { type: 'string', enum: ['yes', 'no'] },
				direction: { type: 'string', enum: ['above', 'below'] },
				threshold: { type: 'number', exclusiveMinimum: 0 },
				cooldown_seconds: { type: 'integer', minimum: 5, maximum: 86400, default: 300 },
			},
			required: ['kind'],
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, { scopes: TRADE_SCOPES }, async () => {
			const rule = await createAlertRule(auth.userId, { ...args, deliver_in_app: true, enabled: true });
			return ok([
				`Created alert rule ${rule.id}: ${rule.label || rule.kind}${rule.kind === 'launch_match' ? ` (${describeLaunchFilters(rule.filters)})` : ''}.`,
				'It notifies you in the bell, by push, and in your paired chats, per your notification preferences. Webhooks are set on /pump-dashboard.',
			], { ok: true, rule });
		}),
	},
	{
		name: 'alert_rule_list',
		title: 'List alert rules',
		group: 'intelligence',
		tier: 'read',
		annotations: STORED_READ,
		description: 'Your pump.fun alert rules, newest first: kind, filters or target, whether each is on, when it last fired, and its recent delivery results. Pass rule_id to read one rule (and to get the preview_id alert_rule_delete needs). Call this first to find a rule id, and before alert_rule_delete.',
		inputSchema: {
			type: 'object',
			properties: { rule_id: { type: 'string', format: 'uuid' } },
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, { scopes: ['wallet:read', ...TRADE_SCOPES] }, async () => {
			const rules = await listAlertRules(auth.userId, { ruleId: args.rule_id || null });
			if (args.rule_id && !rules.length) return refusal('No alert rule with that id is yours.', 'not_found');
			return ok([
				rules.length ? `${rules.length} alert rule${rules.length === 1 ? '' : 's'}:` : 'No alert rules yet. alert_rule_create adds one.',
				...rules.map(ruleLine),
			], { rules, max_rules: MAX_RULES_PER_USER });
		}),
	},
	{
		name: 'alert_rule_delete',
		title: 'Delete an alert rule',
		group: 'intelligence',
		tier: 'financial',
		confirmFlag: 'confirm_delete',
		previewTool: 'alert_rule_list',
		annotations: DELETE,
		description: 'Delete one of your alert rules and its delivery history. This cannot be undone. Call alert_rule_list with the rule_id first and show the user the rule. Use this when the user no longer wants a rule\'s notifications.',
		inputSchema: {
			type: 'object',
			properties: { rule_id: { type: 'string', format: 'uuid' } },
			required: ['rule_id'],
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, { scopes: TRADE_SCOPES }, async () => {
			const id = await deleteAlertRule(auth.userId, args.rule_id);
			if (!id) return refusal('No alert rule with that id is yours. It may already be deleted.', 'not_found');
			return ok([`Deleted alert rule ${id}.`], { ok: true, deleted: id });
		}),
	},
];

async function ownsAgent(userId, agentId) {
	const [row] = await sql`select name from agent_identities where id = ${agentId} and user_id = ${userId} and deleted_at is null`;
	return { owns: !!row, name: row?.name || null };
}
