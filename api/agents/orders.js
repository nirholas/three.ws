/**
 * Programmable Orders API — owner-only control surface for the order engine.
 * Routed from api/agents/[id].js as /api/agents/:id/orders.
 *
 *   GET    /api/agents/:id/orders               → orders + summary + live balance
 *   POST   /api/agents/:id/orders               → create a validated order (real)
 *   POST   /api/agents/:id/orders/preview        → validate + live preview (metric, would-fire, firewall verdict)
 *   POST   /api/agents/:id/orders/cancel-all      → cancel every active order (orders kill switch)
 *   GET    /api/agents/:id/orders/stream          → SSE: live order status
 *   GET    /api/agents/:id/orders/:orderId        → one order + its fills
 *   PUT    /api/agents/:id/orders/:orderId        → edit (price/trail/slippage/expiry/pause)
 *   DELETE /api/agents/:id/orders/:orderId        → cancel one order (instant)
 *
 * Every write is owner-only (server-side) and CSRF-protected. Orders fire ONLY
 * from the agent's own wallet through the shared, spend-policy-gated, firewalled,
 * audited execeuteAgentTrade pipeline. A visitor can never read or mutate orders.
 */

import { cors, json, method, error, readJson, rateLimited, serverError } from '../_lib/http.js';
import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { limits } from '../_lib/rate-limit.js';
import { requireCsrf } from '../_lib/csrf.js';
import { requireRealFundsAgreement } from '../_lib/real-funds-agreement.js';
import { sql } from '../_lib/db.js';
import { getSolanaAddressBalances } from '../_lib/agent-wallet.js';
import { getSpendLimits, getTradeLimits } from '../_lib/agent-trade-guards.js';
import { getPumpTradeClient } from '../_lib/pump.js';
import { assessTradeSafety } from '../_lib/trade-firewall.js';
import { PublicKey } from '@solana/web3.js';
import {
	normalizeOrder, describeOrder, conditionSignals, evaluateCondition, shouldFirePrice,
	listOrders, getOrder, listFills, createOrder, updateOrder, cancelOrder, cancelAllOrders, ordersSummary,
	CONDITION_SIGNALS, NUMBER_OPS, BOOL_OPS, ORDER_TYPES, TRIGGER_METRICS,
} from '../_lib/orders.js';
import { getSignals, metricValue } from '../../workers/agent-orders/market.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId };
	return null;
}

async function loadOwned(req, res, id) {
	const auth = await resolveAuth(req);
	if (!auth) { error(res, 401, 'unauthorized', 'sign in to manage this agent’s orders'); return { error: true }; }
	const [row] = await sql`SELECT id, user_id, name, meta FROM agent_identities WHERE id = ${id} AND deleted_at IS NULL`;
	if (!row) { error(res, 404, 'not_found', 'agent not found'); return { error: true }; }
	if (row.user_id !== auth.userId) { error(res, 403, 'forbidden', 'only the owner can manage orders'); return { error: true }; }
	return { auth, row, meta: { ...(row.meta || {}) } };
}

function netOf(req) {
	const url = new URL(req.url, 'http://x');
	return url.searchParams.get('network') === 'devnet' ? 'devnet' : 'mainnet';
}

export default async function handler(req, res, id, action) {
	if (cors(req, res, { methods: 'GET,POST,PUT,DELETE,OPTIONS', credentials: true })) return;

	if (action === 'preview') return handlePreview(req, res, id);
	if (action === 'cancel-all') return handleCancelAll(req, res, id);
	if (action === 'stream') return handleStream(req, res, id);
	if (action === 'schema') return handleSchema(req, res, id);
	if (action && UUID_RE.test(action)) {
		if (req.method === 'GET') return handleGetOne(req, res, id, action);
		if (req.method === 'PUT') return handleUpdate(req, res, id, action);
		if (req.method === 'DELETE') return handleCancel(req, res, id, action);
		return error(res, 405, 'method_not_allowed', 'use GET, PUT, or DELETE on an order');
	}
	if (action) return error(res, 404, 'not_found', 'unknown orders sub-resource');

	if (req.method === 'GET') return handleList(req, res, id);
	if (req.method === 'POST') return handleCreate(req, res, id);
	return method(req, res, ['GET', 'POST']) ? error(res, 405, 'method_not_allowed', 'use GET or POST') : undefined;
}

// GET — orders + summary + live balance + freeze state.
async function handleList(req, res, id) {
	const owned = await loadOwned(req, res, id);
	if (owned.error) return;
	const rl = await limits.walletRead(owned.auth.userId);
	if (!rl.success) return rateLimited(res, rl);

	const network = netOf(req);
	const [orders, summary] = await Promise.all([listOrders(id, { network }), ordersSummary(id, network)]);
	const spend = getSpendLimits(owned.meta);

	let balanceSol = null;
	try { balanceSol = Number((await getSolanaAddressBalances(owned.meta.solana_address, network))?.sol ?? null); }
	catch { balanceSol = null; }

	return json(res, 200, {
		data: {
			orders,
			summary: { ...summary, balance_sol: balanceSol, frozen: !!spend.frozen, kill_switch: !!getTradeLimits(owned.meta).kill_switch },
		},
	});
}

