// Spend page (pages/spend.html, route /spend, deep link /spend?agent=<id>).
//
// One read of GET /api/me/spend (api/spend/me.js) drives everything: totals
// and the month-end projection, the 50/80/100 percent cap alerts, one card
// per agent with its dollar and token cap meters, the pause banner with
// Resume and Extend once, the cap editor, and the by-day, by-model and
// by-tool breakdowns. Cap writes go to the agent's own routes:
//   PATCH /api/agents/:id                     { inferenceBudget: { daily, monthly } }
//   PUT   /api/agents/:id/token-budget        { hourly, daily, per_run }
//   POST  /api/agents/:id/token-budget/resume
//   POST  /api/agents/:id/token-budget/extend { window?, extra_tokens? }
// Doc: docs/inference-billing.md.

import { apiFetch } from './api.js';
import { escNotif as esc, relTime } from './notifications.js';

const WINDOW_LABEL = { hour: 'Hourly', day: 'Daily', month: 'Monthly', run: 'Per run' };
const WINDOW_NOUN = { hour: 'this hour', day: 'today', month: 'this month', run: 'this run' };

const els = {};
const state = {
	data: null,
	agent: '',
	days: 30,
	editing: new Set(),
	busy: new Set(),
	formMsg: new Map(),
};

function q(id) { return document.getElementById(id); }

function usd(n, { compact = false } = {}) {
	const v = Number(n) || 0;
	if (compact && v >= 1000) return `$${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}k`;
	if (v > 0 && v < 0.01) return `$${v.toFixed(4)}`;
	return `$${v.toFixed(2)}`;
}

function tokens(n) {
	const v = Number(n) || 0;
	if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
	if (v >= 1_000) return `${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}k`;
	return String(v);
}

function amount(n, unit) {
	return unit === 'usd' ? usd(n) : `${tokens(n)} tokens`;
}

function tone(pct) {
	if (pct == null) return '';
	if (pct >= 100) return 'is-100';
	if (pct >= 80) return 'is-80';
	if (pct >= 50) return 'is-50';
	return '';
}

function resetCopy(iso) {
	if (!iso) return '';
	const ms = new Date(iso).getTime() - Date.now();
	if (!Number.isFinite(ms)) return '';
	if (ms <= 0) return 'resets now';
	const h = Math.floor(ms / 3_600_000);
	const m = Math.floor((ms % 3_600_000) / 60_000);
	if (h >= 48) return `resets in ${Math.round(h / 24)} days`;
	if (h >= 1) return `resets in ${h}h ${m}m`;
	return `resets in ${m}m`;
}

function announce(text) {
	els.live.textContent = '';
	requestAnimationFrame(() => { els.live.textContent = text; });
}

function flash(text, kind = 'ok') {
	els.flash.className = `notice notice-${kind}`;
	els.flash.textContent = text;
	els.flash.hidden = false;
	announce(text);
	clearTimeout(flash.t);
	flash.t = setTimeout(() => { els.flash.hidden = true; }, 6000);
}

async function request(path, init = {}) {
	try {
		const r = await apiFetch(path, { credentials: 'include', ...init });
		let body = null;
		try { body = await r.json(); } catch { body = null; }
		if (!r.ok) {
			return {
				ok: false,
				status: r.status,
				code: body?.error || 'error',
				message: body?.error_description || body?.message || `Request failed (${r.status})`,
				body,
			};
		}
		return { ok: true, status: r.status, data: body };
	} catch {
		return { ok: false, status: 0, code: 'network_error', message: 'Could not reach three.ws. Check your connection and retry.' };
	}
}

// ── rendering ────────────────────────────────────────────────────────────────

function renderSkeleton() {
	els.kpis.innerHTML = Array.from({ length: 4 }).map(() => `
		<div class="sp-kpi"><div class="skeleton" style="height:12px;width:50%"></div><div class="skeleton" style="height:24px;width:70%;margin-top:10px"></div></div>
	`).join('');
	els.agents.innerHTML = Array.from({ length: 2 }).map(() => `
		<div class="sp-skel"><div class="skeleton" style="height:16px;width:40%"></div><div class="skeleton" style="height:8px;width:100%"></div><div class="skeleton" style="height:8px;width:80%"></div></div>
	`).join('');
	els.alerts.innerHTML = '';
	els.days.innerHTML = '<div class="skeleton" style="height:140px"></div>';
	els.models.innerHTML = '';
	els.tools.innerHTML = '';
}

