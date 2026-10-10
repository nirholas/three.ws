// /event-markets: live, closing soon and resolved markets with source and search filters.

import { h, api, ApiError, SOURCE_LABELS, seriesColor, pct, countdown, when, marketHref, statusLabel, listOf } from './common.js';

const root = document.getElementById('em-root');
const live = document.getElementById('em-live');

const TABS = [
	{ id: 'live', label: 'Live', status: 'open', blurb: 'Open now, soonest to lock first.' },
	{ id: 'closing', label: 'Closing soon', status: 'open', blurb: 'Locking in the next 24 hours.' },
	{ id: 'resolved', label: 'Resolved', status: 'resolved', blurb: 'Called and settled, newest first.' },
];

const state = { tab: 'live', source: '', q: '', items: [], cursor: null, loading: false, error: null, gen: 0 };
try {
	const p = new URLSearchParams(location.search);
	if (TABS.some((t) => t.id === p.get('view'))) state.tab = p.get('view');
	if (p.get('source') in SOURCE_LABELS) state.source = p.get('source');
	state.q = (p.get('q') || '').slice(0, 80);
} catch { /* defaults */ }

const els = {};

function syncUrl() {
	const p = new URLSearchParams();
	if (state.tab !== 'live') p.set('view', state.tab);
	if (state.source) p.set('source', state.source);
	if (state.q) p.set('q', state.q);
	history.replaceState(null, '', `${location.pathname}${p.size ? `?${p}` : ''}`);
}

function announce(msg) { live.textContent = msg; }

function marketCard(m) {
	const top = [...m.outcomes].sort((a, b) => b.percent - a.percent).slice(0, 3);
	const closes = m.status === 'open' && m.seconds_to_lock > 0 ? `Locks in ${countdown(m.seconds_to_lock)}` : m.status === 'resolved' && m.winner ? `Winner: ${m.winner.label}` : when(m.locks_at);
	return h('a', { class: 'em-card', href: marketHref(m), 'aria-label': `${m.title}. ${statusLabel[m.status] || m.status}.` },
		h('div', { class: 'em-meta' },
			h('span', { class: `em-pill ${m.status}` }, statusLabel[m.status] || m.status),
			h('span', null, SOURCE_LABELS[m.source_kind] || m.source_kind)),
		h('h3', null, m.title),
		h('ul', { class: 'em-mini' }, top.map((o, i) => h('li', { style: `--em-c:${seriesColor(i)}` },
			h('span', { class: 'nm' }, o.label),
			h('span', { class: 'pc' }, pct(o.percent)),
			h('span', { class: 'em-bar-track', 'aria-hidden': 'true' }, h('span', { class: 'em-bar-fill', style: `display:block;width:${Math.max(2, o.percent)}%` }))))),
		h('div', { class: 'em-meta' }, h('span', null, closes), h('span', null, `${m.pick_count} ${m.pick_count === 1 ? 'pick' : 'picks'}`)));
}

function skeletons() {
	return h('div', { class: 'em-grid', 'aria-hidden': 'true' }, Array.from({ length: 6 }, () => h('div', { class: 'em-skel em-skel-card' })));
}

function emptyState() {
	const filtered = state.q || state.source;
	const resolved = state.tab === 'resolved';
	return h('div', { class: 'em-state' },
		h('h2', null, filtered ? 'No markets match those filters' : resolved ? 'Nothing has resolved yet' : 'No markets open right now'),
		h('p', null, filtered
			? 'Try a different search or clear the source filter.'
			: 'Every three.ws event opens a market automatically, so the next one appears as soon as an event is scheduled. Browse the events to see what is coming.'),
		h('div', { class: 'row' },
			filtered ? h('button', { class: 'em-btn', type: 'button', onclick: () => { state.q = ''; state.source = ''; els.q.value = ''; els.source.value = ''; load(true); } }, 'Clear filters') : null,
			h('a', { class: 'em-btn primary', href: '/events' }, 'See upcoming events')));
}

function errorState() {
	return h('div', { class: 'em-state', role: 'alert' },
		h('h2', null, 'Could not load markets'),
		h('p', null, state.error?.message || 'Something went wrong.'),
		h('div', { class: 'row' }, h('button', { class: 'em-btn primary', type: 'button', onclick: () => load(true) }, 'Retry')));
}

