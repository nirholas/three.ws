/**
 * Programmable Orders API — owner-only control surface for the order engine.
 * Routed from api/agents/[id].js as /api/agents/:id/orders.
 *
 *   GET    /api/agents/:id/orders               → orders + summary + live balance
 *   POST   /api/agents/:id/orders               → create a validated order (real); body.kind 'ladder' | 'oco' places a group
 *   POST   /api/agents/:id/orders/ladder         → create a ladder (several limit levels in one call)
 *   POST   /api/agents/:id/orders/oco            → create an OCO pair (the first fill cancels the other)
 *   POST   /api/agents/:id/orders/preview        → validate + live preview (route, metric, would-fire, when, firewall verdict)
 *   GET    /api/agents/:id/orders/book           → the resting book: next-fire time + last skip reason per order
 *   GET    /api/agents/:id/orders/events         → order history (placed, skip-reason changes, fires, failures, cancels)
 *   GET    /api/agents/:id/orders/dca            → every DCA schedule on both rails (Solana orders + EVM delegation)
 *   POST   /api/agents/:id/orders/dca            → create a DCA on either rail ({ rail: 'solana' | 'evm', ... })
 *   POST   /api/agents/:id/orders/cancel-all      → cancel every active order (orders kill switch)
 *   GET    /api/agents/:id/orders/stream          → SSE: live order status
 *   GET    /api/agents/:id/orders/:orderId        → one order + its fills
 *   PUT    /api/agents/:id/orders/:orderId        → edit (price/trail/slippage/expiry/band/pause); EVM DCA: pause/resume
 *   DELETE /api/agents/:id/orders/:orderId        → cancel one order (instant)
 *
 * Every write is owner-only (server-side) and CSRF-protected. Orders fire ONLY
 * from the agent's own wallet through the shared, spend-policy-gated, firewalled,
 * audited trade pipeline (the launchpad executor or the aggregator executor,
 * chosen by the order's venue). A visitor can never read or mutate orders.
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
	normalizeOrderRequest, describeOrder, humanInterval, conditionSignals, evaluateCondition, shouldFirePrice,
	listOrders, getOrder, listFills, createOrder, createOrderGroup, getOrderGroup, updateOrder, cancelOrder, cancelAllOrders, ordersSummary,
	CONDITION_SIGNALS, NUMBER_OPS, BOOL_OPS, ORDER_TYPES, TRIGGER_METRICS, ORDER_VENUES, GROUP_KINDS, MAX_LADDER_LEGS,
} from '../_lib/orders.js';
import { listOrderBook, listOrderEvents, nextFire, SKIP_CODES } from '../_lib/order-book.js';
import { getSignals, metricValue, resolveRoute } from '../../workers/agent-orders/market.js';
import {
	listDca, validateEvmDca, createEvmDca, findEvmDca, pauseEvmDca, resumeEvmDca, cancelEvmDca,
	presentDca, delegationBlocker, DCA_RAILS,
} from '../_lib/dca-unified.js';

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
	if (action === 'ladder' || action === 'oco') {
		return method(req, res, ['POST']) ? handleCreate(req, res, id, action) : undefined;
	}
	if (action === 'book') return method(req, res, ['GET']) ? handleBook(req, res, id) : undefined;
	if (action === 'events') return method(req, res, ['GET']) ? handleEvents(req, res, id) : undefined;
	if (action === 'dca') {
		if (req.method === 'GET') return handleDcaList(req, res, id);
		if (req.method === 'POST') return handleDcaCreate(req, res, id);
		return error(res, 405, 'method_not_allowed', 'use GET or POST');
	}
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
			venues: ORDER_VENUES,
			group_kinds: GROUP_KINDS,
			max_ladder_legs: MAX_LADDER_LEGS,
			skip_codes: SKIP_CODES,
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
	const [fills, events, group] = await Promise.all([
		listFills(orderId),
		listOrderEvents(id, { orderId, limit: 30 }),
		order.group_id ? getOrderGroup(id, order.group_id) : null,
	]);
	return json(res, 200, { data: { order: { ...order, next_fire: nextFire(order) }, fills, events, group } });
}

// GET /book — every order that can still fill, with when it next acts and why
// the last evaluation did not fire, plus the latest history across the agent.
async function handleBook(req, res, id) {
	const owned = await loadOwned(req, res, id);
	if (owned.error) return;
	const rl = await limits.walletRead(owned.auth.userId);
	if (!rl.success) return rateLimited(res, rl);
	const network = netOf(req);
	const [book, events] = await Promise.all([listOrderBook(id, { network }), listOrderEvents(id, { limit: 40 })]);
	const skipping = book.filter((o) => o.last_skip).length;
	return json(res, 200, { data: { network, book, events, counts: { resting: book.length, skipping } } });
}

// GET /events?order=<uuid>&limit= — order history, newest first.
async function handleEvents(req, res, id) {
	const owned = await loadOwned(req, res, id);
	if (owned.error) return;
	const rl = await limits.walletRead(owned.auth.userId);
	if (!rl.success) return rateLimited(res, rl);
	const url = new URL(req.url, 'http://x');
	const orderId = url.searchParams.get('order');
	if (orderId && !UUID_RE.test(orderId)) return error(res, 400, 'bad_request', 'order must be an order id');
	const events = await listOrderEvents(id, { orderId: orderId || null, limit: url.searchParams.get('limit') });
	return json(res, 200, { data: { events } });
}

// GET /dca?rail=solana|evm — one list of every DCA schedule, both rails.
async function handleDcaList(req, res, id) {
	const owned = await loadOwned(req, res, id);
	if (owned.error) return;
	const rl = await limits.walletRead(owned.auth.userId);
	if (!rl.success) return rateLimited(res, rl);
	const url = new URL(req.url, 'http://x');
	const rail = DCA_RAILS.includes(url.searchParams.get('rail')) ? url.searchParams.get('rail') : null;
	const network = url.searchParams.has('network') ? netOf(req) : null;
	const schedules = await listDca(id, { rail, network });
	return json(res, 200, { data: { schedules, rails: DCA_RAILS } });
}

// POST /dca — create a DCA on either rail. rail 'solana' (default) places an
// order-engine DCA from the agent wallet (any SPL token, optional price band);
// rail 'evm' registers a schedule against an already-signed delegation.
async function handleDcaCreate(req, res, id) {
	const owned = await loadOwned(req, res, id);
	if (owned.error) return;
	if (!(await requireRealFundsAgreement(req, res, { userId: owned.auth.userId, network: netOf(req), context: 'dca-create' }))) return;
	if (!(await requireCsrf(req, res, owned.auth.userId))) return;
	const rl = await limits.tradePerUser(owned.auth.userId);
	if (!rl.success) return rateLimited(res, rl);

	let body;
	try { body = await readJson(req); } catch (e) { return error(res, e?.status === 415 ? 415 : 400, 'bad_request', e?.message || 'invalid request body'); }
	const rail = body?.rail || 'solana';
	if (!DCA_RAILS.includes(rail)) return error(res, 422, 'invalid_rail', 'rail must be solana or evm');

	try {
		if (rail === 'evm') {
			const v = validateEvmDca({ ...body, agent_id: id });
			if (!v.ok) return error(res, v.status === 400 ? 422 : v.status, v.code, v.message);
			const created = await createEvmDca(owned.auth.userId, v.value);
			if (!created.ok) return error(res, created.status, created.code, created.message);
			return json(res, 201, { data: { schedule: presentDca(created.order), rail } });
		}
		const norm = normalizeOrderRequest({ ...body, type: 'dca', network: netOf(req) }, 'single');
		if (!norm.ok) return error(res, 422, norm.error || 'invalid_order', norm.message || 'the DCA could not be validated');
		const placed = await placeOrders(id, owned.auth.userId, norm);
		return json(res, 201, { data: { schedule: presentDca(placed.order), rail, route: placed.route, warnings: placed.warnings } });
	} catch (e) {
		return serverError(res, 500, 'create_failed', e);
	}
}

// PUT / DELETE on an EVM DCA row: the delegation rail has its own lifecycle
// (a resume checks the signed permission and restarts a full period out).
async function evmDcaUpdate(res, owned, order, body) {
	const found = await findEvmDca(owned.auth.userId, order.id);
	if (!found) return error(res, 404, 'not_found', 'order not found');
	if (body?.paused === true) {
		if (found.order.status !== 'active') return error(res, 409, 'conflict', `a ${found.order.status} schedule can’t be paused`);
		return json(res, 200, { data: { order: presentDca(await pauseEvmDca(order.id)) } });
	}
	if (body?.paused === false) {
		if (found.order.status !== 'paused') return error(res, 409, 'conflict', `a ${found.order.status} schedule can’t be resumed`);
		const blocker = delegationBlocker(found);
		if (blocker) return error(res, 409, blocker.code, blocker.message);
		return json(res, 200, { data: { order: presentDca(await resumeEvmDca(found.order)) } });
	}
	return error(res, 422, 'immutable', 'an EVM DCA schedule can only be paused, resumed or cancelled');
}

// POST / (or /ladder, /oco) — create a validated order or order group.
async function handleCreate(req, res, id, kind = null) {
	const owned = await loadOwned(req, res, id);
	if (owned.error) return;
	// A live order trades from the agent wallet on its own when it fires.
	if (!(await requireRealFundsAgreement(req, res, { userId: owned.auth.userId, network: netOf(req), context: 'order-create' }))) return;
	if (!(await requireCsrf(req, res, owned.auth.userId))) return;
	const rl = await limits.tradePerUser(owned.auth.userId);
	if (!rl.success) return rateLimited(res, rl);

	let body;
	try { body = await readJson(req); } catch (e) { return error(res, e?.status === 415 ? 415 : 400, 'bad_request', e?.message || 'invalid request body'); }

	const norm = normalizeOrderRequest({ ...body, network: netOf(req) }, kind || body?.kind);
	if (!norm.ok) return error(res, 422, norm.error || 'invalid_order', norm.message || 'the order could not be validated');

	try {
		const placed = await placeOrders(id, owned.auth.userId, norm);
		return json(res, 201, { data: placed });
	} catch (e) {
		return serverError(res, 500, 'create_failed', e);
	}
}

/**
 * Persist a normalizeOrderRequest result, resolving the fill route first so the
 * order is pinned to the venue that prices it right now. A token no venue
 * prices yet still rests (the worker resolves the route on the first sweep that
 * can quote it) and the caller is told why. Shared with the MCP order tools.
 *
 * @returns {Promise<{ order?: object, group?: { group_id, kind, orders }, route: string|null, warnings: string[] }>}
 */
