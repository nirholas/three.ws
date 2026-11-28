// dashboard-next — Community Avatars page.
//
// Dedicated browse surface for every public avatar on the platform.
// Mirrors the "Community" tab from /dashboard/avatars but as a first-class
// page: full-width, no tab overhead, deep-linkable, sidebar-accessible.

import { mountShell } from '../shell.js';
import { requireUser, get, esc, relTime, ApiError } from '../api.js';
import { onchainBadgeHTML, ensureOnchainBadgeStyles } from '../../shared/onchain-badge.js';
import { rigBadgeHTML, RIG_FILTERS } from '../../shared/rig-status.js';
import { ensureStateKitStyles } from '../../shared/state-kit.js';
import { buildEmbedCredit } from '../../../api/_lib/embed.js';
ensureStateKitStyles();

const PAGE_SIZE = 24;
const SORTS = [
	{ key: 'newest',   label: 'Newest',      cmp: (a, b) => ts(b.created_at) - ts(a.created_at) },
	{ key: 'views',    label: 'Most viewed',  cmp: (a, b) => (Number(b.view_count) || 0) - (Number(a.view_count) || 0) },
	{ key: 'name_asc', label: 'Name A→Z',     cmp: (a, b) => (a.name || '').localeCompare(b.name || '') },
];

const compactNum = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const integerNum = new Intl.NumberFormat('en');

const state = {
	all: /** @type {any[]} */ ([]),
	nextCursor: /** @type {string|null} */ (null),
	loading: false,
	loaded: false,
	total: /** @type {number|null} */ (null),
	totalViews: /** @type {number|null} */ (null),
	loadedTags: /** @type {Set<string>} */ (new Set()),
	filter: { q: '', tag: '', rigged: 'all', sort: 'newest' },
	io: /** @type {IntersectionObserver|null} */ (null),
	searchTimer: /** @type {any} */ (null),
};

(async function boot() {
	const main = await mountShell();
	await requireUser();
	injectStyles();
	ensureOnchainBadgeStyles();

	main.innerHTML = `
		<div class="ca-head">
			<div>
				<h1 class="dn-h1">Community Avatars</h1>
				<p class="dn-h1-sub">Every public avatar the community has built — remix, embed, or open any of them.</p>
			</div>
			<div class="ca-head-actions">
				<a class="dn-btn primary" href="/create/prompt">+ New avatar</a>
			</div>
		</div>

		<div class="ca-filters">
			<label class="ca-search">
				<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>
				<input type="search" placeholder="Search avatars…" data-q autocomplete="off" aria-label="Search community avatars" />
			</label>
			<div class="ca-chips" role="tablist" aria-label="Rig filter">
				${RIG_FILTERS.map((f) => `
					<button type="button" class="ca-chip${f.key === 'all' ? ' active' : ''}" data-rig="${f.key}" role="tab" aria-selected="${f.key === 'all'}">${f.label}</button>
				`).join('')}
			</div>
			<label class="ca-sort">
				<select data-sort aria-label="Sort avatars">
					${SORTS.map((s) => `<option value="${s.key}">${s.label}</option>`).join('')}
				</select>
			</label>
			<span class="ca-stat" data-stat aria-live="polite"></span>
		</div>

		<div class="ca-tags" data-tags aria-label="Tag filters"></div>

		<div data-error hidden></div>
		<div class="ca-grid" data-grid></div>
		<div class="ca-loadmore" data-loadmore hidden></div>
		<div class="ca-toaster" data-toaster aria-live="polite"></div>
	`;

	wireFilters(main);
	loadInitial(main);
})();

// ── Data loading ──────────────────────────────────────────────────────────

