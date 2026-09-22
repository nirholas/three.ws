// threews-agent MCP: prediction markets from the agent wallet.
//
// Thin adapters over api/_lib/predictions/, the same engine the REST routes
// (/api/v1/agents/:id/predictions/*) and the /predictions pages use, so every
// caller is held to the same guards, simulation bound and custody ledger.
//
// Tool policy (docs/prompts/03): each definition carries `group` and `tier`;
// the three financial tools add `confirmFlag` and `previewTool`, which the
// catalog publishes under _meta['three.ws/policy'].
//
//   read       predictions_events, predictions_event, predictions_positions,
//              and the three *_preview tools (they price; they never move funds)
//   write      predictions_watch (an alert rule; delete it to undo)
//   financial  predictions_open, predictions_close, predictions_redeem. Each
//              needs confirm_trade: true and a preview_id its preview tool
//              issued for the same agent in the last ten minutes.

import { hasScope } from '../_lib/auth.js';
import { limits } from '../_lib/rate-limit.js';
import { currentSignatureFor, agreementRequirement } from '../_lib/real-funds-agreement.js';
import { getVenue, DEFAULT_VENUE } from '../_lib/predictions/index.js';
import {
	previewOpen, executeOpen, previewClose, executeClose, previewRedeem, executeRedeem,
	agentPositions, loadOwnedAgent, describeError,
} from '../_lib/predictions/engine.js';
import { createWatch } from '../_lib/predictions/watch.js';

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const PREVIEW = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const FINANCIAL = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

const pct = (p) => (p == null ? 'n/a' : `${(p * 100).toFixed(1)}%`);
const cents = (p) => (p == null ? 'n/a' : `${(p * 100).toFixed(1)}¢`);
const usd = (n) => (n == null ? 'n/a' : `$${Number(n).toFixed(2)}`);

function refusal(text, reason, extra = {}) {
	return { content: [{ type: 'text', text }], structuredContent: { ok: false, reason, ...extra }, isError: true };
}

async function enforce(auth) {
	const rl = await limits.mcpAgent(auth.userId || auth.rateKey || 'anon');
	if (!rl.success) {
		throw Object.assign(new Error('rate_limited'), { code: -32000, data: { retry_after: Math.ceil((rl.reset - Date.now()) / 1000) } });
	}
}

/**
 * Shared sign-in, scope, agreement and error handling. A designed engine error
 * (guard breach, stale preview, venue refusal) becomes a designed tool result;
 * anything else goes to the dispatcher's sanitizer.
 */
async function run(auth, { scope = null, signIn = true, agreement = false }, fn) {
	await enforce(auth);
	if (signIn && !auth.userId) return refusal('Sign in to three.ws to act on your agents.', 'auth_required', { signed_in: false });
	if (scope && !hasScope(auth.scope, scope) && !(scope === 'wallet:read' && hasScope(auth.scope, 'wallet:write'))) {
		return refusal(`This action needs the ${scope} scope. Re-authorize with it granted.`, 'insufficient_scope', { required: scope });
	}
	if (agreement) {
		let signed;
		try {
			signed = await currentSignatureFor(auth.userId);
		} catch {
			return refusal('Could not verify your signed real-funds agreements, so nothing was sent. Try again in a moment.', 'agreement_check_unavailable');
		}
		if (!signed) {
			const r = agreementRequirement();
			return refusal(`Sign the real-funds agreements before moving funds. Nothing was sent. Sign at ${r.sign_url}`, 'risk_ack_required', r);
		}
	}
	try {
		return await fn();
	} catch (err) {
		const d = describeError(err);
		if (d) return refusal(d.message, d.code, d.detail ? { detail: d.detail } : {});
		throw err;
	}
}

function eventLine(e, i) {
	const lead = e.markets.slice(0, 3).map((m) => `${m.title || 'Yes'} ${pct(m.probability)}`).join(' · ');
	const more = e.market_count > 3 ? ` (+${e.market_count - 3} more)` : '';
	return `${i + 1}. ${e.title} [${e.id}]\n   ${lead}${more}\n   volume ${usd(e.volume_usd)}, closes ${e.close_time ? e.close_time.slice(0, 10) : 'n/a'}, resolves via ${e.resolution.source || 'n/a'}`;
}

const checksText = (checks) => checks.map((c) => `  ${c.ok ? '[ok]' : '[blocked]'} ${c.label}`).join('\n');

const agentIdProp = { type: 'string', format: 'uuid', description: 'The agent whose Solana wallet acts. wallet_status or three://agents lists yours.' };
const previewIdProp = { type: 'string', format: 'uuid', description: 'preview_id from the matching preview tool, issued in the last ten minutes.' };
const confirmProp = { type: 'boolean', description: 'Must be true. Set it only after showing the preview to the user and getting a clear yes.' };
const financialSchema = {
	type: 'object',
	properties: { agent_id: agentIdProp, preview_id: previewIdProp, confirm_trade: confirmProp },
	required: ['agent_id', 'preview_id', 'confirm_trade'],
	additionalProperties: false,
};

