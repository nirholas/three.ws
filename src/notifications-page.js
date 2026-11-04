// Dedicated notification-center page (pages/notifications.html) — the full
// history view the nav bell dropdown (src/notifications.js) can't hold. Reuses
// the dropdown's icon/label/link/escaping helpers so the two surfaces always
// read identically; adds category tabs (built from the server's category list,
// see src/notification-categories.js), delete, and cursor pagination for the
// "hundreds of items" overflow case the dropdown never has to handle.

import { TYPE_ICON, notifLabel, notifLink, escNotif, relTime, trackInApp } from './notifications.js';
import { apiFetch } from './api.js';
import { categoryOf, visibleTabs, FALLBACK_CATEGORIES, FALLBACK_CATEGORY } from './notification-categories.js';

export { categoryOf };

const AUTH_HINT_KEY = '3dagent:auth-hint';
const PAGE_SIZE = 30;
const PREFS_ANCHOR = '/dashboard/settings#notification-preferences';

function isAuthed() {
	try {
		const raw = localStorage.getItem(AUTH_HINT_KEY);
		return raw ? JSON.parse(raw)?.authed === true : false;
	} catch { return false; }
}

const els = {};
let all = [];       // every notification fetched so far, newest-first
let activeTab = '';  // '' = all
let unread = 0;
let hasMore = true;
let loading = false;
// Category model served by GET /api/notifications/preferences. Until it
// arrives (or if it fails) every row resolves to the fallback category.
let typeMap = null;
let categories = FALLBACK_CATEGORIES;
let categoriesState = 'loading'; // 'loading' | 'ready' | 'failed'
let tabSignature = '';

function q(id) { return document.getElementById(id); }

function renderSkeleton() {
	els.list.innerHTML = Array.from({ length: 6 }).map(() => `
		<div class="n-skel-row">
			<div class="skeleton"></div>
			<div class="n-skel-body">
				<div class="skeleton skeleton-row" style="height:14px;width:70%"></div>
				<div class="skeleton skeleton-row" style="height:11px;width:30%"></div>
			</div>
		</div>
	`).join('');
}

function activeCategory() {
	return categories.find((c) => c.key === activeTab) || null;
}

function renderEmpty() {
	const cat = activeCategory();
	const heading = cat ? `Nothing under ${tabLabel(cat.key, cat.label)} yet` : 'No notifications yet';
	const body = cat?.description
		|| 'When your agent earns, sells, gets remixed, followed, or finishes a quest, you will see it here.';
	els.list.innerHTML = `
		<div class="n-empty">
			<div class="n-empty-icon" aria-hidden="true">🔔</div>
			<h3>${escNotif(heading)}</h3>
			<p>${escNotif(body)}</p>
			<a class="n-btn n-empty-link" href="${PREFS_ANCHOR}">Choose how ${cat ? 'these reach' : 'notifications reach'} you</a>
		</div>
	`;
	els.loadMoreWrap.hidden = !hasMore;
}

function filtered() {
	return activeTab ? all.filter((n) => categoryOf(n.type, typeMap) === activeTab) : all;
}

// Tab labels live in pages/notifications.html (#n-tab-labels) so the i18n
// runtime translates them like any other copy; a category the page has no
// string for yet uses the server's own label.
function tabLabel(key, serverLabel) {
	const el = els.tabLabels?.querySelector(`[data-cat="${CSS.escape(key)}"]`);
	const text = el?.textContent?.trim();
	return text || serverLabel || key;
}

