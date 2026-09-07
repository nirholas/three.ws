// /markets/robinhood/desk - Hood Desk, the live onchain trading desk for
// Robinhood Chain (4663).
//
// Two real reads drive everything on the page:
//   /api/v1/robinhood/desk               market side (chain vitals, the NAV
//                                        premium ridge, arb board, movers)
//   /api/v1/robinhood/wallet?address=…   wallet side (book, balance history,
//                                        activity tape, positions, flow)
//
// No wallet is required to read the desk and none is ever asked to sign: an
// address can be pasted, connected from an injected wallet, or linked to with
// ?address=. The trade ticket is the only place a signature appears, and it is
// the existing memecoin swap panel (src/robinhood-purchase.js) mounted on
// demand; Stock Tokens get the eligibility gate instead of a swap.

import { formatUsd, formatPrice, formatPercent, escapeHtml as esc } from './shared/coin-format.js';
import { sparkline } from './shared/market-table.js';
import { onPageReady } from './shell/page-lifecycle.js';

// U+2014 as an escape: the house style bans the literal glyph in source.
const DASH = '\u2014';
const STORAGE_KEY = 'hood_desk_address';
const DESK_REFRESH_MS = 30_000;
const WALLET_REFRESH_MS = 20_000;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

const state = {
	address: null,
	desk: null,
	deskError: null,
	wallet: null,
	walletError: null,
	loadingWallet: false,
	range: 'all',
	showAllPositions: false,
	seen: new Set(),
	bootBlock: null,
	bootedAt: Date.now(),
	lastTick: null,
};

// ── data ────────────────────────────────────────────────────────────────────
async function getJson(url, signal) {
	const res = await fetch(url, { headers: { accept: 'application/json' }, signal });
	const body = await res.json().catch(() => null);
	if (!res.ok) {
		const err = new Error(body?.error_description || body?.error || `request failed (${res.status})`);
		err.status = res.status;
		throw err;
	}
	return body?.data ?? body;
}

function shortAddr(a, head = 6, tail = 4) {
	if (!a) return DASH;
	return `${a.slice(0, head)}…${a.slice(-tail)}`;
}

function fmtEth(n, digits = 4) {
	if (n == null || !Number.isFinite(n)) return DASH;
	if (n !== 0 && Math.abs(n) < 0.0001) return `${n.toExponential(2)} ETH`;
	return `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: digits })} ETH`;
}

