/**
 * One DCA store, two rails.
 *
 * Dollar-cost averaging used to live in two places: the order engine's `dca`
 * orders (Solana, the agent's own wallet, swept by workers/agent-orders) and the
 * delegation-signed EVM schedules in dca_strategies (run hourly by the run-dca
 * cron through the delegation relayer). Both now live in `orders`:
 *
 *   rail 'solana'  network mainnet|devnet, type 'dca', venue auto|launchpad|aggregator
 *   rail 'evm'     network 'evm', type 'dca', venue 'evm_delegation', with
 *                  chain_id, quote_mint (token in), mint (token out),
 *                  amount_in_raw (per period, base units) and delegation_id
 *
 * Fills for both land in order_fills. Migration 20261010210000_orders_any_token
 * copied every existing dca_strategies row (keeping its next_execution_at, so no
 * schedule skips or repeats a period) and every dca_executions row;
 * adoptLegacyDcaStrategies() re-runs the same idempotent copy before each cron
 * tick so a row written by an older image during a rollout is picked up too.
 *
 * Callers: the unified endpoint (/api/agents/:id/orders/dca, api/agents/orders.js),
 * the compatibility facade (/api/dca-strategies, api/dca-strategies.js), the
 * run-dca cron (api/cron/[name].js) and the MCP DCA tools.
 */

import { sql } from './db.js';
import { shapeOrder } from './orders.js';
import { bookEntry } from './order-book.js';
import { MAX_CONSECUTIVE_FAILURES, describePeriod, formatUnits } from './recurring.js';

export const DCA_RAILS = Object.freeze(['solana', 'evm']);
export const EVM_PERIODS = Object.freeze([86400, 604800]);
export const EVM_MAX_SLIPPAGE_BPS = 500;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Which rail an order row belongs to. */
export function railOf(order) {
	return order.network === 'evm' ? 'evm' : 'solana';
}

/**
 * An EVM DCA order in the shape /api/dca-strategies has always returned, so
 * /recurring and any integration built on it keep working unchanged. `id` is
 * the order id; `legacy_id` is the dca_strategies id it was copied from, and
 * both are accepted wherever an id is taken.
 */
export function presentEvmDca(o) {
	const period = Number(o.schedule?.interval_seconds) || null;
	const failures = Number(o.consecutive_failures ?? 0);
	return {
		id: o.id,
		legacy_id: o.legacy_dca_strategy_id || null,
		rail: 'evm',
		agent_id: o.agent_id,
		delegation_id: o.delegation_id,
		chain_id: o.chain_id,
		token_in: o.quote_mint,
		token_out: o.mint,
		token_out_symbol: o.symbol,
		amount_per_execution: o.amount_in_raw,
		period_seconds: period,
		slippage_bps: o.slippage_bps,
		status: o.status,
		next_execution_at: o.next_fire_at,
		last_execution_at: o.last_fire_at,
		created_at: o.created_at,
		cancelled_at: o.cancelled_at,
		paused_at: o.paused_at,
		resumed_at: o.resumed_at,
		consecutive_failures: failures,
		last_error: o.last_error,
		last_error_code: o.last_error_code,
		executions_total: o.fill_count || 0,
		period_label: describePeriod(period),
		amount_display: formatUnits(o.amount_in_raw),
		retries_left: o.status === 'active' ? Math.max(0, MAX_CONSECUTIVE_FAILURES - failures) : 0,
	};
}

/** A Solana DCA order as a unified DCA entry: the order plus its book fields. */
export function presentSolanaDca(o) {
	const entry = bookEntry(o);
	return {
		...entry,
		rail: 'solana',
		period_seconds: Number(o.schedule?.interval_seconds) || null,
		period_label: describePeriod(Number(o.schedule?.interval_seconds) || 0),
		slices: o.schedule?.slices ?? null,
		filled_slices: o.schedule?.filled_slices ?? 0,
		skipped_slices: o.schedule?.skipped_slices ?? 0,
		next_execution_at: o.next_fire_at,
		last_execution_at: o.last_fire_at,
	};
}

/** Shape one order row for whichever rail it is on. */
export function presentDca(o) {
	return railOf(o) === 'evm' ? presentEvmDca(o) : presentSolanaDca(o);
}

