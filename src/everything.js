// /everything: every three.ws feature, organised by what the visitor wants to
// do. Reads /features.json (generated from data/pages.json by
// scripts/build-page-index.mjs, with each page's `job` assigned in
// scripts/lib/feature-jobs.mjs), so a page that ships is listed here with no
// extra step. Preferences (pins, recents) live in localStorage only.

const FAV_KEY = 'tws:fav';
const RECENT_KEY = 'tws:recent';
const NEW_WINDOW_DAYS = 45;
const NEW_LIMIT = 8;
const COLLAPSED_ROWS = 8;
const RECENT_LIMIT = 6;

const $ = (id) => document.getElementById(id);
const root = $('ev-root');
const input = $('ev-q');
const chipBar = $('ev-chips');
const status = $('ev-status');

const state = { jobs: [], pages: [], byPath: new Map(), q: '', job: '', expanded: new Set() };

function readList(key) {
	try {
		const v = JSON.parse(localStorage.getItem(key) || '[]');
		return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
	} catch {
		return [];
	}
}
function writeList(key, list) {
	try {
		localStorage.setItem(key, JSON.stringify(list));
	} catch {
		/* storage blocked: pins and recents simply do not persist */
	}
}
let favs = readList(FAV_KEY);
let recents = readList(RECENT_KEY);

function el(tag, cls, text) {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	if (text != null) e.textContent = text;
	return e;
}

function isNew(page) {
	if (!page.added) return false;
	const age = (Date.now() - new Date(page.added).getTime()) / 86400000;
	return age >= 0 && age <= NEW_WINDOW_DAYS;
}

function score(page, terms) {
	const title = page.title.toLowerCase();
	const path = page.path.toLowerCase();
	const desc = (page.description || '').toLowerCase();
	const tags = (page.tags || []).join(' ').toLowerCase();
	let total = 0;
	for (const t of terms) {
		let s = 0;
		if (title.startsWith(t)) s = 4;
		else if (title.includes(t)) s = 3;
		else if (path.includes(t) || tags.includes(t)) s = 2;
		else if (desc.includes(t)) s = 1;
		if (!s) return 0;
		total += s;
	}
	return total;
}

function pageRow(page, opts = {}) {
	const li = el('li', 'ev-row');
	const a = el('a', 'ev-link');
	a.href = page.path;
	a.append(el('span', 'ev-name', page.title));
	if (isNew(page)) a.append(el('span', 'ev-badge ev-badge-new', 'New'));
	if (page.auth) a.append(el('span', 'ev-badge', 'Sign-in'));
	if (opts.showJob) {
		const job = state.jobs.find((j) => j.id === page.job);
		if (job) a.append(el('span', 'ev-badge ev-badge-job', job.title));
	}
	if (page.description) a.append(el('span', 'ev-desc', page.description));
	a.addEventListener('click', () => remember(page.path));
	li.append(a);

	const pinned = favs.includes(page.path);
	const star = el('button', 'ev-pin');
	star.type = 'button';
	star.dataset.path = page.path;
	star.setAttribute('aria-pressed', String(pinned));
	star.setAttribute('aria-label', `${pinned ? 'Unpin' : 'Pin'} ${page.title}`);
	star.title = pinned ? 'Unpin' : 'Pin to the top';
	star.textContent = pinned ? '★' : '☆';
	star.addEventListener('click', () => togglePin(page.path));
	li.append(star);
	return li;
}

function remember(path) {
	recents = [path, ...recents.filter((p) => p !== path)].slice(0, RECENT_LIMIT);
	writeList(RECENT_KEY, recents);
}

function togglePin(path) {
	favs = favs.includes(path) ? favs.filter((p) => p !== path) : [path, ...favs];
	writeList(FAV_KEY, favs);
	render();
	const same = [...root.querySelectorAll('.ev-pin')].find((b) => b.dataset.path === path);
	same?.focus();
}

function block(titleText, id, subText) {
	const sec = el('section', 'ev-block');
	sec.setAttribute('aria-labelledby', id);
	const h = el('h2', 'ev-h', titleText);
	h.id = id;
	sec.append(h);
	if (subText) sec.append(el('p', 'ev-sub', subText));
	return sec;
}

