// Paper perps: the agent trades against the venue's live order book and marks,
// but positions, collateral, fills and funding live in this platform's own
// ledger (perps_paper_* tables) and no transaction is ever built or signed.
//
// Paper mode exists so an owner can run the whole flow (deposit, preview,
// execute, take-profit, stop-loss, flatten) on a fresh agent before turning
// live mode on, and so tests never open a real position.
//
// Fidelity rules, so a paper result means something:
//   - market orders fill at the price the venue's own quote walks off the live
//     book (the same quoteOrder the live path uses), taker fee included
//   - resting limit orders fill at their limit once the live book crosses them
//   - take-profit and stop-loss triggers fire on the live mark price; a stop
//     fills at its execution price (trigger plus the stop slippage)
//   - funding accrues continuously at the market's live hourly rate: a long
//     pays a positive rate, a short receives it
//   - an account whose equity falls under maintenance margin is liquidated at
//     the mark, exactly where the venue would close it
//
// Concurrency: every mutation commits under an optimistic version on the
// paper account row, with each statement in the batch guarded by a one-time
// op token, so two concurrent fills can never interleave. A losing writer
// re-reads and recomputes.

import { randomUUID } from 'node:crypto';
import { sql } from '../db.js';
import { perpsError } from './errors.js';

export const PAPER_MAX_COLLATERAL_USD = 1_000_000;
const EPS = 1e-12;

const round = (n, dp = 6) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** dp) / 10 ** dp);
const num = (v) => (v == null ? null : Number(v));

// ── pure math ────────────────────────────────────────────────────────────────

/**
 * Liquidation price for one position in a cross-margin account, holding every
 * other position's PnL and maintenance margin constant. The closed form the
 * venue SDK uses: equity(p) = maintenance(p) solved for p.
 *
 * @returns {number|null} null when the position cannot be liquidated by price alone
 */
export function paperLiquidationPrice({ signedSize, entry, collateralUsd, mmr, otherPnlUsd = 0, otherMaintenanceUsd = 0 }) {
	if (Math.abs(signedSize) < EPS || !(mmr > 0)) return null;
	const numerator = collateralUsd + otherPnlUsd - otherMaintenanceUsd - entry * signedSize;
	const denominator = Math.abs(signedSize) * mmr - signedSize;
	if (Math.abs(denominator) < EPS) return null;
	const price = numerator / denominator;
	return Number.isFinite(price) && price > 0 ? price : null;
}

/**
 * Funding a position owes for the time since `fromMs`, in USD. Positive means
 * the position pays. `hourlyPct` is the market's live hourly rate in percent.
 */
export function fundingOwed({ signedSize, mark, hourlyPct, fromMs, toMs }) {
	if (!signedSize || !mark || !Number.isFinite(hourlyPct) || !(toMs > fromMs)) return 0;
	const hours = (toMs - fromMs) / 3_600_000;
	return signedSize * mark * (hourlyPct / 100) * hours;
}

/** Has the live book crossed a resting limit? A buy fills when the ask comes down to it. */
export function limitCrossed(order, book) {
	if (order.side === 'long') return book.best_ask != null && book.best_ask <= order.price + EPS;
	return book.best_bid != null && book.best_bid >= order.price - EPS;
}

/** Has the mark reached a trigger? Direction comes from the position the trigger protects. */
export function triggerHit(order, mark) {
	if (mark == null) return false;
	return order.direction === 'greater_than' ? mark >= order.trigger_price - EPS : mark <= order.trigger_price + EPS;
}

/**
 * Pure: the venue-shaped account for a paper state at the given marks. Same
 * fields as a venue's getAccount, so quoteOrder, the guards, the tracker and
 * the page treat both modes identically.
 *
 * @param {object} state     loadPaperState output
 * @param {Map<string, object>} markets  symbol -> normalized market (mark, funding, margin rates)
 * @param {number} nowMs
 */
