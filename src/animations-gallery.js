// /animations — public animation gallery.
//
// Surfaces three sources in one searchable, filterable grid:
//   • Community clips published by three.ws users (GET /api/animations/clips
//     ?include_public=true&visibility=public). Appear first, newest-first.
//   • The built-in three.ws motion library (/animations/manifest.json) — the
//     same curated clips the /pose studio ships with. Always present.
//   • The full motion library (GET /api/animations/library) — the complete
//     Mixamo-sourced catalog (2,800+ clips) hosted on the R2 CDN.
//
// All are normalized to one card shape — poster thumbnail, derived category
// (src/animation-categories.js), duration, loop mode — then filtered (search +
// category + loop/once), sorted, and paginated client-side (PAGE_SIZE at a time,
// infinite-scroll, lazy thumbnails).
//
// THE CATALOG IS LOADED ON DEMAND, one bounded page at a time, because it is the
// only source here with no ceiling on its size. A first load costs exactly one
// page plus the tiny ?facets=1 response, at any catalog size; further pages are
// fetched when the reader actually reaches the end of the grid. Loading every
// page up front was 3 requests at 3,007 clips and would be 30 at ten times that,
// paid by every visitor who looks at the first screen and leaves.
//
// Exact totals do NOT wait for that. ?facets=1 returns the catalog's size and
// its per-category counts in about half a kilobyte, computed with the same
// classifier this file uses, so the hero line and the filter chips read true
// from the first paint and never count up as pages arrive.
//
// Searching, filtering or re-sorting DOES need the whole catalog, because those
// run client-side over every clip, so those three actions drain the remaining
// pages in the background and the grid refreshes as they land. That is the
// trade: a deliberate narrowing pays for the catalog, idle browsing does not.
//
// Previews run through ONE shared WebGL engine (src/animations-live-preview.js):
// hovering a card (or opening the detail modal) moves the singleton canvas into
// that card and plays the retargeted clip on the preview avatar. No iframes,
// no per-card GL contexts, nothing 3D loaded until the first preview.
//
// Deep links: ?clip=<id> opens the detail modal; q/cat/filter/sort round-trip
// through the URL so filtered views are shareable.

import { GALLERY_CATEGORIES, galleryCategoryOf } from './animation-categories.js';
import { getLivePreview } from './animations-live-preview.js';

const API_BASE = '/api/animations/clips';
const MANIFEST_URL = '/animations/manifest.json';
const LIBRARY_API = '/api/animations/library';
const PAGE_SIZE = 36;
// Cap community pagination so a large catalog can't stall first paint.
const COMMUNITY_MAX = 300;
// Page size for the full CDN catalog fetch. Matches the endpoint's max page so
// each response stays bounded (~400 KB) as the library grows past thousands of
// clips, instead of one ever-growing blob. A hard ceiling of pages guards
// against a runaway manifest.
const LIBRARY_PAGE_SIZE = 1000;
const LIBRARY_MAX_PAGES = 50;
const HOVER_DELAY_MS = 130;

const REDUCED_MOTION = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const TOUCH_ONLY = window.matchMedia?.('(hover: none)').matches;

const $ = (role) => document.querySelector(`[data-role="${role}"]`);
const els = {
	loading: $('loading'),
	grid: $('grid'),
	empty: $('empty'),
	emptySearch: $('empty-search'),
	emptySearchMsg: $('empty-search-msg'),
	clearSearch: $('clear-search'),
	error: $('error'),
	retry: $('retry'),
	search: $('search'),
	chips: $('chips'),
	typeFilter: $('type-filter'),
	sort: $('sort'),
	count: $('count'),
	heroStats: $('hero-stats'),
	loadMore: $('load-more'),
	loadMoreBtn: $('load-more-btn'),
	sentinel: $('sentinel'),
	// Detail modal
	modal: $('modal'),
	modalStage: $('modal-stage'),
	modalSpinner: $('modal-spinner'),
	modalTitle: $('modal-title'),
	modalMeta: $('modal-meta'),
	modalTags: $('modal-tags'),
	modalStudio: $('modal-studio'),
	modalCopyLink: $('modal-copy-link'),
	modalCopyEmbed: $('modal-copy-embed'),
	modalPlay: $('modal-play'),
	modalSpeed: $('modal-speed'),
	modalSpeedVal: $('modal-speed-val'),
	modalScrub: $('modal-scrub'),
	modalTime: $('modal-time'),
	modalClose: $('modal-close'),
	modalPrev: $('modal-prev'),
	modalNext: $('modal-next'),
	modalError: $('modal-error'),
	modalTransport: $('modal-transport'),
};

// URL params are user-editable, so every one is validated against the values the
// UI can actually represent. An unknown ?sort= used to blank the sort <select>,
// and an unknown ?cat= filtered the whole grid away with no chip to clear it.
const TYPE_FILTERS = new Set(['', 'loop', 'once']);
const SORTS = new Set(['featured', 'az', 'za', 'shortest', 'longest', 'shuffle']);
const CATEGORY_KEYS = new Set(GALLERY_CATEGORIES.map((c) => c.key));
const oneOf = (allowed, value, fallback) => (allowed.has(value) ? value : fallback);

