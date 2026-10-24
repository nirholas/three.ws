// Earnings console (pages/earnings.html, route /earnings).
//
// The owner's revenue ledger: totals by source and period, the stacked chart,
// the ledger with a transaction link on every row, CSV and JSON export, the
// reconcile status, the trailing-window projection, the public-page toggle and
// the reinvest rules. A rule is only switched on by the explicit confirm step,
// which shows the exact destinations and amounts and sends the hash the owner
// reviewed; the server refuses it if anything changed since.
// API: api/_lib/revenue-routes.js. Doc: docs/revenue-ledger.md.

import './agent-commerce.css';
import './earnings.css';
import { apiFetch } from './api.js';
import { esc, relTime } from './agent-commerce-format.js';
import { renderEarningsChart, slotOf, usd } from './earnings-chart.js';

const API = '/api/revenue';
const PAGE = 100;
const LEGS = [
	{ kind: 'model_credits', label: 'Model credits', hint: 'USDC to the platform deposit wallet, credited to your balance.' },
	{ kind: 'dca_own_coin', label: "DCA into the agent's own coin", hint: 'A SOL buy of the agent\'s own pump.fun coin from its wallet.' },
	{ kind: 'tools_budget', label: 'Tools budget', hint: 'USDC credited, then added to a payment session your agent spends from.' },
];

const $ = (id) => document.getElementById(id);
const els = {};
const state = {
	agents: [], agentId: '', period: 'month', source: '',
	view: null, entries: [], nextBefore: null,
	rules: [], runs: [], sessions: [], editing: null, previews: new Map(),
	busy: new Set(),
};

// ── helpers ──────────────────────────────────────────────────────────────────

async function call(path, { method = 'GET', body } = {}) {
	const headers = { accept: 'application/json' };
	if (body) headers['content-type'] = 'application/json';
	let res;
	try {
		res = await apiFetch(`${API}${path}`, { method, allowAnonymous: true, headers, body: body ? JSON.stringify(body) : undefined });
	} catch (err) {
		if (err?.redirected) return { ok: false, status: 401, data: null, message: 'Your session expired.' };
		return { ok: false, status: 0, data: null, message: 'Network error. Check your connection and try again.' };
	}
	const json = await res.json().catch(() => ({}));
	const code = json?.error?.code || null;
	if (res.status === 401 && method !== 'GET') showAuthWall();
	return {
		ok: res.ok, status: res.status, code, data: json?.data ?? json,
		message: json?.error?.message || json?.error_description || (typeof json?.error === 'string' ? json.error : null) || `Request failed (${res.status})`,
	};
}

function announce(msg) {
	els.live.textContent = '';
	requestAnimationFrame(() => { els.live.textContent = msg; });
}
function flash(msg) {
	els.flash.textContent = msg;
	els.flash.hidden = false;
	announce(msg);
	clearTimeout(flash.t);
	flash.t = setTimeout(() => { els.flash.hidden = true; }, 6000);
}
function showError(msg, retry) {
	els.error.innerHTML = `<strong>${esc(msg)}</strong>${retry ? '<br><button type="button" class="ac-btn ac-btn-sm" data-retry>Try again</button>' : ''}`;
	els.error.hidden = false;
	els.error._retry = retry || null;
}
function clearError() { els.error.hidden = true; }

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
const signedUsd = (n) => `${Number(n) < 0 ? '-' : ''}${usd(Math.abs(Number(n)))}`;
const sourceOf = (key) => state.view?.sources?.find((s) => s.key === key);
const short = (sig) => (sig ? `${sig.slice(0, 6)}…${sig.slice(-6)}` : '');
const agentName = (id) => state.agents.find((a) => a.id === id)?.name || 'Unnamed agent';

function showAuthWall() {
	els.main.hidden = true;
	els.skel.hidden = true;
	els.auth.hidden = false;
	els.login.href = `/login?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`;
}

function qs(extra = {}) {
	const p = new URLSearchParams();
	if (state.agentId) p.set('agent_id', state.agentId);
	for (const [k, v] of Object.entries(extra)) if (v != null && v !== '') p.set(k, v);
	const s = p.toString();
	return s ? `?${s}` : '';
}

const BASIS_NOTE = {
	exact: 'Exact: valued from the settled USDC amount.',
	recorded: 'Recorded: the USD amount stored when the event settled.',
	sync_price: 'Valued at the SOL price when the ledger first saw the row.',
	event_price: 'Valued at the price at the event.',
	unvalued: 'No USD price was available, so this row is listed but not in USD totals.',
};

// ── ledger ───────────────────────────────────────────────────────────────────

async function loadLedger() {
	clearError();
	const res = await call(`/ledger${qs({ period: state.period })}`);
	if (res.status === 401) return showAuthWall();
	if (!res.ok) {
		els.skel.hidden = true;
		return showError(`Could not load the ledger: ${res.message}`, loadLedger);
	}
	state.view = res.data;
	els.skel.hidden = true;
	els.main.hidden = false;
	renderStats();
	renderChart();
	renderSources();
	renderProjection();
	renderReconcile();
	renderPublic();
	fillSourceFilter();
	await loadEntries(true);
}

