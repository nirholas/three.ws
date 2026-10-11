// threews-agent MCP: resting orders and DCA schedules on any SPL token.
//
// Thin adapters over the order engine (api/_lib/orders.js, api/_lib/order-book.js,
// the workers/agent-orders sweep) and the unified DCA store
// (api/_lib/dca-unified.js), the same code the REST routes
// (/api/agents/:id/orders/*) and the wallet hub's Orders tab use. Guide:
// docs/mcp.md ("Orders and DCA").
//
// Tool policy (packages/mcp-policy/src/table.js, group `trading`):
//
//   read       order_preview, dca_preview (live quote, trigger check, firewall
//              verdict, schedule; they issue a preview_id and move nothing),
//              limit_order_list, limit_order_history, dca_list, order_book
//   write      limit_order_cancel, dca_cancel (cancelling only ever reduces
//              what the agent will spend)
//   financial  limit_order_create, stop_order_create, trailing_order_create,
//              ladder_order_create, oco_order_create (confirm_order), and
//              dca_create (confirm_dca). Each takes only the preview_id its
//              preview tool issued for the same agent plus the confirm flag, so
//              it can never place anything other than what the owner was shown.
//              The id is signed, ten minutes long and single use
//              (api/_lib/trading-tools/preview.js).
//
// Placing an order arms future spends from the agent wallet. Every fill still
// runs the audited path in the worker: the spend policy, the kill switch, the
// rug firewall, an idempotency key per slice and the per-agent lock.

import { hasScope } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { limits } from '../_lib/rate-limit.js';
import { currentSignatureFor, agreementRequirement } from '../_lib/real-funds-agreement.js';
import { issuePreview, verifyPreview, consumePreview, PreviewError } from '../_lib/trading-tools/preview.js';
import {
	normalizeOrderRequest, listOrders, getOrder, listFills, cancelOrder, getOrderGroup,
	ORDER_VENUES, TRIGGER_METRICS, MAX_LADDER_LEGS,
} from '../_lib/orders.js';
import { listOrderBook, listOrderEvents, bookEntry } from '../_lib/order-book.js';
import {
	listDca, validateEvmDca, createEvmDca, findEvmDca, cancelEvmDca, presentDca, EVM_PERIODS,
} from '../_lib/dca-unified.js';
import { placeOrders, buildRequestPreview } from '../agents/orders.js';

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false };
// Previews read live prices and sign a preview id; nothing is placed.
const PREVIEW = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const CANCEL = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const FINANCIAL = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

/** The order shapes order_preview prices, and the create tool each one authorizes. */
const ORDER_TOOL_FOR = Object.freeze({
	limit: 'limit_order_create',
	stop: 'stop_order_create',
	trailing: 'trailing_order_create',
	ladder: 'ladder_order_create',
	oco: 'oco_order_create',
});
const OPEN_STATUSES = ['active', 'partial', 'firing', 'paused'];
const CLOSED_STATUSES = ['filled', 'cancelled', 'expired', 'error'];

function refusal(text, reason, extra = {}) {
	return { content: [{ type: 'text', text }], structuredContent: { ok: false, reason, ...extra }, isError: true };
}

const ok = (lines, structured) => ({ content: [{ type: 'text', text: lines.filter((l) => l != null && l !== false).join('\n') }], structuredContent: { ok: true, ...structured } });

async function enforce(auth) {
	const rl = await limits.mcpAgent(auth.userId || auth.rateKey || 'anon');
	if (!rl.success) {
		throw Object.assign(new Error('rate_limited'), { code: -32000, data: { retry_after: Math.ceil((rl.reset - Date.now()) / 1000) } });
	}
}

/** Sign-in, scope and ownership gate, plus the designed-error mapping. */
async function run(auth, { scope }, agentId, fn) {
	await enforce(auth);
	if (!auth.userId) return refusal('Sign in to three.ws to manage your agents’ orders.', 'auth_required', { signed_in: false });
	if (scope && !hasScope(auth.scope, scope)) {
		return refusal(`This action needs the ${scope} scope. Re-authorize with it granted.`, 'insufficient_scope', { required: scope });
	}
	const [agent] = await sql`
		SELECT id, user_id, name, meta FROM agent_identities WHERE id = ${agentId} AND deleted_at IS NULL LIMIT 1
	`;
	if (!agent || agent.user_id !== auth.userId) return refusal('No agent with that id belongs to you. wallet_status lists your agents.', 'not_found');
	try {
		return await fn({ ...agent, meta: { ...(agent.meta || {}) } });
	} catch (err) {
		if (err instanceof PreviewError) return refusal(`${err.message} Run the preview tool again and show the user the fresh result.`, err.code);
		throw err;
	}
}

