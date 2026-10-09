// /markets/robinhood/paired/:address: one paired coin on Robinhood Chain.
//
// Data: GET /api/v1/robinhood/paired-coins-detail?address=&interval= returns
// the coin's pools (read live from the launchpad, priced in dollars), its
// verified descriptor, the launching agent, recent trades and candles per
// pool. The chart and the trade ticket follow the selected pool; trades refresh
// every 15 seconds while the tab is visible.

import { createChart, CandlestickSeries, HistogramSeries, CrosshairMode } from 'lightweight-charts';
import { ago, amount, classChip, coinLogo, esc, explainLoad, getJson, pct, short, usd } from './common.js';
import { mountTicket } from './trade.js';

const $ = (s, r = document) => r.querySelector(s);
const ADDR_RE = /^\/markets\/robinhood\/paired\/(0x[0-9a-fA-F]{40})\/?$/;
const EXPLORER = 'https://robinhoodchain.blockscout.com';
const REFRESH_MS = 15_000;

const state = { address: null, coin: null, error: '', pool: 0, interval: '1h', ticket: null, chart: null, candle: null, volume: null };

function cssVar(name, fallback) {
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function renderSkeleton() {
	$('#pc-head').innerHTML = '<div class="ch-hero"><div class="cv-skel" style="width:16rem;height:2.5rem"></div><div class="cv-skel" style="width:22rem;height:1.25rem;margin-top:0.75rem"></div></div>';
	$('#pc-pools').innerHTML = `<div class="pc-pools">${Array.from({ length: 2 }, () => '<div class="cv-skel" style="height:150px;border-radius:14px"></div>').join('')}</div>`;
	$('#pc-rail').innerHTML = '<div class="cv-skel" style="height:340px;border-radius:14px"></div>';
}

function renderError() {
	const notCoin = /not a coin/i.test(state.error);
	$('#pc-head').innerHTML = `<div class="pc-empty" role="alert">
		<h2>${notCoin ? 'Not a paired coin' : 'Could not load this coin'}</h2>
		<p>${esc(notCoin ? `${state.address} is not a coin on the paired launchpad. It may be a regular Robinhood Chain token.` : state.error)}</p>
		<div class="pc-hero-actions" style="justify-content:center">
			${notCoin ? `<a class="pc-btn" href="/markets/robinhood/coin/${esc(state.address)}">Open as a Robinhood Chain coin</a>` : '<button type="button" class="pc-btn" id="pc-retry">Try again</button>'}
			<a class="pc-btn" href="/markets/robinhood/paired">All paired coins</a>
		</div>
	</div>`;
	$('#pc-retry')?.addEventListener('click', () => load(true));
	$('#pc-pools').innerHTML = '';
	$('#pc-chart-wrap').hidden = true;
	$('#pc-trades').innerHTML = '';
	$('#pc-rail').innerHTML = '';
}

function renderHead(c) {
	document.title = `${c.name} ($${c.symbol}) · Paired coin · three.ws`;
	$('#pc-crumb').textContent = `$${c.symbol}`;
	const d = c.descriptor;
	const links = [
		d?.links?.website && `<a class="pc-btn" href="${esc(d.links.website)}" target="_blank" rel="noopener noreferrer">Website ↗</a>`,
		d?.links?.twitter && `<a class="pc-btn" href="${esc(d.links.twitter)}" target="_blank" rel="noopener noreferrer">X ↗</a>`,
		d?.links?.telegram && `<a class="pc-btn" href="${esc(d.links.telegram)}" target="_blank" rel="noopener noreferrer">Telegram ↗</a>`,
		`<a class="pc-btn" href="${EXPLORER}/token/${esc(c.address)}" target="_blank" rel="noopener noreferrer">Explorer ↗</a>`,
	].filter(Boolean);
	const by = c.agent
		? `<a class="pc-agent" href="${esc(c.agent.url)}">${c.agent.avatar ? `<img src="${esc(c.agent.avatar)}" alt="" />` : '<span class="pc-agent-dot"></span>'}<span>Launched by ${esc(c.agent.name || 'an agent')}</span></a>`
		: `<span class="pc-agent"><span>Created by <a href="${EXPLORER}/address/${esc(c.creator)}" target="_blank" rel="noopener noreferrer"><code>${esc(short(c.creator))}</code></a></span></span>`;
	const verified = d
		? d.verified
			? '<span class="ch-chip" title="The descriptor hashes to the commitment the coin stored on chain">Metadata verified</span>'
			: '<span class="ch-chip" title="The descriptor does not hash to the on-chain commitment">Metadata unverified</span>'
		: '';
	$('#pc-head').innerHTML = `
	<div class="ch-hero">
		<div class="ch-title-row" style="gap:0.875rem">
			${coinLogo(c, 56)}
			<div>
				<h1 class="ch-title" style="margin:0">${esc(c.name)}</h1>
				<div style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;margin-top:0.35rem">
					<span class="cv-rank-badge">$${esc(c.symbol)}</span>
					${verified}
					${by}
				</div>
			</div>
		</div>
		<div class="cv-price-row" style="margin-top:0.875rem">
			<span class="cv-price cv-mono">${esc(usd(c.marketCapUsd))}</span>
			<span class="cv-sub">market cap · ${c.pairs.length} ${c.pairs.length === 1 ? 'pool' : 'pools'} · ${esc(c.tradeCount)} ${c.tradeCount === 1 ? 'trade' : 'trades'}</span>
		</div>
		${d?.description ? `<p class="pc-hero-lede">${esc(d.description)}</p>` : ''}
		<div class="pc-hero-actions">
			${links.join('')}
			<button type="button" class="pc-btn" id="pc-copy" data-copy="${esc(c.address)}" aria-label="Copy contract address"><code>${esc(short(c.address))}</code> Copy</button>
		</div>
	</div>`;
	$('#pc-copy').addEventListener('click', async (e) => {
		const btn = e.currentTarget;
		try {
			await navigator.clipboard.writeText(btn.dataset.copy);
			btn.innerHTML = 'Copied';
		} catch {
			btn.innerHTML = esc(btn.dataset.copy);
		}
	});
}

function renderPools(c) {
	$('#pc-pools').innerHTML = `<div class="pc-pools" role="group" aria-label="Pools">${c.pairs
		.map(
			(p, i) => `<button type="button" class="pc-pool" data-pool="${i}" aria-pressed="${i === state.pool}">
			<div class="pc-pool-head"><strong>${esc(p.quoteSymbol)}</strong>${classChip(p.quoteClass)}</div>
			<dl>
				<dt>Share of supply</dt><dd>${esc(pct(p.weightBps))}</dd>
				<dt>Price</dt><dd>${esc(amount(p.price))} ${esc(p.quoteSymbol)}</dd>
				<dt>In dollars</dt><dd>${esc(usd(p.priceUsd, { compact: false }))}</dd>
				<dt>Raised</dt><dd>${esc(amount(p.raised))} ${esc(p.quoteSymbol)}</dd>
				<dt>Sold</dt><dd>${esc(amount(p.soldPct, 2))}%</dd>
			</dl>
			<div class="pc-progress" aria-hidden="true"><span style="width:${Math.min(100, p.soldPct)}%"></span></div>
		</button>`,
		)
		.join('')}</div>
		<p class="pc-fine" style="margin-top:0.5rem">Each pool is its own bonding curve with liquidity locked forever. Swap fee ${esc(pct(c.terms.swapFeeBps))}, of which ${esc(pct(c.terms.creatorShareBps))} goes to the creator.</p>`;
	$('#pc-pools').querySelectorAll('[data-pool]').forEach((b) =>
		b.addEventListener('click', () => {
			if (state.pool === Number(b.dataset.pool)) return;
			state.pool = Number(b.dataset.pool);
			renderPools(state.coin);
			renderChart(state.coin);
			state.ticket?.poolChanged();
		}),
	);
}

function ensureChart() {
	if (state.chart) return;
	const el = $('#pc-chart');
	const text = cssVar('--cv-text-3', '#8b8f9a');
	const grid = cssVar('--cv-border', 'rgba(127,127,127,0.15)');
	state.chart = createChart(el, {
		autoSize: true,
		layout: { background: { color: 'transparent' }, textColor: text, fontFamily: cssVar('--cv-font-mono', 'ui-monospace, monospace') },
		grid: { vertLines: { color: grid }, horzLines: { color: grid } },
		crosshair: { mode: CrosshairMode.Normal },
		rightPriceScale: { borderColor: grid, scaleMargins: { top: 0.1, bottom: 0.25 } },
		timeScale: { borderColor: grid, timeVisible: true, secondsVisible: false },
	});
	const up = cssVar('--cv-chart-green', '#22c55e');
	const down = cssVar('--cv-chart-red', '#ef4444');
	state.candle = state.chart.addSeries(CandlestickSeries, {
		upColor: up,
		downColor: down,
		borderUpColor: up,
		borderDownColor: down,
		wickUpColor: up,
		wickDownColor: down,
		priceFormat: { type: 'custom', formatter: (v) => amount(v), minMove: 1e-12 },
	});
	state.volume = state.chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', priceLineVisible: false, lastValueVisible: false });
	state.chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
}

function renderChart(c) {
	$('#pc-chart-wrap').hidden = false;
	const p = c.pairs[state.pool];
	$('#pc-intervals').innerHTML = c.intervals
		.map((k) => `<button type="button" class="pc-tab" role="tab" data-interval="${k}" aria-selected="${k === state.interval}">${k}</button>`)
		.join('');
	$('#pc-chart-title').textContent = `$${c.symbol} / ${p.quoteSymbol}`;
	const empty = $('#pc-chart-empty');
	if (!p.candles.length) {
		empty.hidden = false;
		empty.innerHTML = `<strong>No trades in the ${esc(p.quoteSymbol)} pool yet</strong><span>The curve opens at ${esc(amount(p.price))} ${esc(p.quoteSymbol)} per coin (${esc(usd(p.priceUsd, { compact: false }))}). The first buy draws the first candle.</span>`;
		state.candle?.setData([]);
		state.volume?.setData([]);
		return;
	}
	empty.hidden = true;
	ensureChart();
	const up = cssVar('--cv-chart-green', '#22c55e');
	const down = cssVar('--cv-chart-red', '#ef4444');
	state.candle.setData(p.candles.map((k) => ({ time: k.time, open: k.open, high: k.high, low: k.low, close: k.close })));
	state.volume.setData(p.candles.map((k) => ({ time: k.time, value: k.volume, color: `${k.close >= k.open ? up : down}66` })));
	state.chart.timeScale().fitContent();
}

function renderTrades(c) {
	if (!c.trades.length) {
		$('#pc-trades').innerHTML = `<div class="pc-empty"><h3>No trades yet</h3><p>Trades on any of this coin's pools appear here as they land on chain.</p></div>`;
		return;
	}
	$('#pc-trades').innerHTML = `<div class="cv-table-wrap"><table class="pc-trades">
		<thead><tr><th scope="col">Side</th><th scope="col">Pool</th><th scope="col" class="num">Coins</th><th scope="col" class="num">Paid / received</th><th scope="col">Trader</th><th scope="col">When</th></tr></thead>
		<tbody>${c.trades
			.map(
				(t) => `<tr>
			<td class="${t.isBuy ? 'pc-buy' : 'pc-sell'}">${t.isBuy ? 'Buy' : 'Sell'}</td>
			<td>${esc(t.quoteSymbol)}</td>
			<td class="num">${esc(amount(t.tokenAmount, 2))}</td>
			<td class="num">${esc(amount(t.quoteAmount))} ${esc(t.quoteSymbol)}</td>
			<td><a href="${EXPLORER}/address/${esc(t.trader)}" target="_blank" rel="noopener noreferrer"><code>${esc(short(t.trader))}</code></a></td>
			<td><a href="${EXPLORER}/tx/${esc(t.txHash)}" target="_blank" rel="noopener noreferrer">${esc(ago(t.time))}</a></td>
		</tr>`,
			)
			.join('')}</tbody></table></div>
		${c.tradeCount > c.trades.length ? `<p class="pc-fine">Showing the latest ${c.trades.length} of ${c.tradeCount} trades.</p>` : ''}`;
}

async function load(first) {
	if (first) renderSkeleton();
	try {
		const coin = await getJson(`/api/v1/robinhood/paired-coins-detail?address=${state.address}&interval=${state.interval}`);
		state.error = '';
		state.coin = coin;
		if (state.pool >= coin.pairs.length) state.pool = 0;
		renderHead(coin);
		renderPools(coin);
		renderChart(coin);
		renderTrades(coin);
		if (!state.ticket) state.ticket = mountTicket($('#pc-rail'), { coin, getPool: () => state.coin.pairs[state.pool], onTraded: () => load(false) });
	} catch (err) {
		if (!first && state.coin) return;
		state.error = explainLoad(err);
		renderError();
	} finally {
		$('#main-content').setAttribute('aria-busy', 'false');
	}
}

function boot() {
	const m = location.pathname.match(ADDR_RE);
	state.address = m ? m[1] : null;
	if (!state.address) {
		state.error = 'That is not a valid coin address.';
		renderError();
		return;
	}
	$('#pc-intervals').addEventListener('click', (e) => {
		const tab = e.target.closest('[data-interval]');
		if (!tab || tab.dataset.interval === state.interval) return;
		state.interval = tab.dataset.interval;
		load(false);
	});
	load(true);
	setInterval(() => {
		if (document.visibilityState === 'visible' && state.coin) load(false);
	}, REFRESH_MS);
}

boot();
