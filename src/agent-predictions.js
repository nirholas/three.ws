/**
 * Agent Predictions: shadow-mode P&L versus live, plus the no-arbitrage scanner.
 *
 * Routes: /agents/:id/predictions and /agent-predictions (?id=<uuid>). Without
 * an id the page shows the public scanner only. API: /api/v1/agents/:id/predictions
 * (docs/predictions.md). Nothing on this page moves funds: it reads the shadow
 * ledger, reads the scanner, and flips the strategy mode, which only the
 * signed-in owner may turn to live.
 */

import './agent-predictions.css';
import { consumeCsrfToken } from './api.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const root = document.getElementById('apd-root');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const usd = (n, sign = false) => {
	const v = Number(n);
	if (n == null || !Number.isFinite(v)) return '-';
	const s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	return `${sign ? (v > 0 ? '+' : v < 0 ? '-' : '') : v < 0 ? '-' : ''}$${s}`;
};
const cents = (p) => (p == null ? '-' : `${(Number(p) * 100).toFixed(1)}c`);
const pct = (n, d = 2) => (n == null || !Number.isFinite(Number(n)) ? '-' : `${Number(n).toFixed(d)}%`);
const tone = (n) => (Number(n) > 0 ? 'apd-pos' : Number(n) < 0 ? 'apd-neg' : '');