function renderTabs() {
	const tabs = visibleTabs(categories, all, activeTab, typeMap, {
		always: categoriesState === 'failed' ? [FALLBACK_CATEGORY] : [],
	});
	const entries = [{ key: '', label: tabLabel('', 'All'), description: '' }]
		.concat(tabs.map((t) => ({ ...t, label: tabLabel(t.key, t.label) })));
	const signature = JSON.stringify([activeTab, entries.map((e) => [e.key, e.label])]);
	if (signature === tabSignature) return;
	tabSignature = signature;

	const focusedKey = els.tabs.contains(document.activeElement) ? document.activeElement.dataset.type : null;
	els.tabs.innerHTML = entries.map((e) => {
		const selected = e.key === activeTab;
		return `<button type="button" class="n-tab${selected ? ' active' : ''}" role="tab"
			id="n-tab-${escNotif(e.key || 'all')}" aria-controls="n-list"
			aria-selected="${selected}" tabindex="${selected ? 0 : -1}"
			data-type="${escNotif(e.key)}"${e.description ? ` title="${escNotif(e.description)}"` : ''}>${escNotif(e.label)}</button>`;
	}).join('');
	els.list.setAttribute('aria-labelledby', `n-tab-${activeTab || 'all'}`);
	if (focusedKey !== null && focusedKey !== undefined) {
		els.tabs.querySelector(`.n-tab[data-type="${CSS.escape(focusedKey)}"]`)?.focus();
	}
}

function selectTab(key, { focus = false } = {}) {
	activeTab = key;
	render();
	const tab = els.tabs.querySelector(`.n-tab[data-type="${CSS.escape(key)}"]`);
	if (focus) tab?.focus();
	tab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

function render() {
	renderTabs();
	const list = filtered();
	if (!list.length) return renderEmpty();

	els.list.innerHTML = list.map((n) => {
		const icon = TYPE_ICON[n.type] || '📣';
		const msg = notifLabel(n);
		const link = notifLink(n);
		const time = relTime(n.created_at);
		const rowUnread = !n.read_at;
		return `
			<div class="n-row${rowUnread ? ' is-unread' : ''}"
			     data-id="${escNotif(n.id)}"
			     data-link="${escNotif(link || '')}"
			     tabindex="0" role="button"
			     aria-label="${escNotif(msg)}${rowUnread ? ' (unread)' : ''}">
				<span class="n-icon" aria-hidden="true">${icon}</span>
				<div class="n-body">
					<div class="n-msg">${escNotif(msg)}</div>
					<div class="n-time">${escNotif(time)}</div>
				</div>
				${rowUnread ? '<span class="n-dot" aria-hidden="true"></span>' : ''}
				<button type="button" class="n-del" data-id="${escNotif(n.id)}" aria-label="Delete notification" title="Delete">✕</button>
			</div>
		`;
	}).join('');

	els.list.querySelectorAll('.n-row').forEach((row) => {
		const activate = (e) => {
			if (e.target.closest('.n-del')) return;
			const id = row.dataset.id;
			const link = row.dataset.link;
			if (id) trackInApp(id, 'opened');
			if (id && row.classList.contains('is-unread')) markOneRead(id, row);
			if (link) {
				if (link.startsWith('http')) window.open(link, '_blank', 'noopener');
				else window.location.href = link;
			}
		};
		row.addEventListener('click', activate);
		row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(e); } });
	});
	els.list.querySelectorAll('.n-del').forEach((btn) => {
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			deleteOne(btn.dataset.id);
		});
	});

	els.loadMoreWrap.hidden = !hasMore;
}

function markOneRead(id, rowEl) {
	const n = all.find((x) => x.id === id);
	if (!n || n.read_at) return;
	n.read_at = new Date().toISOString();
	unread = Math.max(0, unread - 1);
	rowEl?.classList.remove('is-unread');
	rowEl?.querySelector('.n-dot')?.remove();
	apiFetch(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'POST', credentials: 'include', allowAnonymous: true }).catch(() => {});
}

async function markAllRead() {
	els.markAll.disabled = true;
	els.markAll.textContent = 'Done ✓';
	all.forEach((n) => { n.read_at = n.read_at || new Date().toISOString(); });
	unread = 0;
	render();
	try {
		await apiFetch('/api/notifications/read-all', { method: 'POST', credentials: 'include', allowAnonymous: true });
	} catch { /* fire-and-forget */ }
}