function fmtAmount(n) {
	if (n == null || !Number.isFinite(n)) return DASH;
	const abs = Math.abs(n);
	if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
	if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
	if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
	if (abs >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
	if (abs === 0) return '0';
	return n.toPrecision(3);
}

function signClass(n) {
	if (n == null || !Number.isFinite(n)) return 'hd-dim';
	return n >= 0 ? 'hd-up' : 'hd-down';
}

function explorerAddress(a) {
	return `https://robinhoodchain.blockscout.com/address/${a}`;
}

function explorerTx(h) {
	return `https://robinhoodchain.blockscout.com/tx/${h}`;
}

// ── generic panel states ────────────────────────────────────────────────────
function skeleton(height = 180) {
	return `<div class="hd-skel" style="height:${height}px"></div>`;
}

function emptyState(title, body, actionLabel, actionId) {
	return `
		<div class="hd-empty">
			<strong>${esc(title)}</strong>
			<span>${body}</span>
			${actionId ? `<button class="hd-btn hd-btn-sm" type="button" data-action="${esc(actionId)}">${esc(actionLabel)}</button>` : ''}
		</div>`;
}

function errorState(message, retryId) {
	return `
		<div class="hd-error" role="alert">
			<span>${esc(message)}</span>
			<button class="hd-btn hd-btn-sm" type="button" data-action="${esc(retryId)}">Retry</button>
		</div>`;
}

function cardHead(title, meta = '', extra = '') {
	return `
		<div class="hd-card-head">
			<h2 class="hd-card-title">${esc(title)}</h2>
			<span class="hd-card-meta hd-label">${meta}</span>
			${extra}
		</div>`;
}

// ── stat strip ──────────────────────────────────────────────────────────────
function statTile(label, value, foot, { accent = false, extra = '' } = {}) {
	return `
		<div class="hd-stat">
			<span class="hd-label">${esc(label)}</span>
			<span class="hd-stat-value${accent ? ' hd-accent' : ''}">${value}</span>
			<span class="hd-stat-foot">${foot}</span>
			${extra}
		</div>`;
}

function gasLadder(gas) {
	if (!gas) return '';
	const lit = [gas.slow, gas.average, gas.fast].filter((g) => Number.isFinite(g)).length;
	return `<div class="hd-gas-ladder" aria-hidden="true">${Array.from({ length: 3 })
		.map((_, i) => `<span class="hd-gas-seg${i < lit ? ' on' : ''}"></span>`)
		.join('')}</div>`;
}

function renderStats() {
	const el = document.getElementById('hd-stats');
	if (!el) return;
	const chain = state.desk?.chain || null;
	const w = state.wallet;
	const tiles = [];

	if (state.address) {
		const change = w?.history?.change || null;
		const pct = change?.pct;
		tiles.push(
			statTile(
				'Book value / USD',
				w ? esc(formatUsd(w.book?.valueUsd)) : `<span class="hd-dim">${DASH}</span>`,
				w
					? `${esc(formatUsd(w.book?.tokensUsd))} tokens · ${esc(formatUsd(w.book?.nativeUsd))} native`
					: 'loading the book',
				{ accent: true },
			),
			statTile(
				'Native / ETH',
				w ? esc(fmtEth(w.native?.balance)) : `<span class="hd-dim">${DASH}</span>`,
				change && Number.isFinite(pct)
					? `<span class="${signClass(pct)}">${esc(formatPercent(pct))}</span> over ${esc(spanLabel(change))}`
					: 'no balance history indexed yet',
			),
			statTile(
				'Positions',
				w ? String(w.book?.positionCount ?? 0) : `<span class="hd-dim">${DASH}</span>`,
				w
					? `${w.book?.pricedCount ?? 0} priced · top ${esc(w.positions?.[0]?.symbol || DASH)}`
					: 'ERC-20 balances on 4663',
			),
		);
	} else {
		tiles.push(
			statTile('Chain TVL', esc(formatUsd(chain?.tvlUsd)), 'DefiLlama, Robinhood Chain', { accent: true }),
			statTile(
				'ETH / USD',
				chain?.ethPriceUsd != null ? esc(formatPrice(chain.ethPriceUsd)) : `<span class="hd-dim">${DASH}</span>`,
				'gas token, no native chain token',
			),
			statTile(
				'NAV spread',
				state.desk ? esc(formatPercent(state.desk.ridge?.stats?.median)) : `<span class="hd-dim">${DASH}</span>`,
				state.desk
					? `median premium · ${state.desk.ridge?.stats?.priced ?? 0}/${state.desk.stockCount ?? 0} priced`
					: 'Chainlink NAV vs Uniswap',
			),
		);
	}

	tiles.push(
		statTile(
			'Chain gate',
			chain?.blockHeight != null ? `#${chain.blockHeight.toLocaleString('en-US')}` : `<span class="hd-dim">${DASH}</span>`,
			chain?.gas
				? `gas ${esc(String(chain.gas.average ?? DASH))} gwei avg · ${esc(String(chain.averageBlockTimeMs ?? DASH))}ms blocks`
				: 'block height',
			{ extra: gasLadder(chain?.gas) },
		),
	);

	el.innerHTML = tiles.join('');
}

function spanLabel(change) {
	if (!change?.fromT || !change?.toT) return 'the window';
	const mins = Math.max(1, Math.round((change.toT - change.fromT) / 60000));
	if (mins < 90) return `${mins}m`;
	const hours = Math.round(mins / 60);
	if (hours < 48) return `${hours}h`;
	return `${Math.round(hours / 24)}d`;
}

// ── balance history ─────────────────────────────────────────────────────────
const RANGES = [
	{ id: '1h', label: '1H', ms: 3_600_000 },
	{ id: '24h', label: '24H', ms: 86_400_000 },
	{ id: 'all', label: 'ALL', ms: Infinity },
];

function seriesInRange(series, rangeId) {
	const range = RANGES.find((r) => r.id === rangeId) || RANGES[2];
	if (!Number.isFinite(range.ms)) return series;
	const cutoff = Date.now() - range.ms;
	const windowed = series.filter((p) => p.t >= cutoff);
	// Never render a one-point line: fall back to the full series rather than
	// showing an empty chart for a wallet whose last move was days ago.
	return windowed.length >= 2 ? windowed : series;
}

function areaChart(series, { width = 780, height = 232 } = {}) {
	const padL = 58;
	const padR = 18;
	const padT = 18;
	const padB = 26;
	const xs = series.map((p) => p.t);
	const ys = series.map((p) => p.eth);
	const minT = Math.min(...xs);
	const maxT = Math.max(...xs);
	const maxY = Math.max(...ys);
	const rawMin = Math.min(...ys);
	const spread = maxY - rawMin;
	const minY = Math.max(0, rawMin - (spread || maxY || 1) * 0.25);
	const topY = maxY + (spread || maxY || 1) * 0.15;
	const sx = (t) => padL + ((t - minT) / (maxT - minT || 1)) * (width - padL - padR);
	const sy = (v) => padT + (1 - (v - minY) / (topY - minY || 1)) * (height - padT - padB);

	const line = series.map((p, i) => `${i ? 'L' : 'M'}${sx(p.t).toFixed(1)} ${sy(p.eth).toFixed(1)}`).join(' ');
	const area = `${line} L${sx(maxT).toFixed(1)} ${height - padB} L${sx(minT).toFixed(1)} ${height - padB} Z`;
	const gridYs = [minY, (minY + topY) / 2, topY];
	const last = series[series.length - 1];
	const rising = last.eth >= series[0].eth;
	const stroke = rising ? 'var(--cv-chart-green)' : 'var(--cv-chart-red)';

	return `
		<svg class="hd-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Native ETH balance over time">
			<defs>
				<linearGradient id="hd-area" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stop-color="${stroke}" stop-opacity="0.22" />
					<stop offset="100%" stop-color="${stroke}" stop-opacity="0" />
				</linearGradient>
			</defs>
			<g class="hd-chart-grid">
				${gridYs.map((v) => `<line x1="${padL}" x2="${width - padR}" y1="${sy(v).toFixed(1)}" y2="${sy(v).toFixed(1)}" />`).join('')}
			</g>
			<g class="hd-chart-axis">
				${gridYs
					.map((v) => `<text x="${padL - 8}" y="${(sy(v) + 3).toFixed(1)}" text-anchor="end">${v.toFixed(4)}</text>`)
					.join('')}
				<text x="${padL}" y="${height - 8}">${esc(clockLabel(minT))}</text>
				<text x="${width - padR}" y="${height - 8}" text-anchor="end">${esc(clockLabel(maxT))}</text>
			</g>
			<path d="${area}" fill="url(#hd-area)" />
			<path d="${line}" fill="none" stroke="${stroke}" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round" />
			<line class="hd-crosshair" x1="0" x2="0" y1="${padT}" y2="${height - padB}" stroke="var(--cv-text-3)" stroke-dasharray="3 3" stroke-width="1" opacity="0" />
			<circle class="hd-cursor" r="3.5" fill="${stroke}" opacity="0" />
			<circle cx="${sx(last.t).toFixed(1)}" cy="${sy(last.eth).toFixed(1)}" r="4" fill="${stroke}" />
		</svg>`;
}

function clockLabel(t) {
	const d = new Date(t);
	if (Number.isNaN(d.getTime())) return '';
	const sameDay = Date.now() - t < 86_400_000;
	return sameDay
		? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
		: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function renderBalance() {
	const el = document.getElementById('hd-balance');
	if (!el) return;
	const ranges = `<div class="hd-seg" role="group" aria-label="Balance window">${RANGES.map(
		(r) =>
			`<button type="button" data-range="${r.id}" aria-pressed="${state.range === r.id}">${r.label}</button>`,
	).join('')}</div>`;

	if (!state.address) {
		el.innerHTML =
			cardHead('Balance history', 'native ETH / 4663') +
			emptyState(
				'No wallet loaded',
				'Paste any Robinhood Chain address in the bar above, or connect an injected wallet, and the desk reconstructs its native balance curve from the indexer.',
				'Focus the address field',
				'focus-address',
			);
		return;
	}
	if (state.walletError) {
		el.innerHTML = cardHead('Balance history', 'native ETH / 4663') + errorState(state.walletError, 'reload-wallet');
		return;
	}
	if (!state.wallet) {
		el.innerHTML = cardHead('Balance history', 'native ETH / 4663') + skeleton(232);
		return;
	}

	const series = state.wallet.history?.series || [];
	if (series.length < 2) {
		el.innerHTML =
			cardHead('Balance history', 'native ETH / 4663', ranges) +
			emptyState(
				'No balance history yet',
				`The indexer has ${series.length} balance point for ${esc(shortAddr(state.address))}. A curve appears as soon as this wallet moves ETH on chain 4663.`,
			);
		wireBalance(el);
		return;
	}

	const windowed = seriesInRange(series, state.range);
	const change = {
		startEth: windowed[0].eth,
		endEth: windowed[windowed.length - 1].eth,
	};
	const delta = change.endEth - change.startEth;
	const pct = change.startEth > 0 ? (delta / change.startEth) * 100 : null;
	const usd = state.wallet.history?.usdBasis?.ethPriceUsd;

	el.innerHTML = `
		${cardHead('Balance history', `${windowed.length} points`, ranges)}
		<div class="hd-chart-wrap" id="hd-balance-chart">
			${areaChart(windowed)}
			<div class="hd-tip" id="hd-balance-tip" hidden></div>
		</div>
		<div class="hd-metric" style="margin-top:0.75rem">
			<span class="hd-label">Change over window</span>
			<span class="hd-metric-value ${signClass(delta)}">${esc(fmtEth(delta))}${
				pct != null ? ` (${esc(formatPercent(pct))})` : ''
			}</span>
		</div>
		<div class="hd-metric">
			<span class="hd-label">Marked at</span>
			<span class="hd-metric-value">${usd != null ? `${esc(formatPrice(usd))} / ETH` : DASH}</span>
		</div>`;
	wireBalance(el);
	wireChartHover(el, windowed);
}

function wireBalance(root) {
	root.querySelectorAll('[data-range]').forEach((btn) => {
		btn.addEventListener('click', () => {
			state.range = btn.dataset.range;
			renderBalance();
		});
	});
}

function wireChartHover(root, series) {
	const wrap = root.querySelector('#hd-balance-chart');
	const svg = wrap?.querySelector('svg');
	const tip = wrap?.querySelector('#hd-balance-tip');
	if (!wrap || !svg || !tip) return;
	const cross = svg.querySelector('.hd-crosshair');
	const cursor = svg.querySelector('.hd-cursor');
	const padL = 58;
	const padR = 18;
	const vbWidth = 780;

	const move = (ev) => {
		const rect = wrap.getBoundingClientRect();
		const x = ((ev.clientX - rect.left) / rect.width) * vbWidth;
		const ratio = Math.min(1, Math.max(0, (x - padL) / (vbWidth - padL - padR)));
		const minT = series[0].t;
		const maxT = series[series.length - 1].t;
		const target = minT + ratio * (maxT - minT);
		let best = series[0];
		for (const p of series) if (Math.abs(p.t - target) < Math.abs(best.t - target)) best = p;
		const px = padL + ((best.t - minT) / (maxT - minT || 1)) * (vbWidth - padL - padR);
		cross?.setAttribute('x1', px);
		cross?.setAttribute('x2', px);
		cross?.setAttribute('opacity', '0.8');
		const ys = series.map((p) => p.eth);
		const maxY = Math.max(...ys);
		const rawMin = Math.min(...ys);
		const spread = maxY - rawMin;
		const minY = Math.max(0, rawMin - (spread || maxY || 1) * 0.25);
		const topY = maxY + (spread || maxY || 1) * 0.15;
		const py = 18 + (1 - (best.eth - minY) / (topY - minY || 1)) * (232 - 18 - 26);
		cursor?.setAttribute('cx', px);
		cursor?.setAttribute('cy', py);
		cursor?.setAttribute('opacity', '1');
		tip.hidden = false;
		tip.style.left = `${(px / vbWidth) * 100}%`;
		tip.style.top = `${(py / 232) * 100}%`;
		tip.innerHTML = `<b>${esc(fmtEth(best.eth, 6))}</b>${
			best.usd != null ? ` ${esc(formatUsd(best.usd))}` : ''
		}<span class="hd-tip-sub">${esc(new Date(best.t).toLocaleString('en-US'))}${
			best.block ? ` · block ${best.block.toLocaleString('en-US')}` : ''
		}</span>`;
	};

	wrap.addEventListener('pointermove', move);
	wrap.addEventListener('pointerleave', () => {
		tip.hidden = true;
		cross?.setAttribute('opacity', '0');
		cursor?.setAttribute('opacity', '0');
	});
}

// ── activity tape ───────────────────────────────────────────────────────────
function tapeLine(ev) {
	const legs = (ev.tokens || []).filter((t) => t.amount != null);
	if (legs.length) {
		return legs
			.map(
				(t) =>
					`<span class="${t.direction === 'out' ? 'hd-down' : 'hd-up'}">${t.direction === 'out' ? '-' : '+'}${esc(
						fmtAmount(t.amount),
					)}</span> ${esc(t.symbol || shortAddr(t.address, 5, 3))}`,
			)
			.join(' <span class="hd-dim">/</span> ');
	}
	if (ev.valueEth) return `${esc(fmtEth(ev.valueEth, 5))}`;
	if (ev.method) return `<span class="hd-dim">${esc(ev.method)}</span>`;
	return `<span class="hd-dim">contract call</span>`;
}

function renderTape() {
	const el = document.getElementById('hd-tape-card');
	if (!el) return;
	if (!state.address) {
		el.innerHTML =
			cardHead('Activity tape', 'live / 4663') +
			emptyState(
				'The tape is per wallet',
				'Load an address to stream its swaps, transfers, mints and approvals as the chain confirms them (about one block every 100ms).',
				'Focus the address field',
				'focus-address',
			);
		return;
	}
	if (state.walletError) {
		el.innerHTML = cardHead('Activity tape', 'live / 4663') + errorState(state.walletError, 'reload-wallet');
		return;
	}
	if (!state.wallet) {
		el.innerHTML = cardHead('Activity tape', 'live / 4663') + skeleton(280);
		return;
	}
	const events = state.wallet.activity || [];
	if (!events.length) {
		el.innerHTML =
			cardHead('Activity tape', 'live / 4663') +
			emptyState(
				'No activity on this wallet',
				`Nothing has touched ${esc(shortAddr(state.address))} on Robinhood Chain yet. The tape fills in as soon as it transacts.`,
			);
		return;
	}

	el.innerHTML = `
		${cardHead('Activity tape', `${events.length} events`)}
		<ul class="hd-tape" id="hd-tape" aria-label="Onchain activity, newest first">
			${events
				.map((ev) => {
					const fresh = ev.hash && !state.seen.has(ev.hash);
					return `
					<li>
						<a class="hd-tape-row${fresh ? ' is-new' : ''}" href="${esc(explorerTx(ev.hash))}" target="_blank" rel="noopener noreferrer">
							<span class="hd-dim">${esc(clockLabel(Date.parse(ev.timestamp)))}</span>
							<span class="hd-kind ${esc(ev.kind)}">${esc(ev.kind)}</span>
							<span class="hd-tape-detail">${tapeLine(ev)}</span>
							<span class="hd-tape-right hd-dim">${esc(shortAddr(ev.counterparty, 5, 3))}</span>
						</a>
					</li>`;
				})
				.join('')}
		</ul>`;
	for (const ev of events) if (ev.hash) state.seen.add(ev.hash);
}

// ── NAV premium ridge ───────────────────────────────────────────────────────
function ridgeSvg(ridge) {
	const width = 900;
	const height = 340;
	const padL = 26;
	const padR = 26;
	const padT = 26;
	const padB = 40;
	const bins = ridge.bins || [];
	const layers = ridge.layers || [];
	if (!bins.length || !layers.length) return '';

	const skew = 5;
	const plotW = width - padL - padR - skew * (layers.length - 1);
	const rowH = (height - padT - padB) / Math.max(1, layers.length + 4);
	const amp = rowH * 5.5;
	const maxBin = Math.max(1, ...layers.flatMap((l) => l.density));
	const bx = (i) => padL + (i / (bins.length - 1)) * plotW;
	const span = ridge.stats?.spanPct ?? 4;
	const pctToX = (pct) => padL + ((pct + span) / (span * 2)) * plotW;

	const paths = [];
	for (let i = layers.length - 1; i >= 0; i--) {
		const layer = layers[i];
		const xOff = i * skew;
		const yBase = padT + (layers.length - 1 - i) * rowH + amp;
		const pts = layer.density.map((d, b) => [bx(b) + xOff, yBase - (d / maxBin) * amp]);
		let d = `M${pts[0][0].toFixed(1)} ${yBase.toFixed(1)} L${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
		for (let p = 1; p < pts.length; p++) {
			const [x0, y0] = pts[p - 1];
			const [x1, y1] = pts[p];
			const mx = (x0 + x1) / 2;
			d += ` Q${x0.toFixed(1)} ${y0.toFixed(1)} ${mx.toFixed(1)} ${((y0 + y1) / 2).toFixed(1)}`;
		}
		const lastPt = pts[pts.length - 1];
		d += ` L${lastPt[0].toFixed(1)} ${lastPt[1].toFixed(1)} L${lastPt[0].toFixed(1)} ${yBase.toFixed(1)} Z`;
		paths.push(
			`<path class="hd-ridge-layer${i === 0 ? ' hot' : ''}" d="${d}"><title>${
				layer.minLiquidityUsd > 0
					? `${layer.count} tokens with pools deeper than ${formatUsd(layer.minLiquidityUsd)}`
					: `all ${layer.count} priced tokens`
			}</title></path>`,
		);
	}

	const frontBase = padT + (layers.length - 1) * rowH + amp;
	const ticks = [-span, -span / 2, 0, span / 2, span].map((t) => Number(t.toFixed(2)));
	const hits = bins
		.map((b, i) => {
			const count = layers[0]?.density?.[i] || 0;
			if (!count) return '';
			const x = bx(i) - plotW / bins.length / 2;
			const symbols = (ridge.symbols?.[i] || []).join(' ');
			return `<rect class="hd-ridge-hit" x="${x.toFixed(1)}" y="${padT}" width="${(plotW / bins.length).toFixed(
				1,
			)}" height="${(frontBase - padT).toFixed(1)}" data-bin="${i}"><title>${count} token${
				count === 1 ? '' : 's'
			} at ${b.from.toFixed(2)}% to ${b.to.toFixed(2)}%${symbols ? `: ${symbols}` : ''}</title></rect>`;
		})
		.join('');

	// The shaded strip is the "at NAV" band (within half a percent of the feed
	// price): everything outside it is a dislocation someone can trade against.
	const fairFrom = pctToX(-0.5);
	const fairTo = pctToX(0.5);
	return `
		<svg class="hd-ridge-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Distribution of Stock Token DEX premium against Chainlink NAV, layered by pool depth">
			<rect class="hd-ridge-band" x="${fairFrom.toFixed(1)}" y="${padT}" width="${Math.max(2, fairTo - fairFrom).toFixed(1)}" height="${(frontBase - padT).toFixed(1)}" />
			<line class="hd-ridge-zero" x1="${pctToX(0).toFixed(1)}" x2="${pctToX(0).toFixed(1)}" y1="${(frontBase - amp * 1.15).toFixed(1)}" y2="${frontBase.toFixed(1)}" />
			${paths.join('')}
			${hits}
			<g class="hd-chart-axis">
				${ticks
					.map(
						(t) =>
							`<text x="${pctToX(t).toFixed(1)}" y="${height - 16}" text-anchor="middle">${t > 0 ? '+' : ''}${t}%</text>`,
					)
					.join('')}
				<text x="${padL}" y="${height - 2}">discount / DEX below NAV</text>
				<text x="${pctToX(0).toFixed(1)}" y="${height - 2}" text-anchor="middle">at NAV, plus or minus 0.5%</text>
				<text x="${width - padR}" y="${height - 2}" text-anchor="end">premium / DEX above NAV</text>
			</g>
		</svg>`;
}

function renderRidge() {
	const el = document.getElementById('hd-ridge');
	if (!el) return;
	if (state.deskError) {
		el.innerHTML = cardHead('NAV premium ridge', 'chainlink vs uniswap') + errorState(state.deskError, 'reload-desk');
		return;
	}
	if (!state.desk) {
		el.innerHTML = cardHead('NAV premium ridge', 'chainlink vs uniswap') + skeleton(300);
		return;
	}
	const ridge = state.desk.ridge || {};
	const s = ridge.stats || {};
	if (!s.priced) {
		el.innerHTML =
			cardHead('NAV premium ridge', 'chainlink vs uniswap') +
			emptyState(
				'No Stock Token is priced on both sides right now',
				'The ridge needs a Chainlink NAV and a live Uniswap pool for the same token. It fills back in as soon as a pool quotes again.',
				'Reload market data',
				'reload-desk',
			);
		return;
	}
	const arb = state.desk.arb || [];

	el.innerHTML = `
		${cardHead('NAV premium ridge', 'one layer per liquidity floor')}
		<div class="hd-ridge-layout">
			<div class="hd-metric-rail">
				<div class="hd-metric"><span class="hd-label">Priced both sides</span><span class="hd-metric-value">${s.priced} / ${
					state.desk.stockCount ?? DASH
				}</span></div>
				<div class="hd-metric"><span class="hd-label">Median premium</span><span class="hd-metric-value ${signClass(
					s.median,
				)}">${esc(formatPercent(s.median))}</span></div>
				<div class="hd-metric"><span class="hd-label">P10 / P90</span><span class="hd-metric-value">${esc(
					formatPercent(s.p10),
				)} / ${esc(formatPercent(s.p90))}</span></div>
				<div class="hd-metric"><span class="hd-label">Widest</span><span class="hd-metric-value">${esc(
					formatPercent(s.min),
				)} / ${esc(formatPercent(s.max))}</span></div>
				<p class="hd-note" style="margin-top:0.25rem">
					Each layer redraws the same distribution over a deeper pool floor, so a spread that
					survives to the back rows is one you could actually size into.
				</p>
			</div>
			<div class="hd-ridge-scroll">
				${ridgeSvg(ridge)}
			</div>
		</div>
		${
			arb.length
				? `<div class="cv-table-wrap" style="margin-top:1rem"><table class="hd-table">
					<thead><tr>
						<th class="left">Widest tradeable dislocation</th><th>NAV</th><th>DEX</th><th>Premium</th><th>Liquidity</th><th></th>
					</tr></thead>
					<tbody>${arb
						.map(
							(r) => `<tr>
							<td class="left"><a href="/markets/robinhood/stock/${encodeURIComponent(r.symbol)}" class="hd-sym"><span class="sym">${esc(
								r.symbol,
							)}</span><span class="tag">${r.side === 'dex-rich' ? 'dex rich' : 'dex cheap'}</span></a></td>
							<td>${esc(formatPrice(r.navPriceUsd))}</td>
							<td>${esc(formatPrice(r.dexPriceUsd))}</td>
							<td class="${signClass(r.premiumPct)}">${esc(formatPercent(r.premiumPct))}</td>
							<td>${esc(formatUsd(r.liquidityUsd))}</td>
							<td><button class="hd-btn hd-btn-sm" type="button" data-action="trade" data-address="${esc(
								r.address,
							)}" data-symbol="${esc(r.symbol)}" data-kind="stock">Trade</button></td>
						</tr>`,
						)
				.join('')}</tbody></table></div>`
				: ''
		}`;
}

// ── positions ───────────────────────────────────────────────────────────────
function renderBook() {
	const el = document.getElementById('hd-book');
	if (!el) return;
	if (!state.address) {
		el.innerHTML =
			cardHead('Position ladder', 'priced live') +
			emptyState(
				'No book loaded',
				'Positions are priced against the Chainlink NAV feed for Stock Tokens and the deepest Uniswap pool for everything else. Load a wallet to see its ladder.',
				'Focus the address field',
				'focus-address',
			);
		return;
	}
	if (state.walletError) {
		el.innerHTML = cardHead('Position ladder', 'priced live') + errorState(state.walletError, 'reload-wallet');
		return;
	}
	if (!state.wallet) {
		el.innerHTML = cardHead('Position ladder', 'priced live') + skeleton(220);
		return;
	}
	const rows = state.wallet.positions || [];
	if (!rows.length) {
		el.innerHTML =
			cardHead('Position ladder', 'priced live') +
			emptyState(
				'No ERC-20 positions',
				`${esc(shortAddr(state.address))} holds ${esc(fmtEth(state.wallet.native?.balance))} and no indexed tokens on 4663. Buy a coin from the movers rail below and it lands here.`,
			);
		return;
	}

	// A dusted wallet can hold hundreds of airdropped tokens, and a 200-row table
	// buries the positions that carry the book. The deepest twelve render first;
	// the rest are one click away and the count never lies about what is there.
	const VISIBLE = 12;
	const shown = state.showAllPositions ? rows : rows.slice(0, VISIBLE);
	const hidden = rows.length - shown.length;
	const total = state.wallet.book?.positionCount ?? rows.length;

	el.innerHTML = `
		${cardHead(
			'Position ladder',
			`${total} position${total === 1 ? '' : 's'} · ${state.wallet.book?.pricedCount ?? 0} priced`,
		)}
		<div class="cv-table-wrap">
			<table class="hd-table">
				<thead><tr>
					<th class="left">Token</th><th>Amount</th><th>Price</th><th>Value</th><th>24h</th><th></th>
				</tr></thead>
				<tbody>
					${shown
						.map(
							(p) => `
						<tr>
							<td class="left">
								<span class="hd-sym"><span class="sym">${esc(p.symbol || shortAddr(p.address, 6, 4))}</span>${
									p.kind === 'stock' ? '<span class="tag">stock</span>' : ''
								}${p.priceSource === 'chainlink-nav' ? '<span class="tag">nav</span>' : ''}</span>
								<span class="hd-share" aria-hidden="true"><span style="width:${Math.max(
									2,
									Math.min(100, p.sharePct || 0),
								).toFixed(1)}%"></span></span>
							</td>
							<td>${esc(fmtAmount(p.amount))}</td>
							<td>${p.priceUsd != null ? esc(formatPrice(p.priceUsd)) : `<span class="hd-dim">unpriced</span>`}</td>
							<td>${p.valueUsd != null ? esc(formatUsd(p.valueUsd)) : DASH}</td>
							<td class="${signClass(p.change24hPct)}">${esc(formatPercent(p.change24hPct))}</td>
							<td><button class="hd-btn hd-btn-sm" type="button" data-action="trade" data-address="${esc(
								p.address,
							)}" data-symbol="${esc(p.symbol || '')}" data-decimals="${p.decimals ?? 18}" data-kind="${esc(
								p.kind,
							)}" data-pair="${esc(p.pairUrl || '')}">Trade</button></td>
						</tr>`,
						)
						.join('')}
				</tbody>
			</table>
		</div>
		${
			hidden > 0
				? `<button class="hd-btn hd-btn-sm" type="button" data-action="expand-positions" style="margin-top:0.75rem">Show ${hidden} smaller position${
						hidden === 1 ? '' : 's'
					}</button>`
				: ''
		}
		${
			state.wallet.positionsTruncated
				? `<p class="hd-note">Showing the deepest ${rows.length} of ${total} tokens this wallet holds, by value.</p>`
				: ''
		}`;
}

// ── counterparty flow ───────────────────────────────────────────────────────
function flowSvg(rows) {
	const width = 420;
	const rowH = 26;
	const height = Math.max(120, rows.length * rowH + 24);
	const leftX = 34;
	const rightX = 210;
	const cy = height / 2;
	const max = Math.max(...rows.map((r) => r.total), 1);

	return `
		<svg class="hd-flow-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Counterparties this wallet trades against">
			${rows
				.map((r, i) => {
					const y = 16 + i * rowH;
					const dominant = r.outCount >= r.inCount ? 'out' : 'in';
					const w = 1 + (r.total / max) * 2.5;
					return `
					<g class="hd-flow-row">
						<path class="hd-flow-arc ${dominant}" d="M${leftX} ${cy} C${(leftX + rightX) / 2} ${cy} ${
							(leftX + rightX) / 2
						} ${y} ${rightX} ${y}" stroke-width="${w.toFixed(2)}" />
						<circle class="hd-flow-node" cx="${rightX}" cy="${y}" r="3.5" />
						<text class="hd-flow-text strong" x="${rightX + 10}" y="${y + 3.5}">${esc(shortAddr(r.address, 8, 4))}</text>
						<text class="hd-flow-text" x="${width - 6}" y="${y + 3.5}" text-anchor="end">${r.outCount}↑ ${r.inCount}↓</text>
					</g>`;
				})
				.join('')}
			<circle class="hd-flow-node self" cx="${leftX}" cy="${cy}" r="6" />
			<text class="hd-flow-text strong" x="${leftX}" y="${cy + 22}" text-anchor="middle">you</text>
		</svg>`;
}

function renderFlow() {
	const el = document.getElementById('hd-flow');
	if (!el) return;
	if (!state.address) {
		el.innerHTML =
			cardHead('Counterparty flow', 'who you trade against') +
			emptyState(
				'No counterparties yet',
				'Every leg on the tape has another side: routers, pools, launchpads, people. Load a wallet and the desk ranks them by how much crossed between you.',
				'Focus the address field',
				'focus-address',
			);
		return;
	}
	if (state.walletError) {
		el.innerHTML = cardHead('Counterparty flow', 'who you trade against') + errorState(state.walletError, 'reload-wallet');
		return;
	}
	if (!state.wallet) {
		el.innerHTML = cardHead('Counterparty flow', 'who you trade against') + skeleton(200);
		return;
	}
	const rows = state.wallet.counterparties || [];
	if (!rows.length) {
		el.innerHTML =
			cardHead('Counterparty flow', 'who you trade against') +
			emptyState('Nothing has crossed with this wallet', 'Its first swap or transfer draws the first arc here.');
		return;
	}
	el.innerHTML = `
		${cardHead('Counterparty flow', `${rows.length} addresses`)}
		${flowSvg(rows)}
		<div class="cv-table-wrap" style="margin-top:0.5rem">
			<table class="hd-table">
				<thead><tr><th class="left">Counterparty</th><th>Legs</th><th class="left">Kinds</th></tr></thead>
				<tbody>
					${rows
						.map(
							(r) => `<tr>
						<td class="left"><a href="${esc(explorerAddress(r.address))}" target="_blank" rel="noopener noreferrer">${esc(
							r.name || shortAddr(r.address, 10, 6),
						)}</a></td>
						<td>${r.total}</td>
						<td class="left hd-dim">${esc(Object.keys(r.kinds || {}).join(', '))}</td>
					</tr>`,
						)
						.join('')}
				</tbody>
			</table>
		</div>`;
}

// ── movers rail ─────────────────────────────────────────────────────────────
function renderMovers() {
	const el = document.getElementById('hd-movers');
	if (!el) return;
	if (state.deskError) {
		el.innerHTML = cardHead('Movers', 'robinhood chain memecoins') + errorState(state.deskError, 'reload-desk');
		return;
	}
	if (!state.desk) {
		el.innerHTML =
			cardHead('Movers', 'robinhood chain memecoins') +
			`<div class="hd-rail">${Array.from({ length: 6 }).map(() => skeleton(96)).join('')}</div>`;
		return;
	}
	const movers = state.desk.movers || [];
	if (!movers.length) {
		el.innerHTML =
			cardHead('Movers', 'robinhood chain memecoins') +
			emptyState(
				'No ranked movers right now',
				'The screener ranks the Robinhood Chain meme category by absolute 24h move. It refills on the next upstream refresh.',
				'Reload market data',
				'reload-desk',
			);
		return;
	}
	el.innerHTML = `
		${cardHead('Movers', `${movers.length} by absolute 24h move`, `<a class="hd-btn hd-btn-sm hd-btn-ghost" href="/markets/robinhood">Full board</a>`)}
		<div class="hd-rail">
			${movers
				.map(
					(m) => `
				<a class="hd-mover" href="https://www.coingecko.com/en/coins/${esc(m.id)}" target="_blank" rel="noopener noreferrer">
					<span class="hd-mover-top">
						${m.image ? `<img src="${esc(m.image)}" alt="" loading="lazy" width="20" height="20" />` : ''}
						<span class="hd-mover-sym">${esc(m.symbol)}</span>
						<span class="hd-chg ${signClass(m.change24hPct)}">${esc(formatPercent(m.change24hPct))}</span>
					</span>
					<span class="hd-mover-price">${esc(formatPrice(m.priceUsd))}</span>
					${sparkline(m.sparkline7d || [])}
					<span class="hd-label">vol ${esc(formatUsd(m.volume24hUsd))}</span>
				</a>`,
				)
				.join('')}
		</div>`;
}

// ── trade ticket ────────────────────────────────────────────────────────────
async function openTrade(btn) {
	const dialog = document.getElementById('hd-trade-dialog');
	const body = document.getElementById('hd-trade-body');
	const title = document.getElementById('hd-trade-title');
	if (!dialog || !body) return;
	const symbol = btn.dataset.symbol || '';
	title.textContent = symbol ? `Trade ${symbol}` : 'Trade ticket';
	body.innerHTML = skeleton(160);
	if (typeof dialog.showModal === 'function') dialog.showModal();
	else dialog.show();
	try {
		// The swap panel pulls viem in with it, so it loads on the first ticket
		// rather than on every desk boot.
		const mod = await import('./robinhood-purchase.js');
		if (btn.dataset.kind === 'stock') {
			mod.mountStockEligibilityGate(body, {
				symbol,
				dexUrl: btn.dataset.pair || `https://dexscreener.com/robinhood/${btn.dataset.address}`,
			});
		} else {
			mod.mountBuyPanel(body, {
				address: btn.dataset.address,
				symbol,
				decimals: Number(btn.dataset.decimals) || 18,
			});
		}
	} catch (err) {
		body.innerHTML = `<div class="hd-error" role="alert"><span>The trade ticket could not load (${esc(
			err?.message || 'unknown error',
		)}). Reload the page and try again, or trade this token from its <a href="/markets/robinhood">market page</a>.</span></div>`;
	}
}