async function requireAgreement(userId, what) {
	let signed;
	try {
		signed = await currentSignatureFor(userId);
	} catch {
		return refusal(`Could not verify your signed real-funds agreements, so nothing was ${what}. Try again in a moment.`, 'agreement_check_unavailable');
	}
	if (signed) return null;
	const r = agreementRequirement();
	return refusal(`Sign the real-funds agreements before arming real-funds orders. Nothing was ${what}. Sign at ${r.sign_url}`, 'risk_ack_required', r);
}

// ── formatting ───────────────────────────────────────────────────────────────

const sizeText = (o) => (o.side === 'buy'
	? `${o.size_sol} SOL`
	: o.sell_pct != null ? `${o.sell_pct}% of the holding` : `${o.size_tokens} base units`);

function orderLine(o) {
	const skip = o.last_skip ? ` Last skip: ${o.last_skip.label}${o.last_skip.detail ? ` (${o.last_skip.detail})` : ''}.` : '';
	const group = o.group_id ? ` [${o.group_kind} leg ${o.group_leg}]` : '';
	return `- [${o.id}] ${o.type} ${o.side} ${o.symbol || o.mint}${group}: ${o.description || ''} Status ${o.status}, ${o.fill_count || 0} fill(s). ${o.next_fire?.label || ''}.${skip}`;
}

function spendBlock({ agent, network, legs, rail = 'solana', evm = null }) {
	if (rail === 'evm') {
		return [
			'Confirm with the user before dca_create:',
			`  chain      EVM chain ${evm.chain_id}`,
			`  wallet     the signed delegation ${evm.delegation_id}`,
			`  pay        ${evm.amount_per_execution} base units of ${evm.token_in} every ${evm.period_seconds === 86400 ? 'day' : 'week'}`,
			`  receive    ${evm.token_out_symbol} (${evm.token_out}), slippage ${evm.slippage_bps} bps`,
			'  recipient  the delegating smart account (swaps settle back to it)',
		];
	}
	const lines = [
		'Confirm with the user before placing:',
		`  chain      Solana ${network}${network === 'devnet' ? ' (no real funds)' : ''}`,
		`  wallet     agent ${agent.name || agent.id} ${agent.meta.solana_address || '(no wallet provisioned yet)'}`,
		'  recipient  the same agent wallet (fills settle back to it)',
	];
	for (const l of legs) lines.push(`  ${l.order.side === 'buy' ? 'spend' : 'sell '}      ${sizeText(l.order)}${l.order.side === 'buy' ? ' for' : ' of'} ${l.order.symbol || l.order.mint}`);
	return lines;
}

function legLines(l) {
	const p = l.preview || {};
	const cur = p.current ? ` now ${p.current.value ?? 'n/a'} ${p.current.metric}` : ' no live price yet';
	const band = p.in_band === false ? ', outside the price band' : '';
	return `  ${l.leg ? `leg ${l.leg}: ` : ''}${l.readback}.${cur}${band}. Fires now: ${p.would_fire_now == null ? 'unknown' : p.would_fire_now ? 'yes' : 'no'}. ${l.when?.label || ''}`;
}

function previewText(r, { agent, network, tool, preview }) {
	const legs = r.kind === 'single' ? [r] : r.legs;
	const lines = [r.kind === 'single' ? 'Order preview' : r.readback];
	for (const l of legs) lines.push(legLines(l));
	if (r.when?.first_at) lines.push(`  schedule  first ${r.when.first_at}, last about ${r.when.last_at}${r.when.expires_at ? `, expires ${r.when.expires_at}` : ''}`);
	lines.push(`  venue     ${r.venue?.route || 'none yet'} (requested ${r.venue?.requested || 'auto'})${r.venue?.reason ? `: ${r.venue.reason}` : ''}`);
	if (r.firewall) lines.push(`  firewall  ${r.firewall.verdict}${r.firewall.score != null ? ` (score ${r.firewall.score})` : ''}${r.firewall.reasons?.length ? `: ${r.firewall.reasons.join('; ')}` : ''}`);
	if (r.spend_limits) lines.push(`  limits    ${Object.entries(r.spend_limits).filter(([, v]) => v != null).map(([k, v]) => `${k} ${v}`).join(', ') || 'platform defaults'}`);
	lines.push('', ...spendBlock({ agent, network, legs }));
	lines.push('', `preview_id ${preview.id} (expires ${preview.expires_at}). Call ${tool} with it and the confirm flag only after the user says yes.`);
	return lines.join('\n');
}