export async function placeOrders(agentId, userId, norm) {
	const first = norm.orders[0];
	const { route, warnings } = await placementRoute(first);
	if (norm.kind === 'single') {
		const order = await createOrder(agentId, userId, first, { route });
		return { order, route, warnings };
	}
	const group = await createOrderGroup(agentId, userId, { kind: norm.kind, orders: norm.orders }, { route });
	return { group, route, warnings };
}

async function placementRoute(o) {
	let r;
	try { r = await resolveRoute({ network: o.network, mint: o.mint, venue: o.venue }); }
	catch { return { route: null, warnings: ['the fill route could not be checked right now; the worker resolves it on the next sweep'] }; }
	if (r.route) return { route: r.route, warnings: [] };
	if (r.reason === 'venue_mainnet_only') return { route: null, warnings: ['the aggregator routes mainnet only'] };
	return { route: null, warnings: ['no venue prices this token right now; the order rests and holds until one does'] };
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
	const norm = normalizeOrderRequest({ ...body, network });
	if (!norm.ok) return json(res, 200, { data: { ok: false, error: norm.error, message: norm.message } });
	return json(res, 200, { data: { ok: true, ...(await buildRequestPreview({ meta: owned.meta, norm })) } });
}

/**
 * Preview any normalizeOrderRequest result. A single order returns
 * buildOrderPreview's shape; a ladder or OCO returns one preview per leg off a
 * single live quote, plus the group readback. Read-only.
 */