const params = new URLSearchParams(location.search);
const state = {
	query: params.get('q') || '',
	filter: oneOf(TYPE_FILTERS, params.get('filter') || '', ''), // '' | loop | once
	category: oneOf(CATEGORY_KEYS, params.get('cat') || '', ''), // '' | GALLERY_CATEGORIES key
	sort: oneOf(SORTS, params.get('sort') || 'featured', 'featured'),
	all: [],
	filtered: [],
	shown: 0,
	loaded: false,
	modalIndex: -1, // index into state.filtered while the modal is open
	// Names the curated manifest already surfaces, so the same clip never lands
	// twice when the catalog page carrying it arrives.
	curatedNames: new Set(),
	shuffleSeed: (Math.random() * 0xffffffff) >>> 0,
	catalog: {
		offset: 0, // next page to request
		loaded: 0, // rows merged into state.all so far
		total: 0, // full catalog size, known from ?facets=1 before any page lands
		byCategory: new Map(), // merged rows per category, to net off the facets
		facets: null, // Map<categoryKey, count> over the WHOLE catalog
		pending: null, // in-flight page, so overlapping triggers coalesce
		draining: false,
		done: false,
		failed: false,
	},
};

const live = getLivePreview();

if (state.query) els.search.value = state.query;
if (els.sort) els.sort.value = state.sort;
syncTypeFilter();

// ── URL state ──────────────────────────────────────────────────────────────

function syncUrl(clipId) {
	const p = new URLSearchParams();
	if (state.query) p.set('q', state.query);
	if (state.category) p.set('cat', state.category);
	if (state.filter) p.set('filter', state.filter);
	if (state.sort !== 'featured') p.set('sort', state.sort);
	if (clipId) p.set('clip', clipId);
	const qs = p.toString();
	const next = qs ? `${location.pathname}?${qs}` : location.pathname;
	if (next !== location.pathname + location.search) history.replaceState(null, '', next);
}

// ── Fetch + normalize ───────────────────────────────────────────────────────

async function fetchLibrary() {
	const res = await fetch(MANIFEST_URL, { cache: 'force-cache' });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const manifest = await res.json();
	if (!Array.isArray(manifest)) return [];
	return manifest.map(normalizeLibraryClip);
}

async function fetchCommunity() {
	const out = [];
	let cursor = null;
	while (out.length < COMMUNITY_MAX) {
		const p = new URLSearchParams({ include_public: 'true', visibility: 'public', limit: '50' });
		if (cursor) p.set('cursor', cursor);
		const res = await fetch(`${API_BASE}?${p}`, { credentials: 'include' });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = await res.json();
		const incoming = Array.isArray(data.items) ? data.items : [];
		out.push(...incoming);
		cursor = data.next_cursor || null;
		if (!cursor || incoming.length === 0) break;
	}
	return out.slice(0, COMMUNITY_MAX).map(normalizeCommunityClip);
}

/**
 * Catalog size and per-category counts, without a single clip attached. The
 * counts come from the same classifier this file uses, so a chip and the
 * endpoint can never disagree, and they are exact from the first paint however
 * many pages are still unfetched.
 */
async function fetchCatalogFacets() {
	const res = await fetch(`${LIBRARY_API}?facets=1`, { cache: 'force-cache' });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const data = await res.json();
	const cat = state.catalog;
	cat.total = Number(data.total) || 0;
	cat.facets = new Map(
		(Array.isArray(data.categories) ? data.categories : []).map((c) => [c.key, Number(c.count) || 0]),
	);
}

/**
 * Fetch ONE bounded page of the catalog and merge it into the grid. Overlapping
 * callers (the scroll sentinel and a drain running together) share the one
 * in-flight request rather than racing two pages at the same offset.
 *
 * Resolves to false once the catalog is exhausted or has failed, which is what
 * lets drainCatalog() terminate.
 *
 * @returns {Promise<boolean>} whether a page was merged
 */
function loadCatalogPage() {
	const cat = state.catalog;
	if (cat.pending) return cat.pending;
	if (cat.done || cat.failed) return Promise.resolve(false);
	if (cat.offset >= LIBRARY_PAGE_SIZE * LIBRARY_MAX_PAGES) {
		cat.done = true;
		return Promise.resolve(false);
	}

	cat.pending = (async () => {
		const url = `${LIBRARY_API}?limit=${LIBRARY_PAGE_SIZE}&offset=${cat.offset}`;
		const res = await fetch(url, { cache: 'force-cache' });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = await res.json();
		const rows = Array.isArray(data.clips) ? data.clips : [];
		if (!cat.total) cat.total = Number(data.total) || 0;

		const fresh = rows
			.map(normalizeFullLibraryClip)
			.filter((c) => !state.curatedNames.has(c.id));
		for (const clip of fresh) {
			cat.byCategory.set(clip.category, (cat.byCategory.get(clip.category) || 0) + 1);
		}
		cat.loaded += fresh.length;
		if (fresh.length) state.all = state.all.concat(fresh);
		if (data.next_offset == null || rows.length === 0) cat.done = true;
		else cat.offset = Number(data.next_offset);
		return fresh.length > 0;
	})()
		.catch((err) => {
			// One bad page must not strand the grid the reader is already using,
			// and must not spin the sentinel: mark the catalog failed so the
			// counts stop promising rows that will never arrive.
			cat.failed = true;
			cat.done = true;
			throw err;
		})
		.finally(() => {
			cat.pending = null;
		});

	return cat.pending;
}