// ── schemas ──────────────────────────────────────────────────────────────────

const agentIdProp = { type: 'string', format: 'uuid', description: 'The agent whose Solana wallet trades. wallet_status or three://agents lists yours.' };
const networkProp = { type: 'string', enum: ['mainnet', 'devnet'], default: 'mainnet', description: 'Solana cluster. devnet places orders with no real funds at risk.' };
const previewIdProp = { type: 'string', minLength: 10, maxLength: 8192, description: 'preview_id from the matching preview tool, before it expires (ten minutes).' };
const confirmOrderProp = { type: 'boolean', const: true, description: 'Must be true. Set it only after showing the preview to the user and getting a clear yes.' };
const mintProp = { type: 'string', minLength: 32, maxLength: 44, description: 'SPL token mint (base58). Any token a venue prices: launchpad bonding curves and graduated pools, or any aggregator-routable mint on mainnet.' };
const sideProp = { type: 'string', enum: ['buy', 'sell'], description: 'buy spends SOL for the token; sell sells the token for SOL.' };
const metricProp = { type: 'string', enum: TRIGGER_METRICS, default: 'price_sol', description: 'What the trigger compares: SOL per token, market cap in SOL, or market cap in USD.' };
const venueProp = { type: 'string', enum: ORDER_VENUES, default: 'auto', description: 'auto picks the launchpad curve or pool when the token has one and the aggregator otherwise. aggregator routes mainnet only.' };
const sizing = {
	size_sol: { type: 'number', exclusiveMinimum: 0, description: 'SOL to spend (buys).' },
	sell_pct: { type: 'number', exclusiveMinimum: 0, maximum: 100, description: 'Share of the holding to sell (sells).' },
	size_tokens: { type: 'string', pattern: '^\\d+$', description: 'Raw token base units to sell (sells), as a decimal integer string.' },
};
const common = {
	symbol: { type: 'string', maxLength: 16, description: 'Display symbol for readbacks.' },
	slippage_bps: { type: 'integer', minimum: 1, maximum: 5000, description: 'Slippage tolerance per fill.' },
	max_price_impact_pct: { type: 'number', exclusiveMinimum: 0, maximum: 100, description: 'Skip a fill whose price impact is above this.' },
	expires_at: { type: 'string', format: 'date-time', description: 'When the order stops working if it has not filled.' },
};

// ── handlers ─────────────────────────────────────────────────────────────────

function orderRequestFrom(args) {
	const { agent_id: _a, network: _n, order_type, ...rest } = args;
	if (order_type === 'ladder' || order_type === 'oco') return { kind: order_type, body: rest };
	return { kind: 'single', body: { ...rest, type: order_type } };
}

async function orderPreview(args, auth) {
	return run(auth, { scope: 'wallet:read' }, args.agent_id, async (agent) => {
		const network = args.network || 'mainnet';
		const { kind, body } = orderRequestFrom(args);
		const norm = normalizeOrderRequest({ ...body, network }, kind);
		if (!norm.ok) return refusal(norm.message || 'The order could not be validated.', norm.error || 'invalid_order');
		const r = await buildRequestPreview({ meta: agent.meta, norm });
		const tool = ORDER_TOOL_FOR[args.order_type];
		const preview = issuePreview('order', { userId: auth.userId, agentId: agent.id, network, tool, kind, body });
		return ok([previewText(r, { agent, network, tool, preview })], { preview_id: preview.id, expires_at: preview.expires_at, create_tool: tool, network, ...r });
	});
}

