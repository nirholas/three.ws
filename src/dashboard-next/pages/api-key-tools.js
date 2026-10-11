// /dashboard/api: per-key tools.
//
// Analytics (calls by route, error rate, latency percentiles, top callers),
// rotation with an overlap window, and the IP allowlist. The keys page hands
// these its modal, toast and reveal helpers so this module stays free of the
// page's boot code and both can be imported in tests.
//
// Routes: GET  /api/keys/:id/analytics?days=
//         POST /api/keys/:id/rotate      { overlap_hours }
//         PUT  /api/keys/:id/allowlist   { ip_allowlist: [] }

import { get, post, put, esc, relTime, ApiError } from '../api.js';
import { skeletonHTML } from '../../shared/state-kit.js';

const DAY_CHOICES = [1, 7, 30, 90];
const OVERLAP_CHOICES = [
	{ hours: 24, label: '24 hours (recommended)' },
	{ hours: 1, label: '1 hour' },
	{ hours: 72, label: '3 days' },
	{ hours: 168, label: '7 days' },
	{ hours: 0, label: 'None: revoke the old key now' },
];

const fmtInt = (n) => Number(n || 0).toLocaleString();
const fmtMs = (n) => (n == null ? '-' : `${Math.round(n)} ms`);

/** Action buttons for one table row. A dead key keeps only its analytics. */
export function keyToolButtons(k, dead) {
	const id = esc(k.id);
	const name = esc(k.name);
	const out = [`<button type="button" class="dn-btn ghost dn-key-tool" data-act="analytics" data-key-id="${id}" data-key-name="${name}" aria-label="Analytics for ${name}">Analytics</button>`];
	if (!dead && !k.rotated_to) {
		out.push(`<button type="button" class="dn-btn ghost dn-key-tool" data-act="rotate" data-key-id="${id}" data-key-name="${name}" aria-label="Rotate ${name}">Rotate</button>`);
	}
	if (!dead) {
		const n = (k.ip_allowlist || []).length;
		out.push(`<button type="button" class="dn-btn ghost dn-key-tool" data-act="allowlist" data-key-id="${id}" data-key-name="${name}" aria-label="IP allowlist for ${name}">${n ? `IPs (${n})` : 'IPs'}</button>`);
	}
	return out.join('');
}

/** Lifecycle tag beside the status: a key mid-rotation or born from one. */
export function keyLifecycleTag(k) {
	if (k.rotated_to && k.overlap_until && new Date(k.overlap_until) > new Date()) {
		return `<span class="dn-tag warn" title="Rotated. This key keeps working until ${esc(new Date(k.overlap_until).toLocaleString())}">Overlap ${esc(relTime(k.overlap_until))}</span>`;
	}
	if (k.rotated_from) return `<span class="dn-tag" title="Minted by rotating an earlier key">Rotated in</span>`;
	return '';
}

/** Bind the tool buttons inside a rendered keys table. */
export function wireKeyTools(host, ctx) {
	host.querySelectorAll('[data-act="analytics"]').forEach((b) => b.addEventListener('click', () => openAnalyticsModal(b.dataset.keyId, b.dataset.keyName, ctx)));
	host.querySelectorAll('[data-act="rotate"]').forEach((b) => b.addEventListener('click', () => openRotateModal(findKey(ctx, b.dataset.keyId), ctx)));
	host.querySelectorAll('[data-act="allowlist"]').forEach((b) => b.addEventListener('click', () => openAllowlistModal(findKey(ctx, b.dataset.keyId), ctx)));
	injectKeyToolStyles();
}

function findKey(ctx, id) {
	return ctx.state.keys.find((k) => k.id === id);
}

// ── Analytics ────────────────────────────────────────────────────────────────

