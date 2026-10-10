/**
 * The per-agent order book: what is resting, when each order next fires, and
 * why the last evaluation did not fire.
 *
 * Both sides read this module. The worker (workers/agent-orders) maps every
 * executor and guard code onto one closed set of skip reasons with skipCodeFor()
 * and writes it on the order; the HTTP endpoint (api/agents/orders.js), the MCP
 * tools (api/_mcpagent/orders-tools.js) and the wallet hub's Orders tab read the
 * book back with listOrderBook(). One vocabulary, so "why didn't my order fire"
 * has the same answer on every surface.
 */

import { sql } from './db.js';
import { shapeOrder } from './orders.js';

/** The closed set of reasons an evaluation can skip a fill. */
export const SKIP_CODES = Object.freeze({
	price_outside_band: 'Price outside the order’s band',
	cap_hit: 'Spend cap or daily budget reached',
	venue_unhealthy: 'Venue unhealthy, backing off',
	kill_switch: 'Trading paused for this agent',
	insufficient_funds: 'Not enough SOL or tokens in the wallet',
	no_quote: 'No live price for this token',
	price_impact: 'Price impact above the safety limit',
	no_balance: 'Nothing to sell',
	blocked: 'Blocked by the trade firewall',
});

const CODE_MAP = new Map([
	// The per-agent kill switch and the wallet anomaly freeze stop every fill.
	['kill_switch', 'kill_switch'], ['trading_paused', 'kill_switch'], ['wallet_anomaly_frozen', 'kill_switch'],
	['orders_global_kill', 'kill_switch'],
	// Spend policy: per-trade cap, daily budget, USD ceilings, position limits.
	['per_trade_cap', 'cap_hit'], ['daily_budget', 'cap_hit'], ['daily_exceeded', 'cap_hit'],
	['daily_budget_exceeded', 'cap_hit'], ['per_tx_exceeded', 'cap_hit'], ['max_positions', 'cap_hit'],
	['spend_limit', 'cap_hit'], ['capability_required', 'cap_hit'], ['policy_unavailable', 'cap_hit'],
	['policy_blocked', 'cap_hit'],
	// Wallet balance.
	['insufficient_sol', 'insufficient_funds'], ['insufficient_sol_for_fees', 'insufficient_funds'],
	['insufficient_token_balance', 'insufficient_funds'], ['insufficient_funds', 'insufficient_funds'],
	// Price impact breaker.
	['price_impact', 'price_impact'], ['price_impact_too_high', 'price_impact'],
	// The venue or the RPC under it.
	['quote_failed', 'venue_unhealthy'], ['rpc_error', 'venue_unhealthy'], ['rpc_unavailable', 'venue_unhealthy'],
	['send_failed', 'venue_unhealthy'], ['build_failed', 'venue_unhealthy'], ['simulation_failed', 'venue_unhealthy'],
	['simulate_failed', 'venue_unhealthy'], ['fee_build_failed', 'venue_unhealthy'], ['guard_check_failed', 'venue_unhealthy'],
	['no_market', 'venue_unhealthy'], ['pool_not_found', 'venue_unhealthy'], ['venue_unavailable', 'venue_unhealthy'],
	['venue_mainnet_only', 'venue_unhealthy'], ['trade_unconfirmed', 'venue_unhealthy'],
	// Sizing.
	['no_balance_or_size', 'no_balance'], ['no_balance', 'no_balance'],
	// The rug firewall and other refusals that will not clear by retrying.
	['firewall_blocked', 'blocked'], ['invalid_mint', 'blocked'], ['zero_out', 'blocked'], ['quote_not_sol', 'blocked'],
]);

// Codes that say the VENUE is failing, as opposed to this one transaction. Only
// these feed the worker's per-route breaker: a simulation that fails because a
// particular swap reverts says nothing about whether the next order can route.
const VENUE_FAILURE_CODES = new Set([
	'quote_failed', 'rpc_error', 'rpc_unavailable', 'send_failed', 'build_failed',
	'fee_build_failed', 'guard_check_failed', 'venue_unavailable',
]);