// The full shaped order plus the two columns shapeOrder does not carry.
function shapeDcaRow(row) {
	if (!row) return null;
	return { ...shapeOrder(row), legacy_dca_strategy_id: row.legacy_dca_strategy_id || null };
}

/**
 * Every DCA schedule an agent has, on both rails, newest first.
 * `rail` narrows to one; `network` narrows the Solana rail (mainnet|devnet).
 */
export async function listDca(agentId, { rail = null, network = null, statuses = null } = {}) {
	const out = [];
	if (rail !== 'evm') {
		const rows = await sql`
			SELECT * FROM orders
			WHERE agent_id = ${agentId} AND type = 'dca' AND network <> 'evm'
			  AND (${network}::text IS NULL OR network = ${network})
			  AND (${statuses}::text[] IS NULL OR status = ANY(${statuses}::text[]))
			ORDER BY created_at DESC
			LIMIT 200
		`;
		for (const r of rows) out.push(presentSolanaDca(shapeOrder(r)));
	}
	if (rail !== 'solana') {
		const rows = await sql`
			SELECT * FROM orders
			WHERE agent_id = ${agentId} AND network = 'evm' AND type = 'dca'
			  AND (${statuses}::text[] IS NULL OR status = ANY(${statuses}::text[]))
			ORDER BY created_at DESC
			LIMIT 200
		`;
		const last = await lastEvmExecutions(rows.map((r) => r.id));
		for (const r of rows) out.push({ ...presentEvmDca(shapeDcaRow(r)), last_execution: last.get(r.id) || null });
	}
	return out.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

/**
 * One EVM DCA schedule the user owns, by order id or legacy dca_strategies id,
 * with the delegation state the API needs to decide a resume.
 */
export async function findEvmDca(userId, id) {
	if (!UUID_RE.test(String(id || ''))) return null;
	const [row] = await sql`
		SELECT o.*, a.name AS agent_name,
		       d.status AS delegation_status, d.expires_at AS delegation_expires_at
		FROM orders o
		JOIN agent_identities a ON a.id = o.agent_id
		LEFT JOIN agent_delegations d ON d.id = o.delegation_id
		WHERE (o.id = ${id}::uuid OR o.legacy_dca_strategy_id = ${id}::uuid)
		  AND o.network = 'evm' AND o.type = 'dca' AND a.user_id = ${userId}
		LIMIT 1
	`;
	if (!row) return null;
	return {
		order: shapeDcaRow(row),
		agent_name: row.agent_name,
		delegation_status: row.delegation_status || 'missing',
		delegation_expires_at: row.delegation_expires_at || null,
	};
}

// The latest attempt per EVM schedule, in the legacy last_execution shape.
async function lastEvmExecutions(ids) {
	const map = new Map();
	if (!ids.length) return map;
	const rows = await sql`
		SELECT DISTINCT ON (order_id) order_id, id, signature, status, detail, meta, created_at
		FROM order_fills WHERE order_id = ANY(${ids}::uuid[])
		ORDER BY order_id, created_at DESC
	`;
	for (const r of rows) {
		const e = executionFromFill(r);
		map.set(r.order_id, { tx_hash: e.tx_hash, amount_in: e.amount_in, amount_out: e.amount_out, status: e.status, error: e.error, executed_at: e.executed_at });
	}
	return map;
}

/** The attempt log for an EVM schedule, in the legacy dca_executions shape. */
export async function listEvmDcaExecutions(orderId, { limit = 40 } = {}) {
	const lim = Math.min(200, Math.max(1, Number(limit) || 40));
	const rows = await sql`
		SELECT id, signature, status, detail, meta, created_at
		FROM order_fills WHERE order_id = ${orderId}
		ORDER BY created_at DESC LIMIT ${lim}
	`;
	return rows.map(executionFromFill);
}

function executionFromFill(f) {
	const m = f.meta || {};
	const status = f.status === 'confirmed' ? 'success'
		: f.status === 'pending' ? 'pending'
			: f.status === 'unconfirmed' ? 'unknown'
				: m.aborted ? 'aborted' : 'failed';
	return {
		id: f.id,
		chain_id: m.chain_id ?? null,
		tx_hash: f.signature,
		amount_in: m.amount_in ?? null,
		quote_amount_out: m.quote_amount_out ?? null,
		amount_out: m.amount_out ?? null,
		slippage_bps_used: m.slippage_bps_used ?? null,
		quote_divergence_bps: m.quote_divergence_bps ?? null,
		status,
		error: f.detail,
		executed_at: f.created_at,
	};
}

/**
 * Validate an EVM DCA create body. Returns { ok, value } or { ok:false, status,
 * code, message } so the HTTP layers can answer with the legacy error shapes.
 * Token-out symbols come from the operator whitelist DCA_ALLOWED_TOKEN_OUT and
 * the default chain from DCA_CHAIN_ID: runtime config, never hardcoded.
 */
export function validateEvmDca(body) {
	const fail = (status, code, message) => ({ ok: false, status, code, message });
	const b = body || {};
	const addr = (v) => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);
	if (!UUID_RE.test(String(b.agent_id || ''))) return fail(400, 'validation_error', 'agent_id must be a uuid');
	if (!UUID_RE.test(String(b.delegation_id || ''))) return fail(400, 'validation_error', 'delegation_id must be a uuid');
	if (!addr(b.token_in)) return fail(400, 'validation_error', 'token_in must be a 0x-prefixed 40-character hex address');
	if (!addr(b.token_out)) return fail(400, 'validation_error', 'token_out must be a 0x-prefixed 40-character hex address');
	if (typeof b.token_out_symbol !== 'string' || !b.token_out_symbol || b.token_out_symbol.length > 10) {
		return fail(400, 'validation_error', 'token_out_symbol must be 1 to 10 characters');
	}
	if (typeof b.amount_per_execution !== 'string' || !/^\d+$/.test(b.amount_per_execution) || BigInt(b.amount_per_execution) <= 0n) {
		return fail(400, 'validation_error', 'amount_per_execution must be a positive decimal integer string');
	}
	const period = Number(b.period_seconds);
	if (!EVM_PERIODS.includes(period)) return fail(400, 'validation_error', 'period_seconds must be 86400 (daily) or 604800 (weekly)');
	const slippage = b.slippage_bps == null ? 50 : Number(b.slippage_bps);
	if (!Number.isInteger(slippage) || slippage < 1 || slippage > EVM_MAX_SLIPPAGE_BPS) {
		return fail(400, 'validation_error', `slippage_bps must be an integer from 1 to ${EVM_MAX_SLIPPAGE_BPS}`);
	}
	const allowed = new Set((process.env.DCA_ALLOWED_TOKEN_OUT || '').split(',').map((s) => s.trim()).filter(Boolean));
	if (allowed.size === 0) {
		return fail(400, 'not_configured', 'DCA token-out whitelist is not configured. Set DCA_ALLOWED_TOKEN_OUT (comma-separated symbols).');
	}
	if (!allowed.has(b.token_out_symbol)) return fail(400, 'validation_error', `token_out_symbol must be one of: ${[...allowed].join(', ')}`);
	const envChain = parseInt(process.env.DCA_CHAIN_ID || '', 10);
	const chainId = b.chain_id != null ? Number(b.chain_id) : (Number.isInteger(envChain) && envChain > 0 ? envChain : null);
	if (!Number.isInteger(chainId) || chainId <= 0) return fail(400, 'not_configured', 'chain_id is required. Pass it in the body or set DCA_CHAIN_ID.');
	return {
		ok: true,
		value: {
			agent_id: b.agent_id, delegation_id: b.delegation_id, chain_id: chainId,
			token_in: b.token_in, token_out: b.token_out, token_out_symbol: b.token_out_symbol,
			amount_per_execution: b.amount_per_execution, period_seconds: period, slippage_bps: slippage,
		},
	};
}