async function loadInitial(root) {
	state.all = [];
	state.nextCursor = null;
	state.loaded = false;
	state.loadedTags = new Set();
	const grid = root.querySelector('[data-grid]');
	renderSkeletons(grid, 8);
	hideError(root);

	try {
		const params = new URLSearchParams({ limit: String(PAGE_SIZE), totals: '1' });
		if (state.filter.q) params.set('q', state.filter.q);
		if (state.filter.tag) params.set('tag', state.filter.tag);
		if (state.filter.rigged !== 'all') params.set('rigged', state.filter.rigged);
		const data = await get(`/api/avatars/public?${params.toString()}`);
		const rows = Array.isArray(data?.avatars) ? data.avatars : [];
		state.all = rows;
		state.nextCursor = data?.next_cursor || null;
		state.total = typeof data?.total === 'number' ? data.total : null;
		state.totalViews = typeof data?.total_views === 'number' ? data.total_views : null;
		state.loaded = true;
		rows.forEach((a) => (a.tags || []).forEach((t) => state.loadedTags.add(t)));
		updateStat(root);
		renderTags(root);
		renderGrid(root);
		setupLoadMore(root);
	} catch (err) {
		showError(root, err, () => loadInitial(root));
		grid.innerHTML = '';
	}
}

async function loadMore(root) {
	if (!state.nextCursor || state.loading) return;
	state.loading = true;
	const btn = root.querySelector('[data-loadmore-btn]');
	if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
	try {
		const params = new URLSearchParams({ limit: String(PAGE_SIZE), cursor: state.nextCursor });
		if (state.filter.q) params.set('q', state.filter.q);
		if (state.filter.tag) params.set('tag', state.filter.tag);
		if (state.filter.rigged !== 'all') params.set('rigged', state.filter.rigged);
		const data = await get(`/api/avatars/public?${params.toString()}`);
		const more = Array.isArray(data?.avatars) ? data.avatars : [];
		state.all = state.all.concat(more);
		state.nextCursor = data?.next_cursor || null;
		more.forEach((a) => (a.tags || []).forEach((t) => state.loadedTags.add(t)));
		renderTags(root);
		renderGrid(root);
		setupLoadMore(root);
	} catch (err) {
		toast(root, msgOf(err) || 'Failed to load more', true);
		if (btn) { btn.disabled = false; btn.textContent = 'Load more'; }
	} finally {
		state.loading = false;
	}
}

// ── Filters ───────────────────────────────────────────────────────────────

function wireFilters(root) {
	const qInput = root.querySelector('[data-q]');
	qInput.addEventListener('input', () => {
		clearTimeout(state.searchTimer);
		state.searchTimer = setTimeout(() => {
			state.filter.q = qInput.value.trim();
			loadInitial(root);
		}, 280);
	});

	const rigBtns = [...root.querySelectorAll('[data-rig]')];
	// Roving tabindex: only the selected tab is in the tab order; arrows move within.
	rigBtns.forEach((b) => b.setAttribute('tabindex', b.getAttribute('aria-selected') === 'true' ? '0' : '-1'));
	const selectRig = (btn) => {
		const v = btn.getAttribute('data-rig');
		if (state.filter.rigged !== v) {
			state.filter.rigged = v;
			loadInitial(root);
		}
		rigBtns.forEach((x) => {
			const on = x === btn;
			x.classList.toggle('active', on);
			x.setAttribute('aria-selected', on ? 'true' : 'false');
			x.setAttribute('tabindex', on ? '0' : '-1');
		});
	};
	rigBtns.forEach((btn, i) => {
		btn.addEventListener('click', () => selectRig(btn));
		btn.addEventListener('keydown', (e) => {
			let next = -1;
			if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % rigBtns.length;
			else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + rigBtns.length) % rigBtns.length;
			else if (e.key === 'Home') next = 0;
			else if (e.key === 'End') next = rigBtns.length - 1;
			else return;
			e.preventDefault();
			const target = rigBtns[next];
			target.focus();
			selectRig(target);
		});
	});

	root.querySelector('[data-sort]').addEventListener('change', (e) => {
		state.filter.sort = e.target.value;
		renderGrid(root);
	});

	root.querySelector('[data-tags]').addEventListener('click', (e) => {
		const btn = e.target.closest('[data-tag]');
		if (!btn) return;
		const tag = btn.getAttribute('data-tag');
		state.filter.tag = state.filter.tag === tag ? '' : tag;
		renderTags(root);
		loadInitial(root);
	});
}

