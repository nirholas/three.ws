// Shared client for the prediction-market pages (/predictions and
// /agents/:id/predictions): the API envelope, formatters, the probability
// chart, and the preview-then-confirm order ticket.
//
// Server side: api/_lib/predictions/ (routes.js lists every endpoint).
// Envelope: success { data, meta }, failure { error: { code, message, details } }.

import { apiFetch } from '../api.js';
import { ensureRiskAck } from './risk-ack.js';

// ── API ──────────────────────────────────────────────────────────────────────

export class PredictionApiError extends Error {
	constructor(status, code, message, details) {
		super(message);
		this.status = status;
		this.code = code;
		this.details = details || null;
	}
}

async function unwrap(res) {
	let body = null;
	try {
		body = await res.json();
	} catch {
		body = null;
	}
	if (res.ok && body && 'data' in body) return body.data;
	const e = body?.error || {};
	throw new PredictionApiError(res.status, e.code || `http_${res.status}`, e.message || `Request failed (${res.status}).`, e.details);
}

/** Public read, no session needed. */
export async function publicGet(path, params = {}) {
	const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
	const res = await fetch(`/api/predictions/${path}${qs ? `?${qs}` : ''}`, { headers: { accept: 'application/json' } });
	return unwrap(res);
}

/** Owner call on /api/v1/agents/:id/predictions/*. CSRF is attached by apiFetch. */
export async function agentCall(agentId, path, { method = 'GET', body = null } = {}) {
	const res = await apiFetch(`/api/v1/agents/${encodeURIComponent(agentId)}/predictions/${path}`, {
		method,
		allowAnonymous: true,
		headers: body ? { 'content-type': 'application/json', accept: 'application/json' } : { accept: 'application/json' },
		body: body ? JSON.stringify(body) : undefined,
	});
	return unwrap(res);
}