/**
 * Load every remaining page. Search, category and sort all run client-side over
 * the whole set, so narrowing the view is the moment the rest of the catalog has
 * to exist. The grid repaints as each page lands, keeping what is already on
 * screen in place.
 */
async function drainCatalog() {
	const cat = state.catalog;
	if (cat.draining) return;
	cat.draining = true;
	try {
		await drainLoop(cat);
	} finally {
		cat.draining = false;
	}
}

/** @param {typeof state.catalog} cat */
async function drainLoop(cat) {
	while (!cat.done && !cat.failed) {
		let merged = false;
		try {
			merged = await loadCatalogPage();
		} catch {
			break;
		}
		if (merged && state.loaded) refreshAfterCatalogPage();
	}
}

/** Repaint the counts and the grid around a page that just landed. */
function refreshAfterCatalogPage() {
	renderHeroStats();
	renderChips();
	applyFilters({ preserveShown: true });
}

function normalizeLibraryClip(clip) {
	return {
		id: clip.name,
		source: 'library',
		name: clip.label || clip.name,
		loop: clip.loop !== false,
		icon: clip.icon || '🎬',
		tags: [],
		category: galleryCategoryOf(clip.name, clip.label),
		duration_ms: clip.duration ? Math.round(clip.duration * 1000) : null,
		url: clip.url, // site-relative clip JSON — playable by the live preview
		thumbnail_url: `/animations/thumbs/${encodeURIComponent(clip.name)}.webp`,
		price: null,
	};
}

function normalizeFullLibraryClip(clip) {
	return {
		id: clip.name,
		source: 'mixamo',
		name: clip.label || clip.name,
		loop: clip.loop !== false,
		icon: clip.icon || '🎬',
		tags: clip.category ? [clip.category] : [],
		category: galleryCategoryOf(clip.name, clip.label),
		duration_ms: clip.duration ? Math.round(clip.duration * 1000) : null,
		url: clip.url, // absolute CDN url
		// The library manifest publishes a `thumb` url only for clips that have
		// one baked. Guessing the CDN convention for the rest (853 of 2,874 today)
		// requested an object that is never there: every one 404s, and the browser
		// logs a blocked cross-origin read before the card falls back to its icon.
		// No thumb in the manifest means no request.
		thumbnail_url: clip.thumb || null,
		price: null,
	};
}

function normalizeCommunityClip(clip) {
	return {
		id: clip.id,
		source: 'community',
		name: clip.name || 'Untitled',
		loop: clip.loop !== false,
		icon: '🎬',
		tags: Array.isArray(clip.tags) ? clip.tags : [],
		category: galleryCategoryOf(clip.id, clip.name),
		duration_ms: clip.duration_ms || null,
		url: null, // fetched through /api/animations/clips/:id by the preview engine
		thumbnail_url: clip.thumbnail_url || null,
		price: clip.price || null,
	};
}

async function loadAll() {
	showState('loading');
	// Retry restarts every source, so the catalog cursor restarts with them.
	state.catalog = {
		offset: 0,
		loaded: 0,
		total: 0,
		byCategory: new Map(),
		facets: null,
		pending: null,
		draining: false,
		done: false,
		failed: false,
	};
	// The curated manifest and the community feed are both small and bounded, so
	// they are awaited together. The catalog is the unbounded one, and exactly
	// one page of it is loaded here: the rest arrives when a reader scrolls to
	// the end of the grid or narrows it. First paint costs the same whether the
	// catalog holds three thousand clips or thirty.
	const [libRes, comRes] = await Promise.allSettled([fetchLibrary(), fetchCommunity()]);
	const library = libRes.status === 'fulfilled' ? libRes.value : [];
	const community = comRes.status === 'fulfilled' ? comRes.value : [];

	// Community clips lead (fresh, human-authored); the curated library follows;
	// the catalog trails, minus anything the curated set already surfaces.
	state.curatedNames = new Set(library.map((c) => c.id));
	state.all = [...community, ...library];

	// The counts and the first page are independent requests, so they fly
	// together: the hero line and the chips are exact the moment the grid paints
	// rather than one page behind it.
	const [facetRes, pageRes] = await Promise.allSettled([fetchCatalogFacets(), loadCatalogPage()]);
	const fullFailed = pageRes.status === 'rejected';

	const results = [libRes, comRes, { status: fullFailed ? 'rejected' : 'fulfilled' }];
	state.loaded = true;
	if (facetRes.status === 'rejected') {
		// Without facets the totals fall back to what is actually loaded, which
		// is only right once everything is: drain rather than show a count that
		// contradicts the grid.
		drainCatalog();
	}

	// Nothing to show AND at least one source errored is a failure, not an empty
	// library: "be the first to publish" would be a lie, and Retry is the action
	// the user needs. A genuinely empty catalog (every source answered, none had
	// clips) still falls through to the empty state below.
	if (state.all.length === 0 && results.some((r) => r.status === 'rejected')) {
		showState('error');
		return;
	}

	renderHeroStats();
	renderChips();
	applyFilters();

	// ?clip= deep link → open the modal once data exists.
	const wanted = new URLSearchParams(location.search).get('clip');
	if (wanted) await openDeepLink(wanted);
}

