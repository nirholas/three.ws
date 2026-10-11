/**
 * Agent Wallet hub: Allowlist tab.
 *
 * Owner-only. The destination whitelist for this agent: every address funds may
 * be sent to, with a label, optional per-destination caps and a cooldown before a
 * new address becomes usable. Driven entirely by /api/wallet-whitelist.
 *
 *   - Adding or approving an address, and editing the settings, needs step-up
 *     (password or an emailed code). The grant is one-use and bound to the exact
 *     change, so nothing else can ride on it.
 *   - A pending address shows a live countdown and can be cancelled in one click.
 *   - Removal is instant and needs no step-up.
 *   - An address an agent proposed waits here for the owner to approve it.
 */

import { registerWalletTab } from '../registry.js';
import { consumeCsrfToken } from '../../api.js';
import { injectStyle as injectBaseStyle } from './withdraw.js';

const STYLE_ID = 'awh-whitelist-style';
const STYLE = `
.awh-wl-head { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:var(--space-3,12px); }
.awh-wl-head h3 { margin:0; font-size:var(--text-md,.8125rem); color:var(--ink-bright,#fff); }
.awh-wl-list { list-style:none; margin:0; padding:0; }
.awh-wl-item { display:flex; gap:12px; align-items:flex-start; justify-content:space-between; padding:12px 0; border-bottom:1px solid var(--stroke,rgba(255,255,255,.06)); animation:awh-wl-in 180ms ease-out; }
.awh-wl-item:last-child { border-bottom:none; }
.awh-wl-main { min-width:0; flex:1; }
.awh-wl-label { color:var(--ink-bright,#fff); font-size:var(--text-md,.8125rem); font-weight:500; overflow-wrap:anywhere; }
.awh-wl-addr { font-family:var(--font-mono,ui-monospace,monospace); font-size:var(--text-sm,.764rem); color:var(--ink-dim,#888); word-break:break-all; margin-top:2px; }
.awh-wl-meta { display:flex; gap:6px; flex-wrap:wrap; margin-top:6px; }
.awh-wl-tag { font-size:var(--text-2xs,.6875rem); border-radius:var(--radius-pill,999px); padding:2px 9px; border:1px solid var(--stroke,rgba(255,255,255,.1)); color:var(--ink,#e8e8e8); background:var(--surface-2,rgba(255,255,255,.06)); }
.awh-wl-tag.active { color:var(--success,#4ade80); border-color:color-mix(in srgb,var(--success,#4ade80) 35%,transparent); }
.awh-wl-tag.pending, .awh-wl-tag.proposed { color:var(--warn,#fbbf24); border-color:color-mix(in srgb,var(--warn,#fbbf24) 35%,transparent); }
.awh-wl-acts { display:flex; gap:6px; flex:none; flex-wrap:wrap; justify-content:flex-end; }
.awh-wl-acts .awh-btn { padding:5px 11px; font-size:var(--text-sm,.764rem); }
.awh-wl-empty { text-align:center; padding:var(--space-5,20px) var(--space-3,12px); color:var(--ink-dim,#888); font-size:var(--text-sm,.764rem); }
.awh-wl-empty strong { display:block; color:var(--ink,#e8e8e8); font-size:var(--text-md,.8125rem); margin-bottom:4px; }
.awh-wl-form { display:grid; gap:10px; grid-template-columns:1fr 1fr; }
.awh-wl-form .full { grid-column:1 / -1; }
.awh-wl-form label { display:block; font-size:var(--text-sm,.764rem); color:var(--ink-dim,#888); margin-bottom:5px; }
.awh-wl-step { border:1px solid var(--stroke,rgba(255,255,255,.1)); border-radius:var(--radius-md,10px); padding:12px; margin-top:12px; background:var(--surface-2,rgba(255,255,255,.04)); }
.awh-wl-step .awh-sub { display:flex; gap:6px; margin-bottom:10px; }
.awh-wl-info { font-size:var(--text-sm,.764rem); color:var(--ink-dim,#888); margin:0 0 var(--space-3,12px); line-height:1.5; }
.awh-wl-pending-change { color:var(--warn,#fbbf24); font-size:var(--text-sm,.764rem); margin-top:8px; }
@keyframes awh-wl-in { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }
@media (max-width:520px) { .awh-wl-form { grid-template-columns:1fr; } .awh-wl-item { flex-direction:column; } .awh-wl-acts { justify-content:flex-start; } }
@media (prefers-reduced-motion: reduce) { .awh-wl-item { animation:none; } }
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
		if (!r.ok) return { ok: false, status: r.status, code: j?.error || 'error', message: j?.error_description || `request failed (${r.status})` };
		return { ok: true, data: j?.data ?? j };
	} catch (err) {
		return { ok: false, status: 0, code: 'network_error', message: err?.message || 'network error' };
	}
}

function countdown(seconds) {
	const s = Math.max(0, Math.round(seconds));
	if (s >= 86400) return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
	if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
	if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
	return `${s}s`;
}

function hours(seconds) {
	const h = seconds / 3600;
	return Number.isInteger(h) ? String(h) : h.toFixed(2).replace(/0+$/, '');
}

registerWalletTab({
	id: 'whitelist',
	label: 'Allowlist',
	order: 62,
	ownerOnly: true,
	mount({ panel, ctx }) {
		injectBaseStyle();
		injectStyle();
		const esc = ctx.escapeHtml;
		const api = '/api/wallet-whitelist';
		let destroyed = false;
		let ticker = null;

		const state = {
			data: null,        // GET payload | { error }
			loadedAt: 0,
			form: { open: false },
			step: null,        // { op: { kind, body }, label, method, codeSent, busy, err, run }
			err: null,
		};

		function chainTag(c) { return c === 'evm' ? 'EVM' : 'Solana'; }
		function secondsLeft(e) { return Math.max(0, e.seconds_until_active - (Date.now() - state.loadedAt) / 1000); }
		function money(v) { return v == null ? 'no cap' : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`; }

		function entryHtml(e) {
			const left = secondsLeft(e);
			const tag = e.status === 'pending' ? `<span class="awh-wl-tag pending" data-cd="${esc(e.id)}">Activates in ${esc(countdown(left))}</span>`
				: e.status === 'proposed' ? '<span class="awh-wl-tag proposed">Proposed, needs your approval</span>'
				: '<span class="awh-wl-tag active">Active</span>';
			const by = e.proposed_by && e.proposed_by !== 'owner' && e.proposed_by !== 'legacy' ? `<span class="awh-wl-tag">Proposed by ${esc(e.proposed_by)}</span>` : '';
			const acts = e.status === 'proposed'
				? `<button class="awh-btn awh-btn--primary" type="button" data-act="approve" data-id="${esc(e.id)}">Approve</button><button class="awh-btn" type="button" data-act="cancel" data-id="${esc(e.id)}">Reject</button>`
				: e.status === 'pending'
					? `<button class="awh-btn awh-btn--danger" type="button" data-act="cancel" data-id="${esc(e.id)}">Cancel</button>`
					: `<button class="awh-btn" type="button" data-act="remove" data-id="${esc(e.id)}" aria-label="Remove ${esc(e.label || e.address)}">Remove</button>`;
			return `<li class="awh-wl-item">
				<div class="awh-wl-main">
					<div class="awh-wl-label">${esc(e.label || 'Unlabeled address')}</div>
					<div class="awh-wl-addr">${esc(e.address)}</div>
					<div class="awh-wl-meta">${tag}<span class="awh-wl-tag">${chainTag(e.chain)}</span><span class="awh-wl-tag">Per send: ${esc(money(e.per_tx_cap_usd))}</span><span class="awh-wl-tag">Per day: ${esc(money(e.daily_cap_usd))}</span>${by}</div>
				</div>
				<div class="awh-wl-acts">${acts}</div>
			</li>`;
		}

		function stepHtml() {
			const s = state.step;
			if (!s) return '';
			const email = s.method === 'email_code';
			return `<div class="awh-wl-step" role="group" aria-label="Confirm your identity">
				<p class="awh-wl-info" style="margin-bottom:8px;"><strong style="color:var(--ink-bright,#fff);">Confirm it is you.</strong> ${esc(s.label)}</p>
				<div class="awh-sub awh-wd-sub">
					<button type="button" data-method="password" aria-pressed="${!email}">Password</button>
					<button type="button" data-method="email_code" aria-pressed="${email}">Emailed code</button>
				</div>
				${email
					? `<div class="awh-row"><button class="awh-btn" type="button" data-act="send-code" ${s.busy ? 'disabled' : ''}>${s.codeSent ? 'Send a new code' : 'Email me a code'}</button><input class="awh-in" id="awh-wl-proof" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6-digit code" ${s.codeSent ? '' : 'disabled'}></div>`
					: '<input class="awh-in" id="awh-wl-proof" type="password" autocomplete="current-password" placeholder="Account password">'}
				${s.err ? `<div class="awh-err" role="alert" style="margin-top:10px;">${esc(s.err)}</div>` : ''}
				<div class="awh-actions"><button class="awh-btn" type="button" data-act="step-cancel" ${s.busy ? 'disabled' : ''}>Back</button><button class="awh-btn awh-btn--primary" type="button" data-act="step-go" ${s.busy ? 'disabled' : ''} style="flex:1;">${s.busy ? '<span class="awh-spin"></span>Working…' : 'Confirm'}</button></div>
			</div>`;
		}

		function formHtml() {
			if (!state.form.open) return '';
			return `<form class="awh-wl-form" id="awh-wl-form" novalidate style="margin-top:12px;">
				<div class="full"><label for="awh-wl-addr">Address (Solana or EVM)</label><input class="awh-in" id="awh-wl-addr" autocomplete="off" spellcheck="false" required></div>
				<div class="full"><label for="awh-wl-label">Label</label><input class="awh-in" id="awh-wl-label" maxlength="60" placeholder="Cold wallet, exchange deposit, ..."></div>
				<div><label for="awh-wl-ptx">Max per send (USD, optional)</label><input class="awh-in" id="awh-wl-ptx" inputmode="decimal" placeholder="No cap"></div>
				<div><label for="awh-wl-day">Max per day (USD, optional)</label><input class="awh-in" id="awh-wl-day" inputmode="decimal" placeholder="No cap"></div>
				<div class="full awh-actions" style="margin-top:0;"><button class="awh-btn" type="button" data-act="form-cancel">Cancel</button><button class="awh-btn awh-btn--primary" type="submit" style="flex:1;">Continue</button></div>
			</form>`;
		}

		function settingsHtml(d) {
			const pc = d.settings?.pending_change;
			const when = pc?.effective_at ? new Date(pc.effective_at).toLocaleString() : null;
			return `<div class="awh-card">
				<div class="awh-card-h">Settings</div>
				<p class="awh-wl-info">A new address cannot receive funds until its cooldown ends. You are emailed and notified on every connected channel the moment one is added, and can cancel it with one click. The cooldown can never be shorter than ${esc(hours(d.min_cooldown_seconds))} hour(s).</p>
				<div class="awh-wl-form">
					<div><label for="awh-wl-cd">Cooldown (hours)</label><input class="awh-in" id="awh-wl-cd" inputmode="decimal" value="${esc(hours(d.settings.cooldown_seconds))}"></div>
					<div><label for="awh-wl-enf">Restrict sends to this list</label><select class="awh-sel" id="awh-wl-enf"><option value="on" ${d.enforced ? 'selected' : ''}>On</option><option value="off" ${d.enforced ? '' : 'selected'}>Off (any address)</option></select></div>
					<div class="full"><button class="awh-btn" type="button" data-act="save-settings">Save settings</button></div>
				</div>
				<p class="awh-wl-info" style="margin-top:10px;margin-bottom:0;">Making protection weaker (a shorter cooldown, or turning the restriction off) takes effect one full cooldown after you ask. Making it stronger is instant.</p>
				${pc ? `<div class="awh-wl-pending-change">Waiting to apply${when ? ` at ${esc(when)}` : ''}: ${pc.cooldown_seconds != null ? `cooldown ${esc(hours(pc.cooldown_seconds))}h` : ''}${pc.enforced === false ? ' restriction off' : ''}</div>` : ''}
			</div>`;
		}

		function render() {
			if (destroyed) return;
			const d = state.data;
			if (d === null) {
				panel.innerHTML = '<div class="awh-card"><div class="awh-skel-line" style="width:45%"></div><div class="awh-skel-line"></div><div class="awh-skel-line"></div></div>';
				return;
			}
			if (d.error) {
				panel.innerHTML = `<div class="awh-card"><div class="awh-err" role="alert">Could not load the allowlist.<div class="why">${esc(d.error)}</div></div><button class="awh-btn" type="button" data-act="reload">Retry</button></div>`;
				panel.querySelector('[data-act="reload"]').addEventListener('click', load);
				return;
			}
			const list = d.entries.length
				? `<ul class="awh-wl-list">${d.entries.map(entryHtml).join('')}</ul>`
				: `<div class="awh-wl-empty"><strong>No addresses yet</strong>${d.enforced ? 'Nothing can be sent out of this wallet until you add and activate an address.' : 'Funds can currently go to any address. Add one to start restricting sends to a list you control.'}</div>`;
			panel.innerHTML = `
				<div class="awh-card">
					<div class="awh-wl-head"><h3>Approved destinations</h3><div><span class="awh-chip${d.enforced ? '' : ' alert'}">${d.enforced ? 'Restriction on' : 'Restriction off'}</span> <button class="awh-btn awh-btn--primary" type="button" data-act="add" ${state.form.open || state.step ? 'disabled' : ''}>Add address</button></div></div>
					${state.err ? `<div class="awh-err" role="alert">${esc(state.err)}</div>` : ''}
					${list}
					${formHtml()}
					${stepHtml()}
				</div>
				${settingsHtml(d)}`;
			wire();
		}

		function wire() {
			panel.querySelector('[data-act="add"]')?.addEventListener('click', () => { state.form = { open: true }; state.err = null; render(); panel.querySelector('#awh-wl-addr')?.focus(); });
			panel.querySelector('[data-act="form-cancel"]')?.addEventListener('click', () => { state.form = { open: false }; render(); });
			panel.querySelector('#awh-wl-form')?.addEventListener('submit', (ev) => {
				ev.preventDefault();
				const val = (id) => panel.querySelector(id).value.trim();
				const num = (v) => (v === '' ? null : Number(v));
				const body = { address: val('#awh-wl-addr'), label: val('#awh-wl-label'), per_tx_cap_usd: num(val('#awh-wl-ptx')), daily_cap_usd: num(val('#awh-wl-day')) };
				if (!body.address) { state.err = 'Enter an address.'; render(); return; }
				for (const k of ['per_tx_cap_usd', 'daily_cap_usd']) {
					if (body[k] != null && (!Number.isFinite(body[k]) || body[k] < 0)) { state.err = 'Caps must be non-negative numbers.'; render(); return; }
				}
				state.err = null;
				startStep({ kind: 'add', body }, `Adding ${body.label || body.address} starts a ${hours(state.data.settings.cooldown_seconds)} hour cooldown.`, 'add', body);
			});
			panel.querySelectorAll('[data-act="approve"]').forEach((b) => b.addEventListener('click', () => {
				startStep({ kind: 'approve', body: { id: b.dataset.id } }, 'Approving this proposed address starts its cooldown.', 'approve', { id: b.dataset.id });
			}));
			panel.querySelectorAll('[data-act="cancel"]').forEach((b) => b.addEventListener('click', () => act('cancel', { id: b.dataset.id }, 'Cancelled')));
			panel.querySelectorAll('[data-act="remove"]').forEach((b) => b.addEventListener('click', () => {
				if (confirm('Remove this address? Funds can no longer be sent to it.')) act('remove', { id: b.dataset.id }, 'Removed');
			}));
			panel.querySelector('[data-act="save-settings"]')?.addEventListener('click', () => {
				const cd = Number(panel.querySelector('#awh-wl-cd').value);
				const enforced = panel.querySelector('#awh-wl-enf').value === 'on';
				if (!Number.isFinite(cd) || cd * 3600 < state.data.min_cooldown_seconds) { state.err = `Cooldown must be at least ${hours(state.data.min_cooldown_seconds)} hour(s).`; render(); return; }
				state.err = null;
				const body = { cooldown_seconds: Math.round(cd * 3600), enforced };
				startStep({ kind: 'settings', body }, 'Changing the allowlist settings needs confirmation.', 'settings', body);
			});
			panel.querySelectorAll('[data-method]').forEach((b) => b.addEventListener('click', () => { state.step.method = b.dataset.method; state.step.err = null; render(); }));
			panel.querySelector('[data-act="step-cancel"]')?.addEventListener('click', () => { state.step = null; render(); });
			panel.querySelector('[data-act="send-code"]')?.addEventListener('click', sendCode);
			panel.querySelector('[data-act="step-go"]')?.addEventListener('click', confirmStep);
			panel.querySelector('#awh-wl-proof')?.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') confirmStep(); });
		}

		function startStep(op, label, action, payload) {
			state.step = { op, label, method: 'password', codeSent: false, busy: false, err: null, action, payload };
			state.form = { open: false };
			render();
			panel.querySelector('#awh-wl-proof')?.focus();
		}

		async function sendCode() {
			const s = state.step;
			s.busy = true; s.err = null; render();
			const res = await call(api, { method: 'POST', body: { action: 'stepup_code', agent_id: ctx.agentId, kind: s.op.kind, op: s.op.body } });
			if (destroyed) return;
			s.busy = false;
			if (res.ok) { s.codeSent = true; ctx.toast('Code sent to your email'); } else s.err = res.message;
			render();
		}

		async function confirmStep() {
			const s = state.step;
			const proofVal = panel.querySelector('#awh-wl-proof')?.value || '';
			if (!proofVal) { s.err = s.method === 'password' ? 'Enter your password.' : 'Enter the code from the email.'; render(); return; }
			s.busy = true; s.err = null; render();
			const proof = s.method === 'password' ? { password: proofVal } : { code: proofVal };
			const grant = await call(api, { method: 'POST', body: { action: 'stepup', agent_id: ctx.agentId, kind: s.op.kind, op: s.op.body, method: s.method, proof } });
			if (destroyed) return;
			if (!grant.ok) { s.busy = false; s.err = grant.message; render(); return; }
			const res = await call(api, { method: 'POST', body: { action: s.action, agent_id: ctx.agentId, grant: grant.data.grant || grant.data.id, ...s.payload } });
			if (destroyed) return;
			if (!res.ok) { s.busy = false; s.err = res.message; render(); return; }
			state.step = null;
			ctx.toast(s.action === 'settings' ? 'Settings saved' : 'Address submitted');
			await load();
		}

		async function act(action, payload, doneMsg) {
			state.err = null;
			const res = await call(api, { method: 'POST', body: { action, agent_id: ctx.agentId, ...payload } });
			if (destroyed) return;
			if (!res.ok) { state.err = res.message; render(); return; }
			ctx.toast(doneMsg);
			await load();
		}

		async function load() {
			const res = await call(`${api}?agent=${encodeURIComponent(ctx.agentId)}`);
			if (destroyed) return;
			state.data = res.ok ? res.data : { error: res.message };
			state.loadedAt = Date.now();
			render();
		}

		function tick() {
			if (!state.data?.entries) return;
			let due = false;
			panel.querySelectorAll('[data-cd]').forEach((el) => {
				const e = state.data.entries.find((x) => x.id === el.dataset.cd);
				if (!e) return;
				const left = secondsLeft(e);
				if (left <= 0) due = true;
				else el.textContent = `Activates in ${countdown(left)}`;
			});
			if (due) load();
		}

		render();
		load();
		ticker = setInterval(tick, 1000);

		return {
			onShow() { if (Date.now() - state.loadedAt > 15000) load(); },
			destroy() { destroyed = true; clearInterval(ticker); },
		};
	},
});