// ── loading ─────────────────────────────────────────────────────────────────
async function loadDesk(signal) {
	try {
		state.desk = await getJson('/api/v1/robinhood/desk', signal);
		state.deskError = null;
		if (state.bootBlock == null) state.bootBlock = state.desk.chain?.blockHeight ?? null;
	} catch (err) {
		if (err.name === 'AbortError') return;
		state.deskError = err.message || 'market data is unavailable right now';
	}
	state.lastTick = Date.now();
	renderStats();
	renderRidge();
	renderMovers();
	renderLive();
}

async function loadWallet(signal) {
	if (!state.address || state.loadingWallet) return;
	state.loadingWallet = true;
	try {
		state.wallet = await getJson(`/api/v1/robinhood/wallet?address=${encodeURIComponent(state.address)}`, signal);
		state.walletError = null;
	} catch (err) {
		if (err.name === 'AbortError') return;
		state.walletError = err.message || 'this wallet could not be read right now';
	} finally {
		state.loadingWallet = false;
	}
	renderStats();
	renderBalance();
	renderTape();
	renderBook();
	renderFlow();
}

function renderLive() {
	const pill = document.getElementById('hd-live');
	const text = document.getElementById('hd-live-text');
	if (!pill || !text) return;
	const fresh = state.lastTick && Date.now() - state.lastTick < DESK_REFRESH_MS * 2 && !state.deskError;
	pill.dataset.state = fresh ? 'live' : 'stale';
	text.textContent = fresh ? 'live' : state.deskError ? 'offline' : 'booting';
}

