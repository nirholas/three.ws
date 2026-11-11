/**
 * Shared list/grid controls toolkit — E03.
 *
 * One data-source-agnostic toolbar for every browse surface (/discover,
 * /marketplace, …): a debounced search input, a sort <select>, filter chip
 * segments, and a results count, all URL-synced so views are shareable and the
 * browser back/forward button restores them.
 *
 * The toolkit owns the CHROME (controls + their state + URL plumbing). It does
 * NOT fetch — the caller passes an `onChange(state, meta)` callback and runs
 * whatever real API it already uses. Loading / empty / error rendering is
 * delegated to the shared state-kit so every surface reads as one product.
 *
 * Two ways to use it:
 *
 *  1. Controller (full adoption — /discover):
 *       const lc = createListControls({
 *         mount: el, segments: [...], sortOptions: [...],
 *         searchPlaceholder: '…', onChange: (s) => loadPage(s),
 *       });
 *     The controller renders the bar, wires events + debounce, syncs the URL,
 *     and calls onChange whenever the user changes anything (and once on init
 *     after hydrating from the URL).
 *
 *  2. Helpers (incremental adoption — surfaces with bespoke markup):
 *       import { debounce, syncStateToUrl, readStateFromUrl } from './list-controls.js';
 *     Pure functions a page can drop into its existing wiring without ceding
 *     control of its DOM.
 *
 * CSS: ensureListControlsStyles() injects the stylesheet once (idempotent),
 * mirroring the state-kit pattern. The bar reuses the canonical design tokens
 * — never a parallel palette.
 */

import { ensureStateKitStyles } from './state-kit.js';

const STYLE_ID = 'tws-list-controls-styles';

function esc(s) {
	return String(s == null ? '' : s).replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
	);
}

/**
 * CSS.escape with a safe fallback for environments that don't expose it (older
 * runtimes, some test harnesses). Segment keys are author-controlled simple
 * identifiers, so the fallback only needs to neutralise selector metacharacters.
 */
