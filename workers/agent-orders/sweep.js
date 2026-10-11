// agent-orders — one evaluation sweep over all active orders.
//
// For each order: re-quote its mint off live on-chain state, evaluate the
// trigger/schedule, and on fire execute through one of the two audited trade
// paths. A launchpad coin (pump bonding curve, then the PumpSwap AMM) fills
// through executeAgentTrade; any other SPL token fills through runAgentTrade
// with the aggregator executor from the venue layer. Both run the SAME quote →
// firewall → spend-guard → custody-claim → sign → confirm pipeline the
// owner-driven trade endpoints use. The orders worker adds NO new way to move
// funds: it only decides WHEN to call those paths. Every fill is firewall-gated,
// capped by the agent's spend policy + daily budget, carries the custody
// idempotency key order:<id>:slice:<n>, and is written to agent_custody_events
// (with an order_fills receipt linking back).
//
// Every evaluation that does not fill leaves a reason on the order (the order
// book's last_skip_*), from one closed vocabulary in api/_lib/order-book.js.

import { executeAgentTrade, parseTradeInput } from '../../api/agents/agent-trade.js';
import { runAgentTrade, parseTradeRequest } from '../../api/agents/solana-trade.js';
import { solanaExecutorFor } from '../../api/_lib/trading-tools/venues.js';
import { getTradeLimits } from '../../api/_lib/agent-trade-guards.js';
import { insertNotification } from '../../api/_lib/notify.js';
import {
	shouldFirePrice, evaluateCondition, conditionSignals, describeOrder,
} from '../../api/_lib/orders.js';
import { skipCodeFor, isVenueFailure, skipLabel } from '../../api/_lib/order-book.js';
import { getSignals, metricValue, getHolding } from './market.js';
import {
	getActiveOrders, expireOrders, recoverStaleFiring,
	claimFire, releaseFire, markEvaluated, seedReference,
	recordFillAndAdvance, loadAgent,
	setRoute, noteSkip, clearSkip, recordOrderEvent, consumeSkippedSlice,
	getGroupOrders, cancelGroupSiblings,
} from './store.js';
import { log } from './log.js';

// ── per-agent serialization ───────────────────────────────────────────────────
// One agent wallet, one budget: serialize an agent's fills inside a sweep so two
// orders can't both pass the daily-budget check on the same stale total. Across
// processes the custody idempotency_key is the real backstop.
const _locks = new Map();
async function withAgentLock(agentId, fn) {
	const prev = _locks.get(agentId) || Promise.resolve();
	let release;
	const next = new Promise((r) => (release = r));
	_locks.set(agentId, prev.then(() => next));
	await prev;
	try { return await fn(); }
	finally { release(); if (_locks.get(agentId) === next) _locks.delete(agentId); }
}

function errCode(err) {
	return err?.code || err?.name || 'error';
}

// Blocks that won't clear by retrying — stop the order (status 'error') instead
// of re-quoting it every sweep forever.
const TERMINAL_CODES = new Set(['firewall_blocked', 'graduated', 'zero_out', 'invalid_mint', 'quote_not_sol']);

// A launchpad-path refusal that only means "this token does not trade on the
// launchpad". An order left on venue 'auto' moves to the aggregator instead of
// halting, which is what lets a graduated or non-launchpad token keep its order.
const REROUTABLE_CODES = new Set(['no_market', 'pool_not_found', 'quote_not_sol', 'graduated']);

// Skip reasons worth interrupting the owner for: each needs them to act.
const NOTIFY_SKIPS = new Set(['cap_hit', 'insufficient_funds', 'kill_switch', 'price_impact']);

// ── per-route venue breaker ───────────────────────────────────────────────────
// Three consecutive venue failures on a route open its breaker for two minutes:
// every order on that route backs off (hold_until) instead of hammering a venue
// or RPC that is down. One success closes it.
const BREAKER_THRESHOLD = 3;
const BREAKER_OPEN_MS = 120_000;
const _venueHealth = new Map();