function renderStats() {
	const { summary, unclaimed_creator_fees: un } = state.view;
	const pnl = summary.trading_pnl_usd;
	const tiles = [
		{ k: 'Revenue', v: usd(summary.revenue_usd), s: `${sumCount(summary, true)} income events since the first row` },
		{ k: 'Realised trading PnL', v: `<span class="${pnl < 0 ? 'er-neg' : ''}">${signedUsd(pnl)}</span>`, s: 'Closed positions only. Reported apart from revenue.' },
		{ k: 'Net', v: `<span class="${summary.net_usd < 0 ? 'er-neg' : ''}">${signedUsd(summary.net_usd)}</span>`, s: 'Revenue plus realised PnL.' },
	];
	if (un && Number(un.sol) > 0) {
		tiles.push({ k: 'Unclaimed creator fees', v: un.usd != null ? usd(un.usd) : `${un.sol} SOL`, s: `${un.sol} SOL waiting to be claimed. Counted once claimed.${un.refreshed_at ? ` Refreshed ${esc(relTime(un.refreshed_at))}.` : ''}` });
	}
	let notes = '';
	if (summary.unvalued_count) notes += `${summary.unvalued_count} ${summary.unvalued_count === 1 ? 'row has' : 'rows have'} no USD price and ${summary.unvalued_count === 1 ? 'is' : 'are'} left out of USD totals. `;
	if (summary.excluded_count) notes += `${summary.excluded_count} ${summary.excluded_count === 1 ? 'row is' : 'rows are'} excluded (devnet or non-Solana).`;
	els.stats.innerHTML = tiles.map((t) => `<div class="er-stat"><dt>${esc(t.k)}</dt><dd>${t.v}</dd><small>${t.s}</small></div>`).join('');
	els.statNote.textContent = notes.trim();
	els.statNote.hidden = !notes;
}

function sumCount(summary, revenueOnly) {
	return Object.entries(summary.by_source).reduce((a, [k, s]) => a + (revenueOnly && sourceOf(k)?.kind !== 'revenue' ? 0 : s.count), 0);
}

function renderChart() {
	renderEarningsChart(els.chart, { summary: state.view.summary, sources: state.view.sources });
}

function renderSources() {
	const { summary, sources } = state.view;
	const rows = sources.map((s) => {
		const v = summary.by_source[s.key];
		const amount = s.kind === 'pnl' ? signedUsd(v.usd) : usd(v.usd);
		const sub = v.count ? `${v.count} ${v.count === 1 ? 'event' : 'events'}${v.unvalued ? `, ${v.unvalued} unvalued` : ''}` : 'Nothing yet';
		return `<li><span class="er-swatch" style="background:var(--er-s${slotOf(sources, s.key)})" aria-hidden="true"></span><span>${esc(s.label)}${s.kind === 'pnl' ? ' <span class="er-chip">not revenue</span>' : ''}</span><span class="er-amt ${s.kind === 'pnl' && v.usd < 0 ? 'er-neg' : ''}">${amount}</span><span class="er-sub">${esc(sub)}</span></li>`;
	});
	els.sources.innerHTML = rows.join('');
}

function renderProjection() {
	const p = state.view.projection;
	if (!p.available) {
		els.proj.innerHTML = `<p class="ac-hint">No projection yet. ${esc(p.reason)}</p><p class="ac-hint">Projections use only real trailing history, never a guess.</p>`;
		return;
	}
	els.proj.innerHTML = `
		<p class="er-stat" style="padding:0;border:0;background:none"><span class="ac-num" style="font-size:var(--text-xl);color:var(--ink-bright)">${usd(p.projected_usd)}</span></p>
		<p class="ac-hint">Expected over the next ${p.horizon_days} days. ${esc(p.method)}</p>
		<p class="ac-hint">Window: ${esc(fmtDate(p.window_start))} to ${esc(fmtDate(p.window_end))}, ${p.entries_in_window} income ${p.entries_in_window === 1 ? 'event' : 'events'}, ${usd(p.per_day_usd)} per day. A projection, not income.</p>`;
}

function renderReconcile() {
	const { reconcile: r, chain_verification: c, synced_at } = state.view;
	const bits = [];
	if (!r) {
		bits.push('<p class="ac-hint">The first reconcile has not run yet. It runs hourly and compares every source table against this ledger and samples transactions on-chain.</p>');
	} else {
		const chip = r.status === 'clean' ? '<span class="er-chip er-chip-ok">Clean</span>' : r.status === 'drift' ? '<span class="er-chip er-chip-bad">Drift found</span>' : '<span class="er-chip er-chip-dim">Error</span>';
		bits.push(`<p>${chip} <span class="ac-hint">Last run ${esc(relTime(r.started_at))}, ${r.entries_total} entries.</span></p>`);
		const drifted = (r.db_checks || []).filter((x) => x.drift);
		if (drifted.length) bits.push(`<ul class="ac-hint">${drifted.map((d) => `<li>${esc(d.label)}: source has ${d.source_count}, ledger has ${d.ledger_count}.</li>`).join('')}</ul>`);
	}
	bits.push(`<p class="ac-hint">Transactions: ${c.verified} verified on-chain${c.issues ? `, <strong class="er-neg">${c.issues} need a look</strong>` : ''}${c.unchecked ? `, ${c.unchecked} not yet checked` : ''}.</p>`);
	if (synced_at) bits.push(`<p class="ac-hint">Ledger synced ${esc(relTime(synced_at))}.</p>`);
	els.rec.innerHTML = bits.join('');
}