function orderCreate(tool) {
	return (args, auth) => run(auth, { scope: 'wallet:trade' }, args.agent_id, async (agent) => {
		if (args.confirm_order !== true) return refusal('Set confirm_order: true only after the user approved the preview. Nothing was placed.', 'confirmation_required');
		const { claims, nonce } = verifyPreview(args.preview_id, 'order', { userId: auth.userId });
		if (claims.agentId !== agent.id) throw new PreviewError('preview_mismatch', 'This preview was issued for a different agent.');
		if (claims.tool !== tool) throw new PreviewError('preview_mismatch', `This preview authorizes ${claims.tool}, not ${tool}.`);
		if (claims.network === 'mainnet') {
			const blocked = await requireAgreement(auth.userId, 'placed');
			if (blocked) return blocked;
		}
		const norm = normalizeOrderRequest({ ...claims.body, network: claims.network }, claims.kind);
		if (!norm.ok) return refusal(norm.message || 'The order is no longer valid.', norm.error || 'invalid_order');
		const release = await consumePreview(nonce);
		let placed;
		try {
			placed = await placeOrders(agent.id, auth.userId, norm);
		} catch (err) {
			await release();
			throw err;
		}
		const orders = placed.order ? [placed.order] : placed.group.orders;
		return ok([
			`Placed on Solana ${claims.network}${placed.group ? ` as ${placed.group.kind} group ${placed.group.group_id}` : ''}, route ${placed.route || 'resolved on the next sweep'}:`,
			...orders.map((o) => orderLine(bookEntry(o))),
			...placed.warnings.map((w) => `Note: ${w}`),
			'Each fill runs the spend policy, kill switch and firewall. order_book shows next fire times and skip reasons; limit_order_cancel cancels.',
		], { network: claims.network, route: placed.route, warnings: placed.warnings, order: placed.order || null, group: placed.group || null });
	});
}

async function dcaPreview(args, auth) {
	return run(auth, { scope: 'wallet:read' }, args.agent_id, async (agent) => {
		const rail = args.rail || 'solana';
		if (rail === 'evm') {
			const v = validateEvmDca({ ...args, agent_id: agent.id });
			if (!v.ok) return refusal(v.message, v.code);
			const found = await sql`
				SELECT id FROM agent_delegations WHERE id = ${v.value.delegation_id} AND agent_id = ${agent.id} AND status = 'active' LIMIT 1
			`;
			if (!found.length) return refusal('That delegation is not active for this agent. The owner signs one on three.ws first.', 'delegation_inactive');
			const preview = issuePreview('dca', { userId: auth.userId, agentId: agent.id, rail, body: v.value });
			const first = new Date(Date.now() + v.value.period_seconds * 1000).toISOString();
			return ok([
				`EVM DCA preview: first swap ${first}, then every ${v.value.period_seconds === 86400 ? 'day' : 'week'} until cancelled.`,
				'', ...spendBlock({ agent, rail, evm: v.value }),
				'', `preview_id ${preview.id} (expires ${preview.expires_at}). Call dca_create with it and confirm_dca: true only after the user says yes.`,
			], { preview_id: preview.id, expires_at: preview.expires_at, rail, schedule: { ...v.value, first_at: first } });
		}
		const network = args.network || 'mainnet';
		const { rail: _r, agent_id: _a, network: _n, delegation_id: _d, ...body } = args;
		const norm = normalizeOrderRequest({ ...body, type: 'dca', network }, 'single');
		if (!norm.ok) return refusal(norm.message || 'The DCA could not be validated.', norm.error || 'invalid_order');
		const r = await buildRequestPreview({ meta: agent.meta, norm });
		const preview = issuePreview('dca', { userId: auth.userId, agentId: agent.id, rail, network, body });
		return ok([previewText(r, { agent, network, tool: 'dca_create', preview }).replace('the confirm flag', 'confirm_dca: true')],
			{ preview_id: preview.id, expires_at: preview.expires_at, rail, network, ...r });
	});
}

async function dcaCreate(args, auth) {
	return run(auth, { scope: 'wallet:trade' }, args.agent_id, async (agent) => {
		if (args.confirm_dca !== true) return refusal('Set confirm_dca: true only after the user approved the preview. Nothing was scheduled.', 'confirmation_required');
		const { claims, nonce } = verifyPreview(args.preview_id, 'dca', { userId: auth.userId });
		if (claims.agentId !== agent.id) throw new PreviewError('preview_mismatch', 'This preview was issued for a different agent.');
		if (claims.rail === 'evm' || claims.network === 'mainnet') {
			const blocked = await requireAgreement(auth.userId, 'scheduled');
			if (blocked) return blocked;
		}
		const release = await consumePreview(nonce);
		try {
			if (claims.rail === 'evm') {
				const created = await createEvmDca(auth.userId, claims.body);
				if (!created.ok) {
					await release();
					return refusal(created.message, created.code);
				}
				const s = presentDca(created.order);
				return ok([`Scheduled EVM DCA ${s.id}: ${s.amount_display || s.amount_in_raw} ${s.period_label}, first swap ${s.next_execution_at}. dca_cancel stops it.`], { rail: 'evm', schedule: s });
			}
			const norm = normalizeOrderRequest({ ...claims.body, type: 'dca', network: claims.network }, 'single');
			if (!norm.ok) {
				await release();
				return refusal(norm.message || 'The DCA is no longer valid.', norm.error || 'invalid_order');
			}
			const placed = await placeOrders(agent.id, auth.userId, norm);
			const s = presentDca(placed.order);
			return ok([
				`Scheduled DCA ${s.id} on Solana ${claims.network}: ${s.description} Route ${placed.route || 'resolved on the next sweep'}. ${s.next_fire.label}.`,
				...placed.warnings.map((w) => `Note: ${w}`),
				'Each slice runs the spend policy, kill switch and firewall. dca_cancel stops it.',
			], { rail: 'solana', network: claims.network, route: placed.route, warnings: placed.warnings, schedule: s });
		} catch (err) {
			await release();
			throw err;
		}
	});
}