/**
 * Open ?clip=<id>. The clip may live on a catalog page nobody has asked for
 * yet, so a miss loads the rest of the catalog before it gives up: a shared
 * link has to open the clip it names whatever the reader's scroll position is.
 *
 * @param {string} wanted
 */
async function openDeepLink(wanted) {
	for (;;) {
		const idx = state.filtered.findIndex((c) => c.id === wanted);
		if (idx >= 0) {
			openModal(idx);
			return;
		}
		const item = state.all.find((c) => c.id === wanted);
		if (item) {
			// Visible under different filters, so clear them for the link.
			state.query = '';
			state.category = '';
			state.filter = '';
			els.search.value = '';
			syncTypeFilter();
			renderChips();
			applyFilters();
			openModal(state.filtered.findIndex((c) => c.id === wanted));
			return;
		}
		if (state.catalog.done || state.catalog.failed) return;
		try {
			await loadCatalogPage();
		} catch {
			return;
		}
		refreshAfterCatalogPage();
	}
}

// ── Hero stats + chips ───────────────────────────────────────────────────────

/**
 * Catalog rows that exist but have not been fetched yet. Counting them keeps
 * every total on the page equal to what the library actually holds, so nothing
 * ticks upward as the reader scrolls.
 */
function catalogPending() {
	const cat = state.catalog;
	if (!cat.total || cat.failed) return 0;
	return Math.max(0, cat.total - cat.loaded);
}

/** Every clip the gallery can show, loaded or not. */
function totalClips() {
	return state.all.length + catalogPending();
}

/**
 * Per-category counts over the whole gallery: what is loaded, plus the catalog
 * rows still unfetched, taken from the facets and netted against the rows of
 * that category already merged so nothing is counted twice.
 *
 * @returns {Map<string, number>}
 */
function categoryCounts() {
	const counts = new Map();
	for (const item of state.all) counts.set(item.category, (counts.get(item.category) || 0) + 1);
	const cat = state.catalog;
	if (cat.facets && !cat.failed) {
		for (const [key, total] of cat.facets) {
			const pending = Math.max(0, total - (cat.byCategory.get(key) || 0));
			if (pending) counts.set(key, (counts.get(key) || 0) + pending);
		}
	}
	return counts;
}

function renderHeroStats() {
	if (!els.heroStats) return;
	const total = totalClips();
	const community = state.all.filter((c) => c.source === 'community').length;
	const cats = [...categoryCounts().values()].filter(Boolean).length;
	els.heroStats.textContent = `${total.toLocaleString()} clips · ${cats} categories${
		community ? ` · ${community} community-authored` : ''
	}`;
}

function renderChips() {
	if (!els.chips) return;
	const counts = categoryCounts();
	els.chips.innerHTML = '';
	const mk = (key, label, icon, count) => {
		const btn = document.createElement('button');
		btn.className = 'ag-chip';
		btn.setAttribute('role', 'tab');
		btn.dataset.cat = key;
		btn.setAttribute('aria-selected', String(state.category === key));
		btn.innerHTML = `${icon ? `<span aria-hidden="true">${icon}</span> ` : ''}${escHtml(label)}${
			count != null ? ` <span class="ag-chip-count">${count.toLocaleString()}</span>` : ''
		}`;
		els.chips.appendChild(btn);
	};
	mk('', 'All', '', totalClips());
	for (const cat of GALLERY_CATEGORIES) {
		const n = counts.get(cat.key);
		if (n) mk(cat.key, cat.label, cat.icon, n);
	}
}

function syncChips() {
	els.chips?.querySelectorAll('[data-cat]').forEach((btn) => {
		btn.setAttribute('aria-selected', String(btn.dataset.cat === state.category));
	});
}

// Keep the loop/once segmented control showing what is actually filtering. The
// chips render from state on every pass; these three buttons are static markup,
// so a ?filter= deep link (or the clear-filters button) has to press them.
function syncTypeFilter() {
	els.typeFilter?.querySelectorAll('[data-filter]').forEach((btn) => {
		btn.setAttribute('aria-pressed', String((btn.dataset.filter || '') === state.filter));
	});
}