export function buildPaperAccount(state, markets, nowMs = Date.now()) {
	const rows = [...state.positions.values()].filter((p) => Math.abs(p.signed_size) > EPS);
	const legs = rows.map((p) => {
		const m = markets.get(p.symbol) || {};
		const mark = m.mark_price ?? p.entry_price;
		const size = Math.abs(p.signed_size);
		const notional = size * mark;
		const pending = fundingOwed({ signedSize: p.signed_size, mark, hourlyPct: m.funding_rate_hourly_pct, fromMs: p.funding_at, toMs: nowMs });
		return {
			p,
			m,
			mark,
			size,
			notional,
			upnl: p.signed_size * (mark - p.entry_price),
			im: notional * (m.initial_margin_rate ?? 1),
			mm: notional * (m.maintenance_margin_rate ?? 0.5),
			pending,
		};
	});
	const totalPnl = legs.reduce((s, l) => s + l.upnl, 0);
	const totalMm = legs.reduce((s, l) => s + l.mm, 0);
	const totalIm = legs.reduce((s, l) => s + l.im, 0);
	const totalPending = legs.reduce((s, l) => s + l.pending, 0);
	const collateral = state.collateral_usd - totalPending;
	const equity = collateral + totalPnl;
	const notional = legs.reduce((s, l) => s + l.notional, 0);

	const positions = legs
		.map((l) => {
			const liq = paperLiquidationPrice({
				signedSize: l.p.signed_size,
				entry: l.p.entry_price,
				collateralUsd: collateral,
				mmr: l.m.maintenance_margin_rate,
				otherPnlUsd: totalPnl - l.upnl,
				otherMaintenanceUsd: totalMm - l.mm,
			});
			const tp = state.orders.find((o) => o.symbol === l.p.symbol && o.type === 'take_profit' && o.status === 'open');
			const sl = state.orders.find((o) => o.symbol === l.p.symbol && o.type === 'stop_loss' && o.status === 'open');
			return {
				symbol: l.p.symbol,
				side: l.p.signed_size > 0 ? 'long' : 'short',
				size: round(l.size, 10),
				signed_size: l.p.signed_size,
				entry_price: round(l.p.entry_price, 8),
				mark_price: l.mark,
				notional_usd: round(l.notional, 2),
				unrealized_pnl_usd: round(l.upnl, 4),
				liquidation_price: liq ? round(liq, 6) : null,
				liquidation_distance_pct: liq && l.mark ? round((Math.abs(l.mark - liq) / l.mark) * 100, 2) : null,
				initial_margin_usd: round(l.im, 4),
				maintenance_margin_usd: round(l.mm, 4),
				funding_accrued_usd: round(l.p.funding_paid_usd + l.pending, 4),
				unsettled_funding_usd: round(l.pending, 4),
				take_profit_price: tp?.trigger_price ?? null,
				stop_loss_price: sl?.trigger_price ?? null,
				opened_at: l.p.opened_at,
			};
		})
		.sort((a, b) => b.notional_usd - a.notional_usd);

	const open = state.orders.filter((o) => o.status === 'open');
	return {
		registered: true,
		authority: null,
		trader_account: null,
		collateral_usd: round(collateral, 6),
		equity_usd: round(equity, 6),
		withdrawable_usd: round(Math.max(0, Math.min(collateral, equity - totalIm)), 6),
		unrealized_pnl_usd: round(totalPnl, 6),
		initial_margin_usd: round(totalIm, 6),
		maintenance_margin_usd: round(totalMm, 6),
		funding_owed_usd: round(totalPending, 6),
		notional_usd: round(notional, 2),
		account_leverage: equity > 0 ? round(notional / equity, 3) : 0,
		risk_state: legs.length === 0 ? (collateral > 0 ? 'healthy' : 'zeroCollateralNoPositions') : equity < totalMm ? 'liquidatable' : equity < totalIm ? 'cancellable' : 'healthy',
		risk_tier: null,
		positions,
		orders: open
			.filter((o) => o.type === 'limit')
			.map((o) => ({ id: String(o.id), symbol: o.symbol, side: o.side, price: o.price, price_ticks: null, size_remaining: o.size, reduce_only: o.reduce_only, type: 'limit', status: 'open' })),
		conditionals: open
			.filter((o) => o.type === 'take_profit' || o.type === 'stop_loss')
			.map((o) => ({ id: String(o.id), symbol: o.symbol, kind: o.type, trigger_price: o.trigger_price, execution_price: o.price, side: o.side, status: 'open', cancellable: true, direction: o.direction })),
		paper: {
			realized_pnl_usd: round(state.realized_pnl_usd, 6),
			fees_paid_usd: round(state.fees_paid_usd, 6),
			funding_paid_usd: round(state.funding_paid_usd + totalPending, 6),
			deposited_usd: round(state.deposited_usd, 6),
			withdrawn_usd: round(state.withdrawn_usd, 6),
		},
	};
}

