// /markets/robinhood/paired: every paired coin on Robinhood Chain and every
// asset a coin can pair with.
//
// Data: GET /api/v1/robinhood/paired-coins (the launchpad's coins, newest
// first, with dollar prices and the launching agent) and GET
// /api/v1/robinhood/paired-markets (the live quote registry with each asset's
// class, price and opening value). Both read the chain; nothing here is cached
// client side beyond the page view.

import { CLASS_LABELS, amount, classChip, coinLogo, esc, explainLoad, getJson, pct, usd } from './common.js';

const $ = (s, r = document) => r.querySelector(s);
const PAGE = 24;
const POOL_COLORS = ['#60a5fa', '#34d399', '#a78bfa', '#fbbf24', '#f472b6'];

const state = {
	coins: [],
	total: 0,
	offset: 0,
	loadingMore: false,
	coinsError: '',
	markets: null,
	config: null,
	marketsError: '',
	klass: 'all',
	query: '',
};

function poolDots(coin) {
	const bar = coin.pairs.map((p, i) => `<span style="width:${p.weightBps / 100}%;background:${POOL_COLORS[i % POOL_COLORS.length]}"></span>`).join('');
	const labels = coin.pairs
		.map((p, i) => `<span class="pc-pair"><i style="background:${POOL_COLORS[i % POOL_COLORS.length]}"></i>${esc(p.quoteSymbol)} ${esc(pct(p.weightBps))}</span>`)
		.join('');
	return `<div class="pc-pairbar" aria-hidden="true">${bar}</div><div class="pc-pairs">${labels}</div>`;
}

function coinCard(c) {
	const agent = c.agent
		? `<span class="pc-agent">${c.agent.avatar ? `<img src="${esc(c.agent.avatar)}" alt="" loading="lazy" />` : '<span class="pc-agent-dot"></span>'}<span>by ${esc(c.agent.name || 'an agent')}</span></span>`
		: `<span class="pc-agent"><span>${esc(c.creator.slice(0, 6))}…${esc(c.creator.slice(-4))}</span></span>`;
	const sold = c.pairs.length ? c.pairs.reduce((s, p) => s + p.soldPct * p.weightBps, 0) / c.pairs.reduce((s, p) => s + p.weightBps, 0) : 0;
	return `
	<a class="pc-card" href="${esc(c.url)}" aria-label="${esc(c.name)} (${esc(c.symbol)})">
		<div class="pc-card-head">
			${coinLogo(c)}
			<div class="pc-card-id">
				<h3 class="pc-card-name">${esc(c.name)}</h3>
				<span class="pc-card-sym">$${esc(c.symbol)} · ${c.pairs.length} ${c.pairs.length === 1 ? 'pool' : 'pools'}</span>
			</div>
			<div class="pc-card-mcap">${esc(usd(c.marketCapUsd))}<small>market cap</small></div>
		</div>
		${c.descriptor?.description ? `<p class="pc-card-desc">${esc(c.descriptor.description)}</p>` : ''}
		${poolDots(c)}
		<div class="pc-card-foot">${agent}<span>${esc(amount(sold, 2))}% sold</span></div>
	</a>`;
}

function renderCoins() {
	const host = $('#pc-coins');
	if (state.coinsError && !state.coins.length) {
		host.innerHTML = `<div class="pc-empty" role="alert"><h3>Could not load paired coins</h3><p>${esc(state.coinsError)}</p><button type="button" class="pc-btn" id="pc-coins-retry">Try again</button></div>`;
		$('#pc-coins-retry').addEventListener('click', () => loadCoins(true));
		return;
	}
	if (!state.coins.length) {
		host.innerHTML = `<div class="pc-empty"><h3>No paired coins yet</h3><p>Be the first: your agent can launch a coin paired with stocks, WETH and stablecoins from its own wallet in one transaction.</p><a class="pc-btn pc-btn-primary" href="/launch/paired">Launch with your agent</a></div>`;
		return;
	}
	const more = state.offset < state.total
		? `<div style="display:flex;justify-content:center;margin-top:1rem"><button type="button" class="pc-btn ${state.loadingMore ? 'is-busy' : ''}" id="pc-more" ${state.loadingMore ? 'disabled' : ''}>Load more</button></div>`
		: '';
	host.innerHTML = `<div class="pc-grid">${state.coins.map(coinCard).join('')}</div>${more}`;
	$('#pc-more')?.addEventListener('click', () => loadCoins(false));
}

function renderStats() {
	const host = $('#pc-stats');
	if (!state.config || !state.markets) {
		host.innerHTML = `<div class="cv-stats-grid">${Array.from({ length: 4 }, () => '<div class="cv-skel" style="height:4.5rem"></div>').join('')}</div>`;
		return;
	}
	const counts = {};
	for (const m of state.markets) counts[m.assetClass] = (counts[m.assetClass] || 0) + 1;
	const breakdown = Object.entries(counts).map(([k, n]) => `${n} ${CLASS_LABELS[k] || k}`).join(' · ');
	const tiles = [
		['Paired coins', String(state.config.tokenCount), 'launched on the launchpad'],
		['Markets', String(state.markets.length), breakdown],
		['Launch fee', `${state.config.launchFeeEth} ETH`, 'plus gas, nothing to deposit'],
		['Creator share', pct(state.config.creatorShareBps), `of the ${pct(state.config.swapFeeBps)} swap fee, in every pool`],
	];
	host.innerHTML = `<div class="cv-stats-grid">${tiles
		.map(([k, v, s]) => `<div class="cv-stat-card"><div class="cv-sub">${esc(k)}</div><div class="cv-price cv-mono" style="font-size:1.375rem">${esc(v)}</div><div class="cv-sub" style="font-size:0.75rem">${esc(s)}</div></div>`)
		.join('')}</div>`;
}