function breakerOpenUntil(route, now) {
	const h = _venueHealth.get(route);
	return h && h.openUntil > now ? h.openUntil : null;
}

function noteVenueResult(route, ok, now = Date.now()) {
	if (ok) { _venueHealth.delete(route); return; }
	const h = _venueHealth.get(route) || { fails: 0, openUntil: 0 };
	h.fails += 1;
	if (h.fails >= BREAKER_THRESHOLD) { h.openUntil = now + BREAKER_OPEN_MS; h.fails = 0; }
	_venueHealth.set(route, h);
}

/** Test seam: forget every route's failure history. */
export function resetVenueHealth() {
	_venueHealth.clear();
}

// The route an order asked for or already resolved to; null means "resolve it".
function wantRoute(order) {
	if (order.route === 'launchpad' || order.route === 'aggregator') return order.route;
	if (order.venue === 'launchpad' || order.venue === 'aggregator') return order.venue;
	return null;
}

// Pin the route the first live quote resolved, so later sweeps price and fill
// on the same venue the order was created against.
async function adoptRoute(order, market) {
	const route = market?.route || wantRoute(order) || 'launchpad';
	if (market && order.route !== route) {
		await setRoute(order.id, route);
		order.route = route;
	}
	return route;
}

function inBand(band, value) {
	if (!band) return true;
	if (band.min != null && value < Number(band.min)) return false;
	if (band.max != null && value > Number(band.max)) return false;
	return true;
}

/**
 * Decide whether (and how) an order fires this sweep. Returns a fire descriptor
 * or null to hold. Persists the per-sweep observation (last metric + trailing
 * high/low-water mark) and the skip reason as side effects; that part runs every
 * sweep, fired or not.
 */
async function evaluate(order, now) {
	// ── scheduled (DCA / TWAP) ────────────────────────────────────────────────
	if (order.type === 'dca' || order.type === 'twap') {
		if (!order.next_fire_at || new Date(order.next_fire_at).getTime() > now) return null;
		const slices = Number(order.schedule?.slices ?? 1);
		const sliceIndex = Number(order.schedule?.filled_slices ?? 0) + Number(order.schedule?.skipped_slices ?? 0);
		if (sliceIndex >= slices) return null;
		const terminal = sliceIndex + 1 >= slices;
		const intervalMs = Number(order.schedule?.interval_seconds ?? 0) * 1000;
		const nextFireAt = terminal ? null : new Date(now + intervalMs).toISOString();
		const band = order.price_band || null;
		const bandMetric = band?.metric || order.trigger_metric;
		// The price is a receipt for an unbanded slice (it never blocks one), and
		// the gate for a banded one.
		let triggerPrice = null;
		let bandValue = null;
		let market = null;
		try {
			const sig = await getSignals({ network: order.network, mint: order.mint, metric: bandMetric, route: wantRoute(order) });
			market = sig.market;
			triggerPrice = metricValue(sig.market, sig.signals, order.trigger_metric);
			bandValue = metricValue(sig.market, sig.signals, bandMetric);
		} catch { /* receipt-only unless banded */ }
		const route = await adoptRoute(order, market);
		if (band) {
			if (bandValue == null) { await noteSkip(order, 'no_quote', 'no live price to check the band against; retrying'); return null; }
			if (!inBand(band, bandValue)) {
				const status = await consumeSkippedSlice(order, { terminal, nextFireAt });
				await noteSkip(order, 'price_outside_band', `slice ${sliceIndex + 1}/${slices}: ${bandMetric} ${bandValue} outside ${band.min ?? '-'}..${band.max ?? '-'}`);
				if (status === 'expired') await announce(order, 'expire', { code: 'band_never_reached', message: 'every slice priced outside its band, so nothing was bought' });
				return null;
			}
		}
		return { reason: `${order.type}_slice`, triggerPrice, sliceIndex, terminal, nextFireAt, route };
	}

	// ── price-driven + conditional ────────────────────────────────────────────
	const need = order.type === 'conditional' ? conditionSignals(order.condition) : [];
	const { market, signals } = await getSignals({
		network: order.network, mint: order.mint, need,
		referencePrice: order.reference_price, metric: order.trigger_metric, route: wantRoute(order),
	});
	if (!market) {
		await markEvaluated(order.id, {});
		await noteSkip(order, 'no_quote', 'no venue priced this token this sweep');
		return null; // honest: no live price → hold
	}
	const route = await adoptRoute(order, market);

	const metricVal = metricValue(market, signals, order.trigger_metric);
	if (order.reference_price == null && metricVal != null) await seedReference(order.id, metricVal);

	// Track the trailing high/low-water mark every sweep, fired or not.
	let peak = order.peak_price;
	if (order.type === 'trailing' && metricVal != null) {
		const base = order.peak_price ?? metricVal;
		peak = order.side === 'sell' ? Math.max(base, metricVal) : Math.min(base, metricVal);
	}
	await markEvaluated(order.id, { lastPrice: metricVal, peak });

	let fire = null;
	if (order.type === 'conditional') {
		const { fired } = evaluateCondition(order.condition, signals);
		if (fired) fire = { reason: 'condition', triggerPrice: metricVal, sliceIndex: 0, terminal: true, nextFireAt: null, route };
	} else if (shouldFirePrice(order, metricVal, peak)) {
		const reason = order.type === 'trailing'
			? (order.side === 'sell' ? 'trailing_stop' : 'trailing_entry')
			: order.type;
		fire = { reason, triggerPrice: metricVal, sliceIndex: 0, terminal: true, nextFireAt: null, route };
	}
	// A live quote that did not trigger is just waiting, not skipping: drop any
	// stale reason so the book does not keep blaming an outage that has passed.
	if (!fire) await clearSkip(order);
	return fire;
}

