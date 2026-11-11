// Incident alerts for the Microsoft surfaces (api/cron/microsoft-alerts.js).
//
// Four checks, each producing incidents keyed so one real problem is one key:
//
//   webhook_unacknowledged:<operation id>   an InProgress ChangePlan / ChangeQuantity /
//                                           Reinstate not acknowledged inside Microsoft's
//                                           deadline, or a webhook stuck at 'received'
//   metering_rejected:<subscription>:<dim>  Microsoft rejected a usage event in the last 24 h
//   connector_error_rate                    Power Platform connector 5xx rate over the
//                                           threshold in the last hour
//   teams_5xx                               the Teams bot answered 5xx in the last 15 minutes
//
// microsoft_alert_incidents holds one row per key. A key that becomes active
// opens an incident and sends exactly one message through the owner channel
// (sendOpsAlert: ops_alerts, plus Telegram and email when configured). While it
// stays active nothing more is sent; when it clears the incident is resolved,
// and only a later recurrence sends again. The open is a conditional upsert, so
// two overlapping cron runs cannot both send.

import { sql } from './db.js';
import { sendOpsAlert } from './alerts.js';
import {
	summarizeOperations, summarizeMetering, summarizeConnector, summarizeTeams,
	connectorThreshold, runbook, ACK_DEADLINE_MS,
} from './microsoft-dashboard.js';

const MIN = 60_000;
export const WINDOWS = Object.freeze({
	operations: 7 * 24 * 60 * MIN,
	metering: 24 * 60 * MIN,
	connector: 60 * MIN,
	teams: 15 * MIN,
});

/**
 * The incidents active right now, from rows shaped like the tables.
 * @param {{ operations: any[], usage: any[], connector: any[], teams: any[] }} rows
 * @param {number} now
 * @param {{ rate: number, minCalls: number }} threshold
 * @returns {Array<{ key: string, kind: string, title: string, detail: string }>}
 */
export function detectIncidents(rows, now, threshold) {
	const out = [];
	const ops = summarizeOperations(rows.operations, now, 7);
	for (const op of ops.unacknowledged) {
		out.push({
			key: `webhook_unacknowledged:${op.id}`,
			kind: 'webhook_unacknowledged',
			title: op.reason === 'ack_deadline'
				? `Microsoft ${op.action} not acknowledged inside ${ACK_DEADLINE_MS / 1000}s`
				: `Microsoft ${op.action} webhook stuck at 'received'`,
			detail: `operation ${op.id}\nsubscription ${op.subscription_id}\nreceived ${op.received_at}\noutcome ${op.outcome}${op.error ? `\nerror ${op.error}` : ''}\nrunbook ${runbook('webhook-unacknowledged')}`,
		});
	}
	const metering = summarizeMetering(rows.usage, now, 1);
	const rejectedBy = new Map();
	for (const ev of metering.rejected) {
		if (now - Date.parse(ev.updated_at) > WINDOWS.metering) continue;
		const key = `metering_rejected:${ev.subscription_id}:${ev.dimension}`;
		const cur = rejectedBy.get(key);
		if (cur) cur.count += 1;
		else rejectedBy.set(key, { ev, count: 1 });
	}
	for (const [key, { ev, count }] of rejectedBy) {
		out.push({
			key,
			kind: 'metering_rejected',
			title: `Microsoft rejected ${count} metering event${count === 1 ? '' : 's'} for ${ev.dimension}`,
			detail: `subscription ${ev.subscription_id}\nplan ${ev.plan_id}\nlatest hour ${ev.effective_start_time}\nmessage ${ev.message || 'none'}\nrunbook ${runbook('metering-rejected')}`,
		});
	}
	const connector = summarizeConnector(rows.connector, now, 1, WINDOWS.connector / (24 * 60 * MIN));
	if (connector.calls >= threshold.minCalls && connector.error_rate > threshold.rate) {
		const worst = connector.by_operation.slice().sort((a, b) => b.errors - a.errors)[0];
		out.push({
			key: 'connector_error_rate',
			kind: 'connector_error_rate',
			title: `Power Platform connector error rate ${(connector.error_rate * 100).toFixed(1)}% in the last hour`,
			detail: `${connector.errors} of ${connector.calls} calls answered 5xx (threshold ${(threshold.rate * 100).toFixed(1)}% over ${threshold.minCalls}+ calls)\nworst operation ${worst.operation} (${worst.errors} errors)\nrunbook ${runbook('connector-error-rate')}`,
		});
	}
	const teams = summarizeTeams(rows.teams, now, 1, WINDOWS.teams / (24 * 60 * MIN));
	if (teams.server_errors > 0) {
		const e = teams.errors[0];
		out.push({
			key: 'teams_5xx',
			kind: 'teams_5xx',
			title: `Teams bot answered 5xx ${teams.server_errors} time${teams.server_errors === 1 ? '' : 's'} in 15 minutes`,
			detail: `latest ${e.operation} at ${e.created_at}\nerror ${e.error || 'none recorded'}\nrunbook ${runbook('teams-5xx')}`,
		});
	}
	return out;
}

