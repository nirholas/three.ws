// Stacked-bar chart of income by source over time, shared by the owner console
// (/earnings) and the public page (/agents/:id/earnings). Plain SVG, no library.
//
// One axis (USD), the five revenue sources stacked in their fixed colour slots
// (api/_lib/revenue-ledger-core.js SOURCES order), a legend, a total label over
// each bar, a hover/focus tooltip and a table view of the same numbers. Trading
// PnL is not stacked: it can be negative and it is not revenue, so the page
// shows it as its own figure. Colours live in src/earnings.css as tokens.

import { esc } from './agent-commerce-format.js';

const STACK = ['creator_fee_claim', 'skill_sale', 'hire', 'skill_royalty', 'invoice'];
const SVG_NS = 'http://www.w3.org/2000/svg';

export const usd = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function usdShort(n) {
	const v = Number(n || 0);
	if (v >= 10000) return `$${(v / 1000).toFixed(v >= 100000 ? 0 : 1)}k`;
	if (v >= 100) return `$${Math.round(v)}`;
	return `$${v.toFixed(2).replace(/\.00$/, '')}`;
}

function bucketLabel(iso, period) {
	const d = new Date(iso);
	if (period === 'month') return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' });
	return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function bucketTitle(iso, period) {
	const d = new Date(iso);
	if (period === 'month') return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
	if (period === 'week') return `Week of ${d.toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' })}`;
	return d.toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' });
}

function niceMax(v) {
	if (v <= 0) return 1;
	const pow = 10 ** Math.floor(Math.log10(v));
	const n = v / pow;
	const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
	return step * pow;
}

function svg(tag, attrs = {}, text) {
	const el = document.createElementNS(SVG_NS, tag);
	for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
	if (text != null) el.textContent = text;
	return el;
}

/** Colour slot (1-6) for a source key, by its position in the full source list. */
export function slotOf(sources, key) {
	const i = sources.findIndex((s) => s.key === key);
	return i < 0 ? 6 : i + 1;
}

/**
 * Mount the chart into `host`.
 * summary: the `summary` object from the ledger view; sources: the `sources` list.
 */
export function renderEarningsChart(host, { summary, sources }) {
	const series = summary.series || [];
	const period = summary.period || 'month';
	const stack = STACK.filter((k) => sources.some((s) => s.key === k));
	const label = (k) => sources.find((s) => s.key === k)?.label || k;
	const present = stack.filter((k) => summary.by_source[k] && (summary.by_source[k].usd > 0 || summary.by_source[k].count > 0));

	host.innerHTML = '';
	if (!series.length || !stack.some((k) => series.some((b) => b[k] > 0))) {
		host.innerHTML = '<p class="er-chart-empty">No valued income in this period yet. Bars appear here as soon as the first sale, fee claim, hire, royalty or invoice lands.</p>';
		return;
	}

	const legend = document.createElement('ul');
	legend.className = 'er-legend';
	legend.setAttribute('aria-label', 'Income sources');
	for (const k of (present.length ? present : stack)) {
		const li = document.createElement('li');
		li.innerHTML = `<span class="er-swatch" style="background:var(--er-s${slotOf(sources, k)})" aria-hidden="true"></span>${esc(label(k))}`;
		legend.append(li);
	}

	const tabs = document.createElement('div');
	tabs.className = 'er-viewtoggle';
	tabs.setAttribute('role', 'group');
	tabs.setAttribute('aria-label', 'Chart view');
	tabs.innerHTML = '<button type="button" class="ac-btn ac-btn-sm" data-view="chart" aria-pressed="true">Chart</button><button type="button" class="ac-btn ac-btn-sm" data-view="table" aria-pressed="false">Table</button>';

	const head = document.createElement('div');
	head.className = 'er-chart-head';
	head.append(legend, tabs);

	const stage = document.createElement('div');
	stage.className = 'er-stage';
	const tip = document.createElement('div');
	tip.className = 'er-tip';
	tip.setAttribute('role', 'status');
	tip.hidden = true;

	const tableWrap = document.createElement('div');
	tableWrap.className = 'er-tablewrap';
	tableWrap.hidden = true;
	tableWrap.innerHTML = tableHtml(series, stack, label, period);

	host.append(head, stage, tip, tableWrap);

	const W = 720;
	const H = 280;
	const m = { top: 22, right: 8, bottom: 30, left: 48 };
	const iw = W - m.left - m.right;
	const ih = H - m.top - m.bottom;
	const totals = series.map((b) => stack.reduce((a, k) => a + (b[k] > 0 ? b[k] : 0), 0));
	const max = niceMax(Math.max(...totals));
	const y = (v) => m.top + ih - (v / max) * ih;
	const slot = iw / series.length;
	const bw = Math.min(56, Math.max(6, slot * 0.62));

	const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'er-svg', role: 'img', 'aria-label': `Stacked bars of income in USD per ${period}, ${series.length} ${period}s, highest ${usd(Math.max(...totals))}` });

	for (let i = 0; i <= 4; i++) {
		const v = (max / 4) * i;
		const gy = y(v);
		root.append(svg('line', { x1: m.left, x2: W - m.right, y1: gy, y2: gy, class: i === 0 ? 'er-base' : 'er-grid' }));
		root.append(svg('text', { x: m.left - 8, y: gy + 4, class: 'er-tick', 'text-anchor': 'end' }, usdShort(v)));
	}

	const every = Math.ceil(series.length / Math.max(1, Math.floor(iw / 56)));
	const hits = [];
	series.forEach((b, i) => {
		const cx = m.left + slot * i + slot / 2;
		const x = cx - bw / 2;
		let acc = 0;
		const g = svg('g', { class: 'er-bar', tabindex: 0, 'data-i': i, role: 'img', 'aria-label': `${bucketTitle(b.start, period)}: ${usd(totals[i])}` });
		const parts = stack.filter((k) => b[k] > 0);
		parts.forEach((k, pi) => {
			const h = (b[k] / max) * ih;
			const top = y(acc + b[k]);
			acc += b[k];
			const isTop = pi === parts.length - 1;
			const r = Math.min(4, h);
			// 2px surface gap between segments; the top segment rounds its data end.
			const hh = Math.max(0, h - (pi === 0 ? 0 : 2));
			const yy = pi === 0 ? top : top;
			const d = isTop && hh > r
				? `M${x},${yy + hh} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + bw - r} Q${x + bw},${yy} ${x + bw},${yy + r} V${yy + hh} Z`
				: `M${x},${yy} H${x + bw} V${yy + hh} H${x} Z`;
			g.append(svg('path', { d, fill: `var(--er-s${slotOf(sources, k)})`, class: 'er-seg' }));
		});
		if (totals[i] > 0 && slot >= 34) g.append(svg('text', { x: cx, y: y(totals[i]) - 6, class: 'er-total', 'text-anchor': 'middle' }, usdShort(totals[i])));
		if (i % every === 0) root.append(svg('text', { x: cx, y: H - 10, class: 'er-tick', 'text-anchor': 'middle' }, bucketLabel(b.start, period)));
		const hit = svg('rect', { x: m.left + slot * i, y: m.top, width: slot, height: ih, class: 'er-hit', 'data-i': i });
		hits.push({ g, hit, cx });
		root.append(g, hit);
	});
	stage.append(root);

	const show = (i) => {
		const b = series[i];
		const rows = stack.filter((k) => b[k] > 0).map((k) => `<li><span class="er-swatch" style="background:var(--er-s${slotOf(sources, k)})" aria-hidden="true"></span><span class="er-tip-k">${esc(label(k))}</span><span class="er-tip-v">${usd(b[k])}</span></li>`).join('');
		tip.innerHTML = `<strong>${esc(bucketTitle(b.start, period))}</strong><ul>${rows || '<li>No income</li>'}</ul><div class="er-tip-total"><span>Total</span><span>${usd(totals[i])}</span></div>`;
		tip.hidden = false;
		const box = stage.getBoundingClientRect();
		const px = (hits[i].cx / W) * box.width;
		const flip = px > box.width * 0.6;
		tip.style.left = `${px}px`;
		tip.style.transform = flip ? 'translateX(calc(-100% - 14px))' : 'translateX(14px)';
		tip.style.top = `${stage.offsetTop + 8}px`;
		hits.forEach((h, j) => h.g.classList.toggle('is-active', j === i));
	};
	const hide = () => {
		tip.hidden = true;
		hits.forEach((h) => h.g.classList.remove('is-active'));
	};
	hits.forEach(({ g, hit }, i) => {
		hit.addEventListener('pointerenter', () => show(i));
		hit.addEventListener('pointermove', () => show(i));
		g.addEventListener('focus', () => show(i));
		g.addEventListener('blur', hide);
	});
	stage.addEventListener('pointerleave', hide);

	tabs.addEventListener('click', (e) => {
		const b = e.target.closest('[data-view]');
		if (!b) return;
		const table = b.dataset.view === 'table';
		tabs.querySelectorAll('[data-view]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
		stage.hidden = table;
		tableWrap.hidden = !table;
		tip.hidden = true;
	});
}

function tableHtml(series, stack, label, period) {
	const head = `<tr><th scope="col">${period === 'month' ? 'Month' : period === 'week' ? 'Week of' : 'Day'}</th>${stack.map((k) => `<th scope="col" class="er-r">${esc(label(k))}</th>`).join('')}<th scope="col" class="er-r">Total</th></tr>`;
	const body = [...series].reverse().map((b) => {
		const total = stack.reduce((a, k) => a + (b[k] > 0 ? b[k] : 0), 0);
		return `<tr><th scope="row">${esc(bucketTitle(b.start, period))}</th>${stack.map((k) => `<td class="er-r">${b[k] > 0 ? usd(b[k]) : '<span class="er-dim">-</span>'}</td>`).join('')}<td class="er-r"><strong>${usd(total)}</strong></td></tr>`;
	}).join('');
	return `<table class="er-table"><caption class="ac-sr">Income per ${period} by source, USD</caption><thead>${head}</thead><tbody>${body}</tbody></table>`;
}