/**
 * The share of the CURRENT holding a percentage sell disposes on this slice.
 *
 * A DCA sell's sell_pct is deliberately a percentage of the live bag every time:
 * "DCA out 10% an hour" means 10% of whatever is left. A TWAP sell is the
 * opposite. The API divides the owner's TOTAL percentage across the slices
 * (api/_lib/orders.js), so sell_pct is a share of the bag AS IT WAS when the
 * order was created, and every earlier slice already shrank that bag. Applying
 * it to the live holding each time compounds downward: "sell 100% over 4 slices"
 * would dispose 25 / 18.75 / 14.06 / 10.55%, leave ~31.6% of the bag behind, and
 * still mark the order filled. Re-base onto what is left of the promised total,
 * which lands the final slice on the whole remainder.
 */
function sellFractionPct(order, sliceIndex) {
	const pct = Number(order.sell_pct);
	const i = Number(sliceIndex) || 0;
	const slices = Number(order.schedule?.slices ?? 1);
	if (order.type !== 'twap' || i <= 0 || !(slices > 0)) return pct;
	// Derive from the owner's total rather than the rounded per-slice figure, so
	// the last slice lands on exactly 100 instead of leaving rounding dust behind.
	const perSlice = Number(order.schedule?.total_pct ?? pct * slices) / slices;
	const bagLeft = 100 - perSlice * i; // percent of the original bag still held
	if (!(bagLeft > 0)) return 0;
	return (perSlice / bagLeft) * 100;
}

/**
 * A ladder leg's sell_pct is a share of the bag as it was when the ladder was
 * placed (25% at 2x, 25% at 3x, 50% at 5x). Each filled sibling already sold its
 * share, so re-base onto what is left; the last leg of a ladder that adds up to
 * 100 closes the position outright instead of leaving rounding dust.
 */
async function ladderSellPct(order) {
	const pct = Number(order.sell_pct);
	const legs = await getGroupOrders(order.group_id);
	const sold = legs.filter((l) => l.id !== order.id && l.status === 'filled')
		.reduce((a, l) => a + Number(l.sell_pct || 0), 0);
	const bagLeft = 100 - sold;
	if (!(bagLeft > 0)) return 0;
	const total = legs.filter((l) => l.status !== 'cancelled').reduce((a, l) => a + Number(l.sell_pct || 0), 0);
	const lastOpen = legs.every((l) => l.id === order.id || l.status === 'filled' || l.status === 'cancelled');
	if (lastOpen && total >= 99.999) return 100;
	return Math.min(100, (pct / bagLeft) * 100);
}