async function dcaList(args, auth) {
	return run(auth, { scope: 'wallet:read' }, args.agent_id, async (agent) => {
		const statuses = args.status === 'all' ? null : OPEN_STATUSES;
		const schedules = await listDca(agent.id, { rail: args.rail || null, statuses });
		if (!schedules.length) return ok(['No DCA schedules. dca_preview prices a new one.'], { count: 0, schedules });
		return ok([
			`${schedules.length} DCA schedule(s):`,
			...schedules.map((s) => (s.rail === 'evm'
				? `- [${s.id}] EVM ${s.token_out_symbol}: ${s.amount_display || s.amount_in_raw} ${s.period_label}, ${s.status}, next ${s.next_execution_at || 'none'}, ${s.executions_total || 0} swap(s).`
				: `- [${s.id}] Solana ${s.network} ${s.symbol || s.mint}: ${s.description} ${s.status}, ${s.filled_slices}/${s.slices} slices. ${s.next_fire.label}.${s.last_skip ? ` Last skip: ${s.last_skip.label}.` : ''}`)),
		], { count: schedules.length, schedules });
	});
}

async function dcaCancel(args, auth) {
	return run(auth, { scope: 'wallet:trade' }, args.agent_id, async (agent) => {
		const order = await getOrder(agent.id, args.schedule_id);
		if (!order || order.type !== 'dca') return refusal('No DCA schedule with that id on this agent. dca_list shows them.', 'not_found');
		if (order.network === 'evm') {
			const found = await findEvmDca(auth.userId, order.id);
			if (!found) return refusal('No DCA schedule with that id on this agent.', 'not_found');
			const done = order.status === 'cancelled' ? order : await cancelEvmDca(order.id);
			return ok([`Cancelled EVM DCA ${order.id}. The delegation itself stays signed; revoke it on three.ws to withdraw the permission.`], { schedule: presentDca(done || order) });
		}
		const done = await cancelOrder(agent.id, order.id, { reason: 'mcp' });
		return ok([`Cancelled DCA ${order.id}. No further slices will fire.`], { schedule: presentDca(done || order) });
	});
}

async function orderList(args, auth) {
	return run(auth, { scope: 'wallet:read' }, args.agent_id, async (agent) => {
		const statuses = args.status === 'all' ? null : args.status === 'closed' ? CLOSED_STATUSES : OPEN_STATUSES;
		const rows = await listOrders(agent.id, { network: args.network || null, statuses, limit: args.limit || 50 });
		const orders = rows.filter((o) => !args.type || o.type === args.type).map(bookEntry);
		if (!orders.length) return ok(['No orders match. order_preview prices a new one.'], { count: 0, orders });
		return ok([`${orders.length} order(s):`, ...orders.map(orderLine)], { count: orders.length, orders });
	});
}

async function orderCancel(args, auth) {
	return run(auth, { scope: 'wallet:trade' }, args.agent_id, async (agent) => {
		const existing = await getOrder(agent.id, args.order_id);
		if (!existing || existing.network === 'evm') return refusal('No order with that id on this agent. limit_order_list shows them.', 'not_found');
		const done = await cancelOrder(agent.id, existing.id, { reason: 'mcp' });
		const sibling = existing.group_kind === 'oco' ? ' Its OCO sibling was cancelled with it.' : '';
		return ok([`Cancelled ${existing.type} order ${existing.id}.${sibling}`], { order: done ? bookEntry(done) : bookEntry(existing) });
	});
}

