// Per-agent perps risk policy, stored at agent_identities.meta.perps_limits.
//
// Every agent gets a mandatory leverage cap and a per-position margin cap with
// conservative defaults, so a fresh agent can paper trade at once but cannot
// put real collateral to work until its owner turns live mode on:
//
//   live_enabled                 false: orders run on the paper ledger at live prices
//   max_leverage                 account leverage (notional over equity) after any order
//   max_margin_per_position_usd  initial margin any one position may hold
//   max_slippage_bps             ceiling on the slippage a market order may accept
//   max_quote_move_bps           how far entry or liquidation may drift between
//                                preview and execute before the execute refuses
//   halted                       set by the kill switch: risk-increasing orders
//                                are refused until the owner resumes trading
//   alert_*                      owner thresholds the tracker and the alert cron
//                                check; null turns that alert off
//
// These sit on top of the wallet-wide spend policy (freeze, per-transaction and
// daily USD caps, allowlist), which still applies in full to every deposit.

import { sql } from '../db.js';
import { logAudit } from '../audit.js';
import { recordCustodyEvent } from '../agent-trade-guards.js';
import { perpsError } from './errors.js';

export const PERPS_LIMIT_DEFAULTS = Object.freeze({
	live_enabled: false,
	max_leverage: 2,
	max_margin_per_position_usd: 25,
	max_slippage_bps: 100,
	max_quote_move_bps: 50,
	halted: false,
	alert_liquidation_distance_pct: 15,
	alert_loss_usd: null,
	alert_gain_usd: null,
	alert_funding_usd: null,
});

// Hard ceilings no owner setting can exceed.
export const PERPS_LIMIT_CEILINGS = Object.freeze({
	max_leverage: 20,
	max_margin_per_position_usd: 100_000,
	max_slippage_bps: 1_000,
	max_quote_move_bps: 500,
});

function clamp(v, def, min, max) {
	if (v === undefined || v === '') return def;
	const n = Number(v);
	if (!Number.isFinite(n) || n < min) return def;
	return Math.min(max, n);
}

function optional(v, min, max) {
	if (v === null || v === undefined || v === '') return null;
	const n = Number(v);
	if (!Number.isFinite(n) || n < min) return null;
	return Math.min(max, n);
}

/** Coerce arbitrary input into clean, bounded perps limits. */
export function normalizePerpsLimits(raw) {
	const r = raw && typeof raw === 'object' ? raw : {};
	const d = PERPS_LIMIT_DEFAULTS;
	const c = PERPS_LIMIT_CEILINGS;
	return {
		live_enabled: r.live_enabled === true,
		max_leverage: clamp(r.max_leverage, d.max_leverage, 1, c.max_leverage),
		max_margin_per_position_usd: clamp(r.max_margin_per_position_usd, d.max_margin_per_position_usd, 1, c.max_margin_per_position_usd),
		max_slippage_bps: Math.round(clamp(r.max_slippage_bps, d.max_slippage_bps, 1, c.max_slippage_bps)),
		max_quote_move_bps: Math.round(clamp(r.max_quote_move_bps, d.max_quote_move_bps, 1, c.max_quote_move_bps)),
		halted: r.halted === true,
		alert_liquidation_distance_pct: 'alert_liquidation_distance_pct' in r
			? optional(r.alert_liquidation_distance_pct, 0.5, 90)
			: d.alert_liquidation_distance_pct,
		alert_loss_usd: optional(r.alert_loss_usd, 0.01, 10_000_000),
		alert_gain_usd: optional(r.alert_gain_usd, 0.01, 10_000_000),
		alert_funding_usd: optional(r.alert_funding_usd, 0.01, 10_000_000),
		updated_at: typeof r.updated_at === 'string' ? r.updated_at : null,
	};
}

/** Read the effective perps limits off an agent's meta blob. */
export function getPerpsLimits(meta) {
	return normalizePerpsLimits(meta?.perps_limits);
}

const PATCHABLE = Object.keys(PERPS_LIMIT_DEFAULTS);

/**
 * Persist a perps-limit patch (owner-only). Keys absent from `patch` keep their
 * value. Audited in the custody trail and the platform audit log.
 */
export async function setPerpsLimits(agentId, userId, patch, { req = null, reason = 'perps_limits_updated' } = {}) {
	const [row] = await sql`
		SELECT id, user_id, meta FROM agent_identities
		WHERE id = ${agentId} AND deleted_at IS NULL
	`;
	if (!row) throw perpsError(404, 'not_found', 'No agent with that id.');
	if (row.user_id !== userId) throw perpsError(403, 'forbidden', "That agent isn't on your account.");

	const prev = getPerpsLimits(row.meta);
	const p = patch && typeof patch === 'object' ? patch : {};
	const merged = { ...prev };
	for (const k of PATCHABLE) if (k in p) merged[k] = p[k];
	const next = normalizePerpsLimits(merged);
	next.updated_at = new Date().toISOString();

	await sql`
		UPDATE agent_identities
		SET meta = jsonb_set(coalesce(meta, '{}'::jsonb), '{perps_limits}', ${JSON.stringify(next)}::jsonb)
		WHERE id = ${agentId}
	`;

	await recordCustodyEvent({
		agentId,
		userId,
		eventType: 'limit_change',
		reason,
		meta: { prev, next },
	}).catch((e) => console.warn('[perps] limit_change record failed', e?.message));
	logAudit({ userId, action: 'custody.perps_limit_change', resourceId: agentId, meta: { prev, next }, req });

	return next;
}