function renderClock() {
	const el = document.getElementById('hd-clock');
	if (!el) return;
	const secs = Math.floor((Date.now() - state.bootedAt) / 1000);
	const mm = String(Math.floor(secs / 60)).padStart(2, '0');
	const ss = String(secs % 60).padStart(2, '0');
	const height = state.desk?.chain?.blockHeight;
	const blocks = height != null && state.bootBlock != null ? height - state.bootBlock : null;
	el.textContent = blocks != null && blocks > 0 ? `${mm}:${ss} / +${blocks.toLocaleString('en-US')} blocks` : `${mm}:${ss}`;
}

function renderIdentity() {
	const sub = document.getElementById('hd-brand-sub');
	const input = document.getElementById('hd-address');
	if (sub) sub.textContent = state.address ? `/ ${shortAddr(state.address)}` : '/ no wallet';
	if (input && state.address && input.value !== state.address) input.value = state.address;
}

function setAddress(next, { push = true } = {}) {
	const addr = String(next || '').trim();
	if (!ADDRESS_RE.test(addr)) return false;
	state.address = addr.toLowerCase();
	state.wallet = null;
	state.walletError = null;
	state.seen = new Set();
	state.showAllPositions = false;
	try {
		localStorage.setItem(STORAGE_KEY, state.address);
	} catch {
		/* private mode: the address still works for this session */
	}
	if (push) {
		const url = new URL(location.href);
		url.searchParams.set('address', state.address);
		history.replaceState(null, '', url);
	}
	renderIdentity();
	renderStats();
	renderBalance();
	renderTape();
	renderBook();
	renderFlow();
	return true;
}

