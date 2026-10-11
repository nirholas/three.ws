// threews-agent MCP: perpetual futures from the agent wallet.
//
// Thin adapters over api/_lib/perps/service.js, the same service the REST
// routes (/api/v1/agents/:id/perps/*) and the /agents/:id/perps page use, so
// every caller is held to the same leverage and margin caps, guards, simulation
// bound and custody ledger. Guide: docs/perps.md.
//
// Tool policy (packages/mcp-policy/src/table.js, group `perps`):
//
//   read       perps_markets, perps_market_data, perps_account, perps_positions,
//              perps_order_preview and perps_action_preview (they price; they
//              never move funds or touch the paper ledger)
//   write      perps_limits (tighten caps, set alert thresholds; loosening is
//              the owner's, from a signed-in session)
//   financial  perps_order_execute, perps_collateral_deposit,
//              perps_collateral_withdraw, perps_order_cancel, perps_flatten.
//              Each needs confirm_trade: true, the preview_id its preview tool
//              issued for the same agent, and an idempotency_key. The service
//              checks the preview itself and refuses an order whose quote moved
//              past the agent's tolerance since the preview.
//
// Every agent starts in paper mode: fills at live prices, no funds move. Live
// mode is a per-agent switch only the owner can turn on.

import { hasScope } from '../_lib/auth.js';
import { limits as rateLimits } from '../_lib/rate-limit.js';
import { loosenedPerpsKeys } from '../_lib/perps/limits.js';
import * as perps from '../_lib/perps/service.js';

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const PREVIEW = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const FINANCIAL = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

const usd = (n) => (n == null || !Number.isFinite(Number(n)) ? 'n/a' : `${Number(n) < 0 ? '-' : ''}$${Math.abs(Number(n)).toFixed(2)}`);
const price = (n) => (n == null ? 'n/a' : `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 6 })}`);
const pct = (n) => (n == null ? 'n/a' : `${Number(n).toFixed(2)}%`);
const lev = (n) => (n == null ? 'n/a' : `${Number(n).toFixed(2)}x`);
const modeLine = (mode) => (mode === 'paper' ? 'PAPER: simulated at live prices, no funds move' : 'LIVE: real collateral on Solana');

function refusal(text, reason, extra = {}) {
	return { content: [{ type: 'text', text }], structuredContent: { ok: false, reason, ...extra }, isError: true };
}

async function enforce(auth) {
	const rl = await rateLimits.mcpAgent(auth.userId || auth.rateKey || 'anon');
	if (!rl.success) {
		throw Object.assign(new Error('rate_limited'), { code: -32000, data: { retry_after: Math.ceil((rl.reset - Date.now()) / 1000) } });
	}
}

/**
 * Shared sign-in, scope and error handling. A designed service error (guard
 * breach, stale preview, moved quote, venue refusal) becomes a designed tool
 * result; anything else goes to the dispatcher's sanitizer. The live-mode
 * real-funds agreement is checked by the service, so paper trading never asks
 * for it.
 */
async function run(auth, { scope = null, signIn = true }, fn) {
	await enforce(auth);
	if (signIn && !auth.userId) return refusal('Sign in to three.ws to act on your agents.', 'auth_required', { signed_in: false });
	if (scope && !hasScope(auth.scope, scope) && !(scope === 'wallet:read' && hasScope(auth.scope, 'wallet:trade'))) {
		return refusal(`This action needs the ${scope} scope. Re-authorize with it granted.`, 'insufficient_scope', { required: scope });
	}
	try {
		return await fn();
	} catch (err) {
		const d = perps.describeError(err);
		if (d) return refusal(d.message, d.code, d.detail ? { detail: d.detail } : {});
		throw err;
	}
}

const reply = (text, structuredContent) => ({ content: [{ type: 'text', text }], structuredContent });
const checksText = (checks) => checks.map((c) => `  ${c.ok ? '[ok]' : '[blocked]'} ${c.label}`).join('\n');

function previewFooter(q, tool) {
	return q.executable
		? `preview_id ${q.preview_id} (expires ${q.expires_at}). Call ${tool} with it, confirm_trade: true and a fresh idempotency_key only after the user says yes.`
		: `Blocked by: ${q.blocked_by.join(', ')}. Resolve those before calling ${tool}.`;
}

