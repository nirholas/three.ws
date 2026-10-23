/**
 * Agent Wallet hub - Burner tab (capped spending with owner confirmation).
 *
 * Owner-only. The owner says how much the agent may spend on its own and what
 * must come back to them:
 *
 *   - auto limit per spend      the agent signs alone at or below this
 *   - daily auto limit          rolling 24h ceiling on what it signs alone
 *   - wallet-signature above    over this, a tap is not enough: the owner signs
 *                               the approval with their own linked wallet
 *   - request window            how long a confirmation request stays answerable
 *
 * Above the cap nothing fails. The spend waits in the approvals inbox with its
 * recipient, amount, token and chain. The live preview runs the exact same
 * classifier the server guard runs (api/_lib/burner-tier.js), so the editor can
 * never disagree with enforcement.
 *
 * GET/PUT /api/agents/:id/solana/limits carries `burner_policy`.
 */

import { registerWalletTab } from '../registry.js';
import { consumeCsrfToken } from '../../api.js';
import {
	normalizeBurnerPolicy, validateBurnerPolicy, classifyBurnerSpend, burnerEnabled,
	BURNER_EXPIRY_DEFAULT_MIN, BURNER_EXPIRY_MIN, BURNER_EXPIRY_MAX,
} from '../../../api/_lib/burner-tier.js';

const STYLE_ID = 'awh-burner-style';
const STYLE = `
.awb-intro { font-size: var(--text-sm,.764rem); color: var(--ink-dim,#888); line-height:1.55; margin:0 0 var(--space-3,12px); max-width:64ch; }
.awb-form { display:grid; grid-template-columns: repeat(auto-fit,minmax(190px,1fr)); gap:12px; margin-bottom: var(--space-3,12px); }
.awb-field label { display:block; font-size: var(--text-2xs,.6875rem); color: var(--ink-dim,#888); margin-bottom:5px; }
.awb-field input { width:100%; box-sizing:border-box; font:inherit; font-size: var(--text-sm,.764rem); color: var(--ink,#e8e8e8); background: var(--surface-1,rgba(255,255,255,.03)); border:1px solid var(--stroke,rgba(255,255,255,.1)); border-radius: var(--radius-md,10px); padding:8px 11px; transition: border-color var(--duration-fast,140ms); }
.awb-field input:hover { border-color: var(--stroke-strong,rgba(255,255,255,.2)); }
.awb-field input:focus-visible { outline:2px solid var(--accent,#7c9cff); outline-offset:1px; }
.awb-field .awb-help { display:block; margin-top:4px; font-size: var(--text-2xs,.6875rem); color: var(--ink-dim,#888); line-height:1.4; }
.awb-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.awb-hint { font-size: var(--text-2xs,.6875rem); color: var(--ink-dim,#888); }
.awb-err { background: color-mix(in srgb, var(--danger,#f87171) 12%, transparent); border:1px solid color-mix(in srgb, var(--danger,#f87171) 32%, transparent); color: var(--danger,#f87171); border-radius: var(--radius-md,10px); padding:10px 12px; font-size: var(--text-sm,.764rem); margin-bottom: var(--space-3,12px); line-height:1.45; }
.awb-state { padding:18px 6px; font-size: var(--text-sm,.764rem); color: var(--ink-dim,#888); line-height:1.5; }
.awb-skel { height:14px; border-radius:6px; background: var(--surface-2,rgba(255,255,255,.07)); margin:10px 0; animation: awb-pulse 1.2s ease-in-out infinite; }
@keyframes awb-pulse { 50% { opacity:.45; } }
.awb-usage { display:grid; grid-template-columns: repeat(auto-fit,minmax(150px,1fr)); gap:8px; margin-bottom: var(--space-3,12px); }
.awb-usage .k { display:block; font-size: var(--text-2xs,.6875rem); color: var(--ink-dim,#888); }
.awb-usage .v { font-family: var(--font-mono,ui-monospace,monospace); font-size: var(--text-sm,.764rem); color: var(--ink,#e8e8e8); }
.awb-prev { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:10px; }
.awb-prev input { width:110px; box-sizing:border-box; font:inherit; font-size: var(--text-sm,.764rem); color: var(--ink,#e8e8e8); background: var(--surface-1,rgba(255,255,255,.03)); border:1px solid var(--stroke,rgba(255,255,255,.1)); border-radius: var(--radius-md,10px); padding:7px 10px; }
.awb-prev input:focus-visible { outline:2px solid var(--accent,#7c9cff); outline-offset:1px; }
.awb-verdict { border-radius: var(--radius-md,10px); padding:10px 12px; font-size: var(--text-sm,.764rem); line-height:1.45; border:1px solid var(--stroke,rgba(255,255,255,.1)); }
.awb-verdict b { display:block; margin-bottom:2px; }
.awb-verdict.auto { color: var(--success,#4ade80); background: color-mix(in srgb, var(--success,#4ade80) 10%, transparent); border-color: color-mix(in srgb, var(--success,#4ade80) 30%, transparent); }
.awb-verdict.confirm { color: var(--warn,#fbbf24); background: color-mix(in srgb, var(--warn,#fbbf24) 10%, transparent); border-color: color-mix(in srgb, var(--warn,#fbbf24) 30%, transparent); }
.awb-verdict.owner_sign { color: var(--accent,#8ab4ff); background: color-mix(in srgb, var(--accent,#8ab4ff) 12%, transparent); border-color: color-mix(in srgb, var(--accent,#8ab4ff) 32%, transparent); }
.awb-verdict span { color: var(--ink,#e8e8e8); }
`;