async function effectiveSellPct(order, sliceIndex) {
	if (order.group_kind === 'ladder' && order.group_id) return ladderSellPct(order);
	return sellFractionPct(order, sliceIndex);
}

/** Build the executeAgentTrade `body` for a launchpad fire, or null if it can't be sized. */
async function buildBody(order, agent, sliceIndex = 0) {
	const base = { mint: order.mint, slippageBps: order.slippage_bps, network: order.network, side: order.side };
	if (order.side === 'buy') {
		if (!(Number(order.size_sol) > 0)) return null;
		return { ...base, amount: Number(order.size_sol) };
	}
	// sell
	if (order.sell_pct != null) {
		const pct = await effectiveSellPct(order, sliceIndex);
		if (!(pct > 0)) return null;
		if (pct >= 100) return { ...base, amount: 'max' };
		const holding = await getHolding({ network: order.network, mint: order.mint, owner: agent.meta.solana_address });
		if (!holding || holding.whole <= 0) return null;
		const amt = holding.whole * (pct / 100);
		return amt > 0 ? { ...base, amount: amt } : null;
	}
	if (Number(order.size_tokens) > 0) {
		// size_tokens is stored in RAW base units (see the orders migration and
		// docs/agent-wallet-api.md) while the trade path takes WHOLE tokens, so it
		// has to be scaled by the mint's own decimals. Passing the raw figure
		// through would ask for 10^decimals times the intended size and bounce off
		// insufficient_token_balance, a clearable code, on every sweep forever.
		const holding = await getHolding({ network: order.network, mint: order.mint, owner: agent.meta.solana_address });
		if (!holding) return null; // no decimals to scale by: hold, never guess
		const whole = Number(order.size_tokens) / 10 ** holding.decimals;
		return whole > 0 ? { ...base, amount: whole } : null;
	}
	return null;
}

/**
 * Build the runAgentTrade request body for an aggregator fire, or null if it
 * can't be sized. The aggregator path takes a sell in raw base units, so a
 * percentage is applied to the raw on-chain balance with integer math.
 */
async function buildAggregatorBody(order, agent, fire) {
	const base = {
		side: order.side, mint: order.mint, network: order.network, slippage_bps: order.slippage_bps,
		idempotency_key: idempotencyKey(order, fire),
	};
	if (order.side === 'buy') {
		if (!(Number(order.size_sol) > 0)) return null;
		return { ...base, sol_amount: Number(order.size_sol) };
	}
	if (order.sell_pct != null) {
		const pct = await effectiveSellPct(order, fire.sliceIndex);
		if (!(pct > 0)) return null;
		const holding = await getHolding({ network: order.network, mint: order.mint, owner: agent.meta.solana_address });
		if (!holding || holding.raw <= 0n) return null;
		const raw = pct >= 100 ? holding.raw : (holding.raw * BigInt(Math.round(pct * 10_000))) / 1_000_000n;
		return raw > 0n ? { ...base, token_amount_raw: raw.toString() } : null;
	}
	if (Number(order.size_tokens) > 0) {
		return { ...base, token_amount_raw: BigInt(Math.floor(Number(order.size_tokens))).toString() };
	}
	return null;
}

function idempotencyKey(order, fire) {
	return `order:${order.id}:slice:${fire.sliceIndex ?? 0}`;
}

/**
 * Fill through the aggregator route: runAgentTrade with the venue layer's
 * aggregator executor, the same guard chain and custody ledger as the trade
 * endpoint, simulated on the RPC (never signed) outside live mode. The result
 * is mapped onto executeAgentTrade's shape so settle() treats both routes alike.
 */