function renderPublic() {
	els.pubPanel.hidden = !state.agentId;
	if (!state.agentId) return;
	const link = `${location.origin}/agents/${state.agentId}/earnings`;
	els.pubLink.hidden = !els.pub.checked;
	els.pubLink.innerHTML = els.pub.checked ? `Live at <a href="${esc(link)}" target="_blank" rel="noopener">${esc(link)}</a>` : '';
}

async function loadPublicSetting() {
	if (!state.agentId) return;
	const res = await call(`/agents/${state.agentId}/settings`);
	els.pub.checked = Boolean(res.ok && res.data?.public_earnings);
	els.pubLabel.textContent = els.pub.checked ? 'Public' : 'Private';
	renderPublic();
}

function fillSourceFilter() {
	if (els.srcFilter.options.length > 1) return;
	for (const s of state.view.sources) els.srcFilter.append(new Option(s.label, s.key));
}

async function loadEntries(reset) {
	if (reset) {
		state.entries = [];
		state.nextBefore = null;
		els.ledger.innerHTML = '<div class="er-skel"></div>';
	}
	const res = await call(`/entries${qs({ limit: PAGE, source: state.source, before: reset ? '' : state.nextBefore })}`);
	if (!res.ok) {
		els.ledger.innerHTML = '';
		return showError(`Could not load ledger rows: ${res.message}`, () => loadEntries(true));
	}
	state.entries.push(...res.data.entries);
	state.nextBefore = res.data.next_before;
	renderLedger();
}

function renderLedger() {
	if (!state.entries.length) {
		els.ledger.innerHTML = `<div class="ac-empty"><h3>${state.source ? 'No rows for this source' : 'No income recorded yet'}</h3><p>${state.source ? 'Pick another source, or clear the filter.' : 'Creator fees, skill sales, hires, royalties, invoices and closed trades appear here as they happen. Press Sync now to pull in anything new, or <a href="/commerce">send an invoice</a> from one of your agents.'}</p></div>`;
		els.more.hidden = true;
		return;
	}
	const showAgent = !state.agentId && state.agents.length > 1;
	const rows = state.entries.map((e) => {
		const src = sourceOf(e.source);
		const usdCell = e.usd == null ? '<span class="er-dim" title="No USD price was available">unvalued</span>' : `<span class="${e.usd < 0 ? 'er-neg' : ''}" title="${esc(BASIS_NOTE[e.usd_basis] || '')}">${signedUsd(e.usd)}</span>`;
		const tx = e.explorer_url
			? `<a href="${esc(e.explorer_url)}" target="_blank" rel="noopener" class="ac-mono">${esc(short(e.tx_signature))}</a>`
			: '<span class="er-dim">no transaction</span>';
		const chain = e.chain_status === 'verified' ? '<span class="er-chip er-chip-ok" title="Found on-chain">verified</span>' : e.chain_status === 'mismatch' || e.chain_status === 'not_found' ? `<span class="er-chip er-chip-bad" title="${esc(e.chain_detail || '')}">check</span>` : '';
		const net = e.network !== 'mainnet' || e.chain !== 'solana' ? `<span class="er-chip" title="${esc(e.exclusion_reason || '')}">${esc(e.chain === 'solana' ? e.network : e.chain)}</span>` : '';
		return `<tr class="${e.counted ? '' : 'is-excluded'}">
			<td>${esc(fmtDate(e.occurred_at))}</td>
			<td><span class="er-swatch" style="background:var(--er-s${slotOf(state.view.sources, e.source)})" aria-hidden="true"></span> ${esc(src?.label || e.source)} ${net}</td>
			${showAgent ? `<td>${esc(e.agent_id ? agentName(e.agent_id) : 'Account')}</td>` : ''}
			<td class="er-label">${esc(e.label || '')}</td>
			<td class="er-r">${esc(e.amount)} ${esc(e.asset)}</td>
			<td class="er-r">${usdCell}</td>
			<td>${tx} ${chain}</td>
		</tr>`;
	}).join('');
	els.ledger.innerHTML = `<table><caption class="ac-sr">Revenue ledger</caption><thead><tr><th scope="col">When</th><th scope="col">Source</th>${showAgent ? '<th scope="col">Agent</th>' : ''}<th scope="col">Detail</th><th scope="col" class="er-r">Amount</th><th scope="col" class="er-r">USD</th><th scope="col">Transaction</th></tr></thead><tbody>${rows}</tbody></table>`;
	els.more.hidden = !state.nextBefore;
}