/**
 * Pure dedup plan. `open` are new incidents (send once), `keep` are already
 * open (no message), `resolve` are open incidents no longer active.
 * @param {Array<{ key: string }>} active
 * @param {Array<{ key: string }>} existingOpen
 */
export function planAlerts(active, existingOpen) {
	const openKeys = new Set(existingOpen.map((i) => i.key));
	const activeKeys = new Set(active.map((i) => i.key));
	return {
		open: active.filter((i) => !openKeys.has(i.key)),
		keep: active.filter((i) => openKeys.has(i.key)),
		resolve: existingOpen.filter((i) => !activeKeys.has(i.key)),
	};
}

/** The incident table, through the Neon client. */
export const incidentStore = {
	async listOpen() {
		return sql`select key, kind, title, opened_at, notified_at, occurrences from microsoft_alert_incidents where resolved_at is null`;
	},
	/** Open (or reopen) an incident. Returns true only for the caller that actually opened it. */
	async open(inc) {
		const rows = await sql`
			insert into microsoft_alert_incidents (key, kind, title, detail)
			values (${inc.key}, ${inc.kind}, ${inc.title}, ${inc.detail})
			on conflict (key) do update
				set kind = excluded.kind, title = excluded.title, detail = excluded.detail,
				    opened_at = now(), last_seen_at = now(), resolved_at = null, notified_at = null, occurrences = 1
				where microsoft_alert_incidents.resolved_at is not null
			returning key
		`;
		return rows.length > 0;
	},
	async markNotified(key) {
		await sql`update microsoft_alert_incidents set notified_at = now() where key = ${key}`;
	},
	async touch(keys) {
		if (!keys.length) return;
		await sql`update microsoft_alert_incidents set last_seen_at = now(), occurrences = occurrences + 1 where key = any(${keys}::text[]) and resolved_at is null`;
	},
	async resolve(keys) {
		if (!keys.length) return;
		await sql`update microsoft_alert_incidents set resolved_at = now() where key = any(${keys}::text[]) and resolved_at is null`;
	},
};

/** Rows for detectIncidents, read from the real tables. */
export async function loadAlertRows(now) {
	const since = (ms) => new Date(now - ms);
	const [operations, usage, surface] = await Promise.all([
		sql`select id, subscription_id, action, plan_id, quantity, status, outcome, error, received_at, processed_at
		    from microsoft_saas_operations where received_at >= ${since(WINDOWS.operations)}`,
		sql`select id, subscription_id, plan_id, dimension, effective_start_time, quantity, status, message, attempts, updated_at
		    from microsoft_saas_usage_events where status = 'rejected' and updated_at >= ${since(WINDOWS.metering)}`,
		sql`select id, surface, operation, status, latency_ms, tenant_id, conversation_id, user_id, client_id, source, error, created_at
		    from microsoft_surface_events where created_at >= ${since(WINDOWS.connector)}`,
	]);
	return {
		operations,
		usage,
		connector: surface.filter((r) => r.surface === 'power_platform'),
		teams: surface.filter((r) => r.surface === 'teams_bot' && now - new Date(r.created_at).getTime() <= WINDOWS.teams),
	};
}

/**
 * One alert pass. Dependencies are injectable so the dedup contract is tested
 * end to end without a database; production uses the defaults.
 */
export async function runMicrosoftAlerts({
	now = Date.now(),
	rows,
	store = incidentStore,
	send = sendOpsAlert,
	threshold = connectorThreshold(),
} = {}) {
	const data = rows || (await loadAlertRows(now));
	const active = detectIncidents(data, now, threshold);
	const plan = planAlerts(active, await store.listOpen());
	const sent = [];
	for (const inc of plan.open) {
		if (!(await store.open(inc))) continue;
		await send(inc.title, inc.detail, { signature: `microsoft:${inc.key}`, severity: 'critical' });
		await store.markNotified(inc.key);
		sent.push(inc.key);
	}
	await store.touch(plan.keep.map((i) => i.key));
	await store.resolve(plan.resolve.map((i) => i.key));
	return { active: active.length, opened: sent, kept: plan.keep.map((i) => i.key), resolved: plan.resolve.map((i) => i.key) };
}