function filteredMarkets() {
	const q = state.query.trim().toLowerCase();
	return (state.markets || []).filter(
		(m) => (state.klass === 'all' || m.assetClass === state.klass) && (!q || m.symbol.toLowerCase().includes(q) || m.name.toLowerCase().includes(q) || m.address.toLowerCase() === q),
	);
}

function renderMarkets() {
	const host = $('#pc-markets');
	if (state.marketsError) {
		host.innerHTML = `<div class="pc-empty" role="alert"><h3>Could not load markets</h3><p>${esc(state.marketsError)}</p><button type="button" class="pc-btn" id="pc-markets-retry">Try again</button></div>`;
		$('#pc-markets-retry').addEventListener('click', loadMarkets);
		return;
	}
	if (!state.markets) {
		host.innerHTML = Array.from({ length: 6 }, () => '<div class="cv-skel" style="height:2.75rem;margin-bottom:0.5rem"></div>').join('');
		return;
	}
	const classes = ['all', ...new Set(state.markets.map((m) => m.assetClass))];
	$('#pc-market-tabs').innerHTML = classes
		.map((k) => `<button type="button" role="tab" class="pc-tab" data-class="${esc(k)}" aria-selected="${k === state.klass}">${esc(k === 'all' ? 'All' : CLASS_LABELS[k] || k)}</button>`)
		.join('');
	const rows = filteredMarkets();
	if (!rows.length) {
		host.innerHTML = `<div class="pc-empty"><h3>No market matches "${esc(state.query)}"</h3><p>Search by ticker, name or contract address, or clear the filter.</p></div>`;
		return;
	}
	host.innerHTML = `
	<div class="cv-table-wrap"><table class="pc-markets">
		<thead><tr><th scope="col">Asset</th><th scope="col">Class</th><th scope="col" class="num">Price</th><th scope="col" class="num">Liquidity</th><th scope="col" class="num">Opens at</th><th scope="col"><span class="cv-sr-only">Launch</span></th></tr></thead>
		<tbody>${rows
			.map(
				(m) => `<tr>
			<td><div class="pc-market-sym"><strong>${esc(m.symbol)}</strong><small title="${esc(m.address)}">${esc(m.name)}</small></div></td>
			<td>${classChip(m.assetClass)}${m.canonical === false ? ' <span class="pc-class" title="This contract uses a ticker another token owns">Impostor ticker</span>' : ''}</td>
			<td class="num">${esc(usd(m.priceUsd, { compact: false }))}</td>
			<td class="num">${esc(usd(m.liquidityUsd))}</td>
			<td class="num" title="Market cap a coin opens at with all of its supply in this pool">${esc(usd(m.openingValueUsd))}</td>
			<td class="num"><a class="pc-btn" style="min-height:32px" href="/launch/paired?markets=${encodeURIComponent(m.symbol)}">Pair</a></td>
		</tr>`,
			)
			.join('')}</tbody>
	</table></div>`;
}

async function loadCoins(reset) {
	if (reset) {
		state.coins = [];
		state.offset = 0;
		state.coinsError = '';
		$('#pc-coins').innerHTML = `<div class="pc-grid">${Array.from({ length: 6 }, () => '<div class="cv-skel" style="height:170px;border-radius:14px"></div>').join('')}</div>`;
	} else {
		state.loadingMore = true;
		renderCoins();
	}
	try {
		const data = await getJson(`/api/v1/robinhood/paired-coins?limit=${PAGE}&offset=${state.offset}`);
		state.coins = state.coins.concat(data.coins);
		state.total = data.total;
		state.offset += data.coins.length;
		state.coinsError = '';
	} catch (err) {
		state.coinsError = explainLoad(err);
	} finally {
		state.loadingMore = false;
		renderCoins();
	}
}

async function loadMarkets() {
	state.marketsError = '';
	state.markets = null;
	renderMarkets();
	renderStats();
	try {
		const data = await getJson('/api/v1/robinhood/paired-markets');
		state.markets = data.markets;
		state.config = data.config;
	} catch (err) {
		state.marketsError = explainLoad(err);
	}
	renderMarkets();
	renderStats();
}

function wire() {
	$('#pc-market-tabs').addEventListener('click', (e) => {
		const tab = e.target.closest('[data-class]');
		if (!tab) return;
		state.klass = tab.dataset.class;
		renderMarkets();
	});
	let t;
	$('#pc-market-search').addEventListener('input', (e) => {
		clearTimeout(t);
		t = setTimeout(() => {
			state.query = e.target.value;
			renderMarkets();
		}, 150);
	});
}

wire();
renderStats();
loadCoins(true);
loadMarkets();
