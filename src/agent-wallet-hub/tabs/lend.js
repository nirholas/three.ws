/**
 * Agent Wallet hub - Lend tab. Owner-only.
 *
 * Puts idle agent funds to work on Solana lending (guide: docs/agent-lending.md).
 * Shows the agent's lending position, live supply APY, the earn rule, and a
 * deposit / withdraw form. Nothing moves without two steps: the form first asks
 * the API for a simulated preview (checks, compute units, projected interest),
 * then the owner presses an explicit confirm button, which re-sends the same
 * request with confirm:true. Every number comes from
 * /api/v1/agents/:id/lending/*.
 */

import { registerWalletTab } from '../registry.js';
import { consumeCsrfToken } from '../../api.js';
import { explorerTxUrl } from '../util.js';

const STYLE_ID = 'awh-lend-style';
const STYLE = `
.awl-grid { display: grid; gap: var(--space-3,12px); grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
.awl-stat { background: var(--surface-1,rgba(255,255,255,.03)); border: 1px solid var(--stroke,rgba(255,255,255,.08)); border-radius: var(--radius-md,10px); padding: 11px 12px; }
.awl-stat b { display: block; font-family: var(--font-mono, ui-monospace, monospace); font-size: var(--text-lg,1rem); color: var(--ink-bright,#fff); font-variant-numeric: tabular-nums; }
.awl-stat span { font-size: var(--text-2xs,.6875rem); text-transform: uppercase; letter-spacing: .05em; color: var(--ink-dim,#888); }
.awl-stat.warn b { color: var(--warn,#fbbf24); }
.awl-stat.bad b { color: var(--danger,#f87171); }
.awl-table { width: 100%; border-collapse: collapse; font-size: var(--text-sm,.764rem); }
.awl-scroll { overflow-x: auto; }
.awl-table th { text-align: left; font-weight: 500; font-size: var(--text-2xs,.6875rem); text-transform: uppercase; letter-spacing: .05em; color: var(--ink-dim,#888); padding: 6px 8px; }
.awl-table td { padding: 9px 8px; border-top: 1px solid var(--stroke,rgba(255,255,255,.07)); color: var(--ink,#e8e8e8); font-variant-numeric: tabular-nums; white-space: nowrap; }
.awl-table tr.awl-pick { cursor: pointer; }
.awl-table tr.awl-pick:hover td { background: var(--surface-2,rgba(255,255,255,.05)); }
.awl-table tr.awl-pick:focus-visible { outline: var(--focus-ring-width,2px) solid var(--focus-ring-color,#fff); outline-offset: -2px; }
.awl-apy { color: var(--success,#4ade80); font-weight: 600; }
.awl-form { display: grid; gap: var(--space-3,12px); grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); align-items: end; }
.awl-field { display: flex; flex-direction: column; gap: 5px; font-size: var(--text-sm,.764rem); color: var(--ink-dim,#888); }
.awl-field input, .awl-field select { font: inherit; font-size: var(--text-md,.8125rem); color: var(--ink,#e8e8e8); background: var(--surface-1,rgba(255,255,255,.03)); border: 1px solid var(--stroke,rgba(255,255,255,.1)); border-radius: var(--radius-md,10px); padding: 8px 11px; min-width: 0; }
.awl-field input:focus-visible, .awl-field select:focus-visible { outline: var(--focus-ring-width,2px) solid var(--focus-ring-color,#fff); outline-offset: 1px; }
.awl-row { display: flex; gap: var(--space-2,8px); flex-wrap: wrap; margin-top: var(--space-3,12px); align-items: center; }
.awl-note { font-size: var(--text-sm,.764rem); color: var(--ink-dim,#888); line-height: 1.5; margin: 0 0 var(--space-3,12px); }
.awl-err { background: color-mix(in srgb, var(--danger,#f87171) 12%, transparent); border: 1px solid color-mix(in srgb, var(--danger,#f87171) 32%, transparent); color: var(--danger,#f87171); border-radius: var(--radius-md,10px); padding: 10px 12px; font-size: var(--text-sm,.764rem); line-height: 1.45; display: flex; gap: 10px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.awl-ok { background: color-mix(in srgb, var(--success,#4ade80) 10%, transparent); border: 1px solid color-mix(in srgb, var(--success,#4ade80) 32%, transparent); color: var(--ink-bright,#fff); border-radius: var(--radius-md,10px); padding: 10px 12px; font-size: var(--text-sm,.764rem); line-height: 1.45; }
.awl-ok a { color: var(--wallet-accent,#c4b5fd); }
.awl-prev { border: 1px solid var(--stroke-strong,rgba(255,255,255,.14)); border-radius: var(--radius-md,10px); padding: 12px 14px; margin-top: var(--space-3,12px); background: var(--surface-2,rgba(255,255,255,.04)); }
.awl-prev dl { margin: 0 0 10px; display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; font-size: var(--text-sm,.764rem); }
.awl-prev dt { color: var(--ink-dim,#888); }
.awl-prev dd { margin: 0; color: var(--ink,#e8e8e8); word-break: break-all; }
.awl-checks { list-style: none; margin: 0 0 10px; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: var(--text-sm,.764rem); }
.awl-checks li::before { content: ''; display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; background: var(--success,#4ade80); }
.awl-checks li.bad::before { background: var(--danger,#f87171); }
.awl-skel { height: 56px; border-radius: var(--radius-md,10px); background: linear-gradient(90deg, var(--surface-1,rgba(255,255,255,.03)), var(--surface-2,rgba(255,255,255,.07)), var(--surface-1,rgba(255,255,255,.03))); background-size: 200% 100%; animation: awl-sh 1.2s linear infinite; }
.awl-skel + .awl-skel { margin-top: 8px; }
@keyframes awl-sh { from { background-position: 200% 0; } to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .awl-skel { animation: none; } }
@media (max-width: 520px) { .awl-prev dl { grid-template-columns: 1fr; } }
`;

