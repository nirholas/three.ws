/**
 * Credits tile: an agent pays for its own model usage from its wallet.
 *
 * One component, two mounts:
 *   • the "Credits" tab of the Agent Wallet hub (full: top-up flow, budget
 *     editor, auto top-up rule, recent top-ups, developer base URL);
 *   • the owner's agent page (compact: balance, runway, budget meter and the
 *     one action that matters right now, linking into the wallet tab).
 *
 * Data: GET /api/agents/:id/credits (api/agents/_id/credits.js). Writes: the
 * two-step top-up (POST .../credits/topup/preview, then .../credits/topup with
 * confirm_deposit and the preview_id), PATCH /api/agents/:id { inferenceBudget },
 * and PUT .../credits/auto-fund. Every state is designed: loading skeleton,
 * signed-out or not-owner (renders nothing), fetch error with retry, empty
 * wallet, out of credits, budget exhausted with the exact recovery, preview,
 * settling, settled, pending and failed.
 */

import { consumeCsrfToken } from './api.js';

const STYLE_ID = 'ic-style';
const AMOUNTS = [1, 5, 20];

const STYLE = `
.ic { display:flex; flex-direction:column; gap: var(--space-3,12px); }
.ic-card { border:1px solid var(--stroke,rgba(255,255,255,.08)); border-radius: var(--radius-lg,14px); background: var(--surface-1,rgba(255,255,255,.03)); padding: var(--space-4,16px) var(--space-5,20px); animation: ic-in var(--duration-base,220ms) var(--ease-out,ease); }
.ic-h { display:flex; align-items:center; justify-content:space-between; gap:10px; margin:0 0 var(--space-3,12px); font-size: var(--text-2xs,.6875rem); text-transform:uppercase; letter-spacing:.06em; color: var(--ink-dim,#888); }
.ic-hero { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap; }
.ic-bal { font-family: var(--font-display,'Space Grotesk',sans-serif); font-size: 2rem; font-weight:600; color: var(--ink-bright,#fff); line-height:1; font-variant-numeric: tabular-nums; }
.ic-bal small { font-size: var(--text-sm,.764rem); font-weight:400; color: var(--ink-dim,#888); margin-left:6px; }
.ic-runway { font-size: var(--text-sm,.764rem); color: var(--ink-dim,#888); margin-top:6px; }
.ic-runway strong { color: var(--ink,#e8e8e8); }
.ic-stats { display:flex; gap:8px; flex-wrap:wrap; }
.ic-stat { background: var(--surface-2,rgba(255,255,255,.05)); border:1px solid var(--stroke,rgba(255,255,255,.08)); border-radius: var(--radius-md,10px); padding:8px 11px; min-width:92px; }
.ic-stat .l { font-size: var(--text-2xs,.6875rem); color: var(--ink-dim,#888); text-transform:uppercase; letter-spacing:.03em; }
.ic-stat .n { font-family: var(--font-mono,ui-monospace,monospace); font-size: var(--text-md,.8125rem); color: var(--ink-bright,#fff); margin-top:3px; }
.ic-meter { margin-top: var(--space-3,12px); }
.ic-meter-row { display:flex; justify-content:space-between; gap:8px; font-size: var(--text-sm,.764rem); color: var(--ink,#e8e8e8); margin-bottom:5px; }
.ic-meter-row span:last-child { font-family: var(--font-mono,ui-monospace,monospace); color: var(--ink-dim,#888); }
.ic-bar { height:6px; border-radius:4px; background: var(--surface-2,rgba(255,255,255,.07)); overflow:hidden; }
.ic-bar > i { display:block; height:100%; border-radius:4px; background: var(--accent,#8ab4ff); transition: width var(--duration-base,220ms) var(--ease-out,ease); }
.ic-bar[data-tone="warn"] > i { background: var(--warn,#fbbf24); }
.ic-bar[data-tone="bad"] > i { background: var(--danger,#f87171); }
.ic-banner { display:flex; gap:12px; align-items:flex-start; justify-content:space-between; flex-wrap:wrap; padding:11px 13px; border-radius: var(--radius-md,10px); font-size: var(--text-sm,.764rem); line-height:1.5; color: var(--ink,#e8e8e8); }
.ic-banner strong { display:block; color: var(--ink-bright,#fff); font-size: var(--text-md,.8125rem); margin-bottom:2px; }
.ic-banner[data-tone="bad"] { background: color-mix(in srgb, var(--danger,#f87171) 9%, transparent); border:1px solid color-mix(in srgb, var(--danger,#f87171) 35%, transparent); }
.ic-banner[data-tone="warn"] { background: color-mix(in srgb, var(--warn,#fbbf24) 8%, transparent); border:1px solid color-mix(in srgb, var(--warn,#fbbf24) 30%, transparent); }
.ic-banner[data-tone="ok"] { background: color-mix(in srgb, var(--success,#4ade80) 8%, transparent); border:1px solid color-mix(in srgb, var(--success,#4ade80) 30%, transparent); }
.ic-banner a { color: var(--ink-bright,#fff); }
.ic-banner .ic-actions { margin:0; }
.ic-actions { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-top: var(--space-3,12px); }
.ic-btn { appearance:none; font:inherit; font-size: var(--text-md,.8125rem); color: var(--ink,#e8e8e8); background: var(--surface-2,rgba(255,255,255,.05)); border:1px solid var(--stroke,rgba(255,255,255,.1)); border-radius: var(--radius-md,10px); padding:8px 14px; cursor:pointer; text-decoration:none; display:inline-flex; align-items:center; gap:6px; transition: background var(--duration-fast,140ms), border-color var(--duration-fast,140ms), transform var(--duration-instant,80ms); }
.ic-btn:hover:not(:disabled) { background: var(--surface-3,rgba(255,255,255,.09)); border-color: var(--stroke-strong,rgba(255,255,255,.16)); }
.ic-btn:active:not(:disabled) { transform: translateY(1px); }
.ic-btn:focus-visible, .ic-chip:focus-visible, .ic-input:focus-visible, .ic-switch:focus-visible { outline: var(--focus-ring-width,2px) solid var(--focus-ring-color,#fff); outline-offset: var(--focus-ring-offset,2px); }
.ic-btn:disabled { opacity: var(--disabled-opacity,.45); cursor: not-allowed; }
.ic-btn--primary { background: var(--accent,#fff); color:#0a0a0a; border-color: var(--accent,#fff); font-weight:600; }
.ic-btn--primary:hover:not(:disabled) { background: color-mix(in srgb, var(--accent,#fff) 88%, #000); }
.ic-chip { appearance:none; font:inherit; font-size: var(--text-sm,.764rem); font-weight:600; color: var(--ink,#e8e8e8); background: var(--surface-2,rgba(255,255,255,.05)); border:1px solid var(--stroke,rgba(255,255,255,.1)); border-radius: var(--radius-pill,999px); padding:6px 14px; cursor:pointer; transition: background var(--duration-fast,140ms), border-color var(--duration-fast,140ms); }
.ic-chip:hover { background: var(--surface-3,rgba(255,255,255,.09)); }
.ic-chip:active { transform: translateY(1px); }
.ic-chip[aria-pressed="true"] { border-color: var(--accent,#fff); color: var(--ink-bright,#fff); background: color-mix(in srgb, var(--accent,#fff) 12%, transparent); }
.ic-input { font:inherit; font-size: var(--text-md,.8125rem); color: var(--ink,#e8e8e8); background: var(--surface-1,rgba(255,255,255,.03)); border:1px solid var(--stroke,rgba(255,255,255,.12)); border-radius: var(--radius-md,10px); padding:7px 10px; width:110px; font-variant-numeric: tabular-nums; transition: border-color var(--duration-fast,140ms); }
.ic-input:hover { border-color: var(--stroke-strong,rgba(255,255,255,.18)); }
.ic-field { display:flex; flex-direction:column; gap:4px; font-size: var(--text-2xs,.6875rem); color: var(--ink-dim,#888); text-transform:uppercase; letter-spacing:.04em; }
.ic-sr { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
.ic-note { font-size: var(--text-sm,.764rem); color: var(--ink-dim,#888); line-height:1.5; margin:0; }
.ic-note a { color: var(--ink,#e8e8e8); }
.ic-note code, .ic-mono { font-family: var(--font-mono,ui-monospace,monospace); font-size: .92em; }
.ic-table { width:100%; border-collapse:collapse; font-size: var(--text-sm,.8125rem); margin-top:4px; }
.ic-table th { text-align:left; font-weight:400; color: var(--ink-dim,#888); padding:7px 12px 7px 0; white-space:nowrap; vertical-align:top; width:1%; }
.ic-table td { color: var(--ink-bright,#fff); padding:7px 0; word-break:break-all; font-variant-numeric: tabular-nums; }
.ic-table tr + tr th, .ic-table tr + tr td { border-top:1px solid var(--stroke,rgba(255,255,255,.06)); }
.ic-expiry { font-size: var(--text-2xs,.6875rem); color: var(--ink-dim,#888); text-transform:none; letter-spacing:0; }
.ic-list { list-style:none; margin:0; padding:0; }
.ic-list li { display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:8px 0; border-bottom:1px solid var(--stroke,rgba(255,255,255,.06)); font-size: var(--text-sm,.8125rem); }
.ic-list li:last-child { border-bottom:none; }
.ic-list .amt { font-family: var(--font-mono,ui-monospace,monospace); color: var(--ink-bright,#fff); }
.ic-list .when { color: var(--ink-dim,#888); margin-left:auto; font-size: var(--text-2xs,.6875rem); }
.ic-list a { color: var(--ink,#e8e8e8); }
.ic-pill { font-size: var(--text-2xs,.6875rem); font-weight:600; padding:2px 8px; border-radius: var(--radius-pill,999px); background: var(--surface-2,rgba(255,255,255,.06)); color: var(--ink-dim,#888); white-space:nowrap; }
.ic-pill[data-tone="ok"] { color: var(--success,#4ade80); background: color-mix(in srgb, var(--success,#4ade80) 12%, transparent); }
.ic-pill[data-tone="warn"] { color: var(--warn,#fbbf24); background: color-mix(in srgb, var(--warn,#fbbf24) 12%, transparent); }
.ic-pill[data-tone="bad"] { color: var(--danger,#f87171); background: color-mix(in srgb, var(--danger,#f87171) 12%, transparent); }
.ic-row { display:flex; gap:12px; align-items:flex-end; flex-wrap:wrap; }
.ic-switch { appearance:none; width:38px; height:22px; border-radius:999px; background: var(--surface-3,rgba(255,255,255,.12)); border:1px solid var(--stroke,rgba(255,255,255,.12)); position:relative; cursor:pointer; flex:none; padding:0; transition: background var(--duration-fast,140ms); }
.ic-switch::after { content:''; position:absolute; top:2px; left:2px; width:16px; height:16px; border-radius:50%; background: var(--ink-bright,#fff); transition: transform var(--duration-fast,140ms) var(--ease-out,ease); }
.ic-switch:hover { border-color: var(--stroke-strong,rgba(255,255,255,.2)); }
.ic-switch[aria-checked="true"] { background: var(--success,#4ade80); }
.ic-switch[aria-checked="true"]::after { transform: translateX(16px); }
.ic-skel { height:14px; border-radius:6px; background: linear-gradient(90deg, var(--surface-2,rgba(255,255,255,.05)), var(--surface-3,rgba(255,255,255,.1)), var(--surface-2,rgba(255,255,255,.05))); background-size:200% 100%; animation: ic-shimmer 1.2s linear infinite; }
.ic-skel + .ic-skel { margin-top:10px; }
.ic-spin { width:12px; height:12px; border-radius:50%; border:2px solid currentColor; border-right-color:transparent; animation: ic-rot .7s linear infinite; }
@keyframes ic-in { from { opacity:0; transform: translateY(4px); } to { opacity:1; transform:none; } }
@keyframes ic-shimmer { to { background-position: -200% 0; } }
@keyframes ic-rot { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .ic-card, .ic-skel, .ic-spin, .ic-bar > i { animation:none; transition:none; } }
@media (max-width: 520px) { .ic-bal { font-size:1.6rem; } .ic-input { width:96px; } .ic-card { padding: var(--space-3,12px) var(--space-4,16px); } }
`;