function openAnalyticsModal(id, name, ctx) {
	let days = 7;
	const { el } = ctx.openModal(`
		<div class="dn-modal-head">
			<h2>${esc(name)}</h2>
			<button type="button" class="dn-btn ghost" data-modal-close aria-label="Close">×</button>
		</div>
		<div class="dn-key-range" role="group" aria-label="Range">
			${DAY_CHOICES.map((d) => `<button type="button" class="dn-key-range-btn${d === days ? ' is-active' : ''}" data-days="${d}" aria-pressed="${d === days}">${d}d</button>`).join('')}
		</div>
		<div data-slot="analytics">${skeletonHTML(3, 'row')}</div>
	`);
	el.querySelector('.dn-modal').classList.add('dn-modal-wide');
	const slot = el.querySelector('[data-slot="analytics"]');
	const load = async () => {
		slot.innerHTML = skeletonHTML(3, 'row');
		try {
			const r = await get(`/api/keys/${encodeURIComponent(id)}/analytics?days=${days}`);
			slot.innerHTML = analyticsHtml(r.analytics, r.key);
		} catch (err) {
			slot.innerHTML = `<div class="dn-error">${esc(err instanceof ApiError ? err.message : 'Could not load analytics.')}</div>`;
		}
	};
	el.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => {
		days = Number(b.dataset.days);
		el.querySelectorAll('[data-days]').forEach((x) => {
			x.classList.toggle('is-active', x === b);
			x.setAttribute('aria-pressed', String(x === b));
		});
		load();
	}));
	load();
}

function analyticsHtml(a, key) {
	const t = a.totals;
	if (!t.calls) {
		return `<div class="dn-key-empty">No calls in the last ${a.days === 1 ? 'day' : `${a.days} days`}. Send a request with this key and it shows up here within a minute.</div>`;
	}
	const max = Math.max(1, ...a.daily.map((d) => d.calls));
	return `
		<div class="dn-key-kpis">
			${kpi(fmtInt(t.calls), 'Calls')}
			${kpi(`${(t.error_rate * 100).toFixed(1)}%`, 'Error rate', t.error_rate > 0.05 ? 'is-bad' : '')}
			${kpi(fmtMs(t.p50_ms), 'p50')}
			${kpi(fmtMs(t.p95_ms), 'p95')}
			${kpi(fmtMs(t.p99_ms), 'p99')}
			${kpi(t.last_call_at ? esc(relTime(t.last_call_at)) : 'never', 'Last call')}
		</div>
		<div class="dn-key-spark" role="img" aria-label="Calls per day">
			${a.daily.map((d) => `<div class="dn-key-spark-bar" style="height:${Math.max(4, (d.calls / max) * 100)}%" title="${esc(d.day)}: ${fmtInt(d.calls)} calls, ${fmtInt(d.errors)} errors"><div class="dn-key-spark-err" style="height:${d.calls ? (d.errors / d.calls) * 100 : 0}%"></div></div>`).join('')}
		</div>
		<h3 class="dn-key-h3">By route</h3>
		<div class="dn-table-wrap">
			<table class="dn-table dn-table-compact">
				<thead><tr><th>Route</th><th>Calls</th><th>Errors</th><th>p50</th><th>p95</th><th>p99</th></tr></thead>
				<tbody>${a.by_route.map((r) => `<tr><td><code class="dn-mono-sm">${esc(r.route)}</code></td><td>${fmtInt(r.calls)}</td><td>${fmtInt(r.errors)}</td><td>${fmtMs(r.p50_ms)}</td><td>${fmtMs(r.p95_ms)}</td><td>${fmtMs(r.p99_ms)}</td></tr>`).join('')}</tbody>
			</table>
		</div>
		<h3 class="dn-key-h3">Top callers</h3>
		${a.top_callers.length ? `
		<div class="dn-table-wrap">
			<table class="dn-table dn-table-compact">
				<thead><tr><th>IP</th><th>Calls</th><th>Errors</th><th>Last call</th></tr></thead>
				<tbody>${a.top_callers.map((c) => `<tr><td><code class="dn-mono-sm">${esc(c.ip || 'unknown')}</code></td><td>${fmtInt(c.calls)}</td><td>${fmtInt(c.errors)}</td><td><span class="dn-dim">${esc(relTime(c.last_call_at))}</span></td></tr>`).join('')}</tbody>
			</table>
		</div>` : '<p class="dn-dim">Caller addresses appear once requests carry one.</p>'}
		${(key.ip_allowlist || []).length ? `<p class="dn-dim dn-key-foot">Allowlist: ${key.ip_allowlist.map((r) => `<code class="dn-mono-sm">${esc(r)}</code>`).join(' ')}</p>` : ''}
	`;
}

