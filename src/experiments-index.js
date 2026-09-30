/**
 * /experiments: the public experiment log. Reads /experiments.json, which
 * `npm run build:pages` validates and publishes from data/experiments.json, and
 * renders one card per experiment with a URL-synced status filter.
 */

const INDEX_URL = '/experiments.json';
const STATUSES = ['all', 'running', 'concluded', 'killed'];
const STATUS_LABEL = { running: 'Running', concluded: 'Concluded', killed: 'Killed' };

const state = { status: 'all', experiments: null };

const listEl = document.getElementById('ex-list');
const filterEl = document.getElementById('ex-filter');

function escapeHtml(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function fmtDate(day) {
	const t = Date.parse(`${day}T00:00:00Z`);
	if (!Number.isFinite(t)) return day;
	return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function fmtSpend(usd) {
	const n = Number(usd);
	if (!Number.isFinite(n)) return 'not stated';
	if (n === 0) return '$0';
	return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function readUrl() {
	const s = new URLSearchParams(location.search).get('status');
	state.status = STATUSES.includes(s) ? s : 'all';
}

function writeUrl() {
	const q = new URLSearchParams(location.search);
	if (state.status === 'all') q.delete('status');
	else q.set('status', state.status);
	const qs = q.toString();
	history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}`);
}

function syncFilter() {
	filterEl.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.status === state.status)));
	if (!state.experiments) return;
	for (const s of STATUSES) {
		const n = s === 'all' ? state.experiments.length : state.experiments.filter((e) => e.status === s).length;
		const el = filterEl.querySelector(`[data-count="${s}"]`);
		if (el) el.textContent = String(n);
	}
}

function card(e) {
	const links = [`<a class="is-primary" href="${escapeHtml(e.url)}">Read the write-up</a>`];
	if (e.live_url) links.push(`<a href="${escapeHtml(e.live_url)}">Live view</a>`);
	for (const r of e.related || []) links.push(`<a href="${escapeHtml(r.href)}">${escapeHtml(r.label)}</a>`);
	return `<article class="ex-card">
		<div class="ex-meta">
			<span class="ex-status" data-status="${escapeHtml(e.status)}">${escapeHtml(STATUS_LABEL[e.status] || e.status)}</span>
			<span>Published <time datetime="${escapeHtml(e.published)}">${escapeHtml(fmtDate(e.published))}</time></span>
			<span>Spend ${escapeHtml(fmtSpend(e.spend_usd))}</span>
		</div>
		<h2><a href="${escapeHtml(e.url)}">${escapeHtml(e.title)}</a></h2>
		<p class="ex-q"><strong>Question:</strong> ${escapeHtml(e.question)}</p>
		${e.headline ? `<p class="ex-headline">${escapeHtml(e.headline)}</p>` : ''}
		<div class="ex-links">${links.join('')}</div>
	</article>`;
}

function render() {
	syncFilter();
	listEl.removeAttribute('aria-busy');
	const all = state.experiments || [];
	if (!all.length) {
		listEl.innerHTML = `<div class="ex-empty"><strong>No experiments published yet.</strong>The first write-up lands here as soon as it is measured. <a href="/docs/experiments">See how an experiment is run and published</a>.</div>`;
		return;
	}
	const shown = state.status === 'all' ? all : all.filter((e) => e.status === state.status);
	if (!shown.length) {
		listEl.innerHTML = `<div class="ex-empty"><strong>No ${escapeHtml(STATUS_LABEL[state.status].toLowerCase())} experiments right now.</strong><button type="button" data-show-all>Show all ${all.length} experiments</button></div>`;
		listEl.querySelector('[data-show-all]').addEventListener('click', () => setStatus('all'));
		return;
	}
	listEl.innerHTML = shown.map(card).join('');
}

function renderError(detail) {
	listEl.removeAttribute('aria-busy');
	listEl.innerHTML = `<div class="ex-error" role="alert"><span><strong>Could not load the experiment log.</strong> ${escapeHtml(detail)}</span><button type="button" data-retry>Retry</button></div>`;
	listEl.querySelector('[data-retry]').addEventListener('click', load);
}

function setStatus(s) {
	state.status = s;
	writeUrl();
	render();
}

async function load() {
	listEl.setAttribute('aria-busy', 'true');
	listEl.innerHTML = '<div class="ex-skel skeleton" aria-hidden="true"></div><div class="ex-skel skeleton" aria-hidden="true"></div>';
	let body;
	try {
		const res = await fetch(INDEX_URL, { headers: { accept: 'application/json' } });
		if (!res.ok) throw new Error(`http_${res.status}`);
		body = await res.json();
		if (!Array.isArray(body?.experiments)) throw new Error('bad_body');
	} catch (err) {
		const status = /^http_(\d+)$/.exec(err?.message || '')?.[1];
		renderError(status ? `The server answered HTTP ${status}.` : err?.message === 'bad_body' ? 'The log could not be read.' : 'Network error: check your connection, then retry.');
		return;
	}
	state.experiments = body.experiments;
	render();
}

filterEl.addEventListener('click', (e) => {
	const b = e.target.closest('button[data-status]');
	if (!b || b.dataset.status === state.status) return;
	setStatus(b.dataset.status);
});
window.addEventListener('popstate', () => {
	readUrl();
	if (state.experiments) render();
	else syncFilter();
});

readUrl();
syncFilter();
load();