/**
 * Create an EVM DCA schedule (the delegation is already signed). Checks agent
 * ownership, the delegation, and that no live schedule already buys the pair.
 * The first swap is one full period out, as it always was.
 */
export async function createEvmDca(userId, v) {
	const [agent] = await sql`
		SELECT id FROM agent_identities WHERE id = ${v.agent_id} AND user_id = ${userId} AND deleted_at IS NULL LIMIT 1
	`;
	if (!agent) return { ok: false, status: 404, code: 'not_found', message: 'agent not found' };
	const [delegation] = await sql`
		SELECT id, status, expires_at FROM agent_delegations
		WHERE id = ${v.delegation_id} AND agent_id = ${v.agent_id} AND status = 'active' LIMIT 1
	`;
	if (!delegation) return { ok: false, status: 404, code: 'not_found', message: 'active delegation not found for this agent' };
	if (new Date(delegation.expires_at) <= new Date()) {
		return { ok: false, status: 409, code: 'delegation_expired', message: 'delegation has already expired' };
	}
	// A paused schedule still occupies the pair: resuming it would otherwise
	// leave two live schedules buying the same token from the same wallet.
	const [existing] = await sql`
		SELECT id, status FROM orders
		WHERE agent_id = ${v.agent_id} AND network = 'evm' AND type = 'dca'
		  AND chain_id = ${v.chain_id}
		  AND lower(quote_mint) = lower(${v.token_in}) AND lower(mint) = lower(${v.token_out})
		  AND status IN ('active', 'paused')
		LIMIT 1
	`;
	if (existing) {
		return { ok: false, status: 409, code: 'conflict', message: `a ${existing.status} strategy already exists for this token pair: cancel it first` };
	}
	const nextAt = new Date(Date.now() + v.period_seconds * 1000).toISOString();
	const schedule = JSON.stringify({ interval_seconds: v.period_seconds, slices: null, filled_slices: 0 });
	const [row] = await sql`
		INSERT INTO orders (
			agent_id, user_id, network, mint, symbol, type, side, trigger_metric, schedule, next_fire_at,
			slippage_bps, status, venue, route, chain_id, quote_mint, amount_in_raw, delegation_id
		) VALUES (
			${v.agent_id}, ${userId}, 'evm', ${v.token_out}, ${v.token_out_symbol}, 'dca', 'buy', 'price_sol',
			${schedule}::jsonb, ${nextAt}, ${v.slippage_bps}, 'active', 'evm_delegation', 'evm_delegation',
			${v.chain_id}, ${v.token_in}, ${v.amount_per_execution}, ${v.delegation_id}
		)
		RETURNING *
	`;
	return { ok: true, order: shapeDcaRow(row) };
}

