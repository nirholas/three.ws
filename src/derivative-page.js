// /derivative/:venue/:symbol - the detail page behind every row of
// /derivatives, part of the three.ws Markets surface.
//
// The perps table answers "what is this contract worth right now". This page
// answers the questions that row raises and a table cannot: what the funding
// rate actually costs on a position of a given size, whether the contract
// trades above or below its own index, how much of the venue and of the
// underlying's whole perp market it represents, and where the same underlying
// funds cheaper somewhere else. Data comes from /api/coin/derivative (venue
// contract feed, cross-venue perp feed, spot market data) plus /api/coin/ohlc
// for the underlying price chart. Never mocked.
//
// Mirrors the /exchange/:id detail-page pattern (src/exchange-page.js).

import {
	formatUsd,
	formatPrice,
	formatPercent,
	formatSupply,
	formatChartTick,
	escapeHtml as esc,
} from './shared/coin-format.js';
import { upstreamLogoURL, swapFailedLogos } from './shared/upstream-logo.js';
import { VENUE_ID_RE, SYMBOL_SLUG_RE, symbolFromSlug, derivativePath } from './shared/derivative-slug.js';

const $ = (id) => document.getElementById(id);
const DASH = '—';

// Venue funding is settled every 8h on almost every venue, and CoinGecko does
// not publish the schedule. Every annualized figure on this page says so.
const FUNDING_PERIODS_PER_YEAR = 3 * 365;
const DEFAULT_POSITION_USD = 10_000;

/** { venue, symbol } from the path, falling back to ?venue=&symbol= queries. */
function targetFromLocation() {
	const m = location.pathname.match(/^\/derivative\/([^/]+)\/([^/]+)\/?$/);
	if (m && VENUE_ID_RE.test(m[1]) && SYMBOL_SLUG_RE.test(decodeURIComponent(m[2]))) {
		const symbol = symbolFromSlug(m[2]);
		if (symbol) return { venue: m[1].toLowerCase(), symbol };
	}
	const q = new URLSearchParams(location.search);
	const venue = (q.get('venue') || '').trim().toLowerCase();
	const symbol = (q.get('symbol') || '').trim();
	if (VENUE_ID_RE.test(venue) && symbol) return { venue, symbol };
	return null;
}

async function getJson(url) {
	const res = await fetch(url, { headers: { accept: 'application/json' } });
	if (!res.ok) {
		const err = new Error(`fetch ${url} ${res.status}`);
		err.status = res.status;
		throw err;
	}
	return res.json();
}

// ── Number formatting local to contracts ────────────────────────────────────

/** Funding is a percentage per interval and lives four decimals deep. */
function formatFunding(v) {
	if (v == null || !Number.isFinite(v)) return DASH;
	return `${v >= 0 ? '+' : ''}${v.toFixed(4)}%`;
}