/** The signed-in user's agents, or null when signed out. */
export async function myAgents() {
	const res = await fetch('/api/agents', { credentials: 'include', headers: { accept: 'application/json' } });
	if (res.status === 401) return null;
	if (!res.ok) throw new PredictionApiError(res.status, 'agents_unavailable', 'Could not load your agents.');
	const j = await res.json();
	return Array.isArray(j.agents) ? j.agents : [];
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function esc(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function fmtPct(p, dp = 0) {
	if (p == null || !Number.isFinite(Number(p))) return '-';
	const v = Number(p) * 100;
	if (v > 0 && v < 1) return '<1%';
	if (v < 100 && v > 99) return '>99%';
	return `${v.toFixed(dp)}%`;
}

export function fmtCents(p) {
	if (p == null || !Number.isFinite(Number(p))) return '-';
	const c = Number(p) * 100;
	return `${c % 1 === 0 ? c.toFixed(0) : c.toFixed(1)}¢`;
}

export function fmtUsd(n, { compact = false, sign = false } = {}) {
	if (n == null || !Number.isFinite(Number(n))) return '-';
	const v = Number(n);
	const s = sign && v > 0 ? '+' : v < 0 ? '−' : '';
	const a = Math.abs(v);
	if (compact && a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`;
	if (compact && a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
	if (compact && a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
	return `${s}$${a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtDate(iso, { time = false } = {}) {
	if (!iso) return '-';
	const d = new Date(iso);
	if (!Number.isFinite(d.getTime())) return '-';
	return d.toLocaleString(undefined, time ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtCountdown(iso) {
	if (!iso) return '';
	const ms = new Date(iso).getTime() - Date.now();
	if (!Number.isFinite(ms)) return '';
	if (ms <= 0) return 'closed';
	const h = ms / 3_600_000;
	if (h < 1) return `closes in ${Math.max(1, Math.round(ms / 60_000))}m`;
	if (h < 48) return `closes in ${Math.round(h)}h`;
	const d = Math.round(h / 24);
	return d < 60 ? `closes in ${d}d` : `closes ${fmtDate(iso)}`;
}

export function shortAddr(a) {
	return a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '';
}

export function pnlClass(n) {
	const v = Number(n);
	return !Number.isFinite(v) || v === 0 ? '' : v > 0 ? 'pm-up' : 'pm-down';
}

/** Implied probability of a side: mid of its buy and sell price. */
export function sideProb(market, side = 'yes') {
	const o = market?.outcomes?.find((x) => x.side === side);
	if (!o) return null;
	if (o.buy_price != null && o.sell_price != null) return (o.buy_price + o.sell_price) / 2;
	return o.buy_price ?? o.sell_price ?? null;
}

// ── Probability chart ────────────────────────────────────────────────────────
// One series, so no legend box: the title names it. 2px line, recessive grid at
// 0/25/50/75/100%, crosshair + tooltip on hover and keyboard, and a table view.

const SVG_NS = 'http://www.w3.org/2000/svg';

export function renderProbabilityChart(host, points, { label = 'Yes', onEmpty = null } = {}) {
	host.innerHTML = '';
	if (!points || points.length < 2) {
		host.innerHTML = `<div class="pm-chart-empty">${esc(onEmpty || 'No price history is published for this market yet.')}</div>`;
		return;
	}
	const W = 640;
	const H = 220;
	const pad = { l: 40, r: 12, t: 12, b: 26 };
	const t0 = points[0].t;
	const t1 = points[points.length - 1].t;
	const x = (t) => pad.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r);
	const y = (p) => pad.t + (1 - p) * (H - pad.t - pad.b);

	const svg = document.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
	svg.setAttribute('class', 'pm-chart-svg');
	svg.setAttribute('role', 'img');
	const first = points[0].p;
	const last = points[points.length - 1].p;
	svg.setAttribute('aria-label', `${label} probability from ${fmtPct(first, 1)} to ${fmtPct(last, 1)} between ${fmtDate(new Date(t0).toISOString(), { time: true })} and ${fmtDate(new Date(t1).toISOString(), { time: true })}`);
	svg.setAttribute('tabindex', '0');

	let grid = '';
	for (const g of [0, 0.25, 0.5, 0.75, 1]) {
		grid += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(g)}" y2="${y(g)}" class="pm-gridline"/>`;
		grid += `<text x="${pad.l - 6}" y="${y(g) + 4}" class="pm-axis" text-anchor="end">${g * 100}%</text>`;
	}
	const ticks = 4;
	for (let i = 0; i <= ticks; i++) {
		const t = t0 + ((t1 - t0) * i) / ticks;
		const span = t1 - t0;
		const d = new Date(t);
		const lbl = span < 2 * 86_400_000 ? d.toLocaleTimeString(undefined, { hour: 'numeric' }) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
		grid += `<text x="${x(t)}" y="${H - 8}" class="pm-axis" text-anchor="${i === 0 ? 'start' : i === ticks ? 'end' : 'middle'}">${esc(lbl)}</text>`;
	}
	const path = points.map((pt, i) => `${i ? 'L' : 'M'}${x(pt.t).toFixed(1)},${y(pt.p).toFixed(1)}`).join('');
	const area = `${path}L${x(t1).toFixed(1)},${y(0)}L${x(t0).toFixed(1)},${y(0)}Z`;
	svg.innerHTML = `${grid}
		<path d="${area}" class="pm-area"/>
		<path d="${path}" class="pm-line"/>
		<circle cx="${x(t1)}" cy="${y(last)}" r="4" class="pm-dot"/>
		<g class="pm-cross" visibility="hidden"><line class="pm-cross-line" y1="${pad.t}" y2="${H - pad.b}"/><circle r="4" class="pm-dot pm-cross-dot"/></g>
		<rect x="${pad.l}" y="${pad.t}" width="${W - pad.l - pad.r}" height="${H - pad.t - pad.b}" fill="transparent" class="pm-hit"/>`;

	const tip = document.createElement('div');
	tip.className = 'pm-tip';
	tip.hidden = true;
	host.append(svg, tip);

	const cross = svg.querySelector('.pm-cross');
	const cline = svg.querySelector('.pm-cross-line');
	const cdot = svg.querySelector('.pm-cross-dot');
	let idx = points.length - 1;
	const show = (i) => {
		idx = Math.max(0, Math.min(points.length - 1, i));
		const pt = points[idx];
		const cx = x(pt.t);
		cline.setAttribute('x1', cx);
		cline.setAttribute('x2', cx);
		cdot.setAttribute('cx', cx);
		cdot.setAttribute('cy', y(pt.p));
		cross.setAttribute('visibility', 'visible');
		tip.hidden = false;
		tip.innerHTML = `<strong>${esc(fmtPct(pt.p, 1))}</strong> ${esc(label)}<span>${esc(fmtDate(new Date(pt.t).toISOString(), { time: true }))}</span>`;
		const rect = svg.getBoundingClientRect();
		const px = (cx / W) * rect.width;
		tip.style.left = `${Math.min(Math.max(px, 70), rect.width - 70)}px`;
		tip.style.top = `${(y(pt.p) / H) * rect.height}px`;
	};
	const hide = () => {
		cross.setAttribute('visibility', 'hidden');
		tip.hidden = true;
	};
	const nearest = (clientX) => {
		const rect = svg.getBoundingClientRect();
		const vx = ((clientX - rect.left) / rect.width) * W;
		const t = t0 + ((vx - pad.l) / (W - pad.l - pad.r)) * (t1 - t0);
		let lo = 0;
		let hi = points.length - 1;
		while (hi - lo > 1) {
			const mid = (lo + hi) >> 1;
			if (points[mid].t < t) lo = mid;
			else hi = mid;
		}
		return Math.abs(points[lo].t - t) < Math.abs(points[hi].t - t) ? lo : hi;
	};
	svg.addEventListener('pointermove', (e) => show(nearest(e.clientX)));
	svg.addEventListener('pointerleave', hide);
	svg.addEventListener('focus', () => show(idx));
	svg.addEventListener('blur', hide);
	svg.addEventListener('keydown', (e) => {
		if (e.key === 'ArrowLeft') { e.preventDefault(); show(idx - 1); }
		else if (e.key === 'ArrowRight') { e.preventDefault(); show(idx + 1); }
		else if (e.key === 'Home') { e.preventDefault(); show(0); }
		else if (e.key === 'End') { e.preventDefault(); show(points.length - 1); }
	});
}

/** The same series as an accessible table (sampled to at most 40 rows). */
export function renderHistoryTable(host, points, label = 'Yes') {
	if (!points?.length) {
		host.innerHTML = '<p class="pm-muted">No history to tabulate.</p>';
		return;
	}
	const step = Math.max(1, Math.ceil(points.length / 40));
	const rows = points.filter((_, i) => i % step === 0 || i === points.length - 1);
	host.innerHTML = `<table class="pm-table pm-table--compact"><caption class="pm-sr">${esc(label)} implied probability over time</caption>
		<thead><tr><th scope="col">Time</th><th scope="col" class="pm-num">${esc(label)}</th></tr></thead>
		<tbody>${rows.map((p) => `<tr><td>${esc(fmtDate(new Date(p.t).toISOString(), { time: true }))}</td><td class="pm-num">${esc(fmtPct(p.p, 1))}</td></tr>`).join('')}</tbody></table>`;
}

// ── Order ticket ─────────────────────────────────────────────────────────────

const REASON_TEXT = {
	venue_region_unavailable: 'Orders are unavailable from this server’s region. The venue does not accept orders from it; browsing, research and watches keep working.',
	predictions_disabled: 'Prediction orders are off for this agent. Turn them on under Prediction limits on the agent’s predictions page.',
};

export function explainError(err) {
	if (!err) return 'Something went wrong.';
	return REASON_TEXT[err.code] || err.message || 'Something went wrong.';
}

function checkList(checks) {
	return `<ul class="pm-checks">${checks
		.map((c) => `<li class="${c.ok ? 'is-ok' : 'is-blocked'}"><span class="pm-check-icon" aria-hidden="true">${c.ok ? '✓' : '!'}</span><span>${esc(c.label)}</span><span class="pm-sr">${c.ok ? 'passes' : 'blocks the order'}</span></li>`)
		.join('')}</ul>`;
}

/**
 * Mount the preview-then-confirm order ticket.
 * @param {HTMLElement} host
 * @param {{ market: object, agents: Array|null, agentId?: string|null, onPlaced?: (r: object) => void }} opts
 */
export function mountTicket(host, { market, agents, agentId = null, onPlaced = null }) {
	const state = { side: 'yes', agentId: agentId || agents?.[0]?.id || null, preview: null, timer: null, busy: false };

	if (!market?.tradable) {
		host.innerHTML = `<div class="pm-ticket pm-ticket--closed"><p>This market is ${esc(market?.status || 'closed')} and takes no new orders.</p></div>`;
		return;
	}
	if (agents === null) {
		host.innerHTML = `<div class="pm-ticket"><h3>Trade from an agent wallet</h3><p class="pm-muted">Orders are placed from one of your agents’ Solana wallets, in USDC.</p><a class="pm-btn pm-btn--primary" href="/login?next=${encodeURIComponent(location.pathname + location.search)}">Sign in to trade</a></div>`;
		return;
	}
	if (!agents.length) {
		host.innerHTML = `<div class="pm-ticket"><h3>Trade from an agent wallet</h3><p class="pm-muted">You need an agent first: its Solana wallet holds the USDC and the positions.</p><a class="pm-btn pm-btn--primary" href="/create">Create an agent</a></div>`;
		return;
	}

	const yes = market.outcomes.find((o) => o.side === 'yes');
	const no = market.outcomes.find((o) => o.side === 'no');
	host.innerHTML = `
		<form class="pm-ticket" novalidate>
			<h3>Place an order</h3>
			<p class="pm-ticket-market">${esc(market.title)}</p>
			${agentId ? '' : `<label class="pm-field"><span>Agent wallet</span>
				<select name="agent">${agents.map((a) => `<option value="${esc(a.id)}"${a.id === state.agentId ? ' selected' : ''}>${esc(a.name || 'Untitled agent')}</option>`).join('')}</select></label>`}
			<div class="pm-sides" role="radiogroup" aria-label="Outcome">
				<button type="button" class="pm-side is-active" data-side="yes" role="radio" aria-checked="true">${esc(yes?.label || 'Yes')} <span>${esc(fmtCents(yes?.buy_price))}</span></button>
				<button type="button" class="pm-side" data-side="no" role="radio" aria-checked="false">${esc(no?.label || 'No')} <span>${esc(fmtCents(no?.buy_price))}</span></button>
			</div>
			<div class="pm-row2">
				<label class="pm-field"><span>Stake (USDC)</span><input name="stake" type="number" inputmode="decimal" min="1" step="1" value="5" required /></label>
				<label class="pm-field"><span>Max price (¢)</span><input name="max" type="number" inputmode="decimal" min="1" max="99" step="1" placeholder="auto" /></label>
			</div>
			<p class="pm-hint" data-role="hint"></p>
			<button type="submit" class="pm-btn pm-btn--primary pm-btn--block" data-role="preview-btn">Preview order</button>
			<div data-role="result" aria-live="polite"></div>
		</form>`;

	const form = host.querySelector('form');
	const result = host.querySelector('[data-role="result"]');
	const hint = host.querySelector('[data-role="hint"]');
	const previewBtn = host.querySelector('[data-role="preview-btn"]');

	const updateHint = () => {
		const stake = Number(form.stake.value);
		const o = market.outcomes.find((x) => x.side === state.side);
		if (!(stake > 0) || !o?.buy_price) { hint.textContent = ''; return; }
		const contracts = stake / o.buy_price;
		hint.textContent = `About ${contracts.toFixed(1)} contracts at ${fmtCents(o.buy_price)}; pays ${fmtUsd(contracts)} if ${o.label} wins.`;
	};
	const resetPreview = () => {
		state.preview = null;
		clearInterval(state.timer);
		result.innerHTML = '';
	};

	host.querySelectorAll('.pm-side').forEach((btn) => {
		btn.addEventListener('click', () => {
			state.side = btn.dataset.side;
			host.querySelectorAll('.pm-side').forEach((b) => {
				const on = b === btn;
				b.classList.toggle('is-active', on);
				b.setAttribute('aria-checked', String(on));
			});
			resetPreview();
			updateHint();
		});
	});
	form.addEventListener('input', () => { resetPreview(); updateHint(); });
	form.agent?.addEventListener('change', () => { state.agentId = form.agent.value; resetPreview(); });
	updateHint();

	form.addEventListener('submit', async (e) => {
		e.preventDefault();
		if (state.busy) return;
		const stake = Number(form.stake.value);
		if (!(stake >= 1)) {
			result.innerHTML = '<p class="pm-error" role="alert">Enter a stake of at least $1.</p>';
			return;
		}
		const maxC = form.max.value ? Number(form.max.value) : null;
		state.busy = true;
		previewBtn.disabled = true;
		previewBtn.textContent = 'Pricing…';
		result.innerHTML = '<div class="pm-skel pm-skel--block" aria-label="Pricing the order"></div>';
		try {
			const q = await agentCall(state.agentId, 'open/preview', {
				method: 'POST',
				body: { market_id: market.id, side: state.side, stake_usd: stake, ...(maxC ? { max_price: maxC / 100 } : {}) },
			});
			state.preview = q;
			renderConfirm(q);
		} catch (err) {
			result.innerHTML = `<p class="pm-error" role="alert">${esc(explainError(err))}</p>`;
		} finally {
			state.busy = false;
			previewBtn.disabled = false;
			previewBtn.textContent = 'Preview again';
		}
	});

	function renderConfirm(q) {
		const rows = [
			['From', `Agent wallet ${shortAddr(q.wallet.address)}`],
			['To', `Prediction venue escrow, market ${q.market.id}`],
			['Amount', `${fmtUsd(q.stake_usd)} USDC`],
			['Chain', 'Solana'],
			['Position', `${q.side_label} · ${q.market.title}`],
			['Expected fill', `${q.expected_contracts != null ? Number(q.expected_contracts).toFixed(2) : '-'} contracts at ${fmtCents(q.expected_avg_price)} (limit ${fmtCents(q.max_price)})`],
			['Pays if right', `${fmtUsd(q.max_payout_usd)} (profit ${fmtUsd(q.max_profit_usd, { sign: true })})`],
			['Fees', q.fees_usd != null ? fmtUsd(q.fees_usd) : 'Charged by the venue at fill'],
			['Quote from', q.quote_source === 'venue' ? 'Venue quote' : 'Live order book'],
		];
		result.innerHTML = `
			<div class="pm-confirm">
				<table class="pm-kv"><caption class="pm-sr">Order confirmation</caption>${rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
				${checkList(q.checks)}
				${q.executable
					? `<button type="button" class="pm-btn pm-btn--confirm pm-btn--block" data-role="confirm">Confirm ${esc(fmtUsd(q.stake_usd))} order</button>
					   <p class="pm-hint" data-role="expiry"></p>`
					: `<p class="pm-error" role="alert">This order can’t be placed yet. Resolve the items marked above, then preview again.</p>`}
			</div>`;
		const expiry = result.querySelector('[data-role="expiry"]');
		clearInterval(state.timer);
		const tick = () => {
			if (!expiry) return;
			const s = Math.max(0, Math.round((new Date(q.expires_at).getTime() - Date.now()) / 1000));
			expiry.textContent = s > 0 ? `Price held for ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}. After that, preview again.` : 'This preview expired. Preview again for a fresh price.';
			if (s <= 0) {
				clearInterval(state.timer);
				const b = result.querySelector('[data-role="confirm"]');
				if (b) b.disabled = true;
			}
		};
		tick();
		state.timer = setInterval(tick, 1000);
		result.querySelector('[data-role="confirm"]')?.addEventListener('click', (ev) => confirmOrder(ev.currentTarget));
	}

	async function confirmOrder(btn) {
		if (!state.preview || state.busy) return;
		const signed = await ensureRiskAck({ context: 'prediction' });
		if (!signed) return;
		state.busy = true;
		btn.disabled = true;
		btn.textContent = 'Signing and submitting…';
		try {
			const r = await agentCall(state.agentId, 'open', { method: 'POST', body: { preview_id: state.preview.preview_id, confirm_trade: true } });
			clearInterval(state.timer);
			result.innerHTML = `<div class="pm-success" role="status"><strong>Order placed.</strong> ${esc(r.note)} <a href="${esc(r.explorer)}" target="_blank" rel="noopener">View transaction</a> · <a href="/agents/${esc(state.agentId)}/predictions">Open positions</a></div>`;
			state.preview = null;
			onPlaced?.(r);
		} catch (err) {
			btn.disabled = false;
			btn.textContent = 'Try again';
			result.querySelector('.pm-error')?.remove();
			result.insertAdjacentHTML('beforeend', `<p class="pm-error" role="alert">${esc(explainError(err))}</p>`);
		} finally {
			state.busy = false;
		}
	}
}

/**
 * Mount the watch form: alert when a side crosses a probability.
 */
export function mountWatch(host, { market, agents, agentId = null }) {
	if (agents === null) {
		host.innerHTML = `<div class="pm-watch"><p class="pm-muted">Sign in to get an alert when this market moves.</p></div>`;
		return;
	}
	if (!agents.length) {
		host.innerHTML = '';
		return;
	}
	const cur = sideProb(market, 'yes');
	const suggested = cur != null ? Math.min(99, Math.max(1, Math.round(cur * 100) + 5)) : 50;
	host.innerHTML = `
		<form class="pm-watch" novalidate>
			<h3>Watch this market</h3>
			<p class="pm-muted">Get notified in-app (and on Telegram if you add a chat) when the price crosses your line.</p>
			${agentId ? '' : `<label class="pm-field"><span>For agent</span><select name="agent">${agents.map((a) => `<option value="${esc(a.id)}">${esc(a.name || 'Untitled agent')}</option>`).join('')}</select></label>`}
			<div class="pm-row3">
				<label class="pm-field"><span>Side</span><select name="side"><option value="yes">${esc(market.outcomes[0]?.label || 'Yes')}</option><option value="no">${esc(market.outcomes[1]?.label || 'No')}</option></select></label>
				<label class="pm-field"><span>Crosses</span><select name="direction"><option value="above">above</option><option value="below">below</option></select></label>
				<label class="pm-field"><span>Line (%)</span><input name="threshold" type="number" min="1" max="99" step="1" value="${suggested}" /></label>
			</div>
			<label class="pm-field"><span>Telegram chat (optional)</span><input name="telegram" type="text" placeholder="@channel or numeric chat id" autocomplete="off" /></label>
			<button type="submit" class="pm-btn pm-btn--secondary pm-btn--block">Create watch</button>
			<div data-role="result" aria-live="polite"></div>
		</form>`;
	const form = host.querySelector('form');
	const result = host.querySelector('[data-role="result"]');
	form.addEventListener('submit', async (e) => {
		e.preventDefault();
		const btn = form.querySelector('button[type="submit"]');
		const t = Number(form.threshold.value);
		if (!(t >= 1 && t <= 99)) {
			result.innerHTML = '<p class="pm-error" role="alert">Pick a line between 1% and 99%.</p>';
			return;
		}
		btn.disabled = true;
		try {
			const w = await agentCall(agentId || form.agent.value, 'watch', {
				method: 'POST',
				body: { market_id: market.id, side: form.side.value, direction: form.direction.value, threshold: t / 100, ...(form.telegram.value.trim() ? { telegram_chat: form.telegram.value.trim() } : {}) },
			});
			result.innerHTML = `<p class="pm-success" role="status">Watching: ${esc(w.market?.side_label || w.side)} ${esc(w.direction)} ${esc(fmtPct(w.threshold))}, now ${esc(fmtPct(w.current_probability, 1))}.</p>`;
		} catch (err) {
			result.innerHTML = `<p class="pm-error" role="alert">${esc(explainError(err))}</p>`;
		} finally {
			btn.disabled = false;
		}
	});
}