function renderKpis(d) {
	const m = d.month;
	const projected = m.projected_usd;
	const overBalance = projected > d.balance_usd + m.to_date_usd && m.to_date_usd > 0;
	const lasts = m.balance_lasts_days;
	const lastsTone = lasts == null ? '' : lasts < 3 ? 'is-bad' : lasts < 10 ? 'is-warn' : '';
	els.kpis.innerHTML = `
		<div class="sp-kpi">
			<div class="sp-kpi-l">Credit balance</div>
			<div class="sp-kpi-v">${usd(d.balance_usd)}</div>
			<div class="sp-kpi-s">${usd(d.lifetime_spent_usd)} spent all time · <a href="/credits">top up</a></div>
		</div>
		<div class="sp-kpi">
			<div class="sp-kpi-l">This month so far</div>
			<div class="sp-kpi-v">${usd(m.to_date_usd)}</div>
			<div class="sp-kpi-s">${m.calls.toLocaleString()} model calls · day ${Math.ceil(m.days_elapsed)} of ${m.days_in_month}</div>
		</div>
		<div class="sp-kpi ${overBalance ? 'is-warn' : ''}">
			<div class="sp-kpi-l">Projected month end</div>
			<div class="sp-kpi-v">${usd(projected)}</div>
			<div class="sp-kpi-s">${usd(m.projected_from_week_usd)} at the last 7 days' pace (${usd(m.last_7_days_usd)})${overBalance ? ' · more than your balance covers' : ''}</div>
		</div>
		<div class="sp-kpi ${lastsTone}">
			<div class="sp-kpi-l">Balance lasts</div>
			<div class="sp-kpi-v">${lasts == null ? 'No burn yet' : lasts > 365 ? '1 year+' : `${lasts} days`}</div>
			<div class="sp-kpi-s">${lasts == null ? 'Nothing spent in the last 7 days' : 'at the last 7 days’ pace'}</div>
		</div>`;
}

function renderAlerts(d) {
	if (!d.alerts.length) {
		const caps = d.agents.some((a) => a.usd.windows.length || a.tokens?.windows?.length);
		els.alerts.innerHTML = `
			<div class="sp-empty">
				<div class="sp-empty-icon" aria-hidden="true">${caps ? '✅' : '🎚️'}</div>
				<h3>${caps ? 'No cap is past 50% yet' : 'No caps set'}</h3>
				<p>${caps
					? 'When any agent crosses half of a daily, monthly, hourly or per-run cap you get a notification and it shows up here.'
					: 'Set a dollar cap or a token ceiling on an agent below and you will be warned at 50 and 80 percent, then the agent pauses at 100.'}</p>
			</div>`;
		return;
	}
	els.alerts.innerHTML = d.alerts.map((a) => `
		<div class="sp-alert is-${a.threshold}" role="listitem">
			<span class="sp-alert-pct">${a.threshold}%</span>
			<div class="sp-alert-body">
				<div><strong>${esc(a.agent_name || 'Agent')}</strong> ${a.threshold >= 100 ? 'used all of' : `passed ${a.threshold}% of`} its ${WINDOW_LABEL[a.window]?.toLowerCase() || a.window} ${a.cap === 'tokens' ? 'token ceiling' : 'spend cap'}</div>
				<div class="sp-alert-sub">${esc(amount(a.used, a.unit))} of ${esc(amount(a.limit, a.unit))} (${a.pct ?? 0}%)${a.resets_at ? ` · ${esc(resetCopy(a.resets_at))}` : ''}</div>
			</div>
			<button type="button" class="btn btn-sm" data-act="focus" data-agent="${esc(a.agent_id)}">View agent</button>
		</div>
	`).join('');
}