function executeText(r) {
	const lines = [`${r.summary || 'Done'} (${r.mode}).`];
	if (r.replayed) lines.push('This idempotency_key already ran; this is the stored result, nothing was sent again.');
	for (const sig of r.signatures || []) lines.push(`Signature ${sig}`);
	if (r.explorer) lines.push(r.explorer);
	if (Array.isArray(r.steps)) {
		for (const s of r.steps) lines.push(`  ${s.ok ? '[ok]' : '[failed]'} ${s.step}${s.error ? `: ${s.error}` : ''}`);
	}
	return lines.join('\n');
}

const agentIdProp = { type: 'string', format: 'uuid', description: 'The agent whose Solana wallet trades. wallet_status or three://agents lists yours.' };
const modeProp = { type: 'string', enum: ['paper', 'live'], description: 'paper fills at live prices with no funds moving. live needs the owner to have turned live perps on for this agent. Defaults to live when it is on, paper otherwise.' };
const venueProp = { type: 'string', maxLength: 32, description: 'Venue id; perps_markets lists them. Defaults to the platform venue.' };
const previewIdProp = { type: 'string', pattern: '^[a-z]{2,8}_[0-9a-f]{32}$', description: 'preview_id from the matching preview tool, before it expires.' };
const confirmProp = { type: 'boolean', description: 'Must be true. Set it only after showing the preview to the user and getting a clear yes.' };
const idempotencyProp = { type: 'string', minLength: 8, maxLength: 128, description: 'A unique key for this execution, such as a fresh UUID. Retrying with the same key returns the first result instead of acting twice.' };

const financialSchema = {
	type: 'object',
	properties: { agent_id: agentIdProp, preview_id: previewIdProp, confirm_trade: confirmProp, idempotency_key: idempotencyProp },
	required: ['agent_id', 'preview_id', 'confirm_trade', 'idempotency_key'],
	additionalProperties: false,
};

const executeArgs = (args, auth) => ({
	agentId: args.agent_id,
	userId: auth.userId,
	previewId: args.preview_id,
	confirm: args.confirm_trade,
	idempotencyKey: args.idempotency_key,
	source: 'mcp',
});

function marketLine(m, i) {
	return `${i + 1}. ${m.symbol} (${m.kind}) mark ${price(m.mark_price)}, 24h ${pct(m.change_24h_pct)}, funding ${m.funding_rate_hourly_pct == null ? 'n/a' : `${m.funding_rate_hourly_pct}%/h`}, OI ${usd(m.open_interest_usd)}, vol ${usd(m.volume_24h_usd)}, max ${m.max_leverage}x`;
}

function positionLine(p) {
	return `  ${p.symbol} ${p.side} ${p.size} @ ${price(p.entry_price)} mark ${price(p.mark_price)} | uPnL ${usd(p.unrealized_pnl_usd)} | funding ${usd(p.funding_accrued_usd ?? p.funding_paid_usd)} | liq ${price(p.liquidation_price)} (${pct(p.liquidation_distance_pct)} away)${p.take_profit_price ? ` | TP ${price(p.take_profit_price)}` : ''}${p.stop_loss_price ? ` | SL ${price(p.stop_loss_price)}` : ''}`;
}

function summaryText(s) {
	return `Equity ${usd(s.equity_usd)}, collateral ${usd(s.collateral_usd)}, withdrawable ${usd(s.withdrawable_usd)}, uPnL ${usd(s.unrealized_pnl_usd)}, leverage ${lev(s.account_leverage)}, risk ${s.risk_state}`;
}

