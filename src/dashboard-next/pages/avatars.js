// dashboard-next — Avatars page.
//
// Grid of every avatar the signed-in user owns, with live 3D thumbnails
// (via the <threews-avatar> web component from /embed.js), inline rename,
// visibility chips, cursor pagination, and a more-menu with embed / view
// / download / delete actions.

import { mountShell } from '../shell.js';
import { requireUser, get, patch, del, esc, relTime, ApiError } from '../api.js';
import { openSelfieModal } from '../../selfie-modal.js';
import { openAvatarPicker } from '../../avatar-gallery-picker.js';
import { createFromTemplate } from '../../shared/template-picker.js';
import { onchainBadgeHTML, ensureOnchainBadgeStyles } from '../../shared/onchain-badge.js';
import { walletChipHTML, wireWalletChips } from '../../shared/agent-wallet-chip.js';
import { rigBadgeHTML, matchesRigFilter, RIG_FILTERS } from '../../shared/rig-status.js';
import { emptyStateEl, ensureStateKitStyles } from '../../shared/state-kit.js';
ensureStateKitStyles();

const PAGE_SIZE = 24;
const VISIBILITIES = ['public', 'unlisted', 'private'];
const SORTS = [
	{ key: 'newest', label: 'Newest', cmp: (a, b) => ts(b.updated_at) - ts(a.updated_at) },
	{ key: 'oldest', label: 'Oldest', cmp: (a, b) => ts(a.updated_at) - ts(b.updated_at) },
	{ key: 'name_asc', label: 'Name A→Z', cmp: (a, b) => (a.name || '').localeCompare(b.name || '') },
	{ key: 'name_desc', label: 'Name Z→A', cmp: (a, b) => (b.name || '').localeCompare(a.name || '') },
];
// Community sorts apply client-side over already-loaded public avatars. The
// public feed is server-ordered newest-first, so "newest" is the natural pass.
const COMMUNITY_SORTS = [
	{ key: 'newest', label: 'Newest', cmp: (a, b) => ts(b.created_at) - ts(a.created_at) },
	{ key: 'views', label: 'Most viewed', cmp: (a, b) => (Number(b.view_count) || 0) - (Number(a.view_count) || 0) },
	{ key: 'name_asc', label: 'Name A→Z', cmp: (a, b) => (a.name || '').localeCompare(b.name || '') },
];

const compactNum = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const integerNum = new Intl.NumberFormat('en');

const state = {
	tab: /** @type {'mine'|'community'} */ ('mine'),
	all: /** @type {any[]} */ ([]),
	loaded: false,
	nextCursor: /** @type {string|null} */ (null),
	loadingMore: false,
	filter: { q: '', visibility: 'all', rigged: 'all', sort: 'newest' },
	io: /** @type {IntersectionObserver|null} */ (null),
	// Community ("all public avatars") view — independent data + filter slice so
	// switching tabs never clobbers the user's own list state.
	community: {
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
	},
};

(async function boot() {
	const main = await mountShell();
	await requireUser();
	injectStyles();
	ensureOnchainBadgeStyles();

	main.innerHTML = `
		<div class="dn-av-head">
			<div>
				<h1 class="dn-h1">Avatars</h1>
				<p class="dn-h1-sub" data-subtitle>Your 3D models, animated and ready to embed.</p>
			</div>
			<div class="dn-av-new-wrap">
				<button class="dn-btn primary" type="button" data-new>+ New avatar</button>
				<div class="dn-av-new-pop" data-new-pop hidden role="menu">
					<div class="dn-av-new-grp">Build</div>
					<button type="button" role="menuitem" data-new-template>Start from a template</button>
					<a href="/create/studio" role="menuitem">Build from scratch</a>
					<div class="dn-av-new-grp">From you</div>
					<button type="button" role="menuitem" data-new-selfie-quick>Snap a selfie</button>
					<a href="/create/selfie" role="menuitem">Full selfie flow</a>
					<a href="/create/prompt" role="menuitem">Describe it · prompt → 3D</a>
					<div class="dn-av-new-grp">Import</div>
					<a href="/create" role="menuitem">Upload a GLB</a>
					<a href="/marketplace" role="menuitem">From an existing avatar</a>
					<button type="button" role="menuitem" data-browse-gallery>Browse public gallery</button>
				</div>
			</div>
		</div>

		<div class="dn-av-tabs" role="tablist" aria-label="Avatar source">
			<button type="button" class="dn-av-tab active" data-tab="mine" role="tab" aria-selected="true">My avatars</button>
			<button type="button" class="dn-av-tab" data-tab="community" role="tab" aria-selected="false">
				Community
				<span class="dn-av-tab-count" data-community-count hidden></span>
			</button>
		</div>

		<div class="dn-av-filters" data-filters-mine>
			<label class="dn-av-search">
				<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>
				<input type="search" placeholder="Search avatars by name…" data-q autocomplete="off" aria-label="Search avatars by name" />
			</label>
			<div class="dn-av-chips" role="tablist" aria-label="Visibility filter">
				${['all', ...VISIBILITIES].map((v) => `
					<button type="button" class="dn-av-chip${v === 'all' ? ' active' : ''}" data-vis-chip="${v}" role="tab" aria-selected="${v === 'all'}">${v[0].toUpperCase() + v.slice(1)}</button>
				`).join('')}
			</div>
			<div class="dn-av-chips" role="tablist" aria-label="Rig filter">
				${RIG_FILTERS.map((f) => `
					<button type="button" class="dn-av-chip${f.key === 'all' ? ' active' : ''}" data-rig-chip="${f.key}" role="tab" aria-selected="${f.key === 'all'}">${f.label}</button>
				`).join('')}
			</div>
			<label class="dn-av-sort">
				<select data-sort aria-label="Sort">
					${SORTS.map((s) => `<option value="${s.key}">${s.label}</option>`).join('')}
				</select>
			</label>
		</div>

		<div class="dn-av-filters" data-filters-community hidden>
			<label class="dn-av-search">
				<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>
				<input type="search" placeholder="Search the community gallery…" data-cq autocomplete="off" aria-label="Search the community gallery" />
			</label>
			<div class="dn-av-chips" role="tablist" aria-label="Rig filter">
				${RIG_FILTERS.map((f) => `
					<button type="button" class="dn-av-chip${f.key === 'all' ? ' active' : ''}" data-crig-chip="${f.key}" role="tab" aria-selected="${f.key === 'all'}">${f.label}</button>
				`).join('')}
			</div>
			<label class="dn-av-sort">
				<select data-csort aria-label="Sort community avatars">
					${COMMUNITY_SORTS.map((s) => `<option value="${s.key}">${s.label}</option>`).join('')}
				</select>
			</label>
			<span class="dn-av-community-stat" data-community-stat aria-live="polite"></span>
		</div>

		<div class="dn-av-tags" data-community-tags hidden aria-label="Tag filters"></div>

		<div data-error hidden></div>
		<div class="dn-av-grid" data-grid></div>
		<div class="dn-av-loadmore" data-loadmore hidden></div>
		<div class="dn-av-toaster" data-toaster aria-live="polite"></div>
	`;

	wireTabs(main);
	wireFilters(main);
	wireCommunityFilters(main);
	wireNewMenu(main);
	main.querySelectorAll('[role="tablist"]').forEach(wireTablistKeys);

	// Deep-link support: /dashboard/avatars#community opens straight on the
	// Community tab (shareable / bookmarkable), and back/forward navigation
	// between the two tabs works via hashchange.
	window.addEventListener('hashchange', () => {
		switchTab(main, tabFromHash());
	});

	if (tabFromHash() === 'community') {
		switchTab(main, 'community');
	} else {
		await loadInitial(main);
	}
})();

function tabFromHash() {
	return (location.hash || '').replace('#', '') === 'community' ? 'community' : 'mine';
}

// ── Tab switching ────────────────────────────────────────────────────────

function wireTabs(root) {
	const tabs = root.querySelectorAll('[data-tab]');
	tabs.forEach((btn) => {
		btn.addEventListener('click', () => switchTab(root, btn.getAttribute('data-tab')));
	});
}