/**
 * Why a resume would only fail on the next tick and re-pause the row, or null
 * when the signed permission behind the schedule is still usable.
 */
export function delegationBlocker(found) {
	if (found.delegation_status !== 'active') {
		return {
			code: 'delegation_inactive',
			message: `the signed permission behind this strategy is ${found.delegation_status}: grant a new one to restart it`,
		};
	}
	if (found.delegation_expires_at && new Date(found.delegation_expires_at) <= new Date()) {
		return {
			code: 'delegation_expired',
			message: 'the signed permission behind this strategy has expired: grant a new one to restart it',
		};
	}
	return null;
}

/** Pause a live EVM schedule. */
export async function pauseEvmDca(orderId) {
	const [row] = await sql`
		UPDATE orders SET status = 'paused', paused_at = now(), updated_at = now()
		WHERE id = ${orderId} AND network = 'evm' AND status = 'active'
		RETURNING *
	`;
	return shapeDcaRow(row);
}

/**
 * Resume a paused EVM schedule a full period out: a resume never back-fills
 * the periods missed while paused, so it can never fire a burst of swaps.
 */
export async function resumeEvmDca(order) {
	const period = Number(order.schedule?.interval_seconds) || 86400;
	const nextAt = new Date(Date.now() + period * 1000).toISOString();
	const [row] = await sql`
		UPDATE orders SET status = 'active', next_fire_at = ${nextAt}, consecutive_failures = 0,
		       last_error = NULL, last_error_code = NULL, resumed_at = now(), updated_at = now()
		WHERE id = ${order.id} AND network = 'evm' AND status = 'paused'
		RETURNING *
	`;
	return shapeDcaRow(row);
}

/** Cancel an EVM schedule (terminal; does not revoke the delegation). */
export async function cancelEvmDca(orderId) {
	const [row] = await sql`
		UPDATE orders SET status = 'cancelled', cancelled_at = now(), updated_at = now(), cancel_reason = 'owner'
		WHERE id = ${orderId} AND network = 'evm' AND status <> 'cancelled'
		RETURNING *
	`;
	return shapeDcaRow(row);
}

