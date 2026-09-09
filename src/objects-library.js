// /objects: the CC0 3D object/prop library gallery.
//
// Browses the free, commercial-OK props served by GET /api/objects/library
// (manifest on R2, mirroring /character-library). Each card offers:
//   Preview  -> /app#model=<glb>&kind=object   (viewer in object mode: no agent chat)
//   AR       -> /ar/studio?src=<glb>           (place the prop in your room)
//   Download -> the GLB directly               (every object is CC0)
//
// The library is ~500 entries and the whole manifest is fetched once, so search,
// sort and category filtering are instant and never cost a round trip. What the
// manifest CANNOT do is render all of it at once: the props average 2 MB of GLB
// apiece, and the first version of this page mounted one <model-viewer> per
// entry, which fired 511 poster requests, built 511 web components before the
// first card was interactive (18 s to first paint, 3 fps while scrolling), and
// would have pulled gigabytes if a visitor scrolled. So the grid renders in
// chunks and a card is a cheap, lazily-fetched still until you point at it:
// pointing (or tab-focusing) upgrades that one card to a live, auto-rotating
// <model-viewer>, and at most MAX_LIVE_VIEWERS stay mounted at a time.

const els = {
	grid: document.querySelector('[data-role="grid"]'),
	loading: document.querySelector('[data-role="loading"]'),
	empty: document.querySelector('[data-role="empty"]'),
	emptySearch: document.querySelector('[data-role="empty-search"]'),
	error: document.querySelector('[data-role="error"]'),
	errorMsg: document.querySelector('[data-role="error-msg"]'),
	search: document.querySelector('[data-role="search"]'),
	sort: document.querySelector('[data-role="sort"]'),
	count: document.querySelector('[data-role="count"]'),
	heroStats: document.querySelector('[data-role="hero-stats"]'),
	clearSearch: document.querySelector('[data-role="clear-search"]'),
	retry: document.querySelector('[data-role="retry"]'),
	catChips: document.querySelector('[data-role="chips"]'),
	more: document.querySelector('[data-role="more"]'),
	loadMore: document.querySelector('[data-role="load-more"]'),
};

const PAGE_SIZE = 48;
const MAX_LIVE_VIEWERS = 6;
const HOVER_INTENT_MS = 200;

const state = { all: [], query: '', sort: 'az', category: '', view: [], rendered: 0 };

// Poly Haven tags each asset with the scene collection it shipped in
// ("collection: the_shed"). Those are provenance, not something a visitor
// browses by, and eight of them padded the filter row with names that mean
// nothing outside Poly Haven's own site. They stay on the object (and stay
// searchable through its tags); they just do not earn a chip.
const isBrowsableCategory = (c) => Boolean(c) && !/^collection\s*:/i.test(c);