function switchTab(root, tab) {
	if (tab === state.tab) return;
	state.tab = tab;

	root.querySelectorAll('[data-tab]').forEach((b) => {
		const on = b.getAttribute('data-tab') === tab;
		b.classList.toggle('active', on);
		b.setAttribute('aria-selected', on ? 'true' : 'false');
	});

	const mineFilters = root.querySelector('[data-filters-mine]');
	const communityFilters = root.querySelector('[data-filters-community]');
	const communityTags = root.querySelector('[data-community-tags]');
	const newWrap = root.querySelector('.dn-av-new-wrap');
	const subtitle = root.querySelector('[data-subtitle]');
	const isCommunity = tab === 'community';

	mineFilters.hidden = isCommunity;
	communityFilters.hidden = !isCommunity;
	communityTags.hidden = !isCommunity;
	if (newWrap) newWrap.style.display = isCommunity ? 'none' : '';
	if (subtitle) {
		subtitle.textContent = isCommunity
			? 'Every public avatar the community has built — remix, embed, or open any of them.'
			: 'Your 3D models, animated and ready to embed.';
	}

	closeOpenMenu();
	hideError(root);
	// Force the grid to rebuild — mine and community share the same container.
	const grid = root.querySelector('[data-grid]');
	grid.dataset.ids = '';

	// Reflect the active tab in the URL without adding history noise per click.
	const targetHash = isCommunity ? '#community' : '';
	if ((location.hash || '') !== targetHash) {
		history.replaceState(null, '', `${location.pathname}${location.search}${targetHash}`);
	}

	if (isCommunity) {
		if (state.community.loaded) {
			renderCommunityGrid(root);
			setupCommunityLoadMore(root);
		} else {
			loadCommunityInitial(root);
		}
	} else {
		teardownCommunityObserver();
		if (state.loaded) {
			renderGrid(root);
			setupLoadMore(root);
		} else {
			loadInitial(root);
		}
	}
}

// ── Data loading ─────────────────────────────────────────────────────────

async function loadInitial(root) {
	const grid = root.querySelector('[data-grid]');
	renderSkeletons(grid, 8);
	hideError(root);

	try {
		const data = await get(`/api/avatars?limit=${PAGE_SIZE}`);
		state.all = Array.isArray(data?.avatars) ? data.avatars : [];
		state.nextCursor = data?.next_cursor || null;
		state.loaded = true;
		renderGrid(root);
		setupLoadMore(root);
	} catch (err) {
		showError(root, err, () => loadInitial(root));
		grid.innerHTML = '';
	}
}

async function loadMore(root) {
	if (!state.nextCursor || state.loadingMore) return;
	state.loadingMore = true;
	const btn = root.querySelector('[data-loadmore-btn]');
	if (btn) {
		btn.disabled = true;
		btn.textContent = 'Loading…';
	}
	try {
		const params = new URLSearchParams({ limit: String(PAGE_SIZE), cursor: state.nextCursor });
		const data = await get(`/api/avatars?${params.toString()}`);
		const more = Array.isArray(data?.avatars) ? data.avatars : [];
		state.all = state.all.concat(more);
		state.nextCursor = data?.next_cursor || null;
		renderGrid(root);
		setupLoadMore(root);
	} catch (err) {
		toast(root, err.message || 'Failed to load more', true);
		if (btn) {
			btn.disabled = false;
			btn.textContent = 'Load more';
		}
	} finally {
		state.loadingMore = false;
	}
}

// ── Community data loading ────────────────────────────────────────────────

async function loadCommunityInitial(root) {
	const c = state.community;
	const grid = root.querySelector('[data-grid]');
	renderSkeletons(grid, 8);
	hideError(root);
	c.all = [];
	c.nextCursor = null;
	c.loaded = false;

	try {
		const params = new URLSearchParams({ limit: String(PAGE_SIZE), totals: '1' });
		if (c.filter.q) params.set('q', c.filter.q);
		if (c.filter.tag) params.set('tag', c.filter.tag);
		if (c.filter.rigged !== 'all') params.set('rigged', c.filter.rigged);
		const data = await get(`/api/avatars/public?${params.toString()}`);
		const rows = Array.isArray(data?.avatars) ? data.avatars : [];
		c.all = rows;
		c.nextCursor = data?.next_cursor || null;
		c.total = typeof data?.total === 'number' ? data.total : null;
		c.totalViews = typeof data?.total_views === 'number' ? data.total_views : null;
		c.loaded = true;
		rows.forEach((a) => (a.tags || []).forEach((t) => c.loadedTags.add(t)));
		updateCommunityCount(root);
		renderCommunityTags(root);
		renderCommunityGrid(root);
		setupCommunityLoadMore(root);
	} catch (err) {
		showError(root, err, () => loadCommunityInitial(root));
		grid.innerHTML = '';
	}
}

async function loadCommunityMore(root) {
	const c = state.community;
	if (!c.nextCursor || c.loading) return;
	c.loading = true;
	const btn = root.querySelector('[data-loadmore-btn]');
	if (btn) {
		btn.disabled = true;
		btn.textContent = 'Loading…';
	}
	try {
		const params = new URLSearchParams({ limit: String(PAGE_SIZE), cursor: c.nextCursor });
		if (c.filter.q) params.set('q', c.filter.q);
		if (c.filter.tag) params.set('tag', c.filter.tag);
		if (c.filter.rigged !== 'all') params.set('rigged', c.filter.rigged);
		const data = await get(`/api/avatars/public?${params.toString()}`);
		const more = Array.isArray(data?.avatars) ? data.avatars : [];
		c.all = c.all.concat(more);
		c.nextCursor = data?.next_cursor || null;
		more.forEach((a) => (a.tags || []).forEach((t) => c.loadedTags.add(t)));
		renderCommunityTags(root);
		renderCommunityGrid(root);
		setupCommunityLoadMore(root);
	} catch (err) {
		toast(root, msgOf(err) || 'Failed to load more', true);
		if (btn) {
			btn.disabled = false;
			btn.textContent = 'Load more';
		}
	} finally {
		c.loading = false;
	}
}

// ── Filter / sort wiring ─────────────────────────────────────────────────

function wireCommunityFilters(root) {
	const c = state.community;
	const qInput = root.querySelector('[data-cq]');
	qInput.addEventListener('input', () => {
		clearTimeout(c.searchTimer);
		c.searchTimer = setTimeout(() => {
			c.filter.q = qInput.value.trim();
			loadCommunityInitial(root);
		}, 280);
	});

	const sortSel = root.querySelector('[data-csort]');
	sortSel.addEventListener('change', () => {
		c.filter.sort = sortSel.value;
		renderCommunityGrid(root);
	});

	root.querySelectorAll('[data-crig-chip]').forEach((btn) => {
		btn.addEventListener('click', () => {
			const v = btn.getAttribute('data-crig-chip');
			if (c.filter.rigged === v) return;
			c.filter.rigged = v;
			root.querySelectorAll('[data-crig-chip]').forEach((x) => {
				const on = x === btn;
				x.classList.toggle('active', on);
				x.setAttribute('aria-selected', on ? 'true' : 'false');
			});
			loadCommunityInitial(root);
		});
	});

	const tagsHost = root.querySelector('[data-community-tags]');
	tagsHost.addEventListener('click', (e) => {
		const btn = e.target.closest('[data-tag]');
		if (!btn) return;
		const tag = btn.getAttribute('data-tag');
		c.filter.tag = c.filter.tag === tag ? '' : tag;
		renderCommunityTags(root);
		loadCommunityInitial(root);
	});
}

