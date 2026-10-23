/**
 * /why-three-ws: live proof tiles.
 *
 * Every figure, label and method string comes from GET /api/platform/analytics
 * (the same endpoint /analytics renders). Nothing numeric is written in the
 * page or here. A metric that could not be read renders as "Unavailable" and
 * the rest of the page is unaffected.
 */

const ENDPOINT = '/api/platform/analytics?window=all';
const SHOWN = ['agents', 'coins_launched', 'creator_fees', 'x402_settlements', 'models_generated'];
const LINKS = {
	agents: '/analytics#methods',
	coins_launched: '/launches',
	creator_fees: '/leaderboard?tab=earned&window=all',
	x402_settlements: '/x402',
	models_generated: '/forge',
};

const tilesEl = document.getElementById('yw-tiles');
const errorEl = document.getElementById('yw-error');
const retryBtn = document.getElementById('yw-retry');

const nf = new Intl.NumberFormat(undefined);

function fmt(unit, v) {
	const n = Number(v);
	if (v == null || !Number.isFinite(n)) return null;
	if (unit === 'usd') return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
	if (unit === 'sol') return `${n.toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL`;
	if (unit === 'three') return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} $THREE`;
	return nf.format(Math.round(n));
}

function tile(key, m) {
	const a = document.createElement('a');
	a.className = 'yw-tile';
	a.href = LINKS[key] || '/analytics';
	const label = document.createElement('div');
	label.className = 'yw-tile-label';
	label.textContent = m?.label || key.replace(/_/g, ' ');
	const value = document.createElement('div');
	value.className = 'yw-tile-value';
	const sub = document.createElement('div');
	sub.className = 'yw-tile-sub';
	const shown = m && m.available ? fmt(m.unit, m.total) : null;
	if (shown == null) {
		a.classList.add('is-unavailable');
		value.classList.add('is-muted');
		value.textContent = 'Unavailable';
		sub.textContent = 'This figure could not be read just now. It is never shown as zero.';
	} else {
		value.textContent = shown;
		sub.textContent = 'All time. How it is counted is on /analytics.';
	}
	a.append(label, value, sub);
	if (m?.method) a.title = m.method;
	return a;
}

async function load() {
	tilesEl.setAttribute('aria-busy', 'true');
	errorEl.hidden = true;
	try {
		const res = await fetch(ENDPOINT, { headers: { accept: 'application/json' } });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const body = await res.json();
		tilesEl.replaceChildren(...SHOWN.map((k) => tile(k, body.metrics?.[k])));
	} catch {
		tilesEl.replaceChildren(...SHOWN.map((k) => tile(k, null)));
		errorEl.hidden = false;
	} finally {
		tilesEl.setAttribute('aria-busy', 'false');
	}
}

retryBtn.addEventListener('click', load);
load();