// ── Filter + sort + render ───────────────────────────────────────────────────

/**
 * Recompute the filtered set and repaint.
 *
 * `preserveShown` keeps the reader where they are when a catalog page lands
 * under them: the grid is rebuilt, but out to the same number of cards it held
 * a moment ago instead of collapsing back to the first screen.
 *
 * @param {{ preserveShown?: boolean }} [opts]
 */
function applyFilters({ preserveShown = false } = {}) {
	const keep = preserveShown ? state.shown : 0;
	// A user action re-deals the shuffle; a page arriving underneath one does not.
	if (!preserveShown) state.shuffleSeed = (Math.random() * 0xffffffff) >>> 0;
	const q = state.query.toLowerCase();
	state.filtered = state.all.filter((item) => {
		if (state.filter === 'loop' && !item.loop) return false;
		if (state.filter === 'once' && item.loop) return false;
		if (state.category && item.category !== state.category) return false;
		if (q) {
			const hay = `${item.name} ${item.tags.join(' ')} ${item.category}`.toLowerCase();
			if (!hay.includes(q)) return false;
		}
		return true;
	});
	sortFiltered();
	state.shown = 0;
	renderCount();
	renderGrid();
	while (state.shown < keep && state.shown < state.filtered.length) renderGrid();

	// A narrowed view has to be complete to be honest: "63 of 3,119" must mean
	// every clip that matches, not every clip that matches among the pages that
	// happen to be loaded. Sorting is the same argument: every order but the
	// source order ranks the whole gallery. Browsing unnarrowed is the only case
	// that can be served a page at a time, and it is the common one.
	const narrowed = Boolean(state.query || state.category || state.filter) || state.sort !== 'featured';
	if (narrowed && !state.catalog.done && !state.catalog.failed) drainCatalog();
}

/**
 * Stable pseudo-random ordering key for the shuffle sort: the same clip keeps
 * the same place for as long as the seed does.
 *
 * @param {string} id
 */
function shuffleKey(id) {
	let h = state.shuffleSeed >>> 0;
	for (let i = 0; i < id.length; i++) {
		h = Math.imul(h ^ id.charCodeAt(i), 3432918353);
		h = (h << 13) | (h >>> 19);
	}
	return h >>> 0;
}

function sortFiltered() {
	const arr = state.filtered;
	switch (state.sort) {
		case 'az':
			arr.sort((a, b) => a.name.localeCompare(b.name));
			break;
		case 'za':
			arr.sort((a, b) => b.name.localeCompare(a.name));
			break;
		case 'shortest':
			arr.sort((a, b) => (a.duration_ms ?? 1e9) - (b.duration_ms ?? 1e9));
			break;
		case 'longest':
			arr.sort((a, b) => (b.duration_ms ?? -1) - (a.duration_ms ?? -1));
			break;
		case 'shuffle':
			// Ordered by a hash of the clip id against the current seed rather than
			// by swapping in place. The hand is still random, and still re-dealt
			// whenever the reader changes a chip or the search (applyFilters reseeds
			// on a user action), but it no longer depends on the order clips
			// arrived in: a catalog page landing mid-scroll slots its cards into
			// the existing order instead of dealing everything again under the
			// reader's cursor.
			arr.sort((a, b) => shuffleKey(a.id) - shuffleKey(b.id));
			break;
		default:
			// 'featured' — the assembled source order (community → curated → catalog).
			break;
	}
}

function renderCount() {
	if (!els.count) return;
	if (!state.loaded) {
		els.count.textContent = '';
		return;
	}
	const n = state.filtered.length;
	const total = totalClips();
	els.count.textContent = n === total
		? `${n.toLocaleString()} animations`
		: `${n.toLocaleString()} of ${total.toLocaleString()}`;
}

function renderGrid() {
	if (state.filtered.length === 0) {
		// Nothing matches YET is not the same as nothing matches: a narrow filter
		// can exclude every clip loaded so far while the page holding its matches
		// is still unfetched. Keep the loading state and pull the rest in.
		if (!state.catalog.done && !state.catalog.failed) {
			showState('loading');
			drainCatalog();
			return;
		}
		if (state.all.length === 0) {
			showState('empty');
		} else {
			showState('empty-search');
			if (els.emptySearchMsg) {
				els.emptySearchMsg.textContent = state.query
					? `No animations match “${state.query}”.`
					: 'No animations match these filters.';
			}
		}
		return;
	}

	showState('grid');

	const start = state.shown;
	const end = Math.min(start + PAGE_SIZE, state.filtered.length);
	if (start === 0) {
		live.stop();
		els.grid.innerHTML = '';
	}

	const fragment = document.createDocumentFragment();
	for (let i = start; i < end; i++) {
		fragment.appendChild(buildCard(state.filtered[i], i));
	}
	els.grid.appendChild(fragment);
	state.shown = end;

	els.loadMore.hidden = state.shown >= state.filtered.length;

	// Every loaded clip is on screen and the catalog has more: fetch the next
	// page. This covers both ways a reader reaches the end: scrolling a long
	// grid, and landing on a view whose matches all fit without scrolling at
	// all, which no scroll sentinel would ever fire for.
	if (els.loadMore.hidden && !state.catalog.done && !state.catalog.failed) {
		loadCatalogPage()
			.then((merged) => {
				if (merged) refreshAfterCatalogPage();
			})
			.catch(() => {});
	}
}

