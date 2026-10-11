/**
 * Agent Perps: perpetual futures traded from an agent's own wallet.
 *
 * Routes: /agents/:id/perps, plus /agent-perps with an optional ?id=<uuid>
 * (no id: the signed-in owner's agents; one mounts directly, several get a
 * picker). API: /api/v1/agents/:id/perps (docs/perps.md).
 *
 * Every action that moves collateral or changes a position runs in two steps:
 * a preview that locks the exact margin, size, entry, fees and liquidation
 * price, then an execute that names that preview, sends confirm_trade: true and
 * an Idempotency-Key. The tracker streams positions over server-sent events.
 * Paper mode fills at live prices with no funds moving; live mode is off until
 * the owner turns it on for this agent.
 */

import './agent-perps.css';
import { consumeCsrfToken } from './api.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const root = document.getElementById('apx-root');
const titleEl = document.querySelector('title');

const TYPE_LABEL = { market: 'Market', limit: 'Limit', take_profit: 'Take-profit', stop_loss: 'Stop-loss' };
const RISK_LABEL = {
	healthy: 'Healthy',
	cancellable: 'Under initial margin',
	liquidatable: 'Liquidatable',
	zeroCollateralNoPositions: 'No collateral',
};
const LIMIT_FIELDS = [
	{ key: 'max_leverage', label: 'Max account leverage', unit: 'x', step: '0.5', min: 1, risk: true },
	{ key: 'max_margin_per_position_usd', label: 'Max margin per position', unit: 'USD', step: '1', min: 1, risk: true },
	{ key: 'max_slippage_bps', label: 'Max slippage', unit: 'bps', step: '1', min: 1, risk: true },
	{ key: 'max_quote_move_bps', label: 'Quote move tolerance', unit: 'bps', step: '1', min: 1, risk: true },
	{ key: 'alert_liquidation_distance_pct', label: 'Alert when a position is within', unit: '% of liquidation', step: '0.5', min: 0.5, alert: true },
	{ key: 'alert_loss_usd', label: 'Alert when unrealized loss reaches', unit: 'USD', step: '1', min: 0.01, alert: true },
	{ key: 'alert_gain_usd', label: 'Alert when unrealized gain reaches', unit: 'USD', step: '1', min: 0.01, alert: true },
	{ key: 'alert_funding_usd', label: 'Alert when funding paid on a position reaches', unit: 'USD', step: '1', min: 0.01, alert: true },
];

const state = {
	agent: null,
	mode: 'paper',
	account: null,
	limits: null,
	guards: null,
	frame: null,
	markets: [],
	marketsError: null,
	symbol: null,
	marketData: null,
	marketError: null,
	history: [],
	historyError: null,
	alertLog: [],
	stream: 'connecting',
	ticket: { side: 'long', type: 'market', sizeBy: 'margin', margin: '', leverage: '', size: '', price: '', trigger: '', sizePercent: '100' },
};

// ── helpers ──────────────────────────────────────────────────────────────────

function esc(s) {
	return String(s ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
	);
}

function setPageTitle(text) {
	document.title = text;
	titleEl?.setAttribute('data-i18n-owned', '1');
}

function usd(n, { sign = false } = {}) {
	const v = Number(n);
	if (n == null || !Number.isFinite(v)) return '-';
	const s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	if (sign) return `${v > 0 ? '+' : v < 0 ? '-' : ''}$${s}`;
	return `${v < 0 ? '-' : ''}$${s}`;
}