/**
 * Copy any dca_strategies / dca_executions rows not yet in orders /
 * order_fills. Idempotent (keyed on legacy_dca_strategy_id and legacy_ref) and
 * the same statements the migration ran. Returns how many rows were adopted.
 */
export async function adoptLegacyDcaStrategies() {
	const [reg] = await sql`
		SELECT to_regclass('public.dca_strategies') IS NOT NULL AS strategies,
		       to_regclass('public.dca_executions') IS NOT NULL AS executions
	`;
	let strategies = 0;
	let executions = 0;
	if (reg?.strategies) {
		const rows = await sql`
			INSERT INTO orders (
				agent_id, user_id, network, mint, symbol, type, side, trigger_metric,
				schedule, next_fire_at, slippage_bps, status, fill_count,
				created_at, updated_at, cancelled_at, last_error, last_error_code,
				consecutive_failures, paused_at, resumed_at, last_fire_at,
				venue, route, chain_id, quote_mint, amount_in_raw, delegation_id, legacy_dca_strategy_id
			)
			SELECT
				s.agent_id, a.user_id, 'evm', s.token_out, s.token_out_symbol, 'dca', 'buy', 'price_sol',
				jsonb_build_object(
					'interval_seconds', s.period_seconds, 'slices', NULL,
					'filled_slices', (SELECT count(*) FROM dca_executions e WHERE e.strategy_id = s.id AND e.status = 'success')
				),
				s.next_execution_at, s.slippage_bps, s.status,
				(SELECT count(*) FROM dca_executions e WHERE e.strategy_id = s.id AND e.status = 'success'),
				s.created_at, now(), s.cancelled_at, s.last_error, s.last_error_code,
				COALESCE(s.consecutive_failures, 0), s.paused_at, s.resumed_at, s.last_execution_at,
				'evm_delegation', 'evm_delegation', s.chain_id, s.token_in, s.amount_per_execution, s.delegation_id, s.id
			FROM dca_strategies s
			JOIN agent_identities a ON a.id = s.agent_id
			WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.legacy_dca_strategy_id = s.id)
			ON CONFLICT DO NOTHING
			RETURNING id
		`;
		strategies = rows.length;
	}
	if (reg?.executions) {
		const rows = await sql`
			INSERT INTO order_fills (
				order_id, agent_id, network, slice_index, side, trigger_reason,
				token_amount, venue, signature, status, detail, meta, created_at, legacy_ref
			)
			SELECT
				o.id, o.agent_id, 'evm', NULL, 'buy', 'dca_slice',
				CASE WHEN e.amount_out ~ '^[0-9]+$' THEN e.amount_out::numeric END,
				'evm_delegation', e.tx_hash,
				CASE e.status WHEN 'success' THEN 'confirmed' WHEN 'pending' THEN 'pending' ELSE 'failed' END,
				e.error,
				jsonb_strip_nulls(jsonb_build_object(
					'chain_id', e.chain_id, 'amount_in', e.amount_in, 'quote_amount_out', e.quote_amount_out,
					'amount_out', e.amount_out, 'slippage_bps_used', e.slippage_bps_used,
					'quote_divergence_bps', e.quote_divergence_bps,
					'aborted', CASE WHEN e.status = 'aborted' THEN true END
				)),
				e.executed_at, 'dca_execution:' || e.id::text
			FROM dca_executions e
			JOIN orders o ON o.legacy_dca_strategy_id = e.strategy_id
			WHERE NOT EXISTS (SELECT 1 FROM order_fills f WHERE f.legacy_ref = 'dca_execution:' || e.id::text)
			ON CONFLICT DO NOTHING
			RETURNING id
		`;
		executions = rows.length;
	}
	return { strategies, executions };
}

// ── run-dca cron: the EVM rail's tick ────────────────────────────────────────

/** Due EVM schedules with their delegation state, soonest first. */
export async function dueEvmDca(limit = 50) {
	const rows = await sql`
		SELECT o.*, d.status AS delegation_status, d.expires_at AS delegation_expires_at
		FROM orders o
		LEFT JOIN agent_delegations d ON d.id = o.delegation_id
		WHERE o.network = 'evm' AND o.type = 'dca' AND o.status = 'active' AND o.next_fire_at <= now()
		ORDER BY o.next_fire_at ASC
		LIMIT ${limit}
	`;
	return rows.map((r) => ({
		...shapeDcaRow(r),
		delegation_status: r.delegation_status || 'missing',
		delegation_expires_at: r.delegation_expires_at || null,
	}));
}