async function executeAggregator(order, agent, fire, cfg, body) {
	const parsed = parseTradeRequest(body);
	if (!parsed.ok) return { ok: false, status: parsed.status, code: 'invalid_order', message: parsed.message };
	const out = await runAgentTrade({
		agentId: order.agent_id, userId: agent.userId, meta: agent.meta,
		address: agent.meta.solana_address, encryptedSecret: agent.meta.encrypted_solana_secret,
		parsed, executor: solanaExecutorFor('auto'), simulate: cfg.mode !== 'live',
	});
	if (out.error) return { ok: false, status: out.status, code: out.error.code, message: out.error.message, detail: out.error.detail };
	const d = out.data || {};
	if (d.simulated && d.err) {
		// The trade would revert on chain right now: a paper fill that would not
		// have happened is not a fill.
		return { ok: false, status: 422, code: 'simulation_failed', message: `the swap simulation reverted: ${JSON.stringify(d.err).slice(0, 160)}` };
	}
	const buy = order.side === 'buy';
	return {
		ok: true, status: out.status,
		data: {
			simulated: d.simulated === true,
			venue: d.venue || 'aggregator',
			price_impact_pct: d.price_impact_pct ?? null,
			signature: d.signature || null,
			custody_event_id: d.custody_event_id ?? null,
			sol_spent: buy ? Number(d.in?.amount ?? 0) : null,
			tokens_received: buy ? d.out?.atomics ?? null : null,
			tokens_sold: buy ? null : d.in?.atomics ?? null,
			sol_received: buy ? null : Number(d.out?.amount ?? 0),
		},
	};
}

// Tell the owner, and leave the matching history row. Never blocks a fill.
async function announce(order, kind, { code = null, message, link = null, meta = null } = {}) {
	await recordOrderEvent(order, kind, { code, detail: message, meta });
	if (!order.user_id) return;
	const sym = order.symbol ? `$${order.symbol}` : `${String(order.mint).slice(0, 4)}…`;
	const title = {
		fire: `Order filled: ${sym}`,
		fail: `Order stopped: ${sym}`,
		expire: `Order expired: ${sym}`,
		skip: `Order waiting: ${sym}`,
	}[kind] || `Order update: ${sym}`;
	insertNotification(order.user_id, 'order_update', {
		title, message, kind, code,
		agent_id: order.agent_id, order_id: order.id, order_type: order.type, mint: order.mint,
		link: link || `/agents/${order.agent_id}/wallet#orders`,
	});
}