// ── Rendering ─────────────────────────────────────────────────────────────

function applySort(rows) {
	const cmp = SORTS.find((s) => s.key === state.filter.sort)?.cmp;
	return cmp ? [...rows].sort(cmp) : rows;
}

function renderGrid(root) {
	const grid = root.querySelector('[data-grid]');
	const rows = applySort(state.all);

	if (!rows.length) {
		grid.innerHTML = '';
		const empty = document.createElement('div');
		empty.className = 'ca-empty';
		empty.style.gridColumn = '1 / -1';
		if (state.filter.q || state.filter.tag) {
			empty.innerHTML = `
				<div class="ca-empty-icon">🔍</div>
				<h3>No matches</h3>
				<p>No public avatars match the current search or tag.<br>Clear the filters to see the whole community gallery.</p>
				<div class="ca-empty-actions">
					<button class="dn-btn ghost" type="button" data-clear-filters>Clear filters</button>
				</div>
			`;
			empty.querySelector('[data-clear-filters]').addEventListener('click', () => {
				state.filter.q = '';
				state.filter.tag = '';
				const qInput = root.querySelector('[data-q]');
				if (qInput) qInput.value = '';
				renderTags(root);
				loadInitial(root);
			});
		} else {
			empty.innerHTML = `
				<div class="ca-empty-icon">🎭</div>
				<h3>No public avatars yet</h3>
				<p>Be the first — build an avatar and set it to public so it appears here for everyone.</p>
				<div class="ca-empty-actions">
					<a class="dn-btn primary" href="/create/prompt">Describe it · prompt → 3D</a>
					<a class="dn-btn ghost" href="/create/studio">Build from scratch</a>
				</div>
			`;
		}
		grid.appendChild(empty);
		return;
	}

	const ids = rows.map((a) => a.id).join('|');
	if (grid.dataset.ids === ids) return;
	grid.dataset.ids = ids;

	grid.innerHTML = '';
	for (const a of rows) grid.appendChild(avatarCard(root, a));
}

function renderTags(root) {
	const host = root.querySelector('[data-tags]');
	const tags = [...state.loadedTags].sort((a, b) => a.localeCompare(b)).slice(0, 32);
	const active = state.filter.tag;
	const all = active && !tags.includes(active) ? [active, ...tags] : tags;
	if (!all.length) { host.innerHTML = ''; return; }
	host.innerHTML = all.map((t) =>
		`<button type="button" class="ca-chip${t === active ? ' active' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`
	).join('');
}

function updateStat(root) {
	const stat = root.querySelector('[data-stat]');
	if (!stat) return;
	const parts = [];
	if (typeof state.total === 'number') parts.push(`${integerNum.format(state.total)} avatars`);
	if (state.totalViews) parts.push(`${compactNum.format(state.totalViews)} views`);
	stat.textContent = parts.join(' · ');
}

// ── Avatar card ───────────────────────────────────────────────────────────

let _openMenu = null;

function closeOpenMenu() {
	if (_openMenu) { _openMenu.remove(); _openMenu = null; }
}