/**
 * Pure: apply one fill to a paper state. Returns the new state and the fill
 * record. `delta` is signed base units (positive buys).
 */
export function applyFill(state, { symbol, delta, price, feeUsd, reason, orderId = null, previewId = null }) {
	const positions = new Map(state.positions);
	const prev = positions.get(symbol) || { symbol, signed_size: 0, entry_price: 0, funding_paid_usd: 0, funding_at: Date.now(), opened_at: new Date().toISOString() };
	const size = prev.signed_size;
	const next = size + delta;
	let entry;
	let realized = 0;
	if (size === 0 || Math.sign(size) === Math.sign(delta)) {
		const total = Math.abs(size) + Math.abs(delta);
		entry = total ? (Math.abs(size) * prev.entry_price + Math.abs(delta) * price) / total : 0;
	} else {
		const closing = Math.min(Math.abs(size), Math.abs(delta));
		realized = closing * (price - prev.entry_price) * Math.sign(size);
		entry = Math.abs(delta) <= Math.abs(size) + EPS ? prev.entry_price : price;
	}
	const flat = Math.abs(next) < EPS;
	const flipped = !flat && size !== 0 && Math.sign(next) !== Math.sign(size);
	positions.set(symbol, {
		...prev,
		signed_size: flat ? 0 : round(next, 10),
		entry_price: flat ? 0 : entry,
		opened_at: size === 0 || flipped ? new Date().toISOString() : prev.opened_at,
		funding_paid_usd: size === 0 || flipped ? 0 : prev.funding_paid_usd,
	});
	return {
		state: {
			...state,
			positions,
			collateral_usd: state.collateral_usd + realized - feeUsd,
			realized_pnl_usd: state.realized_pnl_usd + realized,
			fees_paid_usd: state.fees_paid_usd + feeUsd,
		},
		fill: {
			symbol,
			side: delta > 0 ? 'long' : 'short',
			size: round(Math.abs(delta), 10),
			price,
			fee_usd: round(feeUsd, 6),
			realized_pnl_usd: round(realized, 6),
			reason,
			order_id: orderId,
			preview_id: previewId,
		},
	};
}

/** Pure: settle accrued funding into collateral at the given marks. */
export function settleFunding(state, markets, nowMs) {
	const positions = new Map(state.positions);
	let paid = 0;
	for (const [symbol, p] of positions) {
		const m = markets.get(symbol);
		if (!m || Math.abs(p.signed_size) < EPS) {
			positions.set(symbol, { ...p, funding_at: nowMs });
			continue;
		}
		const owed = fundingOwed({ signedSize: p.signed_size, mark: m.mark_price, hourlyPct: m.funding_rate_hourly_pct, fromMs: p.funding_at, toMs: nowMs });
		paid += owed;
		positions.set(symbol, { ...p, funding_paid_usd: p.funding_paid_usd + owed, funding_at: nowMs });
	}
	return { ...state, positions, collateral_usd: state.collateral_usd - paid, funding_paid_usd: state.funding_paid_usd + paid };
}

// ── storage ──────────────────────────────────────────────────────────────────

function rowToPosition(r) {
	return {
		symbol: r.symbol,
		signed_size: Number(r.signed_size),
		entry_price: Number(r.entry_price),
		funding_paid_usd: Number(r.funding_paid_usd),
		funding_at: new Date(r.funding_at).getTime(),
		opened_at: new Date(r.opened_at).toISOString(),
	};
}

