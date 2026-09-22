// /data-desk: market data BOUGHT by brand-new agent wallets over x402, each
// dataset shown with the receipt that paid for it.
//
// Feed: GET /api/data-desk (x402_data_desk, newest purchase per dataset plus a
// ledger of recent purchases and the fresh-wallet lane's statistics). Every
// card renders the dataset's payload with a renderer chosen by slug, and its
// provenance: price paid, the paying wallet (always a fresh wallet: minted for
// this one purchase and closed after), and the Solana settlement signature.
//
// The feed is honest by design: no synthetic entries, so before the first
// purchase settles the page shows the designed empty state instead.

const FEED_URL = '/api/data-desk';
const REFRESH_MS = 60_000;

const els = {
	stats: document.querySelector('[data-role="stats"]'),
	grid: document.querySelector('[data-role="grid"]'),
	loading: document.querySelector('[data-role="loading"]'),
	empty: document.querySelector('[data-role="empty"]'),
	emptySearch: document.querySelector('[data-role="empty-search"]'),
	error: document.querySelector('[data-role="error"]'),
	errorMsg: document.querySelector('[data-role="error-msg"]'),
	search: document.querySelector('[data-role="search"]'),
	count: document.querySelector('[data-role="count"]'),
	clearSearch: document.querySelector('[data-role="clear-search"]'),
	retry: document.querySelector('[data-role="retry"]'),
	ledgerSection: document.querySelector('[data-role="ledger-section"]'),
	ledger: document.querySelector('[data-role="ledger"]'),
};

const state = { datasets: [], recent: [], stats: null, query: '', timer: null };