function price(n) {
	const v = Number(n);
	if (n == null || !Number.isFinite(v)) return '-';
	const digits = v >= 1000 ? 2 : v >= 1 ? 4 : 6;
	return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: digits })}`;
}

function num(n, max = 6) {
	const v = Number(n);
	if (n == null || !Number.isFinite(v)) return '-';
	return v.toLocaleString(undefined, { maximumFractionDigits: max });
}

function pct(n, digits = 2) {
	const v = Number(n);
	if (n == null || !Number.isFinite(v)) return '-';
	return `${v.toFixed(digits)}%`;
}

function lev(n) {
	const v = Number(n);
	if (n == null || !Number.isFinite(v)) return '-';
	return `${v.toFixed(2)}x`;
}

function tone(n) {
	const v = Number(n);
	if (!Number.isFinite(v) || Math.abs(v) < 1e-9) return '';
	return v > 0 ? 'apx-up' : 'apx-down';
}

function timeAgo(iso) {
	const t = new Date(iso).getTime();
	if (!Number.isFinite(t)) return '';
	const s = Math.max(0, Math.round((Date.now() - t) / 1000));
	if (s < 60) return 'just now';
	if (s < 3600) return `${Math.floor(s / 60)}m ago`;
	if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
	return new Date(iso).toLocaleDateString();
}

function shortAddr(a) {
	return a && a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a || '';
}

function newIdempotencyKey() {
	return crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

class ApiFailure extends Error {
	constructor(status, code, message, details) {
		super(message);
		this.status = status;
		this.code = code;
		this.details = details;
	}
}

function perpsBase() {
	return `/api/v1/agents/${encodeURIComponent(state.agent.id)}/perps`;
}

async function api(path, { method = 'GET', body, idempotencyKey } = {}) {
	const opts = { method, credentials: 'include', headers: { accept: 'application/json' } };
	if (body !== undefined) {
		opts.headers['content-type'] = 'application/json';
		opts.body = JSON.stringify(body);
	}
	if (idempotencyKey) opts.headers['idempotency-key'] = idempotencyKey;
	if (method !== 'GET') {
		const token = await consumeCsrfToken();
		if (token) opts.headers['x-csrf-token'] = token;
	}
	let res;
	try {
		res = await fetch(`${perpsBase()}${path}`, opts);
	} catch {
		throw new ApiFailure(0, 'network_error', 'Could not reach three.ws. Check your connection and try again.');
	}
	let j = null;
	try {
		j = await res.json();
	} catch {
		j = null;
	}
	if (!res.ok) {
		throw new ApiFailure(
			res.status,
			j?.error?.code || 'error',
			j?.error?.message || `Request failed (${res.status}).`,
			j?.error?.details || null,
		);
	}
	return j?.data;
}

function modeQuery() {
	return `mode=${encodeURIComponent(state.mode)}`;
}

// ── page shells ──────────────────────────────────────────────────────────────

function renderLoading(label) {
	root.innerHTML = `
		<div class="apx-skel" aria-busy="true" aria-label="${esc(label)}">
			<div class="apx-skel-bar"></div>
			<div class="apx-skel-stats"><div></div><div></div><div></div><div></div></div>
			<div class="apx-skel-card"></div>
			<div class="apx-skel-card apx-skel-card--short"></div>
		</div>`;
}

function renderMessage({ title, body, actions = [], retry, tone: t = 'error' }) {
	stopStream();
	root.innerHTML = `
		<div class="apx-msg" ${t === 'error' ? 'role="alert"' : 'role="region" aria-labelledby="apx-msg-h"'}>
			<h1 id="apx-msg-h">${esc(title)}</h1>
			<p>${esc(body)}</p>
			<div class="apx-row apx-row--center">
				${actions.map((a) => `<a class="apx-btn${a.primary ? ' apx-btn--primary' : ''}" href="${esc(a.href)}">${esc(a.label)}</a>`).join('')}
				${retry ? '<button class="apx-btn" type="button" data-act="retry">Try again</button>' : ''}
			</div>
		</div>`;
	root.querySelector('[data-act="retry"]')?.addEventListener('click', () => boot());
}

function renderPicker(agents) {
	root.innerHTML = `
		<section class="apx-pick" aria-labelledby="apx-pick-h">
			<h1 id="apx-pick-h" class="apx-h1">Agent perps</h1>
			<p class="apx-lede">Each agent can go long or short on perpetual futures with USDC collateral, paper first at live prices. Pick an agent.</p>
			<ul class="apx-pick-list">
				${agents
					.map(
						(a) => `
					<li><a class="apx-pick-row" href="/agents/${encodeURIComponent(a.id)}/perps">
						${a.avatar_thumbnail_url ? `<img class="apx-pick-av" src="${esc(a.avatar_thumbnail_url)}" alt="" loading="lazy" />` : '<span class="apx-pick-av" aria-hidden="true"></span>'}
						<span class="apx-pick-name">${esc(a.name || 'Untitled agent')}</span>
						<span aria-hidden="true">→</span>
					</a></li>`,
					)
					.join('')}
			</ul>
		</section>`;
	setPageTitle('Agent perps · three.ws');
}

// ── main view ────────────────────────────────────────────────────────────────

function renderShell() {
	const a = state.agent;
	const acct = state.account;
	const liveOn = state.limits?.live_enabled === true;
	root.innerHTML = `
		<header class="apx-head">
			<div class="apx-head-id">
				${a.avatar_thumbnail_url ? `<img class="apx-head-av" src="${esc(a.avatar_thumbnail_url)}" alt="" loading="lazy" decoding="async" />` : '<span class="apx-head-av" aria-hidden="true"></span>'}
				<div>
					<h1 class="apx-h1">${esc(a.name || 'Agent')} perps</h1>
					<p class="apx-sub">Perpetual futures on Solana with USDC collateral${acct?.venue_label ? ` · via ${esc(acct.venue_label)}` : ''}.</p>
				</div>
			</div>
			<div class="apx-row">
				<div class="apx-seg" role="radiogroup" aria-label="Trading mode">
					<button type="button" role="radio" data-mode="paper" aria-checked="${state.mode === 'paper'}">Paper</button>
					<button type="button" role="radio" data-mode="live" aria-checked="${state.mode === 'live'}" ${liveOn ? '' : 'disabled title="Live trading is off for this agent. Turn it on under Limits and alerts."'}>Live</button>
				</div>
				<a class="apx-btn apx-btn--ghost" href="/agents/${encodeURIComponent(a.id)}/wallet">Wallet</a>
				<a class="apx-btn apx-btn--ghost" href="/docs/perps">Docs</a>
			</div>
		</header>
		<div id="apx-banners"></div>
		<section class="apx-panel" aria-labelledby="apx-acct-h">
			<div class="apx-panel-head">
				<h2 id="apx-acct-h" class="apx-h2">Account</h2>
				<span class="apx-live" id="apx-live" role="status"></span>
			</div>
			<div id="apx-stats"></div>
			<div id="apx-alerts" aria-live="polite"></div>
		</section>
		<section class="apx-panel" aria-labelledby="apx-pos-h">
			<div class="apx-panel-head">
				<h2 id="apx-pos-h" class="apx-h2">Positions</h2>
			</div>
			<div id="apx-positions"></div>
			<div id="apx-orders"></div>
		</section>
		<div class="apx-grid">
			<section class="apx-panel" aria-labelledby="apx-ticket-h">
				<div class="apx-panel-head">
					<h2 id="apx-ticket-h" class="apx-h2">New order</h2>
				</div>
				<div id="apx-ticket"></div>
			</section>
			<div class="apx-col">
				<section class="apx-panel" aria-labelledby="apx-mkt-h">
					<div class="apx-panel-head">
						<h2 id="apx-mkt-h" class="apx-h2">Market</h2>
						<button type="button" class="apx-btn apx-btn--ghost apx-btn--sm" data-act="reload-market">Refresh</button>
					</div>
					<div id="apx-market" aria-live="polite"></div>
				</section>
				<section class="apx-panel" aria-labelledby="apx-coll-h">
					<div class="apx-panel-head">
						<h2 id="apx-coll-h" class="apx-h2">Collateral</h2>
					</div>
					<div id="apx-collateral"></div>
				</section>
			</div>
		</div>
		<section class="apx-panel" aria-labelledby="apx-limits-h">
			<div class="apx-panel-head">
				<h2 id="apx-limits-h" class="apx-h2">Limits and alerts</h2>
			</div>
			<div id="apx-limits"></div>
		</section>
		<section class="apx-panel" aria-labelledby="apx-hist-h">
			<div class="apx-panel-head">
				<h2 id="apx-hist-h" class="apx-h2">History</h2>
				<button type="button" class="apx-btn apx-btn--ghost apx-btn--sm" data-act="reload-history">Refresh</button>
			</div>
			<div id="apx-history" aria-live="polite"></div>
		</section>
		<section class="apx-panel apx-panel--danger" aria-labelledby="apx-kill-h">
			<div class="apx-panel-head">
				<h2 id="apx-kill-h" class="apx-h2">Kill switch</h2>
			</div>
			<p class="apx-dim-text">Cancels every resting order and trigger, closes every position at market, and halts new risk on this agent until you resume. Nothing runs until you confirm the preview.</p>
			<div class="apx-row"><button type="button" class="apx-btn apx-btn--danger" data-act="flatten">Flatten everything</button></div>
		</section>
		<div id="apx-modal-host"></div>`;
	bindShell();
	renderBanners();
	renderStats();
	renderPositions();
	renderTicket();
	renderMarket();
	renderCollateral();
	renderLimits();
	renderHistory();
	renderLiveDot();
}

function bindShell() {
	root.querySelectorAll('[data-mode]').forEach((b) =>
		b.addEventListener('click', () => {
			const mode = b.dataset.mode;
			if (mode === state.mode || b.disabled) return;
			switchMode(mode);
		}),
	);
	root.querySelector('[data-act="reload-market"]').addEventListener('click', () => loadMarket());
	root.querySelector('[data-act="reload-history"]').addEventListener('click', () => loadHistory());
	root.querySelector('[data-act="flatten"]').addEventListener('click', (e) => openFlatten(e.currentTarget));
}

async function switchMode(mode) {
	state.mode = mode;
	const url = new URL(location.href);
	if (mode === 'paper' && !state.limits?.live_enabled) url.searchParams.delete('mode');
	else url.searchParams.set('mode', mode);
	history.replaceState(null, '', url);
	state.frame = null;
	state.account = null;
	renderShell();
	await refreshAccount();
	startStream();
	loadHistory();
}

// ── banners: mode, halt, guards ──────────────────────────────────────────────

function renderBanners() {
	const el = root.querySelector('#apx-banners');
	if (!el) return;
	const parts = [];
	if (state.mode === 'paper') {
		parts.push(`<div class="apx-banner apx-banner--info" role="note"><p><strong>Paper mode.</strong> Orders fill at live venue prices on a simulated balance. No funds move. ${state.limits?.live_enabled ? '' : 'Turn live trading on under Limits and alerts when you are ready.'}</p></div>`);
	} else {
		parts.push(`<div class="apx-banner apx-banner--live" role="note"><p><strong>Live mode.</strong> Orders sign from this agent's wallet ${state.account?.wallet?.address ? `<span class="apx-mono">${esc(shortAddr(state.account.wallet.address))}</span>` : ''} and use real USDC on Solana.</p></div>`);
	}
	const halted = state.frame?.halted ?? state.limits?.halted;
	if (halted) {
		parts.push(`<div class="apx-banner apx-banner--danger" role="alert"><p><strong>Kill switch is on.</strong> Only orders that reduce risk run until you resume.</p><button type="button" class="apx-btn" data-act="resume">Resume trading</button></div>`);
	}
	if (state.guards?.trade_kill_switch) parts.push('<div class="apx-banner apx-banner--warn" role="note"><p>The agent-wide trade kill switch is on, so new risk is refused. Turn it off from the wallet\'s Guard tab.</p></div>');
	if (state.guards?.wallet_frozen) parts.push('<div class="apx-banner apx-banner--warn" role="note"><p>This wallet is frozen, so new risk and deposits are refused. Unfreeze it from the wallet\'s Policy tab.</p></div>');
	el.innerHTML = parts.join('');
	el.querySelector('[data-act="resume"]')?.addEventListener('click', (e) => resumeTrading(e.currentTarget));
}

async function resumeTrading(btn) {
	btn.disabled = true;
	try {
		const data = await api('/limits', { method: 'PUT', body: { halted: false } });
		state.limits = data.limits;
		state.guards = data.guards;
		if (state.frame) state.frame.halted = false;
		renderBanners();
		renderLimits();
		flash('Trading resumed. New orders can open risk again.');
	} catch (e) {
		btn.disabled = false;
		flash(e.message, true);
	}
}

// ── account stats + tracker ──────────────────────────────────────────────────

function currentSummary() {
	return state.frame?.summary || state.account?.summary || null;
}

function renderStats() {
	const el = root.querySelector('#apx-stats');
	if (!el) return;
	const s = currentSummary();
	if (!s) {
		el.innerHTML = '<div class="apx-skel-stats" aria-busy="true"><div></div><div></div><div></div><div></div></div>';
		return;
	}
	const cap = state.limits?.max_leverage;
	const liqPct = s.closest_liquidation_pct;
	const liqTone = liqPct == null ? '' : liqPct <= (state.limits?.alert_liquidation_distance_pct ?? 15) ? 'apx-down' : '';
	const tiles = [
		['Equity', usd(s.equity_usd), ''],
		['Collateral', usd(s.collateral_usd), ''],
		['Withdrawable', usd(s.withdrawable_usd), ''],
		['Unrealized PnL', usd(s.unrealized_pnl_usd, { sign: true }), tone(s.unrealized_pnl_usd)],
		['Leverage', `${lev(s.account_leverage)}${cap ? ` <span class="apx-dim-text">of ${lev(cap)}</span>` : ''}`, ''],
		['Closest liquidation', liqPct == null ? '-' : `${pct(liqPct)} away`, liqTone],
		['Exposure', usd(s.notional_usd), ''],
		['Risk', esc(RISK_LABEL[s.risk_state] || s.risk_state || '-'), s.risk_state === 'liquidatable' ? 'apx-down' : ''],
	];
	el.innerHTML = `<dl class="apx-stats">${tiles
		.map(([k, v, t]) => `<div class="apx-stat"><dt>${k}</dt><dd class="${t}">${v}</dd></div>`)
		.join('')}</dl>${paperTotals()}`;
}

