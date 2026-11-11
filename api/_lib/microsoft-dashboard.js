// The internal Microsoft partnership board (/admin/microsoft, data from
// api/admin/microsoft.js). Every number comes from a real table:
//
//   SaaS subscriptions and MRR   microsoft_saas_subscriptions x data/plans.json price_usd
//   webhook operations           microsoft_saas_operations
//   metering verdicts            microsoft_saas_usage_events
//   Teams bot and connector      microsoft_surface_events
//   Partner Center analytics     microsoft_partner_center_reports / _rows
//   alert incidents              microsoft_alert_incidents
//   Store / Edge installs        microsoft_surface_events has no such surface;
//                                nothing records installs, so the board says so.
//
// The aggregation functions are pure (rows in, panel out) so they are tested
// against fixtures shaped like the real columns; loadMicrosoftDashboard() runs
// the queries and hands the rows to them.

import { readFileSync } from 'node:fs';
import { sql } from './db.js';
import { ACK_ACTIONS, planForMicrosoftPlan, SAAS_STATUSES } from './microsoft-marketplace.js';

const PLANS = JSON.parse(readFileSync(new URL('../../data/plans.json', import.meta.url), 'utf8'));
const PRICE_BY_PLAN = Object.fromEntries((PLANS.plans || []).map((p) => [p.id, Number(p.price_usd) || 0]));

export const RUNBOOK_URL = 'https://github.com/nirholas/three.ws/blob/main/docs/ops/microsoft-dashboard.md';
export const runbook = (anchor) => `${RUNBOOK_URL}#${anchor}`;

/** Microsoft auto-accepts an InProgress ChangePlan/ChangeQuantity/Reinstate it has not heard back on in this window. */
export const ACK_DEADLINE_MS = 10_000;
/** A webhook row still 'received' after this long means the handler died before recording an outcome. */
export const STUCK_RECEIVED_MS = 60_000;
/** A purchase not activated on the landing page within this long needs a nudge. */
export const PENDING_ACTIVATION_MS = 24 * 3_600_000;

const DAY_MS = 86_400_000;
const ms = (v) => (v == null ? NaN : new Date(v).getTime());
const iso = (v) => (v == null || !Number.isFinite(ms(v)) ? null : new Date(v).toISOString());
const dayKey = (v) => new Date(ms(v)).toISOString().slice(0, 10);

/** The day keys (YYYY-MM-DD, UTC) of the last `days` days ending today, oldest first. */
export function dayKeys(now, days) {
	const end = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
	return Array.from({ length: days }, (_, i) => new Date(end - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10));
}

function emptySeries(now, days) {
	return dayKeys(now, days).map((day) => ({ day, total: 0, errors: 0 }));
}

function bump(series, at, isError) {
	const point = series.find((p) => p.day === dayKey(at));
	if (!point) return;
	point.total += 1;
	if (isError) point.errors += 1;
}

/** The monthly list price of a Microsoft plan id, from the three.ws plan it maps to. null when unmapped. */
export function priceForMicrosoftPlan(planId) {
	const plan = planForMicrosoftPlan(planId);
	return plan && Object.hasOwn(PRICE_BY_PLAN, plan) ? PRICE_BY_PLAN[plan] : null;
}

// ── SaaS subscriptions ──────────────────────────────────────────────────────

/**
 * @param {Array<{ id: string, plan_id: string|null, quantity: number|null, saas_status: string, is_test: boolean, created_at: string|Date }>} rows
 */
