// Live strip of open event markets: "Name 41% (+6)" and "closes in 2h".
// Mounts into #em-ticker and stays hidden until at least one market is live.
// Pause control and prefers-reduced-motion (static, wrapped list) are built in.

import { createLiveFeed } from './live-feed.js';
import { h, api, pct, listOf, marketHref } from './common.js';

const mount = document.getElementById('em-ticker');
const markets = new Map();
const baseline = new Map();
let paused = false;

const closesIn = (iso) => {
	const s = Math.round((Date.parse(iso) - Date.now()) / 1000);
	if (!(s > 0)) return 'closing';
	if (s < 3600) return `closes in ${Math.max(1, Math.round(s / 60))}m`;
	if (s < 172800) return `closes in ${Math.round(s / 3600)}h`;
	return `closes in ${Math.round(s / 86400)}d`;
};

function leader(m) {
	return [...m.outcomes].sort((a, b) => b.percent - a.percent)[0];
}

function item(m) {
	const top = leader(m);
	const key = `${m.slug}:${top.id}`;
	if (!baseline.has(key)) baseline.set(key, top.percent);
	const delta = top.percent - baseline.get(key);
	return h('li', { class: 'em-tk-item' },
		h('a', { href: marketHref(m) },
			h('span', { class: 'nm' }, `${m.title}: ${top.label}`), ' ',
			h('span', { class: 'pc' }, pct(top.percent)),
			delta ? h('span', { class: `dl ${delta > 0 ? 'up' : 'down'}` }, ` (${delta > 0 ? '+' : ''}${delta})`) : null,
			h('span', { class: 'cl' }, ` ${closesIn(m.locks_at)}`)));
}

function render() {
	const open = [...markets.values()].filter((m) => m.status === 'open' && m.outcomes?.length);
	mount.hidden = open.length === 0;
	if (!open.length) { mount.replaceChildren(); return; }
	open.sort((a, b) => Date.parse(a.locks_at) - Date.parse(b.locks_at));
	const items = open.map(item);
	const list = h('ul', { class: 'em-tk-list', 'data-paused': String(paused), 'data-scroll': String(open.length > 2) }, items, open.length > 2 ? open.map(item).map((li) => { li.setAttribute('aria-hidden', 'true'); return li; }) : null);
	const btn = h('button', { class: 'em-tk-pause', type: 'button', 'aria-pressed': String(paused), onclick: () => { paused = !paused; render(); } }, paused ? 'Resume' : 'Pause');
	mount.replaceChildren(h('span', { class: 'em-tk-tag' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), 'Live'), h('div', { class: 'em-tk-view' }, list), btn);
}

function ingest(m) {
	if (!m?.slug || !m.outcomes) return;
	const prev = markets.get(m.slug);
	markets.set(m.slug, { ...prev, ...m, title: m.title ?? prev?.title, locks_at: m.locks_at ?? prev?.locks_at });
}

if (mount) {
	const feed = createLiveFeed({
		onEvent(ev) {
			if (ev.type === 'snapshot' || ev.type === 'resync') {
				markets.clear();
				(ev.markets || []).forEach(ingest);
			} else if (ev.type === 'odds') ingest(ev);
			else if (ev.type === 'lock' || ev.type === 'resolve') markets.delete(ev.slug);
			render();
		},
		poll: async () => {
			const { items } = listOf(await api('?status=open&limit=50'));
			return { markets: items.map((m) => ({ slug: m.slug, title: m.title, status: m.status, locks_at: m.locks_at, outcomes: m.outcomes || [] })) };
		},
	});
	feed.start();
	setInterval(() => { if (markets.size) render(); }, 60000);
}