function paperTotals() {
	const p = state.account?.account?.paper;
	if (state.mode !== 'paper' || !p) return '';
	return `<p class="apx-dim-text apx-paper-totals">Paper totals: realized ${usd(p.realized_pnl_usd, { sign: true })} · fees ${usd(p.fees_paid_usd)} · funding ${usd(p.funding_paid_usd)} · deposited ${usd(p.deposited_usd)} · withdrawn ${usd(p.withdrawn_usd)}</p>`;
}

function renderAlerts() {
	const el = root.querySelector('#apx-alerts');
	if (!el) return;
	const alerts = state.frame?.alerts || state.account?.alerts || [];
	el.innerHTML = alerts.length
		? `<ul class="apx-alerts">${alerts
				.map((a) => `<li class="apx-alert" data-severity="${esc(a.severity)}"><span class="apx-alert-dot" aria-hidden="true"></span>${esc(a.message)}</li>`)
				.join('')}</ul>`
		: '';
}

function renderLiveDot() {
	const el = root.querySelector('#apx-live');
	if (!el) return;
	const at = state.frame?.at;
	const label = {
		live: `Live${at ? ` · updated ${new Date(at).toLocaleTimeString()}` : ''}`,
		connecting: 'Connecting to the tracker…',
		reconnecting: 'Reconnecting…',
		paused: 'Paused while this tab is hidden',
		error: 'Tracker offline',
	}[state.stream];
	el.dataset.state = state.stream;
	el.innerHTML = `<span class="apx-live-dot" aria-hidden="true"></span>${esc(label)}`;
}

function framePositions() {
	if (state.frame) return state.frame.positions;
	return (state.account?.account?.positions || []).map((p) => ({ ...p, funding_paid_usd: p.funding_accrued_usd }));
}

function liqBar(p) {
	if (p.liquidation_price == null || p.liquidation_distance_pct == null) {
		return '<span class="apx-dim-text" title="No liquidation price at this size and collateral">None</span>';
	}
	const d = Number(p.liquidation_distance_pct);
	if (!Number.isFinite(d)) return '<span class="apx-dim-text">-</span>';
	const alertAt = state.limits?.alert_liquidation_distance_pct ?? 15;
	const width = Math.max(4, Math.min(100, (d / Math.max(alertAt * 3, 30)) * 100));
	const level = d <= alertAt / 2 ? 'critical' : d <= alertAt ? 'warning' : 'ok';
	return `<span class="apx-liq" data-level="${level}" title="${pct(d)} from liquidation at ${price(p.liquidation_price)}">
		<span class="apx-liq-bar"><span style="width:${width.toFixed(1)}%"></span></span>
		<span class="apx-liq-txt">${price(p.liquidation_price)} · ${pct(d)}</span>
	</span>`;
}

function renderPositions() {
	const el = root.querySelector('#apx-positions');
	if (!el) return;
	if (!currentSummary()) {
		el.innerHTML = '<div class="apx-skel-card apx-skel-card--short" aria-busy="true"></div>';
		renderOrders();
		return;
	}
	const list = framePositions();
	if (!list.length) {
		const hasCollateral = Number(currentSummary()?.collateral_usd) > 0;
		el.innerHTML = `<div class="apx-empty">
			<p><strong>No open positions.</strong></p>
			<p class="apx-dim-text">${hasCollateral ? 'Pick a market under New order, preview it, and confirm to open your first position.' : 'Deposit collateral first, then preview an order under New order.'}</p>
			<div class="apx-row apx-row--center">
				${hasCollateral ? '<button type="button" class="apx-btn apx-btn--primary" data-act="focus-ticket">New order</button>' : '<button type="button" class="apx-btn apx-btn--primary" data-act="focus-deposit">Deposit collateral</button>'}
			</div>
		</div>`;
		el.querySelector('[data-act="focus-ticket"]')?.addEventListener('click', () => root.querySelector('#apx-t-symbol')?.focus());
		el.querySelector('[data-act="focus-deposit"]')?.addEventListener('click', () => root.querySelector('#apx-dep-amt')?.focus());
		renderOrders();
		return;
	}
	el.innerHTML = `<div class="apx-table-wrap"><table class="apx-table">
		<thead><tr>
			<th scope="col">Market</th><th scope="col">Size</th><th scope="col">Entry / mark</th>
			<th scope="col">Unrealized PnL</th><th scope="col">Funding paid</th><th scope="col">Liquidation</th>
			<th scope="col">TP / SL</th><th scope="col"><span class="apx-visually-hidden">Actions</span></th>
		</tr></thead>
		<tbody>${list
			.map(
				(p) => `<tr>
				<th scope="row"><span class="apx-side" data-side="${esc(p.side)}">${esc(p.side)}</span> ${esc(p.symbol)}</th>
				<td class="apx-num">${num(p.size)}<br /><span class="apx-dim-text">${usd(p.notional_usd)}</span></td>
				<td class="apx-num">${price(p.entry_price)}<br /><span class="apx-dim-text">${price(p.mark_price)}</span></td>
				<td class="apx-num ${tone(p.unrealized_pnl_usd)}">${usd(p.unrealized_pnl_usd, { sign: true })}</td>
				<td class="apx-num">${usd(p.funding_paid_usd)}</td>
				<td>${liqBar(p)}</td>
				<td class="apx-num">${p.take_profit_price ? price(p.take_profit_price) : '-'}<br /><span class="apx-dim-text">${p.stop_loss_price ? price(p.stop_loss_price) : '-'}</span></td>
				<td class="apx-actions">
					<button type="button" class="apx-btn apx-btn--sm" data-act="tpsl" data-symbol="${esc(p.symbol)}">TP / SL</button>
					<button type="button" class="apx-btn apx-btn--sm" data-act="close" data-symbol="${esc(p.symbol)}" data-side="${esc(p.side)}" data-size="${esc(p.size)}">Close</button>
				</td>
			</tr>`,
			)
			.join('')}</tbody>
	</table></div>`;
	el.querySelectorAll('[data-act="close"]').forEach((b) =>
		b.addEventListener('click', () =>
			previewOrder(
				{ symbol: b.dataset.symbol, side: b.dataset.side === 'long' ? 'short' : 'long', type: 'market', size: Number(b.dataset.size), reduce_only: true },
				b,
			),
		),
	);
	el.querySelectorAll('[data-act="tpsl"]').forEach((b) =>
		b.addEventListener('click', () => {
			state.ticket.type = 'take_profit';
			selectSymbol(b.dataset.symbol);
			renderTicket();
			root.querySelector('#apx-ticket')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
			root.querySelector('#apx-t-trigger')?.focus({ preventScroll: true });
		}),
	);
	renderOrders();
}

function renderOrders() {
	const el = root.querySelector('#apx-orders');
	if (!el) return;
	const acct = state.account?.account;
	const orders = [
		...(acct?.orders || []).map((o) => ({ ...o, kind: 'limit', at: o.price })),
		...(acct?.conditionals || []).map((o) => ({ ...o, at: o.trigger_price })),
	];
	if (!orders.length) {
		el.innerHTML = '';
		return;
	}
	el.innerHTML = `<h3 class="apx-h3">Open orders</h3>
		<ul class="apx-orders">${orders
			.map(
				(o) => `<li class="apx-order">
				<span class="apx-side" data-side="${o.side === 'long' || o.side === 'buy' ? 'long' : 'short'}">${esc(TYPE_LABEL[o.kind] || o.kind)}</span>
				<span>${esc(o.symbol)} ${esc(o.side)} ${o.size_remaining != null ? num(o.size_remaining) : ''} ${o.kind === 'limit' ? '@' : 'triggers at'} ${price(o.at)}${o.reduce_only ? ' · reduce-only' : ''}</span>
				${o.cancellable === false ? '<span class="apx-dim-text">Cancels with its position</span>' : `<button type="button" class="apx-btn apx-btn--sm" data-act="cancel" data-id="${esc(o.id)}" data-kind="${esc(o.kind)}">Cancel</button>`}
			</li>`,
			)
			.join('')}</ul>`;
	el.querySelectorAll('[data-act="cancel"]').forEach((b) =>
		b.addEventListener('click', () => previewAction('cancel', { order_id: b.dataset.id, kind: b.dataset.kind }, b)),
	);
}

async function refreshAccount() {
	try {
		const data = await api(`/account?${modeQuery()}`);
		state.account = data;
		state.limits = data.limits;
		state.guards = data.guards;
		state.mode = data.mode;
		renderBanners();
		renderStats();
		renderAlerts();
		renderPositions();
		renderCollateral();
		renderLimits();
	} catch (e) {
		const el = root.querySelector('#apx-stats');
		if (el) {
			el.innerHTML = `<div class="apx-inline-err" role="alert"><p>${esc(e.message)}</p><button type="button" class="apx-btn apx-btn--sm" data-act="retry-acct">Try again</button></div>`;
			el.querySelector('[data-act="retry-acct"]').addEventListener('click', () => refreshAccount());
		}
	}
}

// ── stream ───────────────────────────────────────────────────────────────────

let source = null;
let reconnectTimer = null;
let reconnectDelay = 2000;
let accountRefreshAt = 0;