function orderPreviewText(q) {
	const trigger = q.type === 'take_profit' || q.type === 'stop_loss';
	const lines = [
		'Show this table to the user and wait for a clear yes before calling perps_order_execute:',
		`  Mode:          ${modeLine(q.mode)}`,
		`  From:          ${q.mode === 'paper' ? 'paper perps collateral' : `${q.agent.name || 'agent'} trader account (wallet ${q.wallet?.address || 'n/a'})`}`,
		`  To:            ${q.venue} order book, ${q.symbol} perpetual`,
		`  Asset:         USDC collateral`,
		'  Chain:         Solana',
	];
	if (trigger) {
		lines.push(
			`  Order:         ${q.type === 'take_profit' ? 'Take-profit' : 'Stop-loss'} closing ${q.size_percent}% (${q.size} ${q.symbol}) of the ${q.position.side}`,
			`  Trigger:       ${price(q.trigger_price)} (mark now ${price(q.mark_price)}, entry ${price(q.entry_price)})`,
			`  PnL at trigger: ${usd(q.expected_pnl_at_trigger_usd)}, fee about ${usd(q.fee_usd)}`,
			`  Liquidation:   ${price(q.liquidation_price)} (unchanged)`,
		);
	} else {
		lines.push(
			`  Order:         ${q.reduce_only ? 'reduce-only ' : ''}${q.type} ${q.side} ${q.size_text || q.size} ${q.symbol}${q.type === 'limit' ? ` at ${price(q.limit_price)}${q.crosses_book ? ' (crosses the book, fills now)' : ' (rests on the book)'}` : ''}`,
			`  Entry:         ${price(q.entry_price)} (mark ${price(q.mark_price)}${q.slippage_bps != null ? `, slippage up to ${q.slippage_bps} bps` : ''})`,
			`  Size:          ${q.size} ${q.symbol}, notional ${usd(q.notional_usd)}`,
			`  Margin:        ${usd(q.margin_impact_usd)} added, ${usd(q.initial_margin_after_usd)} initial margin after`,
			`  Leverage:      ${lev(q.account_leverage_after)} account leverage after (cap ${lev(q.leverage_cap)}, margin cap ${usd(q.max_margin_per_position_usd)} per position)`,
			`  Fees:          ${usd(q.fee_usd)} (${((q.fee_rate || 0) * 100).toFixed(3)}%)`,
			`  Liquidation:   ${price(q.liquidation_price)}${q.liquidation_distance_pct != null ? ` (${pct(q.liquidation_distance_pct)} from mark)` : ''}`,
			`  After:         ${q.position_after.side} ${q.position_after.size} ${q.symbol}, free collateral ${usd(q.free_collateral_after_usd)}`,
		);
	}
	lines.push(`  Tolerance:     the execute refuses if entry or liquidation moves more than ${q.max_quote_move_bps} bps first`);
	lines.push(checksText(q.checks), previewFooter(q, 'perps_order_execute'));
	return lines.join('\n');
}

const ACTION_TOOL = {
	deposit: 'perps_collateral_deposit',
	withdraw: 'perps_collateral_withdraw',
	cancel: 'perps_order_cancel',
	flatten: 'perps_flatten',
};

function actionPreviewText(q) {
	const tool = ACTION_TOOL[q.kind];
	const head = [`Show this table to the user and wait for a clear yes before calling ${tool}:`, `  Mode:     ${modeLine(q.mode)}`];
	let body;
	if (q.kind === 'deposit' || q.kind === 'withdraw') {
		body = [
			`  From:     ${q.from_label ? `${q.from_label} ${q.from}` : q.from}`,
			`  To:       ${q.to_label ? `${q.to_label} ${q.to}` : q.to}`,
			`  Amount:   ${usd(q.amount_usd)} ${q.asset}`,
			'  Chain:    Solana',
			`  Collateral: ${usd(q.collateral_before_usd)} now, ${usd(q.collateral_after_usd)} after`,
		];
		if (q.registers_account) body.push('  Note:     opens the agent trader account first (one-time SOL rent)');
	} else if (q.kind === 'cancel') {
		const o = q.order;
		body = [
			`  Cancel:   ${o.kind.replace('_', '-')} ${o.id} on ${o.symbol}${o.price ? ` at ${price(o.price)}` : ''}${o.trigger_price ? ` trigger ${price(o.trigger_price)}` : ''}`,
			'  Chain:    Solana. No funds leave the account; resting margin is released.',
		];
	} else {
		body = [
			'  Kill switch: turns perps trading off for this agent (reduce-only until the owner resumes)',
			`  Cancel:   ${q.orders_to_cancel} resting order(s), ${q.triggers_to_cancel} trigger(s)`,
			`  Close:    ${q.positions_to_close.length} position(s) at market, slippage up to ${q.slippage_bps} bps`,
			...q.positions_to_close.map((c) => (c.error
				? `    ${c.symbol} ${c.side} ${c.size}: ${c.error}`
				: `    ${c.symbol} ${c.side} ${c.size} at about ${price(c.expected_exit_price)}, PnL about ${usd(c.expected_pnl_usd)} after ${usd(c.fee_usd)} fees`)),
			`  Expected: ${usd(q.expected_total_pnl_usd)} realized in total`,
			'  Chain:    Solana. Proceeds stay as collateral in the trader account.',
		];
	}
	return [...head, ...body, checksText(q.checks), previewFooter(q, tool)].join('\n');
}