class ApiFailure extends Error {
	constructor(status, code, message) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

async function api(path, { method = 'GET', body } = {}) {
	const opts = { method, credentials: 'include', headers: { accept: 'application/json' } };
	if (body !== undefined) {
		opts.headers['content-type'] = 'application/json';
		opts.body = JSON.stringify(body);
	}
	if (method !== 'GET') {
		const token = await consumeCsrfToken();
		if (token) opts.headers['x-csrf-token'] = token;
	}
	let res;
	try {
		res = await fetch(path, opts);
	} catch {
		throw new ApiFailure(0, 'network_error', 'Could not reach three.ws. Check your connection and try again.');
	}
	let j = null;
	try {
		j = await res.json();
	} catch {
		j = null;
	}
	if (!res.ok) throw new ApiFailure(res.status, j?.error?.code || 'error', j?.error?.message || `Request failed (${res.status}).`);
	return j?.data;
}

function skeleton(rows = 4) {
	return `<div aria-busy="true" aria-label="Loading">${'<div class="apd-skel"></div>'.repeat(rows)}</div>`;
}

function message(title, body, actions = [], error = false) {
	return `<div class="apd-msg${error ? ' is-error' : ''}" role="${error ? 'alert' : 'status'}"><strong>${esc(title)}</strong><p>${esc(body)}</p>${actions
		.map((a) => `<a class="apd-btn${a.primary ? ' is-primary' : ''}" href="${esc(a.href)}">${esc(a.label)}</a>`)
		.join(' ')}</div>`;
}

// ── scanner ──────────────────────────────────────────────────────────────────

function scannerHtml(scan) {
	if (!scan.opportunities.length) {
		return message('No priced books right now', 'The scanner read the most active markets but none had both sides quoted. It refreshes whenever you reload.');
	}
	const rows = scan.opportunities
		.map(
			(o) => `<tr>
			<td>${esc(o.title)}<br /><span class="apd-pill">${esc(o.provider || 'venue')}</span> ${o.executable ? '<span class="apd-pill is-shadow">opportunity</span>' : ''}</td>
			<td>${cents(o.yes_ask)}</td><td>${cents(o.no_ask)}</td>
			<td class="${tone(o.gross_edge)}">${cents(o.gross_edge)}</td>
			<td class="${tone(o.net_edge)}">${cents(o.net_edge)}</td>
			<td class="${tone(o.net_edge_pct)}">${pct(o.net_edge_pct)}</td>
			<td>${o.fill.contracts ? `${usd(o.fill.profit_usd, true)} on ${usd(o.fill.cost_usd)}` : '-'}</td></tr>`,
		)
		.join('');
	return `<p class="apd-note">${scan.books_read} order books read of ${scan.scanned_markets} open markets, ${esc(new Date(scan.scanned_at).toLocaleTimeString())}. Edge is what buying both YES and NO locks in per contract after the venue and provider fees in the fee model. Negative is the normal state of an efficient market.</p>
	<div class="apd-table-wrap"><table class="apd-table"><thead><tr><th>Market</th><th>YES ask</th><th>NO ask</th><th>Gross edge</th><th>Net edge</th><th>Net %</th><th>Fillable profit</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ── shadow vs live ───────────────────────────────────────────────────────────

function modeCard(label, s) {
	return `<div class="apd-card"><h3>${esc(label)}</h3>
		<div class="apd-big ${tone(s.total_pnl_usd)}">${usd(s.total_pnl_usd, true)}</div>
		<dl class="apd-kv">
			<dt>Decisions</dt><dd>${s.entries} (${s.open} open)</dd>
			<dt>Staked</dt><dd>${usd(s.staked_usd)}</dd>
			<dt>Realized</dt><dd class="${tone(s.realized_pnl_usd)}">${usd(s.realized_pnl_usd, true)}</dd>
			<dt>Unrealized</dt><dd class="${tone(s.unrealized_pnl_usd)}">${usd(s.unrealized_pnl_usd, true)}</dd>
			<dt>Before fees and slippage</dt><dd class="${tone(s.gross_pnl_usd)}">${usd(s.gross_pnl_usd, true)}</dd>
			<dt>Fees and slippage</dt><dd>${usd(s.costs_usd)}</dd>
			<dt>Win rate</dt><dd>${s.win_rate == null ? 'no settled trades' : pct(s.win_rate * 100, 0)}</dd>
		</dl></div>`;
}

function ledgerHtml(entries) {
	if (!entries.length) {
		return message('No decisions recorded yet', 'In shadow mode your agent records every trade it would make, at the live price, without sending anything. Have it post an intent to /api/v1/agents/:id/predictions/shadow/intent, or call the prediction tools over MCP. Results appear here.');
	}
	const rows = entries
		.map(
			(e) => `<tr>
			<td>${esc(e.title)}<br /><span class="apd-pill is-${esc(e.mode)}">${esc(e.mode)}</span> <span class="apd-pill">${esc(e.side)}</span> ${e.reason ? `<span class="apd-note">${esc(e.reason)}</span>` : ''}</td>
			<td>${esc(new Date(e.decided_at).toLocaleDateString())}</td>
			<td>${cents(e.price_at_decision)}</td><td>${cents(e.entry_price)}</td>
			<td>${usd(e.cost_usd)}</td>
			<td>${e.mark_price == null ? '-' : cents(e.mark_price)}</td>
			<td><span class="apd-pill">${esc(e.status)}</span></td>
			<td class="${tone(e.pnl_usd)}">${e.pnl_usd == null ? '-' : usd(e.pnl_usd, true)}</td></tr>`,
		)
		.join('');
	return `<div class="apd-table-wrap"><table class="apd-table"><thead><tr><th>Decision</th><th>Date</th><th>Price at decision</th><th>Avg fill</th><th>Cost</th><th>Mark</th><th>Status</th><th>P&amp;L</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function strategyHtml(st) {
	const live = st.mode === 'live';
	return `<div class="apd-card"><h3>Strategy mode</h3>
		<div class="apd-big"><span class="apd-pill ${live ? 'is-live' : 'is-shadow'}">${live ? 'Live' : 'Shadow'}</span></div>
		<p class="apd-note">${live ? 'Live: decisions are recorded and each one is previewed for you to confirm. Nothing is sent without your confirmation.' : 'Shadow: decisions are recorded at the live price. No order is built and no funds can move.'}</p>
		<dl class="apd-kv"><dt>Max stake per decision</dt><dd>${usd(st.max_stake_usd)}</dd><dt>Minimum stated edge</dt><dd>${pct(st.min_edge_pct, 1)}</dd></dl>
		<p><button class="apd-btn${live ? '' : ' is-primary'}" id="apd-mode" data-to="${live ? 'shadow' : 'live'}">${live ? 'Switch back to shadow' : 'Enable live decisions'}</button></p>
		<p class="apd-note" id="apd-mode-msg" role="status"></p></div>`;
}

async function loadAgentSection(agentId, host) {
	host.innerHTML = skeleton(5);
	const base = `/api/v1/agents/${encodeURIComponent(agentId)}/predictions`;
	try {
		const [strategy, shadow] = await Promise.all([api(`${base}/strategy`), api(`${base}/shadow`)]);
		host.innerHTML = `<div class="apd-grid">${strategyHtml(strategy)}${modeCard('Shadow results', shadow.summary.shadow)}${modeCard('Live results', shadow.summary.live)}</div>
			<h2 style="margin-top:var(--space-lg)">Decisions</h2>${ledgerHtml(shadow.entries)}`;
		const btn = host.querySelector('#apd-mode');
		btn?.addEventListener('click', async () => {
			const to = btn.dataset.to;
			const out = host.querySelector('#apd-mode-msg');
			btn.disabled = true;
			try {
				await api(`${base}/strategy`, { method: 'PUT', body: { mode: to } });
				await loadAgentSection(agentId, host);
			} catch (err) {
				out.textContent = err.code === 'owner_session_required' ? 'Only you, signed in on three.ws, can turn live on. Sign in and try again.' : err.message;
				btn.disabled = false;
			}
		});
	} catch (err) {
		host.innerHTML = err.status === 401 || err.status === 403
			? message('Sign in as this agent\'s owner', 'Shadow results are private to the agent\'s owner.', [{ href: `/login?next=${encodeURIComponent(location.pathname + location.search)}`, label: 'Sign in', primary: true }])
			: message('Could not load shadow results', err.message, [], true);
	}
}

async function loadScanner(host) {
	host.innerHTML = skeleton(6);
	try {
		host.innerHTML = scannerHtml(await api('/api/predictions/scan?limit=15'));
	} catch (err) {
		host.innerHTML = message('The scanner could not read the venue', `${err.message} Reload to try again.`, [], true);
	}
}

function agentIdFromUrl() {
	const q = new URLSearchParams(location.search).get('id');
	if (q) return q;
	const m = location.pathname.match(/\/agents\/([^/]+)\/predictions/);
	return m ? decodeURIComponent(m[1]) : null;
}

function boot() {
	const agentId = agentIdFromUrl();
	const valid = agentId && UUID_RE.test(agentId);
	document.title = 'Agent Predictions · three.ws';
	root.innerHTML = `<h1 class="apd-h1">Agent Predictions</h1>
		<p class="apd-lede">Your agent decides on Solana event contracts in shadow mode first: every trade is recorded at the live price and marked at resolution, so you can see what live would have paid before you turn it on.</p>
		${agentId && !valid ? message('That agent link is not valid', 'Open predictions from one of your agents.', [{ href: '/agents', label: 'Your agents', primary: true }], true) : ''}
		${valid ? '<section class="apd-section" aria-labelledby="apd-h-shadow"><h2 id="apd-h-shadow">Shadow versus live</h2><div id="apd-agent"></div></section>' : ''}
		<section class="apd-section" aria-labelledby="apd-h-scan"><h2 id="apd-h-scan">No-arbitrage scanner</h2><div id="apd-scan"></div></section>`;
	if (valid) loadAgentSection(agentId, root.querySelector('#apd-agent'));
	loadScanner(root.querySelector('#apd-scan'));
}

boot();