function stopStream() {
	clearTimeout(reconnectTimer);
	reconnectTimer = null;
	if (source) {
		source.close();
		source = null;
	}
}

function startStream() {
	stopStream();
	if (!state.agent || document.hidden) {
		state.stream = document.hidden ? 'paused' : state.stream;
		renderLiveDot();
		return;
	}
	state.stream = state.frame ? 'reconnecting' : 'connecting';
	renderLiveDot();
	const es = new EventSource(`${perpsBase()}/stream?${modeQuery()}&interval=4`, { withCredentials: true });
	source = es;
	es.addEventListener('frame', (ev) => {
		let frame;
		try {
			frame = JSON.parse(ev.data);
		} catch {
			return;
		}
		reconnectDelay = 2000;
		state.frame = frame;
		state.stream = 'live';
		renderStats();
		renderAlerts();
		renderPositions();
		renderLiveDot();
		if (state.limits && frame.halted !== state.limits.halted) {
			state.limits.halted = frame.halted;
			renderBanners();
		}
		// Open orders, collateral and paper totals ride the account read, so keep it
		// fresh when the order count changes and at most every 30 seconds otherwise.
		const orderCount = (state.account?.account?.orders?.length || 0) + (state.account?.account?.conditionals?.length || 0);
		if (frame.orders !== orderCount || Date.now() - accountRefreshAt > 30_000) {
			accountRefreshAt = Date.now();
			refreshAccount();
		}
	});
	es.addEventListener('reconnect', () => {
		es.close();
		startStream();
	});
	es.addEventListener('error', (ev) => {
		if (ev.data) {
			try {
				const d = JSON.parse(ev.data);
				flash(d.message, true);
			} catch {
				/* a transport error carries no payload; the reconnect below covers it */
			}
		}
		if (es.readyState === EventSource.CLOSED) {
			source = null;
			state.stream = 'reconnecting';
			renderLiveDot();
			clearTimeout(reconnectTimer);
			reconnectTimer = setTimeout(startStream, reconnectDelay);
			reconnectDelay = Math.min(30_000, reconnectDelay * 2);
		} else {
			state.stream = 'reconnecting';
			renderLiveDot();
		}
	});
}

document.addEventListener('visibilitychange', () => {
	if (!state.agent) return;
	if (document.hidden) {
		stopStream();
		state.stream = 'paused';
		renderLiveDot();
	} else {
		startStream();
	}
});

// ── markets + ticket ─────────────────────────────────────────────────────────

async function loadMarkets() {
	try {
		const data = await api('/markets');
		state.markets = (data.markets || []).filter((m) => m.status === 'active');
		state.marketsError = null;
		const wanted = new URLSearchParams(location.search).get('market');
		const pick = state.markets.find((m) => m.symbol === wanted) || state.markets.find((m) => m.symbol === 'SOL') || state.markets[0];
		if (pick && !state.symbol) state.symbol = pick.symbol;
	} catch (e) {
		state.marketsError = e;
	}
	renderTicket();
	loadMarket();
}

function selectSymbol(symbol) {
	if (symbol === state.symbol) return;
	state.symbol = symbol;
	state.marketData = null;
	renderTicket();
	loadMarket();
}

let marketSeq = 0;
async function loadMarket() {
	if (!state.symbol) {
		renderMarket();
		return;
	}
	const seq = ++marketSeq;
	state.marketData = null;
	state.marketError = null;
	renderMarket();
	try {
		const data = await api(`/market/${encodeURIComponent(state.symbol)}?depth=6&trades=0&funding=0`);
		if (seq !== marketSeq) return;
		state.marketData = data;
	} catch (e) {
		if (seq !== marketSeq) return;
		state.marketError = e;
	}
	renderMarket();
}

function renderMarket() {
	const el = root.querySelector('#apx-market');
	if (!el) return;
	if (state.marketsError) {
		el.innerHTML = `<div class="apx-inline-err" role="alert"><p>${esc(state.marketsError.message)}</p><button type="button" class="apx-btn apx-btn--sm" data-act="retry-markets">Try again</button></div>`;
		el.querySelector('[data-act="retry-markets"]').addEventListener('click', () => loadMarkets());
		return;
	}
	if (state.marketError) {
		el.innerHTML = `<div class="apx-inline-err" role="alert"><p>${esc(state.marketError.message)}</p><button type="button" class="apx-btn apx-btn--sm" data-act="retry-market">Try again</button></div>`;
		el.querySelector('[data-act="retry-market"]').addEventListener('click', () => loadMarket());
		return;
	}
	const d = state.marketData;
	if (!d) {
		el.innerHTML = '<div class="apx-skel-card apx-skel-card--short" aria-busy="true"></div>';
		return;
	}
	const m = d.market;
	const book = d.book || { bids: [], asks: [] };
	const asks = book.asks.slice(0, 5).reverse();
	const bids = book.bids.slice(0, 5);
	el.innerHTML = `
		<div class="apx-mkt-head">
			${m.logo_url ? `<img class="apx-mkt-logo" src="${esc(m.logo_url)}" alt="" loading="lazy" />` : ''}
			<div><strong>${esc(m.symbol)}-PERP</strong> <span class="apx-dim-text">${esc(m.name || '')}</span></div>
			<div class="apx-mkt-px">${price(m.mark_price)} <span class="${tone(m.change_24h_pct)}">${m.change_24h_pct == null ? '' : `${m.change_24h_pct > 0 ? '+' : ''}${pct(m.change_24h_pct)}`}</span></div>
		</div>
		<dl class="apx-kv">
			<div><dt>Index</dt><dd>${price(m.index_price)}</dd></div>
			<div><dt>Funding (1h)</dt><dd>${m.funding_rate_hourly_pct == null ? '-' : pct(m.funding_rate_hourly_pct, 4)}</dd></div>
			<div><dt>Funding APR</dt><dd>${pct(m.funding_apr_pct)}</dd></div>
			<div><dt>Open interest</dt><dd>${usd(m.open_interest_usd)}</dd></div>
			<div><dt>24h volume</dt><dd>${usd(m.volume_24h_usd)}</dd></div>
			<div><dt>Venue max leverage</dt><dd>${lev(m.max_leverage)}</dd></div>
		</dl>
		<div class="apx-book" aria-label="Top of the order book">
			${asks.map((l) => `<div class="apx-book-row apx-book-row--ask"><span>${price(l.price)}</span><span>${num(l.size, 4)}</span></div>`).join('')}
			<div class="apx-book-mid">${book.spread_bps == null ? 'No spread' : `Spread ${book.spread_bps} bps`}</div>
			${bids.map((l) => `<div class="apx-book-row apx-book-row--bid"><span>${price(l.price)}</span><span>${num(l.size, 4)}</span></div>`).join('')}
			${!asks.length && !bids.length ? '<p class="apx-dim-text">The book is empty right now.</p>' : ''}
		</div>`;
}