function kpi(value, label, cls = '') {
	return `<div class="dn-key-kpi ${cls}"><div class="dn-key-kpi-value">${value}</div><div class="dn-key-kpi-label">${label}</div></div>`;
}

// ── Rotation ─────────────────────────────────────────────────────────────────

function openRotateModal(k, ctx) {
	if (!k) return;
	const { el, close } = ctx.openModal(`
		<div class="dn-modal-head">
			<h2>Rotate ${esc(k.name)}</h2>
			<button type="button" class="dn-btn ghost" data-modal-close aria-label="Close">×</button>
		</div>
		<p class="dn-modal-body">A new secret is minted with the same name, scopes, expiry and IP allowlist. The old key keeps working for the overlap window so you can move every deployment without a gap, then stops on its own.</p>
		<label class="dn-field">
			<span>Overlap window</span>
			<select class="dn-select" data-overlap>
				${OVERLAP_CHOICES.map((o) => `<option value="${o.hours}">${o.label}</option>`).join('')}
			</select>
		</label>
		<div data-slot="error" class="dn-error" hidden></div>
		<div class="dn-modal-foot">
			<button type="button" class="dn-btn ghost" data-modal-close>Cancel</button>
			<button type="button" class="dn-btn primary" data-confirm data-autofocus>Rotate key</button>
		</div>
	`);
	const btn = el.querySelector('[data-confirm]');
	const errSlot = el.querySelector('[data-slot="error"]');
	btn.addEventListener('click', async () => {
		btn.disabled = true;
		btn.textContent = 'Rotating…';
		try {
			const hours = Number(el.querySelector('[data-overlap]').value);
			const resp = await post(`/api/keys/${encodeURIComponent(k.id)}/rotate`, { overlap_hours: hours });
			const idx = ctx.state.keys.findIndex((x) => x.id === k.id);
			const old = { ...k, rotated_to: resp.key.id, overlap_until: resp.previous.overlap_until, revoked_at: resp.previous.revoked ? new Date().toISOString() : k.revoked_at };
			const fresh = { ...resp.key };
			delete fresh.secret;
			ctx.state.keys.splice(idx, 1, fresh, old);
			close();
			ctx.openKeyRevealModal(resp.key);
			ctx.toast(hours === 0 ? `Rotated ${k.name}; the old key is revoked` : `Rotated ${k.name}; the old key works for ${hours}h more`);
			ctx.rerender();
		} catch (err) {
			btn.disabled = false;
			btn.textContent = 'Rotate key';
			errSlot.textContent = err instanceof ApiError ? err.message : 'Could not rotate.';
			errSlot.hidden = false;
		}
	});
}

// ── IP allowlist ─────────────────────────────────────────────────────────────

function openAllowlistModal(k, ctx) {
	if (!k) return;
	const current = (k.ip_allowlist || []).join('\n');
	const { el, close } = ctx.openModal(`
		<div class="dn-modal-head">
			<h2>IP allowlist for ${esc(k.name)}</h2>
			<button type="button" class="dn-btn ghost" data-modal-close aria-label="Close">×</button>
		</div>
		<p class="dn-modal-body">One address or CIDR range per line, IPv4 or IPv6. With a list, requests from anywhere else answer 401. Leave it empty to accept every address.</p>
		<textarea class="dn-input dn-key-allowlist" rows="6" spellcheck="false" placeholder="203.0.113.7&#10;10.0.0.0/8&#10;2001:db8::/32" data-rules data-autofocus>${esc(current)}</textarea>
		<div data-slot="error" class="dn-error" hidden></div>
		<div class="dn-modal-foot">
			<button type="button" class="dn-btn ghost" data-modal-close>Cancel</button>
			<button type="button" class="dn-btn primary" data-confirm>Save allowlist</button>
		</div>
	`);
	const btn = el.querySelector('[data-confirm]');
	const errSlot = el.querySelector('[data-slot="error"]');
	btn.addEventListener('click', async () => {
		btn.disabled = true;
		btn.textContent = 'Saving…';
		try {
			const rules = el.querySelector('[data-rules]').value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
			const resp = await put(`/api/keys/${encodeURIComponent(k.id)}/allowlist`, { ip_allowlist: rules });
			const row = findKey(ctx, k.id);
			if (row) row.ip_allowlist = resp.ip_allowlist;
			close();
			ctx.toast(resp.ip_allowlist.length ? `${k.name} now answers only ${resp.ip_allowlist.length} ${resp.ip_allowlist.length === 1 ? 'address' : 'rules'}` : `${k.name} accepts every address again`);
			ctx.rerender();
		} catch (err) {
			btn.disabled = false;
			btn.textContent = 'Save allowlist';
			errSlot.textContent = err instanceof ApiError ? err.message : 'Could not save.';
			errSlot.hidden = false;
		}
	});
}