/** Annualized funding, which is a whole-percent scale. */
function formatApr(v) {
	if (v == null || !Number.isFinite(v)) return DASH;
	return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function formatBasis(v) {
	if (v == null || !Number.isFinite(v)) return DASH;
	return `${v >= 0 ? '+' : ''}${v.toFixed(3)}%`;
}

/** Exact USD with cents, for calculator output where compact units would lie. */
function formatUsdExact(n) {
	if (n == null || !Number.isFinite(n)) return DASH;
	const sign = n < 0 ? '-' : '';
	return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatCount(n) {
	return n == null || !Number.isFinite(n) ? DASH : n.toLocaleString('en-US');
}

function signClass(v) {
	if (v == null || !Number.isFinite(v)) return '';
	return v >= 0 ? 'cv-up' : 'cv-down';
}

/** "3 minutes ago" for a unix-seconds last-trade stamp. */
function agoFromSeconds(sec) {
	if (sec == null || !Number.isFinite(sec)) return DASH;
	const diff = Math.max(0, Date.now() - sec * 1000);
	const mins = Math.round(diff / 60_000);
	if (mins < 1) return 'just now';
	if (mins < 60) return `${mins} min ago`;
	const hrs = Math.round(mins / 60);
	if (hrs < 48) return `${hrs} hr ago`;
	return `${Math.round(hrs / 24)} d ago`;
}

// ── State ───────────────────────────────────────────────────────────────────

const state = {
	venue: null,
	symbol: null,
	payload: null,
	positionUsd: DEFAULT_POSITION_USD,
};

// ── Skeletons ───────────────────────────────────────────────────────────────

function renderSkeletons() {
	$('dc-hero').innerHTML = `
		<div class="dc-hero">
			<div class="dc-hero-id">
				<div class="cv-skel dc-logo" style="border-radius:10px"></div>
				<div style="flex:1;min-width:0">
					<div class="cv-skel" style="width:12rem;height:2rem"></div>
					<div class="cv-skel" style="width:16rem;max-width:100%;height:1.1rem;margin-top:0.6rem"></div>
					<div class="cv-skel" style="width:20rem;max-width:100%;height:1.5rem;margin-top:0.75rem"></div>
				</div>
			</div>
			<div class="cv-skel" style="width:12rem;height:4rem"></div>
		</div>`;
	$('dc-stats').innerHTML =
		'<div class="dc-stats">' +
		Array.from({ length: 8 }, () => '<div class="cv-skel" style="height:5rem"></div>').join('') +
		'</div>';
	$('dc-funding').innerHTML = '<div class="cv-skel" style="height:11rem;border-radius:12px"></div>';
	$('dc-chart').innerHTML =
		'<div class="cv-chart-panel"><div class="cv-skel" style="height:300px;border-radius:8px"></div></div>';
	$('dc-peers').innerHTML =
		'<h2 class="cv-h2">Same contract, every venue</h2><div class="cv-table-wrap" style="padding:0.75rem">' +
		Array.from(
			{ length: 8 },
			() => '<div class="cv-skel" style="height:2.5rem;margin:0.375rem 0"></div>',
		).join('') +
		'</div>';
	$('dc-venue').innerHTML = '';
	$('dc-asset').innerHTML = '';
}

// ── Hero ────────────────────────────────────────────────────────────────────

const EXT_ICON =
	'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';

function heroChips(c, v) {
	const chips = [];
	const kind = c.contract_type === 'perpetual' ? 'Perpetual' : c.contract_type;
	chips.push(`<span class="dc-chip dc-chip-perp">${esc(kind)}</span>`);
	if (c.base && c.target) chips.push(`<span class="dc-chip">${esc(c.base)} / ${esc(c.target)}</span>`);
	if (v.country) chips.push(`<span class="dc-chip">${esc(v.country)}</span>`);
	if (v.year_established != null) chips.push(`<span class="dc-chip">Est. ${esc(String(v.year_established))}</span>`);
	if (c.last_traded_at != null) chips.push(`<span class="dc-chip">Last trade ${esc(agoFromSeconds(c.last_traded_at))}</span>`);
	return `<div class="dc-chips">${chips.join('')}</div>`;
}

function renderHero(p) {
	const c = p.contract;
	const v = p.venue;
	$('dc-crumb-venue').textContent = v.name;
	$('dc-crumb-venue').href = `/exchange/${encodeURIComponent(v.id)}`;
	$('dc-crumb-symbol').textContent = c.symbol;

	const logo = v.image ? upstreamLogoURL(v.image, 56) : '';
	const basisNote =
		c.basis_pct != null
			? `${c.basis_pct >= 0 ? 'Trading above' : 'Trading below'} its index by ${Math.abs(c.basis_pct).toFixed(3)}%`
			: 'Mark price reported by the venue';

	$('dc-hero').innerHTML = `
		<div class="dc-hero">
			<div class="dc-hero-id">
				${
					logo
						? `<img class="dc-logo" src="${esc(logo)}" alt="${esc(v.name)} logo" width="56" height="56" loading="eager" data-no-dark-filter />`
						: '<div class="dc-logo dc-logo-fallback" aria-hidden="true"></div>'
				}
				<div style="min-width:0">
					<div class="dc-title-row">
						<h1 class="dc-symbol">${esc(c.symbol)}</h1>
					</div>
					<p class="dc-venue-line">on <a href="/exchange/${encodeURIComponent(v.id)}">${esc(v.name)}</a></p>
					${heroChips(c, v)}
				</div>
			</div>
			<div class="dc-price-box">
				<p class="dc-price">${esc(formatPrice(c.price))}</p>
				<p class="dc-price-delta ${signClass(c.change_24h)}">${
					c.change_24h != null ? `${c.change_24h >= 0 ? '▲' : '▼'} ${esc(formatPercent(c.change_24h))} 24h` : DASH
				}</p>
				<p class="dc-price-note">${esc(basisNote)}</p>
				<div class="dc-actions">
					${
						c.trade_url
							? `<a class="dc-trade" href="${esc(c.trade_url)}" target="_blank" rel="noopener noreferrer nofollow">Trade on ${esc(v.name)} ${EXT_ICON}</a>`
							: ''
					}
				</div>
			</div>
		</div>`;

	swapFailedLogos($('dc-hero'), '.dc-logo', 'dc-logo dc-logo-fallback', 'div');
}

// ── Stat cards ──────────────────────────────────────────────────────────────

function statCard({ label, value, sub, cls, tip }) {
	const info = tip
		? ` <span class="dc-info" tabindex="0" role="img" aria-label="${esc(tip)}" title="${esc(tip)}">ⓘ</span>`
		: '';
	return `
		<div class="cv-mini-stat dc-stat">
			<p class="label">${esc(label)}${info}</p>
			<p class="value ${cls || ''}">${esc(value)}</p>
			${sub ? `<p class="sub">${esc(sub)}</p>` : ''}
		</div>`;
}

function renderStats(p) {
	const c = p.contract;
	const s = p.peer_stats;
	const cards = [
		statCard({
			label: 'Mark price',
			value: formatPrice(c.price),
			sub: c.index != null ? `Index ${formatPrice(c.index)}` : undefined,
			tip: 'The venue’s last traded price for this contract, next to the index it settles against.',
		}),
		statCard({
			label: 'Basis',
			value: formatBasis(c.basis_pct),
			sub: c.basis_pct == null ? undefined : c.basis_pct >= 0 ? 'Contract over index' : 'Contract under index',
			cls: signClass(c.basis_pct),
			tip: 'How far the contract trades from its own index. A persistent positive basis is the market paying up to be long.',
		}),
		statCard({
			label: 'Funding rate',
			value: formatFunding(c.funding_rate),
			sub: c.funding_rate == null ? undefined : c.funding_rate >= 0 ? 'Longs pay shorts' : 'Shorts pay longs',
			cls: signClass(c.funding_rate),
			tip: 'Paid each funding interval, typically every 8 hours.',
		}),
		statCard({
			label: 'Funding, annualized',
			value: formatApr(c.funding_apr),
			sub: 'Assumes 8h intervals',
			cls: signClass(c.funding_apr),
			tip: 'The interval rate compounded out over a year at three settlements a day. An estimate: venues publish schedules, CoinGecko does not.',
		}),
		statCard({
			label: 'Open interest',
			value: formatUsd(c.open_interest_usd),
			sub: s?.oi_rank ? `#${s.oi_rank} of ${formatCount(s.venues)} venues` : undefined,
			tip: 'Notional value of every position currently open on this contract.',
		}),
		statCard({
			label: '24h volume',
			value: formatUsd(c.volume_24h_usd),
			sub: s?.vol_rank ? `#${s.vol_rank} of ${formatCount(s.venues)} venues` : undefined,
		}),
		statCard({
			label: 'Bid/ask spread',
			value: c.spread_pct != null ? `${c.spread_pct.toFixed(4)}%` : DASH,
			sub: 'Round-trip cost of crossing',
		}),
		statCard({
			label: c.base ? `24h volume in ${c.base}` : '24h volume in the underlying',
			value: c.volume_24h_base != null ? `${formatSupply(c.volume_24h_base)} ${c.base || ''}`.trim() : DASH,
			sub: 'The same tape, denominated in the asset',
		}),
	];
	$('dc-stats').innerHTML = `<div class="dc-stats">${cards.join('')}</div>`;
}

// ── Funding cost panel ──────────────────────────────────────────────────────
// The rate on its own is abstract. This turns it into the number a trader
// actually cares about: what holding a position of a given size costs per day
// and per year at the rate quoted right now.

function fundingCost(rate, positionUsd) {
	if (rate == null || !Number.isFinite(rate) || !Number.isFinite(positionUsd)) return null;
	const perInterval = (rate / 100) * positionUsd;
	return {
		perInterval,
		perDay: perInterval * 3,
		perYear: perInterval * FUNDING_PERIODS_PER_YEAR,
	};
}

function renderFunding(p) {
	const c = p.contract;
	const el = $('dc-funding');
	if (c.funding_rate == null) {
		el.innerHTML = `
			<section class="dc-panel" aria-label="Funding">
				<div class="dc-panel-head"><h2 class="cv-h2">Funding</h2></div>
				<p class="dc-panel-note">This venue does not publish a funding rate for ${esc(c.symbol)}, so there is nothing to price here. Every other figure on this page is live.</p>
			</section>`;
		return;
	}

	const longsPay = c.funding_rate >= 0;
	const payer = longsPay ? 'Longs pay shorts' : 'Shorts pay longs';
	const cost = fundingCost(c.funding_rate, state.positionUsd);

	el.innerHTML = `
		<section class="dc-panel" aria-label="Funding cost">
			<div class="dc-panel-head">
				<h2 class="cv-h2">What funding costs</h2>
				<p class="dc-panel-note">Rate is per funding interval; daily and annual figures assume the 8h schedule most venues run.</p>
			</div>
			<p class="dc-fund-verdict">
				<strong class="${signClass(c.funding_rate)}">${esc(payer)}</strong> ${esc(formatFunding(c.funding_rate))} per interval
				on ${esc(c.symbol)}, which annualizes to <strong class="${signClass(c.funding_apr)}">${esc(formatApr(c.funding_apr))}</strong>.
				${
					longsPay
						? 'Holding this contract long costs you that; holding it short is paid it.'
						: 'Holding this contract short costs you that; holding it long is paid it.'
				}
			</p>
			<div class="dc-calc">
				<div>
					<label for="dc-size">Position size</label>
					<div class="dc-calc-field">
						<span class="prefix" aria-hidden="true">$</span>
						<input id="dc-size" type="number" inputmode="decimal" min="0" step="100"
							value="${state.positionUsd}" aria-label="Position size in US dollars" />
					</div>
				</div>
				<div class="dc-calc-out" id="dc-calc-out">${fundingOutput(cost, longsPay)}</div>
			</div>
		</section>`;

	const input = $('dc-size');
	input.addEventListener('input', () => {
		const raw = Number(input.value);
		state.positionUsd = Number.isFinite(raw) && raw >= 0 ? raw : 0;
		$('dc-calc-out').innerHTML = fundingOutput(
			fundingCost(c.funding_rate, state.positionUsd),
			longsPay,
		);
	});
}

function fundingOutput(cost, longsPay) {
	if (!cost) return '';
	const side = longsPay ? 'long' : 'short';
	const cell = (k, v) =>
		`<div><p class="k">${esc(k)}</p><p class="v cv-down">${esc(formatUsdExact(v))}</p></div>`;
	return [
		`<div><p class="k">Paid by the ${esc(side)}</p><p class="v">${esc(formatUsdExact(cost.perInterval))}</p></div>`,
		cell('Per day', cost.perDay),
		cell('Per year', cost.perYear),
	].join('');
}

// ── Underlying price chart ──────────────────────────────────────────────────

const TIME_RANGES = [
	{ label: '1D', days: 1 },
	{ label: '7D', days: 7 },
	{ label: '30D', days: 30 },
	{ label: '90D', days: 90 },
	{ label: '1Y', days: 365 },
];

const CHART_W = 800;
const CHART_H = 300;
const PAD = { top: 20, right: 76, bottom: 30, left: 10 };

const chartState = { days: 30, series: [], loading: false, error: false, coinId: null, name: '' };

function chartGeometry(series) {
	const vals = series.map((p) => p[1]);
	const min = Math.min(...vals);
	const max = Math.max(...vals);
	const range = max - min || Math.abs(max) || 1;
	const w = CHART_W - PAD.left - PAD.right;
	const h = CHART_H - PAD.top - PAD.bottom;
	const pts = vals.map((v, i) => ({
		x: PAD.left + (series.length === 1 ? w / 2 : (i / (series.length - 1)) * w),
		y: PAD.top + h - ((v - min) / range) * h,
	}));
	const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
	const area = `${line} L${pts[pts.length - 1].x.toFixed(2)},${(PAD.top + h).toFixed(2)} L${pts[0].x.toFixed(2)},${(PAD.top + h).toFixed(2)} Z`;
	return { min, max, range, line, area };
}

function renderChart() {
	const el = $('dc-chart');
	const { days, series, loading, error, name } = chartState;
	if (!chartState.coinId) {
		el.innerHTML = '';
		return;
	}

	const rangeBtns = TIME_RANGES.map(
		(r) =>
			`<button type="button" class="cv-range-btn" data-days="${r.days}" aria-pressed="${r.days === days}">${r.label}</button>`,
	).join('');

	let body;
	if (loading) {
		body = '<div class="cv-chart-state"><span class="cv-spinner" aria-hidden="true"></span>Loading chart</div>';
	} else if (error) {
		body = '<div class="cv-chart-state">Price history is temporarily unavailable. The contract figures above are live.</div>';
	} else if (series.length < 2) {
		body = '<div class="cv-chart-state">No price history available for this range.</div>';
	} else {
		const g = chartGeometry(series);
		const up = series[series.length - 1][1] >= series[0][1];
		const color = up ? 'var(--cv-chart-green)' : 'var(--cv-chart-red)';
		const steps = 4;
		const h = CHART_H - PAD.top - PAD.bottom;
		const yLabels = Array.from({ length: steps + 1 }, (_, i) => {
			const v = g.min + (g.range * i) / steps;
			const y = PAD.top + h - (i / steps) * h;
			return `<g><line x1="${PAD.left}" y1="${y}" x2="${CHART_W - PAD.right}" y2="${y}" stroke="var(--cv-border)" stroke-width="0.5" stroke-dasharray="4 4" opacity="0.5"/><text x="${CHART_W - PAD.right + 8}" y="${y + 4}" font-size="10" fill="var(--cv-text-3)">${esc(formatPrice(v))}</text></g>`;
		}).join('');
		body = `
			<div class="cv-chart-area">
				<svg viewBox="0 0 ${CHART_W} ${CHART_H}" role="img"
					aria-label="${esc(name)} spot price over ${days} day${days > 1 ? 's' : ''}">
					<defs>
						<linearGradient id="dc-grad" x1="0" x2="0" y1="0" y2="1">
							<stop offset="0%" stop-color="${color}" stop-opacity="0.2"/>
							<stop offset="100%" stop-color="${color}" stop-opacity="0.02"/>
						</linearGradient>
					</defs>
					${yLabels}
					<path d="${g.area}" fill="url(#dc-grad)"/>
					<path d="${g.line}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
					<g id="dc-crosshair" hidden>
						<line id="dc-cross-line" x1="0" y1="${PAD.top}" x2="0" y2="${CHART_H - PAD.bottom}" stroke="var(--cv-text-3)" stroke-width="0.5" stroke-dasharray="3 3"/>
						<circle id="dc-cross-dot" r="4" fill="${color}" stroke="var(--cv-surface)" stroke-width="2"/>
					</g>
				</svg>
				<div class="cv-chart-tip" id="dc-tip" hidden>
					<p class="p cv-mono" id="dc-tip-val"></p>
					<p class="d" id="dc-tip-date"></p>
				</div>
			</div>`;
	}

	el.innerHTML = `
		<div class="cv-chart-panel">
			<div class="cv-chart-bar">
				<div class="left"><span class="title">${esc(name)} spot price, the index this contract tracks</span></div>
				<div class="cv-ranges" role="group" aria-label="Chart time range">${rangeBtns}</div>
			</div>
			${body}
		</div>`;

	el.querySelectorAll('.cv-range-btn').forEach((btn) => {
		btn.addEventListener('click', () => {
			const dd = Number(btn.dataset.days);
			if (dd === chartState.days) return;
			chartState.days = dd;
			loadChart();
		});
	});

	wireChartPointer();
}

function wireChartPointer() {
	const svg = $('dc-chart').querySelector('svg');
	const tip = $('dc-tip');
	if (!svg || !tip || chartState.series.length < 2) return;
	const g = chartGeometry(chartState.series);
	const cross = svg.querySelector('#dc-crosshair');
	const crossLine = svg.querySelector('#dc-cross-line');
	const crossDot = svg.querySelector('#dc-cross-dot');
	const usableW = CHART_W - PAD.left - PAD.right;
	const usableH = CHART_H - PAD.top - PAD.bottom;

	function show(clientX) {
		const rect = svg.getBoundingClientRect();
		const mouseX = ((clientX - rect.left) / rect.width) * CHART_W;
		const n = chartState.series.length;
		const i = Math.max(0, Math.min(n - 1, Math.round(((mouseX - PAD.left) / usableW) * (n - 1))));
		const [ts, price] = chartState.series[i];
		const x = PAD.left + (i / (n - 1)) * usableW;
		const y = PAD.top + usableH - ((price - g.min) / g.range) * usableH;
		cross.removeAttribute('hidden');
		crossLine.setAttribute('x1', x);
		crossLine.setAttribute('x2', x);
		crossDot.setAttribute('cx', x);
		crossDot.setAttribute('cy', y);
		tip.hidden = false;
		tip.style.left = `${(x / CHART_W) * 100}%`;
		$('dc-tip-val').textContent = formatPrice(price);
		$('dc-tip-date').textContent = formatChartTick(ts, chartState.days);
	}
	function hide() {
		cross.setAttribute('hidden', '');
		tip.hidden = true;
	}
	svg.addEventListener('pointermove', (e) => show(e.clientX));
	svg.addEventListener('pointerleave', hide);
	svg.addEventListener('pointerdown', (e) => show(e.clientX));
}

async function loadChart() {
	if (!chartState.coinId) return;
	chartState.loading = true;
	chartState.error = false;
	renderChart();
	try {
		const data = await getJson(
			`/api/coin/ohlc?id=${encodeURIComponent(chartState.coinId)}&days=${chartState.days}`,
		);
		chartState.series = Array.isArray(data.data) ? data.data : [];
		chartState.loading = false;
	} catch {
		chartState.loading = false;
		chartState.error = true;
		chartState.series = [];
	}
	renderChart();
}

// ── Cross-venue comparison ──────────────────────────────────────────────────

function peerLink(row, label) {
	const href = row.venue_id && row.symbol ? derivativePath(row.venue_id, row.symbol) : null;
	return href ? `<a href="${esc(href)}">${esc(label)}</a>` : esc(label);
}

function renderCallouts(p) {
	const s = p.peer_stats;
	if (!s) return '';
	const cards = [];
	if (s.cheapest_long) {
		cards.push(`
			<div class="dc-callout">
				<p class="k">Cheapest venue to hold a long</p>
				<p class="v">${peerLink(s.cheapest_long, s.cheapest_long.venue_name)}</p>
				<p class="s ${signClass(s.cheapest_long.funding_rate)}">${esc(formatFunding(s.cheapest_long.funding_rate))} per interval · ${esc(s.cheapest_long.symbol || '')}</p>
			</div>`);
	}
	if (s.richest_short) {
		cards.push(`
			<div class="dc-callout">
				<p class="k">Best paid venue to hold a short</p>
				<p class="v">${peerLink(s.richest_short, s.richest_short.venue_name)}</p>
				<p class="s ${signClass(s.richest_short.funding_rate)}">${esc(formatFunding(s.richest_short.funding_rate))} per interval · ${esc(s.richest_short.symbol || '')}</p>
			</div>`);
	}
	if (s.funding_spread != null) {
		cards.push(`
			<div class="dc-callout">
				<p class="k">Funding spread across venues</p>
				<p class="v">${esc(s.funding_spread.toFixed(4))} pp</p>
				<p class="s">Median ${esc(formatFunding(s.funding_median))} · ${esc(formatCount(s.liquid_venues))} liquid venues</p>
			</div>`);
	}
	if (s.price_dispersion_pct != null) {
		cards.push(`
			<div class="dc-callout">
				<p class="k">Price dispersion</p>
				<p class="v">${esc(s.price_dispersion_pct.toFixed(2))}%</p>
				<p class="s">${esc(formatPrice(s.price_min))} to ${esc(formatPrice(s.price_max))}</p>
			</div>`);
	}
	return cards.length ? `<div class="dc-callouts">${cards.join('')}</div>` : '';
}

function peerRow(row) {
	const label = row.symbol || DASH;
	const venueHref = row.venue_id ? `/exchange/${encodeURIComponent(row.venue_id)}` : null;
	const venueCell = `<span class="dc-venue-cell">${
		row.image
			? `<img src="${esc(upstreamLogoURL(row.image, 20))}" alt="" loading="lazy" width="20" height="20" data-no-dark-filter />`
			: ''
	}${venueHref ? `<a href="${esc(venueHref)}">${esc(row.venue_name)}</a>` : esc(row.venue_name)}</span>`;
	return `
		<tr class="${row.current ? 'dc-current' : ''}">
			<td class="left">${venueCell}</td>
			<td class="left cv-mono">${peerLink(row, label)}${row.current ? '<span class="dc-here">You are here</span>' : ''}</td>
			<td class="cv-mono">${esc(formatPrice(row.price))}</td>
			<td class="cv-mono ${signClass(row.change_24h)}">${esc(formatPercent(row.change_24h))}</td>
			<td class="cv-mono ${signClass(row.funding_rate)}">${esc(formatFunding(row.funding_rate))}</td>
			<td class="cv-mono ${signClass(row.funding_apr)}">${esc(formatApr(row.funding_apr))}</td>
			<td class="cv-mono">${esc(formatUsd(row.open_interest_usd))}</td>
			<td class="cv-mono">${esc(formatUsd(row.volume_24h_usd))}</td>
		</tr>`;
}

function renderPeers(p) {
	const el = $('dc-peers');
	const base = p.contract.base || p.contract.symbol;
	const peers = Array.isArray(p.peers) ? p.peers : [];
	const heading = `<h2 class="cv-h2">${esc(base)} perpetuals, every venue</h2>`;

	if (!peers.length) {
		el.innerHTML = `${heading}<div class="cv-empty">No other venue in the feed lists a ${esc(base)} perpetual right now. <a href="/derivatives">Browse all perpetual markets</a>.</div>`;
		return;
	}

	const s = p.peer_stats;
	const note = s
		? `<p class="dc-table-note">Showing the ${formatCount(Math.min(peers.length, s.venues))} most active of ${formatCount(s.venues)} venues listing a ${esc(base)} perpetual. Cheapest, best-paid and dispersion figures count only venues clearing ${formatUsd(s.liquid_floor_usd)} or more in 24h volume, so a dormant book cannot set them.</p>`
		: '';

	el.innerHTML = `
		${heading}
		${renderCallouts(p)}
		<div class="cv-table-wrap">
			<table class="cv-table dc-table">
				<caption class="cv-sr-only">${esc(base)} perpetual contracts across venues, ranked by 24h volume</caption>
				<thead>
					<tr>
						<th scope="col" class="left">Venue</th>
						<th scope="col" class="left">Contract</th>
						<th scope="col">Price</th>
						<th scope="col">24h</th>
						<th scope="col">Funding</th>
						<th scope="col">Annualized</th>
						<th scope="col">Open interest</th>
						<th scope="col">24h volume</th>
					</tr>
				</thead>
				<tbody>${peers.map(peerRow).join('')}</tbody>
			</table>
		</div>
		${note}`;
}

// ── Venue context: share meters and the venue's other contracts ─────────────

function shareMeter({ label, pct, caption }) {
	if (pct == null || !Number.isFinite(pct)) return '';
	const width = Math.max(1, Math.min(100, pct));
	return `
		<div class="dc-share">
			<div class="top"><span class="k">${esc(label)}</span><span class="v">${esc(pct.toFixed(2))}%</span></div>
			<div class="dc-share-track"><div class="dc-share-fill" style="width:${width.toFixed(2)}%"></div></div>
			<p class="cap">${esc(caption)}</p>
		</div>`;
}

function venueContractRow(t) {
	const href = derivativePath(t.venue_id, t.symbol);
	const label = t.symbol || DASH;
	return `
		<tr>
			<td class="left cv-mono">${href ? `<a href="${esc(href)}">${esc(label)}</a>` : esc(label)}</td>
			<td class="cv-mono">${esc(formatPrice(t.price))}</td>
			<td class="cv-mono ${signClass(t.change_24h)}">${esc(formatPercent(t.change_24h))}</td>
			<td class="cv-mono ${signClass(t.funding_rate)}">${esc(formatFunding(t.funding_rate))}</td>
			<td class="cv-mono">${esc(formatUsd(t.open_interest_usd))}</td>
			<td class="cv-mono">${esc(formatUsd(t.volume_24h_usd))}</td>
		</tr>`;
}

function renderVenue(p) {
	const v = p.venue;
	const c = p.contract;
	const s = p.peer_stats;
	const others = Array.isArray(p.venue_contracts) ? p.venue_contracts : [];

	const meters = [
		shareMeter({
			label: `Share of ${v.name} open interest`,
			pct: c.venue_oi_share_pct,
			caption: `${formatUsd(c.open_interest_usd)} of this venue's ${formatCount(v.contracts_listed)} listed contracts`,
		}),
		shareMeter({
			label: `Share of ${v.name} 24h volume`,
			pct: c.venue_vol_share_pct,
			caption: `${formatUsd(c.volume_24h_usd)} traded here in the last 24 hours`,
		}),
		s
			? shareMeter({
					label: c.base
						? `Share of all ${c.base} perpetual open interest`
						: 'Share of all open interest in this underlying',
					pct: s.oi_share_pct,
					caption: `${formatUsd(s.total_open_interest_usd)} open across ${formatCount(s.venues)} venues`,
				})
			: '',
	]
		.filter(Boolean)
		.join('');

	const table = others.length
		? `
		<h3 class="cv-h2" style="font-size:1rem;margin-top:1.75rem">Other contracts on ${esc(v.name)}</h3>
		<div class="cv-table-wrap">
			<table class="cv-table dc-table">
				<caption class="cv-sr-only">The most traded other contracts listed on ${esc(v.name)}</caption>
				<thead>
					<tr>
						<th scope="col" class="left">Contract</th>
						<th scope="col">Price</th>
						<th scope="col">24h</th>
						<th scope="col">Funding</th>
						<th scope="col">Open interest</th>
						<th scope="col">24h volume</th>
					</tr>
				</thead>
				<tbody>${others.map(venueContractRow).join('')}</tbody>
			</table>
		</div>
		<p class="dc-table-note"><a href="/exchange/${encodeURIComponent(v.id)}">See the full ${esc(v.name)} profile</a> for every contract, open interest and venue history.</p>`
		: `<p class="dc-table-note"><a href="/exchange/${encodeURIComponent(v.id)}">See the full ${esc(v.name)} profile</a>.</p>`;

	const about = v.description
		? `<div class="cv-prose" style="margin-top:1rem"><p>${esc(v.description)}</p></div>`
		: '';

	$('dc-venue').innerHTML = `
		<h2 class="cv-h2">How big this contract is</h2>
		${meters ? `<div class="dc-shares">${meters}</div>` : '<p class="dc-table-note">This venue does not report the shares needed to size the contract against its book.</p>'}
		${about}
		${table}`;
}

// ── Underlying asset card ───────────────────────────────────────────────────

function renderAsset(p) {
	const a = p.index;
	const el = $('dc-asset');
	if (!a || !a.coin_id) {
		el.innerHTML = '';
		return;
	}
	const stats = [
		['Market cap', formatUsd(a.market_cap)],
		['Spot 24h volume', formatUsd(a.volume_24h)],
		['24h range', `${formatPrice(a.low_24h)} to ${formatPrice(a.high_24h)}`],
		['All-time high', `${formatPrice(a.ath)}${a.ath_change_pct != null ? ` (${formatPercent(a.ath_change_pct)})` : ''}`],
	];
	el.innerHTML = `
		<h2 class="cv-h2">The underlying</h2>
		<a class="dc-asset" href="/coin/${encodeURIComponent(a.coin_id)}">
			${a.image ? `<img src="${esc(upstreamLogoURL(a.image, 40))}" alt="" width="40" height="40" loading="lazy" data-no-dark-filter />` : ''}
			<span>
				<p class="nm">${esc(a.name || a.symbol || '')} ${a.market_cap_rank != null ? `<span class="dc-chip">#${esc(String(a.market_cap_rank))}</span>` : ''}</p>
				<p class="sub">Spot market on three.ws</p>
			</span>
			<span class="spot">
				<p class="p">${esc(formatPrice(a.price_usd))}</p>
				<p class="d ${signClass(a.change_24h)}">${esc(formatPercent(a.change_24h))} 24h</p>
			</span>
		</a>
		<div class="dc-stats">${stats.map(([k, v]) => statCard({ label: k, value: v })).join('')}</div>`;
}

// ── Related links ───────────────────────────────────────────────────────────

function renderRelated(p) {
	const v = p.venue;
	const c = p.contract;
	const pills = [
		`<a class="cv-pill" href="/derivatives">All perpetual markets</a>`,
		`<a class="cv-pill" href="/exchange/${encodeURIComponent(v.id)}">${esc(v.name)} profile</a>`,
	];
	if (c.coin_id) pills.push(`<a class="cv-pill" href="/coin/${encodeURIComponent(c.coin_id)}">${esc(c.base || c.coin_id)} spot</a>`);
	pills.push('<a class="cv-pill" href="/exchanges">Exchange rankings</a>');
	$('dc-related').innerHTML = `<div class="dc-related">${pills.join('')}</div>`;
}

// ── SEO metadata ────────────────────────────────────────────────────────────

function updateMeta(p) {
	const c = p.contract;
	const v = p.venue;
	const title = `${c.symbol} on ${v.name} - Perpetual Futures · three.ws`;
	document.title = title;
	const url = `https://three.ws${derivativePath(v.id, c.symbol) || '/derivatives'}`;
	const desc = `${c.symbol} perpetual futures on ${v.name}: ${formatPrice(c.price)} mark price, ${formatFunding(c.funding_rate)} funding (${formatApr(c.funding_apr)} annualized), ${formatUsd(c.open_interest_usd)} open interest and ${formatUsd(c.volume_24h_usd)} 24h volume, compared against every other venue listing ${c.base || 'the same'} perpetuals.`;

	const set = (sel, attr, val) => document.querySelector(sel)?.setAttribute(attr, val);
	set('meta[name="description"]', 'content', desc);
	set('meta[property="og:title"]', 'content', title);
	set('meta[property="og:description"]', 'content', desc);
	set('meta[property="og:url"]', 'content', url);
	set('meta[name="twitter:title"]', 'content', title);
	set('meta[name="twitter:description"]', 'content', desc);
	if (v.image) {
		set('meta[property="og:image"]', 'content', v.image);
		set('meta[name="twitter:image"]', 'content', v.image);
	}
	let canon = document.querySelector('link[rel="canonical"]');
	if (!canon) {
		canon = document.createElement('link');
		canon.rel = 'canonical';
		document.head.appendChild(canon);
	}
	canon.href = url;

	const ld = {
		'@context': 'https://schema.org',
		'@type': 'FinancialProduct',
		name: `${c.symbol} perpetual futures`,
		description: desc,
		url,
		category: 'Perpetual futures contract',
		provider: { '@type': 'Organization', name: v.name, url: v.url || undefined },
	};
	let script = document.getElementById('dc-ld');
	if (!script) {
		script = document.createElement('script');
		script.type = 'application/ld+json';
		script.id = 'dc-ld';
		document.head.appendChild(script);
	}
	script.textContent = JSON.stringify(ld);
}

// ── Error states ────────────────────────────────────────────────────────────

function clearSections() {
	for (const id of ['dc-stats', 'dc-funding', 'dc-chart', 'dc-peers', 'dc-venue', 'dc-asset', 'dc-related']) {
		$(id).innerHTML = '';
	}
}

function renderNotFound(target) {
	document.title = 'Contract not found · three.ws';
	$('dc-crumb-symbol').textContent = 'Not found';
	$('dc-hero').innerHTML = `
		<h1 class="cv-h1">Contract not found</h1>
		<div class="cv-empty" style="text-align:left">
			<p style="margin:0 0 0.75rem">No active perpetual called <strong>${esc(target.symbol)}</strong> is listed on <strong>${esc(target.venue)}</strong> right now. Contracts get delisted and symbols get renamed, and expired contracts drop out of the feed.</p>
			<p style="margin:0">Browse <a href="/derivatives">every live perpetual market</a>, or open the <a href="/exchange/${encodeURIComponent(target.venue)}">${esc(target.venue)} profile</a> to see what it does list.</p>
		</div>`;
	clearSections();
}

function renderError() {
	$('dc-hero').innerHTML = `
		<h1 class="cv-h1">Contract data unavailable</h1>
		<div class="cv-empty" style="text-align:left">
			<p style="margin:0 0 0.75rem">The market-data source is temporarily unreachable. This usually clears within a minute.</p>
			<button type="button" class="dc-retry" id="dc-retry">Retry</button>
			<span style="margin-left:0.75rem">or go back to <a href="/derivatives">all perpetual markets</a>.</span>
		</div>`;
	clearSections();
	$('dc-retry')?.addEventListener('click', main);
}

// ── Boot ────────────────────────────────────────────────────────────────────

async function main() {
	const target = targetFromLocation();
	const root = $('dc-main');
	if (!target) {
		location.replace('/derivatives');
		return;
	}
	state.venue = target.venue;
	state.symbol = target.symbol;
	root.setAttribute('aria-busy', 'true');
	renderSkeletons();

	let payload;
	try {
		payload = await getJson(
			`/api/coin/derivative?venue=${encodeURIComponent(target.venue)}&symbol=${encodeURIComponent(target.symbol)}`,
		);
	} catch (err) {
		root.removeAttribute('aria-busy');
		if (err.status === 404 || err.status === 400) renderNotFound(target);
		else renderError();
		return;
	}

	state.payload = payload;
	root.removeAttribute('aria-busy');

	updateMeta(payload);
	renderHero(payload);
	renderStats(payload);
	renderFunding(payload);
	renderPeers(payload);
	renderVenue(payload);
	renderAsset(payload);
	renderRelated(payload);

	const upd = $('dc-updated');
	upd.hidden = false;
	upd.textContent = `Updated ${new Date(payload.updated_at || Date.now()).toLocaleTimeString('en-US')} · source: CoinGecko`;

	// The underlying's price history streams in after the contract itself.
	chartState.coinId = payload.contract.coin_id;
	chartState.name = payload.index?.name || payload.contract.base || 'Index';
	chartState.days = 30;
	if (chartState.coinId) loadChart();
	else $('dc-chart').innerHTML = '';
}

main();