function renderTicket() {
	const el = root.querySelector('#apx-ticket');
	if (!el) return;
	if (state.marketsError) {
		el.innerHTML = `<div class="apx-inline-err" role="alert"><p>Markets are unavailable: ${esc(state.marketsError.message)}</p><button type="button" class="apx-btn apx-btn--sm" data-act="retry-markets">Try again</button></div>`;
		el.querySelector('[data-act="retry-markets"]').addEventListener('click', () => loadMarkets());
		return;
	}
	if (!state.markets.length) {
		el.innerHTML = '<div class="apx-skel-card" aria-busy="true"></div>';
		return;
	}
	const t = state.ticket;
	const trigger = t.type === 'take_profit' || t.type === 'stop_loss';
	const market = state.markets.find((m) => m.symbol === state.symbol);
	const cap = Math.min(state.limits?.max_leverage || 1, market?.max_leverage || 1);
	if (!t.leverage || Number(t.leverage) > cap) t.leverage = String(Math.min(cap, 2));
	const position = framePositions().find((p) => p.symbol === state.symbol);
	el.innerHTML = `
		<form class="apx-form" id="apx-ticket-form" novalidate>
			<div class="apx-field">
				<label for="apx-t-symbol">Market</label>
				<select id="apx-t-symbol">${state.markets
					.map((m) => `<option value="${esc(m.symbol)}" ${m.symbol === state.symbol ? 'selected' : ''}>${esc(m.symbol)}-PERP · ${price(m.mark_price)}</option>`)
					.join('')}</select>
			</div>
			<div class="apx-field">
				<span class="apx-label" id="apx-t-type-l">Order type</span>
				<div class="apx-chips" role="radiogroup" aria-labelledby="apx-t-type-l">
					${Object.entries(TYPE_LABEL)
						.map(([k, l]) => `<button type="button" class="apx-chip" role="radio" data-type="${k}" aria-checked="${t.type === k}">${l}</button>`)
						.join('')}
				</div>
			</div>
			${
				trigger
					? `<p class="apx-note">${position ? `Attaches to your ${esc(position.side)} ${esc(state.symbol)} position (entry ${price(position.entry_price)}). It closes the share you pick when the mark crosses the trigger.` : `There is no open ${esc(state.symbol)} position to protect. Open one first.`}</p>
					<div class="apx-field">
						<label for="apx-t-trigger">Trigger price</label>
						<input id="apx-t-trigger" type="number" inputmode="decimal" min="0" step="any" value="${esc(t.trigger)}" placeholder="${market?.mark_price ? `Mark ${market.mark_price}` : ''}" />
					</div>
					<div class="apx-field">
						<label for="apx-t-pct">Share of the position</label>
						<div class="apx-range"><input id="apx-t-pct" type="range" min="1" max="100" step="1" value="${esc(t.sizePercent)}" /><output for="apx-t-pct">${esc(t.sizePercent)}%</output></div>
					</div>`
					: `<div class="apx-field">
						<span class="apx-label" id="apx-t-side-l">Direction</span>
						<div class="apx-sides" role="radiogroup" aria-labelledby="apx-t-side-l">
							<button type="button" role="radio" data-side="long" aria-checked="${t.side === 'long'}">Long</button>
							<button type="button" role="radio" data-side="short" aria-checked="${t.side === 'short'}">Short</button>
						</div>
					</div>
					<div class="apx-field">
						<span class="apx-label" id="apx-t-by-l">Size by</span>
						<div class="apx-chips" role="radiogroup" aria-labelledby="apx-t-by-l">
							<button type="button" class="apx-chip" role="radio" data-by="margin" aria-checked="${t.sizeBy === 'margin'}">Margin and leverage</button>
							<button type="button" class="apx-chip" role="radio" data-by="size" aria-checked="${t.sizeBy === 'size'}">Contracts</button>
						</div>
					</div>
					${
						t.sizeBy === 'margin'
							? `<div class="apx-field">
							<label for="apx-t-margin">Margin (USD)</label>
							<input id="apx-t-margin" type="number" inputmode="decimal" min="0" step="any" value="${esc(t.margin)}" placeholder="Up to ${usd(state.limits?.max_margin_per_position_usd)} per position" />
						</div>
						<div class="apx-field">
							<label for="apx-t-lev">Leverage</label>
							<div class="apx-range"><input id="apx-t-lev" type="range" min="1" max="${cap}" step="0.5" value="${esc(t.leverage)}" /><output for="apx-t-lev">${Number(t.leverage).toFixed(1)}x</output></div>
							<p class="apx-hint">Your cap is ${lev(cap)}. Raise it under Limits and alerts.</p>
						</div>`
							: `<div class="apx-field">
							<label for="apx-t-size">Size (${esc(state.symbol)})</label>
							<input id="apx-t-size" type="number" inputmode="decimal" min="0" step="any" value="${esc(t.size)}" placeholder="${market?.min_size ? `Minimum ${market.min_size}` : ''}" />
						</div>`
					}
					${
						t.type === 'limit'
							? `<div class="apx-field">
							<label for="apx-t-price">Limit price</label>
							<input id="apx-t-price" type="number" inputmode="decimal" min="0" step="any" value="${esc(t.price)}" placeholder="${market?.mark_price ? `Mark ${market.mark_price}` : ''}" />
						</div>`
							: ''
					}`
			}
			<div class="apx-row"><button type="submit" class="apx-btn apx-btn--primary" ${trigger && !position ? 'disabled' : ''}>Preview order</button></div>
			<p class="apx-hint">The preview shows the exact entry, size, margin, leverage, fees and liquidation price. Nothing runs until you confirm it.</p>
		</form>`;
	bindTicket();
}