// GET /schema — the closed condition vocabulary + order types (drives the UI builder).
async function handleSchema(req, res, id) {
	const owned = await loadOwned(req, res, id);
	if (owned.error) return;
	return json(res, 200, {
		data: {
			order_types: ORDER_TYPES,
			trigger_metrics: TRIGGER_METRICS,
			number_ops: NUMBER_OPS,
			bool_ops: BOOL_OPS,
			signals: Object.fromEntries(Object.entries(CONDITION_SIGNALS).map(([k, v]) => [k, { kind: v.kind, label: v.label }])),
		},
	});
}

async function handleGetOne(req, res, id, orderId) {
	const owned = await loadOwned(req, res, id);
	if (owned.error) return;
	const order = await getOrder(id, orderId);
	if (!order) return error(res, 404, 'not_found', 'order not found');
	const fills = await listFills(orderId);
	return json(res, 200, { data: { order, fills } });
}

// POST / — create a validated order.
async function handleCreate(req, res, id) {
	const owned = await loadOwned(req, res, id);
	if (owned.error) return;
	// A live order trades from the agent wallet on its own when it fires.
	if (!(await requireRealFundsAgreement(req, res, { userId: owned.auth.userId, network: netOf(req), context: 'order-create' }))) return;
	if (!(await requireCsrf(req, res, owned.auth.userId))) return;
	const rl = await limits.tradePerUser(owned.auth.userId);
	if (!rl.success) return rateLimited(res, rl);

	let body;
	try { body = await readJson(req); } catch (e) { return error(res, e?.status === 415 ? 415 : 400, 'bad_request', e?.message || 'invalid request body'); }

	const norm = normalizeOrder({ ...body, network: netOf(req) });
	if (!norm.ok) return error(res, 422, norm.error || 'invalid_order', norm.message || 'the order could not be validated');

	try {
		const order = await createOrder(id, owned.auth.userId, norm.order);
		return json(res, 201, { data: { order } });
	} catch (e) {
		return serverError(res, 500, 'create_failed', e);
	}
}

// POST /preview — validate + a concrete, REAL live preview: current metric value,
// whether the trigger would fire right now, and (for buys) the firewall verdict.
async function handlePreview(req, res, id) {
	if (!method(req, res, ['POST'])) return;
	const owned = await loadOwned(req, res, id);
	if (owned.error) return;
	if (!(await requireCsrf(req, res, owned.auth.userId))) return;
	const rl = await limits.walletRead(owned.auth.userId);
	if (!rl.success) return rateLimited(res, rl);

	let body;
	try { body = await readJson(req); } catch (e) { return error(res, e?.status === 415 ? 415 : 400, 'bad_request', e?.message || 'invalid request body'); }

	const network = netOf(req);
	const norm = normalizeOrder({ ...body, network });
	if (!norm.ok) return json(res, 200, { data: { ok: false, error: norm.error, message: norm.message } });
	return json(res, 200, { data: { ok: true, ...(await buildOrderPreview({ meta: owned.meta, order: norm.order })) } });
}

/**
 * The live preview of a normalized order: current metric value, whether the
 * trigger would fire right now, the firewall verdict for a buy, and the spend
 * limits it will run under. Read-only. Shared by the HTTP preview route and the
 * MCP order tools, so both show the owner the same thing.
 */
export async function buildOrderPreview({ meta, order: o }) {
	const network = o.network;
	// Live signals: only what this order's trigger references.
	const need = o.type === 'conditional' ? conditionSignals(o.condition) : [];
	if (o.type === 'trailing' || o.type === 'conditional') need.push('mcap_usd');
	let preview = { current: null, would_fire_now: null, missing: [] };
	try {
		const { market, signals } = await getSignals({ network, mint: o.mint, need, metric: o.trigger_metric });
		if (market) {
			const cur = metricValue(market, signals, o.trigger_metric);
			preview.current = { metric: o.trigger_metric, value: cur, price_sol: market.price_sol, mcap_sol: market.mcap_sol, mcap_usd: signals.mcap_usd, graduated: market.graduated };
			if (o.type === 'conditional') {
				const r = evaluateCondition(o.condition, signals);
				preview.would_fire_now = r.fired; preview.missing = r.missing;
			} else if (o.type === 'limit' || o.type === 'stop') {
				preview.would_fire_now = shouldFirePrice(o, cur, cur);
			} else if (o.type === 'trailing') {
				preview.would_fire_now = false; // needs a tracked high/low-water mark first
			}
		}
	} catch { /* preview tolerates a quote miss */ }

	// Firewall verdict for buys (real on-chain simulated round-trip + authority audit).
	let firewall = null;
	if (o.side === 'buy' && meta.solana_address && o.size_sol) {
		try {
			const ctx = await getPumpTradeClient({ network });
			const lamports = BigInt(Math.round(Number(o.size_sol) * 1e9));
			const a = await assessTradeSafety({
				network, mint: o.mint, side: 'buy', payer: new PublicKey(meta.solana_address),
				quoteAmount: lamports, connection: ctx.connection,
			});
			if (a) firewall = { verdict: a.verdict, score: a.score, simulated: a.simulated, reasons: a.reasons?.slice(0, 4) || [] };
		} catch { firewall = null; }
	}

	return { order: o, readback: describeOrder(o), preview, firewall, spend_limits: previewLimits(meta) };
}