function meter({ label, used, limit, pct, unit, resetsAt, extension = 0, exhausted = false, calls = null }) {
	const t = tone(pct);
	const width = Math.max(0, Math.min(100, pct ?? 0));
	return `
		<div class="sp-meter ${t}">
			<div class="sp-meter-l"><span>${esc(label)}</span><b>${esc(amount(used, unit))} / ${esc(amount(limit, unit))}</b></div>
			<div class="sp-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${width}" aria-label="${esc(label)}: ${pct ?? 0}% used">
				<span class="sp-mark" data-at="50" style="left:50%"></span>
				<span class="sp-mark" data-at="80" style="left:80%"></span>
				<span class="sp-mark" data-at="100"></span>
				<span class="sp-fill ${t}" style="width:${width}%"></span>
			</div>
			<div class="sp-meter-s">
				<span class="pct">${exhausted ? 'Cap reached' : `${pct ?? 0}% used`}${extension ? ` · +${tokens(extension)} extended` : ''}${calls != null ? ` · ${calls} calls` : ''}</span>
				<span>${esc(resetCopy(resetsAt))}</span>
			</div>
		</div>`;
}

function pauseBanner(a) {
	const p = a.pause;
	if (!p) return '';
	const busy = state.busy.has(a.id);
	if (p.kind === 'usd') {
		return `
			<div class="sp-pause" role="status">
				<div class="sp-pause-body"><strong>Paused: ${WINDOW_LABEL[p.window === 'daily' ? 'day' : 'month'].toLowerCase()} spend cap reached.</strong> Model calls are refused and automations are stopped until the cap resets${p.resets_at ? ` (${esc(resetCopy(p.resets_at))})` : ''}. Raising the cap resumes the agent.</div>
				<div class="sp-pause-actions"><button type="button" class="btn btn-sm btn-primary" data-act="edit" data-agent="${esc(a.id)}">Raise cap</button></div>
			</div>`;
	}
	return `
		<div class="sp-pause" role="status">
			<div class="sp-pause-body"><strong>Paused: ${WINDOW_LABEL[p.window].toLowerCase()} token ceiling reached.</strong> ${tokens(p.used_tokens)} of ${tokens(p.ceiling_tokens)} tokens used ${WINDOW_NOUN[p.window]}${p.resets_at ? `, ${esc(resetCopy(p.resets_at))}` : ''}. Resume once the window rolls over, extend the ceiling once for this window, or raise it.</div>
			<div class="sp-pause-actions">
				<button type="button" class="btn btn-sm btn-primary" data-act="resume" data-agent="${esc(a.id)}" ${busy ? 'disabled' : ''}>Resume</button>
				${p.extendable ? `<button type="button" class="btn btn-sm" data-act="extend" data-agent="${esc(a.id)}" data-window="${esc(p.window)}" ${busy ? 'disabled' : ''}>Extend once</button>` : '<span class="pill">Extended once</span>'}
				<button type="button" class="btn btn-sm" data-act="edit" data-agent="${esc(a.id)}">Raise cap</button>
			</div>
		</div>`;
}