export const perpsToolDefs = [
	{
		name: 'perps_markets',
		title: 'List perpetual futures markets',
		group: 'perps',
		tier: 'read',
		annotations: READ,
		description: 'Every perpetual futures market an agent can trade on Solana: mark price, 24h change, hourly funding, open interest, volume and the venue maximum leverage. USDC is the collateral. Use the symbols in perps_market_data and perps_order_preview. Call this first to find a market symbol and its leverage limit before previewing an order.',
		inputSchema: {
			type: 'object',
			properties: {
				kind: { type: 'string', maxLength: 20, description: 'Filter by market kind, e.g. crypto.' },
				venue: venueProp,
			},
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, { signIn: false }, async () => {
			const out = await perps.markets({ venueId: args.venue || undefined, kind: args.kind || null });
			const text = out.markets.length ? out.markets.map(marketLine).join('\n') : 'No open markets on this venue right now.';
			return reply(`${out.venues.find((v) => v.id === out.venue)?.label || out.venue} perps, collateral ${out.collateral.asset}:\n${text}`, out);
		}),
	},
	{
		name: 'perps_market_data',
		title: 'Read one perps market',
		group: 'perps',
		tier: 'read',
		annotations: READ,
		description: 'Order book, recent trades and funding history for one perpetual market. Use this to judge depth and funding before previewing an order.',
		inputSchema: {
			type: 'object',
			properties: {
				symbol: { type: 'string', maxLength: 24, description: 'Market symbol from perps_markets, e.g. SOL.' },
				depth: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
				trades: { type: 'integer', minimum: 0, maximum: 100, default: 10 },
				funding: { type: 'integer', minimum: 0, maximum: 168, default: 24, description: 'Hours of funding history.' },
				venue: venueProp,
			},
			required: ['symbol'],
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, { signIn: false }, async () => {
			const d = await perps.marketData({ venueId: args.venue || undefined, symbol: args.symbol, depth: args.depth || 10, trades: args.trades ?? 10, funding: args.funding ?? 24 });
			const m = d.market;
			const bid = d.book.bids[0];
			const ask = d.book.asks[0];
			const lines = [
				`${m.symbol}: mark ${price(m.mark_price)}, index ${price(m.index_price)}, funding ${m.funding_rate_hourly_pct ?? 'n/a'}%/h (${m.funding_apr_pct ?? 'n/a'}% APR), max ${m.max_leverage}x, taker fee ${((m.taker_fee_rate || 0) * 100).toFixed(3)}%`,
				`Best bid ${bid ? `${price(bid.price)} x ${bid.size}` : 'none'}, best ask ${ask ? `${price(ask.price)} x ${ask.size}` : 'none'}`,
				`${d.trades.length} recent trades, ${d.funding.length} funding points.`,
			];
			return reply(lines.join('\n'), d);
		}),
	},
	{
		name: 'perps_account',
		title: 'Read an agent perps account',
		group: 'perps',
		tier: 'read',
		annotations: READ,
		description: "An agent's perps account in paper or live mode: equity, collateral, withdrawable USDC, open positions with unrealized PnL, funding paid and distance to liquidation, its leverage and margin caps, and any alert thresholds currently crossed. Use this to check equity, margin and liquidation risk before sizing a new order or withdrawing collateral.",
		inputSchema: { type: 'object', properties: { agent_id: agentIdProp, mode: modeProp, venue: venueProp }, required: ['agent_id'], additionalProperties: false },
		handler: (args, auth) => run(auth, { scope: 'wallet:read' }, async () => {
			const a = await perps.account({ agentId: args.agent_id, userId: auth.userId, venueId: args.venue || undefined, mode: args.mode || null });
			const l = a.limits;
			const lines = [
				`${a.agent.name || 'Agent'} on ${a.venue_label} (${modeLine(a.mode)})`,
				summaryText(a.summary),
				...(a.account.positions.length ? a.account.positions.map(positionLine) : ['  No open positions.']),
				`Caps: leverage ${lev(l.max_leverage)}, margin ${usd(l.max_margin_per_position_usd)} per position, slippage ${l.max_slippage_bps} bps, quote move ${l.max_quote_move_bps} bps. Live ${l.live_enabled ? 'on' : 'off'}${l.halted ? ', KILL SWITCH ON' : ''}.`,
				a.alerts.length ? `Alerts crossed now:\n${a.alerts.map((x) => `  [${x.severity}] ${x.message}`).join('\n')}` : 'No alert thresholds crossed.',
			];
			return reply(lines.join('\n'), a);
		}),
	},
	{
		name: 'perps_positions',
		title: 'List perps positions and orders',
		group: 'perps',
		tier: 'read',
		annotations: READ,
		description: 'Open positions, resting limit orders, take-profit and stop-loss triggers (with the ids perps_order_cancel takes), and recent fills or executions for an agent. Use this to find the id of an order or trigger to cancel, or to review recent fills.',
		inputSchema: {
			type: 'object',
			properties: { agent_id: agentIdProp, mode: modeProp, venue: venueProp, limit: { type: 'integer', minimum: 1, maximum: 200, default: 20 } },
			required: ['agent_id'],
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, { scope: 'wallet:read' }, async () => {
			const p = await perps.positions({ agentId: args.agent_id, userId: auth.userId, venueId: args.venue || undefined, mode: args.mode || null, limit: args.limit || 20 });
			const lines = [
				`${p.mode} mode. ${summaryText(p.summary)}`,
				'Positions:',
				...(p.positions.length ? p.positions.map(positionLine) : ['  none']),
				'Open orders:',
				...(p.orders.length ? p.orders.map((o) => `  limit ${o.id}: ${o.side} ${o.size_remaining ?? o.size} ${o.symbol} at ${price(o.price)}${o.reduce_only ? ' (reduce-only)' : ''}`) : ['  none']),
				'Triggers:',
				...(p.conditionals.length ? p.conditionals.map((c) => `  ${c.kind} ${c.id}: ${c.symbol} at ${price(c.trigger_price)}${c.cancellable === false ? ' (attached to the position, closes with it)' : ''}`) : ['  none']),
				`${p.history.length} recent ${p.mode === 'paper' ? 'fills' : 'executions'} in structuredContent.history.`,
			];
			return reply(lines.join('\n'), p);
		}),
	},
	{
		name: 'perps_order_preview',
		title: 'Preview a perps order',
		group: 'perps',
		tier: 'read',
		annotations: PREVIEW,
		description: 'Price a perpetual futures order without placing it: exact size, entry, margin, account leverage, fees and liquidation price, checked against the agent leverage cap, per-position margin cap and kill switches. Market, limit, take-profit and stop-loss. Returns the preview_id perps_order_execute requires (valid two minutes). Size the order with size (base units) or margin_usd with leverage. Use this before perps_order_execute to see the exact fill, fees and liquidation price.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: agentIdProp,
				symbol: { type: 'string', maxLength: 24 },
				side: { type: 'string', enum: ['long', 'short'], description: 'For take_profit and stop_loss, the side of the position they protect is used.' },
				type: { type: 'string', enum: ['market', 'limit', 'take_profit', 'stop_loss'], default: 'market' },
				size: { type: 'number', exclusiveMinimum: 0, description: 'Size in base units: 0.5 on SOL is half a SOL.' },
				margin_usd: { type: 'number', exclusiveMinimum: 0, description: 'USDC margin to commit, with leverage, instead of size.' },
				leverage: { type: 'number', minimum: 1, maximum: 100, description: 'Used with margin_usd. Never exceeds the agent cap.' },
				price: { type: 'number', exclusiveMinimum: 0, description: 'Limit price (limit orders).' },
				trigger_price: { type: 'number', exclusiveMinimum: 0, description: 'Trigger (take_profit and stop_loss).' },
				size_percent: { type: 'integer', minimum: 1, maximum: 100, default: 100, description: 'Share of the position a take_profit or stop_loss closes.' },
				reduce_only: { type: 'boolean', default: false },
				slippage_bps: { type: 'integer', minimum: 1, maximum: 1000, description: 'Market orders: worst acceptable price past the book walk. Defaults to the agent cap.' },
				mode: modeProp,
				venue: venueProp,
			},
			required: ['agent_id', 'symbol', 'side'],
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, { scope: 'wallet:read' }, async () => {
			const q = await perps.previewOrder({
				agentId: args.agent_id, userId: auth.userId, venueId: args.venue || undefined, mode: args.mode || null,
				symbol: args.symbol, side: args.side, type: args.type || 'market', size: args.size, marginUsd: args.margin_usd, leverage: args.leverage,
				price: args.price, triggerPrice: args.trigger_price, sizePercent: args.size_percent, reduceOnly: args.reduce_only, slippageBps: args.slippage_bps,
			});
			return reply(orderPreviewText(q), q);
		}),
	},
	{
		name: 'perps_action_preview',
		title: 'Preview a perps funds or kill-switch action',
		group: 'perps',
		tier: 'read',
		annotations: PREVIEW,
		description: 'Preview a collateral deposit, a collateral withdrawal, an order cancel, or the kill switch (flatten: cancel everything, close every position at market, halt trading). Shows from, to, amount, asset and chain, and the checks. Moves nothing. Returns the preview_id that perps_collateral_deposit, perps_collateral_withdraw, perps_order_cancel or perps_flatten requires. Call this first for any deposit, withdrawal, cancel or flatten, and show the owner the result.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: agentIdProp,
				action: { type: 'string', enum: ['deposit', 'withdraw', 'cancel', 'flatten'] },
				amount_usd: { type: ['number', 'string'], description: 'deposit and withdraw: USDC amount. withdraw also takes "max".' },
				order_id: { type: 'string', maxLength: 64, description: 'cancel: the order or trigger id from perps_positions.' },
				kind: { type: 'string', enum: ['limit', 'take_profit', 'stop_loss'], description: 'cancel: only needed when an id is ambiguous.' },
				mode: modeProp,
				venue: venueProp,
			},
			required: ['agent_id', 'action'],
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, { scope: 'wallet:read' }, async () => {
			const base = { agentId: args.agent_id, userId: auth.userId, venueId: args.venue || undefined, mode: args.mode || null };
			let q;
			if (args.action === 'deposit') q = await perps.previewDeposit({ ...base, amountUsd: args.amount_usd });
			else if (args.action === 'withdraw') q = await perps.previewWithdraw({ ...base, amountUsd: args.amount_usd });
			else if (args.action === 'cancel') q = await perps.previewCancel({ ...base, orderId: args.order_id, kind: args.kind || null });
			else q = await perps.previewFlatten(base);
			return reply(actionPreviewText(q), q);
		}),
	},
	{
		name: 'perps_order_execute',
		title: 'Place a perps order',
		group: 'perps',
		tier: 'financial',
		confirmFlag: 'confirm_trade',
		previewTool: 'perps_order_preview',
		annotations: FINANCIAL,
		description: 'Place the order a perps_order_preview priced, signed by the agent wallet on Solana (or filled on the paper ledger in paper mode). Refuses if entry or liquidation moved past the agent tolerance since the preview. Pass the fresh preview_id, confirm_trade: true and a unique idempotency_key. Call this after the owner approved a perps_order_preview, within its two-minute window.',
		inputSchema: financialSchema,
		handler: (args, auth) => run(auth, { scope: 'wallet:trade' }, async () => {
			const r = await perps.executeOrder(executeArgs(args, auth));
			return reply(executeText(r), r);
		}),
	},
	{
		name: 'perps_collateral_deposit',
		title: 'Deposit perps collateral',
		group: 'perps',
		tier: 'financial',
		confirmFlag: 'confirm_trade',
		previewTool: 'perps_action_preview',
		annotations: FINANCIAL,
		description: 'Move USDC from the agent wallet into its perps trader account (or credit paper collateral in paper mode), under the wallet spend caps. Opens the trader account on first use. Pass the preview_id from perps_action_preview with action "deposit", confirm_trade: true and a unique idempotency_key. Use this when the perps account needs more margin to open or hold positions.',
		inputSchema: financialSchema,
		handler: (args, auth) => run(auth, { scope: 'wallet:trade' }, async () => {
			const r = await perps.executeDeposit(executeArgs(args, auth));
			return reply(executeText(r), r);
		}),
	},
	{
		name: 'perps_collateral_withdraw',
		title: 'Withdraw perps collateral',
		group: 'perps',
		tier: 'financial',
		confirmFlag: 'confirm_trade',
		previewTool: 'perps_action_preview',
		annotations: FINANCIAL,
		description: 'Move withdrawable USDC from the perps trader account back to the agent wallet (paper collateral in paper mode). Collateral backing open positions stays. Pass the preview_id from perps_action_preview with action "withdraw", confirm_trade: true and a unique idempotency_key. Use this to bring idle margin back to the agent wallet.',
		inputSchema: financialSchema,
		handler: (args, auth) => run(auth, { scope: 'wallet:trade' }, async () => {
			const r = await perps.executeWithdraw(executeArgs(args, auth));
			return reply(executeText(r), r);
		}),
	},
	{
		name: 'perps_order_cancel',
		title: 'Cancel a perps order or trigger',
		group: 'perps',
		tier: 'financial',
		confirmFlag: 'confirm_trade',
		previewTool: 'perps_action_preview',
		annotations: FINANCIAL,
		description: 'Cancel a resting limit order, take-profit or stop-loss. Pass the preview_id from perps_action_preview with action "cancel", confirm_trade: true and a unique idempotency_key. Use this to pull one resting order or trigger listed by perps_positions; to close everything at once, use perps_flatten.',
		inputSchema: financialSchema,
		handler: (args, auth) => run(auth, { scope: 'wallet:trade' }, async () => {
			const r = await perps.executeCancel(executeArgs(args, auth));
			return reply(executeText(r), r);
		}),
	},
	{
		name: 'perps_flatten',
		title: 'Perps kill switch: flatten everything',
		group: 'perps',
		tier: 'financial',
		confirmFlag: 'confirm_trade',
		previewTool: 'perps_action_preview',
		annotations: FINANCIAL,
		description: "The agent's perps kill switch: halts risk-increasing orders, cancels every resting order and trigger, and closes every position at market. Only the owner can resume trading, from a signed-in session. Pass the preview_id from perps_action_preview with action \"flatten\", confirm_trade: true and a unique idempotency_key. Use this when the owner wants all perps risk off immediately.",
		inputSchema: financialSchema,
		handler: (args, auth) => run(auth, { scope: 'wallet:trade' }, async () => {
			const r = await perps.executeFlatten(executeArgs(args, auth));
			return reply(executeText(r), r);
		}),
	},
	{
		name: 'perps_limits',
		title: 'Tighten perps limits and set alerts',
		group: 'perps',
		tier: 'write',
		annotations: WRITE,
		description: "Read or tighten an agent's perps risk limits and set its alert thresholds. Lower the leverage cap, the per-position margin cap, slippage or quote tolerance, turn live mode off, or engage the halt; set alerts for liquidation distance, unrealized loss or gain, and funding paid (null turns one off). Loosening any limit, turning live on, or resuming after the kill switch is refused here: the owner does that signed in at /agents/:id/perps. Call with only agent_id to read. Use this when the owner wants to reduce an agent's perps risk or be alerted before a position gets into trouble.",
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: agentIdProp,
				live_enabled: { type: 'boolean' },
				halted: { type: 'boolean' },
				max_leverage: { type: 'number', minimum: 1, maximum: 20 },
				max_margin_per_position_usd: { type: 'number', minimum: 1 },
				max_slippage_bps: { type: 'integer', minimum: 1, maximum: 1000 },
				max_quote_move_bps: { type: 'integer', minimum: 1, maximum: 500 },
				alert_liquidation_distance_pct: { type: ['number', 'null'], minimum: 0.5, maximum: 90 },
				alert_loss_usd: { type: ['number', 'null'], minimum: 0.01 },
				alert_gain_usd: { type: ['number', 'null'], minimum: 0.01 },
				alert_funding_usd: { type: ['number', 'null'], minimum: 0.01 },
			},
			required: ['agent_id'],
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, { scope: 'wallet:read' }, async () => {
			const { agent_id: agentId, ...patch } = args;
			const current = await perps.getLimits({ agentId, userId: auth.userId });
			if (!Object.keys(patch).length) {
				return reply(`Perps limits for this agent:\n${JSON.stringify(current.limits, null, 2)}`, current);
			}
			if (!hasScope(auth.scope, 'wallet:write') && !hasScope(auth.scope, 'wallet:trade')) {
				return refusal('Changing perps limits needs the wallet:write scope. Re-authorize with it granted.', 'insufficient_scope', { required: 'wallet:write' });
			}
			const loosened = loosenedPerpsKeys(current.limits, patch);
			if (loosened.length) {
				return refusal(
					`Only the owner can loosen ${loosened.join(', ')}, signed in at https://three.ws/agents/${agentId}/perps. Nothing changed.`,
					'owner_session_required',
					{ keys: loosened },
				);
			}
			const next = await perps.updateLimits({ agentId, userId: auth.userId, patch });
			return reply(`Perps limits updated:\n${JSON.stringify(next.limits, null, 2)}`, next);
		}),
	},
];