function avatarCard(root, a) {
	const el = document.createElement('div');
	el.className = 'ca-card';
	el.dataset.id = a.id;

	const views = Number(a.view_count) || 0;
	const onchain = onchainBadgeHTML(a, { link: false, size: 'sm', showChain: false });
	const tagBits = (a.tags || []).slice(0, 2).map((t) => `<span class="dn-tag">${esc(t)}</span>`).join('');

	el.innerHTML = `
		<div class="ca-thumb">
			<threews-avatar avatar-id="${esc(a.id)}" hide-chrome bg="transparent"></threews-avatar>
			<div class="ca-hover-actions">
				<a class="ca-hover-btn" href="/avatars/${encodeURIComponent(a.id)}" target="_blank" rel="noopener">Live page</a>
				<a class="ca-hover-btn" href="/app#avatar=${encodeURIComponent(a.id)}">Remix in 3D</a>
			</div>
			<button type="button" class="ca-more" data-more aria-haspopup="menu" aria-expanded="false" aria-label="More actions">
				<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="8" cy="3" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="8" cy="13" r="1.4"/></svg>
			</button>
		</div>
		<div class="ca-body">
			<div class="ca-name-row">
				<span class="ca-name" title="${esc(a.name || 'Untitled')}">${esc(a.name || 'Untitled')}</span>
			</div>
			<div class="ca-meta">
				${onchain}
				${rigBadgeHTML(a, { size: 'sm' })}
				${tagBits}
				${views ? `<span class="ca-rel">${compactNum.format(views)} views</span>` : ''}
				<span class="ca-rel">${esc(relTime(a.created_at))}</span>
			</div>
		</div>
	`;

	const moreBtn = el.querySelector('[data-more]');
	moreBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		if (_openMenu && _openMenu.dataset.for === a.id) { moreBtn.setAttribute('aria-expanded', 'false'); closeOpenMenu(); return; }
		closeOpenMenu();
		openMenu(root, moreBtn, a);
	});

	return el;
}

function openMenu(root, anchor, a) {
	const menu = document.createElement('div');
	menu.className = 'ca-menu';
	menu.dataset.for = a.id;
	menu.setAttribute('role', 'menu');
	const shareUrl = `${location.origin}/avatars/${encodeURIComponent(a.id)}`;
	const items = [
		{ label: 'View live page',       run: () => window.open(`/avatars/${encodeURIComponent(a.id)}`, '_blank') },
		{ label: 'Remix in 3D studio',   run: () => { location.href = `/app#avatar=${encodeURIComponent(a.id)}`; } },
		{ label: 'Copy share link',      run: () => copyText(root, shareUrl, 'Share link copied') },
		{ label: 'Copy embed snippet',   run: () => copyEmbed(root, a) },
		{ label: 'Copy GLB URL',         run: () => {
			if (!a.model_url) { toast(root, 'No GLB URL available', true); return; }
			copyText(root, a.model_url, 'GLB URL copied');
		} },
	];
	menu.innerHTML = items.map((item, i) =>
		`<button type="button" class="ca-menu-item" data-i="${i}" role="menuitem" tabindex="-1">${esc(item.label)}</button>`
	).join('');
	document.body.appendChild(menu);
	positionMenu(menu, anchor);
	requestAnimationFrame(() => menu.classList.add('open'));
	_openMenu = menu;

	const menuItems = [...menu.querySelectorAll('[data-i]')];
	const focusItem = (i) => {
		const n = menuItems.length;
		const idx = ((i % n) + n) % n;
		menuItems[idx]?.focus();
	};
	anchor.setAttribute('aria-expanded', 'true');
	// Move focus into the menu so it's operable by keyboard the moment it opens.
	setTimeout(() => focusItem(0), 0);

	menuItems.forEach((b, i) => {
		b.addEventListener('click', () => { const idx = Number(b.dataset.i); closeMenu(); items[idx].run(); });
		b.addEventListener('keydown', (e) => {
			if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(i + 1); }
			else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(i - 1); }
			else if (e.key === 'Home') { e.preventDefault(); focusItem(0); }
			else if (e.key === 'End') { e.preventDefault(); focusItem(menuItems.length - 1); }
		});
	});

	const teardown = () => {
		document.removeEventListener('click', onDocClick);
		document.removeEventListener('keydown', onKey);
	};
	// Close and restore focus to the trigger so keyboard users aren't stranded.
	const closeMenu = ({ restoreFocus = false } = {}) => {
		teardown();
		anchor.setAttribute('aria-expanded', 'false');
		closeOpenMenu();
		if (restoreFocus) anchor.focus();
	};
	const onDocClick = (e) => {
		if (menu.contains(e.target) || anchor.contains(e.target)) return;
		closeMenu();
	};
	const onKey = (e) => {
		if (e.key === 'Escape') { e.preventDefault(); closeMenu({ restoreFocus: true }); }
		else if (e.key === 'Tab') { closeMenu(); }
	};
	setTimeout(() => {
		document.addEventListener('click', onDocClick);
		document.addEventListener('keydown', onKey);
	}, 0);
}