function capForm(a) {
	const u = a.usd;
	const t = a.tokens || {};
	const msg = state.formMsg.get(a.id);
	const busy = state.busy.has(a.id);
	return `
		<form class="sp-form" data-agent="${esc(a.id)}" novalidate>
			<div class="sp-field">
				<label for="usd-day-${esc(a.id)}">Daily (USD)</label>
				<input id="usd-day-${esc(a.id)}" type="number" min="0" step="0.01" inputmode="decimal" name="daily_usd" value="${esc(u.daily_usd ?? '')}" placeholder="No cap">
			</div>
			<div class="sp-field">
				<label for="usd-month-${esc(a.id)}">Monthly (USD)</label>
				<input id="usd-month-${esc(a.id)}" type="number" min="0" step="0.01" inputmode="decimal" name="monthly_usd" value="${esc(u.monthly_usd ?? '')}" placeholder="No cap">
			</div>
			<div class="sp-field">
				<label for="tok-hour-${esc(a.id)}">Hourly tokens</label>
				<input id="tok-hour-${esc(a.id)}" type="number" min="0" step="1000" inputmode="numeric" name="hourly" value="${esc(t.hourly_tokens ?? '')}" placeholder="No ceiling">
			</div>
			<div class="sp-field">
				<label for="tok-day-${esc(a.id)}">Daily tokens</label>
				<input id="tok-day-${esc(a.id)}" type="number" min="0" step="1000" inputmode="numeric" name="daily" value="${esc(t.daily_tokens ?? '')}" placeholder="No ceiling">
			</div>
			<div class="sp-field">
				<label for="tok-run-${esc(a.id)}">Per run tokens</label>
				<input id="tok-run-${esc(a.id)}" type="number" min="0" step="1000" inputmode="numeric" name="per_run" value="${esc(t.per_run_tokens ?? '')}" placeholder="No ceiling">
				<small>Input plus output tokens. Leave a field empty for no limit.</small>
			</div>
			<div class="sp-form-foot">
				<span class="sp-form-msg ${msg?.kind || ''}" role="status">${esc(msg?.text || 'Windows reset at the top of the hour, at 00:00 UTC, and on the first of the month.')}</span>
				<span class="sp-card-actions">
					<button type="button" class="btn btn-sm" data-act="cancel" data-agent="${esc(a.id)}" ${busy ? 'disabled' : ''}>Cancel</button>
					<button type="submit" class="btn btn-sm btn-primary" ${busy ? 'disabled' : ''}>${busy ? 'Saving…' : 'Save caps'}</button>
				</span>
			</div>
		</form>`;
}

function agentCard(a) {
	const meters = [];
	for (const w of a.usd.windows) {
		meters.push(meter({ label: `${WINDOW_LABEL[w.window]} spend`, used: w.used_usd, limit: w.limit_usd, pct: w.pct, unit: 'usd', resetsAt: w.resets_at, exhausted: w.exhausted }));
	}
	for (const w of a.tokens?.windows || []) {
		meters.push(meter({ label: `${WINDOW_LABEL[w.window]} tokens`, used: w.used_tokens, limit: w.ceiling_tokens, pct: w.pct, unit: 'tokens', resetsAt: w.resets_at, extension: w.extension_tokens, exhausted: w.exhausted, calls: w.calls }));
	}
	const editing = state.editing.has(a.id);
	const statusPill = `<span class="pill pill-${esc(a.status)}">${esc(a.status)}</span>`;
	return `
		<div class="sp-card${state.agent === a.id ? ' is-focus' : ''}" id="agent-${esc(a.id)}" data-agent="${esc(a.id)}">
			<div class="sp-card-head">
				<h3><a href="/agents/${encodeURIComponent(a.id)}">${esc(a.name || 'Agent')}</a></h3>
				${statusPill}
				<span class="pill">${usd(a.usd.today_usd)} today · ${usd(a.usd.month_usd)} this month</span>
				<span class="sp-card-actions">${editing ? '' : `<button type="button" class="btn btn-sm" data-act="edit" data-agent="${esc(a.id)}">${meters.length ? 'Edit caps' : 'Set caps'}</button>`}</span>
			</div>
			${pauseBanner(a)}
			${meters.length ? `<div class="sp-meters">${meters.join('')}</div>` : (editing ? '' : '<p class="sp-empty-caps">No caps on this agent. It can spend whatever credits the account holds. Set a daily dollar cap or an hourly token ceiling to be warned at 50 and 80 percent and paused at 100.</p>')}
			${editing ? capForm(a) : ''}
		</div>`;
}

function renderAgents(d) {
	if (!d.agents.length) {
		els.agents.innerHTML = `
			<div class="sp-empty">
				<div class="sp-empty-icon" aria-hidden="true">🤖</div>
				<h3>No agents yet</h3>
				<p>Create an agent and its model calls, tool calls and caps will show up here.</p>
				<a class="btn" href="/agents">Create an agent</a>
			</div>`;
		return;
	}
	els.agents.innerHTML = d.agents.map(agentCard).join('');
}