/**
 * Pure: is this order allowed under the agent's perps limits? `quote` is the
 * venue quote (or the paper equivalent). Returns the checks the preview shows
 * and the first blocking one.
 *
 * @param {object} o
 * @param {object} o.limits          normalized perps limits
 * @param {object} o.quote           quoteOrder output
 * @param {boolean} o.tradeKill      the agent-wide trade kill switch
 * @param {boolean} o.walletFrozen   the wallet-wide spend freeze
 * @param {'paper'|'live'} o.mode
 */
export function checkPerpsOrder({ limits, quote, tradeKill = false, walletFrozen = false, mode }) {
	const lim = normalizePerpsLimits(limits);
	const increasing = quote.risk_increasing === true;
	const leverage = quote.account_leverage_after;
	const marketMax = Number(quote.market_max_leverage) || lim.max_leverage;
	const leverageCap = Math.min(lim.max_leverage, marketMax);
	const positionMargin = quote.position_after?.notional_usd != null && marketMax > 0
		? quote.position_after.notional_usd / marketMax
		: 0;
	// The leverage the owner allows means each position may tie up at most its
	// notional over that leverage in margin, so measure the cap the same way.
	const marginAtCap = quote.position_after?.notional_usd != null ? quote.position_after.notional_usd / leverageCap : 0;

	const checks = [
		{
			id: 'mode',
			ok: mode === 'paper' || lim.live_enabled,
			label: mode === 'paper' ? 'Paper mode: fills at live prices, no funds move' : lim.live_enabled ? 'Live trading is on for this agent' : 'Live trading is off for this agent',
		},
		{
			id: 'halted',
			ok: !increasing || !lim.halted,
			label: lim.halted ? (increasing ? 'The perps kill switch is on: only reduce-only orders are allowed' : 'Kill switch on, but this order only reduces risk') : 'The perps kill switch is off',
		},
		{
			id: 'trade_kill_switch',
			ok: !increasing || !tradeKill,
			label: tradeKill ? 'The agent-wide trade kill switch is on' : 'The agent-wide trade kill switch is off',
		},
		{
			id: 'wallet_frozen',
			ok: !increasing || !walletFrozen,
			label: walletFrozen ? 'The wallet is frozen' : 'The wallet is not frozen',
		},
		{
			id: 'leverage',
			ok: !increasing || (leverage != null && leverage <= leverageCap + 1e-9),
			label: leverage == null
				? 'No equity to back the position: deposit collateral first'
				: `Account leverage after the order: ${leverage.toFixed(2)}x of ${leverageCap.toFixed(2)}x allowed`,
		},
		{
			id: 'position_margin',
			ok: !increasing || marginAtCap <= lim.max_margin_per_position_usd + 1e-9,
			label: `Margin this position needs at your leverage cap: $${marginAtCap.toFixed(2)} of $${lim.max_margin_per_position_usd.toFixed(2)} allowed`,
		},
		{
			id: 'free_collateral',
			ok: !increasing || (quote.free_collateral_after_usd != null && quote.free_collateral_after_usd >= 0),
			label: `Free collateral after the order: $${Number(quote.free_collateral_after_usd || 0).toFixed(2)}`,
		},
	];
	if (quote.slippage_bps != null) {
		checks.push({
			id: 'slippage',
			ok: quote.slippage_bps <= lim.max_slippage_bps,
			label: `Slippage allowed: ${quote.slippage_bps} bps of ${lim.max_slippage_bps} bps`,
		});
	}
	const blocked = checks.find((c) => !c.ok) || null;
	return { checks, blocked, leverage_cap: leverageCap, position_margin_usd: positionMargin };
}

/**
 * Pure: did the market move between preview and execute by more than the owner
 * tolerates? Compares entry and liquidation in basis points of the preview.
 * @returns {null | { reason: string, detail: object }}
 */
export function quoteMoved(previewQuote, freshQuote, toleranceBps) {
	const bps = (a, b) => (a && b ? (Math.abs(b - a) / a) * 10_000 : 0);
	const entryMove = bps(previewQuote.entry_price, freshQuote.entry_price);
	if (entryMove > toleranceBps) {
		return { reason: 'quote_moved', detail: { field: 'entry_price', preview: previewQuote.entry_price, now: freshQuote.entry_price, moved_bps: Math.round(entryMove), tolerance_bps: toleranceBps } };
	}
	const pl = previewQuote.liquidation_price;
	const fl = freshQuote.liquidation_price;
	if ((pl == null) !== (fl == null)) {
		return { reason: 'quote_moved', detail: { field: 'liquidation_price', preview: pl, now: fl, tolerance_bps: toleranceBps } };
	}
	const liqMove = bps(pl, fl);
	if (liqMove > toleranceBps) {
		return { reason: 'quote_moved', detail: { field: 'liquidation_price', preview: pl, now: fl, moved_bps: Math.round(liqMove), tolerance_bps: toleranceBps } };
	}
	const sizeMove = Math.abs((freshQuote.size || 0) - (previewQuote.size || 0));
	if (sizeMove > 1e-12) {
		return { reason: 'quote_moved', detail: { field: 'size', preview: previewQuote.size, now: freshQuote.size } };
	}
	return null;
}