function showMore() {
	if (state.shown < state.filtered.length) renderGrid();
}

function fmtDuration(ms) {
	if (ms == null) return '';
	const s = ms / 1000;
	if (s < 60) return `${s.toFixed(1)}s`;
	const m = Math.floor(s / 60);
	return `${m}m ${Math.round(s % 60)}s`;
}

const CATEGORY_BY_KEY = new Map(GALLERY_CATEGORIES.map((c) => [c.key, c]));

function sourceLabel(source) {
	return source === 'community' ? 'Community' : source === 'mixamo' ? 'Mocap' : 'Studio';
}

// ── Card ────────────────────────────────────────────────────────────────────

function buildCard(clip, index) {
	const card = document.createElement('article');
	card.className = 'ag-card';
	card.dataset.index = String(index);

	const cat = CATEGORY_BY_KEY.get(clip.category);
	const studioUrl = `/pose?anim=${encodeURIComponent(clip.id)}`;

	card.innerHTML = `
		<div class="ag-card-preview" role="button" tabindex="0"
			aria-label="${escHtml(clip.name)}: open details">
			${clip.thumbnail_url
				? `<img class="ag-card-thumb" src="${escHtml(clip.thumbnail_url)}" alt="" loading="lazy" decoding="async" />`
				: ''}
			<div class="ag-card-thumb-fallback" aria-hidden="true" ${clip.thumbnail_url ? 'hidden' : ''}>${escHtml(clip.icon || '🎬')}</div>
			<div class="ag-card-live" aria-hidden="true"></div>
			<span class="ag-card-duration">${fmtDuration(clip.duration_ms)}</span>
			${clip.loop ? '' : '<span class="ag-card-once" title="Plays once">once</span>'}
			${clip.price ? `<span class="ag-card-price">$${(Number(clip.price.amount) / 1_000_000).toFixed(2)}</span>` : ''}
		</div>
		<div class="ag-card-meta">
			<h3 class="ag-card-title" title="${escHtml(clip.name)}">${escHtml(clip.name)}</h3>
			<div class="ag-card-sub">
				<button class="ag-card-cat" data-cat-jump="${escHtml(clip.category)}"
					title="Show all ${escHtml(cat?.label || 'More')} animations">${cat?.icon || ''} ${escHtml(cat?.label || 'More')}</button>
				<span class="ag-card-source">${sourceLabel(clip.source)}</span>
			</div>
			<div class="ag-card-actions">
				<a href="${escHtml(studioUrl)}" class="ag-card-btn ag-card-btn--primary"
					title="Open this animation in the Studio to remix or apply to your avatar">Open in Studio</a>
				<button class="ag-card-btn" data-details
					aria-label="Details and preview for ${escHtml(clip.name)}">Details</button>
			</div>
		</div>
	`;

	const previewZone = card.querySelector('.ag-card-preview');
	const liveHost = card.querySelector('.ag-card-live');
	const img = card.querySelector('.ag-card-thumb');
	const fallback = card.querySelector('.ag-card-thumb-fallback');
	if (img && fallback) {
		img.addEventListener('error', () => {
			img.remove();
			fallback.hidden = false;
		});
	}

	// Hover → live preview through the shared engine (skipped for touch and
	// reduced-motion users; both get the full preview in the details modal).
	if (!TOUCH_ONLY && !REDUCED_MOTION) {
		let hoverTimer = 0;
		previewZone.addEventListener('mouseenter', () => {
			hoverTimer = setTimeout(() => {
				card.classList.add('is-loading-preview');
				live
					.play(liveHost, clip)
					.then(() => {
						if (live.active === clip) card.classList.add('is-live');
					})
					.catch(() => {})
					.finally(() => card.classList.remove('is-loading-preview'));
			}, HOVER_DELAY_MS);
		});
		previewZone.addEventListener('mouseleave', () => {
			clearTimeout(hoverTimer);
			card.classList.remove('is-live', 'is-loading-preview');
			if (live.active === clip) live.stop();
		});
	}

	const open = () => openModal(index);
	previewZone.addEventListener('click', open);
	previewZone.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			open();
		}
	});
	card.querySelector('[data-details]').addEventListener('click', open);
	card.querySelector('[data-cat-jump]').addEventListener('click', (e) => {
		state.category = e.currentTarget.dataset.catJump || '';
		syncChips();
		syncUrl();
		applyFilters();
		window.scrollTo({ top: 0, behavior: 'smooth' });
	});

	return card;
}