function escapeHtml(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) =>
		({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const escapeAttr = escapeHtml;
function show(el, on) { if (el) el.hidden = !on; }

// ── Formatting ────────────────────────────────────────────────────────────────

function fmtUsd(n, { compact = true } = {}) {
	const v = Number(n);
	if (!Number.isFinite(v)) return null;
	if (compact && Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
	if (compact && Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
	if (compact && Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
	if (compact && Math.abs(v) >= 1e4) return `$${(v / 1e3).toFixed(0)}K`;
	if (Math.abs(v) >= 1) return `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
	return `$${v.toPrecision(3)}`;
}
function fmtNum(n, digits = 1) {
	const v = Number(n);
	if (!Number.isFinite(v)) return null;
	if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(digits)}B`;
	if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(digits)}M`;
	if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(digits)}K`;
	return v.toLocaleString(undefined, { maximumFractionDigits: digits });
}
function fmtPct(n) {
	const v = Number(n);
	if (!Number.isFinite(v)) return '';
	const cls = v > 0 ? 'dd-up' : v < 0 ? 'dd-down' : '';
	return `<span class="${cls}">${v > 0 ? '+' : ''}${v.toFixed(1)}%</span>`;
}
function fmtUsdc(n) {
	if (n == null || !Number.isFinite(Number(n))) return null;
	const v = Number(n);
	return v < 0.01 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`;
}
function fmtWhen(ts) {
	const d = new Date(ts);
	if (Number.isNaN(d.getTime())) return '';
	const mins = Math.round((Date.now() - d.getTime()) / 60000);
	if (mins < 1) return 'just now';
	if (mins < 60) return `${mins}m ago`;
	if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
	return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function fmtTime(ts) {
	const d = new Date(ts);
	return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// ── Payload renderers (one per dataset, generic fallback) ────────────────────

const kv = (pairs, cols = 2) => `<div class="dd-kv${cols === 3 ? ' dd-kv--3' : ''}">${pairs
	.filter(([, v]) => v != null && v !== '')
	.map(([k, v]) => `<div><div class="dd-k">${escapeHtml(k)}</div><div class="dd-v">${v}</div></div>`)
	.join('')}</div>`;

const rows = (items, { name, value, delta, max = 5 }) => {
	const list = (Array.isArray(items) ? items : []).slice(0, max);
	if (!list.length) return '';
	return `<div class="dd-rows">${list.map((it, i) => `
		<div class="dd-row">
			<span class="dd-row-rank">${i + 1}</span>
			<span class="dd-row-name" title="${escapeAttr(name(it))}">${escapeHtml(name(it))}</span>
			${value ? `<span class="dd-row-val">${value(it) ?? ''}</span>` : ''}
			${delta ? `<span class="dd-row-delta">${delta(it) ?? ''}</span>` : ''}
		</div>`).join('')}</div>`;
};

const pick = (o, ...keys) => { for (const k of keys) if (o && o[k] != null) return o[k]; return null; };

const RENDERERS = {
	'market-global': (p) => {
		const m = p.market || p.global || p;
		const fg = p.fear_greed || {};
		const fgv = Number(fg.value);
		return kv([
			['Market cap', fmtUsd(pick(m, 'total_market_cap', 'market_cap'))],
			['24h volume', fmtUsd(pick(m, 'total_volume_24h', 'volume_24h'))],
			['Top-coin dominance', m.btc_dominance != null ? `${Number(m.btc_dominance).toFixed(1)}%` : null],
			['Fear & Greed', Number.isFinite(fgv) ? `${fgv}<small>${escapeHtml(fg.label || '')}</small>` : null],
		]) + (Number.isFinite(fgv) ? `<div class="dd-bar" title="Fear & Greed ${fgv}"><i style="width:${Math.max(2, Math.min(100, fgv))}%"></i></div>` : '');
	},
	'market-pulse': (p) => {
		const g = p.global || {};
		const fg = p.fear_greed || {};
		return kv([
			['Market cap', fmtUsd(g.total_market_cap)],
			['Top-coin dominance', g.btc_dominance != null ? `${Number(g.btc_dominance).toFixed(1)}%` : null],
			['Fear & Greed', fg.value != null ? `${escapeHtml(fg.value)}<small>${escapeHtml(fg.label || '')}</small>` : null],
			['DeFi TVL', fmtUsd(p.defi?.total_tvl)],
			['Stablecoins', fmtUsd(p.stablecoins?.total_mcap)],
			['Gas, standard', p.gas?.standard_gwei != null ? `${Number(p.gas.standard_gwei).toFixed(1)}<small>gwei</small>` : null],
		], 3) + rows(p.top_coins, { name: (c) => `${c.symbol || c.id}`, value: (c) => fmtUsd(c.price, { compact: false }), delta: (c) => fmtPct(c.change_24h) });
	},
	'market-trending': (p) => rows(p.coins, {
		name: (c) => `${c.symbol || c.id}${c.name ? ` · ${c.name}` : ''}`,
		value: (c) => fmtUsd(pick(c, 'price_usd', 'price'), { compact: false }),
		delta: (c) => fmtPct(pick(c, 'change_24h_pct', 'change_24h')),
	}) + (Array.isArray(p.categories) && p.categories.length
		? `<div class="dd-k" style="margin-top:6px">Trending categories</div>` + rows(p.categories, { name: (c) => c.name || c.slug, delta: (c) => fmtPct(pick(c, 'mcap_change_1h_pct', 'change_1h')), max: 3 })
		: ''),
	'market-gas': (p) => {
		const tiers = Array.isArray(p.tiers) ? p.tiers : [];
		const tier = (k) => tiers.find((t) => t.key === k);
		const gwei = (t) => (t && t.gas_price_gwei != null ? `${Number(t.gas_price_gwei).toFixed(2)}<small>gwei</small>` : null);
		const swap = tier('standard')?.actions?.find((a) => a.key === 'swap');
		return kv([
			['Slow', gwei(tier('slow'))], ['Standard', gwei(tier('standard'))], ['Fast', gwei(tier('fast'))],
			['Native coin price', fmtUsd(p.eth_price_usd, { compact: false })],
			['DEX swap', swap?.usd != null ? fmtUsd(swap.usd, { compact: false }) : null],
		], 3);
	},
	'market-defi': (p) => kv([['Total TVL', fmtUsd(pick(p, 'total_tvl', 'totalTvl'))], ['Protocols', p.protocols?.length ?? null]])
		+ rows(p.protocols, { name: (x) => x.name, value: (x) => fmtUsd(x.tvl), delta: (x) => fmtPct(pick(x, 'change_7d', 'change_1d')) }),
	'market-stablecoins': (p) => kv([['Total supply', fmtUsd(p.total_mcap)], ['Tracked', p.stablecoins?.length ?? null]])
		+ rows(p.stablecoins, { name: (x) => `${x.symbol || x.name}`, value: (x) => fmtUsd(x.circulating_usd), delta: (x) => (x.price != null ? `<span class="${Math.abs(Number(x.price) - 1) > 0.005 ? 'dd-down' : 'dd-up'}">$${Number(x.price).toFixed(4)}</span>` : '') }),
	'market-fees': (p) => kv([['24h fees', fmtUsd(p.total24h)], ['Kind', escapeHtml(p.type || 'fees')]])
		+ rows(p.protocols, { name: (x) => x.name, value: (x) => fmtUsd(x.total24h), delta: (x) => (x.total30d != null ? `<small>30d ${fmtUsd(x.total30d)}</small>` : '') }),
	'market-dex-volumes': (p) => kv([['24h DEX volume', fmtUsd(p.total24h)], ['Venues', p.protocols?.length ?? null]])
		+ rows(p.protocols, { name: (x) => x.name, value: (x) => fmtUsd(x.total24h), delta: (x) => (x.share_pct != null ? `${Number(x.share_pct).toFixed(1)}%` : '') }),
	'market-hacks': (p) => kv([['Stolen, all time', fmtUsd(p.stats?.total_stolen_all_time)], ['Incidents, 12mo', p.stats?.incidents_12mo ?? null]])
		+ rows(p.hacks, { name: (x) => `${x.name}${x.technique ? ` · ${x.technique}` : ''}`, value: (x) => fmtUsd(x.amount_usd), max: 3 }),
	'market-yields': (p) => kv([['Median APY', p.stats?.median_apy != null ? `${Number(p.stats.median_apy).toFixed(2)}%` : null], ['Pools', p.total ?? p.pools?.length ?? null]])
		+ rows(p.pools || p.yields, { name: (x) => `${x.project || x.protocol || ''} ${x.symbol || x.pool || ''}`.trim(), value: (x) => fmtUsd(x.tvl || x.tvlUsd), delta: (x) => (x.apy != null ? `${Number(x.apy).toFixed(1)}%` : '') }),
	'market-chains': (p) => rows(p.chains, { name: (x) => x.name, value: (x) => fmtUsd(x.tvl), delta: (x) => fmtPct(pick(x, 'change_7d', 'change_1d')) }),
	'market-coins': (p) => rows(p.coins, { name: (c) => `${c.symbol}${c.name ? ` · ${c.name}` : ''}`, value: (c) => fmtUsd(c.price, { compact: false }), delta: (c) => fmtPct(c.change_24h), max: 6 }),
};

// Generic renderer for datasets without a bespoke layout: the first few scalar
// fields as tiles and the first array as ranked rows, labels guessed from the
// usual field names. It never throws and never renders an empty box.
function renderGeneric(p) {
	if (p == null || typeof p !== 'object') return kv([['Value', escapeHtml(String(p))]]);
	const scalars = [];
	let firstArray = null;
	for (const [k, v] of Object.entries(p)) {
		if (v == null) continue;
		if (Array.isArray(v)) { if (!firstArray && v.length && typeof v[0] === 'object') firstArray = v; continue; }
		if (typeof v === 'object') {
			for (const [k2, v2] of Object.entries(v)) {
				if (['number', 'string', 'boolean'].includes(typeof v2) && scalars.length < 6) scalars.push([`${k} ${k2}`, v2]);
			}
			continue;
		}
		if (scalars.length < 6) scalars.push([k, v]);
	}
	const fmt = (k, v) => {
		if (typeof v === 'number') return /usd|cap|volume|tvl|price|fees|amount/i.test(k) ? fmtUsd(v) : /pct|percent|change|dominance/i.test(k) ? fmtPct(v) : fmtNum(v, 2);
		if (typeof v === 'boolean') return v ? 'yes' : 'no';
		return escapeHtml(String(v).slice(0, 40));
	};
	const tiles = kv(scalars.map(([k, v]) => [k.replace(/_/g, ' '), fmt(k, v)]));
	const list = firstArray
		? rows(firstArray, {
			name: (x) => String(pick(x, 'name', 'title', 'headline', 'symbol', 'id', 'slug', 'label', 'protocol') ?? JSON.stringify(x).slice(0, 40)),
			value: (x) => { const v = pick(x, 'price', 'value', 'score', 'tvl', 'amount_usd', 'total24h', 'volume_24h', 'market_cap'); return typeof v === 'number' ? fmtUsd(v) : v != null ? escapeHtml(String(v).slice(0, 18)) : ''; },
			delta: (x) => { const v = pick(x, 'change_24h', 'change_24h_pct', 'change_7d', 'sentiment'); return typeof v === 'number' ? fmtPct(v) : v != null ? escapeHtml(String(v).slice(0, 10)) : ''; },
		})
		: '';
	return tiles + list || kv([['Fields', escapeHtml(Object.keys(p).slice(0, 6).join(', '))]]);
}

function renderPayload(slug, payload) {
	try {
		const out = RENDERERS[slug] ? RENDERERS[slug](payload || {}) : '';
		return out && out.replace(/<div class="dd-kv[^"]*"><\/div>/g, '').trim() ? out : renderGeneric(payload);
	} catch {
		return renderGeneric(payload);
	}
}

// ── Cards, stats, ledger ──────────────────────────────────────────────────────

function renderCard(d) {
	const card = document.createElement('article');
	card.className = 'dd-card';
	card.dataset.slug = d.slug;
	const price = fmtUsdc(d.price_usdc);
	card.innerHTML = `
		<div class="dd-card-head">
			<h3 class="dd-card-title">${escapeHtml(d.title)}</h3>
			<span class="dd-card-age" title="${escapeAttr(new Date(d.ts).toLocaleString())}">${escapeHtml(fmtWhen(d.ts))}</span>
		</div>
		${d.blurb ? `<p class="dd-card-blurb">${escapeHtml(d.blurb)}</p>` : ''}
		${renderPayload(d.slug, d.payload)}
		<div class="dd-receipt" title="This dataset was bought by a brand-new agent wallet with real USDC on Solana">
			<span class="dd-receipt-amount">${price ? `${escapeHtml(price)} USDC` : 'settling'}</span>
			<span class="dd-receipt-payer" title="${escapeAttr(d.payer || '')}">${escapeHtml(d.payer_short || 'fresh wallet')}</span>
			<span class="dd-receipt-fresh" title="Minted for this one purchase and closed right after">fresh wallet</span>
			${d.explorer_url ? `<a class="dd-receipt-tx" href="${escapeAttr(d.explorer_url)}" target="_blank" rel="noopener noreferrer" title="View the settlement transaction on Solscan">receipt ↗</a>` : ''}
		</div>
		<div class="dd-card-actions">
			<a class="dd-btn" href="${escapeAttr(`${FEED_URL}?slug=${encodeURIComponent(d.slug)}`)}" title="Every purchase of this dataset, newest first, as JSON">History</a>
			<a class="dd-btn" href="${escapeAttr(`/api/x402${d.endpoint_path.replace(/^\/api\/x402/, '')}`)}" title="The paid endpoint this was bought from (answers 402 without payment)">Endpoint</a>
		</div>
	`;
	return card;
}

function renderStats() {
	if (!els.stats) return;
	const s = state.stats;
	if (!s) return;
	const lane = s.lane?.last_24h || {};
	const tiles = [
		['Datasets live', String(s.datasets_live ?? 0), 'newest purchase of each'],
		['Purchases, 24h', String(s.purchases_24h ?? 0), s.latest_ts ? `latest ${fmtWhen(s.latest_ts)}` : ''],
		['Fresh wallets, 24h', String(lane.wallets_closed ?? 0), `${lane.jobs_paid ?? 0} paid · ${lane.forge_jobs ?? 0} props`],
		['USDC recirculated, 24h', fmtUsdc(lane.spent_usdc ?? 0) || '$0', 'back to the treasury'],
		['SOL burned in fees, 24h', `${Number(lane.sol_fees ?? 0).toFixed(4)} SOL`, `rent recycled ${Number(lane.rent_recycled_sol ?? 0).toFixed(3)} SOL`],
	];
	els.stats.innerHTML = tiles.map(([label, value, sub]) => `
		<div class="dd-stat">
			<div class="dd-stat-label">${escapeHtml(label)}</div>
			<div class="dd-stat-value">${escapeHtml(value)}</div>
			${sub ? `<div class="dd-stat-sub">${escapeHtml(sub)}</div>` : ''}
		</div>`).join('');
}

function renderLedger() {
	if (!els.ledger) return;
	const list = state.recent.slice(0, 30);
	show(els.ledgerSection, list.length > 0);
	if (!list.length) return;
	els.ledger.innerHTML = `
		<div class="dd-ledger-row dd-ledger-head" role="row">
			<span role="columnheader">Time</span><span role="columnheader">Dataset</span><span role="columnheader">Wallet</span><span role="columnheader">Price</span><span class="dd-ledger-tx" role="columnheader">Receipt</span>
		</div>` + list.map((r) => `
		<div class="dd-ledger-row" role="row">
			<span class="dd-ledger-cell dd-mono" role="cell" title="${escapeAttr(new Date(r.ts).toLocaleString())}">${escapeHtml(fmtTime(r.ts))}</span>
			<span class="dd-ledger-cell" role="cell">${escapeHtml(r.title)}</span>
			<span class="dd-ledger-cell dd-mono" role="cell" title="${escapeAttr(r.payer || '')}">${escapeHtml(r.payer_short || '')}</span>
			<span class="dd-ledger-cell dd-mono" role="cell">${escapeHtml(fmtUsdc(r.price_usdc) || '')}</span>
			<span class="dd-ledger-cell dd-ledger-tx" role="cell">${r.explorer_url ? `<a href="${escapeAttr(r.explorer_url)}" target="_blank" rel="noopener noreferrer">Solscan ↗</a>` : ''}</span>
		</div>`).join('');
}

function filtered() {
	const q = state.query.trim().toLowerCase();
	if (!q) return state.datasets;
	return state.datasets.filter((d) => `${d.title} ${d.blurb || ''} ${d.slug}`.toLowerCase().includes(q));
}

function render() {
	const list = filtered();
	show(els.loading, false);
	show(els.error, false);
	if (!state.datasets.length) {
		show(els.grid, false); show(els.emptySearch, false); show(els.empty, true);
		if (els.count) els.count.textContent = '';
		return;
	}
	show(els.empty, false);
	show(els.emptySearch, list.length === 0);
	show(els.grid, list.length > 0);
	els.grid.replaceChildren(...list.map(renderCard));
	if (els.count) els.count.textContent = state.query ? `${list.length} of ${state.datasets.length} datasets` : `${state.datasets.length} datasets`;
}

async function load({ silent = false } = {}) {
	if (!silent) {
		show(els.loading, true); show(els.grid, false); show(els.empty, false); show(els.emptySearch, false); show(els.error, false);
	}
	try {
		const res = await fetch(FEED_URL, { headers: { accept: 'application/json' } });
		if (!res.ok) {
			let detail = `HTTP ${res.status}`;
			try { const body = await res.json(); detail = body?.error_description || body?.error || detail; } catch { /* keep the status */ }
			throw new Error(detail);
		}
		const body = await res.json();
		state.datasets = Array.isArray(body.datasets) ? body.datasets : [];
		state.recent = Array.isArray(body.recent) ? body.recent : [];
		state.stats = body.stats || null;
		renderStats();
		render();
		renderLedger();
	} catch (err) {
		if (silent && state.datasets.length) return;
		show(els.loading, false); show(els.grid, false); show(els.empty, false); show(els.emptySearch, false);
		if (els.errorMsg) els.errorMsg.textContent = err?.message || 'network error';
		show(els.error, true);
	}
}

function schedule() {
	clearInterval(state.timer);
	state.timer = setInterval(() => { if (!document.hidden) load({ silent: true }); }, REFRESH_MS);
}

els.search?.addEventListener('input', () => { state.query = els.search.value; render(); });
els.clearSearch?.addEventListener('click', () => { if (els.search) els.search.value = ''; state.query = ''; render(); els.search?.focus(); });
els.retry?.addEventListener('click', () => load());
document.addEventListener('keydown', (e) => {
	if (e.key === '/' && document.activeElement !== els.search && !/input|textarea|select/i.test(document.activeElement?.tagName || '')) {
		e.preventDefault();
		els.search?.focus();
	} else if (e.key === 'Escape' && document.activeElement === els.search) {
		els.search.value = ''; state.query = ''; render();
	}
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) load({ silent: true }); });

load();
schedule();