function cssEscape(s) {
	const str = String(s == null ? '' : s);
	if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(str);
	return str.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

// ── Pure helpers (incremental-adoption surface) ─────────────────────────────

/**
 * Trailing-edge debounce. Returns a wrapped fn plus a `.cancel()` to drop any
 * pending call (e.g. on teardown or an explicit clear).
 * @param {Function} fn
 * @param {number} [wait=200]
 */
export function debounce(fn, wait = 200) {
	let t;
	const wrapped = (...args) => {
		clearTimeout(t);
		t = setTimeout(() => fn(...args), wait);
	};
	wrapped.cancel = () => clearTimeout(t);
	wrapped.flush = (...args) => {
		clearTimeout(t);
		fn(...args);
	};
	return wrapped;
}

/**
 * Read a list-view state object from the current URL's querystring.
 * Only keys present in `defaults` are read; anything else is ignored so a page
 * never picks up stray params. Values are coerced to the type of their default.
 *
 * @param {Record<string, string|null>} defaults  e.g. { q:'', sort:'newest', chain:'' }
 * @param {URLSearchParams} [params]
 * @returns {Record<string, string>}
 */
export function readStateFromUrl(defaults, params = new URLSearchParams(location.search)) {
	const out = {};
	for (const key of Object.keys(defaults)) {
		const v = params.get(key);
		out[key] = v == null ? defaults[key] : v;
	}
	return out;
}

/**
 * Reflect a state object into the URL. Keys whose value equals the matching
 * `defaults` entry are dropped (canonical short URLs). Uses replaceState by
 * default to avoid history spam on each keystroke; pass push:true for
 * user-meaningful changes (chip click, sort change) so back/forward step
 * through them.
 *
 * @param {Record<string, string>} stateObj
 * @param {Record<string, string|null>} defaults
 * @param {{ push?: boolean }} [opts]
 */
export function syncStateToUrl(stateObj, defaults, { push = false } = {}) {
	const url = new URL(location.href);
	for (const key of Object.keys(defaults)) {
		const val = stateObj[key];
		if (val == null || val === '' || val === defaults[key]) url.searchParams.delete(key);
		else url.searchParams.set(key, String(val));
	}
	if (url.href === location.href) return;
	if (push) history.pushState({}, '', url);
	else history.replaceState({}, '', url);
}

// ── CSS injection ───────────────────────────────────────────────────────────

/** Inject the list-controls stylesheet once. Idempotent and SSR-safe. */
export function ensureListControlsStyles() {
	if (typeof document === 'undefined') return;
	ensureStateKitStyles(); // controls live alongside state-kit empty/error blocks
	if (document.getElementById(STYLE_ID)) return;
	const style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = LIST_CONTROLS_CSS;
	(document.head || document.documentElement).appendChild(style);
}

// ── Controller ──────────────────────────────────────────────────────────────

/**
 * @typedef {Object} Segment
 * @property {string} key       state key this segment writes to (e.g. 'filter', 'source')
 * @property {string} [label]   optional group label (visually hidden, used for aria-label)
 * @property {Array<{value:string,label:string}>} options
 *
 * @typedef {Object} ListControlsConfig
 * @property {Element} mount                 container the bar renders into
 * @property {string} [searchKey='q']        state key the search input writes to
 * @property {string} [searchPlaceholder]
 * @property {string} [searchLabel='Search']
 * @property {Array<{value:string,label:string}>} [sortOptions]
 * @property {string} [sortKey='sort']
 * @property {Segment[]} [segments]
 * @property {Record<string,string>} [defaults]  default value per state key
 * @property {number} [debounceMs=200]
 * @property {boolean} [urlSync=true]  when false the toolkit never touches the
 *   URL — the caller owns it (e.g. a page with a legacy/custom query scheme).
 *   Hydration from the URL still happens via `hydrate`.
 * @property {(params:URLSearchParams, defaults:Record<string,string>) => Record<string,string>} [hydrate]
 *   custom reader for the initial state (defaults to readStateFromUrl).
 * @property {(state:Record<string,string>, meta:{reason:string}) => void} onChange
 */

/**
 * Build and wire a list-controls bar. Returns a handle exposing the live state,
 * imperative setters, and a teardown.
 * @param {ListControlsConfig} config
 */
export function createListControls(config) {
	ensureListControlsStyles();

	const {
		mount,
		searchKey = 'q',
		searchPlaceholder = 'Search…',
		searchLabel = 'Search',
		sortOptions = [],
		sortKey = 'sort',
		segments = [],
		debounceMs = 200,
		urlSync = true,
		hydrate,
		onChange,
	} = config;

	if (!mount) throw new Error('createListControls: mount element is required');

	// Assemble the full default map: search + sort + every segment's first option.
	const defaults = { [searchKey]: '', ...(config.defaults || {}) };
	if (sortOptions.length && !(sortKey in defaults)) defaults[sortKey] = sortOptions[0].value;
	for (const seg of segments) {
		if (!(seg.key in defaults)) defaults[seg.key] = seg.options[0]?.value ?? '';
	}

	// Hydrate from URL so deep links + back/forward restore filters. A page with
	// a custom/legacy query scheme supplies its own reader via `hydrate`.
	const readState = (params) =>
		hydrate ? hydrate(params, defaults) : readStateFromUrl(defaults, params);
	const state = readState(new URLSearchParams(location.search));

	mount.classList.add('tws-lc');
	mount.innerHTML = buildBarHTML({
		state,
		searchKey,
		searchPlaceholder,
		searchLabel,
		sortOptions,
		sortKey,
		segments,
	});

	const $ = (sel) => mount.querySelector(sel);
	const searchInput = $('[data-lc="search"]');
	const searchClear = $('[data-lc="search-clear"]');
	const sortSelect = $('[data-lc="sort"]');
	const countEl = $('[data-lc="count"]');

	const emit = (reason, push) => {
		if (urlSync) syncStateToUrl(state, defaults, { push });
		onChange?.({ ...state }, { reason });
	};

	// ── Search (debounced) ──
	const runSearch = debounce(() => {
		const next = searchInput.value.trim();
		if (next === state[searchKey]) return;
		state[searchKey] = next;
		emit('search', false);
	}, debounceMs);

	if (searchInput) {
		searchInput.addEventListener('input', () => {
			updateClearVisibility();
			runSearch();
		});
		// Enter flushes immediately (don't make the user wait out the debounce).
		searchInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				runSearch.flush();
			}
		});
	}
	searchClear?.addEventListener('click', () => {
		searchInput.value = '';
		state[searchKey] = '';
		updateClearVisibility();
		runSearch.cancel();
		emit('search-clear', true);
		searchInput.focus();
	});

	// ── Sort ──
	sortSelect?.addEventListener('change', () => {
		state[sortKey] = sortSelect.value;
		emit('sort', true);
	});

	// ── Segment chips (delegated, survives nothing — bar is built once) ──
	mount.addEventListener('click', (e) => {
		const chip = e.target.closest('[data-lc-seg]');
		if (!chip) return;
		const key = chip.dataset.lcSeg;
		const value = chip.dataset.lcValue;
		if (state[key] === value) return;
		state[key] = value;
		for (const c of mount.querySelectorAll(`[data-lc-seg="${cssEscape(key)}"]`)) {
			const active = c.dataset.lcValue === value;
			c.classList.toggle('active', active);
			c.setAttribute('aria-pressed', active ? 'true' : 'false');
		}
		emit('segment', true);
	});

	// ── Keyboard arrow nav within a chip group ──
	mount.addEventListener('keydown', (e) => {
		if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
		const chip = e.target.closest('[data-lc-seg]');
		if (!chip) return;
		const group = chip.closest('[data-lc-seg-group]');
		if (!group) return;
		const chips = [...group.querySelectorAll('[data-lc-seg]')];
		const i = chips.indexOf(chip);
		const next = e.key === 'ArrowRight' ? chips[i + 1] : chips[i - 1];
		if (next) {
			e.preventDefault();
			next.focus();
		}
	});

	function updateClearVisibility() {
		if (searchClear) searchClear.hidden = !searchInput.value;
	}
	updateClearVisibility();

	// Restore on popstate so back/forward re-hydrate the bar + re-run onChange.
	const onPop = () => {
		const restored = readState(new URLSearchParams(location.search));
		Object.assign(state, restored);
		syncControlsToState();
		onChange?.({ ...state }, { reason: 'popstate' });
	};
	window.addEventListener('popstate', onPop);

	function syncControlsToState() {
		if (searchInput) searchInput.value = state[searchKey] || '';
		updateClearVisibility();
		if (sortSelect) sortSelect.value = state[sortKey] ?? sortSelect.value;
		for (const seg of segments) {
			for (const c of mount.querySelectorAll(`[data-lc-seg="${cssEscape(seg.key)}"]`)) {
				const active = c.dataset.lcValue === state[seg.key];
				c.classList.toggle('active', active);
				c.setAttribute('aria-pressed', active ? 'true' : 'false');
			}
		}
	}
	syncControlsToState();

	return {
		/** Current state snapshot (copy). */
		getState: () => ({ ...state }),
		/** True when any control differs from its default (drives "clear filters"). */
		isFiltered: () => Object.keys(defaults).some((k) => state[k] !== defaults[k]),
		/** Programmatically reset every control to its default and re-emit. */
		reset: () => {
			Object.assign(state, defaults);
			runSearch.cancel();
			syncControlsToState();
			emit('reset', true);
		},
		/** Set the visible results count (or hide it with null/''). */
		setCount: (text) => {
			if (!countEl) return;
			countEl.textContent = text || '';
			countEl.hidden = !text;
		},
		/** Fire onChange once after wiring (callers that don't want an init call skip this). */
		emitInitial: () => onChange?.({ ...state }, { reason: 'init' }),
		destroy: () => {
			runSearch.cancel();
			window.removeEventListener('popstate', onPop);
		},
	};
}

