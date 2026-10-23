/**
 * Agent Wallet hub — Self-Defending Wallet tab (owner-only).
 *
 * Every wallet gets an immune system. The platform learns each agent's normal
 * spending behavior and scores every outbound action in real time; anything that
 * looks anomalous auto-freezes the wallet and surfaces here with a plain-language
 * "why" and one-tap Approve / Keep-frozen / Sweep-to-safety. Approving teaches the
 * baseline so the wallet gets smarter, never naggier.
 *
 * All state is REAL: this panel only ever renders DB state from
 * GET /api/agents/:id/solana/guard, and every action hits the owner-gated,
 * CSRF-protected API. The scoring + freeze happen server-side on the spend path;
 * this is the owner's window into — and control over — that system.
 */

import { registerWalletTab } from '../registry.js';
import { consumeCsrfToken } from '../../api.js';
import { shortAddress } from '../util.js';
import { addressHtml } from '../../shared/address.js';

const STYLE_ID = 'awh-guard-style';
const STYLE = `
.awh-guard { display:flex; flex-direction:column; gap:var(--space-3,12px); }
.awh-guard h2 { margin:0 0 4px; font-size:var(--text-md,.8125rem); color:var(--ink-bright,#fff); font-family:var(--font-display,system-ui); font-weight:600; }
.awh-guard-lead { color:var(--ink-dim,#888); font-size:var(--text-sm,.764rem); line-height:1.55; margin:0; max-width:62ch; }
.awh-guard-head { display:flex; gap:10px; align-items:flex-start; }
.awh-guard-shield { display:inline-grid; place-items:center; width:30px; height:30px; border-radius:var(--radius-md,10px); background:color-mix(in srgb,var(--wallet-accent,#8b5cf6) 16%,transparent); border:1px solid color-mix(in srgb,var(--wallet-accent,#8b5cf6) 36%,transparent); font-size:15px; flex:none; }
.awh-guard-alarm { border-color:color-mix(in srgb,var(--danger,#ef4444) 50%,transparent) !important; background:color-mix(in srgb,var(--danger,#ef4444) 9%,transparent); }
.awh-guard-alarm .awh-guard-shield { background:color-mix(in srgb,var(--danger,#ef4444) 18%,transparent); border-color:color-mix(in srgb,var(--danger,#ef4444) 45%,transparent); animation:awh-guard-pulse 1.6s ease-in-out infinite; }
@keyframes awh-guard-pulse { 0%,100%{ box-shadow:0 0 0 0 color-mix(in srgb,var(--danger,#ef4444) 40%,transparent);} 50%{ box-shadow:0 0 0 6px color-mix(in srgb,var(--danger,#ef4444) 0%,transparent);} }
.awh-flag { border:1px solid var(--stroke,rgba(255,255,255,.08)); border-radius:var(--radius-md,10px); background:var(--surface-1,rgba(255,255,255,.03)); padding:11px 12px; display:flex; flex-direction:column; gap:8px; }
.awh-flag + .awh-flag { margin-top:8px; }
.awh-flag-top { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.awh-flag-sum { font-size:var(--text-sm,.764rem); color:var(--ink-bright,#fff); font-weight:500; flex:1; min-width:160px; }
.awh-flag-meta { font-size:var(--text-2xs,.6875rem); color:var(--ink-dim,#888); font-family:var(--font-mono,monospace); }
.awh-factors { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:4px; }
.awh-factor { display:flex; gap:7px; align-items:flex-start; font-size:var(--text-sm,.764rem); color:var(--ink,#c8c8c8); line-height:1.4; }
.awh-factor::before { content:'›'; color:var(--danger,#ef4444); font-weight:700; flex:none; }
.awh-factor.sev-medium::before,.awh-factor.sev-low::before { color:var(--warn,#fbbf24); }
.awh-flag-acts { display:flex; gap:8px; flex-wrap:wrap; margin-top:2px; }
.awh-score { display:inline-flex; align-items:center; gap:6px; font-size:var(--text-2xs,.6875rem); font-weight:600; padding:2px 8px; border-radius:var(--radius-pill,999px); border:1px solid transparent; font-family:var(--font-mono,monospace); }
.awh-score.hi { color:var(--danger,#ef4444); background:color-mix(in srgb,var(--danger,#ef4444) 12%,transparent); border-color:color-mix(in srgb,var(--danger,#ef4444) 34%,transparent); }
.awh-score.mid { color:var(--warn,#fbbf24); background:color-mix(in srgb,var(--warn,#fbbf24) 12%,transparent); border-color:color-mix(in srgb,var(--warn,#fbbf24) 30%,transparent); }
.awh-score.lo { color:var(--ink-dim,#888); background:var(--surface-2,rgba(255,255,255,.05)); border-color:var(--stroke,rgba(255,255,255,.08)); }
.awh-seg { display:inline-flex; gap:4px; background:var(--surface-2,rgba(255,255,255,.05)); border:1px solid var(--stroke,rgba(255,255,255,.08)); border-radius:var(--radius-md,10px); padding:3px; }
.awh-seg button { appearance:none; font:inherit; font-size:var(--text-sm,.764rem); color:var(--ink-dim,#888); background:transparent; border:none; border-radius:var(--radius-sm,6px); padding:6px 12px; cursor:pointer; transition:background var(--duration-fast,140ms),color var(--duration-fast,140ms); }
.awh-seg button:hover { color:var(--ink,#e8e8e8); }
.awh-seg button[aria-pressed="true"] { background:var(--accent,#fff); color:#0a0a0a; font-weight:600; }
.awh-seg button:focus-visible { outline:var(--focus-ring-width,2px) solid var(--focus-ring-color,#fff); outline-offset:2px; }
.awh-guard-row { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; padding:9px 0; border-top:1px solid var(--stroke,rgba(255,255,255,.08)); }
.awh-guard-row:first-of-type { border-top:none; }
.awh-guard-row label { font-size:var(--text-sm,.764rem); color:var(--ink,#c8c8c8); }
.awh-guard-row .hint { display:block; font-size:var(--text-2xs,.6875rem); color:var(--ink-faint,#666); margin-top:2px; max-width:42ch; }
.awh-guard-row input[type="text"] { font:inherit; font-size:var(--text-sm,.764rem); color:var(--ink,#e8e8e8); background:var(--surface-2,rgba(255,255,255,.05)); border:1px solid var(--stroke,rgba(255,255,255,.08)); border-radius:var(--radius-md,10px); padding:7px 10px; min-width:200px; flex:1; }
.awh-guard-row input:focus-visible { outline:var(--focus-ring-width,2px) solid var(--focus-ring-color,#fff); outline-offset:2px; }
.awh-switch { display:inline-flex; align-items:center; gap:8px; }
.awh-stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:10px; }
.awh-stat { background:var(--surface-1,rgba(255,255,255,.03)); border:1px solid var(--stroke,rgba(255,255,255,.08)); border-radius:var(--radius-md,10px); padding:9px 11px; }
.awh-stat .k { font-size:var(--text-2xs,.6875rem); color:var(--ink-dim,#888); text-transform:uppercase; letter-spacing:.05em; }
.awh-stat .v { font-size:var(--text-md,.8125rem); color:var(--ink-bright,#fff); font-weight:600; margin-top:3px; font-family:var(--font-mono,monospace); }
.awh-tl { list-style:none; margin:6px 0 0; padding:0; display:flex; flex-direction:column; gap:0; }
.awh-tl-item { display:flex; gap:10px; padding:9px 0; border-top:1px solid var(--stroke,rgba(255,255,255,.06)); }
.awh-tl-item:first-child { border-top:none; }
.awh-tl-dot { width:8px; height:8px; border-radius:50%; margin-top:6px; flex:none; background:var(--ink-faint,#555); }
.awh-tl-dot.flagged { background:var(--danger,#ef4444); } .awh-tl-dot.approved { background:var(--success,#4ade80); } .awh-tl-dot.denied { background:var(--warn,#fbbf24); }
.awh-tl-c { flex:1; min-width:0; }
.awh-tl-sum { font-size:var(--text-sm,.764rem); color:var(--ink,#e8e8e8); line-height:1.4; }
.awh-tl-meta { font-size:var(--text-2xs,.6875rem); color:var(--ink-dim,#888); margin-top:2px; display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
.awh-badge { font-size:var(--text-2xs,.6875rem); padding:1px 7px; border-radius:var(--radius-pill,999px); border:1px solid var(--stroke,rgba(255,255,255,.12)); color:var(--ink-dim,#888); text-transform:capitalize; }
.awh-badge.flagged { color:var(--danger,#ef4444); border-color:color-mix(in srgb,var(--danger,#ef4444) 34%,transparent); }
.awh-badge.approved { color:var(--success,#4ade80); border-color:color-mix(in srgb,var(--success,#4ade80) 30%,transparent); }
.awh-badge.denied { color:var(--warn,#fbbf24); border-color:color-mix(in srgb,var(--warn,#fbbf24) 30%,transparent); }
.awh-guard-skel { height:60px; border-radius:var(--radius-lg,14px); background:linear-gradient(90deg,var(--surface-1,rgba(255,255,255,.03)) 25%,var(--surface-2,rgba(255,255,255,.05)) 37%,var(--surface-1,rgba(255,255,255,.03)) 63%); background-size:400% 100%; animation:awh-guard-shimmer 1.4s ease infinite; }
@keyframes awh-guard-shimmer { 0%{background-position:100% 0} 100%{background-position:-100% 0} }
.awh-guard-empty-ill { font-size:26px; opacity:.5; margin-bottom:4px; display:block; }
@media (prefers-reduced-motion: reduce){ .awh-guard-skel{animation:none} .awh-guard-alarm .awh-guard-shield{animation:none} }
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
		if (body != null) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
		if (method !== 'GET') { const t = await consumeCsrfToken(); if (t) opts.headers['x-csrf-token'] = t; }
		const r = await fetch(url, opts);
		let j = null; try { j = await r.json(); } catch { /* empty */ }
		if (!r.ok) return { ok: false, status: r.status, code: j?.error || 'error', message: j?.error_description || `request failed (${r.status})`, detail: j?.detail || null };
		return { ok: true, status: r.status, data: j?.data ?? j };
	} catch (err) {
		return { ok: false, status: 0, code: 'network_error', message: err?.message || 'network error' };
	}
}

function ago(ts) {
	if (!ts) return '';
	const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
	if (s < 60) return 'just now';
	if (s < 3600) return `${Math.floor(s / 60)}m ago`;
	if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
	return `${Math.floor(s / 86400)}d ago`;
}
function scoreClass(s) { return s >= 0.7 ? 'hi' : s >= 0.4 ? 'mid' : 'lo'; }

registerWalletTab({
	id: 'guard',
	label: 'Self-defense',
	order: 78,
	ownerOnly: true,
	mount({ panel, ctx }) {
		injectStyle();
		const { escapeHtml, agentId, toast } = ctx;
		let state = null;
		let busy = false;
		let pollTimer = null;

		function setBusy(b) {
			busy = b;
			panel.querySelectorAll('button, input, select').forEach((el) => { if (!el.dataset.keepEnabled) el.disabled = b; });
		}

		async function load() {
			const res = await call(`/api/agents/${encodeURIComponent(agentId)}/solana/guard`);
			if (res.status === 401) { renderSignedOut(); return; }
			if (!res.ok) { renderError(res); return; }
			state = res.data;
			render();
		}

		function renderLoading() {
			panel.innerHTML = `<div class="awh-card" role="status" aria-busy="true" aria-label="Loading self-defense"><div class="awh-guard-skel"></div></div><div class="awh-card" aria-hidden="true"><div class="awh-guard-skel"></div></div>`;
		}

		function renderSignedOut() {
			const next = encodeURIComponent(location.pathname + location.search + location.hash);
			panel.innerHTML = `<div class="awh-card"><div class="awh-guard"><div class="awh-guard-head"><span class="awh-guard-shield" aria-hidden="true">🛡️</span><div style="flex:1;"><h2>Sign in to control your wallet's defenses</h2><p class="awh-guard-lead">The self-defending wallet is private to its owner. Sign in to review flagged activity and manage the guard.</p></div></div><div class="awh-flag-acts"><a class="awh-btn awh-btn--primary" href="/login?next=${next}">Sign in</a></div></div></div>`;
		}

		function renderError(res) {
			panel.innerHTML = `<div class="awh-card"><p class="awh-empty" role="alert">Couldn’t load the guard — ${escapeHtml(res.message || 'try again')}. <button class="awh-btn" type="button" data-act="retry">Try again</button></p></div>`;
			const retry = panel.querySelector('[data-act="retry"]');
			retry?.addEventListener('click', () => { renderLoading(); load(); });
			retry?.focus();
		}

		function factorsHTML(factors) {
			if (!Array.isArray(factors) || !factors.length) return '';
			return `<ul class="awh-factors">${factors.map((f) => `<li class="awh-factor sev-${escapeHtml(f.severity || 'high')}">${escapeHtml(f.label || '')}</li>`).join('')}</ul>`;
		}

		function flagHTML(f) {
			const safe = state.config?.safe_address;
			return `
				<div class="awh-flag" data-flag="${escapeHtml(f.id)}">
					<div class="awh-flag-top">
						<span class="awh-flag-sum">${escapeHtml(f.summary || 'Unusual activity')}</span>
						<span class="awh-score ${scoreClass(f.score)}">risk ${Math.round((f.score || 0) * 100)}</span>
					</div>
					<div class="awh-flag-meta">${escapeHtml(f.category || 'spend')}${f.usd != null ? ` · $${Number(f.usd).toFixed(2)}` : ''}${f.destination ? ` · → ${addressHtml(f.destination, { label: 'Destination' })}` : ''} · ${escapeHtml(ago(f.created_at))}</div>
					${factorsHTML(f.factors)}
					<div class="awh-flag-acts">
						<button class="awh-btn awh-btn--primary" type="button" data-act="approve" data-id="${escapeHtml(f.id)}">✓ It was me — approve & unfreeze</button>
						<button class="awh-btn awh-btn--danger" type="button" data-act="deny" data-id="${escapeHtml(f.id)}">Keep frozen</button>
						${safe ? `<button class="awh-btn" type="button" data-act="sweep" data-id="${escapeHtml(f.id)}">⤴ Sweep to safety</button>` : ''}
					</div>
				</div>`;
		}

		function render() {
			const cfg = state.config || {};
			const baseline = state.baseline || {};
			const flags = state.open_flags || [];
			const items = state.timeline?.items || [];
			const frozen = !!state.frozen;

			const banner = frozen ? `
				<div class="awh-card awh-guard-alarm" role="status" aria-live="polite">
					<div class="awh-guard">
						<div class="awh-guard-head">
							<span class="awh-guard-shield" aria-hidden="true">🛡️</span>
							<div style="flex:1;">
								<h2>Wallet frozen — your money is defending itself</h2>
								<p class="awh-guard-lead">Autonomous spending is paused. ${flags.length ? 'Review what tripped the guard below and decide.' : 'No open flag — you can unfreeze if this was expected.'}</p>
							</div>
						</div>
						${flags.map(flagHTML).join('')}
						${!flags.length ? `<div class="awh-flag-acts"><button class="awh-btn awh-btn--primary" type="button" data-act="unfreeze">Unfreeze wallet</button></div>` : ''}
						${!cfg.safe_address ? `<p class="awh-guard-row" style="border:none;padding-top:4px;"><span class="hint">Tip: set a safe address below to enable one-tap “Sweep to safety” during a freeze.</span></p>` : ''}
					</div>
				</div>` : '';

			const lowHist = baseline.low_history;
			const baselineCard = `
				<div class="awh-card">
					<div class="awh-guard">
						<div class="awh-guard-head">
							<span class="awh-guard-shield" aria-hidden="true">🧠</span>
							<div style="flex:1;"><h2>What your wallet has learned</h2>
							<p class="awh-guard-lead">${lowHist ? 'Still learning — with little history the guard widens its tolerances and only freezes on the clearest threats.' : 'The guard scores every spend against this learned profile of normal behavior.'}</p></div>
						</div>
						<div class="awh-stats">
							<div class="awh-stat"><div class="k">Spends learned</div><div class="v">${Number(baseline.total_events || 0)}</div></div>
							<div class="awh-stat"><div class="k">Largest spend</div><div class="v">$${Number(baseline.usd?.max || 0).toFixed(2)}</div></div>
							<div class="awh-stat"><div class="k">Known addresses</div><div class="v">${Number(baseline.counterparty_count || 0)}</div></div>
							<div class="awh-stat"><div class="k">Active hours (UTC)</div><div class="v">${(baseline.active_hours || []).length || '—'}</div></div>
						</div>
						${cfg.learned_destinations ? `<p class="awh-guard-lead" style="margin-top:4px;">${cfg.learned_destinations} address${cfg.learned_destinations === 1 ? '' : 'es'} you’ve approved are trusted and won’t re-trip.</p>` : ''}
					</div>
				</div>`;

			const presets = state.presets || [];
			const settingsCard = `
				<div class="awh-card">
					<div class="awh-guard">
						<div class="awh-guard-head">
							<span class="awh-guard-shield" aria-hidden="true">⚙️</span>
							<div style="flex:1;"><h2>Sensitivity & safeguards</h2>
							<p class="awh-guard-lead">Tune how eagerly the guard freezes. Approving a flagged action always teaches it, so Balanced rarely nags.</p></div>
							<label class="awh-switch"><input type="checkbox" data-field="enabled" ${cfg.enabled !== false ? 'checked' : ''} aria-label="Enable the anomaly guard" /><span>${cfg.enabled !== false ? 'On' : 'Off'}</span></label>
						</div>
						<div class="awh-seg" role="group" aria-label="Sensitivity">
							${presets.map((p) => `<button type="button" data-sens="${escapeHtml(p.key)}" aria-pressed="${cfg.sensitivity === p.key}" title="${escapeHtml(p.description || '')}">${escapeHtml(p.label)}</button>`).join('')}
						</div>
						<p class="awh-guard-lead">${escapeHtml((presets.find((p) => p.key === cfg.sensitivity) || {}).description || '')}</p>
						<div class="awh-guard-row">
							<label for="awh-guard-safe">Safe address<span class="hint">Where one-tap “Sweep to safety” sends funds during a freeze. Your own cold wallet.</span></label>
							<input id="awh-guard-safe" type="text" data-field="safe" value="${escapeHtml(cfg.safe_address || '')}" placeholder="Solana address" autocomplete="off" spellcheck="false" />
							<button class="awh-btn" type="button" data-act="save-safe">Save</button>
						</div>
						${cfg.learned_destinations ? `<div class="awh-guard-row"><label>Trusted patterns<span class="hint">Addresses & amounts you’ve approved. Reset to score everything fresh.</span></label><button class="awh-btn" type="button" data-act="clear-learned">Reset what’s learned</button></div>` : ''}
					</div>
				</div>`;

			const timelineCard = `
				<div class="awh-card">
					<div class="awh-guard">
						<div class="awh-guard-head"><span class="awh-guard-shield" aria-hidden="true">📜</span><div style="flex:1;"><h2>Anomaly timeline</h2><p class="awh-guard-lead">Every scored action — allowed and flagged — explained in plain language.</p></div></div>
						${items.length ? `<ul class="awh-tl">${items.map(timelineItemHTML).join('')}</ul>
							${state.timeline?.next_cursor ? `<div class="awh-flag-acts"><button class="awh-btn" type="button" data-act="more">Load older</button></div>` : ''}`
							: `<p class="awh-empty" style="text-align:center;"><span class="awh-guard-empty-ill" aria-hidden="true">🛡️</span>Nothing flagged yet. The guard is watching every spend — you’ll see notable activity here.</p>`}
					</div>
				</div>`;

			panel.innerHTML = banner + baselineCard + settingsCard + timelineCard;
			wire();
		}

		function timelineItemHTML(e) {
			const cls = e.status === 'flagged' ? 'flagged' : e.status === 'approved' ? 'approved' : e.status === 'denied' ? 'denied' : '';
			return `
				<li class="awh-tl-item">
					<span class="awh-tl-dot ${cls}"></span>
					<div class="awh-tl-c">
						<div class="awh-tl-sum">${escapeHtml(e.summary || 'Scored a spend')}</div>
						<div class="awh-tl-meta">
							<span class="awh-score ${scoreClass(e.score)}">risk ${Math.round((e.score || 0) * 100)}</span>
							<span>${escapeHtml(e.category || 'spend')}${e.usd != null ? ` · $${Number(e.usd).toFixed(2)}` : ''}</span>
							<span class="awh-badge ${cls}">${escapeHtml(e.status)}</span>
							<span>${escapeHtml(ago(e.created_at))}</span>
						</div>
					</div>
				</li>`;
		}

		async function adjudicate(action, eventId) {
			if (busy) return;
			setBusy(true);
			const res = await call(`/api/agents/${encodeURIComponent(agentId)}/solana/guard`, { method: 'POST', body: { action, event_id: eventId } });
			setBusy(false);
			if (!res.ok) { toast(res.message || 'Action failed'); return; }
			toast(action === 'approve' ? 'Approved — wallet unfrozen and pattern trusted' : action === 'deny' ? 'Kept frozen' : 'Done');
			await load();
		}

		async function sweep(eventId) {
			const safe = state.config?.safe_address;
			if (!safe) { toast('Set a safe address first'); return; }
			if (!confirm(`Sweep all SOL to your safe address (${shortAddress(safe)})? This is an irreversible on-chain transfer. The wallet stays frozen afterward.`)) return;
			if (busy) return;
			setBusy(true);
			// A real, audited withdraw — allowed even while frozen (the safe direction).
			const w = await call(`/api/agents/${encodeURIComponent(agentId)}/solana/withdraw`, { method: 'POST', body: { destination: safe, amount: 'max', asset: 'SOL' } });
			if (!w.ok) { setBusy(false); toast(w.message || 'Sweep failed'); return; }
			await call(`/api/agents/${encodeURIComponent(agentId)}/solana/guard`, { method: 'POST', body: { action: 'mark_swept', event_id: eventId } });
			setBusy(false);
			toast('Swept to safety');
			await load();
		}

		async function saveConfig(patch, msg) {
			if (busy) return;
			setBusy(true);
			const res = await call(`/api/agents/${encodeURIComponent(agentId)}/solana/guard`, { method: 'PUT', body: patch });
			setBusy(false);
			if (!res.ok) { toast(res.message || 'Could not save'); return; }
			if (msg) toast(msg);
			await load();
		}

		function wire() {
			panel.querySelectorAll('[data-act="approve"]').forEach((b) => b.addEventListener('click', () => adjudicate('approve', b.dataset.id)));
			panel.querySelectorAll('[data-act="deny"]').forEach((b) => b.addEventListener('click', () => adjudicate('deny', b.dataset.id)));
			panel.querySelectorAll('[data-act="sweep"]').forEach((b) => b.addEventListener('click', () => sweep(b.dataset.id)));
			panel.querySelector('[data-act="unfreeze"]')?.addEventListener('click', () => {
				if (!confirm('Unfreeze the wallet? Autonomous spending resumes.')) return;
				adjudicate('unfreeze', null);
			});
			panel.querySelectorAll('[data-sens]').forEach((b) => b.addEventListener('click', () => {
				if (b.getAttribute('aria-pressed') === 'true') return;
				saveConfig({ sensitivity: b.dataset.sens }, 'Sensitivity updated');
			}));
			panel.querySelector('[data-field="enabled"]')?.addEventListener('change', (e) => {
				saveConfig({ enabled: e.target.checked }, e.target.checked ? 'Guard enabled' : 'Guard disabled');
			});
			panel.querySelector('[data-act="save-safe"]')?.addEventListener('click', () => {
				const v = (panel.querySelector('[data-field="safe"]')?.value || '').trim();
				saveConfig({ safe_address: v || null }, v ? 'Safe address saved' : 'Safe address cleared');
			});
			panel.querySelector('[data-act="clear-learned"]')?.addEventListener('click', () => {
				if (!confirm('Reset everything the guard has learned? It will score all addresses and amounts as new again.')) return;
				saveConfig({ clear_learned: true }, 'Learned patterns reset');
			});
			panel.querySelector('[data-act="more"]')?.addEventListener('click', async () => {
				const cursor = state.timeline?.next_cursor;
				if (!cursor || busy) return;
				setBusy(true);
				const res = await call(`/api/agents/${encodeURIComponent(agentId)}/solana/guard?before=${encodeURIComponent(cursor)}`);
				setBusy(false);
				if (res.ok) {
					state.timeline.items = [...state.timeline.items, ...(res.data.timeline?.items || [])];
					state.timeline.next_cursor = res.data.timeline?.next_cursor || null;
					render();
				}
			});
		}

		function startPoll() {
			stopPoll();
			// Poll while frozen so a fresh flag (or an unfreeze from another device) shows.
			pollTimer = setInterval(() => { if (!document.hidden && state?.frozen) load(); }, 12000);
		}
		function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

		return {
			onShow() { renderLoading(); load(); startPoll(); },
			onHide() { stopPoll(); },
			destroy() { stopPoll(); panel.innerHTML = ''; },
		};
	},
});