/** Map an executor / guard / sizing code onto the book's skip vocabulary. */
export function skipCodeFor(code) {
	if (!code) return 'venue_unhealthy';
	if (SKIP_CODES[code]) return code;
	return CODE_MAP.get(String(code)) || 'venue_unhealthy';
}

/** True when a failure code says the route itself is unhealthy. */
export function isVenueFailure(code) {
	return VENUE_FAILURE_CODES.has(String(code || ''));
}

/** The human label for a skip code. */
export function skipLabel(code) {
	return SKIP_CODES[code] || 'Skipped';
}

/**
 * When an order next acts, in words and (for scheduled orders) as a timestamp.
 * Pure: reads only the shaped order.
 *
 * @returns {{ at: string|null, label: string }}
 */
export function nextFire(o) {
	const terminal = ['filled', 'cancelled', 'expired', 'error'].includes(o.status);
	if (terminal) return { at: null, label: `No further fills (${o.status})` };
	if (o.status === 'paused') return { at: null, label: 'Paused by the owner' };
	if (o.hold_until && new Date(o.hold_until).getTime() > Date.now()) {
		return { at: o.hold_until, label: `Backing off until ${new Date(o.hold_until).toISOString()}` };
	}
	if (o.type === 'dca' || o.type === 'twap') {
		return { at: o.next_fire_at || null, label: o.next_fire_at ? `Next slice at ${new Date(o.next_fire_at).toISOString()}` : 'Next slice on the next sweep' };
	}
	if (o.type === 'conditional') return { at: null, label: 'When the condition is true' };
	const target = o.type === 'limit' ? o.limit_price : o.type === 'stop' ? o.stop_price : null;
	if (o.type === 'trailing') {
		return { at: null, label: o.side === 'sell' ? `After a ${o.trail_pct}% drop from the high` : `After a ${o.trail_pct}% bounce from the low` };
	}
	const dir = (o.type === 'limit') === (o.side === 'buy') ? 'at or below' : 'at or above';
	return { at: null, label: `When ${o.trigger_metric} is ${dir} ${target}` };
}

/** Attach the book fields (next fire + skip reason) to a shaped order. */
export function bookEntry(o) {
	return {
		...o,
		next_fire: nextFire(o),
		last_skip: o.last_skip_code
			? { code: o.last_skip_code, label: skipLabel(o.last_skip_code), detail: o.last_skip_detail, at: o.last_skip_at }
			: null,
	};
}

/**
 * The resting book for an agent on one network: every order that can still
 * fill, grouped orders kept together, soonest action first. Each entry carries
 * next_fire and last_skip.
 */
export async function listOrderBook(agentId, { network = 'mainnet', limit = 200 } = {}) {
	const lim = Math.min(500, Math.max(1, Number(limit) || 200));
	const rows = await sql`
		SELECT * FROM orders
		WHERE agent_id = ${agentId} AND network = ${network}
		  AND status IN ('active', 'partial', 'firing', 'paused')
		ORDER BY COALESCE(hold_until, next_fire_at, created_at) ASC, group_id NULLS LAST, group_leg NULLS LAST
		LIMIT ${lim}
	`;
	return rows.map((r) => bookEntry(shapeOrder(r)));
}

/** Recent lifecycle events (skip-reason changes, fires, failures, cancels) for an order or an agent. */
export async function listOrderEvents(agentId, { orderId = null, limit = 50 } = {}) {
	const lim = Math.min(200, Math.max(1, Number(limit) || 50));
	const rows = await sql`
		SELECT id, order_id, kind, code, detail, meta, created_at
		FROM agent_order_events
		WHERE agent_id = ${agentId}
		  AND (${orderId}::uuid IS NULL OR order_id = ${orderId}::uuid)
		ORDER BY created_at DESC
		LIMIT ${lim}
	`;
	return rows.map((r) => ({ ...r, id: Number(r.id), label: r.kind === 'skip' ? skipLabel(r.code) : null }));
}