function wireFilters(root) {
	const qInput = root.querySelector('[data-q]');
	qInput.addEventListener('input', () => {
		state.filter.q = qInput.value.trim().toLowerCase();
		renderGrid(root);
	});

	root.querySelectorAll('[data-vis-chip]').forEach((b) => {
		b.addEventListener('click', () => {
			const v = b.getAttribute('data-vis-chip');
			state.filter.visibility = v;
			root.querySelectorAll('[data-vis-chip]').forEach((x) => {
				const on = x === b;
				x.classList.toggle('active', on);
				x.setAttribute('aria-selected', on ? 'true' : 'false');
			});
			renderGrid(root);
		});
	});

	root.querySelectorAll('[data-rig-chip]').forEach((b) => {
		b.addEventListener('click', () => {
			const v = b.getAttribute('data-rig-chip');
			state.filter.rigged = v;
			root.querySelectorAll('[data-rig-chip]').forEach((x) => {
				const on = x === b;
				x.classList.toggle('active', on);
				x.setAttribute('aria-selected', on ? 'true' : 'false');
			});
			renderGrid(root);
		});
	});

	const sortSel = root.querySelector('[data-sort]');
	sortSel.addEventListener('change', () => {
		state.filter.sort = sortSel.value;
		renderGrid(root);
	});
}

function wireNewMenu(root) {
	const btn = root.querySelector('[data-new]');
	const pop = root.querySelector('[data-new-pop]');
	const close = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
	const open = () => {
		pop.hidden = false;
		btn.setAttribute('aria-expanded', 'true');
		const first = pop.querySelector('[role="menuitem"]');
		if (first) requestAnimationFrame(() => first.focus());
	};
	btn.setAttribute('aria-haspopup', 'menu');
	btn.setAttribute('aria-expanded', 'false');
	btn.addEventListener('click', (e) => {
		e.stopPropagation();
		pop.hidden ? open() : close();
	});
	document.addEventListener('click', (e) => {
		if (!pop.hidden && !pop.contains(e.target) && e.target !== btn) close();
	});
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape' && !pop.hidden) close();
	});
	pop.addEventListener('keydown', (e) => {
		const items = [...pop.querySelectorAll('[role="menuitem"]')];
		if (!items.length) return;
		const idx = items.indexOf(document.activeElement);
		if (e.key === 'ArrowDown') { e.preventDefault(); items[(idx + 1) % items.length].focus(); }
		else if (e.key === 'ArrowUp') { e.preventDefault(); items[(idx - 1 + items.length) % items.length].focus(); }
		else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
		else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
		else if (e.key === 'Escape') { e.preventDefault(); close(); btn.focus(); }
	});

	const template = pop.querySelector('[data-new-template]');
	if (template) {
		template.addEventListener('click', () => {
			close();
			// Opens the curated template picker; on selection it stages the GLB
			// locally and forwards to /create-review (the shared save step).
			createFromTemplate();
		});
	}

	const quickSelfie = pop.querySelector('[data-new-selfie-quick]');
	if (quickSelfie) {
		quickSelfie.addEventListener('click', async () => {
			close();
			const result = await openSelfieModal();
			if (result?.avatarId) {
				toast(root, 'Avatar created from selfie');
				state.all = [];
				state.nextCursor = null;
				await loadInitial(root);
			}
		});
	}

	const browseGallery = pop.querySelector('[data-browse-gallery]');
	if (browseGallery) {
		browseGallery.addEventListener('click', async () => {
			close();
			await openAvatarPicker({
				source: 'public',
				title: 'Browse public avatars',
				showModes: true,
				ctaLabel: 'Copy to clipboard',
			});
		});
	}
}

// ── Filtering / rendering ────────────────────────────────────────────────

function applyFilter(rows) {
	const { q, visibility, rigged, sort } = state.filter;
	let out = rows;
	if (q) out = out.filter((a) => (a.name || '').toLowerCase().includes(q));
	if (visibility !== 'all') out = out.filter((a) => (a.visibility || 'private') === visibility);
	if (rigged !== 'all') out = out.filter((a) => matchesRigFilter(a, rigged));
	const cmp = SORTS.find((s) => s.key === sort)?.cmp;
	if (cmp) out = [...out].sort(cmp);
	return out;
}

function renderGrid(root) {
	const grid = root.querySelector('[data-grid]');
	const filtered = applyFilter(state.all);

	if (!state.all.length) {
		grid.innerHTML = '';
		grid.appendChild(emptyBlock());
		return;
	}
	if (!filtered.length) {
		grid.innerHTML = '';
		const empty = document.createElement('div');
		empty.className = 'dn-empty';
		empty.style.gridColumn = '1 / -1';
		empty.innerHTML = `<h3>No matches</h3><p>No avatars match the current search or filter. Clear them to see everything.</p>`;
		const clear = document.createElement('button');
		clear.type = 'button';
		clear.className = 'dn-btn ghost';
		clear.textContent = 'Clear filters';
		clear.addEventListener('click', () => resetMineFilters(root));
		empty.appendChild(clear);
		grid.appendChild(empty);
		return;
	}

	// Diff-light: if same set of IDs, leave DOM alone (preserves <threews-avatar>
	// instances and their loaded GLBs). Otherwise rebuild.
	const ids = filtered.map((a) => a.id).join('|');
	if (grid.dataset.ids === ids) return;
	grid.dataset.ids = ids;

	grid.innerHTML = '';
	for (const a of filtered) grid.appendChild(avatarCard(root, a));
}

// Reset the "My avatars" search + chip filters to their defaults, sync the UI,
// and re-render. Sort is left untouched — it never yields an empty result set.
function resetMineFilters(root) {
	state.filter = { q: '', visibility: 'all', rigged: 'all', sort: state.filter.sort };
	const q = root.querySelector('[data-q]');
	if (q) q.value = '';
	root.querySelectorAll('[data-vis-chip]').forEach((x) => {
		const on = x.getAttribute('data-vis-chip') === 'all';
		x.classList.toggle('active', on);
		x.setAttribute('aria-selected', on ? 'true' : 'false');
	});
	root.querySelectorAll('[data-rig-chip]').forEach((x) => {
		const on = x.getAttribute('data-rig-chip') === 'all';
		x.classList.toggle('active', on);
		x.setAttribute('aria-selected', on ? 'true' : 'false');
	});
	renderGrid(root);
}

// Reset the community search / tag / rig filters and reload the public feed.
function resetCommunityFilters(root) {
	const c = state.community;
	c.filter.q = '';
	c.filter.tag = '';
	c.filter.rigged = 'all';
	const q = root.querySelector('[data-cq]');
	if (q) q.value = '';
	root.querySelectorAll('[data-crig-chip]').forEach((x) => {
		const on = x.getAttribute('data-crig-chip') === 'all';
		x.classList.toggle('active', on);
		x.setAttribute('aria-selected', on ? 'true' : 'false');
	});
	renderCommunityTags(root);
	loadCommunityInitial(root);
}

function setupLoadMore(root) {
	const host = root.querySelector('[data-loadmore]');
	if (state.io) {
		state.io.disconnect();
		state.io = null;
	}
	if (!state.nextCursor) {
		host.hidden = true;
		host.innerHTML = '';
		return;
	}
	host.hidden = false;
	host.innerHTML = `<button class="dn-btn ghost" type="button" data-loadmore-btn>Load more</button>`;
	const btn = host.querySelector('[data-loadmore-btn]');
	btn.addEventListener('click', () => loadMore(root));
	state.io = new IntersectionObserver((entries) => {
		for (const e of entries) {
			if (e.isIntersecting) {
				loadMore(root);
				break;
			}
		}
	}, { rootMargin: '300px 0px' });
	state.io.observe(host);
}

// ── Community: rendering ──────────────────────────────────────────────────

function applyCommunitySort(rows) {
	const cmp = COMMUNITY_SORTS.find((s) => s.key === state.community.filter.sort)?.cmp;
	return cmp ? [...rows].sort(cmp) : rows;
}

function renderCommunityGrid(root) {
	const grid = root.querySelector('[data-grid]');
	const c = state.community;
	const rows = applyCommunitySort(c.all);

	if (!rows.length) {
		grid.innerHTML = '';
		const empty = document.createElement('div');
		empty.className = 'dn-empty';
		empty.style.gridColumn = '1 / -1';
		if (c.filter.q || c.filter.tag) {
			empty.innerHTML = `<h3>No matches</h3><p>No public avatars match the current search or tag. Clear them to see the whole community gallery.</p>`;
			const clear = document.createElement('button');
			clear.type = 'button';
			clear.className = 'dn-btn ghost';
			clear.textContent = 'Clear filters';
			clear.addEventListener('click', () => resetCommunityFilters(root));
			empty.appendChild(clear);
		} else {
			empty.innerHTML = `<h3>No public avatars yet.</h3><p>Be the first — build an avatar and set it to public so it appears here for everyone.</p>
				<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">
					<a class="dn-btn primary" href="/create/prompt">Describe it · prompt → 3D</a>
				</div>`;
		}
		grid.appendChild(empty);
		return;
	}

	const ids = rows.map((a) => a.id).join('|');
	if (grid.dataset.ids === ids) return;
	grid.dataset.ids = ids;

	grid.innerHTML = '';
	for (const a of rows) grid.appendChild(communityCard(root, a));
}