// ── drawer ───────────────────────────────────────────────────────────────────

let drawerReturn = null;
function openDrawer() {
	const v = state.view;
	const sources = v?.sources || [];
	els.drawer.innerHTML = `
		<button type="button" class="ac-btn ac-btn-sm er-drawer-close" data-close>Close</button>
		<h2 class="ac-h2" id="er-drawer-h">How this is calculated</h2>
		<p class="ac-hint">The ledger is a copy of income events from the tables that own them. The source tables stay the record, and an hourly job proves the two still match.</p>
		<dl>${sources.map((s) => `<dt><span class="er-swatch" style="background:var(--er-s${slotOf(sources, s.key)})" aria-hidden="true"></span>${esc(s.label)}</dt><dd>${esc(s.how)}</dd>`).join('')}</dl>
		<h3 class="ac-section-title" style="margin-top:20px">Valuation</h3>
		<ul>
			<li>USD comes from the settled amount (USDC is $1), the amount stored when the event settled, or, for SOL, the SOL price when the ledger first saw the row. The price used is never changed afterwards, so history does not move.</li>
			<li>A row with no price is listed and counted as an event but kept out of USD totals, and the page says how many.</li>
		</ul>
		<h3 class="ac-section-title" style="margin-top:20px">Not included</h3>
		<ul>${(v?.not_included || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
		<h3 class="ac-section-title" style="margin-top:20px">Reconciliation</h3>
		<ul>
			<li>Every hour each source table is re-summed against the ledger. Any difference is flagged and you are notified once per distinct drift.</li>
			<li>A sample of mainnet transactions is looked up on-chain. A signature that is missing or failed is flagged. Signatures older than the RPC history window cannot be judged and are marked skipped.</li>
		</ul>
		<h3 class="ac-section-title" style="margin-top:20px">Projection</h3>
		<ul><li>Trailing real revenue divided by the days it covers, held flat for 30 days. It needs 7 days of history and 3 income events, and says so when it does not have them. No growth is assumed.</li></ul>`;
	drawerReturn = document.activeElement;
	els.backdrop.hidden = false;
	els.drawer.hidden = false;
	els.drawer.querySelector('[data-close]').focus();
}
function closeDrawer() {
	els.drawer.hidden = true;
	els.backdrop.hidden = true;
	drawerReturn?.focus?.();
}

// ── reinvest rules ───────────────────────────────────────────────────────────

async function loadRules() {
	const [r, runs] = await Promise.all([call(`/rules${qs()}`), call(`/runs${qs({ limit: 40 })}`)]);
	if (!r.ok) {
		els.rules.innerHTML = '';
		return showError(`Could not load reinvest rules: ${r.message}`, loadRules);
	}
	state.rules = r.data.rules || [];
	state.runs = runs.ok ? runs.data.runs || [] : [];
	renderRules();
}

const STATUS_CHIP = { draft: ['Needs confirmation', 'er-chip'], active: ['Active', 'er-chip er-chip-ok'], paused: ['Paused', 'er-chip er-chip-dim'] };
const RUN_STATUS = { completed: 'Completed', partial: 'Partly done', awaiting_approval: 'Waiting for your approval', skipped: 'Skipped', failed: 'Failed', running: 'Running' };

function legSummary(rule) {
	return rule.legs.map((l) => `${l.pct}% ${LEGS.find((x) => x.kind === l.kind)?.label || l.kind}`).join(', ');
}