function escHtml(s) {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

// ── Detail modal ─────────────────────────────────────────────────────────────

// The element that opened the modal, so closing returns focus where the user
// left it instead of dropping it on <body> and restarting the tab order.
let modalOpener = null;

function openModal(index) {
	const clip = state.filtered[index];
	if (!clip || !els.modal) return;
	// Stepping prev/next re-opens the modal; only a cold open owns the opener,
	// and only a cold open moves focus (stepping with the keyboard has to leave
	// focus on Next so the next press steps again).
	const coldOpen = els.modal.hidden;
	if (coldOpen && document.activeElement instanceof HTMLElement) {
		modalOpener = document.activeElement;
	}
	state.modalIndex = index;

	els.modalTitle.textContent = clip.name;
	const cat = CATEGORY_BY_KEY.get(clip.category);
	els.modalMeta.innerHTML = [
		cat ? `${cat.icon} ${escHtml(cat.label)}` : null,
		clip.duration_ms ? escHtml(fmtDuration(clip.duration_ms)) : null,
		clip.loop ? 'loops' : 'plays once',
		escHtml(sourceLabel(clip.source)),
	]
		.filter(Boolean)
		.map((x) => `<span>${x}</span>`)
		.join('<span class="ag-dot" aria-hidden="true">·</span>');
	els.modalTags.innerHTML = clip.tags?.length
		? clip.tags.slice(0, 8).map((t) => `<span class="ag-tag">${escHtml(t)}</span>`).join('')
		: '';
	els.modalStudio.href = `/pose?anim=${encodeURIComponent(clip.id)}`;
	els.modalError.hidden = true;
	els.modalSpinner.hidden = false;
	// Nothing is playing yet, so the transport would be a row of controls that
	// do nothing. It comes back the moment the clip is on the stage, and stays
	// away entirely if the preview fails.
	els.modalTransport.hidden = true;
	els.modalPrev.disabled = index <= 0;
	els.modalNext.disabled = index >= state.filtered.length - 1;

	// Transport defaults.
	els.modalSpeed.value = '1';
	els.modalSpeedVal.textContent = '1×';
	els.modalScrub.value = '0';
	setPlayIcon(false);

	els.modal.hidden = false;
	document.body.style.overflow = 'hidden';
	// Focus the dialog itself, not its close button: a screen reader then reads
	// the clip title first, and Space stays free for the play/pause shortcut the
	// on-screen hint advertises.
	if (coldOpen) els.modal.focus();
	syncUrl(clip.id);

	let scrubbing = false;
	els.modalScrub.oninput = () => {
		scrubbing = true;
		live.seek(Number(els.modalScrub.value) / 1000);
	};
	els.modalScrub.onchange = () => {
		scrubbing = false;
	};

	live
		.play(els.modalStage, clip, {
			onFrame: (t, d) => {
				if (!scrubbing && d > 0) {
					els.modalScrub.value = String(Math.round(((t % d) / d) * 1000));
					els.modalTime.textContent = `${(t % d).toFixed(1)}s / ${d.toFixed(1)}s`;
				}
			},
		})
		.then(() => {
			els.modalSpinner.hidden = true;
			els.modalTransport.hidden = false;
			live.refit();
		})
		.catch(() => {
			els.modalSpinner.hidden = true;
			els.modalError.hidden = false;
		});
}

function closeModal() {
	if (els.modal.hidden) return;
	els.modal.hidden = true;
	document.body.style.overflow = '';
	live.stop();
	state.modalIndex = -1;
	syncUrl();
	// The opener can be gone (a filter change rebuilt the grid under the modal);
	// fall back to the search field so focus never lands on <body>.
	const back = modalOpener?.isConnected ? modalOpener : els.search;
	modalOpener = null;
	back?.focus();
}

const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// aria-modal="true" promises the rest of the page is inert, so Tab has to wrap
// inside the dialog instead of walking off into the grid behind it.
function trapModalFocus(e) {
	const nodes = [...els.modal.querySelectorAll(FOCUSABLE)].filter(
		(n) => n.offsetWidth > 0 || n.offsetHeight > 0,
	);
	if (!nodes.length) return;
	const first = nodes[0];
	const last = nodes[nodes.length - 1];
	const active = document.activeElement;
	const outside = !els.modal.contains(active);
	if (e.shiftKey && (outside || active === first)) {
		e.preventDefault();
		last.focus();
	} else if (!e.shiftKey && (outside || active === last)) {
		e.preventDefault();
		first.focus();
	}
}

function stepModal(delta) {
	const next = state.modalIndex + delta;
	if (next < 0 || next >= state.filtered.length) return;
	// Ensure the card list has rendered far enough that "next" stays in sync
	// with what the user returns to after closing.
	while (state.shown <= next && state.shown < state.filtered.length) showMore();
	openModal(next);
}

function setPlayIcon(paused) {
	els.modalPlay.innerHTML = paused
		? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>'
		: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="4" width="5" height="16"/><rect x="14" y="4" width="5" height="16"/></svg>';
	els.modalPlay.setAttribute('aria-label', paused ? 'Play' : 'Pause');
}

els.modalPlay?.addEventListener('click', () => {
	const paused = !live.isPaused();
	live.setPaused(paused);
	setPlayIcon(paused);
});
els.modalSpeed?.addEventListener('input', () => {
	const f = Number(els.modalSpeed.value);
	live.setSpeed(f);
	els.modalSpeedVal.textContent = `${f}×`;
});
els.modalClose?.addEventListener('click', closeModal);
els.modalPrev?.addEventListener('click', () => stepModal(-1));
els.modalNext?.addEventListener('click', () => stepModal(1));
els.modal?.addEventListener('click', (e) => {
	if (e.target === els.modal) closeModal();
});
els.modalCopyLink?.addEventListener('click', async () => {
	const clip = state.filtered[state.modalIndex];
	if (!clip) return;
	const url = `${location.origin}/animations?clip=${encodeURIComponent(clip.id)}`;
	await navigator.clipboard.writeText(url).catch(() => {});
	flashButton(els.modalCopyLink, 'Copied!');
});
els.modalCopyEmbed?.addEventListener('click', async () => {
	const clip = state.filtered[state.modalIndex];
	if (!clip) return;
	const src = `${location.origin}/embed/avatar?anim=${encodeURIComponent(clip.id)}`;
	const snippet = `<iframe src="${src}" width="360" height="480" style="border:0;border-radius:12px" allow="autoplay" title="${clip.name} on three.ws"></iframe>`;
	await navigator.clipboard.writeText(snippet).catch(() => {});
	flashButton(els.modalCopyEmbed, 'Copied!');
});

function flashButton(btn, msg) {
	const prev = btn.textContent;
	btn.textContent = msg;
	btn.disabled = true;
	setTimeout(() => {
		btn.textContent = prev;
		btn.disabled = false;
	}, 1200);
}

// ── State display ──────────────────────────────────────────────────────────

function showState(which) {
	els.loading.hidden = which !== 'loading';
	els.grid.hidden = which !== 'grid';
	els.empty.hidden = which !== 'empty';
	els.emptySearch.hidden = which !== 'empty-search';
	els.error.hidden = which !== 'error';
	if (which !== 'grid') els.loadMore.hidden = true;
}

// ── Controls ───────────────────────────────────────────────────────────────

let searchDebounce;
els.search?.addEventListener('input', () => {
	clearTimeout(searchDebounce);
	searchDebounce = setTimeout(() => {
		state.query = els.search.value.trim();
		syncUrl();
		if (state.loaded) applyFilters();
	}, 180);
});

els.chips?.addEventListener('click', (e) => {
	const btn = e.target.closest('[data-cat]');
	if (!btn) return;
	state.category = btn.dataset.cat;
	syncChips();
	syncUrl();
	if (state.loaded) applyFilters();
});

els.typeFilter?.addEventListener('click', (e) => {
	const btn = e.target.closest('[data-filter]');
	if (!btn) return;
	state.filter = btn.dataset.filter || '';
	syncTypeFilter();
	syncUrl();
	if (state.loaded) applyFilters();
});

els.sort?.addEventListener('change', () => {
	state.sort = els.sort.value;
	syncUrl();
	if (state.loaded) applyFilters();
});

els.clearSearch?.addEventListener('click', () => {
	state.query = '';
	state.filter = '';
	state.category = '';
	els.search.value = '';
	syncTypeFilter();
	syncChips();
	syncUrl();
	if (state.loaded) applyFilters();
});

els.retry?.addEventListener('click', () => loadAll());
els.loadMoreBtn?.addEventListener('click', showMore);

// Infinite scroll sentinel.
if ('IntersectionObserver' in window && els.sentinel) {
	const observer = new IntersectionObserver(
		(entries) => {
			if (entries[0].isIntersecting) showMore();
		},
		{ rootMargin: '600px' },
	);
	observer.observe(els.sentinel);
}

// ── Keyboard ────────────────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
	if (!els.modal.hidden) {
		// The scrub and speed sliders own their own arrow and space keys; stealing
		// them would scrub and step the clip list at the same time.
		const tag = document.activeElement?.tagName || '';
		const onSlider = /^(INPUT|SELECT|TEXTAREA)$/.test(tag);
		if (e.key === 'Escape') closeModal();
		else if (e.key === 'Tab') trapModalFocus(e);
		else if (onSlider) return;
		else if (e.key === 'ArrowLeft') stepModal(-1);
		else if (e.key === 'ArrowRight') stepModal(1);
		else if (e.key === ' ' && tag !== 'BUTTON' && tag !== 'A' && !els.modalTransport.hidden) {
			e.preventDefault();
			els.modalPlay.click();
		}
		return;
	}
	const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
	if (e.key === '/' && !typing) {
		e.preventDefault();
		els.search.focus();
	} else if (e.key === 'Escape' && typing && document.activeElement === els.search) {
		els.search.blur();
	}
});

// ── Boot ───────────────────────────────────────────────────────────────────

loadAll();