/** Map an executor result onto an order_fills record + advance the order. */
async function settle(order, fire, result, mode) {
	const priorPartial = order.fill_count > 0;
	if (!result.ok) {
		const code = result.code || 'error';
		const route = fire.route || 'launchpad';
		if (route === 'launchpad' && REROUTABLE_CODES.has(code) && order.venue !== 'launchpad' && order.network === 'mainnet') {
			// Not a launchpad market (or it just left one): route every later fill
			// through the aggregator, and retry on the next sweep.
			await setRoute(order.id, 'aggregator');
			await releaseFire(order.id, priorPartial ? 'partial' : 'active', `${code}: rerouted to the aggregator`);
			await noteSkip(order, 'venue_unhealthy', `${code} on the launchpad; rerouted to the aggregator`);
			log.info('order rerouted', { order: order.id, code });
			return;
		}
		if (TERMINAL_CODES.has(code)) {
			// Record the failed attempt AND halt the order to 'error' atomically — a
			// rug verdict / graduated-buy / zero-out won't clear by retrying.
			await recordFillAndAdvance({
				order, terminal: false, terminalError: true,
				fill: { sliceIndex: fire.sliceIndex, triggerReason: fire.reason, triggerPrice: fire.triggerPrice, status: 'failed', detail: `${code}: ${result.message || ''}`.slice(0, 280) },
			});
			await announce(order, 'fail', { code, message: `${describeOrder(order)} It was stopped: ${result.message || code}.` });
			log.warn('order halted', { order: order.id, type: order.type, code });
			return;
		}
		// Transient/clearable block (budget, kill switch, frozen, rpc) — hold + retry.
		await releaseFire(order.id, priorPartial ? 'partial' : 'active', `${code}: ${result.message || ''}`.slice(0, 280));
		const skip = skipCodeFor(code);
		const changed = order.last_skip_code !== skip;
		if (isVenueFailure(code)) noteVenueResult(route, false);
		await noteSkip(order, skip, `${code}: ${result.message || ''}`);
		if (changed && NOTIFY_SKIPS.has(skip)) {
			await announce(order, 'skip', { code: skip, message: `${skipLabel(skip)}. ${result.message || ''}`.trim() });
		}
		log.info('order fire blocked (will retry)', { order: order.id, code });
		return;
	}

	noteVenueResult(fire.route || 'launchpad', true);
	const d = result.data || {};
	const simulated = d.simulated === true || mode !== 'live';
	const status = simulated ? 'simulated' : (d.signature ? 'confirmed' : 'unconfirmed');
	const solAmount = order.side === 'buy' ? (d.sol_spent ?? null) : (d.sol_received ?? null);
	const tokenAmount = order.side === 'buy' ? (d.tokens_received ?? d.expected_out_raw ?? null) : (d.tokens_sold ?? null);

	await recordFillAndAdvance({
		order, terminal: fire.terminal, nextFireAt: fire.nextFireAt,
		fill: {
			sliceIndex: fire.sliceIndex, triggerReason: fire.reason, triggerPrice: fire.triggerPrice,
			solAmount: simulated ? 0 : solAmount, tokenAmount: simulated ? 0 : tokenAmount,
			priceImpactPct: d.price_impact_pct ?? null, venue: d.venue || null,
			signature: d.signature && d.signature !== 'SIMULATED' ? d.signature : null,
			custodyEventId: d.custody_event_id ?? null,
			status, detail: simulated ? 'paper fill (simulate mode)' : null,
			meta: { mode, slice: fire.sliceIndex, route: fire.route || 'launchpad' },
		},
	});

	// One leg of an OCO pair filled: the other must never fire on the same bag.
	let cancelled = [];
	if (order.group_kind === 'oco' && order.group_id) cancelled = await cancelGroupSiblings(order, 'oco_sibling_filled');

	const sig = d.signature && d.signature !== 'SIMULATED' ? d.signature : null;
	const slices = order.schedule?.slices;
	const sliceNote = slices ? ` Slice ${fire.sliceIndex + 1} of ${slices}.` : '';
	const ocoNote = cancelled.length ? ' The other leg of the pair was cancelled.' : '';
	await announce(order, 'fire', {
		code: status,
		message: `${simulated ? 'Paper fill (simulation, nothing was sent): ' : ''}${describeOrder(order)}${sliceNote}${ocoNote}`,
		link: sig ? `https://solscan.io/tx/${sig}${order.network === 'devnet' ? '?cluster=devnet' : ''}` : null,
		meta: { status, slice: fire.sliceIndex, route: fire.route || 'launchpad', signature: sig },
	});

	log.trade('fill', {
		order: order.id, type: order.type, side: order.side, mode, status,
		reason: fire.reason, slice: fire.sliceIndex, terminal: fire.terminal,
		route: fire.route || 'launchpad', sig: d.signature || null, impact: d.price_impact_pct ?? null,
	});
}