function bindTicket() {
	const el = root.querySelector('#apx-ticket');
	const t = state.ticket;
	el.querySelector('#apx-t-symbol').addEventListener('change', (e) => selectSymbol(e.target.value));
	el.querySelectorAll('[data-type]').forEach((b) =>
		b.addEventListener('click', () => {
			t.type = b.dataset.type;
			renderTicket();
		}),
	);
	el.querySelectorAll('[data-side]').forEach((b) =>
		b.addEventListener('click', () => {
			t.side = b.dataset.side;
			el.querySelectorAll('[data-side]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
		}),
	);
	el.querySelectorAll('[data-by]').forEach((b) =>
		b.addEventListener('click', () => {
			t.sizeBy = b.dataset.by;
			renderTicket();
		}),
	);
	const bindInput = (sel, key, fmt) => {
		const input = el.querySelector(sel);
		if (!input) return;
		input.addEventListener('input', () => {
			t[key] = input.value;
			const out = input.parentElement.querySelector('output');
			if (out && fmt) out.textContent = fmt(input.value);
		});
	};
	bindInput('#apx-t-margin', 'margin');
	bindInput('#apx-t-lev', 'leverage', (v) => `${Number(v).toFixed(1)}x`);
	bindInput('#apx-t-size', 'size');
	bindInput('#apx-t-price', 'price');
	bindInput('#apx-t-trigger', 'trigger');
	bindInput('#apx-t-pct', 'sizePercent', (v) => `${v}%`);
	el.querySelector('#apx-ticket-form').addEventListener('submit', (e) => {
		e.preventDefault();
		const body = ticketBody();
		if (body.error) {
			flash(body.error, true);
			return;
		}
		previewOrder(body, e.submitter || el.querySelector('[type="submit"]'));
	});
}

function ticketBody() {
	const t = state.ticket;
	const positive = (v) => Number(v) > 0;
	if (t.type === 'take_profit' || t.type === 'stop_loss') {
		if (!positive(t.trigger)) return { error: 'Enter a trigger price.' };
		return { symbol: state.symbol, side: 'long', type: t.type, trigger_price: Number(t.trigger), size_percent: Number(t.sizePercent) };
	}
	const body = { symbol: state.symbol, side: t.side, type: t.type };
	if (t.sizeBy === 'margin') {
		if (!positive(t.margin)) return { error: 'Enter the margin to put up, in USD.' };
		body.margin_usd = Number(t.margin);
		body.leverage = Number(t.leverage) || 1;
	} else {
		if (!positive(t.size)) return { error: `Enter a size in ${state.symbol}.` };
		body.size = Number(t.size);
	}
	if (t.type === 'limit') {
		if (!positive(t.price)) return { error: 'Enter a limit price.' };
		body.price = Number(t.price);
	}
	return body;
}

// ── collateral ───────────────────────────────────────────────────────────────

function renderCollateral() {
	const el = root.querySelector('#apx-collateral');
	if (!el) return;
	const s = currentSummary();
	const w = state.account?.wallet;
	el.innerHTML = `
		<p class="apx-dim-text">${
			state.mode === 'paper'
				? 'Paper collateral is a simulated balance. Deposits and withdrawals here move no funds.'
				: `Moves USDC between this agent's wallet${w?.usdc != null ? ` (${usd(w.usdc)} USDC, ${num(w.sol, 4)} SOL)` : ''} and its trader account on Solana.`
		}</p>
		<form class="apx-inline-form" id="apx-dep-form" novalidate>
			<label for="apx-dep-amt">Deposit</label>
			<input id="apx-dep-amt" type="number" inputmode="decimal" min="0" step="any" placeholder="USD" />
			<button type="submit" class="apx-btn">Preview</button>
		</form>
		<form class="apx-inline-form" id="apx-wd-form" novalidate>
			<label for="apx-wd-amt">Withdraw</label>
			<input id="apx-wd-amt" type="number" inputmode="decimal" min="0" step="any" placeholder="${s ? `Up to ${usd(s.withdrawable_usd)}` : 'USD'}" />
			<button type="button" class="apx-btn apx-btn--ghost apx-btn--sm" data-act="wd-max">Max</button>
			<button type="submit" class="apx-btn">Preview</button>
		</form>`;
	const dep = el.querySelector('#apx-dep-form');
	dep.addEventListener('submit', (e) => {
		e.preventDefault();
		const v = Number(dep.querySelector('input').value);
		if (!(v > 0)) return flash('Enter an amount to deposit.', true);
		previewAction('deposit', { amount_usd: v }, e.submitter);
	});
	const wd = el.querySelector('#apx-wd-form');
	wd.addEventListener('submit', (e) => {
		e.preventDefault();
		const v = Number(wd.querySelector('input').value);
		if (!(v > 0)) return flash('Enter an amount to withdraw, or pick Max.', true);
		previewAction('withdraw', { amount_usd: v }, e.submitter);
	});
	wd.querySelector('[data-act="wd-max"]').addEventListener('click', (e) => previewAction('withdraw', { amount_usd: 'max' }, e.currentTarget));
}

// ── limits + alerts ──────────────────────────────────────────────────────────

function renderLimits() {
	const el = root.querySelector('#apx-limits');
	if (!el) return;
	const l = state.limits;
	if (!l) {
		el.innerHTML = '<div class="apx-skel-card apx-skel-card--short" aria-busy="true"></div>';
		return;
	}
	const field = (f) => `<div class="apx-field">
		<label for="apx-l-${f.key}">${esc(f.label)} <span class="apx-dim-text">(${esc(f.unit)})</span></label>
		<input id="apx-l-${f.key}" name="${f.key}" type="number" inputmode="decimal" min="${f.min}" step="${f.step}" value="${l[f.key] == null ? '' : esc(l[f.key])}" ${f.alert ? 'placeholder="Off"' : ''} />
	</div>`;
	el.innerHTML = `
		<form id="apx-limits-form" class="apx-limits" novalidate>
			<div class="apx-limit-live">
				<label class="apx-switch">
					<input type="checkbox" name="live_enabled" ${l.live_enabled ? 'checked' : ''} />
					<span class="apx-switch-ui" aria-hidden="true"></span>
					<span><strong>Live trading</strong><br /><span class="apx-dim-text">Off means every order runs on the paper ledger. Turning it on needs the signed real-funds agreements.</span></span>
				</label>
			</div>
			<fieldset class="apx-fieldset">
				<legend>Risk limits</legend>
				<div class="apx-limit-grid">${LIMIT_FIELDS.filter((f) => f.risk).map(field).join('')}</div>
			</fieldset>
			<fieldset class="apx-fieldset">
				<legend>Alerts <span class="apx-dim-text">(leave blank to turn one off; they reach you in your notifications)</span></legend>
				<div class="apx-limit-grid">${LIMIT_FIELDS.filter((f) => f.alert).map(field).join('')}</div>
			</fieldset>
			<div id="apx-limits-err"></div>
			<div class="apx-row">
				<button type="submit" class="apx-btn apx-btn--primary">Save limits</button>
				${l.updated_at ? `<span class="apx-dim-text">Last changed ${esc(timeAgo(l.updated_at))}</span>` : ''}
			</div>
		</form>`;
	el.querySelector('#apx-limits-form').addEventListener('submit', saveLimits);
}

async function saveLimits(e) {
	e.preventDefault();
	const form = e.currentTarget;
	const btn = e.submitter || form.querySelector('[type="submit"]');
	const errEl = form.querySelector('#apx-limits-err');
	errEl.innerHTML = '';
	const patch = { live_enabled: form.elements.live_enabled.checked };
	for (const f of LIMIT_FIELDS) {
		const raw = form.elements[f.key].value.trim();
		if (raw === '') {
			if (f.alert) patch[f.key] = null;
			continue;
		}
		const n = Number(raw);
		if (!Number.isFinite(n) || n < f.min) {
			errEl.innerHTML = `<p class="apx-err-text" role="alert">${esc(f.label)} must be at least ${f.min}.</p>`;
			form.elements[f.key].focus();
			return;
		}
		patch[f.key] = n;
	}
	btn.disabled = true;
	try {
		const data = await api('/limits', { method: 'PUT', body: patch });
		const liveChanged = data.limits.live_enabled !== state.limits.live_enabled;
		state.limits = data.limits;
		state.guards = data.guards;
		flash('Limits saved.');
		if (liveChanged) {
			await switchMode(data.limits.live_enabled ? state.mode : 'paper');
			return;
		}
		renderLimits();
		renderStats();
		renderTicket();
	} catch (err) {
		btn.disabled = false;
		const sign = err.code === 'risk_ack_required'
			? `<a class="apx-btn apx-btn--sm" href="${esc(signPath(err.details))}">Sign the agreements</a>`
			: '';
		errEl.innerHTML = `<div class="apx-inline-err" role="alert"><p>${esc(err.message)}</p>${sign}</div>`;
	}
}

function signPath(details) {
	const next = encodeURIComponent(location.pathname + location.search);
	try {
		const u = new URL(details?.sign_url || '/legal/agreements', location.origin);
		u.searchParams.set('next', decodeURIComponent(next));
		return u.pathname + u.search;
	} catch {
		return `/legal/agreements?next=${next}`;
	}
}

// ── history ──────────────────────────────────────────────────────────────────

async function loadHistory() {
	state.history = null;
	state.historyError = null;
	renderHistory();
	try {
		const [pos, alerts] = await Promise.all([api(`/positions?${modeQuery()}&limit=30`), api('/alerts?limit=10')]);
		state.history = pos.history || [];
		state.alertLog = alerts.alerts || [];
	} catch (e) {
		state.history = [];
		state.historyError = e;
	}
	renderHistory();
}

function historyRow(h) {
	if (state.mode === 'paper') {
		return `<li class="apx-hist">
			<span class="apx-side" data-side="${h.side === 'buy' || h.side === 'long' ? 'long' : 'short'}">${esc(h.side)}</span>
			<span>${num(h.size)} ${esc(h.symbol)} @ ${price(h.price)}${h.reason && h.reason !== 'order' ? ` · ${esc(h.reason.replace(/_/g, ' '))}` : ''}</span>
			<span class="apx-num ${tone(h.realized_pnl_usd)}">${Number(h.realized_pnl_usd) ? usd(h.realized_pnl_usd, { sign: true }) : ''}</span>
			<span class="apx-dim-text">${esc(timeAgo(h.created_at))}</span>
		</li>`;
	}
	const sig = h.signatures?.[0];
	return `<li class="apx-hist">
		<span class="apx-status" data-status="${esc(h.status)}">${esc(h.status)}</span>
		<span>${esc(h.summary || h.action)}${h.error ? ` · <span class="apx-err-text">${esc(h.error.message)}</span>` : ''}</span>
		<span>${sig ? `<a href="https://solscan.io/tx/${encodeURIComponent(sig)}" target="_blank" rel="noopener">Transaction ↗</a>` : ''}</span>
		<span class="apx-dim-text">${esc(timeAgo(h.created_at))}</span>
	</li>`;
}

function renderHistory() {
	const el = root.querySelector('#apx-history');
	if (!el) return;
	if (state.history === null) {
		el.innerHTML = '<div class="apx-skel-card apx-skel-card--short" aria-busy="true"></div>';
		return;
	}
	if (state.historyError) {
		el.innerHTML = `<div class="apx-inline-err" role="alert"><p>${esc(state.historyError.message)}</p><button type="button" class="apx-btn apx-btn--sm" data-act="retry-hist">Try again</button></div>`;
		el.querySelector('[data-act="retry-hist"]').addEventListener('click', () => loadHistory());
		return;
	}
	const fills = state.history.length
		? `<ul class="apx-hist-list">${state.history.map(historyRow).join('')}</ul>`
		: `<p class="apx-dim-text">${state.mode === 'paper' ? 'No paper fills yet. Your fills, closes, take-profits and stop-losses land here.' : 'No live executions yet. Every deposit, order, cancel and flatten lands here with its transaction.'}</p>`;
	const alerts = state.alertLog.length
		? `<h3 class="apx-h3">Alerts sent</h3><ul class="apx-hist-list">${state.alertLog
				.map(
					(a) => `<li class="apx-hist"><span class="apx-status" data-status="alert">${esc(a.kind.replace(/_/g, ' '))}</span><span>${esc(a.symbol || 'Account')} · ${esc(a.mode)} · value ${num(a.value, 2)}${a.threshold != null ? ` (threshold ${num(a.threshold, 2)})` : ''}</span><span></span><span class="apx-dim-text">${esc(timeAgo(a.created_at))}</span></li>`,
				)
				.join('')}</ul>`
		: '';
	el.innerHTML = `<h3 class="apx-h3">${state.mode === 'paper' ? 'Paper fills' : 'Live executions'}</h3>${fills}${alerts}`;
}

// ── previews + confirm modal ─────────────────────────────────────────────────

async function previewOrder(body, btn) {
	await runPreview('/order/preview', { ...body, mode: state.mode }, '/order', btn);
}

async function previewAction(kind, body, btn) {
	await runPreview(`/${kind}/preview`, { ...body, mode: state.mode }, `/${kind}`, btn);
}

async function openFlatten(btn) {
	await runPreview('/flatten/preview', { mode: state.mode }, '/flatten', btn);
}

async function runPreview(previewPath, body, executePath, btn) {
	if (btn) btn.disabled = true;
	lastFocus = btn || document.activeElement;
	try {
		const preview = await api(previewPath, { method: 'POST', body });
		openConfirm(preview, { executePath, previewPath, body });
	} catch (e) {
		flash(e.message, true);
	} finally {
		if (btn) btn.disabled = false;
	}
}

function rows(pairs) {
	return `<dl class="apx-confirm">${pairs
		.filter(Boolean)
		.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`)
		.join('')}</dl>`;
}

function modeLabel(p) {
	return p.mode === 'paper' ? 'Paper (simulated, no funds move)' : 'Live (signs from the agent wallet)';
}

function confirmTable(p) {
	const base = [['Mode', esc(modeLabel(p))], ['Chain', 'Solana']];
	if (p.kind === 'deposit' || p.kind === 'withdraw') {
		return rows([
			...base,
			['From', `<span class="apx-mono">${esc(p.from_label ? `${p.from_label} ${shortAddr(p.from)}` : p.kind === 'deposit' && p.mode === 'live' ? `Agent wallet ${shortAddr(p.from)}` : p.from)}</span>`],
			['To', `<span class="apx-mono">${esc(p.to_label ? `${p.to_label} ${shortAddr(p.to)}` : p.kind === 'withdraw' && p.mode === 'live' ? `Agent wallet ${shortAddr(p.to)}` : p.to)}</span>`],
			['Amount', `<strong>${usd(p.amount_usd)} ${esc(p.asset)}</strong>`],
			['Collateral', `${usd(p.collateral_before_usd)} → ${usd(p.collateral_after_usd)}`],
			p.registers_account ? ['Note', 'Opens the trader account on first deposit (one-time rent in SOL)'] : null,
		]);
	}
	if (p.kind === 'cancel') {
		const o = p.order || {};
		return rows([...base, ['Order', `${esc(TYPE_LABEL[o.kind] || o.kind)} ${esc(o.symbol)} ${esc(o.side || '')} at ${price(o.trigger_price ?? o.price)}`], ['Effect', 'Removes the order. No position changes.']]);
	}
	if (p.kind === 'flatten') {
		const closes = p.positions_to_close || [];
		return `${rows([
			...base,
			['Halts trading', 'Yes, until you resume'],
			['Orders to cancel', String(p.orders_to_cancel ?? 0)],
			['Triggers to cancel', String(p.triggers_to_cancel ?? 0)],
			['Slippage allowed', `${p.slippage_bps} bps`],
			['Expected PnL', `<span class="${tone(p.expected_total_pnl_usd)}">${usd(p.expected_total_pnl_usd, { sign: true })}</span>`],
		])}${
			closes.length
				? `<ul class="apx-close-list">${closes
						.map((c) => `<li>${esc(c.side)} ${num(c.size)} ${esc(c.symbol)}: ${c.error ? `<span class="apx-err-text">${esc(c.error)}</span>` : `exit near ${price(c.expected_exit_price)}, ${usd(c.expected_pnl_usd, { sign: true })} after fees`}</li>`)
						.join('')}</ul>`
				: '<p class="apx-dim-text">No open positions to close.</p>'
		}`;
	}
	if (p.type === 'take_profit' || p.type === 'stop_loss') {
		return rows([
			...base,
			['Order', `${esc(TYPE_LABEL[p.type])} on ${esc(p.symbol)} ${esc(p.position?.side || '')}`],
			['Trigger', `${price(p.trigger_price)} <span class="apx-dim-text">(mark ${price(p.mark_price)})</span>`],
			['Closes', `${num(p.size)} ${esc(p.symbol)} (${p.size_percent}% of the position)`],
			['PnL at trigger', `<span class="${tone(p.expected_pnl_at_trigger_usd)}">${usd(p.expected_pnl_at_trigger_usd, { sign: true })}</span>`],
			['Fees', usd(p.fee_usd)],
			['Liquidation', price(p.liquidation_price)],
		]);
	}
	const after = p.position_after || {};
	return rows([
		...base,
		['Order', `${esc(TYPE_LABEL[p.type] || p.type)} ${esc(p.side)} ${esc(p.symbol)}${p.reduce_only ? ' · reduce-only' : ''}`],
		['Entry', `<strong>${price(p.entry_price)}</strong>${p.type === 'limit' ? (p.crosses_book ? ' <span class="apx-dim-text">(crosses the book, fills now)</span>' : ' <span class="apx-dim-text">(rests on the book)</span>') : ''}`],
		['Size', `<strong>${esc(p.size_text || num(p.size))} ${esc(p.symbol)}</strong> <span class="apx-dim-text">${usd(p.notional_usd)}</span>`],
		['Margin', `${usd(p.margin_impact_usd)} <span class="apx-dim-text">(initial margin after ${usd(p.initial_margin_after_usd)})</span>`],
		['Leverage', `${lev(p.account_leverage_after)} <span class="apx-dim-text">of ${lev(p.leverage_cap)} cap · margin cap ${usd(p.max_margin_per_position_usd)}</span>`],
		['Fees', usd(p.fee_usd)],
		['Liquidation', p.liquidation_price ? `<strong>${price(p.liquidation_price)}</strong> <span class="apx-dim-text">${pct(p.liquidation_distance_pct)} from mark</span>` : 'None (flat after this order)'],
		['After', `${esc(after.side || 'flat')} ${after.size ? num(after.size) : ''}${after.realized_pnl_usd ? ` · realizes ${usd(after.realized_pnl_usd, { sign: true })}` : ''}`],
		p.slippage_bps != null ? ['Slippage allowed', `${p.slippage_bps} bps (worst fill ${price(p.limit_price)})`] : null,
		['Tolerance', `Refuses if entry or liquidation moves more than ${p.max_quote_move_bps} bps before you confirm`],
	]);
}

function checksList(p) {
	return `<ul class="apx-checks">${(p.checks || [])
		.map((c) => `<li data-ok="${c.ok}"><span aria-hidden="true">${c.ok ? '✓' : '✕'}</span><span>${esc(c.label)}</span></li>`)
		.join('')}</ul>`;
}

const TITLE = {
	order: 'Confirm order',
	deposit: 'Confirm deposit',
	withdraw: 'Confirm withdrawal',
	cancel: 'Confirm cancel',
	flatten: 'Flatten everything?',
};

function openConfirm(preview, ctx) {
	const idempotencyKey = newIdempotencyKey();
	const danger = preview.kind === 'flatten';
	const m = modal(`
		<div class="apx-modal-head"><h2 id="apx-modal-h" class="apx-h3">${esc(TITLE[preview.kind] || 'Confirm')}</h2><button type="button" class="apx-x" data-act="close" aria-label="Close">×</button></div>
		${confirmTable(preview)}
		${checksList(preview)}
		${
			danger && preview.executable
				? '<label class="apx-ack"><input type="checkbox" data-act="ack" /> I understand this closes every position at market and halts new risk on this agent.</label>'
				: ''
		}
		<p class="apx-hint" data-host="expiry"></p>
		<div data-host="err"></div>
		<div class="apx-row">
			<button type="button" class="apx-btn" data-act="close">Back</button>
			<button type="button" class="apx-btn ${danger ? 'apx-btn--danger' : 'apx-btn--primary'}" data-act="confirm" ${preview.executable && !danger ? '' : 'disabled'}>${esc(confirmLabel(preview))}</button>
		</div>`);
	const confirmBtn = m.querySelector('[data-act="confirm"]');
	m.querySelectorAll('[data-act="close"]').forEach((b) => b.addEventListener('click', closeModal));
	m.querySelector('[data-act="ack"]')?.addEventListener('change', (e) => {
		confirmBtn.disabled = !e.target.checked;
	});
	const expiry = m.querySelector('[data-host="expiry"]');
	const expiresAt = new Date(preview.expires_at).getTime();
	const tick = () => {
		const left = Math.round((expiresAt - Date.now()) / 1000);
		if (!expiry.isConnected) return false;
		if (left <= 0) {
			expiry.textContent = 'This preview expired. Preview again for a fresh quote.';
			confirmBtn.disabled = true;
			return false;
		}
		expiry.textContent = `Price locked for ${left}s.`;
		return true;
	};
	if (tick()) {
		const timer = setInterval(() => {
			if (!tick()) clearInterval(timer);
		}, 1000);
	}
	if (!preview.executable) {
		m.querySelector('[data-host="err"]').innerHTML = '<p class="apx-err-text" role="alert">A check above blocks this. Adjust the order or your limits and preview again.</p>';
	}
	confirmBtn.addEventListener('click', () => execute(preview, ctx, idempotencyKey, m));
	(preview.executable && !danger ? confirmBtn : m.querySelector('[data-act="close"]')).focus();
}

function confirmLabel(p) {
	if (p.kind === 'flatten') return 'Flatten and halt';
	if (p.kind === 'deposit') return `Deposit ${usd(p.amount_usd)}`;
	if (p.kind === 'withdraw') return `Withdraw ${usd(p.amount_usd)}`;
	if (p.kind === 'cancel') return 'Cancel order';
	if (p.type === 'take_profit' || p.type === 'stop_loss') return `Place ${TYPE_LABEL[p.type].toLowerCase()}`;
	return `${p.mode === 'paper' ? 'Place paper' : 'Place'} ${p.side} ${p.symbol}`;
}

async function execute(preview, ctx, idempotencyKey, m) {
	const btn = m.querySelector('[data-act="confirm"]');
	const errEl = m.querySelector('[data-host="err"]');
	btn.disabled = true;
	btn.textContent = preview.mode === 'live' ? 'Signing…' : 'Placing…';
	errEl.innerHTML = '';
	try {
		const result = await api(ctx.executePath, {
			method: 'POST',
			body: { preview_id: preview.preview_id, confirm_trade: true },
			idempotencyKey,
		});
		showResult(m, result);
		afterExecute(result);
	} catch (e) {
		btn.textContent = confirmLabel(preview);
		if (e.code === 'quote_moved') {
			const d = e.details || {};
			errEl.innerHTML = `<div class="apx-inline-err" role="alert"><p>The market moved since this preview${d.field ? ` (${esc(d.field.replace(/_/g, ' '))} ${d.moved_bps != null ? `moved ${d.moved_bps} bps` : 'changed'})` : ''}, so nothing was sent.</p><button type="button" class="apx-btn apx-btn--sm" data-act="requote">Preview again</button></div>`;
			errEl.querySelector('[data-act="requote"]').addEventListener('click', async (ev) => {
				ev.currentTarget.disabled = true;
				try {
					const fresh = await api(ctx.previewPath, { method: 'POST', body: ctx.body });
					closeModal();
					openConfirm(fresh, ctx);
				} catch (err) {
					ev.currentTarget.disabled = false;
					flash(err.message, true);
				}
			});
			return;
		}
		const sign = e.code === 'risk_ack_required' ? `<a class="apx-btn apx-btn--sm" href="${esc(signPath(e.details))}">Sign the agreements</a>` : '';
		errEl.innerHTML = `<div class="apx-inline-err" role="alert"><p>${esc(e.message)}</p>${sign}</div>`;
		const expired = e.code === 'preview_expired' || e.code === 'preview_not_found' || e.code === 'preview_used';
		btn.disabled = expired;
	}
}

function showResult(m, r) {
	const sigs = r.signatures || (r.signature ? [r.signature] : []);
	m.innerHTML = `
		<div class="apx-modal-head"><h2 id="apx-modal-h" class="apx-h3">${r.ok === false ? 'Finished with problems' : 'Done'}</h2><button type="button" class="apx-x" data-act="close" aria-label="Close">×</button></div>
		<p>${esc(r.summary || 'The action ran.')}${r.replayed ? ' <span class="apx-dim-text">(already ran; this is the original result)</span>' : ''}</p>
		${
			r.steps?.length
				? `<ul class="apx-checks">${r.steps.map((s) => `<li data-ok="${s.ok}"><span aria-hidden="true">${s.ok ? '✓' : '✕'}</span><span>${esc(s.step.replace(/_/g, ' '))}${s.error ? `: ${esc(s.error)}` : ''}</span></li>`).join('')}</ul>`
				: ''
		}
		${sigs.length ? `<ul class="apx-sigs">${sigs.map((s) => `<li><a href="https://solscan.io/tx/${encodeURIComponent(s)}" target="_blank" rel="noopener">${esc(shortAddr(s))} ↗</a></li>`).join('')}</ul>` : ''}
		<div class="apx-row"><button type="button" class="apx-btn apx-btn--primary" data-act="close">Close</button></div>`;
	m.querySelectorAll('[data-act="close"]').forEach((b) => b.addEventListener('click', closeModal));
	m.querySelector('.apx-btn--primary').focus();
}

function afterExecute(r) {
	if (r.action === 'flatten') {
		// The last stream frame still says running; the halt landed with this result.
		if (state.limits) state.limits.halted = true;
		if (state.frame) state.frame.halted = true;
		renderBanners();
	}
	if (r.action === 'order') {
		state.ticket.margin = '';
		state.ticket.size = '';
		state.ticket.trigger = '';
		renderTicket();
	}
	accountRefreshAt = Date.now();
	refreshAccount();
	loadHistory();
	if (r.action === 'deposit' || r.action === 'withdraw') {
		root.querySelectorAll('#apx-collateral input').forEach((i) => {
			i.value = '';
		});
	}
}

// ── modal ────────────────────────────────────────────────────────────────────

let lastFocus = null;

function closeModal() {
	const host = root.querySelector('#apx-modal-host');
	if (host) host.innerHTML = '';
	document.removeEventListener('keydown', onModalKey);
	lastFocus?.focus?.();
}

function onModalKey(e) {
	if (e.key === 'Escape') {
		closeModal();
		return;
	}
	if (e.key !== 'Tab') return;
	const f = [...root.querySelectorAll('#apx-modal-host button, #apx-modal-host input, #apx-modal-host a')].filter((x) => !x.disabled);
	if (!f.length) return;
	const first = f[0];
	const last = f[f.length - 1];
	if (e.shiftKey && document.activeElement === first) {
		e.preventDefault();
		last.focus();
	} else if (!e.shiftKey && document.activeElement === last) {
		e.preventDefault();
		first.focus();
	}
}

function modal(inner) {
	const host = root.querySelector('#apx-modal-host');
	host.innerHTML = `
		<div class="apx-modal-back"></div>
		<div class="apx-modal" role="dialog" aria-modal="true" aria-labelledby="apx-modal-h">${inner}</div>`;
	host.querySelector('.apx-modal-back').addEventListener('click', closeModal);
	document.removeEventListener('keydown', onModalKey);
	document.addEventListener('keydown', onModalKey);
	return host.querySelector('.apx-modal');
}

// ── toast ────────────────────────────────────────────────────────────────────

let toastTimer = null;
function flash(text, isError = false) {
	let t = document.getElementById('apx-toast');
	if (!t) {
		t = document.createElement('div');
		t.id = 'apx-toast';
		t.className = 'apx-toast';
		t.setAttribute('role', 'status');
		document.body.appendChild(t);
	}
	t.textContent = text;
	t.dataset.tone = isError ? 'error' : 'ok';
	t.classList.add('apx-toast--on');
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => t.classList.remove('apx-toast--on'), 3600);
}

