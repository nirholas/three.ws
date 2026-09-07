/*
 * The universe board at /markets/robinhood/portfolios/universe.
 *
 * Every asset a Robinhood Portfolio may hold, with the live numbers that decide
 * whether it may hold it. Sorting and filtering are client-side over one fetch;
 * the data itself is never synthesised here.
 */

const API = '/api/v1/hood-portfolios';

const CLASS_LABEL = {
	'rwa-equity': 'Equity',
	'crypto-major': 'Major',
	'crypto-native': 'Native',
	stablecoin: 'Stable',
};

const FILTERS = [
	{ id: 'all', label: 'All' },
	{ id: 'rwa-equity', label: 'Tokenized equities' },
	{ id: 'crypto-major', label: 'Majors' },
	{ id: 'crypto-native', label: 'Chain-native' },
	{ id: 'stablecoin', label: 'Stablecoins' },
];

let all = [];
let activeClass = 'all';
let query = '';
let sortKey = 'liquidityUsd';
let sortDir = 'desc';

const el = {};

const usd = (n) => {
	if (n == null || !Number.isFinite(Number(n))) return '-';
	const v = Number(n);
	const abs = Math.abs(v);
	if (abs >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
	if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
	if (abs >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
	if (abs >= 1) return `$${v.toFixed(2)}`;
	if (abs === 0) return '$0';
	return `$${v.toPrecision(3)}`;
};

const pct = (n) => (n == null || !Number.isFinite(Number(n)) ? '-' : `${Number(n).toFixed(2)}%`);

function escapeHtml(s) {
	return String(s ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
	);
}

function visible() {
	const q = query.trim().toLowerCase();
	let rows = all;
	if (activeClass !== 'all') rows = rows.filter((r) => r.assetClass === activeClass);
	if (q) {
		rows = rows.filter(
			(r) =>
				(r.symbol || '').toLowerCase().includes(q) ||
				(r.name || '').toLowerCase().includes(q) ||
				r.address.toLowerCase().includes(q),
		);
	}
	const dir = sortDir === 'desc' ? -1 : 1;
	return [...rows].sort((a, b) => {
		const x = a[sortKey];
		const y = b[sortKey];
		if (typeof x === 'string' || typeof y === 'string') {
			return String(x ?? '').localeCompare(String(y ?? '')) * dir;
		}
		// Nulls sort last regardless of direction: an unpriceable asset is not the
		// "smallest" one, it is one we cannot rank at all.
		if (x == null && y == null) return 0;
		if (x == null) return 1;
		if (y == null) return -1;
		return (x - y) * dir;
	});
}

function render() {
	const rows = visible();
	const flagged = rows.filter((r) => !r.canonical).length;
	el.count.textContent =
		`${rows.length.toLocaleString('en-US')} of ${all.length.toLocaleString('en-US')} assets` +
		(flagged ? ` · ${flagged.toLocaleString('en-US')} flagged as ticker impersonation and not selectable` : '');

	if (!rows.length) {
		el.body.innerHTML = `<tr><td colspan="7"><div class="hp-empty" style="border:0;padding:2rem 1rem">
			<h3>Nothing matches</h3>
			<p>No asset in the universe matches that filter. Clear the search, or widen the asset class.</p>
			<button type="button" class="hp-btn hp-btn-ghost" data-action="clear">Clear filters</button>
		</div></td></tr>`;
		return;
	}

	el.body.innerHTML = rows
		.map((r) => {
			const chg = r.change24hPct;
			const chgClass = chg > 0 ? 'hp-pos' : chg < 0 ? 'hp-neg' : 'hp-muted';
			const premium =
				r.premiumPct == null
					? '<span class="hp-muted">-</span>'
					: `<span class="${r.premiumPct > 0 ? 'hp-pos' : r.premiumPct < 0 ? 'hp-neg' : 'hp-muted'}">${escapeHtml(pct(r.premiumPct))}</span>`;
			// A contract that is not the canonical holder of its ticker is shown
			// rather than hidden, because seeing that eleven other contracts call
			// themselves USDG is the useful fact. It is simply never selectable.
			const flag = r.canonical
				? ''
				: `<span class="hp-flag" title="${escapeHtml(String(r.symbolPeers))} other contracts use this ticker. This one is not the canonical holder and cannot be held by a portfolio.">not canonical</span>`;
			return `<tr${r.canonical ? '' : ' class="hp-row-flagged"'}>
				<td>
					<span class="hp-sym">${escapeHtml(r.symbol || '?')}</span>
					<span class="hp-class" data-class="${escapeHtml(r.assetClass)}">${escapeHtml(CLASS_LABEL[r.assetClass] || r.assetClass)}</span>
					${flag}
				</td>
				<td class="hp-muted">${escapeHtml((r.name || '').replace(/ • Robinhood Token$/, ''))}</td>
				<td class="num">${escapeHtml(usd(r.priceUsd))}</td>
				<td class="num">${escapeHtml(usd(r.liquidityUsd))}</td>
				<td class="num">${escapeHtml(usd(r.volume24hUsd))}</td>
				<td class="num ${chgClass}">${escapeHtml(pct(chg))}</td>
				<td class="num">${premium}</td>
			</tr>`;
		})
		.join('');
}

function renderFilters() {
	el.filters.innerHTML = FILTERS.map(
		(f) =>
			`<button type="button" class="hp-filter" data-class="${f.id}" aria-pressed="${f.id === activeClass}">${escapeHtml(f.label)}</button>`,
	).join('');
}

function showLoading() {
	el.body.innerHTML = Array.from({ length: 8 })
		.map(
			() =>
				`<tr>${Array.from({ length: 7 })
					.map(() => '<td><span class="hp-sk-line" style="margin:0;height:10px;display:block"></span></td>')
					.join('')}</tr>`,
		)
		.join('');
}

function showError(message) {
	el.body.innerHTML = `<tr><td colspan="7"><div class="hp-empty" style="border:0;padding:2rem 1rem">
		<h3>The universe could not be loaded</h3>
		<p>${escapeHtml(message)}</p>
		<button type="button" class="hp-btn hp-btn-ghost" data-action="reload">Try again</button>
	</div></td></tr>`;
}

async function load() {
	showLoading();
	try {
		const res = await fetch(`${API}/universe`);
		const body = await res.json().catch(() => null);
		if (!res.ok) throw new Error(body?.error_description || `HTTP ${res.status}`);
		const data = body?.data ?? body;
		all = data.tokens || [];
		el.meta.textContent = `Priced ${new Date(data.pricedAt).toLocaleString()} · universe built at block ${Number(
			data.generatedAtBlock,
		).toLocaleString('en-US')}`;
		render();
	} catch (err) {
		showError(err.message);
	}
}

function init() {
	el.filters = document.getElementById('hp-filters');
	el.search = document.getElementById('hp-search');
	el.body = document.getElementById('hp-tbody');
	el.count = document.getElementById('hp-count');
	el.meta = document.getElementById('hp-meta');
	el.table = document.getElementById('hp-table');
	if (!el.body) return;

	renderFilters();
	load();

	el.filters.addEventListener('click', (e) => {
		const button = e.target.closest('[data-class]');
		if (!button) return;
		activeClass = button.dataset.class;
		renderFilters();
		render();
	});

	let debounce;
	el.search.addEventListener('input', () => {
		clearTimeout(debounce);
		debounce = setTimeout(() => {
			query = el.search.value;
			render();
		}, 140);
	});

	el.table.addEventListener('click', (e) => {
		const th = e.target.closest('th[data-sort]');
		if (!th) return;
		const key = th.dataset.sort;
		if (sortKey === key) sortDir = sortDir === 'desc' ? 'asc' : 'desc';
		else {
			sortKey = key;
			sortDir = key === 'symbol' || key === 'name' ? 'asc' : 'desc';
		}
		for (const header of el.table.querySelectorAll('th[data-sort]')) {
			header.setAttribute(
				'aria-sort',
				header.dataset.sort === sortKey ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none',
			);
		}
		render();
	});

	el.body.addEventListener('click', (e) => {
		const button = e.target.closest('[data-action]');
		if (!button) return;
		if (button.dataset.action === 'clear') {
			activeClass = 'all';
			query = '';
			el.search.value = '';
			renderFilters();
			render();
		} else if (button.dataset.action === 'reload') {
			load();
		}
	});
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