function renderRules() {
	if (!state.rules.length) {
		els.rules.innerHTML = `<div class="ac-empty"><h3>No reinvest rules yet</h3><p>Decide once what happens to your agent's income: for example 20% to model credits, 20% into its own coin, 10% to a tools budget, and keep the rest. Nothing moves until you confirm the exact terms.</p></div>`;
		return;
	}
	els.rules.innerHTML = state.rules.map((r) => {
		const [label, cls] = STATUS_CHIP[r.status] || [r.status, 'er-chip'];
		const keep = Math.max(0, 100 - r.legs.reduce((a, l) => a + Number(l.pct), 0));
		const runs = state.runs.filter((x) => x.rule_id === r.id).slice(0, 5);
		const preview = state.previews.get(r.id);
		const busy = state.busy.has(r.id);
		return `<article class="ac-card er-rule" data-rule="${esc(r.id)}">
			<div class="er-rule-head">
				<div><strong>${esc(r.name)}</strong> <span class="${cls}">${esc(label)}</span> ${r.network === 'devnet' ? '<span class="ac-badge-devnet">devnet</span>' : ''}</div>
				<div class="ac-row-actions">
					<button type="button" class="ac-btn ac-btn-sm ${r.confirmed ? '' : 'ac-btn-primary'}" data-act="review" ${busy ? 'disabled' : ''}>${r.confirmed ? 'View terms' : 'Review and confirm'}</button>
					<button type="button" class="ac-btn ac-btn-sm" data-act="test" ${busy ? 'disabled' : ''}>Test run</button>
					${r.status === 'active' ? `<button type="button" class="ac-btn ac-btn-sm" data-act="pause" ${busy ? 'disabled' : ''}>Pause</button>` : ''}
					<button type="button" class="ac-btn ac-btn-sm" data-act="edit" ${busy ? 'disabled' : ''}>Edit</button>
					<button type="button" class="ac-btn ac-btn-sm ac-btn-danger" data-act="delete" ${busy ? 'disabled' : ''}>Delete</button>
				</div>
			</div>
			<p class="ac-hint" style="margin:0">${esc(agentName(r.agent_id))}: each ${esc(r.period === 'daily' ? 'day' : r.period === 'weekly' ? 'week' : 'month')}, ${esc(legSummary(r))}${keep ? `, keep ${keep}%` : ''}. Caps: ${usd(r.per_run_cap_usd)} per run, ${usd(r.lifetime_cap_usd)} lifetime, skip runs under ${usd(r.min_run_usd)}. Basis: ${r.basis === 'revenue' ? 'revenue only' : 'revenue plus realised trading profit'}.</p>
			${r.paused_reason ? `<div class="ac-notice ac-notice-warn" style="margin:0">${esc(r.paused_reason)}</div>` : ''}
			<div data-slot="preview">${preview ? previewHtml(r, preview) : ''}</div>
			<div data-slot="msg" class="ac-form-msg" role="status"></div>
			${runs.length ? `<div class="er-runs"><strong class="ac-hint">Recent runs</strong>${runs.map(runHtml).join('')}</div>` : '<p class="ac-hint" style="margin:0">No runs yet. A rule runs once per complete period after you confirm it.</p>'}
		</article>`;
	}).join('');
}

function runHtml(run) {
	const legs = (run.legs || []).map((l) => {
		const st = l.status === 'executed' ? 'sent' : l.status === 'awaiting_approval' ? 'waiting for your approval' : l.status;
		const tx = l.signature ? ` <a href="https://solscan.io/tx/${esc(l.signature)}${run.rule_snapshot?.network === 'devnet' ? '?cluster=devnet' : ''}" target="_blank" rel="noopener">${esc(short(l.signature))}</a>` : '';
		return `<li>${esc(l.kind.replace(/_/g, ' '))}: ${usd(l.capped_usd)} ${esc(st)}${tx}${l.error ? ` (${esc(l.error)})` : ''}</li>`;
	}).join('');
	return `<div class="er-run"><div><strong>${esc(RUN_STATUS[run.status] || run.status)}</strong> ${run.mode === 'preview' ? '<span class="er-chip">test</span>' : ''} <span class="ac-hint">${esc(fmtDate(run.period_start))} to ${esc(fmtDate(run.period_end))}. Income ${usd(run.base_usd)}, sent ${usd(run.executed_usd)}, kept ${usd(run.kept_usd)}.</span></div>${run.note ? `<div class="ac-hint">${esc(run.note)}</div>` : ''}${run.error ? `<div class="ac-hint er-neg">${esc(run.error)}</div>` : ''}${legs ? `<ul>${legs}</ul>` : ''}</div>`;
}

function previewHtml(rule, p) {
	const rows = p.confirmation.map((c) => `<tr>
		<td>${esc(c.label)}<br><span class="ac-hint">${c.pct}%</span></td>
		<td>${esc(c.asset)} on Solana ${esc(c.network)}</td>
		<td>${c.recipient ? `<span class="ac-mono">${esc(c.recipient)}</span>` : '<span class="er-neg">Not available</span>'}<br><span class="ac-hint">${esc(c.recipient_label)}</span></td>
		<td class="er-r ac-num">${usd(c.would_send_usd)}</td>
	</tr>`).join('');
	const ready = p.confirmation.every((c) => c.ready);
	const skip = p.plan.skip ? `<p class="ac-hint">With last period's income this rule would send nothing: ${esc(p.plan.skip)}</p>` : '';
	return `<div class="ac-card" style="margin:0">
		<h3 class="ac-section-title" style="margin-top:0">${rule.confirmed ? 'Confirmed terms' : 'Confirm these exact terms'}</h3>
		<div class="er-ledger"><table class="er-confirm"><thead><tr><th scope="col">Leg</th><th scope="col">Asset and chain</th><th scope="col">Recipient</th><th scope="col" class="er-r">Would send (last period)</th></tr></thead><tbody>${rows}</tbody></table></div>
		<p class="ac-hint">Last period (${esc(fmtDate(p.period.start))} to ${esc(fmtDate(p.period.end))}) income was ${usd(p.base_usd)}; ${usd(p.plan.executable_usd)} would be reinvested and ${usd(p.plan.kept_usd)} kept. ${p.plan.scaled ? 'The caps scaled the legs down. ' : ''}Lifetime reinvested so far: ${usd(p.lifetime_spent_usd)}.</p>
		${skip}
		<p class="ac-hint">${esc(p.note)}</p>
		${rule.confirmed ? '' : `<div class="ac-form-foot"><button type="button" class="ac-btn ac-btn-primary" data-act="confirm" ${ready ? '' : 'disabled'}>I confirm: run this rule every period</button>${ready ? '' : '<span class="ac-hint">A destination above is not available yet, so this cannot be confirmed.</span>'}</div>`}
	</div>`;
}