async function orderHistory(args, auth) {
	return run(auth, { scope: 'wallet:read' }, args.agent_id, async (agent) => {
		const limit = args.limit || 30;
		if (args.order_id) {
			const order = await getOrder(agent.id, args.order_id);
			if (!order) return refusal('No order with that id on this agent.', 'not_found');
			const [fills, events, group] = await Promise.all([
				listFills(order.id, { limit }),
				listOrderEvents(agent.id, { orderId: order.id, limit }),
				order.group_id ? getOrderGroup(agent.id, order.group_id) : null,
			]);
			return ok([
				orderLine(bookEntry(order)),
				`Fills (${fills.length}):`,
				...fills.map((f) => `  ${f.created_at} ${f.status} ${f.sol_amount ?? ''} SOL ${f.signature ? `sig ${f.signature}` : ''}`.replace(/\s+/g, ' ')),
				`Events (${events.length}):`,
				...events.map((e) => `  ${e.created_at} ${e.kind}${e.code ? ` ${e.code}` : ''}${e.label ? ` (${e.label})` : ''}${e.detail ? `: ${e.detail}` : ''}`),
			], { order: bookEntry(order), fills, events, group });
		}
		const [closed, events] = await Promise.all([
			listOrders(agent.id, { network: args.network || null, statuses: CLOSED_STATUSES, limit }),
			listOrderEvents(agent.id, { limit }),
		]);
		return ok([
			`${closed.length} closed order(s):`,
			...closed.map((o) => orderLine(bookEntry(o))),
			`Recent events (${events.length}):`,
			...events.map((e) => `  ${e.created_at} [${e.order_id}] ${e.kind}${e.code ? ` ${e.code}` : ''}${e.detail ? `: ${e.detail}` : ''}`),
		], { orders: closed.map(bookEntry), events });
	});
}

async function orderBook(args, auth) {
	return run(auth, { scope: 'wallet:read' }, args.agent_id, async (agent) => {
		const network = args.network || 'mainnet';
		const book = await listOrderBook(agent.id, { network });
		const skipping = book.filter((o) => o.last_skip).length;
		if (!book.length) return ok([`Nothing resting on Solana ${network}. order_preview or dca_preview prices a new order.`], { network, count: 0, book });
		return ok([`${book.length} resting order(s) on Solana ${network}, ${skipping} currently skipping:`, ...book.map(orderLine)], { network, count: book.length, skipping, book });
	});
}

// ── definitions ──────────────────────────────────────────────────────────────

const orderCreateSchema = {
	type: 'object',
	properties: { agent_id: agentIdProp, preview_id: previewIdProp, confirm_order: confirmOrderProp },
	required: ['agent_id', 'preview_id', 'confirm_order'],
	additionalProperties: false,
};

function createDef(tool, title, what) {
	return {
		name: tool,
		title,
		group: 'trading',
		tier: 'financial',
		confirmFlag: 'confirm_order',
		previewTool: 'order_preview',
		annotations: FINANCIAL,
		description: `${what} Pass the preview_id order_preview issued for the same agent (ten minutes, single use) and confirm_order: true after the user approved it. Fills later run the agent spend policy, kill switch and rug firewall. Call this after the user approved the matching order_preview.`,
		inputSchema: orderCreateSchema,
		handler: orderCreate(tool),
	};
}