const prefersReducedMotion =
	typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function escapeHtml(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) =>
		({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const escapeAttr = escapeHtml;
function show(el, on) { if (el) el.hidden = !on; }
function formatBytes(n) {
	if (!n) return '';
	const mb = n / 1024 / 1024;
	return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

// --- live-viewer budget ------------------------------------------------------
// Mounted <model-viewer>s, oldest first. Each one holds a WebGL context and a
// decoded GLB, so the list is capped and the oldest is torn back down to its
// still image when a seventh card is pointed at.
const liveThumbs = [];

function retireThumb(thumb) {
	if (!thumb || thumb.dataset.live !== '1') return;
	thumb.querySelector('model-viewer')?.remove();
	thumb.classList.remove('is-live');
	delete thumb.dataset.live;
}

function upgradeThumb(thumb) {
	if (!thumb || thumb.dataset.live === '1') return;
	const src = thumb.dataset.glb;
	if (!src) return;
	thumb.dataset.live = '1';
	const mv = document.createElement('model-viewer');
	mv.className = 'ch-card-mv';
	mv.setAttribute('src', src);
	mv.setAttribute('alt', thumb.dataset.label || 'Object');
	mv.setAttribute('reveal', 'auto');
	mv.setAttribute('disable-zoom', '');
	mv.setAttribute('disable-pan', '');
	mv.setAttribute('disable-tap', '');
	mv.setAttribute('interaction-prompt', 'none');
	mv.setAttribute('environment-image', 'neutral');
	mv.setAttribute('shadow-intensity', '0.4');
	mv.setAttribute('exposure', '1');
	if (!prefersReducedMotion) {
		mv.setAttribute('auto-rotate', '');
		mv.setAttribute('rotation-per-second', '20deg');
	}
	mv.addEventListener('load', () => thumb.classList.add('is-live'), { once: true });
	thumb.prepend(mv);
	liveThumbs.push(thumb);
	while (liveThumbs.length > MAX_LIVE_VIEWERS) retireThumb(liveThumbs.shift());
}

// --- cards -------------------------------------------------------------------
// A card with no rendered poster has nothing to look at until it goes live, so
// it upgrades on intersection instead of waiting for a pointer that a touch
// visitor never sends. It still spends from the same live-viewer budget.
const blankObserver = 'IntersectionObserver' in window
	? new IntersectionObserver((entries, obs) => {
		for (const e of entries) {
			if (!e.isIntersecting) continue;
			obs.unobserve(e.target);
			upgradeThumb(e.target);
		}
	}, { rootMargin: '200px' })
	: null;

function renderCard(o) {
	const glbUrl = o.url || '';
	const alt = o.label || o.name || 'Object';
	// A prop is not an embodied agent, so the viewer opens in object mode: it
	// shows view + modify affordances (Restyle / AR / Download) instead of the
	// "Ask the agent" chat dock. The overlay reads `kind=object` and `title`
	// from the hash.
	const previewUrl = `/app#model=${encodeURIComponent(glbUrl)}&kind=object&title=${encodeURIComponent(alt)}`;
	const arUrl = `/ar/studio?src=${encodeURIComponent(glbUrl)}&title=${encodeURIComponent(alt)}`;
	const cat = (o.categories || []).find(isBrowsableCategory) || '';
	const size = formatBytes(o.bytes);

	const card = document.createElement('article');
	card.className = 'ch-card';
	card.innerHTML = `
		<a class="ch-card-thumb" href="${escapeAttr(previewUrl)}" aria-label="Preview ${escapeAttr(alt)} in 3D"
			data-glb="${escapeAttr(glbUrl)}" data-label="${escapeAttr(alt)}">
			${o.thumb
				? `<img class="ch-card-img" src="${escapeAttr(o.thumb)}" alt="" loading="lazy" decoding="async" />`
				: '<span class="ch-card-img ch-card-img--blank" aria-hidden="true"></span>'}
			<span class="ch-card-pill">CC0</span>
			<span class="ch-card-play" aria-hidden="true">&#9654;</span>
		</a>
		<div class="ch-card-body">
			<h3 class="ch-card-name">${escapeHtml(alt)}</h3>
			<div class="ch-card-meta">${escapeHtml(cat)}${cat && size ? ' &middot; ' : ''}${escapeHtml(size)}</div>
			<div class="ch-card-actions">
				<a class="ch-btn ch-btn--primary" href="${escapeAttr(previewUrl)}" title="Open ${escapeAttr(alt)} in the 3D viewer">Preview</a>
				<a class="ch-btn ch-btn--ghost" href="${escapeAttr(arUrl)}" title="Place ${escapeAttr(alt)} in your room with AR Studio">AR</a>
				<a class="ch-btn ch-btn--ghost" href="${escapeAttr(glbUrl)}" download title="Download the ${escapeAttr(alt)} GLB (CC0, free to reuse)">Download</a>
			</div>
		</div>
	`;
	// A card with no rendered poster has nothing to look at until it goes live,
	// so it upgrades as soon as it scrolls into view rather than waiting for a
	// pointer. It still counts against the same budget.
	if (!o.thumb) blankObserver?.observe(card.querySelector('.ch-card-thumb'));
	return card;
}

// --- filtering, sorting, chunked rendering -----------------------------------
function categories() {
	const set = new Set();
	for (const o of state.all) for (const c of o.categories || []) if (isBrowsableCategory(c)) set.add(c);
	return [...set].sort();
}

function renderChips() {
	if (!els.catChips) return;
	const cats = categories();
	if (!cats.length) return;
	els.catChips.innerHTML =
		`<button type="button" class="ch-chip${state.category === '' ? ' is-active' : ''}" data-cat="" aria-pressed="${state.category === ''}">All</button>` +
		cats.map((c) => `<button type="button" class="ch-chip${state.category === c ? ' is-active' : ''}" data-cat="${escapeAttr(c)}" aria-pressed="${state.category === c}">${escapeHtml(c)}</button>`).join('');
}

function filtered() {
	const q = state.query.trim().toLowerCase();
	let list = state.all;
	if (state.category) list = list.filter((o) => (o.categories || []).includes(state.category));
	if (q) {
		list = list.filter((o) => (o.label || o.name || '').toLowerCase().includes(q) ||
			(o.tags || []).some((t) => String(t).toLowerCase().includes(q)) ||
			(o.categories || []).some((c) => String(c).toLowerCase().includes(q)));
	}
	return list.slice().sort((a, b) => {
		const la = (a.label || a.name || '').toLowerCase(), lb = (b.label || b.name || '').toLowerCase();
		if (state.sort === 'za') return lb.localeCompare(la);
		if (state.sort === 'largest') return (b.bytes || 0) - (a.bytes || 0);
		if (state.sort === 'smallest') return (a.bytes || 0) - (b.bytes || 0);
		return la.localeCompare(lb);
	});
}

// The button's own label is static markup so the i18n pass owns it; the running
// tally lives in the aria-live count above the grid, which announces "48 of 511
// shown" after every chunk without either surface clobbering the other.
function syncMore() {
	show(els.more, state.rendered < state.view.length);
}

function renderChunk() {
	const next = state.view.slice(state.rendered, state.rendered + PAGE_SIZE);
	if (!next.length) { syncMore(); return; }
	const frag = document.createDocumentFragment();
	for (const o of next) frag.appendChild(renderCard(o));
	els.grid.appendChild(frag);
	state.rendered += next.length;
	if (els.count) els.count.textContent = `${state.rendered} of ${state.view.length} shown`;
	syncMore();
}

function applyView() {
	state.view = filtered();
	state.rendered = 0;
	liveThumbs.length = 0;
	els.grid.replaceChildren();

	if (state.all.length === 0) {
		show(els.loading, false); show(els.grid, false); show(els.emptySearch, false);
		show(els.error, false); show(els.more, false); show(els.empty, true);
		if (els.count) els.count.textContent = '';
		return;
	}
	if (state.view.length === 0) {
		show(els.loading, false); show(els.grid, false); show(els.empty, false);
		show(els.error, false); show(els.more, false); show(els.emptySearch, true);
		if (els.count) els.count.textContent = '0 objects';
		return;
	}
	show(els.loading, false); show(els.empty, false); show(els.emptySearch, false);
	show(els.error, false); show(els.grid, true);
	renderChunk();
}

async function load() {
	show(els.loading, true); show(els.grid, false); show(els.empty, false);
	show(els.emptySearch, false); show(els.error, false); show(els.more, false);
	show(els.errorMsg, false);
	try {
		const res = await fetch('/api/objects/library');
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = await res.json();
		state.all = Array.isArray(data.objects) ? data.objects : [];
		if (els.heroStats) els.heroStats.textContent = state.all.length ? `${state.all.length} CC0 props, free to use` : '';
		renderChips();
		applyView();
	} catch (err) {
		show(els.loading, false); show(els.grid, false); show(els.empty, false);
		show(els.emptySearch, false); show(els.more, false); show(els.error, true);
		if (els.errorMsg) {
			els.errorMsg.textContent = `Request failed: ${err?.message || 'network error'}`;
			show(els.errorMsg, true);
		}
	}
}

function wire() {
	let t;
	els.search?.addEventListener('input', (e) => {
		clearTimeout(t); const v = e.target.value;
		t = setTimeout(() => { state.query = v; applyView(); }, 120);
	});
	els.sort?.addEventListener('change', (e) => { state.sort = e.target.value; applyView(); });
	els.clearSearch?.addEventListener('click', () => {
		state.query = ''; state.category = '';
		if (els.search) els.search.value = '';
		renderChips(); applyView();
		els.search?.focus();
	});
	els.retry?.addEventListener('click', load);
	els.loadMore?.addEventListener('click', renderChunk);

	els.catChips?.addEventListener('click', (e) => {
		const chip = e.target.closest('.ch-chip');
		if (!chip) return;
		state.category = chip.dataset.cat;
		renderChips();
		applyView();
	});

	// Delegated so a chunk appended later needs no extra wiring. `pointerover`
	// bubbles where `pointerenter` does not, and `focusin` gives a keyboard user
	// the same live preview a mouse user gets on hover.
	//
	// Hover INTENT, not hover: sweeping the pointer across a row of cards on the
	// way to the search box would otherwise start a multi-megabyte GLB download
	// per card it crossed, six of which raced hard enough to crash the renderer
	// outright in testing. A short dwell means only the card you actually stopped
	// on goes live. Keyboard focus is already a deliberate act, so it upgrades at
	// once.
	let hoverTimer;
	els.grid?.addEventListener('pointerover', (e) => {
		const thumb = e.target.closest?.('.ch-card-thumb');
		if (!thumb) return;
		clearTimeout(hoverTimer);
		hoverTimer = setTimeout(() => upgradeThumb(thumb), HOVER_INTENT_MS);
	});
	els.grid?.addEventListener('pointerout', () => clearTimeout(hoverTimer));
	els.grid?.addEventListener('focusin', (e) => {
		const thumb = e.target.closest?.('.ch-card-thumb');
		if (thumb) upgradeThumb(thumb);
	});

	// Infinite scroll on top of the real button: the sentinel loads the next
	// chunk as it nears the viewport, and the button stays the accessible,
	// observer-free way to do the same thing.
	if (els.more && 'IntersectionObserver' in window) {
		new IntersectionObserver((entries) => {
			if (entries.some((e) => e.isIntersecting) && !els.more.hidden) renderChunk();
		}, { rootMargin: '600px' }).observe(els.more);
	}

	document.addEventListener('keydown', (e) => {
		if (e.key === '/' && document.activeElement !== els.search) { e.preventDefault(); els.search?.focus(); }
	});
}

wire();
load();