/**
 * Claim a due schedule by advancing next_fire_at one period. A concurrent tick
 * (or a retry of this one) then cannot pick it. Returns false if lost.
 */
export async function claimEvmDca(order, { nowIso, nextIso }) {
	const rows = await sql`
		UPDATE orders SET next_fire_at = ${nextIso}, updated_at = now()
		WHERE id = ${order.id} AND status = 'active' AND next_fire_at <= ${nowIso}
		RETURNING id
	`;
	return rows.length > 0;
}

/** Record a successful period: one confirmed fill, the schedule advanced. */
export async function recordEvmDcaSuccess(order, { txHash, quoteAmountOut, divergenceBps }) {
	await sql`
		UPDATE orders SET last_fire_at = now(), consecutive_failures = 0, last_error = NULL, last_error_code = NULL,
		       fill_count = fill_count + 1, updated_at = now(),
		       schedule = jsonb_set(COALESCE(schedule, '{}'::jsonb), '{filled_slices}',
		                  to_jsonb(COALESCE((schedule->>'filled_slices')::int, 0) + 1))
		WHERE id = ${order.id}
	`;
	await insertEvmDcaFill(order, {
		status: 'confirmed', signature: txHash,
		meta: { quote_amount_out: quoteAmountOut, quote_divergence_bps: divergenceBps },
	});
}

/**
 * Record a failed or skipped period. `apply` is the shared recurring-payment
 * classifier's decision: retry releases the claim (next_fire_at back to now),
 * pause parks the schedule, anything else keeps the period consumed.
 */
export async function recordEvmDcaFailure(order, { code, reason, aborted = false, unconfirmed = false, apply = {}, status = null, divergenceBps = null }) {
	const msg = String(reason || '').slice(0, 500);
	const failures = apply.consecutiveFailures ?? order.consecutive_failures ?? 0;
	if (status === 'paused' || status === 'expired') {
		await sql`
			UPDATE orders SET status = ${status}, paused_at = now(), last_error = ${msg}, last_error_code = ${code}, updated_at = now()
			WHERE id = ${order.id}
		`;
	} else if (apply.retry) {
		await sql`
			UPDATE orders SET next_fire_at = ${apply.nowIso}, last_error = ${msg}, last_error_code = ${code},
			       consecutive_failures = ${failures}, updated_at = now()
			WHERE id = ${order.id}
		`;
	} else if (apply.pause) {
		await sql`
			UPDATE orders SET status = 'paused', paused_at = now(), last_error = ${msg}, last_error_code = ${code},
			       consecutive_failures = ${failures}, updated_at = now()
			WHERE id = ${order.id}
		`;
	} else {
		await sql`
			UPDATE orders SET last_error = ${msg}, last_error_code = ${code}, consecutive_failures = ${failures}, updated_at = now()
			WHERE id = ${order.id}
		`;
	}
	// An ambiguous outcome (the relayer may have broadcast) is 'unconfirmed',
	// never 'failed': the owner must not read it as money that never moved.
	await insertEvmDcaFill(order, {
		status: unconfirmed ? 'unconfirmed' : 'failed', detail: msg,
		meta: { aborted: aborted || undefined, error_code: code, quote_divergence_bps: divergenceBps ?? undefined },
	});
}

async function insertEvmDcaFill(order, { status, signature = null, detail = null, meta = {} }) {
	const full = JSON.stringify({
		chain_id: order.chain_id, amount_in: order.amount_in_raw, slippage_bps_used: order.slippage_bps,
		...Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined && v !== null)),
	});
	await sql`
		INSERT INTO order_fills (order_id, agent_id, network, side, trigger_reason, venue, signature, status, detail, meta)
		VALUES (${order.id}, ${order.agent_id}, 'evm', 'buy', 'dca_slice', 'evm_delegation', ${signature}, ${status}, ${detail}, ${full}::jsonb)
	`;
}