// ── Bar markup ───────────────────────────────────────────────────────────────

function buildBarHTML({ state, searchKey, searchPlaceholder, searchLabel, sortOptions, sortKey, segments }) {
	const searchVal = esc(state[searchKey] || '');
	const searchHTML = `
		<div class="tws-lc-search">
			<svg class="tws-lc-search-icon" width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
				<circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5"/>
				<path d="M11 11l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
			</svg>
			<input type="search" data-lc="search" value="${searchVal}"
				placeholder="${esc(searchPlaceholder)}" aria-label="${esc(searchLabel)}"
				autocomplete="off" spellcheck="false" />
			<button type="button" class="tws-lc-search-clear" data-lc="search-clear"
				aria-label="Clear search"${searchVal ? '' : ' hidden'}>
				<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
					<path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
				</svg>
			</button>
		</div>`;

	const segmentsHTML = segments
		.map((seg) => {
			const active = state[seg.key];
			const chips = seg.options
				.map((o) => {
					const on = o.value === active;
					return `<button type="button" class="tws-lc-chip${on ? ' active' : ''}"
						data-lc-seg="${esc(seg.key)}" data-lc-value="${esc(o.value)}"
						aria-pressed="${on ? 'true' : 'false'}">${esc(o.label)}</button>`;
				})
				.join('');
			return `<div class="tws-lc-chips" role="group"${seg.label ? ` aria-label="${esc(seg.label)}"` : ''} data-lc-seg-group>${chips}</div>`;
		})
		.join('');

	const sortHTML = sortOptions.length
		? `<div class="tws-lc-sort">
				<label class="tws-lc-sort-label" for="tws-lc-sort-${esc(sortKey)}">Sort</label>
				<div class="tws-lc-select">
					<select id="tws-lc-sort-${esc(sortKey)}" data-lc="sort" aria-label="Sort results">
						${sortOptions
							.map(
								(o) =>
									`<option value="${esc(o.value)}"${o.value === state[sortKey] ? ' selected' : ''}>${esc(o.label)}</option>`,
							)
							.join('')}
					</select>
					<svg class="tws-lc-select-caret" width="11" height="7" viewBox="0 0 12 8" fill="none" aria-hidden="true">
						<path d="M1 1.5L6 6.5L11 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
				</div>
			</div>`
		: '';

	return `
		<div class="tws-lc-row tws-lc-row--primary">
			${searchHTML}
			${sortHTML}
		</div>
		${segmentsHTML ? `<div class="tws-lc-row tws-lc-row--segments">${segmentsHTML}</div>` : ''}
		<div class="tws-lc-count" data-lc="count" role="status" aria-live="polite" hidden></div>`;
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const LIST_CONTROLS_CSS = `
/* ═══════════════════════════════════════════════════════════════════════════
   three.ws list-controls — shared search / sort / filter toolbar (E03)
   Source: src/shared/list-controls.js · Namespace: tws-lc-*
   Token-driven only; no parallel palette.
   ═══════════════════════════════════════════════════════════════════════════ */

.tws-lc {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm, 0.618rem);
}
.tws-lc-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm, 0.618rem);
  flex-wrap: wrap;
}
.tws-lc-row--segments { gap: var(--space-md, 1rem); }

/* ── Search ── */
.tws-lc-search {
  position: relative;
  flex: 1 1 260px;
  min-width: 0;
  display: flex;
  align-items: center;
}
.tws-lc-search-icon {
  position: absolute;
  left: 12px;
  color: var(--ink-dim, #888);
  pointer-events: none;
}
.tws-lc-search input {
  width: 100%;
  padding: 9px 34px 9px 34px;
  background: var(--surface-1, rgba(255,255,255,0.03));
  border: 1px solid var(--stroke, rgba(255,255,255,0.08));
  border-radius: var(--radius-md, 10px);
  color: var(--ink, #e8e8e8);
  font: var(--weight-medium, 500) var(--text-md, 13px)/1.2 var(--font-body, system-ui, sans-serif);
  transition: border-color var(--duration-fast, 140ms) var(--ease-standard, ease),
              background var(--duration-fast, 140ms) var(--ease-standard, ease);
}
.tws-lc-search input::placeholder { color: var(--ink-faint, rgba(255,255,255,0.45)); }
.tws-lc-search input:hover { border-color: var(--stroke-strong, rgba(255,255,255,0.14)); }
.tws-lc-search input:focus-visible,
.tws-lc-search input:focus {
  outline: none;
  border-color: var(--accent, #fff);
  background: var(--surface-2, rgba(255,255,255,0.05));
}
.tws-lc-search input[type='search']::-webkit-search-cancel-button {
  -webkit-appearance: none;
  appearance: none;
}
.tws-lc-search-clear {
  position: absolute;
  right: 7px;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: var(--radius-pill, 999px);
  background: var(--surface-3, rgba(255,255,255,0.08));
  color: var(--ink-dim, #888);
  cursor: pointer;
  transition: background var(--duration-fast, 140ms) var(--ease-standard, ease),
              color var(--duration-fast, 140ms) var(--ease-standard, ease);
}
.tws-lc-search-clear:hover { background: var(--surface-3, rgba(255,255,255,0.12)); color: var(--ink, #e8e8e8); }
.tws-lc-search-clear:focus-visible {
  outline: var(--focus-ring-width, 2px) solid var(--focus-ring-color, #fff);
  outline-offset: var(--focus-ring-offset, 2px);
}

/* ── Chips / segments ── */
.tws-lc-chips {
  display: inline-flex;
  gap: var(--space-2xs, 0.236rem);
  flex-wrap: wrap;
}
.tws-lc-chip {
  padding: 7px 13px;
  background: transparent;
  border: 1px solid var(--stroke-strong, rgba(255,255,255,0.14));
  border-radius: var(--radius-sm, 6px);
  color: var(--ink-dim, #888);
  font: var(--weight-medium, 500) var(--text-md, 13px)/1 var(--font-body, system-ui, sans-serif);
  cursor: pointer;
  white-space: nowrap;
  transition: border-color var(--duration-fast, 140ms) var(--ease-standard, ease),
              color var(--duration-fast, 140ms) var(--ease-standard, ease),
              background var(--duration-fast, 140ms) var(--ease-standard, ease);
}
.tws-lc-chip:hover { border-color: var(--stroke-strong, rgba(255,255,255,0.28)); color: var(--ink, #e8e8e8); }
.tws-lc-chip.active {
  background: var(--surface-3, rgba(255,255,255,0.10));
  border-color: var(--accent, rgba(255,255,255,0.4));
  color: var(--ink-bright, #fff);
}
.tws-lc-chip:focus-visible {
  outline: var(--focus-ring-width, 2px) solid var(--focus-ring-color, #fff);
  outline-offset: var(--focus-ring-offset, 2px);
}

/* ── Sort select ── */
.tws-lc-sort {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs, 0.382rem);
  color: var(--ink-dim, #888);
  font-size: var(--text-md, 13px);
  flex-shrink: 0;
}
.tws-lc-sort-label { color: var(--ink-dim, #888); }
.tws-lc-select { position: relative; display: inline-flex; align-items: center; }
.tws-lc-select select {
  appearance: none;
  -webkit-appearance: none;
  padding: 8px 30px 8px 11px;
  background: var(--surface-2, rgba(255,255,255,0.05));
  border: 1px solid var(--stroke-strong, rgba(255,255,255,0.14));
  border-radius: var(--radius-md, 10px);
  color: var(--ink, #e8e8e8);
  font: var(--weight-medium, 500) var(--text-md, 13px)/1 var(--font-body, system-ui, sans-serif);
  cursor: pointer;
  transition: background var(--duration-fast, 140ms) var(--ease-standard, ease),
              border-color var(--duration-fast, 140ms) var(--ease-standard, ease);
}
.tws-lc-select select:hover { background: var(--surface-3, rgba(255,255,255,0.08)); border-color: var(--stroke-strong, rgba(255,255,255,0.28)); }
.tws-lc-select select:focus-visible {
  outline: var(--focus-ring-width, 2px) solid var(--focus-ring-color, #fff);
  outline-offset: var(--focus-ring-offset, 2px);
}
.tws-lc-select select option { background: var(--bg-1, #1a1a1a); color: var(--ink, #e6e6e6); }
/* Light theme: a solid fill, because the translucent surface token let a dark
   card thumbnail scrolling under the sticky toolbar drop the text below AA. */
:root[data-theme='light'] .tws-lc-select select { background: #fff; }
:root[data-theme='light'] .tws-lc-select select:hover { background: #f3f4f6; }
.tws-lc-select-caret {
  position: absolute;
  right: 10px;
  color: var(--ink-dim, #888);
  pointer-events: none;
}

/* ── Result count ── */
.tws-lc-count {
  font-size: var(--text-sm, 12px);
  color: var(--ink-dim, #888);
  font-variant-numeric: tabular-nums;
}

@media (max-width: 600px) {
  .tws-lc-row--primary { flex-direction: column; align-items: stretch; }
  .tws-lc-sort { justify-content: space-between; }
  .tws-lc-select select { flex: 1; }
}
`;

if (typeof window !== 'undefined') {
	window.twsListControls = {
		createListControls,
		debounce,
		readStateFromUrl,
		syncStateToUrl,
		ensureListControlsStyles,
	};
}