// ── boot ─────────────────────────────────────────────────────────────────────

function resolveAgentId() {
	const fromQuery = new URLSearchParams(location.search).get('id');
	if (fromQuery) return fromQuery;
	const m = location.pathname.match(/\/agents\/([^/]+)\/perps/);
	return m ? decodeURIComponent(m[1]) : null;
}

async function currentUser() {
	const me = await fetch('/api/auth/me', { credentials: 'include', headers: { accept: 'application/json' } });
	if (!me.ok) throw new Error(`HTTP ${me.status}`);
	const j = await me.json();
	return j?.user?.id ? j.user : null;
}

async function mountAgent(agentId) {
	renderLoading('Loading agent perps');
	const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, { credentials: 'include', headers: { accept: 'application/json' } });
	if (res.status === 404) {
		renderMessage({
			title: 'Agent not found',
			body: 'This agent does not exist or was deleted by its owner.',
			actions: [{ href: '/agent-perps', label: 'Your agents', primary: true }],
		});
		setPageTitle('Agent not found · three.ws');
		return;
	}
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const { agent } = await res.json();
	if (!agent?.is_owner) {
		renderMessage({
			title: 'Only the owner can trade perps for this agent',
			body: "An agent's perps account is private to its owner. Open your own agents to trade for them.",
			actions: [
				{ href: '/agent-perps', label: 'Your agents', primary: true },
				{ href: `/agents/${encodeURIComponent(agentId)}`, label: 'View this agent' },
			],
			tone: 'info',
		});
		return;
	}
	state.agent = agent;
	setPageTitle(`${agent.name || 'Agent'} perps · three.ws`);
	const wanted = new URLSearchParams(location.search).get('mode');
	state.mode = wanted === 'live' ? 'live' : 'paper';
	try {
		const data = await api(`/account?${modeQuery()}`);
		state.account = data;
		state.limits = data.limits;
		state.guards = data.guards;
		state.mode = data.mode;
	} catch (e) {
		if (e.code === 'live_disabled' && state.mode === 'live') {
			state.mode = 'paper';
			history.replaceState(null, '', location.pathname);
			return mountAgent(agentId);
		}
		renderMessage({ title: "Couldn't open the perps account", body: e.message, retry: true });
		return;
	}
	renderShell();
	startStream();
	loadMarkets();
	loadHistory();
}

