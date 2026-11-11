// Microsoft partnership operations board: /admin/microsoft.
//
// A read-only client of GET /api/admin/microsoft. The endpoint authorizes
// (admin session or ops secret) and does every aggregation server-side in
// api/_lib/microsoft-dashboard.js, so this file only renders: the attention
// list first, then the KPI row, then one panel per surface with a daily
// series, the failure tables (each row is the exact database record) and a
// runbook link per failure type.

import { apiFetch } from './api.js';

const app = document.getElementById('msa-app');
const attentionEl = document.getElementById('msa-attention');
const kpisEl = document.getElementById('msa-kpis');
const panelsEl = document.getElementById('msa-panels');
const updatedEl = document.getElementById('msa-updated');
const refreshBtn = document.getElementById('msa-refresh');
const tooltip = document.getElementById('msa-tooltip');

const RUNBOOK = 'https://github.com/nirholas/three.ws/blob/main/docs/ops/microsoft-dashboard.md';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (n) => Number(n || 0).toLocaleString('en-US');
const usd = (n) => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const pct = (r) => `${(Number(r || 0) * 100).toFixed(1)}%`;
const fmtDate = (v) => {
	if (!v) return 'never';
	const d = new Date(v);
	return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const shortDay = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const runbookLink = (anchor, label = 'Runbook') => `<a class="msa-link" href="${RUNBOOK}#${esc(anchor)}" target="_blank" rel="noopener">${esc(label)}</a>`;

const SEVERITY = {
	critical: { label: 'Critical', icon: '<path d="M8 1.5 15 14H1z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 6v3.5M8 11.6v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' },
	warning: { label: 'Warning', icon: '<circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 4.5v4M8 11.2v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' },
	info: { label: 'Info', icon: '<circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 7.2v4M8 4.8v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' },
};

// ── chart ───────────────────────────────────────────────────────────────────

/**
 * Daily bars: the day's total in the series colour with the failing share
 * stacked on top in the danger colour, separated by a 2px surface gap. One
 * axis, a recessive baseline, a legend, a hover/focus tooltip per day and a
 * table view of the same numbers.
 */
function barChart(series, { label, totalLabel, errorLabel }) {
	const max = Math.max(1, ...series.map((p) => p.total));
	const total = series.reduce((s, p) => s + p.total, 0);
	const errors = series.reduce((s, p) => s + p.errors, 0);
	const W = 600, H = 120, pad = 4;
	const slot = W / series.length;
	const bw = Math.max(2, Math.min(18, slot - 4));
	const bars = series.map((p, i) => {
		const x = i * slot + (slot - bw) / 2;
		const okH = ((p.total - p.errors) / max) * (H - pad);
		const errH = (p.errors / max) * (H - pad);
		const gap = okH > 0 && errH > 0 ? 2 : 0;
		const ok = okH > 0 ? `<rect class="msa-bar" x="${x}" y="${H - okH}" width="${bw}" height="${okH}" rx="${Math.min(2, bw / 2)}"/>` : '';
		const err = errH > 0 ? `<rect class="msa-bar-err" x="${x}" y="${H - okH - gap - errH}" width="${bw}" height="${errH}" rx="${Math.min(2, bw / 2)}"/>` : '';
		const tip = `${shortDay(p.day)}: ${num(p.total)} ${totalLabel}${p.errors ? `, ${num(p.errors)} ${errorLabel}` : ''}`;
		return `<g class="msa-col" tabindex="0" data-tip="${esc(tip)}" aria-label="${esc(tip)}">
			<rect class="msa-hit" x="${i * slot}" y="0" width="${slot}" height="${H}"/>${ok}${err}</g>`;
	}).join('');
	const summary = `${label}: ${num(total)} ${totalLabel} over ${series.length} days, ${num(errors)} ${errorLabel}.`;
	const rows = series.map((p) => `<tr><td>${esc(p.day)}</td><td class="msa-num">${num(p.total)}</td><td class="msa-num">${num(p.errors)}</td></tr>`).join('');
	return `<figure class="msa-chart">
		<div class="msa-legend" aria-hidden="true">
			<span><i class="msa-swatch msa-swatch-ok"></i>${esc(totalLabel)}</span>
			<span><i class="msa-swatch msa-swatch-err"></i>${esc(errorLabel)}</span>
			<span class="msa-legend-max">peak ${num(max)}/day</span>
		</div>
		<svg viewBox="0 0 ${W} ${H + 1}" preserveAspectRatio="none" role="img" aria-label="${esc(summary)}">
			<line class="msa-axis" x1="0" x2="${W}" y1="${H + 0.5}" y2="${H + 0.5}"/>${bars}
		</svg>
		<div class="msa-xaxis" aria-hidden="true"><span>${esc(shortDay(series[0].day))}</span><span>${esc(shortDay(series[series.length - 1].day))}</span></div>
		<details class="msa-details"><summary>Table view</summary>
			<div class="msa-table-wrap"><table class="msa-table"><thead><tr><th>Day (UTC)</th><th class="msa-num">${esc(totalLabel)}</th><th class="msa-num">${esc(errorLabel)}</th></tr></thead><tbody>${rows}</tbody></table></div>
		</details>
	</figure>`;
}

// ── building blocks ─────────────────────────────────────────────────────────

function table(columns, rows, { empty, anchor } = {}) {
	if (!rows.length) return `<p class="msa-empty-row">${esc(empty)}</p>`;
	const head = columns.map((c) => `<th${c.num ? ' class="msa-num"' : ''}>${esc(c.label)}</th>`).join('');
	const body = rows.map((r) => `<tr>${columns.map((c) => {
		const v = c.value(r);
		return `<td${c.num ? ' class="msa-num"' : c.mono ? ' class="msa-mono"' : ''}>${c.html ? v : esc(v)}</td>`;
	}).join('')}${anchor ? `<td>${runbookLink(anchor)}</td>` : ''}</tr>`).join('');
	return `<div class="msa-table-wrap"><table class="msa-table"><thead><tr>${head}${anchor ? '<th><span class="msa-sr">Runbook</span></th>' : ''}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function stats(list) {
	return `<dl class="msa-stats">${list.map(([k, v, tone]) => `<div${tone ? ` data-tone="${tone}"` : ''}><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
}

function panel(id, title, sub, body, empty) {
	return `<section class="msa-panel" aria-labelledby="${id}">
		<header class="msa-panel-head"><h2 class="msa-h2" id="${id}">${esc(title)}</h2>${sub ? `<p class="msa-sub">${sub}</p>` : ''}</header>
		${empty ? `<div class="msa-empty">${empty}</div>` : ''}${body}
	</section>`;
}

const recordDetails = (record) => record
	? `<details class="msa-details"><summary>Record</summary><pre class="msa-pre">${esc(JSON.stringify(record, null, 2))}</pre></details>`
	: '';

// ── sections ────────────────────────────────────────────────────────────────

function renderAttention(items) {
	if (!items.length) {
		attentionEl.innerHTML = `<div class="msa-clear" role="status"><strong>Nothing needs attention.</strong> No unacknowledged webhooks, metering rejections, Teams 5xx or connector error spikes, and every Partner Center dataset ingested cleanly.</div>`;
		return;
	}
	attentionEl.innerHTML = `<ul class="msa-attention">${items.map((it) => {
		const s = SEVERITY[it.severity] || SEVERITY.info;
		return `<li class="msa-att" data-severity="${esc(it.severity)}">
			<span class="msa-sev"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${s.icon}</svg>${s.label}</span>
			<div class="msa-att-body">
				<p class="msa-att-title">${esc(it.title)}</p>
				<p class="msa-att-detail">${esc(it.detail)}</p>
				${recordDetails(it.record)}
			</div>
			<a class="msa-btn msa-btn-ghost" href="${esc(it.runbook)}" target="_blank" rel="noopener">What to do</a>
		</li>`;
	}).join('')}</ul>`;
}

function renderKpis(k, threshold) {
	const tiles = [
		['MRR', usd(k.mrr_usd), 'Subscribed seats x list price'],
		['Subscribed', num(k.subscribed), 'Live Marketplace subscriptions'],
		['Webhook failures', num(k.webhook_failures_7d), 'Failed or unacknowledged, 7 days', k.webhook_failures_7d ? 'danger' : null],
		['Metering accepted', num(k.metering_accepted_7d), 'Usage events, 7 days'],
		['Metering rejected', num(k.metering_rejected_7d), 'Usage events, 7 days', k.metering_rejected_7d ? 'danger' : null],
		['Teams tenants', num(k.teams_active_tenants_7d), 'Active tenants, 7 days'],
		['Teams conversations', num(k.teams_conversations_30d), 'Distinct, 30 days'],
		['Connector calls', num(k.connector_calls_7d), 'Power Platform, 7 days'],
		['Connector errors', pct(k.connector_error_rate_7d), `5xx rate, 7 days (alert over ${pct(threshold.rate)})`, k.connector_error_rate_7d > threshold.rate ? 'danger' : null],
	];
	kpisEl.innerHTML = tiles.map(([label, value, hint, tone]) => `<div class="msa-kpi"${tone ? ` data-tone="${tone}"` : ''}>
		<p class="msa-kpi-label">${esc(label)}</p><p class="msa-kpi-value">${esc(value)}</p><p class="msa-kpi-hint">${esc(hint)}</p></div>`).join('');
}

function subscriptionsPanel(s, missing) {
	const empty = s.total === 0
		? `<strong>No Marketplace subscriptions yet.</strong> Rows appear here when a buyer purchases three.ws on Microsoft Marketplace and the landing page resolves the token.${missing.length ? ` This environment is missing ${esc(missing.join(', '))}, so purchases cannot resolve here yet. ${runbookLink('configuration', 'Configuration')}` : ''}`
		: '';
	const body = `${stats([
		['Total', num(s.total)], ['Pending start', num(s.by_status.PendingFulfillmentStart)], ['Subscribed', num(s.by_status.Subscribed)],
		['Suspended', num(s.by_status.Suspended), s.by_status.Suspended ? 'warn' : null], ['Unsubscribed', num(s.by_status.Unsubscribed)], ['Test rows excluded', num(s.tests)],
	])}
	${s.by_plan.length ? table([
		{ label: 'Microsoft plan', value: (r) => r.plan_id, mono: true },
		{ label: 'three.ws plan', value: (r) => r.three_ws_plan || 'unmapped' },
		{ label: 'List price', value: (r) => (r.price_usd == null ? 'n/a' : usd(r.price_usd)), num: true },
		{ label: 'Subscriptions', value: (r) => num(r.subscriptions), num: true },
		{ label: 'Seats', value: (r) => num(r.seats), num: true },
		{ label: 'MRR', value: (r) => usd(r.mrr_usd), num: true },
	], s.by_plan) : ''}
	${s.unmapped_plans.length ? `<h3 class="msa-h3">Unmapped plans</h3>${table([
		{ label: 'Subscription', value: (r) => r.id, mono: true }, { label: 'Plan', value: (r) => r.plan_id, mono: true },
	], s.unmapped_plans, { anchor: 'unmapped-plan' })}` : ''}
	${s.pending_activation.length ? `<h3 class="msa-h3">Waiting on the buyer over 24 hours</h3>${table([
		{ label: 'Subscription', value: (r) => r.id, mono: true }, { label: 'Plan', value: (r) => r.plan_id, mono: true }, { label: 'Purchased', value: (r) => fmtDate(r.created_at) },
	], s.pending_activation, { anchor: 'pending-activation' })}` : ''}`;
	return panel('msa-p-subs', 'SaaS subscriptions', `MRR ${esc(usd(s.mrr_usd))} from <code>data/plans.json</code> list prices`, s.total ? body : '', empty);
}

function operationsPanel(o) {
	const empty = o.total === 0
		? `<strong>No webhook operations in 7 days.</strong> Microsoft calls <code>/api/microsoft-marketplace/webhook</code> on every plan change, seat change, suspend, reinstate and unsubscribe. Each call lands here with its outcome.`
		: '';
	const opCols = [
		{ label: 'Received', value: (r) => fmtDate(r.received_at) },
		{ label: 'Action', value: (r) => r.action },
		{ label: 'Operation', value: (r) => r.id, mono: true },
		{ label: 'Subscription', value: (r) => r.subscription_id, mono: true },
		{ label: 'Outcome', value: (r) => r.outcome },
	];
	const body = `${barChart(o.series, { label: 'Webhook operations', totalLabel: 'operations', errorLabel: 'failed' })}
	${stats(Object.entries(o.by_action).map(([k, v]) => [k, num(v)]).concat(Object.entries(o.by_outcome).map(([k, v]) => [`outcome ${k}`, num(v), k === 'failed' ? 'danger' : null])))}
	<h3 class="msa-h3">Unacknowledged</h3>
	${table([...opCols, { label: 'Why', value: (r) => (r.reason === 'ack_deadline' ? 'past the 10s ack deadline' : "stuck at 'received'") }], o.unacknowledged, { empty: 'Every ChangePlan, ChangeQuantity and Reinstate was acknowledged in time.', anchor: 'webhook-unacknowledged' })}
	<h3 class="msa-h3">Failed</h3>
	${table([...opCols, { label: 'Error', value: (r) => r.error || 'none recorded' }], o.failures, { empty: 'No failed webhook operations in 7 days.', anchor: 'webhook-failed' })}
	${o.late_acks.length ? `<h3 class="msa-h3">Acknowledged late</h3>${table([...opCols, { label: 'Took', value: (r) => `${(r.took_ms / 1000).toFixed(1)}s`, num: true }], o.late_acks, { anchor: 'webhook-unacknowledged' })}` : ''}`;
	return panel('msa-p-ops', 'Webhook operations', '7 days, from <code>microsoft_saas_operations</code>', o.total ? body : '', empty);
}

function meteringPanel(m) {
	const v = m.verdicts;
	const empty = m.total === 0
		? `<strong>No metering events in 7 days.</strong> The hourly metering cron reports each subscription's usage dimensions to Microsoft. Events appear once a subscribed tenant uses a metered feature.`
		: '';
	const evCols = [
		{ label: 'Hour', value: (r) => fmtDate(r.effective_start_time) },
		{ label: 'Dimension', value: (r) => r.dimension, mono: true },
		{ label: 'Subscription', value: (r) => r.subscription_id, mono: true },
		{ label: 'Qty', value: (r) => num(r.quantity), num: true },
		{ label: 'Attempts', value: (r) => num(r.attempts), num: true },
		{ label: 'Message', value: (r) => r.message || 'none' },
	];
	const body = `${barChart(m.series, { label: 'Metering events', totalLabel: 'events', errorLabel: 'rejected or expired' })}
	${stats([['Accepted', num(v.accepted)], ['Duplicate', num(v.duplicate)], ['Expired', num(v.expired), v.expired ? 'warn' : null], ['Rejected', num(v.rejected), v.rejected ? 'danger' : null], ['Pending', num(v.pending)]])}
	${m.last_error ? `<div class="msa-callout"><p><strong>Last error</strong> ${esc(m.last_error.verdict)} on ${esc(m.last_error.dimension)} at ${esc(fmtDate(m.last_error.updated_at))}: ${esc(m.last_error.message || 'no message')}</p>${recordDetails(m.last_error)}</div>` : ''}
	${m.by_dimension.length ? table([
		{ label: 'Dimension', value: (r) => r.dimension, mono: true }, { label: 'Events', value: (r) => num(r.events), num: true }, { label: 'Accepted quantity', value: (r) => num(r.accepted_quantity), num: true },
	], m.by_dimension) : ''}
	<h3 class="msa-h3">Rejected</h3>
	${table(evCols, m.rejected, { empty: 'Microsoft rejected no usage events in 7 days.', anchor: 'metering-rejected' })}
	<h3 class="msa-h3">Expired unbilled</h3>
	${table(evCols, m.expired, { empty: 'Every event was reported inside the 24 hour window.', anchor: 'metering-expired' })}`;
	return panel('msa-p-meter', 'Metering', '7 days, from <code>microsoft_saas_usage_events</code>', m.total ? body : '', empty);
}

function teamsPanel(t) {
	const empty = t.activities === 0
		? `<strong>No Teams bot activity in 30 days.</strong> Every activity Teams sends to <code>/api/microsoft-teams/messages</code> is recorded here: messages, message-extension searches, link unfurls and card actions. Install the three.ws app in a Teams tenant to see it.`
		: '';
	const body = `${barChart(t.series, { label: 'Teams bot activities', totalLabel: 'activities', errorLabel: '5xx' })}
	${stats([
		['Activities, 7d', num(t.activities_recent)], ['Active tenants, 7d', num(t.active_tenants)], ['Tenants, 30d', num(t.tenants)],
		['Conversations, 30d', num(t.conversations)], ['Extension searches', num(t.message_extension.search)], ['Link unfurls', num(t.message_extension.unfurl)],
		['Card actions', num(t.card_actions)], ['Other', num(t.other)], ['Unverified (401/403)', num(t.unverified), t.unverified ? 'warn' : null],
	])}
	<h3 class="msa-h3">5xx responses, 7 days</h3>
	${table([
		{ label: 'When', value: (r) => fmtDate(r.created_at) }, { label: 'Operation', value: (r) => r.operation, mono: true },
		{ label: 'Status', value: (r) => r.status, num: true }, { label: 'Tenant', value: (r) => r.tenant_id || 'unknown', mono: true }, { label: 'Error', value: (r) => r.error || 'none recorded' },
	], t.errors, { empty: 'The bot answered every activity without a server error.', anchor: 'teams-5xx' })}`;
	return panel('msa-p-teams', 'Teams bot', '30 days, from <code>microsoft_surface_events</code>', t.activities ? body : '', empty);
}

function connectorPanel(c, threshold) {
	const empty = c.calls === 0 && c.series.every((p) => p.total === 0)
		? `<strong>No Power Platform connector calls in 30 days.</strong> Calls are recorded when a Power Automate flow or Power App calls the three.ws API through the certified connector, identified by its <code>X-Threews-Client</code> header.`
		: '';
	const body = `${barChart(c.series, { label: 'Connector calls', totalLabel: 'calls', errorLabel: '5xx' })}
	${stats([
		['Calls, 7d', num(c.calls)], ['5xx', num(c.errors), c.errors ? 'danger' : null], ['Error rate', pct(c.error_rate), c.error_rate > threshold.rate ? 'danger' : null],
		['4xx', num(c.client_errors)], ['Users', num(c.users)], ['Alert threshold', `${pct(threshold.rate)} over ${threshold.minCalls}+ calls/h`],
	])}
	${table([
		{ label: 'Operation', value: (r) => r.operation, mono: true }, { label: 'Calls', value: (r) => num(r.calls), num: true },
		{ label: '5xx', value: (r) => num(r.errors), num: true }, { label: '4xx', value: (r) => num(r.client_errors), num: true },
		{ label: 'Error rate', value: (r) => pct(r.error_rate), num: true }, { label: 'p95', value: (r) => (r.p95_latency_ms == null ? 'n/a' : `${num(r.p95_latency_ms)} ms`), num: true },
	], c.by_operation, { empty: 'No connector calls in the last 7 days.' })}
	<h3 class="msa-h3">Failures, 7 days</h3>
	${table([
		{ label: 'When', value: (r) => fmtDate(r.created_at) }, { label: 'Operation', value: (r) => r.operation, mono: true },
		{ label: 'Status', value: (r) => r.status, num: true }, { label: 'Event', value: (r) => r.id, mono: true }, { label: 'Error', value: (r) => r.error || 'none recorded' },
	], c.failures, { empty: 'No connector call answered 5xx.', anchor: 'connector-error-rate' })}`;
	return panel('msa-p-conn', 'Power Platform connector', '30 days, from <code>microsoft_surface_events</code>', empty ? '' : body, empty);
}

function partnerCenterPanel(pc) {
	const empty = !pc.configured
		? `<strong>Partner Center ingestion is not configured here.</strong> The daily cron needs the <code>MS_MARKETPLACE_*</code> publisher credentials and the Entra app added in Partner Center with the Manager role. ${runbookLink('partner-center-ingest', 'Setup steps')}`
		: '';
	const body = table([
		{ label: 'Dataset', value: (r) => r.dataset },
		{ label: 'Rows', value: (r) => num(r.rows), num: true },
		{ label: 'Customers', value: (r) => num(r.customers), num: true },
		{ label: 'Revenue', value: (r) => (r.revenue == null ? 'n/a' : `${Number(r.revenue).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${r.currency || ''}`), num: true },
		{ label: 'Latest event', value: (r) => r.latest_event ? fmtDate(r.latest_event) : 'none' },
		{ label: 'Last ingest', value: (r) => fmtDate(r.last_ingested_at) },
		{ label: 'Status', value: (r) => (r.last_error ? `<span class="msa-bad">${esc(r.last_error)}</span>` : r.report_id ? (r.last_ingested_at ? 'ingested' : 'waiting for the first daily run') : 'not scheduled'), html: true },
	], pc.datasets);
	return panel('msa-p-pc', 'Partner Center analytics', 'Orders, metered usage and customers, ingested daily', body, empty);
}

function incidentsPanel(inc, installs) {
	const open = table([
		{ label: 'Opened', value: (r) => fmtDate(r.opened_at) }, { label: 'Incident', value: (r) => r.title },
		{ label: 'Seen', value: (r) => `${num(r.occurrences)}x`, num: true }, { label: 'Notified', value: (r) => fmtDate(r.notified_at) },
		{ label: 'Runbook', value: (r) => runbookLink(r.kind.replace(/_/g, '-')), html: true },
	], inc.open, { empty: 'No open incidents. The alert cron checks every 5 minutes and sends one message per new incident.' });
	const resolved = table([
		{ label: 'Opened', value: (r) => fmtDate(r.opened_at) }, { label: 'Resolved', value: (r) => fmtDate(r.resolved_at) },
		{ label: 'Incident', value: (r) => r.title }, { label: 'Seen', value: (r) => `${num(r.occurrences)}x`, num: true },
	], inc.resolved, { empty: 'No incidents resolved in the last 30 days.' });
	return panel('msa-p-inc', 'Alert incidents', 'From <code>microsoft_alert_incidents</code>', `<h3 class="msa-h3">Open</h3>${open}<h3 class="msa-h3">Resolved, 30 days</h3>${resolved}
		<h3 class="msa-h3">Store and Edge installs</h3><p class="msa-note">${esc(installs.note)}</p>`);
}

// ── load ────────────────────────────────────────────────────────────────────

function render(board) {
	renderAttention(board.attention);
	renderKpis(board.kpis, board.connector_threshold);
	panelsEl.innerHTML = [
		subscriptionsPanel(board.subscriptions, board.config.marketplace_missing),
		operationsPanel(board.operations),
		meteringPanel(board.metering),
		teamsPanel(board.teams),
		connectorPanel(board.connector, board.connector_threshold),
		partnerCenterPanel(board.partner_center),
		incidentsPanel(board.incidents, board.installs),
	].join('');
	if (board.truncated) panelsEl.insertAdjacentHTML('afterbegin', `<p class="msa-callout msa-wide">Surface events were capped at the newest 50,000 rows for 30 days, so Teams and connector totals undercount.</p>`);
	updatedEl.textContent = `Updated ${fmtDate(board.generated_at)}`;
}

function errorState(err) {
	const status = err.status || 0;
	const body = status === 401 || status === 403
		? '<strong>Admin access required</strong>Sign in with a platform admin account, then refresh.'
		: status === 429
			? '<strong>Too many requests</strong>Wait a few seconds, then refresh.'
			: status === 503
				? '<strong>The board needs a configured database</strong>This deployment has no <code>DATABASE_URL</code>, so there is nothing to show.'
				: `<strong>Could not load the board</strong>${esc(err.message)}. Retry, and if it persists check the API logs for <code>/api/admin/microsoft</code>.`;
	attentionEl.innerHTML = `<div class="msa-state" role="alert">${body}<button type="button" class="msa-btn" data-retry>Retry</button></div>`;
	kpisEl.innerHTML = '';
	panelsEl.innerHTML = '';
	updatedEl.textContent = 'Not loaded';
}

let loading = false;
async function load() {
	if (loading) return;
	loading = true;
	app.setAttribute('aria-busy', 'true');
	refreshBtn.disabled = true;
	updatedEl.textContent = 'Loading live data';
	try {
		const res = await apiFetch('/api/admin/microsoft', { cache: 'no-store' });
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			const e = new Error(data.error_description || data.error || `HTTP ${res.status}`);
			e.status = res.status;
			throw e;
		}
		render(data);
	} catch (err) {
		errorState(err);
	} finally {
		loading = false;
		app.setAttribute('aria-busy', 'false');
		refreshBtn.disabled = false;
	}
}

// ── interaction ─────────────────────────────────────────────────────────────

function showTip(target) {
	const tip = target.closest('[data-tip]');
	if (!tip) return;
	tooltip.textContent = tip.dataset.tip;
	tooltip.hidden = false;
	const r = tip.getBoundingClientRect();
	const t = tooltip.getBoundingClientRect();
	const left = Math.min(window.innerWidth - t.width - 8, Math.max(8, r.left + r.width / 2 - t.width / 2));
	tooltip.style.left = `${left}px`;
	tooltip.style.top = `${Math.max(8, r.top - t.height - 8)}px`;
}
const hideTip = () => { tooltip.hidden = true; };

panelsEl.addEventListener('pointerover', (e) => showTip(e.target));
panelsEl.addEventListener('pointerout', (e) => { if (e.target.closest('[data-tip]')) hideTip(); });
panelsEl.addEventListener('focusin', (e) => showTip(e.target));
panelsEl.addEventListener('focusout', hideTip);
window.addEventListener('scroll', hideTip, { passive: true });
attentionEl.addEventListener('click', (e) => { if (e.target.closest('[data-retry]')) load(); });
refreshBtn.addEventListener('click', load);

load();