function renderDays(d) {
	const byDay = new Map();
	for (const r of d.by_day) {
		const cur = byDay.get(r.day) || { usd: 0, calls: 0, tokens: 0, agents: [] };
		cur.usd += r.usd;
		cur.calls += r.calls;
		cur.tokens += r.tokens;
		const name = d.agents.find((a) => a.id === r.agent_id)?.name || 'agent';
		cur.agents.push(`${name} ${usd(r.usd)}`);
		byDay.set(r.day, cur);
	}
	const today = new Date();
	const days = [];
	for (let i = d.range_days - 1; i >= 0; i--) {
		const dt = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
		days.push(dt.toISOString().slice(0, 10));
	}
	const max = Math.max(0, ...days.map((k) => byDay.get(k)?.usd || 0));
	const total = days.reduce((s, k) => s + (byDay.get(k)?.usd || 0), 0);
	if (!total) {
		els.days.innerHTML = `
			<div class="sp-chart-head"><span>Last ${d.range_days} days</span><span>$0.00</span></div>
			<p class="sp-empty-caps">No model spend in this range. Runs, chats and automations that bill credits will chart here by day.</p>`;
		return;
	}
	const bars = days.map((k) => {
		const row = byDay.get(k);
		const v = row?.usd || 0;
		const h = max > 0 ? Math.max(2, Math.round((v / max) * 100)) : 2;
		const title = `${k}: ${usd(v)}, ${row?.calls || 0} calls, ${tokens(row?.tokens || 0)} tokens${row?.agents?.length ? ` (${row.agents.join(', ')})` : ''}`;
		return `<div class="sp-col${k === days[days.length - 1] ? ' is-today' : ''}${v ? '' : ' is-zero'}" tabindex="0" role="img" aria-label="${esc(title)}" title="${esc(title)}"><i style="height:${h}%"></i></div>`;
	}).join('');
	els.days.innerHTML = `
		<div class="sp-chart-head"><span>Last ${d.range_days} days · ${usd(total)}</span><span>peak day ${usd(max)}</span></div>
		<div class="sp-bars" role="list">${bars}</div>
		<div class="sp-axis"><span>${esc(days[0])}</span><span>${esc(days[days.length - 1])}</span></div>`;
}

function renderModels(d) {
	if (!d.by_model.length) {
		els.models.innerHTML = '<p class="sp-empty-caps">No model calls in this range.</p>';
		return;
	}
	const total = d.by_model.reduce((s, r) => s + r.usd, 0) || 1;
	els.models.innerHTML = `
		<table class="sp-table">
			<thead><tr><th>Model</th><th class="num">Spend</th><th class="num">Calls</th><th class="num">Input tokens</th><th class="num">Output tokens</th></tr></thead>
			<tbody>${d.by_model.map((r) => `
				<tr>
					<td><span class="share" style="width:${Math.max(2, Math.round((r.usd / total) * 60))}px"></span><span class="mono">${esc(r.model)}</span>${r.provider ? ` <span class="pill">${esc(r.provider)}</span>` : ''}</td>
					<td class="num">${usd(r.usd)}</td>
					<td class="num">${r.calls.toLocaleString()}</td>
					<td class="num">${tokens(r.input_tokens)}</td>
					<td class="num">${tokens(r.output_tokens)}</td>
				</tr>`).join('')}
			</tbody>
		</table>`;
}

function renderTools(d) {
	if (!d.by_tool.length) {
		els.tools.innerHTML = '<p class="sp-empty-caps">No tool calls in this range. Trading, research and gateway tools your agents call are metered here.</p>';
		return;
	}
	const max = Math.max(1, ...d.by_tool.map((r) => r.calls));
	els.tools.innerHTML = `
		<table class="sp-table">
			<thead><tr><th>Tool</th><th class="num">Calls</th><th class="num">Succeeded</th><th class="num">Cost</th><th class="num">Last used</th></tr></thead>
			<tbody>${d.by_tool.map((r) => `
				<tr>
					<td><span class="share" style="width:${Math.max(2, Math.round((r.calls / max) * 60))}px"></span><span class="mono">${esc(r.tool)}</span> <span class="pill">${esc(r.kind)}</span></td>
					<td class="num">${r.calls.toLocaleString()}</td>
					<td class="num">${r.calls ? Math.round((r.ok / r.calls) * 100) : 0}%</td>
					<td class="num">${r.usd ? usd(r.usd) : 'free'}</td>
					<td class="num">${esc(relTime(r.last_at))}</td>
				</tr>`).join('')}
			</tbody>
		</table>`;
}