function rowToOrder(r) {
	return {
		id: Number(r.id),
		symbol: r.symbol,
		type: r.type,
		side: r.side,
		size: num(r.size),
		price: num(r.price),
		trigger_price: num(r.trigger_price),
		direction: r.direction,
		size_percent: num(r.size_percent),
		reduce_only: r.reduce_only === true,
		status: r.status,
		created_at: new Date(r.created_at).toISOString(),
	};
}

/** Load (creating on first touch) the paper state for one agent and venue. */
export async function loadPaperState(agentId, userId, venueId) {
	await sql`
		INSERT INTO perps_paper_accounts (agent_id, venue, user_id)
		VALUES (${agentId}, ${venueId}, ${userId})
		ON CONFLICT (agent_id, venue) DO NOTHING
	`;
	const [[acct], positions, orders] = await Promise.all([
		sql`SELECT * FROM perps_paper_accounts WHERE agent_id = ${agentId} AND venue = ${venueId}`,
		sql`SELECT * FROM perps_paper_positions WHERE agent_id = ${agentId} AND venue = ${venueId}`,
		sql`SELECT * FROM perps_paper_orders WHERE agent_id = ${agentId} AND venue = ${venueId} AND status = 'open' ORDER BY id`,
	]);
	return {
		agent_id: agentId,
		venue: venueId,
		version: Number(acct.version),
		collateral_usd: Number(acct.collateral_usd),
		realized_pnl_usd: Number(acct.realized_pnl_usd),
		fees_paid_usd: Number(acct.fees_paid_usd),
		funding_paid_usd: Number(acct.funding_paid_usd),
		deposited_usd: Number(acct.deposited_usd),
		withdrawn_usd: Number(acct.withdrawn_usd),
		positions: new Map(positions.map((r) => [r.symbol, rowToPosition(r)])),
		orders: orders.map(rowToOrder),
	};
}

/**
 * Commit a new paper state. `changes` lists what moved: fills to record, new
 * orders to insert, and order status changes. Returns false when another
 * writer won the version race (nothing was written).
 */
async function commitPaperState(prev, next, { fills = [], newOrders = [], orderUpdates = [] }) {
	const token = randomUUID();
	const a = prev.agent_id;
	const v = prev.venue;
	const guard = sql`EXISTS (SELECT 1 FROM perps_paper_accounts WHERE agent_id = ${a} AND venue = ${v} AND op_token = ${token})`;
	const stmts = [
		sql`
			UPDATE perps_paper_accounts SET
				version = version + 1, op_token = ${token},
				collateral_usd = ${next.collateral_usd}, realized_pnl_usd = ${next.realized_pnl_usd},
				fees_paid_usd = ${next.fees_paid_usd}, funding_paid_usd = ${next.funding_paid_usd},
				deposited_usd = ${next.deposited_usd}, withdrawn_usd = ${next.withdrawn_usd},
				updated_at = now()
			WHERE agent_id = ${a} AND venue = ${v} AND version = ${prev.version}
		`,
	];
	const symbols = new Set([...prev.positions.keys(), ...next.positions.keys()]);
	for (const symbol of symbols) {
		const before = prev.positions.get(symbol);
		const after = next.positions.get(symbol);
		const same = before && after && before.signed_size === after.signed_size && before.entry_price === after.entry_price
			&& before.funding_paid_usd === after.funding_paid_usd && before.funding_at === after.funding_at;
		if (same) continue;
		if (!after || Math.abs(after.signed_size) < EPS) {
			if (before) stmts.push(sql`DELETE FROM perps_paper_positions WHERE agent_id = ${a} AND venue = ${v} AND symbol = ${symbol} AND ${guard}`);
			continue;
		}
		stmts.push(sql`
			INSERT INTO perps_paper_positions (agent_id, venue, symbol, signed_size, entry_price, funding_paid_usd, funding_at, opened_at)
			SELECT ${a}, ${v}, ${symbol}, ${after.signed_size}, ${after.entry_price}, ${after.funding_paid_usd},
			       ${new Date(after.funding_at).toISOString()}, ${after.opened_at}
			WHERE ${guard}
			ON CONFLICT (agent_id, venue, symbol) DO UPDATE SET
				signed_size = excluded.signed_size, entry_price = excluded.entry_price,
				funding_paid_usd = excluded.funding_paid_usd, funding_at = excluded.funding_at,
				opened_at = excluded.opened_at, updated_at = now()
		`);
	}
	for (const u of orderUpdates) {
		stmts.push(sql`
			UPDATE perps_paper_orders SET status = ${u.status}, fill_price = ${u.fill_price ?? null}, closed_at = now()
			WHERE id = ${u.id} AND agent_id = ${a} AND status = 'open' AND ${guard}
		`);
	}
	for (const o of newOrders) {
		stmts.push(sql`
			INSERT INTO perps_paper_orders (agent_id, venue, symbol, type, side, size, price, trigger_price, direction, size_percent, reduce_only, preview_id)
			SELECT ${a}, ${v}, ${o.symbol}, ${o.type}, ${o.side}, ${o.size ?? null}, ${o.price ?? null}, ${o.trigger_price ?? null},
			       ${o.direction ?? null}, ${o.size_percent ?? null}, ${o.reduce_only === true}, ${o.preview_id ?? null}
			WHERE ${guard}
		`);
	}
	for (const f of fills) {
		stmts.push(sql`
			INSERT INTO perps_paper_fills (agent_id, venue, symbol, side, size, price, fee_usd, realized_pnl_usd, reason, order_id, preview_id)
			SELECT ${a}, ${v}, ${f.symbol}, ${f.side}, ${f.size}, ${f.price}, ${f.fee_usd}, ${f.realized_pnl_usd}, ${f.reason}, ${f.order_id}, ${f.preview_id}
			WHERE ${guard}
		`);
	}
	const results = await sql.transaction(stmts);
	const first = results[0];
	const updated = Array.isArray(first) ? first.length : (first?.count ?? first?.rowCount ?? 0);
	if (updated > 0) return true;
	// The UPDATE returns no rows without RETURNING; read the token back to know who won.
	const [row] = await sql`SELECT op_token FROM perps_paper_accounts WHERE agent_id = ${a} AND venue = ${v}`;
	return row?.op_token === token;
}