function communityCard(root, a) {
	const el = document.createElement('div');
	el.className = 'dn-avatar-card';
	el.dataset.id = a.id;

	const views = Number(a.view_count) || 0;
	const onchain = onchainBadgeHTML(a, { link: false, size: 'sm', showChain: false });
	const tagBits = (a.tags || []).slice(0, 2).map((t) => `<span class="dn-tag">${esc(t)}</span>`).join('');

	el.innerHTML = `
		<div class="dn-av-thumb">
			<threews-avatar avatar-id="${esc(a.id)}" hide-chrome bg="transparent"></threews-avatar>
			<div class="dn-av-hover-actions">
				<a class="dn-av-hover-btn" href="/avatars/${encodeURIComponent(a.id)}" target="_blank" rel="noopener">Live page</a>
				<a class="dn-av-hover-btn" href="/app#avatar=${encodeURIComponent(a.id)}">Remix in 3D</a>
			</div>
			<button type="button" class="dn-av-more" data-more aria-haspopup="menu" aria-expanded="false" aria-label="More actions">
				<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="8" cy="3" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="8" cy="13" r="1.4"/></svg>
			</button>
		</div>
		<div class="dn-av-body">
			<div class="dn-av-name-row">
				<span class="dn-av-name" title="${esc(a.name || 'Untitled')}">${esc(a.name || 'Untitled')}</span>
			</div>
			<div class="dn-av-meta">
				${onchain}
				${rigBadgeHTML(a, { size: 'sm' })}
				${tagBits}
				${views ? `<span class="dn-av-rel">${compactNum.format(views)} views</span>` : ''}
				<span class="dn-av-rel">${esc(relTime(a.created_at))}</span>
			</div>
		</div>
	`;

	wireCommunityMoreMenu(root, el, a);
	return el;
}

function wireCommunityMoreMenu(root, card, a) {
	const btn = card.querySelector('[data-more]');
	btn.addEventListener('click', (e) => {
		e.stopPropagation();
		if (_openMenu && _openMenu.dataset.for === a.id) {
			closeOpenMenu();
			return;
		}
		closeOpenMenu();
		openCommunityMenu(root, btn, a);
	});
}

function openCommunityMenu(root, anchor, a) {
	const menu = document.createElement('div');
	menu.className = 'dn-av-menu';
	menu.dataset.for = a.id;
	menu.setAttribute('role', 'menu');
	const shareUrl = `${location.origin}/avatars/${encodeURIComponent(a.id)}`;
	const items = [
		{ label: 'View live page', run: () => { window.open(`/avatars/${encodeURIComponent(a.id)}`, '_blank'); } },
		{ label: 'Remix in 3D studio', run: () => { location.href = `/app#avatar=${encodeURIComponent(a.id)}`; } },
		{ label: 'Copy share link', run: () => copyText(root, shareUrl, 'Share link copied') },
		{ label: 'Copy embed snippet', run: () => copyCommunityEmbed(root, a) },
		{ label: 'Copy GLB URL', run: () => {
			if (!a.model_url) { toast(root, 'No GLB URL available', true); return; }
			copyText(root, a.model_url, 'GLB URL copied');
		} },
	];
	menu.innerHTML = items.map((item, i) => `
		<button type="button" class="dn-av-menu-item" data-i="${i}" role="menuitem">${esc(item.label)}</button>
	`).join('');

	document.body.appendChild(menu);
	positionMenu(menu, anchor);
	requestAnimationFrame(() => menu.classList.add('open'));
	menu._anchor = anchor;
	anchor.setAttribute('aria-expanded', 'true');
	_openMenu = menu;
	enhanceMenu(menu, anchor);

	menu.querySelectorAll('[data-i]').forEach((b) => {
		b.addEventListener('click', () => {
			const i = Number(b.dataset.i);
			closeOpenMenu();
			items[i].run();
		});
	});

	const onDocClick = (e) => {
		if (menu.contains(e.target) || anchor.contains(e.target)) return;
		closeOpenMenu();
		document.removeEventListener('click', onDocClick);
		document.removeEventListener('keydown', onKey);
	};
	const onKey = (e) => {
		if (e.key === 'Escape') {
			closeOpenMenu();
			document.removeEventListener('click', onDocClick);
			document.removeEventListener('keydown', onKey);
		}
	};
	setTimeout(() => {
		document.addEventListener('click', onDocClick);
		document.addEventListener('keydown', onKey);
	}, 0);
}