function ruleMsg(card, msg, bad) {
	const slot = card.querySelector('[data-slot="msg"]');
	slot.textContent = msg;
	slot.style.color = bad ? 'var(--danger)' : '';
	announce(msg);
}

async function ruleAction(card, act) {
	const id = card.dataset.rule;
	const rule = state.rules.find((r) => r.id === id);
	if (!rule || state.busy.has(id)) return;
	if (act === 'edit') return openRuleForm(rule);
	if (act === 'delete' && !confirm(`Delete "${rule.name}"? Its run history is deleted with it.`)) return;
	state.busy.add(id);
	card.querySelectorAll('button').forEach((b) => { b.disabled = true; });
	try {
		if (act === 'review') {
			const res = await call(`/rules/${id}/preview`);
			if (!res.ok) return ruleMsg(card, res.message, true);
			state.previews.set(id, res.data);
			card.querySelector('[data-slot="preview"]').innerHTML = previewHtml(rule, res.data);
		} else if (act === 'confirm') {
			const p = state.previews.get(id);
			const res = await call(`/rules/${id}/confirm`, { method: 'POST', body: { hash: p?.rule?.hash || rule.hash } });
			if (!res.ok) {
				if (res.code === 'rule_changed') state.previews.delete(id);
				return ruleMsg(card, res.code === 'rule_changed' ? 'This rule changed since you opened it. Review the new terms and confirm again.' : res.message, true);
			}
			state.previews.delete(id);
			flash(`"${rule.name}" is active. It runs after each complete period.`);
			await loadRules();
			return;
		} else if (act === 'pause') {
			const res = await call(`/rules/${id}/pause`, { method: 'POST', body: {} });
			if (!res.ok) return ruleMsg(card, res.message, true);
			flash(`"${rule.name}" is paused.`);
			await loadRules();
			return;
		} else if (act === 'test') {
			const res = await call(`/rules/${id}/test-run`, { method: 'POST', body: {} });
			if (!res.ok) return ruleMsg(card, res.message, true);
			const d = res.data;
			flash(d.skipped ? `Test run skipped: ${d.reason || 'nothing to do'}` : `Test run done: ${usd(d.run?.executed_usd)} of ${usd(d.run?.planned_usd)} planned. Nothing was sent.`);
			await loadRules();
			return;
		} else if (act === 'delete') {
			const res = await call(`/rules/${id}`, { method: 'DELETE' });
			if (!res.ok) return ruleMsg(card, res.message, true);
			flash(`Deleted "${rule.name}".`);
			await loadRules();
			return;
		}
	} finally {
		state.busy.delete(id);
		card.querySelectorAll('button').forEach((b) => { b.disabled = false; });
	}
}