async function boot() {
	renderLoading('Loading');
	try {
		const user = await currentUser();
		const agentId = resolveAgentId();
		if (!user) {
			const next = encodeURIComponent(location.pathname + location.search);
			renderMessage({
				title: 'Sign in to trade agent perps',
				body: 'Agents go long or short on perpetual futures with USDC collateral, paper first at live prices. Sign in to open your agents.',
				actions: [
					{ href: `/login?next=${next}`, label: 'Sign in', primary: true },
					{ href: '/register', label: 'Create account' },
				],
				tone: 'info',
			});
			return;
		}
		if (agentId) {
			if (!UUID_RE.test(agentId)) {
				renderMessage({
					title: 'That agent link is not valid',
					body: 'Open perps from one of your agents.',
					actions: [{ href: '/agent-perps', label: 'Your agents', primary: true }],
				});
				return;
			}
			await mountAgent(agentId);
			return;
		}
		const r = await fetch('/api/agents', { credentials: 'include', headers: { accept: 'application/json' } });
		if (!r.ok) throw new Error(`HTTP ${r.status}`);
		const agents = (await r.json())?.agents || [];
		if (!agents.length) {
			renderMessage({
				title: 'No agents yet',
				body: 'Create an agent first. Every agent gets its own Solana wallet it can trade perps from.',
				actions: [{ href: '/create-agent', label: 'Create an agent', primary: true }],
				tone: 'info',
			});
			return;
		}
		if (agents.length === 1) {
			history.replaceState(null, '', `/agents/${encodeURIComponent(agents[0].id)}/perps`);
			await mountAgent(agents[0].id);
			return;
		}
		renderPicker(agents);
	} catch {
		renderMessage({
			title: "Couldn't load agent perps",
			body: 'We could not reach three.ws. This is usually temporary; check your connection and try again.',
			retry: true,
		});
	}
}

boot();