async function copyCommunityEmbed(root, a) {
	const safeName = (a.name || 'avatar').replace(/"/g, '&quot;');
	const u = new URL('/a-embed.html', location.origin);
	u.searchParams.set('avatar', a.id);
	const snippet = `<iframe src="${u.toString()}" width="360" height="540" style="border:0;border-radius:12px;max-width:100%" allow="xr-spatial-tracking" sandbox="allow-scripts allow-same-origin allow-popups" title="${safeName}" loading="lazy"></iframe>`;
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

function renderCommunityTags(root) {
	const host = root.querySelector('[data-community-tags]');
	const c = state.community;
	const tags = [...c.loadedTags].sort((a, b) => a.localeCompare(b)).slice(0, 24);
	const active = c.filter.tag;
	const all = active && !tags.includes(active) ? [active, ...tags] : tags;
	if (!all.length) {
		host.innerHTML = '';
		return;
	}
	host.innerHTML = all.map((t) =>
		`<button type="button" class="dn-av-chip${t === active ? ' active' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`
	).join('');
}

function updateCommunityCount(root) {
	const c = state.community;
	const badge = root.querySelector('[data-community-count]');
	const stat = root.querySelector('[data-community-stat]');
	if (badge) {
		if (typeof c.total === 'number' && c.total > 0) {
			badge.textContent = integerNum.format(c.total);
			badge.hidden = false;
		} else {
			badge.hidden = true;
		}
	}
	if (stat) {
		const parts = [];
		if (typeof c.total === 'number') parts.push(`${integerNum.format(c.total)} public avatars`);
		if (c.totalViews) parts.push(`${compactNum.format(c.totalViews)} views`);
		stat.textContent = parts.join(' · ');
	}
}

function setupCommunityLoadMore(root) {
	const host = root.querySelector('[data-loadmore]');
	const c = state.community;
	if (c.io) { c.io.disconnect(); c.io = null; }
	if (state.io) { state.io.disconnect(); state.io = null; }
	if (!c.nextCursor) {
		host.hidden = true;
		host.innerHTML = '';
		return;
	}
	host.hidden = false;
	host.innerHTML = `<button class="dn-btn ghost" type="button" data-loadmore-btn>Load more</button>`;
	host.querySelector('[data-loadmore-btn]').addEventListener('click', () => loadCommunityMore(root));
	c.io = new IntersectionObserver((entries) => {
		for (const e of entries) {
			if (e.isIntersecting) { loadCommunityMore(root); break; }
		}
	}, { rootMargin: '300px 0px' });
	c.io.observe(host);
}

function teardownCommunityObserver() {
	if (state.community.io) {
		state.community.io.disconnect();
		state.community.io = null;
	}
}

// ── Card ─────────────────────────────────────────────────────────────────

function avatarCard(root, a) {
	const el = document.createElement('div');
	el.className = 'dn-avatar-card';
	el.dataset.id = a.id;

	el.innerHTML = `
		<div class="dn-av-thumb">
			<threews-avatar avatar-id="${esc(a.id)}" hide-chrome bg="transparent"></threews-avatar>
			<div class="dn-av-hover-actions">
				<a class="dn-av-hover-btn" href="/avatars/${encodeURIComponent(a.id)}" target="_blank" rel="noopener">Live page</a>
				<a class="dn-av-hover-btn" href="/app#avatar=${encodeURIComponent(a.id)}">3D Studio</a>
			</div>
			<button type="button" class="dn-av-more" data-more aria-haspopup="menu" aria-expanded="false" aria-label="More actions">
				<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="8" cy="3" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="8" cy="13" r="1.4"/></svg>
			</button>
		</div>
		<div class="dn-av-body">
			<div class="dn-av-name-row">
				<span class="dn-av-name" data-name title="Click to rename">${esc(a.name || 'Untitled')}</span>
				<button type="button" class="dn-av-pencil" data-rename aria-label="Rename">
					<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.5 1.5 14 4 4.5 13.5 1 14l.5-3.5z"/></svg>
				</button>
			</div>
			<div class="dn-av-meta">
				${visibilityTag(a.visibility)}
				${rigBadgeHTML(a, { size: 'sm' })}
				<span class="dn-av-rel">${esc(relTime(a.updated_at || a.created_at))}</span>
			</div>
			${avatarWalletChip(a)}
		</div>
	`;

	wireRename(root, el, a);
	wireMoreMenu(root, el, a);
	wireWalletChips(el);
	return el;
}

function visibilityTag(v) {
	const visibility = v || 'private';
	const cls = visibility === 'public' ? 'success' : visibility === 'private' ? 'warn' : '';
	const label = visibility[0].toUpperCase() + visibility.slice(1);
	return `<span class="dn-tag ${cls}" data-vis-tag>${esc(label)}</span>`;
}

// The owner's avatar-linked agent wallet (with vanity status + "make vanity"
// entry point). Renders a "Wallet pending" chip while provisioning so every
// avatar communicates that it has a custodial wallet.
function avatarWalletChip(a) {
	if (!a.agent_id) return '';
	const agent = {
		id: a.agent_id,
		solana_address: a.agent_solana_address || null,
		solana_vanity_prefix: a.agent_solana_vanity_prefix || null,
		solana_vanity_suffix: a.agent_solana_vanity_suffix || null,
	};
	return `<div class="dn-av-wallet" style="margin-top:8px;">${walletChipHTML(agent, { isOwner: true, showPending: true, dense: true })}</div>`;
}

// ── Inline rename ────────────────────────────────────────────────────────

function wireRename(root, card, a) {
	const nameEl = card.querySelector('[data-name]');
	const pencil = card.querySelector('[data-rename]');
	const startEdit = () => {
		if (card.querySelector('input[data-name-input]')) return;
		const input = document.createElement('input');
		input.type = 'text';
		input.value = a.name || '';
		input.maxLength = 100;
		input.setAttribute('data-name-input', '');
		input.className = 'dn-av-name-input';
		nameEl.replaceWith(input);
		input.focus();
		input.select();
		const commit = async () => {
			const next = input.value.trim();
			const restore = (text) => {
				const span = document.createElement('span');
				span.className = 'dn-av-name';
				span.dataset.name = '';
				span.title = 'Click to rename';
				span.textContent = text;
				input.replaceWith(span);
				span.addEventListener('click', startEdit);
			};
			if (!next || next === a.name) {
				restore(a.name || 'Untitled');
				return;
			}
			input.disabled = true;
			try {
				await patch(`/api/avatars/${encodeURIComponent(a.id)}`, { name: next });
				a.name = next;
				restore(next);
				toast(root, 'Renamed');
			} catch (err) {
				toast(root, msgOf(err) || 'Rename failed', true);
				restore(a.name || 'Untitled');
			}
		};
		input.addEventListener('blur', commit, { once: true });
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
			else if (e.key === 'Escape') {
				input.value = a.name || '';
				input.blur();
			}
		});
	};
	nameEl.addEventListener('click', startEdit);
	pencil.addEventListener('click', startEdit);
}

// ── More menu ────────────────────────────────────────────────────────────

let _openMenu = null;

function closeOpenMenu() {
	if (_openMenu) {
		_openMenu._anchor?.setAttribute('aria-expanded', 'false');
		_openMenu.remove();
		_openMenu = null;
	}
}

// Keyboard + focus management for the popover menus: focus the first item on
// open, arrow/Home/End to move, Escape to close and return focus to the button.
// Items are role="menuitem" buttons, so Enter/Space activate them natively.
function enhanceMenu(menu, anchor) {
	const items = [...menu.querySelectorAll('[role="menuitem"]')];
	if (!items.length) return;
	items.forEach((it) => { it.tabIndex = -1; });
	const focusAt = (i) => items[(i + items.length) % items.length].focus();
	requestAnimationFrame(() => focusAt(0));
	menu.addEventListener('keydown', (e) => {
		const idx = items.indexOf(document.activeElement);
		if (e.key === 'ArrowDown') { e.preventDefault(); focusAt(idx + 1); }
		else if (e.key === 'ArrowUp') { e.preventDefault(); focusAt(idx - 1); }
		else if (e.key === 'Home') { e.preventDefault(); focusAt(0); }
		else if (e.key === 'End') { e.preventDefault(); focusAt(items.length - 1); }
		else if (e.key === 'Escape') { e.preventDefault(); closeOpenMenu(); anchor.focus(); }
		else if (e.key === 'Tab') { closeOpenMenu(); }
	});
}

// Arrow-key roving across a role="tablist" chip/tab group. Moves focus and
// activates the tab (ARIA automatic-activation pattern), matching the click path.
function wireTablistKeys(container) {
	if (!container) return;
	container.addEventListener('keydown', (e) => {
		if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
		const tabs = [...container.querySelectorAll('[role="tab"]')];
		if (!tabs.length) return;
		const cur = tabs.indexOf(document.activeElement);
		let next;
		if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = tabs.length - 1;
		else if (e.key === 'ArrowRight') next = (cur + 1) % tabs.length;
		else next = (cur - 1 + tabs.length) % tabs.length;
		e.preventDefault();
		tabs[next].focus();
		tabs[next].click();
	});
}

function wireMoreMenu(root, card, a) {
	const btn = card.querySelector('[data-more]');
	btn.addEventListener('click', (e) => {
		e.stopPropagation();
		if (_openMenu && _openMenu.dataset.for === a.id) {
			closeOpenMenu();
			return;
		}
		closeOpenMenu();
		openMoreMenu(root, btn, card, a);
	});
}