export function summarizeSubscriptions(rows, now = Date.now()) {
	const byStatus = Object.fromEntries(SAAS_STATUSES.map((s) => [s, 0]));
	const plans = new Map();
	const unmapped = [];
	const pendingActivation = [];
	let tests = 0;
	let mrr = 0;
	for (const r of rows) {
		if (r.is_test) {
			tests += 1;
			continue;
		}
		byStatus[r.saas_status] = (byStatus[r.saas_status] || 0) + 1;
		const key = r.plan_id || '(none)';
		const price = priceForMicrosoftPlan(r.plan_id);
		if (!plans.has(key)) plans.set(key, { plan_id: key, three_ws_plan: planForMicrosoftPlan(r.plan_id), price_usd: price, subscriptions: 0, subscribed: 0, seats: 0, mrr_usd: 0 });
		const p = plans.get(key);
		p.subscriptions += 1;
		if (r.saas_status === 'Subscribed') {
			const seats = Number(r.quantity) > 0 ? Number(r.quantity) : 1;
			p.subscribed += 1;
			p.seats += seats;
			if (price == null) unmapped.push({ id: r.id, plan_id: r.plan_id });
			else {
				p.mrr_usd += price * seats;
				mrr += price * seats;
			}
		}
		if (r.saas_status === 'PendingFulfillmentStart' && now - ms(r.created_at) > PENDING_ACTIVATION_MS) {
			pendingActivation.push({ id: r.id, plan_id: r.plan_id, created_at: iso(r.created_at) });
		}
	}
	return {
		total: rows.length - tests,
		tests,
		by_status: byStatus,
		by_plan: [...plans.values()].sort((a, b) => b.mrr_usd - a.mrr_usd || b.subscriptions - a.subscriptions),
		mrr_usd: mrr,
		unmapped_plans: unmapped,
		pending_activation: pendingActivation,
	};
}

// ── Webhook operations ──────────────────────────────────────────────────────

function needsAck(r) {
	return ACK_ACTIONS.includes(r.action) && r.status === 'InProgress';
}

/**
 * Operations received in the window. A failure is any row whose outcome is
 * 'failed'; unacknowledged is an InProgress ack-action we never answered inside
 * Microsoft's deadline, or any row the handler left at 'received'.
 * @param {Array<{ id: string, subscription_id: string, action: string, plan_id: string|null, quantity: number|null, status: string|null, outcome: string, error: string|null, received_at: string|Date, processed_at: string|Date|null }>} rows
 */
export function summarizeOperations(rows, now = Date.now(), days = 7) {
	const byAction = {};
	const byOutcome = {};
	const series = emptySeries(now, days);
	const failures = [];
	const unacknowledged = [];
	const lateAcks = [];
	for (const r of rows) {
		byAction[r.action] = (byAction[r.action] || 0) + 1;
		byOutcome[r.outcome] = (byOutcome[r.outcome] || 0) + 1;
		bump(series, r.received_at, r.outcome === 'failed');
		const record = {
			id: r.id, subscription_id: r.subscription_id, action: r.action, status: r.status,
			outcome: r.outcome, error: r.error || null, received_at: iso(r.received_at), processed_at: iso(r.processed_at),
		};
		const age = now - ms(r.received_at);
		if (r.outcome === 'failed') failures.push(record);
		const acked = r.outcome === 'acknowledged_success' || r.outcome === 'acknowledged_failure';
		if (needsAck(r) && !acked && age > ACK_DEADLINE_MS) {
			unacknowledged.push({ ...record, reason: 'ack_deadline' });
		} else if (r.outcome === 'received' && age > STUCK_RECEIVED_MS) {
			unacknowledged.push({ ...record, reason: 'stuck_received' });
		}
		if (needsAck(r) && acked && r.processed_at && ms(r.processed_at) - ms(r.received_at) > ACK_DEADLINE_MS) {
			lateAcks.push({ ...record, took_ms: ms(r.processed_at) - ms(r.received_at) });
		}
	}
	const byTimeDesc = (a, b) => ms(b.received_at) - ms(a.received_at);
	return {
		total: rows.length,
		by_action: byAction,
		by_outcome: byOutcome,
		series,
		failures: failures.sort(byTimeDesc),
		unacknowledged: unacknowledged.sort(byTimeDesc),
		late_acks: lateAcks.sort(byTimeDesc),
	};
}

// ── Metering ────────────────────────────────────────────────────────────────

/** Verdict of one usage row. The metering cron stores Microsoft's Duplicate as status 'accepted' with message 'Duplicate'. */
export function meteringVerdict(row) {
	if (row.status === 'accepted') return String(row.message || '').trim().toLowerCase() === 'duplicate' ? 'duplicate' : 'accepted';
	return row.status;
}

/**
 * @param {Array<{ id: string, subscription_id: string, plan_id: string, dimension: string, effective_start_time: string|Date, quantity: number|string, status: string, message: string|null, attempts: number, updated_at: string|Date }>} rows
 */