function showAlert(message, kind = 'error') {
	const el = document.getElementById('hd-alert');
	if (!el) return;
	if (!message) {
		el.hidden = true;
		el.innerHTML = '';
		return;
	}
	el.hidden = false;
	el.innerHTML = `<div class="hd-error" role="alert" style="margin-bottom:0.875rem;${
		kind === 'info' ? 'border-color:var(--cv-border);background:var(--cv-surface-2);color:var(--cv-text-2)' : ''
	}"><span>${esc(message)}</span></div>`;
}

async function connectWallet() {
	const btn = document.getElementById('hd-connect');
	if (!window.ethereum) {
		showAlert('No injected wallet found in this browser. Paste an address instead, or install an EVM wallet extension.');
		return;
	}
	btn.disabled = true;
	try {
		const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
		const [addr] = accounts || [];
		if (!addr) throw new Error('the wallet returned no account');
		showAlert(null);
		setAddress(addr);
		await loadWallet();
	} catch (err) {
		showAlert(`Wallet connect failed: ${err?.message || 'unknown error'}`);
	} finally {
		btn.disabled = false;
	}
}

// ── boot ────────────────────────────────────────────────────────────────────
function init({ signal }) {
	state.bootedAt = Date.now();
	state.desk = null;
	state.wallet = null;
	state.deskError = null;
	state.walletError = null;
	state.bootBlock = null;

	const params = new URLSearchParams(location.search);
	let initial = params.get('address');
	if (!ADDRESS_RE.test(initial || '')) {
		try {
			initial = localStorage.getItem(STORAGE_KEY);
		} catch {
			initial = null;
		}
	}
	state.address = ADDRESS_RE.test(initial || '') ? initial.toLowerCase() : null;

	renderIdentity();
	renderStats();
	renderBalance();
	renderTape();
	renderRidge();
	renderBook();
	renderFlow();
	renderMovers();
	renderClock();

	const form = document.getElementById('hd-address-form') || document.getElementById('hd-wallet-form');
	form?.addEventListener(
		'submit',
		(ev) => {
			ev.preventDefault();
			const input = document.getElementById('hd-address');
			if (!setAddress(input.value)) {
				showAlert('That is not a Robinhood Chain address. Paste a 20-byte 0x address.');
				input.focus();
				return;
			}
			showAlert(null);
			loadWallet(signal);
		},
		{ signal },
	);

	document.getElementById('hd-connect')?.addEventListener('click', connectWallet, { signal });
	document.getElementById('hd-trade-close')?.addEventListener(
		'click',
		() => document.getElementById('hd-trade-dialog')?.close(),
		{ signal },
	);

	document.getElementById('hd-main')?.addEventListener(
		'click',
		(ev) => {
			const btn = ev.target.closest('[data-action]');
			if (!btn) return;
			const action = btn.dataset.action;
			if (action === 'focus-address') document.getElementById('hd-address')?.focus();
			else if (action === 'reload-desk') {
				state.deskError = null;
				renderRidge();
				renderMovers();
				loadDesk(signal);
			} else if (action === 'reload-wallet') {
				state.walletError = null;
				renderBalance();
				renderTape();
				renderBook();
				renderFlow();
				loadWallet(signal);
			} else if (action === 'expand-positions') {
				state.showAllPositions = true;
				renderBook();
			} else if (action === 'trade') openTrade(btn);
		},
		{ signal },
	);

	loadDesk(signal);
	if (state.address) loadWallet(signal);

	const clockTimer = setInterval(renderClock, 1000);
	const deskTimer = setInterval(() => {
		if (document.hidden) return;
		loadDesk(signal);
	}, DESK_REFRESH_MS);
	const walletTimer = setInterval(() => {
		if (document.hidden || !state.address) return;
		loadWallet(signal);
	}, WALLET_REFRESH_MS);

	signal.addEventListener('abort', () => {
		clearInterval(clockTimer);
		clearInterval(deskTimer);
		clearInterval(walletTimer);
	});
}

onPageReady(init, { match: (path) => /^\/markets\/robinhood\/desk\/?$/.test(path) });