function positionMenu(menu, anchor) {
	const r = anchor.getBoundingClientRect();
	menu.style.position = 'fixed';
	menu.style.top = `${Math.round(r.bottom + 6)}px`;
	const width = 210;
	let left = Math.round(r.right - width);
	if (left < 8) left = 8;
	if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
	menu.style.left = `${left}px`;
	menu.style.width = `${width}px`;
}

async function copyEmbed(root, a) {
	const safeName = (a.name || 'avatar').replace(/"/g, '&quot;');
	const u = new URL('/a-embed.html', location.origin);
	u.searchParams.set('avatar', a.id);
	const snippet = `<iframe src="${u.toString()}" width="360" height="540" style="border:0;border-radius:12px;max-width:100%" allow="xr-spatial-tracking" sandbox="allow-scripts allow-same-origin allow-popups" title="${safeName}" loading="lazy"></iframe>\n${buildEmbedCredit({
		href: new URL(`/avatars/${encodeURIComponent(a.id)}`, location.origin).toString(),
		text: '3D avatar on',
		subject: a.name || '',
	})}`;
	await copyText(root, snippet, 'Embed snippet copied');
}

async function copyText(root, text, okMsg) {
	try {
		await navigator.clipboard.writeText(text);
		toast(root, okMsg);
	} catch {
		toast(root, 'Copy failed — clipboard blocked', true);
	}
}

// ── Load more ─────────────────────────────────────────────────────────────

function setupLoadMore(root) {
	const host = root.querySelector('[data-loadmore]');
	if (state.io) { state.io.disconnect(); state.io = null; }
	if (!state.nextCursor) {
		host.hidden = true;
		host.innerHTML = '';
		return;
	}
	host.hidden = false;
	host.innerHTML = `<button class="dn-btn ghost" type="button" data-loadmore-btn>Load more</button>`;
	host.querySelector('[data-loadmore-btn]').addEventListener('click', () => loadMore(root));
	state.io = new IntersectionObserver((entries) => {
		for (const e of entries) { if (e.isIntersecting) { loadMore(root); break; } }
	}, { rootMargin: '300px 0px' });
	state.io.observe(host);
}

// ── Skeletons, error, toast ───────────────────────────────────────────────

function renderSkeletons(grid, n) {
	grid.innerHTML = '';
	for (let i = 0; i < n; i++) {
		const sk = document.createElement('div');
		sk.className = 'ca-card ca-card-skeleton';
		sk.innerHTML = `
			<div class="dn-skeleton" style="width:100%;height:280px;border-radius:12px"></div>
			<div class="dn-skeleton" style="width:60%;height:14px;margin-top:10px"></div>
			<div class="dn-skeleton" style="width:40%;height:11px;margin-top:6px"></div>
		`;
		grid.appendChild(sk);
	}
}

function showError(root, err, onRetry) {
	const host = root.querySelector('[data-error]');
	host.hidden = false;
	host.innerHTML = `
		<div class="ca-error-banner">
			<div>
				<strong>Couldn't load avatars.</strong>
				<div class="ca-error-sub">${esc(msgOf(err) || 'Network error')}</div>
			</div>
			<button class="dn-btn" type="button" data-retry>Retry</button>
		</div>
	`;
	host.querySelector('[data-retry]').addEventListener('click', () => {
		hideError(root);
		onRetry();
	});
}

function hideError(root) {
	const host = root.querySelector('[data-error]');
	host.hidden = true;
	host.innerHTML = '';
}

function toast(root, message, isError = false) {
	const host = root.querySelector('[data-toaster]');
	if (!host) return;
	const t = document.createElement('div');
	t.className = `ca-toast${isError ? ' err' : ''}`;
	t.textContent = message;
	host.appendChild(t);
	requestAnimationFrame(() => t.classList.add('show'));
	setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 200); }, 3200);
}