export const orderToolDefs = [
	{
		name: 'order_preview',
		title: 'Preview an order',
		group: 'trading',
		tier: 'read',
		annotations: PREVIEW,
		description: `Price a resting order on any SPL token without placing it: limit, stop, trailing, a ladder of up to ${MAX_LADDER_LEGS} limit levels, or an OCO pair (take-profit plus stop-loss or trailing stop; whichever fills first cancels the other). Returns the live price, whether it would fire now, the venue it would route through, the firewall verdict for a buy, the spend limits, and when it acts, plus the preview_id the matching create tool requires. Moves nothing. Call this first for any limit, stop, trailing, ladder or OCO order.`,
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: agentIdProp,
				network: networkProp,
				order_type: { type: 'string', enum: Object.keys(ORDER_TOOL_FOR), description: 'limit, stop, trailing, ladder or oco.' },
				mint: mintProp,
				side: sideProp,
				trigger_metric: metricProp,
				venue: venueProp,
				limit_price: { type: 'number', exclusiveMinimum: 0, description: 'limit: the level. Sell fills at or above, buy at or below.' },
				stop_price: { type: 'number', exclusiveMinimum: 0, description: 'stop: the level. Sell fires at or below, buy at or above.' },
				trail_pct: { type: 'number', exclusiveMinimum: 0, maximum: 95, description: 'trailing (or the OCO protective leg): percent from the high (sell) or low (buy).' },
				take_profit: { type: 'number', exclusiveMinimum: 0, description: 'oco: the take-profit (sell) or dip-buy (buy) level.' },
				stop_loss: { type: 'number', exclusiveMinimum: 0, description: 'oco: the stop level. Omit and pass trail_pct for a trailing protective leg.' },
				legs: {
					type: 'array', minItems: 2, maxItems: MAX_LADDER_LEGS,
					description: 'ladder: one entry per level. Sell legs take sell_pct of the bag as it is when placed (at most 100 in total); buy legs spend their own size_sol.',
					items: {
						type: 'object',
						properties: { price: { type: 'number', exclusiveMinimum: 0 }, ...sizing },
						required: ['price'],
						additionalProperties: false,
					},
				},
				...sizing,
				...common,
			},
			required: ['agent_id', 'order_type', 'mint'],
			additionalProperties: false,
		},
		handler: orderPreview,
	},
	createDef('limit_order_create', 'Place a limit order', 'Place the limit order order_preview priced.'),
	createDef('stop_order_create', 'Place a stop order', 'Place the stop order order_preview priced.'),
	createDef('trailing_order_create', 'Place a trailing stop', 'Place the trailing order order_preview priced.'),
	createDef('ladder_order_create', 'Place a ladder', 'Place every level of the ladder order_preview priced, as one group.'),
	createDef('oco_order_create', 'Place an OCO pair', 'Place the one-cancels-other pair order_preview priced, as one group.'),
	{
		name: 'limit_order_list',
		title: 'List orders',
		group: 'trading',
		tier: 'read',
		annotations: READ,
		description: 'An agent’s orders (limit, stop, trailing, ladder and OCO legs, DCA, TWAP) with status, fills, next fire time and the reason the last evaluation skipped. Open orders by default. Use this to review an agent\'s open orders or find an order id to cancel.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: agentIdProp,
				network: { type: 'string', enum: ['mainnet', 'devnet'], description: 'Limit to one cluster. Both when omitted.' },
				status: { type: 'string', enum: ['open', 'closed', 'all'], default: 'open' },
				type: { type: 'string', enum: ['limit', 'stop', 'trailing', 'dca', 'twap', 'conditional'] },
				limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
			},
			required: ['agent_id'],
			additionalProperties: false,
		},
		handler: orderList,
	},
	{
		name: 'limit_order_cancel',
		title: 'Cancel an order',
		group: 'trading',
		tier: 'write',
		annotations: CANCEL,
		description: 'Cancel one resting order (limit, stop, trailing, a ladder level, or an OCO leg, which also cancels its sibling). Cancelling never moves funds. Use this when the user wants a resting order gone; for a DCA schedule use dca_cancel.',
		inputSchema: {
			type: 'object',
			properties: { agent_id: agentIdProp, order_id: { type: 'string', format: 'uuid' } },
			required: ['agent_id', 'order_id'],
			additionalProperties: false,
		},
		handler: orderCancel,
	},
	{
		name: 'limit_order_history',
		title: 'Order history',
		group: 'trading',
		tier: 'read',
		annotations: READ,
		description: 'Closed orders and the lifecycle log (placed, skip-reason changes, fires, failures, cancels). With order_id: that order’s fills, events and group. Use this to see why an order fired, failed or was skipped.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: agentIdProp,
				order_id: { type: 'string', format: 'uuid' },
				network: { type: 'string', enum: ['mainnet', 'devnet'] },
				limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
			},
			required: ['agent_id'],
			additionalProperties: false,
		},
		handler: orderHistory,
	},
	{
		name: 'order_book',
		title: 'Agent order book',
		group: 'trading',
		tier: 'read',
		annotations: READ,
		description: 'Everything an agent has resting on one Solana cluster, soonest action first, with the next fire time and the reason the last evaluation skipped (price outside band, cap hit, venue unhealthy, kill switch, insufficient funds, no quote, price impact, nothing to sell, firewall). Use this to see what an agent will do next on a cluster and why anything is stuck.',
		inputSchema: {
			type: 'object',
			properties: { agent_id: agentIdProp, network: networkProp },
			required: ['agent_id'],
			additionalProperties: false,
		},
		handler: orderBook,
	},
	{
		name: 'dca_preview',
		title: 'Preview a DCA schedule',
		group: 'trading',
		tier: 'read',
		annotations: PREVIEW,
		description: 'Price a dollar-cost-averaging schedule without creating it. rail "solana" (default) buys or sells any SPL token from the agent wallet every interval_seconds for a number of slices, optionally only while the price sits inside price_band. rail "evm" swaps a fixed amount daily or weekly through a delegation the owner already signed. Returns what would be placed, when the first and last slice run, the venue and spend limits, and the preview_id dca_create requires. Call this before dca_create, and show the owner what it would place.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: agentIdProp,
				rail: { type: 'string', enum: ['solana', 'evm'], default: 'solana' },
				network: networkProp,
				mint: mintProp,
				side: sideProp,
				venue: venueProp,
				trigger_metric: metricProp,
				schedule: {
					type: 'object',
					properties: {
						interval_seconds: { type: 'integer', minimum: 60, description: 'Seconds between slices.' },
						slices: { type: 'integer', minimum: 1, maximum: 1000, description: 'How many slices in total.' },
					},
					required: ['interval_seconds', 'slices'],
					additionalProperties: false,
				},
				price_band: {
					type: 'object',
					description: 'Only fill a slice while the metric is inside this band; a slice outside it is skipped and recorded as price_outside_band.',
					properties: { min: { type: 'number', exclusiveMinimum: 0 }, max: { type: 'number', exclusiveMinimum: 0 }, metric: metricProp },
					additionalProperties: false,
				},
				...sizing,
				...common,
				delegation_id: { type: 'string', format: 'uuid', description: 'evm: the signed delegation the swaps run under.' },
				chain_id: { type: 'integer', minimum: 1, description: 'evm: chain id; defaults to the platform DCA chain.' },
				token_in: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$', description: 'evm: token spent each period.' },
				token_out: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$', description: 'evm: token bought each period.' },
				token_out_symbol: { type: 'string', maxLength: 10, description: 'evm: symbol of token_out; must be on the platform allowlist.' },
				amount_per_execution: { type: 'string', pattern: '^\\d+$', description: 'evm: base units of token_in per swap.' },
				period_seconds: { type: 'integer', enum: EVM_PERIODS, description: 'evm: 86400 daily or 604800 weekly.' },
			},
			required: ['agent_id'],
			additionalProperties: false,
		},
		handler: dcaPreview,
	},
	{
		name: 'dca_create',
		title: 'Create a DCA schedule',
		group: 'trading',
		tier: 'financial',
		confirmFlag: 'confirm_dca',
		previewTool: 'dca_preview',
		annotations: FINANCIAL,
		description: 'Create the DCA schedule dca_preview priced. Pass its preview_id (ten minutes, single use) and confirm_dca: true after the user approved it. Every slice runs the agent spend policy, kill switch and firewall. Call this after the user approved a dca_preview.',
		inputSchema: {
			type: 'object',
			properties: { agent_id: agentIdProp, preview_id: previewIdProp, confirm_dca: confirmOrderProp },
			required: ['agent_id', 'preview_id', 'confirm_dca'],
			additionalProperties: false,
		},
		handler: dcaCreate,
	},
	{
		name: 'dca_list',
		title: 'List DCA schedules',
		group: 'trading',
		tier: 'read',
		annotations: READ,
		description: 'Every DCA schedule an agent runs on both rails (Solana agent wallet and EVM delegation) with progress, next run and the latest skip reason. Live schedules by default. Use this to check a schedule\'s progress or find the id dca_cancel needs.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: agentIdProp,
				rail: { type: 'string', enum: ['solana', 'evm'] },
				status: { type: 'string', enum: ['open', 'all'], default: 'open' },
			},
			required: ['agent_id'],
			additionalProperties: false,
		},
		handler: dcaList,
	},
	{
		name: 'dca_cancel',
		title: 'Cancel a DCA schedule',
		group: 'trading',
		tier: 'write',
		annotations: CANCEL,
		description: 'Stop a DCA schedule on either rail. No further slices fire. An EVM delegation stays signed until the owner revokes it. Use this when the owner wants a DCA schedule to stop.',
		inputSchema: {
			type: 'object',
			properties: { agent_id: agentIdProp, schedule_id: { type: 'string', format: 'uuid' } },
			required: ['agent_id', 'schedule_id'],
			additionalProperties: false,
		},
		handler: dcaCancel,
	},
];