function openMoreMenu(root, anchor, card, a) {
	const menu = document.createElement('div');
	menu.className = 'dn-av-menu';
	menu.dataset.for = a.id;
	menu.setAttribute('role', 'menu');
	const items = [
		{ label: 'View live page', run: () => { window.open(`/avatars/${encodeURIComponent(a.id)}`, '_blank'); } },
		{ label: 'Update from selfie', run: async () => {
			const result = await openSelfieModal({ existingAvatarId: a.id });
			if (result?.avatarId) {
				toast(root, 'Avatar updated from selfie');
				state.all = [];
				state.nextCursor = null;
				await loadInitial(root);
			}
		}},
		{ label: 'Rename', run: () => card.querySelector('[data-rename]')?.click() },
		{ label: 'Change visibility', run: () => openVisibilitySubmenu(root, anchor, card, a) },
		{ label: 'Copy embed snippet', run: () => copyEmbedSnippet(root, a) },
		{ label: 'Open in 3D studio', run: () => { location.href = `/app#avatar=${encodeURIComponent(a.id)}`; } },
		{ label: 'Download GLB', run: () => downloadGlb(root, a) },
		{ label: 'Copy as GitHub README 3D', run: () => copyReadme3dBlock(root, a) },
		{ label: 'Delete', danger: true, run: () => confirmDelete(root, card, a) },
	];
	menu.innerHTML = items.map((item, i) => `
		<button type="button" class="dn-av-menu-item${item.danger ? ' danger' : ''}" data-i="${i}" role="menuitem">${esc(item.label)}</button>
	`).join('');

	document.body.appendChild(menu);
	positionMenu(menu, anchor);
	requestAnimationFrame(() => menu.classList.add('open'));
	menu._anchor = anchor;
	anchor.setAttribute('aria-expanded', 'true');
	_openMenu = menu;
	enhanceMenu(menu, anchor);

	menu.querySelectorAll('[data-i]').forEach((b) => {
		b.addEventListener('click', () => {
			const i = Number(b.dataset.i);
			closeOpenMenu();
			items[i].run();
		});
	});

	const onDocClick = (e) => {
		if (menu.contains(e.target) || anchor.contains(e.target)) return;
		closeOpenMenu();
		document.removeEventListener('click', onDocClick);
		document.removeEventListener('keydown', onKey);
	};
	const onKey = (e) => {
		if (e.key === 'Escape') {
			closeOpenMenu();
			document.removeEventListener('click', onDocClick);
			document.removeEventListener('keydown', onKey);
		}
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
	// Right-align under the button, clamp to viewport.
	const width = 200;
	let left = Math.round(r.right - width);
	if (left < 8) left = 8;
	if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
	menu.style.left = `${left}px`;
	menu.style.width = `${width}px`;
}

function openVisibilitySubmenu(root, anchor, card, a) {
	const menu = document.createElement('div');
	menu.className = 'dn-av-menu';
	menu.dataset.for = a.id;
	menu.setAttribute('role', 'menu');
	menu.innerHTML = VISIBILITIES.map((v, i) => `
		<button type="button" class="dn-av-menu-item${(a.visibility || 'private') === v ? ' active' : ''}" data-i="${i}" data-v="${v}" role="menuitem">
			<span>${v[0].toUpperCase() + v.slice(1)}</span>
			${(a.visibility || 'private') === v ? '<span aria-hidden="true">✓</span>' : ''}
		</button>
	`).join('');
	document.body.appendChild(menu);
	positionMenu(menu, anchor);
	requestAnimationFrame(() => menu.classList.add('open'));
	menu._anchor = anchor;
	anchor.setAttribute('aria-expanded', 'true');
	_openMenu = menu;
	enhanceMenu(menu, anchor);

	menu.querySelectorAll('[data-i]').forEach((b) => {
		b.addEventListener('click', async () => {
			const next = b.dataset.v;
			closeOpenMenu();
			if ((a.visibility || 'private') === next) return;
			const tag = card.querySelector('[data-vis-tag]');
			const prev = a.visibility;
			try {
				await patch(`/api/avatars/${encodeURIComponent(a.id)}`, { visibility: next });
				a.visibility = next;
				if (tag) tag.outerHTML = visibilityTag(next);
				toast(root, `Visibility set to ${next}`);
				// If the active filter chip excludes the new visibility,
				// re-render so it disappears from view.
				if (state.filter.visibility !== 'all' && state.filter.visibility !== next) {
					renderGrid(root);
				}
			} catch (err) {
				a.visibility = prev;
				toast(root, msgOf(err) || 'Failed to update visibility', true);
			}
		});
	});

	const onDocClick = (e) => {
		if (menu.contains(e.target)) return;
		closeOpenMenu();
		document.removeEventListener('click', onDocClick);
		document.removeEventListener('keydown', onKey);
	};
	const onKey = (e) => {
		if (e.key === 'Escape') {
			closeOpenMenu();
			document.removeEventListener('click', onDocClick);
			document.removeEventListener('keydown', onKey);
		}
	};
	setTimeout(() => {
		document.addEventListener('click', onDocClick);
		document.addEventListener('keydown', onKey);
	}, 0);
}

// ── Embed snippet ────────────────────────────────────────────────────────

async function copyEmbedSnippet(root, a) {
	const safeName = (a.name || 'avatar').replace(/"/g, '&quot;');
	const isPrivate = (a.visibility || 'private') === 'private';
	if (isPrivate) {
		toast(root, 'Private avatars cannot be embedded. Switch to unlisted or public first.', true);
		return;
	}
	const u = new URL('/a-embed.html', location.origin);
	u.searchParams.set('avatar', a.id);
	const snippet = `<iframe src="${u.toString()}" width="360" height="540" style="border:0;border-radius:12px;max-width:100%" allow="xr-spatial-tracking" sandbox="allow-scripts allow-same-origin allow-popups" title="${safeName}" loading="lazy"></iframe>`;
	try {
		await navigator.clipboard.writeText(snippet);
		toast(root, 'Embed snippet copied');
	} catch {
		toast(root, 'Copy failed — clipboard blocked', true);
	}
}

// ── Download GLB ─────────────────────────────────────────────────────────

async function downloadGlb(root, a) {
	toast(root, 'Preparing download…');
	try {
		let url = a.model_url;
		if (!url) {
			const data = await get(`/api/avatars/${encodeURIComponent(a.id)}`);
			url = data?.avatar?.url || data?.avatar?.model_url;
		}
		if (!url) throw new Error('No download URL available');
		const resp = await fetch(url, { credentials: 'omit' });
		if (!resp.ok) throw new Error(`Download failed (${resp.status})`);
		const blob = await resp.blob();
		const safeName = (a.name || 'avatar').replace(/[^a-z0-9._-]+/gi, '_').slice(0, 80) || 'avatar';
		const link = document.createElement('a');
		const objectUrl = URL.createObjectURL(blob);
		link.href = objectUrl;
		link.download = `${safeName}.glb`;
		document.body.appendChild(link);
		link.click();
		link.remove();
		setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
		toast(root, 'Download started');
	} catch (err) {
		toast(root, msgOf(err) || 'Download failed', true);
	}
}

// ── Copy as GitHub README 3D ─────────────────────────────────────────────

async function copyReadme3dBlock(root, a) {
	toast(root, 'Converting for GitHub…');
	try {
		let url = a.model_url;
		if (!url) {
			const data = await get(`/api/avatars/${encodeURIComponent(a.id)}`);
			url = data?.avatar?.url || data?.avatar?.model_url;
		}
		if (!url) throw new Error('No model URL available');
		const { copyReadme3d, describeResult } = await import('../../readme-3d-copy.js');
		const safeName = (a.name || 'avatar').replace(/[^a-z0-9._-]+/gi, '-').slice(0, 48) || 'avatar';
		toast(root, describeResult(await copyReadme3d(url, { name: safeName })));
	} catch (err) {
		toast(root, msgOf(err) || 'Conversion failed', true);
	}
}

// ── Delete with confirm modal ────────────────────────────────────────────

function confirmDelete(root, card, a) {
	const overlay = document.createElement('div');
	overlay.className = 'dn-av-overlay';
	overlay.innerHTML = `
		<div class="dn-panel dn-av-confirm" role="dialog" aria-modal="true" aria-label="Delete avatar">
			<div class="dn-panel-title">Delete "${esc(a.name || 'avatar')}"?</div>
			<p class="dn-panel-sub">This permanently removes the avatar and its embed URLs. This cannot be undone.</p>
			<div class="dn-av-confirm-actions">
				<button type="button" class="dn-btn ghost" data-cancel>Cancel</button>
				<button type="button" class="dn-btn danger" data-confirm>Delete</button>
			</div>
		</div>
	`;
	document.body.appendChild(overlay);
	requestAnimationFrame(() => overlay.classList.add('open'));

	const close = () => {
		overlay.classList.remove('open');
		setTimeout(() => overlay.remove(), 160);
		document.removeEventListener('keydown', onKey);
	};
	const onKey = (e) => { if (e.key === 'Escape') close(); };
	document.addEventListener('keydown', onKey);
	overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
	overlay.querySelector('[data-cancel]').addEventListener('click', close);

	const confirmBtn = overlay.querySelector('[data-confirm]');
	confirmBtn.addEventListener('click', async () => {
		confirmBtn.disabled = true;
		confirmBtn.textContent = 'Deleting…';
		// Optimistic remove
		const idx = state.all.findIndex((x) => x.id === a.id);
		const removed = idx >= 0 ? state.all.splice(idx, 1)[0] : null;
		card.remove();
		try {
			await del(`/api/avatars/${encodeURIComponent(a.id)}`);
			toast(root, `Deleted "${a.name || 'avatar'}"`);
			if (!state.all.length) {
				const grid = root.querySelector('[data-grid]');
				grid.innerHTML = '';
				grid.appendChild(emptyBlock());
			} else {
				// Refresh diff key so future renders match
				const grid = root.querySelector('[data-grid]');
				grid.dataset.ids = '';
			}
			close();
		} catch (err) {
			// Undo: restore the row
			if (removed) state.all.splice(idx, 0, removed);
			const grid = root.querySelector('[data-grid]');
			grid.dataset.ids = '';
			renderGrid(root);
			toast(root, msgOf(err) || 'Delete failed', true);
			confirmBtn.disabled = false;
			confirmBtn.textContent = 'Delete';
		}
	});
}

// ── Helpers: skeletons, empty, error, toast ─────────────────────────────

function renderSkeletons(grid, n) {
	grid.innerHTML = '';
	for (let i = 0; i < n; i++) {
		const sk = document.createElement('div');
		sk.className = 'dn-avatar-card dn-av-skeleton-card';
		sk.innerHTML = `
			<div class="dn-skeleton" style="width:100%;height:280px;border-radius:12px"></div>
			<div class="dn-skeleton" style="width:60%;height:14px;margin-top:10px"></div>
			<div class="dn-skeleton" style="width:40%;height:11px;margin-top:6px"></div>
		`;
		grid.appendChild(sk);
	}
}

function emptyBlock() {
	const wrap = emptyStateEl({
		icon: '🎭',
		title: 'No avatars yet',
		body: 'Avatars are the 3D bodies your agents wear — embeddable, animated characters you own. Make your first one: describe it in a sentence and watch it generate, start from a ready-made template, sculpt one from scratch, or drop a selfie.',
		actions: [
			{ label: 'Describe it · prompt → 3D', href: '/create/prompt', id: 'create-prompt', primary: true },
			{ label: 'Start from a template', id: 'create-template' },
			{ label: 'Build from scratch', href: '/create/studio', id: 'create-studio' },
			{ label: 'Create from selfie', href: '/create/selfie', id: 'create-selfie' },
		],
	});
	wrap.querySelector('[data-sk-action="create-template"]')?.addEventListener('click', () => createFromTemplate());
	return wrap;
}

function showError(root, err, onRetry) {
	const host = root.querySelector('[data-error]');
	host.hidden = false;
	host.innerHTML = `
		<div class="dn-av-banner-error">
			<div>
				<strong>Couldn't load avatars.</strong>
				<div class="dn-av-banner-sub">${esc(msgOf(err) || 'Network error')}</div>
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
	t.className = `dn-av-toast${isError ? ' err' : ''}`;
	t.textContent = message;
	host.appendChild(t);
	requestAnimationFrame(() => t.classList.add('show'));
	setTimeout(() => {
		t.classList.remove('show');
		setTimeout(() => t.remove(), 200);
	}, 3200);
}

function ts(iso) {
	const n = new Date(iso).getTime();
	return Number.isFinite(n) ? n : 0;
}

function msgOf(err) {
	if (err instanceof ApiError) return err.message;
	return err?.message || String(err || '');
}

// ── Styles (page-scoped, injected once) ─────────────────────────────────

function injectStyles() {
	if (document.getElementById('dn-avatars-css')) return;
	const css = document.createElement('style');
	css.id = 'dn-avatars-css';
	css.textContent = `
		.dn-av-head {
			display: flex;
			align-items: flex-start;
			justify-content: space-between;
			gap: 16px;
			margin-bottom: 18px;
		}
		.dn-av-head .dn-h1, .dn-av-head .dn-h1-sub { margin-bottom: 0; }
		.dn-av-head .dn-h1-sub { margin-top: 4px; }
		.dn-av-new-wrap { position: relative; flex-shrink: 0; }
		.dn-av-new-pop {
			position: absolute;
			right: 0;
			top: calc(100% + 6px);
			min-width: 220px;
			background: linear-gradient(180deg, rgba(28, 29, 39, 0.96), rgba(20, 21, 28, 0.96));
			border: 1px solid var(--nxt-stroke-strong);
			border-radius: var(--nxt-radius-sm);
			box-shadow: 0 12px 36px rgba(0,0,0,0.45);
			padding: 6px;
			z-index: 40;
			backdrop-filter: blur(20px);
		}
		.dn-av-new-pop a,
		.dn-av-new-pop button {
			display: block;
			width: 100%;
			text-align: left;
			padding: 8px 12px;
			border-radius: 7px;
			font-size: 13px;
			color: var(--nxt-ink);
			background: transparent;
			border: none;
			cursor: pointer;
			font-family: inherit;
			transition: background 0.12s ease;
		}
		.dn-av-new-pop a:hover,
		.dn-av-new-pop button:hover { background: rgba(255,255,255,0.06); }
		.dn-av-new-grp {
			padding: 7px 12px 3px;
			font-size: 10.5px;
			font-weight: 600;
			letter-spacing: 0.06em;
			text-transform: uppercase;
			color: var(--nxt-ink-fade);
			pointer-events: none;
		}
		.dn-av-new-grp:first-child { padding-top: 3px; }

		.dn-av-tabs {
			display: inline-flex;
			gap: 2px;
			padding: 3px;
			margin-bottom: 16px;
			background: rgba(255,255,255,0.04);
			border: 1px solid var(--nxt-stroke);
			border-radius: var(--nxt-radius-pill);
		}
		.dn-av-tab {
			display: inline-flex;
			align-items: center;
			gap: 6px;
			background: transparent;
			border: 0;
			color: var(--nxt-ink-dim);
			font-family: inherit;
			font-size: 13px;
			font-weight: 500;
			padding: 7px 16px;
			border-radius: var(--nxt-radius-pill);
			cursor: pointer;
			transition: color 0.12s ease, background 0.12s ease;
		}
		.dn-av-tab:hover { color: var(--nxt-ink); }
		.dn-av-tab.active {
			background: rgba(255,255,255,0.1);
			color: var(--nxt-ink);
		}
		.dn-av-tab-count {
			font-size: 11px;
			font-weight: 600;
			padding: 1px 7px;
			border-radius: var(--nxt-radius-pill);
			background: rgba(255,255,255,0.1);
			color: var(--nxt-ink-dim);
		}
		.dn-av-tab.active .dn-av-tab-count { background: rgba(255,255,255,0.16); color: var(--nxt-ink); }

		.dn-av-community-stat {
			font-size: 12px;
			color: var(--nxt-ink-fade);
			margin-left: auto;
			white-space: nowrap;
		}

		.dn-av-tags {
			display: flex;
			flex-wrap: wrap;
			gap: 6px;
			margin-bottom: 18px;
		}
		.dn-av-tags:empty { display: none; }

		.dn-av-filters {
			display: flex;
			align-items: center;
			gap: 12px;
			margin-bottom: 18px;
			flex-wrap: wrap;
		}
		.dn-av-search {
			flex: 1 1 280px;
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
		.dn-av-search:focus-within {
			border-color: var(--nxt-stroke-strong);
			background: rgba(255,255,255,0.06);
		}
		.dn-av-search input {
			flex: 1;
			background: transparent;
			border: 0;
			outline: 0;
			color: var(--nxt-ink);
			font-size: 13px;
			min-width: 0;
		}
		.dn-av-search input::placeholder { color: var(--nxt-ink-fade); }

		.dn-av-chips { display: flex; gap: 4px; flex-wrap: wrap; }
		.dn-av-chip {
			background: transparent;
			border: 1px solid var(--nxt-stroke);
			color: var(--nxt-ink-dim);
			font-size: 12px;
			padding: 6px 12px;
			border-radius: var(--nxt-radius-pill);
			cursor: pointer;
			transition: all 0.12s ease;
		}
		.dn-av-chip:hover { color: var(--nxt-ink); background: rgba(255,255,255,0.04); }
		.dn-av-chip.active {
			background: rgba(255,255,255,0.08);
			border-color: var(--nxt-stroke-strong);
			color: var(--nxt-ink);
		}

		.dn-av-sort select {
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
		}

		.dn-av-banner-error {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			padding: 14px 16px;
			margin-bottom: 14px;
			border: 1px solid rgba(150,155,163,0.3);
			background: rgba(150,155,163,0.08);
			border-radius: var(--nxt-radius-sm);
			color: var(--nxt-ink);
			font-size: 13px;
		}
		.dn-av-banner-sub { color: var(--nxt-ink-dim); font-size: 12.5px; margin-top: 2px; }

		.dn-av-grid {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
			gap: 16px;
		}

		.dn-avatar-card {
			background: linear-gradient(180deg, rgba(20, 21, 28, 0.7), rgba(14, 15, 22, 0.5));
			border: 1px solid var(--nxt-stroke);
			border-radius: var(--nxt-radius);
			padding: 10px;
			transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
		}
		.dn-avatar-card:hover {
			transform: scale(1.015);
			box-shadow: 0 8px 24px rgba(0,0,0,0.4);
			border-color: var(--nxt-stroke-strong);
		}
		.dn-av-skeleton-card { padding: 10px; }
		.dn-av-skeleton-card:hover { transform: none; box-shadow: none; }

		.dn-av-thumb {
			position: relative;
			width: 100%;
			height: 280px;
			border-radius: 10px;
			overflow: hidden;
			background:
				radial-gradient(ellipse 60% 50% at 50% 100%, rgba(200,202,208,0.06) 0%, transparent 70%),
				linear-gradient(180deg, rgba(28, 29, 39, 0.5), rgba(14, 15, 22, 0.5));
		}
		.dn-av-thumb threews-avatar {
			display: block;
			width: 100%;
			height: 100%;
		}
		.dn-av-more {
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
		.dn-avatar-card:hover .dn-av-more,
		.dn-av-more:focus-visible { opacity: 1; }
		.dn-av-more:hover { background: var(--nxt-bg-3); border-color: var(--nxt-stroke-strong); }

		.dn-av-hover-actions {
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
		.dn-avatar-card:hover .dn-av-hover-actions {
			opacity: 1;
			transform: translateY(0);
			pointer-events: auto;
		}
		.dn-av-hover-btn {
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
		.dn-av-hover-btn:hover {
			background: rgba(14, 15, 22, 0.9);
			border-color: var(--nxt-stroke-strong);
		}

		.dn-av-body { padding: 10px 4px 4px; }
		.dn-av-name-row {
			display: flex;
			align-items: center;
			gap: 6px;
			margin-bottom: 6px;
		}
		.dn-av-name {
			font-size: 13.5px;
			font-weight: 600;
			color: var(--nxt-ink);
			cursor: pointer;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			flex: 1;
		}
		.dn-av-name:hover { color: var(--nxt-ink); opacity: 0.85; }
		.dn-av-pencil {
			background: transparent;
			border: 0;
			color: var(--nxt-ink-fade);
			cursor: pointer;
			padding: 4px;
			border-radius: 6px;
			opacity: 0;
			transition: opacity 0.16s ease, color 0.12s ease, background 0.12s ease;
		}
		.dn-avatar-card:hover .dn-av-pencil { opacity: 1; }
		.dn-av-pencil:hover { color: var(--nxt-ink); background: rgba(255,255,255,0.05); }
		.dn-av-name-input {
			flex: 1;
			background: rgba(255,255,255,0.06);
			border: 1px solid var(--nxt-stroke-strong);
			color: var(--nxt-ink);
			border-radius: 6px;
			padding: 4px 8px;
			font: inherit;
			font-weight: 600;
			outline: 0;
			min-width: 0;
		}

		.dn-av-meta {
			display: flex;
			align-items: center;
			gap: 8px;
			flex-wrap: wrap;
		}
		.dn-av-rel {
			font-size: 11.5px;
			color: var(--nxt-ink-fade);
		}

		/* More-menu popover */
		.dn-av-menu {
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
		.dn-av-menu.open { opacity: 1; transform: translateY(0); }
		.dn-av-menu-item {
			display: flex;
			align-items: center;
			justify-content: space-between;
			width: 100%;
			text-align: left;
			background: transparent;
			border: 0;
			padding: 8px 11px;
			font-size: 13px;
			color: var(--nxt-ink);
			border-radius: 6px;
			cursor: pointer;
			gap: 8px;
		}
		.dn-av-menu-item:hover { background: rgba(255,255,255,0.06); }
		.dn-av-menu-item.active { color: var(--nxt-ink); font-weight: 500; }
		.dn-av-menu-item.danger { color: var(--nxt-danger); }
		.dn-av-menu-item.danger:hover { background: rgba(150,155,163,0.12); }

		/* Load more */
		.dn-av-loadmore {
			display: flex;
			justify-content: center;
			padding: 26px 0 4px;
		}

		/* Delete confirm overlay */
		.dn-av-overlay {
			position: fixed;
			inset: 0;
			z-index: 300;
			display: grid;
			place-items: center;
			background: rgba(0, 0, 0, 0.55);
			backdrop-filter: blur(4px);
			opacity: 0;
			transition: opacity 140ms ease;
		}
		.dn-av-overlay.open { opacity: 1; }
		.dn-av-confirm {
			width: min(420px, 92vw);
			transform: translateY(8px);
			transition: transform 160ms ease;
		}
		.dn-av-overlay.open .dn-av-confirm { transform: translateY(0); }
		.dn-av-confirm-actions {
			display: flex;
			gap: 8px;
			justify-content: flex-end;
			margin-top: 16px;
		}

		/* Toaster */
		.dn-av-toaster {
			position: fixed;
			bottom: 24px;
			right: 24px;
			display: flex;
			flex-direction: column;
			gap: 8px;
			z-index: 400;
			pointer-events: none;
		}
		.dn-av-toast {
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
		.dn-av-toast.show { opacity: 1; transform: translateY(0); }
		.dn-av-toast.err { border-color: rgba(150,155,163,0.4); }

		@media (max-width: 720px) {
			.dn-av-head { flex-direction: column; align-items: stretch; }
			.dn-av-new-wrap { align-self: flex-start; }
			.dn-av-grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
			.dn-av-thumb { height: 220px; }
			.dn-av-hover-actions {
				opacity: 1;
				transform: translateY(0);
				pointer-events: auto;
			}
			.dn-av-hover-btn { font-size: 11px; padding: 4px 9px; }
		}

		/* Keyboard focus rings — tokens only */
		.dn-av-tab:focus-visible,
		.dn-av-chip:focus-visible,
		.dn-av-sort select:focus-visible,
		.dn-av-hover-btn:focus-visible,
		.dn-av-pencil:focus-visible,
		.dn-av-new-pop a:focus-visible,
		.dn-av-new-pop button:focus-visible {
			outline: 2px solid var(--nxt-accent);
			outline-offset: 2px;
		}
		.dn-av-menu-item:focus-visible {
			outline: 2px solid var(--nxt-accent);
			outline-offset: -2px;
			background: rgba(255,255,255,0.06);
		}

		/* Keyboard users reach the on-thumb actions without a pointer */
		.dn-avatar-card:focus-within .dn-av-hover-actions {
			opacity: 1;
			transform: translateY(0);
			pointer-events: auto;
		}
		.dn-avatar-card:focus-within .dn-av-more,
		.dn-avatar-card:focus-within .dn-av-pencil { opacity: 1; }

		/* Card enter — subtle, replayed on filter/tab rebuilds. No fill-mode so
		   the finished state reverts to base and :hover transforms still win. */
		@keyframes dn-av-card-in {
			from { opacity: 0; transform: translateY(6px); }
			to   { opacity: 1; transform: translateY(0); }
		}
		.dn-avatar-card:not(.dn-av-skeleton-card) {
			animation: dn-av-card-in 240ms ease;
		}

		@media (prefers-reduced-motion: reduce) {
			.dn-avatar-card,
			.dn-avatar-card:hover { transition: none; transform: none; }
			.dn-avatar-card:not(.dn-av-skeleton-card) { animation: none; }
			.dn-av-menu,
			.dn-av-hover-actions,
			.dn-av-toast,
			.dn-av-overlay,
			.dn-av-confirm { transition: none; }
		}
	`;
	document.head.appendChild(css);
}