function openRuleForm(rule = null) {
	state.editing = rule?.id || null;
	const f = els.ruleForm;
	const agentId = rule?.agent_id || state.agentId || state.agents[0]?.id || '';
	const legOf = (k) => rule?.legs.find((l) => l.kind === k);
	const sessions = state.sessions;
	f.innerHTML = `
		<h3 class="ac-section-title" style="margin:0">${rule ? 'Edit rule' : 'New reinvest rule'}</h3>
		${rule?.confirmed ? '<div class="ac-notice ac-notice-warn" style="margin:0">Saving a change switches this rule off until you confirm the new terms.</div>' : ''}
		<div class="ac-field"><label for="rf-name">Name</label><input id="rf-name" name="name" maxlength="80" value="${esc(rule?.name || 'Weekly reinvest')}" required /></div>
		<div class="ac-field"><label for="rf-agent">Agent</label><select id="rf-agent" name="agent_id" ${rule ? 'disabled' : ''}>${state.agents.map((a) => `<option value="${esc(a.id)}" ${a.id === agentId ? 'selected' : ''}>${esc(a.name || 'Unnamed agent')}</option>`).join('')}</select><small>Funds move from this agent's Solana wallet.</small></div>
		<div class="ac-inline">
			<div class="ac-field"><label for="rf-period">Runs</label><select id="rf-period" name="period">${['daily', 'weekly', 'monthly'].map((p) => `<option value="${p}" ${(rule?.period || 'weekly') === p ? 'selected' : ''}>${p[0].toUpperCase() + p.slice(1)}</option>`).join('')}</select></div>
			<div class="ac-field"><label for="rf-network">Network</label><select id="rf-network" name="network"><option value="mainnet" ${rule?.network !== 'devnet' ? 'selected' : ''}>Mainnet</option><option value="devnet" ${rule?.network === 'devnet' ? 'selected' : ''}>Devnet (no real funds)</option></select></div>
			<div class="ac-field"><label for="rf-basis">Income counted</label><select id="rf-basis" name="basis"><option value="revenue" ${rule?.basis !== 'revenue_and_trading_profit' ? 'selected' : ''}>Revenue only</option><option value="revenue_and_trading_profit" ${rule?.basis === 'revenue_and_trading_profit' ? 'selected' : ''}>Revenue plus trading profit</option></select></div>
		</div>
		<fieldset class="ac-field" style="border:0;padding:0;margin:0"><span class="lbl">Where each period's income goes (percent)</span>
			<div class="er-legs">${LEGS.map((l) => `
				<div class="er-leg" data-leg="${l.kind}">
					<div class="ac-field"><label for="rf-pct-${l.kind}">${esc(l.label)}</label><small>${esc(l.hint)}</small>
						${l.kind === 'tools_budget' ? `<select id="rf-session" aria-label="Payment session to top up" ${sessions.length ? '' : 'disabled'}>${sessions.length ? sessions.map((s) => `<option value="${esc(s.id)}" ${legOf('tools_budget')?.session_id === s.id ? 'selected' : ''}>${esc(s.label)} (${usd(s.budget_usd - s.spent_usd)} left)</option>`).join('') : '<option value="">No active payment session</option>'}</select>` : ''}
					</div>
					<div class="ac-field"><input id="rf-pct-${l.kind}" inputmode="decimal" autocomplete="off" placeholder="0" value="${legOf(l.kind)?.pct ?? ''}" aria-label="${esc(l.label)} percent" /></div>
					<span class="ac-hint" aria-hidden="true">%</span>
				</div>`).join('')}</div>
			<small id="rf-keep">Keep: 100%</small>
		</fieldset>
		<div class="ac-inline">
			<div class="ac-field"><label for="rf-per">Cap per run (USD)</label><input id="rf-per" name="per_run_cap_usd" inputmode="decimal" value="${rule?.per_run_cap_usd ?? '25'}" required /></div>
			<div class="ac-field"><label for="rf-life">Lifetime cap (USD)</label><input id="rf-life" name="lifetime_cap_usd" inputmode="decimal" value="${rule?.lifetime_cap_usd ?? '250'}" required /></div>
			<div class="ac-field"><label for="rf-min">Skip runs under (USD)</label><input id="rf-min" name="min_run_usd" inputmode="decimal" value="${rule?.min_run_usd ?? '1'}" /></div>
		</div>
		<div class="ac-form-foot"><button type="submit" class="ac-btn ac-btn-primary">${rule ? 'Save changes' : 'Create rule'}</button><button type="button" class="ac-btn" data-cancel>Cancel</button><span class="ac-form-msg" id="rf-msg" role="alert"></span></div>`;
	f.hidden = false;
	updateKeep();
	f.querySelector('#rf-name').focus();
}

function updateKeep() {
	const total = LEGS.reduce((a, l) => a + (Number($(`rf-pct-${l.kind}`)?.value) || 0), 0);
	const keep = $('rf-keep');
	keep.textContent = total > 100 ? `Over by ${Math.round((total - 100) * 100) / 100}%. The legs must add up to 100% or less.` : `Keep: ${Math.round((100 - total) * 100) / 100}%`;
	keep.style.color = total > 100 ? 'var(--danger)' : '';
}

async function submitRule(e) {
	e.preventDefault();
	const f = els.ruleForm;
	const msg = $('rf-msg');
	msg.textContent = '';
	const legs = LEGS.map((l) => ({ kind: l.kind, pct: Number($(`rf-pct-${l.kind}`).value) })).filter((l) => l.pct > 0);
	const tools = legs.find((l) => l.kind === 'tools_budget');
	if (tools) tools.session_id = $('rf-session')?.value || '';
	const body = {
		name: $('rf-name').value, period: $('rf-period').value, network: $('rf-network').value, basis: $('rf-basis').value, legs,
		per_run_cap_usd: Number($('rf-per').value), lifetime_cap_usd: Number($('rf-life').value), min_run_usd: Number($('rf-min').value || 0),
	};
	const btn = f.querySelector('[type="submit"]');
	btn.disabled = true;
	const res = state.editing
		? await call(`/rules/${state.editing}`, { method: 'PATCH', body })
		: await call('/rules', { method: 'POST', body: { ...body, agent_id: $('rf-agent').value } });
	btn.disabled = false;
	if (!res.ok) {
		msg.textContent = res.message;
		return;
	}
	f.hidden = true;
	state.previews.clear();
	flash(state.editing ? 'Rule saved. Review and confirm the new terms to switch it on.' : 'Rule created. Review and confirm its terms to switch it on.');
	await loadRules();
}

// ── boot ─────────────────────────────────────────────────────────────────────