function injectStyle() {
	if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
	const tag = document.createElement('style');
	tag.id = STYLE_ID;
	tag.textContent = STYLE;
	document.head.appendChild(tag);
}

function esc(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function usd(n, digits) {
	const v = Number(n) || 0;
	const d = digits ?? (Math.abs(v) >= 1 || v === 0 ? 2 : 4);
	return `$${v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

function budgetUsd(v) {
	return usd(v, v < 1 ? 4 : 2);
}

function short(addr) {
	const s = String(addr || '');
	return s.length > 12 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s;
}

function ago(iso) {
	if (!iso) return '';
	const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
	if (s < 60) return 'just now';
	if (s < 3600) return `${Math.floor(s / 60)}m ago`;
	if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
	return `${Math.floor(s / 86400)}d ago`;
}

function until(iso) {
	const s = Math.max(0, (new Date(iso).getTime() - Date.now()) / 1000);
	if (s < 3600) return `${Math.max(1, Math.ceil(s / 60))} min`;
	return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/** A raised budget that actually readmits calls (mirrors suggestedBudget on the server). */
function suggestedBudget(limit, spent) {
	return Math.round(Math.max((limit || 0) * 2, (spent || 0) * 1.5) * 1e6) / 1e6;
}

/** Never throws: a designed { ok, status, data | code, message, body } result. */
async function call(url, { method = 'GET', body = null } = {}) {
	try {
		const opts = { method, credentials: 'include', headers: {} };
		if (body != null) {
			opts.headers['content-type'] = 'application/json';
			opts.body = JSON.stringify(body);
		}
		if (method !== 'GET') {
			const token = await consumeCsrfToken();
			if (token) opts.headers['x-csrf-token'] = token;
		}
		const r = await fetch(url, opts);
		let j = null;
		try {
			j = await r.json();
		} catch {
			j = null;
		}
		if (!r.ok) {
			return { ok: false, status: r.status, code: j?.error || 'error', message: j?.error_description || `Request failed (${r.status})`, body: j };
		}
		return { ok: true, status: r.status, data: j };
	} catch {
		return { ok: false, status: 0, code: 'network_error', message: 'Could not reach three.ws. Check your connection and retry.' };
	}
}

function meter(label, spent, limit) {
	if (limit == null) return '';
	const pct = Math.min(100, (spent / limit) * 100);
	const tone = pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : '';
	return `
		<div class="ic-meter">
			<div class="ic-meter-row"><span>${esc(label)}</span><span>${usd(spent, 4)} of ${budgetUsd(limit)}</span></div>
			<div class="ic-bar" data-tone="${tone}" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><i style="width:${pct}%"></i></div>
		</div>`;
}

function statusTone(status) {
	return status === 'settled' ? 'ok' : status === 'failed' ? 'bad' : 'warn';
}

function sourceLabel(source) {
	return source === 'intent' ? 'auto' : source === 'provision' ? 'API key' : 'manual';
}

/**
 * Mount the credits tile.
 * @param {HTMLElement} root
 * @param {{ agentId: string, compact?: boolean, walletHref?: string }} opts
 * @returns {{ refresh: () => Promise<void>, destroy: () => void }}
 */
export function mountInferenceCredits(root, { agentId, compact = false, walletHref } = {}) {
	injectStyle();
	const base = `/api/agents/${encodeURIComponent(agentId)}`;
	const wallet = walletHref || `/agents/${encodeURIComponent(agentId)}/wallet#credits`;
	let state = { data: null, amount: 5, preview: null, busy: false, result: null, flash: null, editingBudget: false };
	let expiryTimer = null;
	let alive = true;

	function set(patch) {
		state = { ...state, ...patch };
		render();
	}

	function skeleton() {
		return `<div class="ic"><div class="ic-card" aria-busy="true" aria-label="Loading credits"><div class="ic-skel" style="width:30%"></div><div class="ic-skel" style="width:55%;height:28px"></div><div class="ic-skel" style="width:80%"></div></div></div>`;
	}

	async function refresh() {
		if (!state.data) root.innerHTML = skeleton();
		const r = await call(`${base}/credits`);
		if (!alive) return;
		if (!r.ok) {
			// An owner-only surface: signed-out visitors and non-owners see nothing.
			if (r.status === 401 || r.status === 403 || r.status === 404) {
				root.innerHTML = '';
				root.hidden = true;
				return;
			}
			root.hidden = false;
			root.innerHTML = `<div class="ic"><div class="ic-card"><div class="ic-banner" data-tone="bad" role="alert"><div><strong>Credits could not load</strong>${esc(r.message)}</div><div class="ic-actions"><button type="button" class="ic-btn" data-act="retry">Retry</button></div></div></div></div>`;
			return;
		}
		root.hidden = false;
		set({ data: r.data });
	}

	function banners(d) {
		const out = [];
		const ex = d.agent?.exhausted;
		if (ex) {
			const w = ex.window === 'daily' ? 'daily' : 'monthly';
			const limit = w === 'daily' ? d.agent.budget?.daily_usd : d.agent.budget?.monthly_usd;
			const spent = w === 'daily' ? d.agent.spend?.today_usd : d.agent.spend?.month_usd;
			const suggested = suggestedBudget(limit, spent);
			out.push(`
				<div class="ic-banner" data-tone="bad" role="alert">
					<div><strong>${w === 'daily' ? 'Daily' : 'Monthly'} inference budget used</strong>
					Model calls for this agent are refused${ex.stopped ? ' and its automations are stopped' : ''} until the budget resets in ${esc(until(ex.resets_at))}, or you raise it now.</div>
					<div class="ic-actions">
						<button type="button" class="ic-btn ic-btn--primary" data-act="raise" data-window="${w}" data-value="${suggested}" ${state.busy ? 'disabled' : ''}>Raise ${w} budget to ${budgetUsd(suggested)}</button>
						${compact ? '' : '<button type="button" class="ic-btn" data-act="edit-budget">Edit budget</button>'}
					</div>
				</div>`);
		}
		if (d.balance_usd < 0.001) {
			out.push(`
				<div class="ic-banner" data-tone="warn" role="status">
					<div><strong>Out of credits</strong>Metered model calls answer 402 until the balance is topped up. ${compact ? `<a href="${esc(wallet)}">Top up from this agent's wallet</a>.` : 'Move USDC in from this agent\'s wallet below.'}</div>
				</div>`);
		}
		if (state.flash) {
			out.push(`<div class="ic-banner" data-tone="bad" role="alert"><div>${esc(state.flash)}</div><div class="ic-actions"><button type="button" class="ic-btn" data-act="dismiss">Dismiss</button></div></div>`);
		}
		return out.join('');
	}

	function heroCard(d) {
		const runway =
			d.days_remaining != null
				? `About <strong>${esc(d.days_remaining)}</strong> day${d.days_remaining === 1 ? '' : 's'} left at ${usd(d.burn_rate_usd_per_day, 4)} a day`
				: d.calls_7d > 0
					? 'Burning under a hundredth of a cent a day'
					: 'No metered model calls in the last 7 days';
		const b = d.agent?.budget;
		const spend = d.agent?.spend || { today_usd: 0, month_usd: 0, calls_today: 0 };
		return `
			<div class="ic-card">
				<div class="ic-h"><span>Inference credits</span>${compact ? `<a class="ic-btn" href="${esc(wallet)}">Manage</a>` : ''}</div>
				<div class="ic-hero">
					<div>
						<div class="ic-bal">${usd(d.balance_usd)}<small>credits</small></div>
						<div class="ic-runway">${runway}</div>
					</div>
					<div class="ic-stats">
						<div class="ic-stat"><div class="l">Today</div><div class="n">${usd(spend.today_usd, 4)}</div></div>
						<div class="ic-stat"><div class="l">This month</div><div class="n">${usd(spend.month_usd, 4)}</div></div>
						<div class="ic-stat"><div class="l">Calls today</div><div class="n">${esc(spend.calls_today)}</div></div>
					</div>
				</div>
				${b ? meter('Daily budget', spend.today_usd, b.daily_usd) + meter('Monthly budget', spend.month_usd, b.monthly_usd) : `<p class="ic-note" style="margin-top:12px">No inference budget: this agent's model calls may draw the whole balance.${compact ? '' : ' Set one below.'}</p>`}
				${compact ? `<div class="ic-actions"><a class="ic-btn ic-btn--primary" href="${esc(wallet)}">Top up from wallet</a></div>` : ''}
			</div>`;
	}

	function resultCard(r) {
		const tone = statusTone(r.status);
		const title =
			r.status === 'settled'
				? `Added ${usd(r.credits_usd)} of credits`
				: r.status === 'pending'
					? 'Broadcast, waiting for Solana to confirm'
					: 'Top-up failed, nothing moved';
		const body =
			r.status === 'settled'
				? `${esc(r.amount_usdc)} USDC moved from the agent wallet to the three.ws treasury.`
				: esc(r.note || r.message || '');
		return `
			<div class="ic-card">
				<div class="ic-h"><span>Top up from wallet</span></div>
				<div class="ic-banner" data-tone="${tone}" role="status">
					<div><strong>${esc(title)}</strong>${body}
					${r.signature ? `<div style="margin-top:4px"><a href="${esc(r.explorer_url)}" target="_blank" rel="noopener" class="ic-mono">${esc(short(r.signature))} ↗</a></div>` : ''}</div>
					<div class="ic-actions"><button type="button" class="ic-btn" data-act="done">${r.status === 'pending' ? 'Check again' : 'Done'}</button></div>
				</div>
			</div>`;
	}

	function previewCard(p) {
		return `
			<div class="ic-card">
				<div class="ic-h"><span>Confirm top-up</span><span class="ic-expiry" data-expiry>Valid for ${esc(until(p.expires_at))}</span></div>
				<table class="ic-table" aria-label="Top-up details">
					<tr><th scope="row">From</th><td class="ic-mono">${esc(p.from)} <span class="ic-pill">agent wallet</span></td></tr>
					<tr><th scope="row">To</th><td class="ic-mono">${esc(p.to)} <span class="ic-pill">${esc(p.to_label)}</span></td></tr>
					<tr><th scope="row">Amount</th><td>${esc(p.amount_usdc)} ${esc(p.token)}</td></tr>
					<tr><th scope="row">Chain</th><td>Solana ${esc(p.network)}</td></tr>
					<tr><th scope="row">Credits</th><td>+${usd(p.credits_usd)} at ${esc(p.rate)} credit per USDC, no fee</td></tr>
					<tr><th scope="row">Network fee</th><td>${esc(p.network_fee)}</td></tr>
					<tr><th scope="row">After</th><td>${usd(p.balance_after_usd)} credits · ${esc(p.wallet_usdc_after)} USDC left in the wallet</td></tr>
				</table>
				<p class="ic-note" style="margin-top:10px">An on-chain transfer. It cannot be undone once confirmed.</p>
				<div class="ic-actions">
					<button type="button" class="ic-btn ic-btn--primary" data-act="confirm" ${state.busy ? 'disabled' : ''}>${state.busy ? '<span class="ic-spin" aria-hidden="true"></span> Signing and settling on Solana' : `Confirm and move ${esc(p.amount_usdc)} USDC`}</button>
					<button type="button" class="ic-btn" data-act="cancel" ${state.busy ? 'disabled' : ''}>Cancel</button>
				</div>
			</div>`;
	}

	function topupCard(d) {
		if (state.result) return resultCard(state.result);
		if (state.preview) return previewCard(state.preview);
		const custom = AMOUNTS.includes(state.amount) ? '' : esc(state.amount);
		return `
			<div class="ic-card">
				<div class="ic-h"><span>Top up from wallet</span></div>
				<p class="ic-note">Move USDC from this agent's wallet into your account credits. 1 USDC buys ${usd(d.pricing.usdc_credit_rate)} of credits with no fee, and three.ws pays the Solana network fee.</p>
				<div class="ic-actions" role="group" aria-label="Amount in USDC">
					${AMOUNTS.map((a) => `<button type="button" class="ic-chip" data-act="amount" data-value="${a}" aria-pressed="${state.amount === a}">${a} USDC</button>`).join('')}
					<label><span class="ic-sr">Custom amount in USDC</span><input class="ic-input" type="number" min="0.1" max="1000" step="0.1" inputmode="decimal" data-field="amount" value="${custom}" placeholder="Other"></label>
					<button type="button" class="ic-btn ic-btn--primary" data-act="preview" ${state.busy ? 'disabled' : ''}>${state.busy ? '<span class="ic-spin" aria-hidden="true"></span> Checking the wallet' : 'Preview'}</button>
				</div>
			</div>`;
	}

	function budgetCard(d) {
		const b = d.agent?.budget;
		const editing = state.editingBudget || !b;
		const body = editing
			? `
				<p class="ic-note">Cap what this agent's model calls may spend. Past a cap, calls are refused, the agent's automations stop and you are notified. Leave a field empty for no cap.</p>
				<div class="ic-row" style="margin-top:10px">
					<label class="ic-field">Daily (USD)<input class="ic-input" type="number" min="0" step="0.01" data-field="daily" value="${esc(b?.daily_usd ?? '')}" placeholder="None"></label>
					<label class="ic-field">Monthly (USD)<input class="ic-input" type="number" min="0" step="0.01" data-field="monthly" value="${esc(b?.monthly_usd ?? '')}" placeholder="None"></label>
					<button type="button" class="ic-btn ic-btn--primary" data-act="save-budget" ${state.busy ? 'disabled' : ''}>Save budget</button>
					${b ? '<button type="button" class="ic-btn" data-act="clear-budget">Remove</button>' : ''}
					${state.editingBudget ? '<button type="button" class="ic-btn" data-act="cancel-budget">Cancel</button>' : ''}
				</div>`
			: `<p class="ic-note">${b.daily_usd != null ? `${budgetUsd(b.daily_usd)} a day` : 'No daily cap'} · ${b.monthly_usd != null ? `${budgetUsd(b.monthly_usd)} a month` : 'no monthly cap'}. Windows reset at 00:00 UTC.</p>`;
		return `
			<div class="ic-card">
				<div class="ic-h"><span>Inference budget</span>${b && !state.editingBudget ? '<button type="button" class="ic-btn" data-act="edit-budget">Edit</button>' : ''}</div>
				${body}
			</div>`;
	}

	function autoFundCard(d) {
		const af = d.auto_fund;
		const on = !!af?.enabled;
		const lastTone = af?.last_status === 'ok' ? 'ok' : af?.last_status === 'error' ? 'bad' : 'warn';
		return `
			<div class="ic-card">
				<div class="ic-h"><span>Keep it thinking</span>
					<button type="button" class="ic-switch" role="switch" aria-checked="${on}" aria-label="Automatic top-up" data-act="toggle-auto"></button></div>
				<p class="ic-note">When credits fall below the floor, top up from this agent's wallet automatically, at most once a day. It runs through the same spend limits as every other payment the agent makes.</p>
				<div class="ic-row" style="margin-top:10px">
					<label class="ic-field">Floor (USD)<input class="ic-input" type="number" min="0.01" step="0.5" data-field="threshold" value="${esc(af?.threshold_usd ?? 1)}"></label>
					<label class="ic-field">Top up (USDC)<input class="ic-input" type="number" min="0.1" max="1000" step="0.5" data-field="auto-amount" value="${esc(af?.amount_usdc ?? 5)}"></label>
					<button type="button" class="ic-btn" data-act="save-auto">${af ? (on ? 'Update rule' : 'Update and arm') : 'Arm rule'}</button>
				</div>
				${af?.last_fired_at ? `<p class="ic-note" style="margin-top:10px">Last run ${esc(ago(af.last_fired_at))}: <span class="ic-pill" data-tone="${lastTone}">${esc(af.last_status)}</span> ${esc(af.last_note || '')}</p>` : ''}
			</div>`;
	}

	function historyCard(d) {
		if (!d.topups.length) {
			return `<div class="ic-card"><div class="ic-h"><span>Recent top-ups</span></div><p class="ic-note">No top-ups yet. Each one appears here with its Solana signature.</p></div>`;
		}
		return `
			<div class="ic-card">
				<div class="ic-h"><span>Recent top-ups</span></div>
				<ul class="ic-list">
					${d.topups
						.map(
							(t) => `
						<li>
							<span class="ic-pill" data-tone="${statusTone(t.status)}">${esc(t.status)}</span>
							<span class="amt">${esc(t.amount_usdc)} USDC → ${usd(t.credits_usd)}</span>
							<span class="ic-pill">${esc(sourceLabel(t.source))}</span>
							${t.signature ? `<a href="${esc(t.explorer_url)}" target="_blank" rel="noopener" class="ic-mono">${esc(short(t.signature))} ↗</a>` : ''}
							${t.status === 'failed' && t.error ? `<span class="ic-note">${esc(t.error)}</span>` : ''}
							<span class="when">${esc(ago(t.created_at))}</span>
						</li>`,
						)
						.join('')}
				</ul>
			</div>`;
	}

	function devCard(d) {
		return `
			<div class="ic-card">
				<div class="ic-h"><span>Use from code</span></div>
				<p class="ic-note">Any OpenAI-compatible client works: base URL <code>https://three.ws/api/v1</code>, model <code>${esc(d.pricing.model)}</code>, and a key with the <code>inference</code> scope. Calls cost ${usd(d.pricing.input_usd_per_mtok)} per million input tokens and ${usd(d.pricing.output_usd_per_mtok)} per million output tokens. <a href="/docs/inference-billing">How it works</a></p>
				<div class="ic-actions"><button type="button" class="ic-btn" data-act="copy-base">Copy base URL</button><a class="ic-btn" href="/dashboard/api">API keys</a></div>
			</div>`;
	}

	function render() {
		const d = state.data;
		if (!d) return;
		const cards = compact
			? [banners(d), heroCard(d)]
			: [banners(d), heroCard(d), topupCard(d), budgetCard(d), autoFundCard(d), historyCard(d), devCard(d)];
		root.innerHTML = `<div class="ic">${cards.join('')}</div>`;
		clearInterval(expiryTimer);
		if (state.preview && !state.busy) {
			expiryTimer = setInterval(() => {
				if (!state.preview) return clearInterval(expiryTimer);
				if (new Date(state.preview.expires_at).getTime() <= Date.now()) {
					set({ preview: null, flash: 'That preview expired. Preview again to get a fresh one.' });
					return;
				}
				const el = root.querySelector('[data-expiry]');
				if (el) el.textContent = `Valid for ${until(state.preview.expires_at)}`;
			}, 15_000);
		}
	}

	function field(name) {
		return root.querySelector(`[data-field="${name}"]`);
	}

	async function saveBudget(budget) {
		set({ busy: true, flash: null });
		const r = await call(base, { method: 'PATCH', body: { inferenceBudget: budget } });
		if (!r.ok) {
			set({ busy: false, flash: r.message });
			return;
		}
		set({ busy: false, editingBudget: false });
		await refresh();
	}

	async function saveAutoFund(enabled) {
		const threshold = Number(field('threshold')?.value);
		const amount = Number(field('auto-amount')?.value);
		if (!(threshold > 0)) return set({ flash: 'Set a floor above $0 for the automatic top-up.' });
		if (!(amount >= 0.1)) return set({ flash: 'The automatic top-up must be at least 0.1 USDC.' });
		set({ busy: true, flash: null });
		const r = await call(`${base}/credits/auto-fund`, {
			method: 'PUT',
			body: { enabled, threshold_usd: threshold, amount_usdc: amount },
		});
		if (!r.ok) return set({ busy: false, flash: r.message });
		set({ busy: false, data: { ...state.data, auto_fund: r.data.auto_fund } });
	}

	async function onClick(e) {
		const btn = e.target.closest('[data-act]');
		if (!btn || !root.contains(btn) || btn.disabled) return;
		const act = btn.dataset.act;

		switch (act) {
			case 'retry':
				return refresh();
			case 'dismiss':
				return set({ flash: null });
			case 'amount': {
				const input = field('amount');
				if (input) input.value = '';
				return set({ amount: Number(btn.dataset.value), flash: null });
			}
			case 'cancel':
				return set({ preview: null });
			case 'done': {
				const pending = state.result?.status === 'pending';
				set({ result: null, preview: null });
				if (pending) return refresh();
				return undefined;
			}
			case 'edit-budget':
				return set({ editingBudget: true });
			case 'cancel-budget':
				return set({ editingBudget: false });
			case 'copy-base':
				try {
					await navigator.clipboard.writeText('https://three.ws/api/v1');
					btn.textContent = 'Copied';
				} catch {
					btn.textContent = 'https://three.ws/api/v1';
				}
				return undefined;
			case 'preview': {
				const custom = Number(field('amount')?.value);
				const amount = custom > 0 ? custom : state.amount;
				set({ busy: true, flash: null, amount });
				const r = await call(`${base}/credits/topup/preview`, { method: 'POST', body: { amount_usdc: amount } });
				if (!r.ok) {
					const hint =
						r.code === 'insufficient_usdc' && r.body?.deposit_address
							? ` Deposit USDC to ${r.body.deposit_address} from the Deposit tab first.`
							: '';
					return set({ busy: false, flash: r.message + hint });
				}
				return set({ busy: false, preview: r.data });
			}
			case 'confirm': {
				set({ busy: true });
				const r = await call(`${base}/credits/topup`, {
					method: 'POST',
					body: { preview_id: state.preview.preview_id, confirm_deposit: true },
				});
				set({ busy: false, preview: null, result: r.ok ? r.data : { status: 'failed', message: r.message } });
				if (r.ok) {
					const fresh = await call(`${base}/credits`);
					if (fresh.ok && alive) set({ data: fresh.data });
				}
				return undefined;
			}
			case 'raise': {
				const current = state.data.agent?.budget || {};
				return saveBudget({
					daily: current.daily_usd ?? null,
					monthly: current.monthly_usd ?? null,
					[btn.dataset.window]: Number(btn.dataset.value),
				});
			}
			case 'save-budget': {
				const daily = field('daily')?.value.trim();
				const monthly = field('monthly')?.value.trim();
				return saveBudget({ daily: daily ? Number(daily) : null, monthly: monthly ? Number(monthly) : null });
			}
			case 'clear-budget':
				return saveBudget(null);
			case 'toggle-auto':
				return saveAutoFund(!state.data.auto_fund?.enabled);
			case 'save-auto':
				return saveAutoFund(true);
			default:
				return undefined;
		}
	}

	root.addEventListener('click', onClick);
	refresh();

	return {
		refresh,
		destroy() {
			alive = false;
			clearInterval(expiryTimer);
			root.removeEventListener('click', onClick);
			root.innerHTML = '';
		},
	};
}