/** Fire one order (claim → size → execute → settle). Per-agent serialized. */
async function fireOne(order, agent, fire, cfg) {
	if (!(await claimFire(order.id))) return; // another sweep owns it
	const idle = order.fill_count > 0 ? 'partial' : 'active';
	try {
		let result;
		if (fire.route === 'aggregator') {
			const body = await buildAggregatorBody(order, agent, fire);
			if (!body) { await releaseFire(order.id, idle, 'no_balance_or_size'); await noteSkip(order, 'no_balance', 'nothing to sell, or the order could not be sized'); return; }
			result = await executeAggregator(order, agent, fire, cfg, body);
		} else {
			const body = await buildBody(order, agent, fire.sliceIndex);
			if (!body) { await releaseFire(order.id, idle, 'no_balance_or_size'); await noteSkip(order, 'no_balance', 'nothing to sell, or the order could not be sized'); return; }

			const tradeLimits = getTradeLimits(agent.meta);
			let input;
			try { input = parseTradeInput(body, tradeLimits); }
			catch (e) { await releaseFire(order.id, 'error', `invalid_order: ${e?.message || e?.code || ''}`.slice(0, 280)); return; }

			input.idempotencyKey = idempotencyKey(order, fire);
			if (cfg.mode !== 'live') input.simulate = true;

			result = await executeAgentTrade({
				id: order.agent_id, userId: agent.userId, meta: agent.meta, input,
				source: `order:${order.type}`, sourceMeta: { order_id: order.id, slice: fire.sliceIndex },
			});
		}
		await settle(order, fire, result, cfg.mode);
	} catch (err) {
		await releaseFire(order.id, idle, errCode(err)).catch(() => {});
		log.error('order fire crashed', { order: order.id, err: err?.message });
	}
}

/**
 * Run one full sweep. Self-healing first (expire deadlines, recover stale firing
 * claims), then evaluate every active order, firing those whose trigger/schedule
 * is met. Orders are grouped by agent and agents processed with bounded
 * concurrency; an agent's own orders run serially under a per-agent lock.
 */
export async function runOrderSweep(cfg) {
	const now = Date.now();
	try {
		const expired = await expireOrders(cfg.network);
		const recovered = await recoverStaleFiring(cfg.network, cfg.staleFiringMs);
		for (const o of expired) {
			await announce(o, 'expire', { code: 'expired', message: `${o.fill_count > 0 ? `Expired after ${o.fill_count} fill${o.fill_count === 1 ? '' : 's'}` : 'Expired without filling'}: the ${o.type} ${o.side} order reached its deadline.` });
		}
		if (expired.length || recovered) log.info('housekeeping', { expired: expired.length, recovered });
	} catch (err) {
		log.warn('housekeeping failed', { err: err?.message });
	}

	let orders;
	try { orders = await getActiveOrders(cfg.network); }
	catch (err) { log.error('active-order query failed', { err: err?.message }); return; }
	if (!orders.length) return;

	// Group by agent so each agent's wallet is touched serially.
	const byAgent = new Map();
	for (const o of orders) {
		if (!byAgent.has(o.agent_id)) byAgent.set(o.agent_id, []);
		byAgent.get(o.agent_id).push(o);
	}

	const agentIds = [...byAgent.keys()];
	const agentCache = new Map();
	let cursor = 0;
	const worker = async () => {
		while (cursor < agentIds.length) {
			const agentId = agentIds[cursor++];
			await withAgentLock(agentId, async () => {
				let agent = agentCache.get(agentId);
				if (!agent) { agent = await loadAgent(agentId); agentCache.set(agentId, agent); }
				if (!agent || !agent.meta?.encrypted_solana_secret) {
					// No provisioned wallet — can't trade; leave orders untouched (the
					// owner sees them sit until the wallet exists). Don't spam errors.
					return;
				}
				for (const order of byAgent.get(agentId)) {
					try {
						// Backing off an unhealthy venue: leave it alone until the hold lapses.
						if (order.hold_until && new Date(order.hold_until).getTime() > now) continue;
						const fire = await evaluate(order, now);
						if (!fire) continue;
						const openUntil = breakerOpenUntil(fire.route || 'launchpad', now);
						if (openUntil) {
							await noteSkip(order, 'venue_unhealthy', `the ${fire.route || 'launchpad'} route failed ${BREAKER_THRESHOLD} times in a row; backing off`, { holdUntil: new Date(openUntil).toISOString() });
							continue;
						}
						await fireOne(order, agent, fire, cfg);
					} catch (err) {
						log.error('order eval failed', { order: order.id, err: err?.message });
					}
				}
			});
		}
	};
	const pool = Math.max(1, Math.min(cfg.concurrency, agentIds.length));
	await Promise.all(Array.from({ length: pool }, worker));
}