export const predictionToolDefs = [
	{
		name: 'predictions_events',
		title: 'Browse prediction markets',
		group: 'predictions',
		tier: 'read',
		annotations: READ,
		description: 'Search and browse live prediction-market events settled in USDC on Solana. Each event lists its outcomes with implied probabilities, volume, close time and resolution source.',
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string', maxLength: 120, description: 'Free-text search, e.g. "election" or "champions league".' },
				category: { type: 'string', maxLength: 40, description: 'Category id: sports, politics, crypto, culture, economics, tech, esports.' },
				sort: { type: 'string', enum: ['volume', 'volume_24h', 'close', 'new'], default: 'volume' },
				limit: { type: 'integer', minimum: 1, maximum: 25, default: 10 },
			},
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, { signIn: false }, async () => {
			const out = await getVenue(DEFAULT_VENUE).listEvents({ q: args.query || '', category: args.category || null, sort: args.sort || 'volume', limit: args.limit || 10 });
			const text = out.events.length ? out.events.map(eventLine).join('\n') : `No events matched${args.query ? ` "${args.query}"` : ''}.`;
			return { content: [{ type: 'text', text }], structuredContent: out };
		}),
	},
	{
		name: 'predictions_event',
		title: 'Research one prediction event',
		group: 'predictions',
		tier: 'read',
		annotations: READ,
		description: 'Full detail for one event: every market with buy and sell prices, price history for the selected market, and the resolution rules. Use its market ids in predictions_open_preview and predictions_watch.',
		inputSchema: {
			type: 'object',
			properties: {
				event_id: { type: 'string', maxLength: 128 },
				market_id: { type: 'string', maxLength: 128, description: 'Market to load history for; defaults to the most likely one.' },
				range: { type: 'string', enum: ['1d', '1w', '1m', 'max'], default: '1w' },
			},
			required: ['event_id'],
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, { signIn: false }, async () => {
			const venue = getVenue(DEFAULT_VENUE);
			const event = await venue.getEvent(args.event_id);
			const selected = event.markets.find((m) => m.id === args.market_id) || event.markets[0] || null;
			const history = selected ? await venue.getPriceHistory(selected, args.range || '1w').catch(() => null) : null;
			const lines = [
				`${event.title} [${event.id}]`,
				event.resolution.condition ? `Resolution: ${event.resolution.condition}` : null,
				...event.markets.slice(0, 20).map((m) => `- ${m.title || 'Yes'} [${m.id}]: ${pct(m.probability)} (buy ${m.outcomes[0].label} ${cents(m.outcomes[0].buy_price)}, buy ${m.outcomes[1].label} ${cents(m.outcomes[1].buy_price)})${m.tradable ? '' : `, ${m.status}`}`),
				history?.points?.length ? `History ${args.range || '1w'} (${history.points.length} points): ${pct(history.points[0].p)} to ${pct(history.points.at(-1).p)}` : null,
				selected?.rules ? `Rules: ${selected.rules.slice(0, 600)}` : null,
			].filter(Boolean);
			return { content: [{ type: 'text', text: lines.join('\n') }], structuredContent: { ...event, selected_market: selected ? { ...selected, history } : null } };
		}),
	},
	{
		name: 'predictions_positions',
		title: "The agent's prediction positions",
		group: 'predictions',
		tier: 'read',
		annotations: { ...READ, idempotentHint: false },
		description: "Open and settled prediction positions held by an agent's wallet: cost, value, unrealized and realized PnL, claimable payouts, and recent fills.",
		inputSchema: { type: 'object', properties: { agent_id: agentIdProp }, required: ['agent_id'], additionalProperties: false },
		handler: (args, auth) => run(auth, { scope: 'wallet:read' }, async () => {
			const out = await agentPositions({ agentId: args.agent_id, userId: auth.userId });
			const s = out.summary;
			const lines = [
				`Wallet ${out.wallet.address}: ${usd(out.wallet.usdc)} USDC. Prediction orders ${out.limits.enabled ? 'on' : 'off'}.`,
				`Open ${s.open_count}: cost ${usd(s.open_cost_usd)}, value ${usd(s.open_value_usd)}, unrealized ${usd(s.unrealized_pnl_usd)}. Realized ${usd(s.realized_pnl_usd)}. Claimable ${usd(s.claimable_usd)}.`,
				...out.open.map((p) => `- [${p.id}] ${p.event_title || ''}: ${p.market_title || ''} ${p.side_label} x${p.contracts} at ${cents(p.avg_price)}, now ${cents(p.mark_price)}, PnL ${usd(p.pnl_usd)}`),
				...out.settled.filter((p) => p.claimable).map((p) => `- [${p.id}] resolved ${p.result}: redeem ${usd(p.payout_usd)} with predictions_redeem_preview`),
			];
			return { content: [{ type: 'text', text: lines.join('\n') }], structuredContent: out };
		}),
	},
	{
		name: 'predictions_open_preview',
		title: 'Preview a prediction order',
		group: 'predictions',
		tier: 'read',
		annotations: PREVIEW,
		description: 'Price a buy of one outcome before placing it: expected contracts, average price, slippage, fees, payout, and every guard (limits, wallet balance, liquidity). Never moves funds. Returns the preview_id predictions_open requires.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: agentIdProp,
				market_id: { type: 'string', maxLength: 128 },
				side: { type: 'string', enum: ['yes', 'no'] },
				stake_usd: { type: 'number', minimum: 1, maximum: 100000, description: 'USDC to spend.' },
				max_price: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1, description: 'Highest price per contract, as a probability. Defaults to two cents over the best ask.' },
			},
			required: ['agent_id', 'market_id', 'side', 'stake_usd'],
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, { scope: 'wallet:read' }, async () => {
			const q = await previewOpen({ agentId: args.agent_id, userId: auth.userId, marketId: args.market_id, side: args.side, stakeUsd: args.stake_usd, maxPrice: args.max_price });
			const text = [
				'Show this table to the user and wait for a clear yes before calling predictions_open:',
				`  From:      agent wallet ${q.wallet.address}`,
				`  To:        prediction venue escrow, market ${q.market.id}`,
				`  Amount:    ${usd(q.stake_usd)} USDC`,
				'  Chain:     Solana',
				`  Position:  ${q.side_label} on "${q.market.title}"`,
				`  Expected:  ${q.expected_contracts ?? 'n/a'} contracts at ${cents(q.expected_avg_price)} average (limit ${cents(q.max_price)}), pays ${usd(q.max_payout_usd)} if right`,
				`  Fees:      ${q.fees_usd != null ? usd(q.fees_usd) : 'charged by the venue at fill'}`,
				checksText(q.checks),
				q.executable ? `preview_id ${q.preview_id} (expires ${q.expires_at})` : `Blocked by: ${q.blocked_by.join(', ')}. Resolve those before placing the order.`,
			].join('\n');
			return { content: [{ type: 'text', text }], structuredContent: q };
		}),
	},
	{
		name: 'predictions_open',
		title: 'Place a prediction order',
		group: 'predictions',
		tier: 'financial',
		confirmFlag: 'confirm_trade',
		previewTool: 'predictions_open_preview',
		annotations: FINANCIAL,
		description: 'Place the order a predictions_open_preview priced, spending USDC from the agent wallet on Solana. Requires confirm_trade: true and a fresh preview_id. Returns the transaction signature.',
		inputSchema: financialSchema,
		handler: (args, auth) => run(auth, { scope: 'wallet:write', agreement: true }, async () => {
			const r = await executeOpen({ agentId: args.agent_id, userId: auth.userId, previewId: args.preview_id, confirm: args.confirm_trade, source: 'mcp' });
			return { content: [{ type: 'text', text: `Order placed: ${usd(r.stake_usd)} on ${r.side} in ${r.market_id}.\nSignature ${r.signature}\n${r.explorer}\n${r.note}` }], structuredContent: r };
		}),
	},
	{
		name: 'predictions_close_preview',
		title: 'Preview closing a prediction position',
		group: 'predictions',
		tier: 'read',
		annotations: PREVIEW,
		description: 'Price selling some or all contracts of an open position: expected proceeds, average price, slippage and realized PnL. Never moves funds. Returns the preview_id predictions_close requires.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: agentIdProp,
				position_id: { type: 'string', maxLength: 64 },
				contracts: { type: 'number', exclusiveMinimum: 0, description: 'How many to sell; all when omitted.' },
				min_price: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1, description: 'Lowest acceptable price per contract.' },
			},
			required: ['agent_id', 'position_id'],
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, { scope: 'wallet:read' }, async () => {
			const q = await previewClose({ agentId: args.agent_id, userId: auth.userId, positionId: args.position_id, contracts: args.contracts, minPrice: args.min_price });
			const text = [
				'Show this table to the user and wait for a clear yes before calling predictions_close:',
				`  Selling:   ${q.contracts} ${q.position.side_label} contracts of "${q.position.market_title}"`,
				'  Chain:     Solana; proceeds in USDC to the agent wallet',
				`  Expected:  ${usd(q.expected_proceeds_usd)} at ${cents(q.expected_avg_price)} average (floor ${cents(q.min_price)}), realized PnL ${usd(q.expected_realized_pnl_usd)}`,
				checksText(q.checks),
				`preview_id ${q.preview_id} (expires ${q.expires_at})`,
			].join('\n');
			return { content: [{ type: 'text', text }], structuredContent: q };
		}),
	},
	{
		name: 'predictions_close',
		title: 'Close a prediction position',
		group: 'predictions',
		tier: 'financial',
		confirmFlag: 'confirm_trade',
		previewTool: 'predictions_close_preview',
		annotations: FINANCIAL,
		description: 'Sell the contracts a predictions_close_preview priced. Requires confirm_trade: true and a fresh preview_id. Returns the transaction signature.',
		inputSchema: financialSchema,
		handler: (args, auth) => run(auth, { scope: 'wallet:write', agreement: true }, async () => {
			const r = await executeClose({ agentId: args.agent_id, userId: auth.userId, previewId: args.preview_id, confirm: args.confirm_trade, source: 'mcp' });
			return { content: [{ type: 'text', text: `Sell order placed for ${r.contracts} contracts.\nSignature ${r.signature}\n${r.explorer}\n${r.note}` }], structuredContent: r };
		}),
	},
	{
		name: 'predictions_redeem_preview',
		title: 'Preview redeeming a resolved position',
		group: 'predictions',
		tier: 'read',
		annotations: PREVIEW,
		description: 'Check a resolved position and the payout it is owed. Never moves funds. Returns the preview_id predictions_redeem requires.',
		inputSchema: { type: 'object', properties: { agent_id: agentIdProp, position_id: { type: 'string', maxLength: 64 } }, required: ['agent_id', 'position_id'], additionalProperties: false },
		handler: (args, auth) => run(auth, { scope: 'wallet:read' }, async () => {
			const q = await previewRedeem({ agentId: args.agent_id, userId: auth.userId, positionId: args.position_id });
			const text = [
				`Redeem "${q.position.market_title}" (${q.position.side_label}, resolved ${q.position.result || 'n/a'}): ${usd(q.expected_payout_usd)} USDC to the agent wallet on Solana.`,
				checksText(q.checks),
				q.executable ? `preview_id ${q.preview_id} (expires ${q.expires_at})` : `Blocked by: ${q.blocked_by.join(', ')}.`,
			].join('\n');
			return { content: [{ type: 'text', text }], structuredContent: q };
		}),
	},
	{
		name: 'predictions_redeem',
		title: 'Redeem a resolved prediction position',
		group: 'predictions',
		tier: 'financial',
		confirmFlag: 'confirm_trade',
		previewTool: 'predictions_redeem_preview',
		annotations: FINANCIAL,
		description: 'Claim the USDC payout of a winning resolved position into the agent wallet. Requires confirm_trade: true and a fresh preview_id from predictions_redeem_preview.',
		inputSchema: financialSchema,
		handler: (args, auth) => run(auth, { scope: 'wallet:write', agreement: true }, async () => {
			const r = await executeRedeem({ agentId: args.agent_id, userId: auth.userId, previewId: args.preview_id, confirm: args.confirm_trade, source: 'mcp' });
			return { content: [{ type: 'text', text: `Redeemed ${usd(r.payout_usd)}.\nSignature ${r.signature}\n${r.explorer}` }], structuredContent: r };
		}),
	},
	{
		name: 'predictions_watch',
		title: 'Watch a prediction market',
		group: 'predictions',
		tier: 'write',
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
		description: "Get notified when one outcome's implied probability crosses a threshold. Delivered in-app, and to Telegram or a webhook when given. Moves no funds.",
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: agentIdProp,
				market_id: { type: 'string', maxLength: 128 },
				side: { type: 'string', enum: ['yes', 'no'], default: 'yes' },
				direction: { type: 'string', enum: ['above', 'below'] },
				threshold: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1, description: '0.65 means 65%.' },
				telegram_chat: { type: 'string', maxLength: 64 },
				webhook_url: { type: 'string', maxLength: 2048 },
			},
			required: ['agent_id', 'market_id', 'direction', 'threshold'],
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, { scope: 'wallet:write' }, async () => {
			await loadOwnedAgent(args.agent_id, auth.userId);
			const w = await createWatch({ agentId: args.agent_id, userId: auth.userId, body: args });
			const text = `Watching "${w.market?.title || w.market_id}": ${w.market?.side_label || w.side} ${w.direction} ${pct(w.threshold)} (now ${pct(w.current_probability)}). Watch id ${w.id}; remove it on the notifications page or DELETE /api/v1/agents/${args.agent_id}/predictions/watch/${w.id}.`;
			return { content: [{ type: 'text', text }], structuredContent: w };
		}),
	},
];