function injectStyle() {
	if (document.getElementById(STYLE_ID)) return;
	const el = document.createElement('style');
	el.id = STYLE_ID;
	el.textContent = STYLE;
	document.head.appendChild(el);
}

const VERDICT_TITLE = {
	auto: 'The agent signs this on its own',
	confirm: 'Waits for your confirmation',
	owner_sign: 'Waits for your wallet signature',
};

const usd = (n) => `$${Number(n || 0).toFixed(2)}`;
const fieldVal = (v) => (v == null ? '' : String(v));

async function call(url, { method = 'GET', body = null } = {}) {
	try {
		const opts = { method, credentials: 'include', headers: {} };
		if (body != null) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
		if (method !== 'GET') { const t = await consumeCsrfToken(); if (t) opts.headers['x-csrf-token'] = t; }
		const r = await fetch(url, opts);
		let j = null; try { j = await r.json(); } catch { /* empty body */ }
		if (!r.ok) return { ok: false, status: r.status, message: j?.error_description || `request failed (${r.status})` };
		return { ok: true, status: r.status, data: j?.data ?? j };
	} catch (err) {
		return { ok: false, status: 0, message: err?.message || 'network error' };
	}
}

registerWalletTab({
	id: 'burner',
	label: 'Burner cap',
	order: 59,
	ownerOnly: true,
	mount({ panel, ctx }) {
		injectStyle();
		const esc = ctx.escapeHtml;
		const url = `/api/agents/${encodeURIComponent(ctx.agentId)}/solana/limits`;
		let destroyed = false;
		const state = {
			loaded: false, signedOut: false, error: null, saving: false, saveError: null,
			saved: null, autoSpent: 0, preview: '40',
			form: { autoMaxUsd: '', dailyAutoMaxUsd: '', confirmAboveUsd: '', expiryMinutes: String(BURNER_EXPIRY_DEFAULT_MIN) },
		};

		const draft = () => normalizeBurnerPolicy({
			autoMaxUsd: state.form.autoMaxUsd,
			dailyAutoMaxUsd: state.form.dailyAutoMaxUsd,
			confirmAboveUsd: state.form.confirmAboveUsd,
			expiryMinutes: state.form.expiryMinutes,
		});

		function adopt(policy) {
			const p = normalizeBurnerPolicy(policy);
			state.saved = p;
			state.form = {
				autoMaxUsd: fieldVal(p.autoMaxUsd), dailyAutoMaxUsd: fieldVal(p.dailyAutoMaxUsd),
				confirmAboveUsd: fieldVal(p.confirmAboveUsd), expiryMinutes: String(p.expiryMinutes),
			};
		}

		function verdictHtml() {
			const p = draft();
			const amount = state.preview === '' ? null : Number(state.preview);
			if (!burnerEnabled(p)) {
				return `<div class="awb-verdict"><b>No burner cap set</b><span>Your other spend limits are the only gate. Set a per-spend auto limit to turn the cap on.</span></div>`;
			}
			if (amount == null || !Number.isFinite(amount) || amount < 0) {
				return `<div class="awb-verdict"><b>Enter an amount</b><span>Type a USD value to see how the agent would handle it.</span></div>`;
			}
			const v = classifyBurnerSpend({ policy: p, usd: amount, autoSpentUsd: state.autoSpent });
			return `<div class="awb-verdict ${esc(v.tier)}" role="status"><b>${esc(VERDICT_TITLE[v.tier])}</b><span>${esc(v.reason)}</span></div>`;
		}

		function dirty() {
			const a = state.saved; const b = draft();
			return !a || ['autoMaxUsd', 'dailyAutoMaxUsd', 'confirmAboveUsd', 'expiryMinutes'].some((k) => a[k] !== b[k]);
		}

		function problem() { return validateBurnerPolicy(draft()); }

		function render() {
			if (destroyed) return;
			if (state.signedOut) {
				const next = encodeURIComponent(location.pathname + location.search + location.hash);
				panel.innerHTML = `<div class="awb-state">Sign in as the agent's owner to set its burner cap. <a href="/login?next=${next}">Sign in</a></div>`;
				return;
			}
			if (!state.loaded) { panel.innerHTML = `<div class="awh-card" aria-busy="true"><div class="awb-skel" style="width:60%"></div><div class="awb-skel"></div><div class="awb-skel" style="width:80%"></div></div>`; return; }
			if (state.error) {
				panel.innerHTML = `<div class="awh-card"><div class="awb-err" role="alert">${esc(state.error)}</div><button class="awh-btn" type="button" data-act="reload">Try again</button></div>`;
				panel.querySelector('[data-act="reload"]').addEventListener('click', () => { state.loaded = false; state.error = null; render(); load(); });
				return;
			}
			const on = burnerEnabled(state.saved);
			const bad = problem();
			panel.innerHTML = `
				<div class="awh-card"><div class="awh-card-h">Burner cap ${on ? '(on)' : '(off)'}</div>
					<p class="awb-intro">Decide what your agent may spend on its own. Anything above the cap is not refused: it waits in your approvals inbox with the recipient, amount, token and chain, and expires if you do not answer. Above the wallet-signature line, you confirm by signing with your own wallet.</p>
					${on ? `<div class="awb-usage"><div><span class="k">Signed alone, last 24h</span><span class="v">${esc(usd(state.autoSpent))}</span></div>${state.saved.dailyAutoMaxUsd != null ? `<div><span class="k">Daily headroom</span><span class="v">${esc(usd(Math.max(0, state.saved.dailyAutoMaxUsd - state.autoSpent)))}</span></div>` : ''}</div>` : ''}
					${state.saveError ? `<div class="awb-err" role="alert">${esc(state.saveError)}</div>` : ''}
					<div class="awb-form">
						<div class="awb-field"><label for="awb-auto">Auto limit per spend (USD)</label><input id="awb-auto" data-f="autoMaxUsd" type="text" inputmode="decimal" placeholder="5" value="${esc(state.form.autoMaxUsd)}" /><span class="awb-help">Empty turns the cap off.</span></div>
						<div class="awb-field"><label for="awb-daily">Daily auto limit (USD)</label><input id="awb-daily" data-f="dailyAutoMaxUsd" type="text" inputmode="decimal" placeholder="No daily limit" value="${esc(state.form.dailyAutoMaxUsd)}" /><span class="awb-help">Once reached, later spends wait for you.</span></div>
						<div class="awb-field"><label for="awb-sign">Wallet signature above (USD)</label><input id="awb-sign" data-f="confirmAboveUsd" type="text" inputmode="decimal" placeholder="A tap is always enough" value="${esc(state.form.confirmAboveUsd)}" /><span class="awb-help">Needs a Solana wallet linked to your account.</span></div>
						<div class="awb-field"><label for="awb-exp">Request window (minutes)</label><input id="awb-exp" data-f="expiryMinutes" type="text" inputmode="numeric" value="${esc(state.form.expiryMinutes)}" /><span class="awb-help">${BURNER_EXPIRY_MIN} to ${BURNER_EXPIRY_MAX}. Default ${BURNER_EXPIRY_DEFAULT_MIN}.</span></div>
					</div>
					${bad ? `<div class="awb-err" role="alert">${esc(bad)}</div>` : ''}
					<div class="awb-actions">
						<button class="awh-btn awh-btn--primary" type="button" id="awb-save" ${state.saving || bad || !dirty() ? 'disabled' : ''}>${state.saving ? 'Saving...' : 'Save burner cap'}</button>
						<span class="awb-hint">${dirty() ? 'Unsaved changes' : 'Saved'}</span>
					</div>
				</div>
				<div class="awh-card"><div class="awh-card-h">Preview</div>
					<div class="awb-prev"><label for="awb-prev" class="awb-hint">If the agent wants to spend (USD)</label><input id="awb-prev" type="text" inputmode="decimal" value="${esc(state.preview)}" /></div>
					<div id="awb-verdict">${verdictHtml()}</div>
				</div>`;
			wire();
		}

		function wire() {
			panel.querySelectorAll('[data-f]').forEach((el) => el.addEventListener('input', (e) => {
				state.form[e.target.dataset.f] = e.target.value.trim();
				state.saveError = null;
				const bad = problem();
				panel.querySelector('#awb-verdict').innerHTML = verdictHtml();
				const save = panel.querySelector('#awb-save');
				if (save) save.disabled = state.saving || !!bad || !dirty();
				const hint = panel.querySelector('.awb-actions .awb-hint');
				if (hint) hint.textContent = dirty() ? 'Unsaved changes' : 'Saved';
			}));
			panel.querySelectorAll('[data-f]').forEach((el) => el.addEventListener('change', render));
			panel.querySelector('#awb-prev')?.addEventListener('input', (e) => {
				state.preview = e.target.value.trim();
				panel.querySelector('#awb-verdict').innerHTML = verdictHtml();
			});
			panel.querySelector('#awb-save')?.addEventListener('click', save);
		}

		async function load() {
			const res = await call(url);
			if (destroyed) return;
			state.loaded = true;
			if (res.status === 401) { state.signedOut = true; render(); return; }
			state.signedOut = false;
			if (!res.ok) { state.error = res.message; render(); return; }
			state.error = null;
			state.autoSpent = Number(res.data?.auto_spent_today_usd) || 0;
			adopt(res.data?.burner_policy);
			render();
		}

		async function save() {
			if (state.saving || problem()) return;
			state.saving = true; state.saveError = null; render();
			const p = draft();
			const res = await call(url, { method: 'PUT', body: { burner_policy: {
				autoMaxUsd: p.autoMaxUsd, dailyAutoMaxUsd: p.dailyAutoMaxUsd, confirmAboveUsd: p.confirmAboveUsd, expiryMinutes: p.expiryMinutes,
			} } });
			state.saving = false;
			if (destroyed) return;
			if (res.ok) {
				adopt(res.data?.burner_policy);
				ctx.toast(burnerEnabled(state.saved) ? 'Burner cap saved' : 'Burner cap turned off');
			} else {
				state.saveError = res.message;
			}
			render();
		}

		render();
		load();

		return {
			onShow() { if (!state.loaded) load(); },
			destroy() { destroyed = true; },
		};
	},
});