function bind() {
	els.agent.addEventListener('change', async () => {
		state.agentId = els.agent.value;
		syncExportLinks();
		history.replaceState(null, '', `${location.pathname}${state.agentId ? `?agent=${state.agentId}` : ''}${location.hash}`);
		await Promise.all([loadLedger(), loadPublicSetting(), loadRules()]);
	});
	els.period.addEventListener('change', async () => {
		state.period = els.period.value;
		await loadLedger();
	});
	els.srcFilter.addEventListener('change', async () => {
		state.source = els.srcFilter.value;
		syncExportLinks();
		await loadEntries(true);
	});
	els.moreBtn.addEventListener('click', () => loadEntries(false));
	els.how.addEventListener('click', openDrawer);
	els.backdrop.addEventListener('click', closeDrawer);
	els.drawer.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeDrawer(); });
	document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !els.drawer.hidden) closeDrawer(); });
	els.error.addEventListener('click', (e) => { if (e.target.closest('[data-retry]')) els.error._retry?.(); });

	els.sync.addEventListener('click', async () => {
		els.sync.disabled = true;
		els.sync.textContent = 'Syncing…';
		const res = await call('/sync', { method: 'POST', body: { agent_id: state.agentId || undefined } });
		els.sync.disabled = false;
		els.sync.textContent = 'Sync now';
		if (!res.ok) return showError(`Sync failed: ${res.message}`, null);
		flash('Ledger is up to date.');
		await loadLedger();
	});

	els.pub.addEventListener('change', async () => {
		const want = els.pub.checked;
		els.pub.disabled = true;
		const res = await call(`/agents/${state.agentId}/settings`, { method: 'PUT', body: { public_earnings: want } });
		els.pub.disabled = false;
		if (!res.ok) {
			els.pub.checked = !want;
			return showError(`Could not change the public page: ${res.message}`, null);
		}
		els.pubLabel.textContent = want ? 'Public' : 'Private';
		renderPublic();
		flash(want ? 'Your earnings page is public.' : 'Your earnings page is private again.');
	});

	els.ruleNew.addEventListener('click', () => openRuleForm());
	els.ruleForm.addEventListener('submit', submitRule);
	els.ruleForm.addEventListener('input', (e) => { if (e.target.id?.startsWith('rf-pct-')) updateKeep(); });
	els.ruleForm.addEventListener('click', (e) => { if (e.target.closest('[data-cancel]')) els.ruleForm.hidden = true; });
	els.rules.addEventListener('click', (e) => {
		const b = e.target.closest('[data-act]');
		const card = e.target.closest('[data-rule]');
		if (b && card) ruleAction(card, b.dataset.act);
	});
}

function syncExportLinks() {
	els.csv.href = `${API}/export${qs({ format: 'csv', source: state.source })}`;
	els.json.href = `${API}/export${qs({ format: 'json', source: state.source })}`;
}

async function boot() {
	Object.assign(els, {
		main: $('er-main'), auth: $('er-auth'), login: $('er-login'), skel: $('er-skel'), error: $('er-error'), flash: $('er-flash'), live: $('er-live'),
		agent: $('er-agent'), period: $('er-period'), sync: $('er-sync'), csv: $('er-csv'), json: $('er-json'), how: $('er-how'),
		stats: $('er-stats'), chart: $('er-chart'), sources: $('er-sources'), proj: $('er-proj'), rec: $('er-rec'),
		pubPanel: $('er-pub-panel'), pub: $('er-pub'), pubLabel: $('er-pub-label'), pubLink: $('er-pub-link'),
		ledger: $('er-ledger'), more: $('er-more'), moreBtn: $('er-more-btn'), srcFilter: $('er-src-filter'),
		rules: $('er-rules'), ruleForm: $('er-rule-form'), ruleNew: $('er-rule-new'),
		drawer: $('er-drawer'), backdrop: $('er-backdrop'),
	});
	els.statNote = document.createElement('p');
	els.statNote.className = 'ac-hint';
	els.statNote.hidden = true;
	els.stats.after(els.statNote);
	bind();

	const agents = await apiFetch('/api/agents', { allowAnonymous: true, headers: { accept: 'application/json' } }).catch(() => null);
	if (!agents) return showError('Network error. Check your connection and try again.', boot);
	if (agents.status === 401) return showAuthWall();
	const json = await agents.json().catch(() => ({}));
	if (!agents.ok) return showError(`Could not load your agents: ${json?.error?.message || agents.status}`, boot);
	state.agents = (json?.data ?? json)?.agents || [];
	els.agent.innerHTML = `<option value="">All agents</option>${state.agents.map((a) => `<option value="${esc(a.id)}">${esc(a.name || 'Unnamed agent')}</option>`).join('')}`;
	const want = new URLSearchParams(location.search).get('agent');
	if (want && state.agents.some((a) => a.id === want)) {
		state.agentId = want;
		els.agent.value = want;
	}
	syncExportLinks();

	const sess = await call('/sessions');
	state.sessions = sess.ok ? sess.data.sessions || [] : [];

	await Promise.all([loadLedger(), loadPublicSetting(), loadRules()]);
	if (location.hash === '#rules') $('rules').scrollIntoView();
}

boot();