function injectStyle() {
	if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
	const tag = document.createElement('style');
	tag.id = STYLE_ID;
	tag.textContent = STYLE;
	document.head.appendChild(tag);
}

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
		try { j = await r.json(); } catch { /* empty body */ }
		if (!r.ok) return { ok: false, status: r.status, code: j?.error?.code || 'error', message: j?.error?.message || `Request failed (${r.status}).` };
		return { ok: true, data: j?.data ?? j };
	} catch (err) {
		return { ok: false, status: 0, code: 'network_error', message: 'Could not reach three.ws. Check your connection and retry.' };
	}
}

const pct = (v) => (v == null ? 'n/a' : `${(v * 100).toFixed(2)}%`);
const usd = (v) => (v == null ? 'n/a' : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
const amt = (v, d = 6) => (v == null ? 'n/a' : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));

registerWalletTab({
	id: 'lend',
	label: 'Lend',
	order: 47,
	ownerOnly: true,
	mount({ panel, ctx }) {
		injectStyle();
		const esc = ctx.escapeHtml;
		const base = `/api/v1/agents/${encodeURIComponent(ctx.agentId)}/lending`;
		let destroyed = false;

		const state = {
			loading: true, error: null, markets: null, pos: null,
			form: { kind: 'deposit', token: 'USDC', amount: '', all: false },
			preview: null, busy: false, formError: null, done: null,
			rule: { mode: 'deposit_idle', token: 'USDC', reserve: '', floor: '', min_move: '' }, ruleMsg: null,
		};

		async function load() {
			state.loading = true;
			state.error = null;
			render();
			const [m, p] = await Promise.all([call(`${base}/markets`), call(`${base}/positions`)]);
			if (destroyed) return;
			state.loading = false;
			if (!m.ok) state.error = m.message;
			else if (!p.ok) state.error = p.message;
			else {
				state.markets = m.data;
				state.pos = p.data;
				const r = p.data.earn_rule;
				if (r) state.rule = { mode: r.mode, token: r.token, reserve: r.reserve === '0' ? '' : r.reserve, floor: r.floor === '0' ? '' : r.floor, min_move: r.min_move === '0' ? '' : r.min_move };
				const first = m.data.markets?.[0]?.symbol;
				if (first && !m.data.markets.some((x) => x.symbol === state.form.token)) state.form.token = first;
			}
			render();
		}

		function skeleton() {
			return '<div class="awh-card" aria-busy="true" aria-label="Loading lending"><div class="awl-skel"></div><div class="awl-skel"></div><div class="awl-skel"></div></div>';
		}

		function positionHtml() {
			const p = state.pos;
			const s = p.stats;
			const deposits = p.deposits || [];
			if (!deposits.length && !(p.borrows || []).length) {
				return `<p class="awh-empty">No lending positions. Set an earn rule to put idle USDC to work, or deposit below.</p>`;
			}
			const hf = s?.health_factor;
			const hfClass = hf == null ? '' : hf < 1.1 ? 'bad' : hf < p.health_floor ? 'warn' : '';
			const rows = deposits.map((d) => `<tr><td>${esc(d.symbol || d.mint.slice(0, 6))}</td><td>${esc(amt(d.amount))}</td><td>${esc(usd(d.value_usd))}</td><td class="awl-apy">${esc(pct(d.supply_apy))}</td><td>${esc(usd(d.projected_yearly_usd))}</td></tr>`).join('');
			return `<div class="awl-grid">
				<div class="awl-stat"><b>${esc(usd(s?.deposited_usd))}</b><span>Supplied</span></div>
				<div class="awl-stat"><b>${esc(usd(s?.borrowed_usd))}</b><span>Borrowed</span></div>
				<div class="awl-stat ${hfClass}"><b>${hf == null ? 'no debt' : esc(hf.toFixed(2))}</b><span>Health factor</span></div>
			</div>
			<div class="awl-scroll"><table class="awl-table"><thead><tr><th>Asset</th><th>Amount</th><th>Value</th><th>APY</th><th>Yearly</th></tr></thead><tbody>${rows}</tbody></table></div>`;
		}

		function marketsHtml() {
			const rows = (state.markets.markets || []).map((m) => `<tr class="awl-pick" tabindex="0" data-token="${esc(m.symbol)}" aria-label="Use ${esc(m.symbol)}"><td>${esc(m.symbol)}</td><td class="awl-apy">${esc(pct(m.supply_apy))}</td><td>${esc(pct(m.utilization))}</td><td>${esc(usd(m.available_liquidity_usd))}</td></tr>`).join('');
			return `<div class="awl-scroll"><table class="awl-table"><thead><tr><th>Asset</th><th>Supply APY</th><th>Utilization</th><th>Liquidity</th></tr></thead><tbody>${rows}</tbody></table></div>`;
		}

		function tokenOptions(sel) {
			return (state.markets.markets || []).map((m) => `<option value="${esc(m.symbol)}" ${m.symbol === sel ? 'selected' : ''}>${esc(m.symbol)}</option>`).join('');
		}

		function previewHtml() {
			const v = state.preview;
			if (!v) return '';
			const checks = v.checks.map((c) => `<li class="${c.ok ? '' : 'bad'}">${esc(c.label)}</li>`).join('');
			const blocked = v.checks.some((c) => !c.ok);
			const verb = v.kind === 'deposit' ? 'Deposit' : 'Withdraw';
			return `<div class="awl-prev" role="region" aria-label="${verb} preview">
				<dl>
					<dt>Action</dt><dd>${verb} ${esc(v.amount)} ${esc(v.token)}${v.all ? ' (entire position)' : ''}${v.amount_usd != null ? ` (${esc(usd(v.amount_usd))})` : ''}</dd>
					<dt>From</dt><dd>${esc(v.from)}</dd>
					<dt>To</dt><dd>${esc(v.to)}</dd>
					<dt>Venue</dt><dd>${esc(v.venue_name)} on Solana</dd>
					${v.supply_apy != null && v.kind === 'deposit' ? `<dt>Supply APY</dt><dd>${esc(pct(v.supply_apy))}${v.projected_yearly != null ? `, about ${esc(amt(v.projected_yearly))} ${esc(v.token)} per year` : ''}</dd>` : ''}
				</dl>
				<ul class="awl-checks">${checks}</ul>
				<div class="awl-row" style="margin-top:0">
					<button class="awh-btn awh-btn--primary" type="button" data-act="confirm" ${blocked || state.busy ? 'disabled' : ''}>${state.busy ? 'Sending...' : `Confirm ${verb.toLowerCase()}`}</button>
					<button class="awh-btn" type="button" data-act="cancel" ${state.busy ? 'disabled' : ''}>Cancel</button>
				</div>
			</div>`;
		}

		function ruleHtml() {
			const r = state.rule;
			const live = state.pos.earn_rule;
			const plan = state.pos.earn_plan;
			return `<p class="awl-note">${live?.enabled ? `Earn rule is on. ${plan ? esc(plan.action === 'none' ? `Next: nothing to move (${plan.reason}).` : `Next: ${plan.action} ${plan.amount} ${plan.token}.`) : ''}` : 'Earn rule is off. When on, the autopilot keeps idle funds lent and tops the wallet back up.'}</p>
			<div class="awl-form">
				<label class="awl-field">Mode<select data-rule="mode"><option value="deposit_idle" ${r.mode === 'deposit_idle' ? 'selected' : ''}>Lend idle balance</option><option value="withdraw_below" ${r.mode === 'withdraw_below' ? 'selected' : ''}>Keep wallet topped up</option></select></label>
				<label class="awl-field">Token<select data-rule="token">${tokenOptions(r.token)}</select></label>
				${r.mode === 'deposit_idle'
					? `<label class="awl-field">Keep in wallet<input data-rule="reserve" inputmode="decimal" placeholder="0" value="${esc(r.reserve)}" /></label>`
					: `<label class="awl-field">Wallet floor<input data-rule="floor" inputmode="decimal" placeholder="10" value="${esc(r.floor)}" /></label>`}
				<label class="awl-field">Minimum move<input data-rule="min_move" inputmode="decimal" placeholder="1" value="${esc(r.min_move)}" /></label>
			</div>
			<div class="awl-row">
				<button class="awh-btn awh-btn--primary" type="button" data-act="rule-save">Save rule</button>
				${live?.enabled ? '<button class="awh-btn" type="button" data-act="rule-off">Turn off</button>' : ''}
				${state.ruleMsg ? `<span class="${state.ruleMsg.ok ? '' : 'awl-err'}" role="status">${esc(state.ruleMsg.text)}</span>` : ''}
			</div>`;
		}

		function render() {
			if (destroyed) return;
			if (state.loading && !state.pos) {
				panel.innerHTML = skeleton();
				return;
			}
			if (state.error && !state.pos) {
				panel.innerHTML = `<div class="awh-card"><div class="awl-err" role="alert"><span>${esc(state.error)}</span><button class="awh-btn" type="button" data-act="retry">Retry</button></div></div>`;
				return;
			}
			const f = state.form;
			panel.innerHTML = `
				<div class="awh-card"><h3 class="awh-card-h">Your position on ${esc(state.pos.venue_name)}</h3>${positionHtml()}</div>
				<div class="awh-card"><h3 class="awh-card-h">Markets</h3>${marketsHtml()}</div>
				<div class="awh-card"><h3 class="awh-card-h">Deposit or withdraw</h3>
					<p class="awl-note">You see a simulated preview first. Nothing is sent until you confirm.</p>
					<div class="awl-form">
						<label class="awl-field">Action<select data-form="kind"><option value="deposit" ${f.kind === 'deposit' ? 'selected' : ''}>Deposit</option><option value="withdraw" ${f.kind === 'withdraw' ? 'selected' : ''}>Withdraw</option></select></label>
						<label class="awl-field">Token<select data-form="token">${tokenOptions(f.token)}</select></label>
						<label class="awl-field">Amount<input data-form="amount" inputmode="decimal" placeholder="0.00" value="${esc(f.amount)}" ${f.all ? 'disabled' : ''} /></label>
					</div>
					${f.kind === 'withdraw' ? `<label class="awl-note" style="display:flex;gap:8px;margin-top:10px"><input type="checkbox" data-form="all" ${f.all ? 'checked' : ''} /> Withdraw the entire position</label>` : ''}
					<div class="awl-row"><button class="awh-btn awh-btn--primary" type="button" data-act="preview" ${state.busy ? 'disabled' : ''}>${state.busy && !state.preview ? 'Simulating...' : 'Preview'}</button></div>
					${state.formError ? `<div class="awl-err" role="alert" style="margin-top:10px"><span>${esc(state.formError)}</span></div>` : ''}
					${previewHtml()}
					${state.done ? `<div class="awl-ok" role="status" style="margin-top:10px">${esc(state.done.text)} <a href="${esc(explorerTxUrl(state.done.signature))}" target="_blank" rel="noopener">View transaction</a></div>` : ''}
				</div>
				<div class="awh-card"><h3 class="awh-card-h">Earn rule</h3>${ruleHtml()}</div>`;
		}

		function body(confirm) {
			const f = state.form;
			return { token: f.token, amount: f.all ? undefined : f.amount, all: f.kind === 'withdraw' && f.all ? true : undefined, confirm };
		}

		async function runPreview() {
			state.formError = null;
			state.done = null;
			state.busy = true;
			render();
			const r = await call(`${base}/${state.form.kind}`, { method: 'POST', body: body(false) });
			state.busy = false;
			if (destroyed) return;
			if (r.ok) state.preview = r.data;
			else { state.preview = null; state.formError = r.message; }
			render();
		}

		async function runConfirm() {
			state.busy = true;
			state.formError = null;
			render();
			const kind = state.form.kind;
			const r = await call(`${base}/${kind}`, { method: 'POST', body: body(true) });
			state.busy = false;
			if (destroyed) return;
			if (r.ok) {
				state.done = { text: `${kind === 'deposit' ? 'Deposited' : 'Withdrew'} ${state.preview.amount} ${state.preview.token}.`, signature: r.data.signature };
				state.preview = null;
				state.form.amount = '';
				state.form.all = false;
				render();
				load();
				return;
			}
			state.formError = r.message;
			render();
		}

		async function saveRule(enabled) {
			state.ruleMsg = null;
			const r = state.rule;
			const payload = enabled
				? { enabled: true, venue: state.pos.venue, mode: r.mode, token: r.token, reserve: r.reserve || '0', floor: r.floor || '0', min_move: r.min_move || '0' }
				: { enabled: false };
			const res = await call(`${base}/earn-rule`, { method: 'PUT', body: payload });
			if (destroyed) return;
			state.ruleMsg = res.ok ? { ok: true, text: enabled ? 'Earn rule saved.' : 'Earn rule turned off.' } : { ok: false, text: res.message };
			if (res.ok) { await load(); return; }
			render();
		}

		panel.addEventListener('click', (e) => {
			const row = e.target.closest('.awl-pick');
			if (row) { state.form.token = row.dataset.token; state.preview = null; render(); return; }
			const act = e.target.closest('[data-act]')?.dataset.act;
			if (act === 'retry') load();
			else if (act === 'preview') runPreview();
			else if (act === 'confirm') runConfirm();
			else if (act === 'cancel') { state.preview = null; render(); }
			else if (act === 'rule-save') saveRule(true);
			else if (act === 'rule-off') saveRule(false);
		});
		panel.addEventListener('keydown', (e) => {
			if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('awl-pick')) { e.preventDefault(); e.target.click(); }
		});
		panel.addEventListener('change', (e) => {
			const t = e.target;
			if (t.dataset.form) {
				state.form[t.dataset.form] = t.type === 'checkbox' ? t.checked : t.value;
				state.preview = null;
				if (t.dataset.form === 'kind') state.form.all = false;
				render();
			} else if (t.dataset.rule) {
				state.rule[t.dataset.rule] = t.value;
				if (t.dataset.rule === 'mode') render();
			}
		});

		load();
		return { destroy() { destroyed = true; }, onShow() { if (!state.loading) load(); } };
	},
});