function deleteOne(id) {
	const row = els.list.querySelector(`.n-row[data-id="${CSS.escape(id)}"]`);
	row?.remove();
	const wasUnread = all.find((n) => n.id === id && !n.read_at);
	all = all.filter((n) => n.id !== id);
	if (wasUnread) unread = Math.max(0, unread - 1);
	renderTabs();
	if (!filtered().length) renderEmpty();
	apiFetch(`/api/notifications/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include', allowAnonymous: true }).catch(() => {});
}

async function loadPage(before) {
	if (loading) return;
	loading = true;
	els.loadMoreBtn.disabled = true;
	els.loadMoreBtn.textContent = 'Loading…';
	try {
		const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
		if (before) params.set('before', before);
		const resp = await fetch(`/api/notifications?${params}`, { credentials: 'include' });
		if (resp.status === 401) {
			els.authWall.hidden = false;
			els.main.hidden = true;
			return;
		}
		if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
		const data = await resp.json();
		const fresh = data.notifications || [];
		all = before ? [...all, ...fresh] : fresh;
		unread = data.unread_count ?? unread;
		hasMore = !!data.has_more;
		render();
	} catch (err) {
		els.error.textContent = 'Could not load notifications. Try refreshing the page.';
		els.error.hidden = false;
	} finally {
		loading = false;
		els.loadMoreBtn.disabled = false;
		els.loadMoreBtn.textContent = 'Load more';
	}
}

function wireTabs() {
	els.tabs.addEventListener('click', (e) => {
		const tab = e.target.closest('.n-tab');
		if (tab) selectTab(tab.dataset.type || '');
	});
	// WAI-ARIA tabs pattern: arrows move between tabs and select (automatic
	// activation, the list filters instantly), Home and End jump to the ends.
	els.tabs.addEventListener('keydown', (e) => {
		const tabs = [...els.tabs.querySelectorAll('.n-tab')];
		const i = tabs.indexOf(e.target.closest('.n-tab'));
		if (i < 0) return;
		let next = -1;
		if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
		else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
		else if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = tabs.length - 1;
		if (next < 0) return;
		e.preventDefault();
		selectTab(tabs[next].dataset.type || '', { focus: true });
	});
	// A locale switch rewrites #n-tab-labels; rebuild the strip from it.
	window.addEventListener('i18n:change', () => {
		tabSignature = '';
		if (!loading) render();
	});
}

// GET /api/notifications/preferences carries the authoritative category list
// and type map. A failure never blocks the list: rows stay visible under All
// and Account, and the notice offers a retry.
async function loadCategories() {
	categoriesState = 'loading';
	els.catNotice.hidden = true;
	els.catRetry.disabled = true;
	try {
		const resp = await fetch('/api/notifications/preferences', { credentials: 'include' });
		if (resp.status === 401) return; // loadPage() shows the sign-in wall
		if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
		const data = await resp.json();
		if (!Array.isArray(data.categories) || !data.type_categories || typeof data.type_categories !== 'object') {
			throw new Error('preferences response has no category model');
		}
		categories = data.categories;
		typeMap = data.type_categories;
		categoriesState = 'ready';
	} catch {
		categories = FALLBACK_CATEGORIES;
		typeMap = null;
		categoriesState = 'failed';
		if (activeTab && activeTab !== FALLBACK_CATEGORY) activeTab = '';
		els.catNotice.hidden = false;
	} finally {
		els.catRetry.disabled = false;
		tabSignature = '';
		if (!loading && !els.main.hidden) render();
	}
}

async function init() {
	els.authWall = q('n-auth-wall');
	els.error = q('n-error');
	els.main = q('n-main');
	els.tabs = q('n-tabs');
	els.tabLabels = q('n-tab-labels');
	els.catNotice = q('n-cat-notice');
	els.catRetry = q('n-cat-retry');
	els.list = q('n-list');
	els.markAll = q('n-mark-all');
	els.loadMoreWrap = q('n-load-more');
	els.loadMoreBtn = q('n-load-more-btn');

	if (!isAuthed()) {
		els.authWall.hidden = false;
		return;
	}

	els.main.hidden = false;
	renderSkeleton();
	wireTabs();
	els.catRetry.addEventListener('click', () => loadCategories());
	els.markAll.addEventListener('click', markAllRead);
	els.loadMoreBtn.addEventListener('click', () => {
		const last = all[all.length - 1];
		if (last) loadPage(last.created_at);
	});

	await Promise.all([loadCategories(), loadPage(null)]);
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', init);
} else {
	init();
}