function renderAgentSelect(d) {
	const current = els.agent.value;
	const opts = ['<option value="">All agents</option>']
		.concat(d.agents.map((a) => `<option value="${esc(a.id)}">${esc(a.name || a.id)}</option>`));
	els.agent.innerHTML = opts.join('');
	els.agent.value = d.agents.some((a) => a.id === state.agent) ? state.agent : current && d.agents.some((a) => a.id === current) ? current : '';
}

function render() {
	const d = state.data;
	if (!d) return;
	renderKpis(d);
	renderAlerts(d);
	renderAgents(d);
	renderDays(d);
	renderModels(d);
	renderTools(d);
}

// ── data ─────────────────────────────────────────────────────────────────────

async function load({ silent = false } = {}) {
	if (!silent) renderSkeleton();
	const params = new URLSearchParams({ days: String(state.days) });
	if (state.agent) params.set('agent', state.agent);
	const r = await request(`/api/me/spend?${params}`, { allowAnonymous: true });
	if (!r.ok) {
		if (r.status === 401) {
			els.auth.hidden = false;
			els.main.hidden = true;
			return;
		}
		if (r.status === 404 && state.agent) {
			state.agent = '';
			history.replaceState(null, '', '/spend');
			return load();
		}
		els.error.textContent = r.message;
		els.error.hidden = false;
		return;
	}
	els.error.hidden = true;
	state.data = r.data;
	// The selector lists every agent even when one is focused, so a focused
	// view always reloads the full list for the dropdown once.
	if (state.agent && state.data.agents.length === 1 && els.agent.options.length <= 1) {
		const all = await request('/api/me/spend?days=1', { allowAnonymous: true });
		if (all.ok) renderAgentSelect(all.data);
		els.agent.value = state.agent;
	} else {
		renderAgentSelect(state.data);
	}
	render();
}

function agentById(id) {
	return state.data?.agents.find((a) => a.id === id) || null;
}

function setFormMsg(id, text, kind) {
	state.formMsg.set(id, { text, kind });
}