export function summarizeMetering(rows, now = Date.now(), days = 7) {
	const verdicts = { accepted: 0, duplicate: 0, expired: 0, rejected: 0, pending: 0 };
	const byDimension = {};
	const series = emptySeries(now, days);
	const rejected = [];
	const expired = [];
	let lastError = null;
	for (const r of rows) {
		const v = meteringVerdict(r);
		verdicts[v] = (verdicts[v] || 0) + 1;
		const dim = (byDimension[r.dimension] ||= { dimension: r.dimension, accepted_quantity: 0, events: 0 });
		dim.events += 1;
		if (v === 'accepted') dim.accepted_quantity += Number(r.quantity) || 0;
		bump(series, r.effective_start_time, v === 'rejected' || v === 'expired');
		const record = {
			id: r.id, subscription_id: r.subscription_id, plan_id: r.plan_id, dimension: r.dimension,
			effective_start_time: iso(r.effective_start_time), quantity: Number(r.quantity), verdict: v,
			message: r.message || null, attempts: r.attempts, updated_at: iso(r.updated_at),
		};
		if (v === 'rejected') rejected.push(record);
		if (v === 'expired') expired.push(record);
		if ((v === 'rejected' || v === 'expired' || (v === 'pending' && r.attempts > 0 && r.message)) &&
			(!lastError || ms(r.updated_at) > ms(lastError.updated_at))) {
			lastError = record;
		}
	}
	const byTimeDesc = (a, b) => ms(b.updated_at) - ms(a.updated_at);
	return {
		total: rows.length,
		verdicts,
		by_dimension: Object.values(byDimension),
		series,
		rejected: rejected.sort(byTimeDesc),
		expired: expired.sort(byTimeDesc),
		last_error: lastError,
	};
}

// ── Teams bot ───────────────────────────────────────────────────────────────

const TEAMS_KIND = {
	'composeExtension/query': 'search',
	'composeExtension/queryLink': 'unfurl',
	'composeExtension/anonymousQueryLink': 'unfurl',
	'adaptiveCard/action': 'card_action',
	'composeExtension/submitAction': 'card_action',
	'composeExtension/selectItem': 'card_action',
	'composeExtension/fetchTask': 'card_action',
};

/** What a Teams bot operation was: search, unfurl, card_action, or other. */
export function teamsKind(operation) {
	return TEAMS_KIND[operation] || 'other';
}

/**
 * @param {Array<{ id: number|string, operation: string, status: number, latency_ms: number|null, tenant_id: string|null, conversation_id: string|null, error: string|null, created_at: string|Date }>} rows teams_bot rows in the window
 */
export function summarizeTeams(rows, now = Date.now(), days = 30, recentDays = 7) {
	const series = emptySeries(now, days);
	const recentFrom = now - recentDays * DAY_MS;
	const kinds = { search: 0, unfurl: 0, card_action: 0, other: 0 };
	const byOperation = {};
	const tenants = new Set();
	const conversations = new Set();
	const tenantsRecent = new Set();
	const errors = [];
	let unverified = 0;
	let recent = 0;
	for (const r of rows) {
		const status = Number(r.status);
		bump(series, r.created_at, status >= 500);
		if (r.tenant_id) tenants.add(r.tenant_id);
		if (r.conversation_id) conversations.add(r.conversation_id);
		if (ms(r.created_at) < recentFrom) continue;
		recent += 1;
		if (r.tenant_id) tenantsRecent.add(r.tenant_id);
		if (status === 401 || status === 403) unverified += 1;
		kinds[teamsKind(r.operation)] += 1;
		byOperation[r.operation] = (byOperation[r.operation] || 0) + 1;
		if (status >= 500) {
			errors.push({ id: String(r.id), operation: r.operation, status, error: r.error || null, tenant_id: r.tenant_id || null, created_at: iso(r.created_at) });
		}
	}
	return {
		activities: rows.length,
		activities_recent: recent,
		tenants: tenants.size,
		active_tenants: tenantsRecent.size,
		conversations: conversations.size,
		message_extension: { search: kinds.search, unfurl: kinds.unfurl },
		card_actions: kinds.card_action,
		other: kinds.other,
		by_operation: byOperation,
		unverified,
		server_errors: errors.length,
		series,
		errors: errors.sort((a, b) => ms(b.created_at) - ms(a.created_at)),
	};
}