export async function buildRequestPreview({ meta, norm }) {
	if (norm.kind === 'single') return { kind: 'single', ...(await buildOrderPreview({ meta, order: norm.orders[0] })) };
	const first = norm.orders[0];
	const live = await liveContext(first, norm.orders);
	const legs = norm.orders.map((o, i) => ({ leg: i + 1, ...previewFrom(o, live) }));
	const buyLeg = norm.orders.filter((o) => o.side === 'buy' && o.size_sol).sort((a, b) => b.size_sol - a.size_sol)[0];
	const firewall = buyLeg ? await firewallVerdict(meta, buyLeg) : null;
	const readback = norm.kind === 'oco'
		? `One-cancels-other: ${legs.map((l) => l.readback).join(' OR ')} Whichever fills first cancels the other.`
		: `Ladder of ${legs.length} levels: ${legs.map((l) => l.readback).join(' ')}`;
	return { kind: norm.kind, legs, readback, venue: live.venue, firewall, spend_limits: previewLimits(meta) };
}

/**
 * The live preview of a normalized order: current metric value, whether the
 * trigger would fire right now, the firewall verdict for a buy, and the spend
 * limits it will run under. Read-only. Shared by the HTTP preview route and the
 * MCP order tools, so both show the owner the same thing.
 */