function render() {
	const body = els.body;
	body.replaceChildren();
	body.setAttribute('aria-busy', state.loading ? 'true' : 'false');
	if (state.loading && !state.items.length) { body.append(skeletons()); return; }
	if (state.error && !state.items.length) { body.append(errorState()); return; }
	if (!state.items.length) { body.append(emptyState()); return; }
	body.append(h('div', { class: 'em-grid' }, state.items.map(marketCard)));
	if (state.error) body.append(h('p', { class: 'em-err', role: 'alert' }, state.error.message));
	if (state.cursor) body.append(h('div', { class: 'em-more' }, h('button', { class: 'em-btn', type: 'button', disabled: state.loading, onclick: () => load(false) }, state.loading ? 'Loading' : 'Load more')));
}

async function load(reset) {
	const gen = ++state.gen;
	if (reset) { state.items = []; state.cursor = null; }
	state.loading = true;
	state.error = null;
	syncUrl();
	render();
	const tab = TABS.find((t) => t.id === state.tab);
	const qs = new URLSearchParams({ status: tab.status, limit: '24' });
	if (state.source) qs.set('source_kind', state.source);
	if (state.q) qs.set('q', state.q);
	if (state.cursor) qs.set('cursor', state.cursor);
	try {
		const { items, nextCursor } = listOf(await api(`?${qs}`));
		if (gen !== state.gen) return;
		const cutoff = state.tab === 'closing' ? 86400 : Infinity;
		const rows = items.filter((m) => m.status !== 'open' || m.seconds_to_lock <= cutoff);
		state.items = reset ? rows : [...state.items, ...rows];
		state.cursor = nextCursor;
		announce(`${state.items.length} ${state.items.length === 1 ? 'market' : 'markets'} shown.`);
	} catch (err) {
		if (gen !== state.gen) return;
		state.error = err instanceof ApiError ? err : new ApiError(0, 'error', 'Something went wrong. Retry in a moment.');
		announce(state.error.message);
	} finally {
		if (gen === state.gen) { state.loading = false; render(); }
	}
}

function build() {
	els.q = h('input', { class: 'em-input', type: 'search', placeholder: 'Search markets', 'aria-label': 'Search markets', value: state.q, maxlength: '80' });
	let t;
	els.q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { state.q = els.q.value.trim(); load(true); }, 300); });
	els.source = h('select', { class: 'em-select', 'aria-label': 'Filter by source' },
		h('option', { value: '' }, 'All sources'),
		Object.entries(SOURCE_LABELS).map(([k, v]) => h('option', { value: k, selected: k === state.source }, v)));
	els.source.addEventListener('change', () => { state.source = els.source.value; load(true); });
	els.tabs = h('div', { class: 'em-tabs', role: 'tablist', 'aria-label': 'Market views' }, TABS.map((tb) =>
		h('button', { class: 'em-tab', role: 'tab', id: `em-tab-${tb.id}`, 'aria-selected': String(tb.id === state.tab), 'aria-controls': 'em-body', tabindex: tb.id === state.tab ? '0' : '-1', type: 'button',
			onclick: () => selectTab(tb.id) }, tb.label)));
	els.tabs.addEventListener('keydown', (e) => {
		const i = TABS.findIndex((x) => x.id === state.tab);
		const next = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length : -1;
		if (next < 0) return;
		e.preventDefault();
		selectTab(TABS[next].id);
		els.tabs.children[next].focus();
	});
	els.body = h('div', { id: 'em-body', role: 'tabpanel', 'aria-labelledby': `em-tab-${state.tab}`, 'aria-live': 'off' });
	root.replaceChildren(
		h('section', { class: 'em-hero' },
			h('div', null,
				h('h1', null, 'Event Markets'),
				h('p', null, 'Call the winner of every three.ws event. Picks are free-to-play points, the crowd sets the odds, and the best forecasters climb the leaderboard.')),
			h('a', { class: 'em-btn', href: '/event-markets/leaderboard' }, 'Leaderboard')),
		els.tabs,
		h('div', { class: 'em-bar' }, els.q, els.source),
		els.body);
	root.removeAttribute('aria-busy');
}

function selectTab(id) {
	state.tab = id;
	[...els.tabs.children].forEach((b, i) => {
		const on = TABS[i].id === id;
		b.setAttribute('aria-selected', String(on));
		b.tabIndex = on ? 0 : -1;
	});
	els.body.setAttribute('aria-labelledby', `em-tab-${id}`);
	load(true);
}

build();
load(true);