/**
 * Run `fn(state)` against fresh paper state and commit its result, retrying on
 * a lost version race. `fn` returns { state, fills?, newOrders?, orderUpdates?, result }.
 */
export async function mutatePaper(agentId, userId, venueId, fn) {
	for (let attempt = 0; attempt < 4; attempt += 1) {
		const prev = await loadPaperState(agentId, userId, venueId);
		const out = await fn(prev);
		if (!out || out.state === prev) return out?.result ?? null;
		const ok = await commitPaperState(prev, out.state, out);
		if (ok) return out.result ?? null;
	}
	throw perpsError(409, 'paper_busy', 'Another paper order on this agent landed at the same moment. Nothing was applied; try again.');
}

/** Recent paper fills, newest first. */
export async function listPaperFills(agentId, venueId, { limit = 50 } = {}) {
	const rows = await sql`
		SELECT id, symbol, side, size, price, fee_usd, realized_pnl_usd, reason, order_id, created_at
		FROM perps_paper_fills WHERE agent_id = ${agentId} AND venue = ${venueId}
		ORDER BY id DESC LIMIT ${Math.min(200, Math.max(1, limit))}
	`;
	return rows.map((r) => ({
		id: String(r.id),
		symbol: r.symbol,
		side: r.side,
		size: Number(r.size),
		price: Number(r.price),
		fee_usd: Number(r.fee_usd),
		realized_pnl_usd: Number(r.realized_pnl_usd),
		reason: r.reason,
		order_id: r.order_id != null ? String(r.order_id) : null,
		created_at: new Date(r.created_at).toISOString(),
	}));
}

/** Every agent holding a paper position or a resting paper order, for the alert sweep. */
export async function agentsWithPaperExposure() {
	return sql`
		SELECT DISTINCT a.agent_id, a.user_id, a.venue
		FROM perps_paper_accounts a
		WHERE EXISTS (SELECT 1 FROM perps_paper_positions p WHERE p.agent_id = a.agent_id AND p.venue = a.venue)
		   OR EXISTS (SELECT 1 FROM perps_paper_orders o WHERE o.agent_id = a.agent_id AND o.venue = a.venue AND o.status = 'open')
	`;
}