async function saveCaps(form) {
	const id = form.dataset.agent;
	const a = agentById(id);
	if (!a) return;
	const f = new FormData(form);
	const num = (name) => {
		const raw = String(f.get(name) ?? '').trim();
		if (!raw) return null;
		const n = Number(raw);
		return Number.isFinite(n) && n > 0 ? n : NaN;
	};
	const dailyUsd = num('daily_usd');
	const monthlyUsd = num('monthly_usd');
	const hourly = num('hourly');
	const daily = num('daily');
	const perRun = num('per_run');
	if ([dailyUsd, monthlyUsd, hourly, daily, perRun].some(Number.isNaN)) {
		setFormMsg(id, 'Every cap must be a number above zero, or empty for no cap.', 'err');
		return render();
	}
	state.busy.add(id);
	render();
	const usdBudget = dailyUsd == null && monthlyUsd == null ? null : { daily: dailyUsd, monthly: monthlyUsd };
	const tokenBudget = hourly == null && daily == null && perRun == null ? null : { hourly, daily, per_run: perRun };
	const [u, t] = await Promise.all([
		request(`/api/agents/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ inferenceBudget: usdBudget }), headers: { 'content-type': 'application/json' } }),
		request(`/api/agents/${encodeURIComponent(id)}/token-budget`, { method: 'PUT', body: JSON.stringify({ tokenBudget }), headers: { 'content-type': 'application/json' } }),
	]);
	state.busy.delete(id);
	const failed = [u, t].find((r) => !r.ok);
	if (failed) {
		setFormMsg(id, failed.message, 'err');
		return render();
	}
	state.editing.delete(id);
	state.formMsg.delete(id);
	flash(`Caps saved for ${a.name || 'the agent'}.${t.data?.resumed || u.data?.status === 'running' ? ' The agent is running again.' : ''}`);
	await load({ silent: true });
}

async function resume(id) {
	const a = agentById(id);
	if (!a) return;
	state.busy.add(id);
	render();
	const r = await request(`/api/agents/${encodeURIComponent(id)}/token-budget/resume`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
	state.busy.delete(id);
	if (!r.ok) {
		flash(r.code === 'still_capped'
			? `${a.name || 'The agent'} is still at its ceiling: ${r.message} Extend it once or raise the cap.`
			: r.message, 'error');
		return render();
	}
	flash(`${a.name || 'The agent'} is running again.`);
	await load({ silent: true });
}

async function extend(id, window) {
	const a = agentById(id);
	if (!a) return;
	state.busy.add(id);
	render();
	const r = await request(`/api/agents/${encodeURIComponent(id)}/token-budget/extend`, { method: 'POST', body: JSON.stringify({ window }), headers: { 'content-type': 'application/json' } });
	state.busy.delete(id);
	if (!r.ok) {
		flash(r.code === 'already_extended' ? `${a.name || 'The agent'} already used its one extension for this window. Raise the cap instead.` : r.message, 'error');
		return render();
	}
	const ext = r.data?.extension;
	flash(`Ceiling extended by ${tokens(ext?.extra_tokens || 0)} tokens for ${WINDOW_NOUN[window] || window}. ${a.name || 'The agent'} is running again.`);
	await load({ silent: true });
}

function focusAgent(id) {
	const card = document.getElementById(`agent-${id}`);
	if (!card) return;
	document.querySelectorAll('.sp-card.is-focus').forEach((c) => c.classList.remove('is-focus'));
	card.classList.add('is-focus');
	card.scrollIntoView({ behavior: 'smooth', block: 'center' });
	card.querySelector('h3 a')?.focus({ preventScroll: true });
}

function wire() {
	els.agent.addEventListener('change', () => {
		state.agent = els.agent.value;
		const url = state.agent ? `/spend?agent=${encodeURIComponent(state.agent)}` : '/spend';
		history.replaceState(null, '', url);
		load();
	});
	els.range.addEventListener('change', () => {
		state.days = Number(els.range.value) || 30;
		load();
	});
	els.refresh.addEventListener('click', () => load({ silent: true }));
	els.main.addEventListener('click', (e) => {
		const btn = e.target.closest('[data-act]');
		if (!btn) return;
		const id = btn.dataset.agent;
		switch (btn.dataset.act) {
			case 'edit':
				state.editing.add(id);
				render();
				document.querySelector(`.sp-form[data-agent="${CSS.escape(id)}"] input`)?.focus();
				return;
			case 'cancel':
				state.editing.delete(id);
				state.formMsg.delete(id);
				return render();
			case 'resume':
				return resume(id);
			case 'extend':
				return extend(id, btn.dataset.window);
			case 'focus':
				return focusAgent(id);
			default:
				return undefined;
		}
	});
	els.main.addEventListener('submit', (e) => {
		const form = e.target.closest('.sp-form');
		if (!form) return;
		e.preventDefault();
		saveCaps(form);
	});
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible' && state.data) load({ silent: true });
	});
}

async function init() {
	els.auth = q('sp-auth');
	els.error = q('sp-error');
	els.flash = q('sp-flash');
	els.live = q('sp-live');
	els.main = q('sp-main');
	els.agent = q('sp-agent');
	els.range = q('sp-range');
	els.refresh = q('sp-refresh');
	els.kpis = q('sp-kpis');
	els.alerts = q('sp-alerts');
	els.agents = q('sp-agents');
	els.days = q('sp-days');
	els.models = q('sp-models');
	els.tools = q('sp-tools');

	const params = new URLSearchParams(location.search);
	const agent = params.get('agent');
	if (agent && /^[0-9a-f-]{36}$/i.test(agent)) state.agent = agent;

	els.main.hidden = false;
	wire();
	await load();
	if (state.agent) focusAgent(state.agent);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