// ── Power Platform connector ────────────────────────────────────────────────

/** A connector call counts as an error when the API answered 5xx. 4xx (bad input, expired sign-in) is counted separately as client_errors. */
export function connectorIsError(status) {
	return Number(status) >= 500;
}

/**
 * @param {Array<{ id: number|string, operation: string, status: number, latency_ms: number|null, user_id: string|null, client_id: string|null, source: string|null, error: string|null, created_at: string|Date }>} rows power_platform rows in the window
 */
export function summarizeConnector(rows, now = Date.now(), days = 30, recentDays = 7) {
	const series = emptySeries(now, days);
	const recentFrom = now - recentDays * DAY_MS;
	const ops = new Map();
	const sources = {};
	const users = new Set();
	const errors = [];
	let calls = 0;
	let errorCount = 0;
	let clientErrors = 0;
	for (const r of rows) {
		const status = Number(r.status);
		const isErr = connectorIsError(status);
		bump(series, r.created_at, isErr);
		if (ms(r.created_at) < recentFrom) continue;
		calls += 1;
		if (isErr) errorCount += 1;
		if (status >= 400 && status < 500) clientErrors += 1;
		if (r.user_id) users.add(r.user_id);
		sources[r.source || 'unknown'] = (sources[r.source || 'unknown'] || 0) + 1;
		if (!ops.has(r.operation)) ops.set(r.operation, { operation: r.operation, calls: 0, errors: 0, client_errors: 0, latencies: [] });
		const o = ops.get(r.operation);
		o.calls += 1;
		if (isErr) o.errors += 1;
		if (status >= 400 && status < 500) o.client_errors += 1;
		if (Number.isFinite(Number(r.latency_ms)) && r.latency_ms != null) o.latencies.push(Number(r.latency_ms));
		if (isErr) errors.push({ id: String(r.id), operation: r.operation, status, error: r.error || null, source: r.source || null, created_at: iso(r.created_at) });
	}
	const byOperation = [...ops.values()].map((o) => {
		const sorted = o.latencies.sort((a, b) => a - b);
		const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] : null;
		return { operation: o.operation, calls: o.calls, errors: o.errors, client_errors: o.client_errors, error_rate: o.calls ? o.errors / o.calls : 0, p95_latency_ms: p95 };
	}).sort((a, b) => b.calls - a.calls);
	return {
		calls,
		errors: errorCount,
		client_errors: clientErrors,
		error_rate: calls ? errorCount / calls : 0,
		users: users.size,
		by_source: sources,
		by_operation: byOperation,
		series,
		failures: errors.sort((a, b) => ms(b.created_at) - ms(a.created_at)),
	};
}

// ── Partner Center analytics ────────────────────────────────────────────────

/**
 * @param {Array<{ dataset: string, report_id: string|null, last_generated_at: any, last_ingested_at: any, last_row_count: number|null, last_error: string|null, updated_at: any }>} reports
 * @param {Array<{ dataset: string, rows: number|string, customers: number|string, revenue: number|string|null, currency: string|null, latest: any }>} totals per dataset
 */
export function summarizePartnerCenter(reports, totals, { configured }) {
	const datasets = ['orders', 'usage', 'customers'].map((name) => {
		const rep = reports.find((r) => r.dataset === name) || null;
		const tot = totals.find((t) => t.dataset === name) || null;
		return {
			dataset: name,
			report_id: rep?.report_id || null,
			last_generated_at: iso(rep?.last_generated_at),
			last_ingested_at: iso(rep?.last_ingested_at),
			last_row_count: rep?.last_row_count ?? null,
			last_error: rep?.last_error || null,
			rows: Number(tot?.rows || 0),
			customers: Number(tot?.customers || 0),
			revenue: tot?.revenue == null ? null : Number(tot.revenue),
			currency: tot?.currency || null,
			latest_event: iso(tot?.latest),
		};
	});
	return { configured, datasets, errors: datasets.filter((d) => d.last_error) };
}

// ── What needs attention ────────────────────────────────────────────────────

/**
 * The ordered list at the top of the board. Each item names the record and
 * links the runbook section that says what to do.
 */