function previewLimits(meta) {
	const s = getSpendLimits(meta);
	const t = getTradeLimits(meta);
	return { per_tx_usd: s.per_tx_usd, daily_usd: s.daily_usd, frozen: !!s.frozen, kill_switch: !!t.kill_switch, per_trade_sol: t.per_trade_sol, daily_budget_sol: t.daily_budget_sol };
}

// PUT /:orderId — edit a non-terminal order.
async function handleUpdate(req, res, id, orderId) {
	const owned = await loadOwned(req, res, id);
	if (owned.error) return;
	if (!(await requireCsrf(req, res, owned.auth.userId))) return;

	let body;
	try { body = await readJson(req); } catch (e) { return error(res, e?.status === 415 ? 415 : 400, 'bad_request', e?.message || 'invalid request body'); }

	// Resuming a paused order re-arms it; pausing and other edits never need a signature.
	if (body?.paused === false && !(await requireRealFundsAgreement(req, res, { userId: owned.auth.userId, network: netOf(req), context: 'order-resume' }))) return;

	try {
		const result = await updateOrder(id, orderId, body);
		if (!result) return error(res, 404, 'not_found', 'order not found');
		if (result.error) return error(res, 422, result.error, result.message);
		return json(res, 200, { data: { order: result } });
	} catch (e) {
		return serverError(res, 500, 'update_failed', e);
	}
}

// DELETE /:orderId — instant cancel.
async function handleCancel(req, res, id, orderId) {
	const owned = await loadOwned(req, res, id);
	if (owned.error) return;
	if (!(await requireCsrf(req, res, owned.auth.userId))) return;
	try {
		const order = await cancelOrder(id, orderId);
		if (!order) return error(res, 404, 'not_found', 'order not found');
		return json(res, 200, { data: { order } });
	} catch (e) {
		return serverError(res, 500, 'cancel_failed', e);
	}
}

// POST /cancel-all — orders kill switch (instant). Returns the cancelled count.
async function handleCancelAll(req, res, id) {
	if (!method(req, res, ['POST'])) return;
	const owned = await loadOwned(req, res, id);
	if (owned.error) return;
	if (!(await requireCsrf(req, res, owned.auth.userId))) return;
	try {
		const cancelled = await cancelAllOrders(id, netOf(req));
		return json(res, 200, { data: { cancelled } });
	} catch (e) {
		return serverError(res, 500, 'cancel_failed', e);
	}
}

// GET /stream — Server-Sent Events: push the order list as it changes. Capped at
// ~40s (inside the function's maxDuration) — the client reconnects. Read-only.
const STREAM_MS = 40_000;
const STREAM_TICK_MS = 3_000;

async function handleStream(req, res, id) {
	if (!method(req, res, ['GET'])) return;
	const owned = await loadOwned(req, res, id);
	if (owned.error) return;

	const network = netOf(req);
	res.writeHead(200, {
		'Content-Type': 'text/event-stream; charset=utf-8',
		'Cache-Control': 'no-cache, no-transform',
		Connection: 'keep-alive',
		'X-Accel-Buffering': 'no',
	});
	res.flushHeaders?.();

	let active = true;
	const send = (event, data) => { if (active) { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { teardown(); } } };

	let lastHash = '';
	const push = async () => {
		try {
			const [orders, summary] = await Promise.all([listOrders(id, { network }), ordersSummary(id, network)]);
			const hash = JSON.stringify(orders.map((o) => [o.id, o.status, o.fill_count, o.last_price, o.last_error]));
			if (hash !== lastHash) { lastHash = hash; send('orders', { orders, summary }); }
			else send('ping', { t: Date.now() });
		} catch { send('ping', { t: Date.now() }); }
	};

	await push();
	const tick = setInterval(push, STREAM_TICK_MS);
	const end = setTimeout(() => { send('close', { reason: 'duration_limit' }); teardown(); }, STREAM_MS);

	function teardown() {
		if (!active) return;
		active = false;
		clearInterval(tick); clearTimeout(end);
		try { res.end(); } catch { /* */ }
	}
	req.on('close', teardown);
	req.on('error', teardown);
}
