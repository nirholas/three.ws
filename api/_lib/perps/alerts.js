// Perps alerts: the owner sets thresholds per agent (meta.perps_limits.alert_*)
// and this module decides which of them an account currently crosses.
//
// evaluateAlerts is pure and runs on every tracker frame, so the page shows a
// crossed threshold the moment it happens. deliverAlerts persists each crossing
// once per kind, symbol and hour (perps_alert_events.dedupe_key) and sends the
// owner a `perps_alert` notification, which the preference matrix routes to the
// bell, push and paired chats under the "Market alerts" category. The cron at
// /api/cron/perps-tick runs deliverAlerts for every exposed agent.
//
// Kinds:
//   liquidation_distance  a position's mark is within N percent of its liquidation price
//   liquidatable          the account's equity is under maintenance margin
//   loss                  total unrealized PnL is at or below minus N USD
//   gain                  total unrealized PnL is at or above N USD
//   funding               a position has paid N USD or more in funding since it opened

import { sql } from '../db.js';
import { insertNotification } from '../notify.js';

const HOUR_MS = 3_600_000;
const usd = (n) => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;

/**
 * Pure: every alert threshold the account crosses right now.
 *
 * @param {object} account  venue-shaped account (venue getAccount or the paper ledger)
 * @param {object} limits   normalized perps limits
 * @returns {Array<{ kind: string, severity: 'warning'|'critical'|'info', symbol: string|null, value: number, threshold: number|null, message: string }>}
 */
export function evaluateAlerts(account, limits) {
	if (!account || !limits) return [];
	const out = [];
	const positions = Array.isArray(account.positions) ? account.positions : [];

	if (positions.length && account.risk_state === 'liquidatable') {
		out.push({
			kind: 'liquidatable',
			severity: 'critical',
			symbol: null,
			value: Number(account.equity_usd) || 0,
			threshold: Number(account.maintenance_margin_usd) || 0,
			message: `Equity ${usd(Number(account.equity_usd) || 0)} is under maintenance margin ${usd(Number(account.maintenance_margin_usd) || 0)}: the account can be liquidated now.`,
		});
	}

	const liqPct = limits.alert_liquidation_distance_pct;
	if (liqPct != null) {
		for (const p of positions) {
			if (p.liquidation_distance_pct == null || p.liquidation_distance_pct > liqPct) continue;
			out.push({
				kind: 'liquidation_distance',
				severity: p.liquidation_distance_pct <= liqPct / 2 ? 'critical' : 'warning',
				symbol: p.symbol,
				value: p.liquidation_distance_pct,
				threshold: liqPct,
				message: `${p.symbol} ${p.side} is ${p.liquidation_distance_pct.toFixed(2)}% from liquidation at $${p.liquidation_price} (alert at ${liqPct}%).`,
			});
		}
	}

	const upnl = Number(account.unrealized_pnl_usd) || 0;
	if (limits.alert_loss_usd != null && positions.length && upnl <= -limits.alert_loss_usd) {
		out.push({
			kind: 'loss',
			severity: 'warning',
			symbol: null,
			value: upnl,
			threshold: -limits.alert_loss_usd,
			message: `Unrealized PnL is ${usd(upnl)}, past your ${usd(-limits.alert_loss_usd)} loss alert.`,
		});
	}
	if (limits.alert_gain_usd != null && positions.length && upnl >= limits.alert_gain_usd) {
		out.push({
			kind: 'gain',
			severity: 'info',
			symbol: null,
			value: upnl,
			threshold: limits.alert_gain_usd,
			message: `Unrealized PnL is ${usd(upnl)}, past your ${usd(limits.alert_gain_usd)} gain alert.`,
		});
	}

	if (limits.alert_funding_usd != null) {
		for (const p of positions) {
			const paid = Number(p.funding_accrued_usd) || 0;
			if (paid < limits.alert_funding_usd) continue;
			out.push({
				kind: 'funding',
				severity: 'warning',
				symbol: p.symbol,
				value: paid,
				threshold: limits.alert_funding_usd,
				message: `${p.symbol} ${p.side} has paid ${usd(paid)} in funding, past your ${usd(limits.alert_funding_usd)} alert.`,
			});
		}
	}
	return out;
}

/** The key that keeps one alert from firing more than once an hour. */
export function alertDedupeKey({ agentId, mode, alert, nowMs = Date.now() }) {
	const bucket = Math.floor(nowMs / HOUR_MS);
	return `${agentId}:${mode}:${alert.kind}:${alert.symbol || '*'}:${bucket}`;
}

/**
 * Record and notify every alert that has not already fired this hour. Returns
 * the alerts that were delivered now.
 */
export async function deliverAlerts({ agent, userId, mode, alerts, nowMs = Date.now() }) {
	const delivered = [];
	for (const alert of alerts) {
		const [row] = await sql`
			INSERT INTO perps_alert_events (agent_id, user_id, mode, kind, symbol, value, threshold, dedupe_key)
			VALUES (${agent.id}, ${userId}, ${mode}, ${alert.kind}, ${alert.symbol}, ${alert.value}, ${alert.threshold},
				${alertDedupeKey({ agentId: agent.id, mode, alert, nowMs })})
			ON CONFLICT (dedupe_key) DO NOTHING
			RETURNING id
		`;
		if (!row) continue;
		const prefix = mode === 'paper' ? 'Paper perps' : 'Perps';
		await insertNotification(userId, 'perps_alert', {
			agent_id: agent.id,
			agent_name: agent.name,
			mode,
			kind: alert.kind,
			severity: alert.severity,
			symbol: alert.symbol,
			title: `${prefix}: ${agent.name || 'your agent'}${alert.symbol ? ` ${alert.symbol}` : ''}`,
			summary: `${agent.name || 'Your agent'} (${mode}): ${alert.message}`,
			link: `/agents/${agent.id}/perps`,
		});
		delivered.push(alert);
	}
	return delivered;
}

/** Recent alerts delivered for an agent, newest first. */
export async function recentAlerts(agentId, { limit = 20 } = {}) {
	const rows = await sql`
		SELECT id, mode, kind, symbol, value, threshold, created_at
		FROM perps_alert_events WHERE agent_id = ${agentId}
		ORDER BY id DESC LIMIT ${Math.min(100, Math.max(1, limit))}
	`;
	return rows.map((r) => ({
		id: String(r.id),
		mode: r.mode,
		kind: r.kind,
		symbol: r.symbol,
		value: r.value == null ? null : Number(r.value),
		threshold: r.threshold == null ? null : Number(r.threshold),
		created_at: new Date(r.created_at).toISOString(),
	}));
}