function list(pages, opts) {
	const ul = el('ul', 'ev-list');
	for (const p of pages) ul.append(pageRow(p, opts));
	return ul;
}

function renderJob(job, pages) {
	const sec = el('section', 'ev-card');
	sec.id = job.id;
	sec.setAttribute('aria-labelledby', `ev-h-${job.id}`);
	const head = el('header', 'ev-card-head');
	const h = el('h2', 'ev-card-title', job.title);
	h.id = `ev-h-${job.id}`;
	head.append(h, el('p', 'ev-card-promise', job.promise));
	const go = el('a', 'ev-go', `Start here`);
	go.href = job.start;
	go.append(el('span', 'ev-go-arrow', '→'));
	go.addEventListener('click', () => remember(job.start));
	head.append(go);
	sec.append(head);

	const open = state.expanded.has(job.id) || state.job === job.id;
	const shown = open ? pages : pages.slice(0, COLLAPSED_ROWS);
	sec.append(list(shown));
	if (pages.length > COLLAPSED_ROWS && !open) {
		const more = el('button', 'ev-more', `Show all ${pages.length}`);
		more.type = 'button';
		more.addEventListener('click', () => {
			state.expanded.add(job.id);
			render();
			$(`ev-h-${job.id}`)?.scrollIntoView({ block: 'nearest' });
		});
		sec.append(more);
	}
	return sec;
}

function renderChips() {
	chipBar.replaceChildren();
	const counts = new Map();
	for (const p of state.pages) counts.set(p.job, (counts.get(p.job) || 0) + 1);
	const make = (id, label, n) => {
		const b = el('button', 'ev-chip');
		b.type = 'button';
		b.dataset.job = id;
		b.setAttribute('aria-pressed', String(state.job === id));
		b.append(label, el('span', 'ev-chip-n', String(n)));
		b.addEventListener('click', () => setJob(state.job === id ? '' : id));
		return b;
	};
	chipBar.append(make('', 'All', state.pages.length));
	for (const j of state.jobs) chipBar.append(make(j.id, j.title, counts.get(j.id) || 0));
	chipBar.querySelector('[data-job=""]').setAttribute('aria-pressed', String(!state.job));
}

function setJob(id) {
	state.job = id;
	history.replaceState(null, '', id ? `#${id}` : location.pathname + location.search);
	render();
}

function render() {
	const q = state.q.trim().toLowerCase();
	const terms = q.split(/\s+/).filter(Boolean);
	root.replaceChildren();
	renderChips();
	root.removeAttribute('aria-busy');

	if (terms.length) {
		const pool = state.job ? state.pages.filter((p) => p.job === state.job) : state.pages;
		const hits = pool
			.map((p) => ({ p, s: score(p, terms) }))
			.filter((x) => x.s > 0)
			.sort((a, b) => b.s - a.s || a.p.title.localeCompare(b.p.title))
			.map((x) => x.p);
		status.textContent = `${hits.length} ${hits.length === 1 ? 'match' : 'matches'} for "${state.q.trim()}"`;
		if (!hits.length) {
			const empty = el('div', 'ev-empty');
			empty.append(
				el('h2', 'ev-empty-h', `Nothing matches "${state.q.trim()}"`),
				el('p', null, 'Try a shorter word, or describe the goal: "animate", "token", "embed", "wallet".'),
			);
			const clear = el('button', 'ev-btn', 'Clear search');
			clear.type = 'button';
			clear.addEventListener('click', () => {
				input.value = '';
				state.q = '';
				state.job = '';
				render();
				input.focus();
			});
			empty.append(clear);
			root.append(empty);
			return;
		}
		const sec = block('Results', 'ev-h-results');
		sec.append(list(hits.slice(0, 80), { showJob: true }));
		if (hits.length > 80) sec.append(el('p', 'ev-sub', `Showing the best 80 of ${hits.length}. Narrow the search to see the rest.`));
		root.append(sec);
		return;
	}

	status.textContent = `${state.job ? state.jobs.find((j) => j.id === state.job)?.title : 'All'}: ${
		(state.job ? state.pages.filter((p) => p.job === state.job) : state.pages).length
	} pages`;

	if (!state.job) {
		const pinned = favs.map((p) => state.byPath.get(p)).filter(Boolean);
		if (pinned.length) {
			const sec = block('Pinned', 'ev-h-pinned', 'Your shortcuts. Pin any page with the star.');
			sec.append(list(pinned));
			root.append(sec);
		}
		const recent = recents.map((p) => state.byPath.get(p)).filter(Boolean);
		if (recent.length) {
			const sec = block('Recently opened', 'ev-h-recent');
			sec.append(list(recent));
			root.append(sec);
		}
	}

	const grid = el('div', 'ev-grid');
	for (const job of state.jobs) {
		if (state.job && state.job !== job.id) continue;
		const pages = state.pages.filter((p) => p.job === job.id);
		if (pages.length) grid.append(renderJob(job, pages));
	}
	root.append(grid);

	if (!state.job) {
		const fresh = state.pages
			.filter(isNew)
			.sort((a, b) => (a.added < b.added ? 1 : -1))
			.slice(0, NEW_LIMIT);
		if (fresh.length) {
			const sec = block('New this month', 'ev-h-new', 'The latest pages to ship.');
			sec.classList.add('ev-block-after');
			sec.append(list(fresh, { showJob: true }));
			root.append(sec);
		}
	}
}