function ts(iso) {
	const n = new Date(iso).getTime();
	return Number.isFinite(n) ? n : 0;
}

function msgOf(err) {
	if (err instanceof ApiError) return err.message;
	return err?.message || String(err || '');
}

// ── Styles ────────────────────────────────────────────────────────────────

function injectStyles() {
	if (document.getElementById('ca-css')) return;
	const css = document.createElement('style');
	css.id = 'ca-css';
	css.textContent = `
		.ca-head {
			display: flex;
			align-items: flex-start;
			justify-content: space-between;
			gap: 16px;
			margin-bottom: 20px;
		}
		.ca-head .dn-h1, .ca-head .dn-h1-sub { margin-bottom: 0; }
		.ca-head .dn-h1-sub { margin-top: 4px; }
		.ca-head-actions { flex-shrink: 0; padding-top: 4px; }

		.ca-filters {
			display: flex;
			align-items: center;
			gap: 10px;
			margin-bottom: 14px;
			flex-wrap: wrap;
		}
		.ca-search {
			flex: 1 1 260px;
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 7px 12px;
			background: rgba(255,255,255,0.04);
			border: 1px solid var(--nxt-stroke);
			border-radius: var(--nxt-radius-pill);
			color: var(--nxt-ink-dim);
			transition: border-color 0.12s ease, background 0.12s ease;
		}
		.ca-search:focus-within {
			border-color: var(--nxt-stroke-strong);
			background: rgba(255,255,255,0.06);
		}
		.ca-search input {
			flex: 1;
			background: transparent;
			border: 0;
			outline: 0;
			color: var(--nxt-ink);
			font-size: 13px;
			min-width: 0;
		}
		.ca-search input::placeholder { color: var(--nxt-ink-fade); }

		.ca-chips { display: flex; gap: 4px; flex-wrap: wrap; }
		.ca-chip {
			background: transparent;
			border: 1px solid var(--nxt-stroke);
			color: var(--nxt-ink-dim);
			font-size: 12px;
			padding: 6px 12px;
			border-radius: var(--nxt-radius-pill);
			cursor: pointer;
			transition: all 0.12s ease;
		}
		.ca-chip:hover { color: var(--nxt-ink); background: rgba(255,255,255,0.04); }
		.ca-chip:active { transform: translateY(1px); }
		.ca-chip:focus-visible { outline: 2px solid var(--nxt-accent); outline-offset: 2px; }
		.ca-chip.active {
			background: rgba(255,255,255,0.08);
			border-color: var(--nxt-stroke-strong);
			color: var(--nxt-ink);
		}

		.ca-sort select {
			background: rgba(255,255,255,0.04);
			color: var(--nxt-ink);
			border: 1px solid var(--nxt-stroke);
			border-radius: var(--nxt-radius-sm);
			padding: 7px 28px 7px 12px;
			font-size: 13px;
			cursor: pointer;
			appearance: none;
			background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6' fill='none' stroke='%239ca0aa' stroke-width='1.5'><path d='M1 1l4 4 4-4'/></svg>");
			background-repeat: no-repeat;
			background-position: right 10px center;
			transition: border-color 0.12s ease;
		}
		.ca-sort select:hover { border-color: var(--nxt-stroke-strong); }
		.ca-sort select:focus-visible { outline: 2px solid var(--nxt-accent); outline-offset: 2px; }

		.ca-stat {
			font-size: 12px;
			color: var(--nxt-ink-fade);
			margin-left: auto;
			white-space: nowrap;
		}

		.ca-tags {
			display: flex;
			flex-wrap: wrap;
			gap: 6px;
			margin-bottom: 18px;
		}
		.ca-tags:empty { display: none; }

		/* Grid */
		.ca-grid {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
			gap: 16px;
		}

		/* Card */
		.ca-card {
			background: linear-gradient(180deg, rgba(20, 21, 28, 0.7), rgba(14, 15, 22, 0.5));
			border: 1px solid var(--nxt-stroke);
			border-radius: var(--nxt-radius);
			padding: 10px;
			transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
		}
		.ca-card:hover {
			transform: scale(1.015);
			box-shadow: 0 8px 24px rgba(0,0,0,0.4);
			border-color: var(--nxt-stroke-strong);
		}
		.ca-card-skeleton:hover { transform: none; box-shadow: none; }

		.ca-thumb {
			position: relative;
			width: 100%;
			height: 280px;
			border-radius: 10px;
			overflow: hidden;
			background:
				radial-gradient(ellipse 60% 50% at 50% 100%, rgba(200,202,208,0.06) 0%, transparent 70%),
				linear-gradient(180deg, rgba(28, 29, 39, 0.5), rgba(14, 15, 22, 0.5));
		}
		.ca-thumb threews-avatar {
			display: block;
			width: 100%;
			height: 100%;
		}

		.ca-more {
			position: absolute;
			top: 8px;
			right: 8px;
			width: 28px;
			height: 28px;
			display: grid;
			place-items: center;
			border: 1px solid var(--nxt-stroke);
			background: rgba(14, 15, 22, 0.7);
			color: var(--nxt-ink);
			border-radius: 8px;
			cursor: pointer;
			opacity: 0;
			transition: opacity 0.16s ease, background 0.12s ease, border-color 0.12s ease;
			backdrop-filter: blur(8px);
		}
		.ca-card:hover .ca-more,
		.ca-more:focus-visible { opacity: 1; }
		.ca-more:hover { background: var(--nxt-bg-3); border-color: var(--nxt-stroke-strong); }
		.ca-more:focus-visible { outline: 2px solid var(--nxt-accent); outline-offset: 2px; }

		.ca-hover-actions {
			position: absolute;
			left: 0; right: 0; bottom: 0;
			display: flex;
			gap: 6px;
			justify-content: center;
			padding: 10px 12px 12px;
			background: linear-gradient(0deg, rgba(0,0,0,0.55) 0%, transparent 100%);
			opacity: 0;
			transform: translateY(4px);
			transition: opacity 0.18s ease, transform 0.18s ease;
			pointer-events: none;
			z-index: 2;
		}
		.ca-card:hover .ca-hover-actions {
			opacity: 1;
			transform: translateY(0);
			pointer-events: auto;
		}
		.ca-hover-btn {
			padding: 5px 12px;
			font-size: 12px;
			font-weight: 500;
			color: var(--nxt-ink);
			background: rgba(14, 15, 22, 0.7);
			border: 1px solid var(--nxt-stroke);
			border-radius: 8px;
			backdrop-filter: blur(8px);
			-webkit-backdrop-filter: blur(8px);
			cursor: pointer;
			transition: background 0.12s ease, border-color 0.12s ease;
			white-space: nowrap;
		}
		.ca-hover-btn:hover {
			background: rgba(14, 15, 22, 0.9);
			border-color: var(--nxt-stroke-strong);
		}
		.ca-hover-btn:focus-visible { outline: 2px solid var(--nxt-accent); outline-offset: 2px; }

		.ca-body { padding: 10px 4px 4px; }
		.ca-name-row {
			display: flex;
			align-items: center;
			gap: 6px;
			margin-bottom: 6px;
		}
		.ca-name {
			font-size: 13.5px;
			font-weight: 600;
			color: var(--nxt-ink);
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			flex: 1;
		}
		.ca-meta {
			display: flex;
			align-items: center;
			gap: 8px;
			flex-wrap: wrap;
		}
		.ca-rel {
			font-size: 11.5px;
			color: var(--nxt-ink-fade);
		}

		/* Empty state */
		.ca-empty {
			text-align: center;
			padding: 64px 20px;
		}
		.ca-empty-icon { font-size: 48px; margin-bottom: 16px; line-height: 1; }
		.ca-empty h3 { font-size: 18px; font-weight: 600; color: var(--nxt-ink); margin: 0 0 8px; }
		.ca-empty p { font-size: 14px; color: var(--nxt-ink-dim); margin: 0 0 20px; line-height: 1.6; }
		.ca-empty-actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }

		/* More menu */
		.ca-menu {
			background: linear-gradient(180deg, rgba(28, 29, 39, 0.98), rgba(20, 21, 28, 0.98));
			border: 1px solid var(--nxt-stroke-strong);
			border-radius: var(--nxt-radius-sm);
			box-shadow: 0 16px 40px rgba(0,0,0,0.55);
			padding: 5px;
			z-index: 200;
			opacity: 0;
			transform: translateY(4px);
			transition: opacity 120ms ease, transform 120ms ease;
			backdrop-filter: blur(20px);
		}
		.ca-menu.open { opacity: 1; transform: translateY(0); }
		.ca-menu-item {
			display: block;
			width: 100%;
			text-align: left;
			background: transparent;
			border: 0;
			padding: 8px 11px;
			font-size: 13px;
			color: var(--nxt-ink);
			border-radius: 6px;
			cursor: pointer;
			font-family: inherit;
		}
		.ca-menu-item:hover,
		.ca-menu-item:focus-visible { background: rgba(255,255,255,0.06); outline: none; }
		.ca-menu-item:focus-visible { box-shadow: inset 0 0 0 1px var(--nxt-stroke-strong); }

		/* Load more */
		.ca-loadmore {
			display: flex;
			justify-content: center;
			padding: 26px 0 4px;
		}

		/* Error banner */
		.ca-error-banner {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			padding: 14px 16px;
			margin-bottom: 14px;
			border: 1px solid rgba(150,155,163,0.3);
			background: rgba(150,155,163,0.08);
			border-radius: var(--nxt-radius-sm);
			font-size: 13px;
			color: var(--nxt-ink);
		}
		.ca-error-sub { color: var(--nxt-ink-dim); font-size: 12.5px; margin-top: 2px; }

		/* Toaster */
		.ca-toaster {
			position: fixed;
			bottom: 24px;
			right: 24px;
			display: flex;
			flex-direction: column;
			gap: 8px;
			z-index: 400;
			pointer-events: none;
		}
		.ca-toast {
			padding: 10px 14px;
			background: linear-gradient(180deg, rgba(28, 29, 39, 0.98), rgba(20, 21, 28, 0.98));
			border: 1px solid var(--nxt-stroke-strong);
			border-radius: var(--nxt-radius-sm);
			color: var(--nxt-ink);
			font-size: 13px;
			box-shadow: 0 12px 32px rgba(0,0,0,0.45);
			opacity: 0;
			transform: translateY(8px);
			transition: opacity 200ms ease, transform 200ms ease;
			max-width: 320px;
		}
		.ca-toast.show { opacity: 1; transform: translateY(0); }
		.ca-toast.err { border-color: rgba(150,155,163,0.4); }

		@media (prefers-reduced-motion: reduce) {
			.ca-card, .ca-card:hover, .ca-more, .ca-hover-actions, .ca-menu, .ca-toast { transition: none; }
			.ca-card:hover { transform: none; }
		}

		@media (max-width: 720px) {
			.ca-head { flex-direction: column; align-items: stretch; }
			.ca-head-actions { align-self: flex-start; }
			.ca-grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
			.ca-thumb { height: 220px; }
			.ca-hover-actions {
				opacity: 1;
				transform: translateY(0);
				pointer-events: auto;
			}
			.ca-hover-btn { font-size: 11px; padding: 4px 9px; }
			.ca-stat { margin-left: 0; }
		}
	`;
	document.head.appendChild(css);
}