export async function buildOrderPreview({ meta, order: o }) {
	const live = await liveContext(o, [o]);
	const firewall = o.side === 'buy' && o.size_sol ? await firewallVerdict(meta, o) : null;
	return { ...previewFrom(o, live), venue: live.venue, firewall, spend_limits: previewLimits(meta) };
}

// One live read for a set of orders on one mint: the route the order would fill
// through and the signals every leg's trigger needs.
async function liveContext(o, orders) {
	const need = new Set();
	for (const leg of orders) {
		if (leg.type === 'conditional') for (const k of conditionSignals(leg.condition)) need.add(k);
		if (leg.type === 'trailing' || leg.type === 'conditional') need.add('mcap_usd');
		if (leg.price_band?.metric === 'mcap_usd') need.add('mcap_usd');
	}
	const venue = { requested: o.venue || 'auto', route: null, source: null };
	try {
		const want = o.venue === 'launchpad' || o.venue === 'aggregator' ? o.venue : null;
		if (o.venue === 'aggregator' && o.network !== 'mainnet') return { venue: { ...venue, reason: 'the aggregator routes mainnet only' }, market: null, signals: null };
		const { market, signals } = await getSignals({ network: o.network, mint: o.mint, need: [...need], metric: o.trigger_metric, route: want });
		if (market) { venue.route = market.route; venue.source = market.source; }
		else venue.reason = 'no venue prices this token right now; the order would rest until one does';
		return { venue, market, signals };
	} catch {
		return { venue: { ...venue, reason: 'the live quote failed; try the preview again' }, market: null, signals: null };
	}
}

// The per-order half of a preview: current metric, would-fire-now, band
// status, and when the order would act.
function previewFrom(o, { market, signals }) {
	const preview = { current: null, would_fire_now: null, missing: [], in_band: null };
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
		} else if (o.type === 'dca' || o.type === 'twap') {
			preview.would_fire_now = true;
		}
		if (o.price_band) {
			const v = metricValue(market, signals, o.price_band.metric);
			preview.in_band = v == null ? null : (o.price_band.min == null || v >= o.price_band.min) && (o.price_band.max == null || v <= o.price_band.max);
			if (preview.in_band === false) preview.would_fire_now = false;
		}
	}
	return { order: o, readback: describeOrder(o), preview, when: whenItActs(o) };
}

// When an order would act, before it exists: the schedule for a DCA/TWAP (first
// slice on the next sweep, then every interval) and the trigger in words for
// everything else.
function whenItActs(o) {
	const scheduled = o.type === 'dca' || o.type === 'twap';
	const now = Date.now();
	const nf = nextFire({ ...o, status: 'active', next_fire_at: scheduled ? new Date(now).toISOString() : null });
	if (!scheduled) return { label: nf.label, expires_at: o.expires_at };
	const slices = Number(o.schedule?.slices) || 1;
	const every = Number(o.schedule?.interval_seconds) || 0;
	return {
		label: slices > 1 ? `First slice on the next sweep, then one every ${humanInterval(every)} (${slices} total)` : 'One slice on the next sweep',
		first_at: new Date(now).toISOString(),
		last_at: new Date(now + (slices - 1) * every * 1000).toISOString(),
		slices,
		interval_seconds: every,
		expires_at: o.expires_at,
	};
}

// Firewall verdict for a buy (real on-chain simulated round-trip + authority audit).
async function firewallVerdict(meta, o) {
	if (!meta.solana_address) return null;
	try {
		const ctx = await getPumpTradeClient({ network: o.network });
		const lamports = BigInt(Math.round(Number(o.size_sol) * 1e9));
		const a = await assessTradeSafety({
			network: o.network, mint: o.mint, side: 'buy', payer: new PublicKey(meta.solana_address),
			quoteAmount: lamports, connection: ctx.connection,
		});
		return a ? { verdict: a.verdict, score: a.score, simulated: a.simulated, reasons: a.reasons?.slice(0, 4) || [] } : null;
	} catch { return null; }
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
		const existing = await getOrder(id, orderId);
		if (existing?.network === 'evm') return evmDcaUpdate(res, owned, existing, body);
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
		const existing = await getOrder(id, orderId);
		if (existing?.network === 'evm') {
			const cancelled = existing.status === 'cancelled' ? existing : await cancelEvmDca(orderId);
			return json(res, 200, { data: { order: presentDca(cancelled || existing) } });
		}
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
			const hash = JSON.stringify(orders.map((o) => [o.id, o.status, o.fill_count, o.last_price, o.last_error, o.last_skip_code, o.route]));
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