function showError() {
	root.replaceChildren();
	root.removeAttribute('aria-busy');
	status.textContent = '';
	const box = el('div', 'ev-empty');
	box.append(
		el('h2', 'ev-empty-h', 'The feature list did not load'),
		el('p', null, 'Check your connection and try again. The full directory is also at /sitemap.'),
	);
	const retry = el('button', 'ev-btn', 'Try again');
	retry.type = 'button';
	retry.addEventListener('click', load);
	const alt = el('a', 'ev-btn ev-btn-ghost', 'Open the sitemap');
	alt.href = '/sitemap';
	box.append(retry, alt);
	root.append(box);
}

async function load() {
	root.setAttribute('aria-busy', 'true');
	try {
		const res = await fetch('/features.json', { headers: { accept: 'application/json' } });
		if (!res.ok) throw new Error(String(res.status));
		const data = await res.json();
		state.jobs = Array.isArray(data.jobs) ? data.jobs : [];
		const known = new Set(state.jobs.map((j) => j.id));
		state.pages = (data.sections || [])
			.flatMap((s) => s.pages || [])
			.filter((p) => p.job && known.has(p.job) && p.indexable !== false)
			.map((p, i) => ({ ...p, order: i }));
		// Each goal leads with its curated flagship pages, then the rest by priority.
		const rank = (p) => {
			const at = (state.jobs.find((j) => j.id === p.job)?.featured || []).indexOf(p.path);
			return at === -1 ? Infinity : at;
		};
		state.pages.sort((a, b) => rank(a) - rank(b) || (b.priority ?? 0.5) - (a.priority ?? 0.5) || a.order - b.order);
		state.byPath = new Map(state.pages.map((p) => [p.path, p]));
		const hash = location.hash.slice(1);
		if (known.has(hash)) state.job = hash;
		const q = new URLSearchParams(location.search).get('q');
		if (q) {
			state.q = q;
			input.value = q;
		}
		render();
	} catch {
		showError();
	}
}

input.addEventListener('input', () => {
	state.q = input.value;
	render();
});
input.addEventListener('keydown', (e) => {
	if (e.key === 'Escape' && input.value) {
		input.value = '';
		state.q = '';
		render();
	}
});
document.addEventListener('keydown', (e) => {
	const t = e.target;
	const typing = t instanceof HTMLElement && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName));
	if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
		e.preventDefault();
		input.focus();
	}
});
window.addEventListener('hashchange', () => {
	const id = location.hash.slice(1);
	if (!id || state.jobs.some((j) => j.id === id)) {
		state.job = id;
		render();
	}
});

load();