export function attentionList({ subscriptions, operations, metering, teams, connector, partnerCenter, incidents, config, connectorThreshold }) {
	const items = [];
	const add = (severity, kind, title, detail, anchor, record = null) => items.push({ severity, kind, title, detail, runbook: runbook(anchor), record });
	for (const op of operations.unacknowledged) {
		add('critical', 'webhook_unacknowledged',
			op.reason === 'ack_deadline' ? `${op.action} not acknowledged inside ${ACK_DEADLINE_MS / 1000}s` : `${op.action} webhook stuck at 'received'`,
			`Operation ${op.id} on subscription ${op.subscription_id}, received ${op.received_at}.`, 'webhook-unacknowledged', op);
	}
	for (const op of operations.failures) {
		add('critical', 'webhook_failed', `${op.action} webhook failed`, `Operation ${op.id}: ${op.error || 'no error recorded'}`, 'webhook-failed', op);
	}
	for (const ev of metering.rejected) {
		add('critical', 'metering_rejected', `Metering rejected for ${ev.dimension}`, `Subscription ${ev.subscription_id}, hour ${ev.effective_start_time}: ${ev.message || 'no message'}`, 'metering-rejected', ev);
	}
	if (metering.expired.length) {
		const ev = metering.expired[0];
		add('warning', 'metering_expired', `${metering.expired.length} metering event${metering.expired.length === 1 ? '' : 's'} expired unbilled`, `Latest: ${ev.dimension} on ${ev.subscription_id}, hour ${ev.effective_start_time}.`, 'metering-expired', ev);
	}
	if (teams.server_errors) {
		const e = teams.errors[0];
		add('critical', 'teams_5xx', `Teams bot answered 5xx ${teams.server_errors} time${teams.server_errors === 1 ? '' : 's'} this week`, `Latest: ${e.operation} at ${e.created_at}: ${e.error || 'no error recorded'}`, 'teams-5xx', e);
	}
	if (connector.calls >= connectorThreshold.minCalls && connector.error_rate > connectorThreshold.rate) {
		add('critical', 'connector_error_rate', `Connector error rate ${(connector.error_rate * 100).toFixed(1)}%`, `${connector.errors} of ${connector.calls} calls failed this week (threshold ${(connectorThreshold.rate * 100).toFixed(1)}%).`, 'connector-error-rate', connector.failures[0] || null);
	}
	for (const s of subscriptions.unmapped_plans) {
		add('warning', 'unmapped_plan', `Subscribed on unknown plan ${s.plan_id}`, `Subscription ${s.id} earns no MRR because data/microsoft-marketplace.json has no mapping for ${s.plan_id}.`, 'unmapped-plan', s);
	}
	for (const s of subscriptions.pending_activation) {
		add('warning', 'pending_activation', 'Purchase not activated', `Subscription ${s.id} (${s.plan_id}) has waited since ${s.created_at} for the buyer to finish the landing page.`, 'pending-activation', s);
	}
	for (const d of partnerCenter.errors) {
		add('warning', 'partner_center_error', `Partner Center ${d.dataset} ingest failed`, d.last_error, 'partner-center-ingest', d);
	}
	if (config.missing.length) {
		add('info', 'config_missing', 'Marketplace not configured in this environment', `Missing: ${config.missing.join(', ')}`, 'configuration', null);
	}
	const known = new Set(items.map((i) => i.kind));
	for (const inc of incidents.open) {
		if (!known.has(inc.kind)) add('warning', inc.kind, `Open incident: ${inc.title}`, inc.detail || '', inc.kind.replace(/_/g, '-'), inc);
	}
	const rank = { critical: 0, warning: 1, info: 2 };
	return items.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

// ── Loader ──────────────────────────────────────────────────────────────────

export const SURFACE_ROW_LIMIT = 50_000;

/** Connector error-rate alert threshold: MS_ALERT_CONNECTOR_ERROR_RATE (fraction) over at least MS_ALERT_CONNECTOR_MIN_CALLS calls. */
export function connectorThreshold(env = process.env) {
	const rate = Number(env.MS_ALERT_CONNECTOR_ERROR_RATE);
	const minCalls = Number(env.MS_ALERT_CONNECTOR_MIN_CALLS);
	return {
		rate: Number.isFinite(rate) && rate >= 0 ? rate : 0.05,
		minCalls: Number.isFinite(minCalls) && minCalls >= 1 ? Math.floor(minCalls) : 20,
	};
}

/** Run every query and build the board. `config` is { missing: string[], partnerCenterConfigured: boolean }. */
export async function loadMicrosoftDashboard({ now = Date.now(), config }) {
	const since7 = new Date(now - 7 * DAY_MS);
	const since30 = new Date(now - 30 * DAY_MS);
	const [subs, ops, usage, surface, pcReports, pcTotals, openIncidents, recentIncidents] = await Promise.all([
		sql`select id, plan_id, quantity, saas_status, is_test, created_at from microsoft_saas_subscriptions`,
		sql`select id, subscription_id, action, plan_id, quantity, status, outcome, error, received_at, processed_at
		    from microsoft_saas_operations where received_at >= ${since7} order by received_at desc`,
		sql`select id, subscription_id, plan_id, dimension, effective_start_time, quantity, status, message, attempts, updated_at
		    from microsoft_saas_usage_events where effective_start_time >= ${since7} or (status in ('rejected', 'expired') and updated_at >= ${since7})`,
		sql`select id, surface, operation, status, latency_ms, tenant_id, conversation_id, user_id, client_id, source, error, created_at
		    from microsoft_surface_events where created_at >= ${since30} order by created_at desc limit ${SURFACE_ROW_LIMIT}`,
		sql`select dataset, report_id, last_generated_at, last_ingested_at, last_row_count, last_error, updated_at from microsoft_partner_center_reports`,
		sql`select dataset, count(*)::int as rows, count(distinct customer_id)::int as customers,
		           sum(amount) as revenue, max(currency) as currency, max(event_date) as latest
		    from microsoft_partner_center_rows group by dataset`,
		sql`select key, kind, title, detail, opened_at, last_seen_at, notified_at, occurrences
		    from microsoft_alert_incidents where resolved_at is null order by opened_at desc`,
		sql`select key, kind, title, opened_at, resolved_at, occurrences
		    from microsoft_alert_incidents where resolved_at >= ${since30} order by resolved_at desc limit 20`,
	]);
	const subscriptions = summarizeSubscriptions(subs, now);
	const operations = summarizeOperations(ops, now, 7);
	const metering = summarizeMetering(usage, now, 7);
	const teams = summarizeTeams(surface.filter((r) => r.surface === 'teams_bot'), now, 30, 7);
	const connector = summarizeConnector(surface.filter((r) => r.surface === 'power_platform'), now, 30, 7);
	const partnerCenter = summarizePartnerCenter(pcReports, pcTotals, { configured: config.partnerCenterConfigured });
	const incidents = {
		open: openIncidents.map((i) => ({ ...i, opened_at: iso(i.opened_at), last_seen_at: iso(i.last_seen_at), notified_at: iso(i.notified_at) })),
		resolved: recentIncidents.map((i) => ({ ...i, opened_at: iso(i.opened_at), resolved_at: iso(i.resolved_at) })),
	};
	const threshold = connectorThreshold();
	return {
		generated_at: new Date(now).toISOString(),
		config: { marketplace_missing: config.missing, partner_center_configured: config.partnerCenterConfigured },
		attention: attentionList({ subscriptions, operations, metering, teams, connector, partnerCenter, incidents, config, connectorThreshold: threshold }),
		kpis: {
			mrr_usd: subscriptions.mrr_usd,
			subscribed: subscriptions.by_status.Subscribed || 0,
			webhook_failures_7d: operations.failures.length + operations.unacknowledged.length,
			metering_accepted_7d: metering.verdicts.accepted,
			metering_rejected_7d: metering.verdicts.rejected,
			teams_active_tenants_7d: teams.active_tenants,
			teams_conversations_30d: teams.conversations,
			connector_calls_7d: connector.calls,
			connector_error_rate_7d: connector.error_rate,
		},
		subscriptions,
		operations,
		metering,
		teams,
		connector,
		connector_threshold: threshold,
		installs: {
			recorded: false,
			note: 'No three.ws table records Microsoft Store or Edge Add-ons installs. Both stores report acquisitions in Partner Center (Apps and games > Analytics) and that is where to read them.',
		},
		partner_center: partnerCenter,
		incidents,
		truncated: surface.length >= SURFACE_ROW_LIMIT,
	};
}