// ── Styles ───────────────────────────────────────────────────────────────────

function injectKeyToolStyles() {
	if (document.getElementById('dn-key-tool-styles')) return;
	const style = document.createElement('style');
	style.id = 'dn-key-tool-styles';
	style.textContent = `
		.dn-key-actions { display:inline-flex; gap:6px; flex-wrap:wrap; justify-content:flex-end; }
		.dn-key-status { display:inline-flex; gap:6px; flex-wrap:wrap; align-items:center; }
		.dn-key-tool { padding:5px 10px; font-size:12px; }
		.dn-modal-wide { width:760px; }
		.dn-key-range { display:inline-flex; gap:4px; background:var(--nxt-bg-2); border-radius:8px; padding:3px; margin-bottom:14px; }
		.dn-key-range-btn { padding:5px 12px; border:none; background:none; color:var(--nxt-ink-dim); font:inherit; font-size:12px; font-weight:600; border-radius:6px; cursor:pointer; transition:all 0.15s; }
		.dn-key-range-btn:hover { color:var(--nxt-ink); }
		.dn-key-range-btn.is-active { background:rgba(108,138,255,0.15); color:#6c8aff; }
		.dn-key-range-btn:focus-visible { outline:2px solid var(--nxt-accent); outline-offset:2px; }
		.dn-key-kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(100px,1fr)); gap:10px; margin-bottom:14px; }
		.dn-key-kpi { padding:10px 12px; border:1px solid var(--nxt-stroke); border-radius:10px; }
		.dn-key-kpi.is-bad .dn-key-kpi-value { color:var(--nxt-danger); }
		.dn-key-kpi-value { font-size:18px; font-weight:700; letter-spacing:-0.02em; }
		.dn-key-kpi-label { font-size:11px; color:var(--nxt-ink-dim); margin-top:2px; }
		.dn-key-spark { display:flex; align-items:flex-end; gap:3px; height:64px; padding:6px 0 0; margin-bottom:16px; }
		.dn-key-spark-bar { flex:1; min-width:3px; background:rgba(108,138,255,0.55); border-radius:3px 3px 0 0; position:relative; overflow:hidden; transition:height 0.3s ease; }
		.dn-key-spark-err { position:absolute; bottom:0; left:0; right:0; background:var(--nxt-danger); }
		.dn-key-h3 { font-size:13px; font-weight:600; margin:14px 0 8px; }
		.dn-table-compact td, .dn-table-compact th { padding:6px 10px; font-size:12.5px; }
		.dn-key-empty { padding:24px; text-align:center; color:var(--nxt-ink-dim); font-size:13.5px; line-height:1.5; }
		.dn-key-foot { margin-top:12px; font-size:12px; }
		.dn-key-allowlist { width:100%; font-family:'JetBrains Mono', ui-monospace, monospace; font-size:12.5px; resize:vertical; margin-top:8px; }
		@media (prefers-reduced-motion: reduce) { .dn-key-range-btn, .dn-key-spark-bar { transition:none !important; } }
	`;
	document.head.appendChild(style);
}
