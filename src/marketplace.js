/**
 * Agent Marketplace — discovery + detail page controller.
 *
 * Two views in one SPA: list (with category sidebar + search) and detail
 * (5 tabs). Routing is path-based: /marketplace and /marketplace/agents/:id.
 */

const API = '/api/marketplace';

const CATEGORY_LABELS = {
	academic: 'Academic',
	career: 'Career',
	copywriting: 'Copywriting',
	design: 'Design',
	education: 'Education',
	emotions: 'Emotions',
	entertainment: 'Entertainment',
	games: 'Games',
	general: 'General',
	life: 'Life',
	marketing: 'Marketing',
	office: 'Office',
	programming: 'Programming',
	translation: 'Translation',
};

const state = {
	category: null, // null = Discover (all)
	q: '',
	sort: 'recommended',
	cursor: null,
	items: [],
	loading: false,
};

const $ = (id) => document.getElementById(id);
const els = {
	discovery: $('market-discovery'),
	detail: $('market-detail'),
	cats: $('market-cats'),
	grid: $('market-grid'),
	search: $('market-search'),
	sortSel: $('market-sort'),
	loadMore: $('market-loadmore'),
	back: $('market-back'),
};

// ── Routing ───────────────────────────────────────────────────────────────

function readRoute() {
	const m = location.pathname.match(/^\/marketplace\/agents\/([^/]+)/);
	return m ? { view: 'detail', id: m[1] } : { view: 'list' };
}

function navTo(path, replace = false) {
	const url = new URL(path, location.origin);
	if (replace) history.replaceState({}, '', url);
	else history.pushState({}, '', url);
	render();
}

window.addEventListener('popstate', render);

// ── List view ─────────────────────────────────────────────────────────────

async function loadCategories() {
	try {
		const r = await fetch(`${API}/categories`);
		const j = await r.json();
		renderCategories(j.data);
	} catch (err) {
		console.error('[marketplace] categories', err);
	}
}

function renderCategories(data) {
	const total = data?.total || 0;
	const counts = Object.fromEntries((data?.categories || []).map((c) => [c.slug, c.count]));
	const rows = [
		{ slug: null, label: 'Discover', count: null, head: true },
		{ slug: 'all', label: 'All', count: total },
		...Object.keys(CATEGORY_LABELS).map((slug) => ({
			slug,
			label: CATEGORY_LABELS[slug],
			count: counts[slug] || 0,
		})),
	];
	els.cats.innerHTML = rows
		.map((r) => {
			const active =
				(state.category === null && r.slug === null) ||
				(state.category === null && r.slug === 'all' && state.activeAll) ||
				state.category === r.slug;
			return `<div class="cat-row${active ? ' active' : ''}" data-cat="${r.slug ?? ''}">
				<span>${r.label}</span>
				${r.count != null ? `<span class="count">${r.count}</span>` : ''}
			</div>`;
		})
		.join('');
	els.cats.querySelectorAll('.cat-row').forEach((el) => {
		el.addEventListener('click', () => {
			const slug = el.dataset.cat || null;
			state.category = slug === 'all' ? null : slug;
			state.activeAll = slug === 'all';
			state.cursor = null;
			loadList(true);
			highlightActiveCat();
		});
	});
}

function highlightActiveCat() {
	els.cats.querySelectorAll('.cat-row').forEach((el) => {
		const slug = el.dataset.cat || null;
		const active =
			(state.category === null && !state.activeAll && slug === null) ||
			(state.activeAll && slug === 'all') ||
			state.category === slug;
		el.classList.toggle('active', !!active);
	});
}

async function loadList(reset = false) {
	if (state.loading) return;
	state.loading = true;
	if (reset) {
		state.items = [];
		state.cursor = null;
		els.grid.innerHTML = '<div class="market-empty">Loading…</div>';
	}
	try {
		const url = new URL(`${API}/agents`, location.origin);
		if (state.category) url.searchParams.set('category', state.category);
		if (state.q) url.searchParams.set('q', state.q);
		if (state.sort) url.searchParams.set('sort', state.sort);
		if (state.cursor) url.searchParams.set('cursor', state.cursor);
		const r = await fetch(url);
		const j = await r.json();
		const items = j?.data?.items || [];
		state.items = reset ? items : [...state.items, ...items];
		state.cursor = j?.data?.next_cursor || null;
		renderGrid();
	} catch (err) {
		console.error('[marketplace] list', err);
		els.grid.innerHTML = '<div class="market-empty">Failed to load agents.</div>';
	} finally {
		state.loading = false;
	}
}

function renderGrid() {
	if (!state.items.length) {
		els.grid.innerHTML = '<div class="market-empty">No agents yet. Be the first to publish!</div>';
		els.loadMore.hidden = true;
		return;
	}
	els.grid.innerHTML = state.items.map(renderCard).join('');
	els.grid.querySelectorAll('[data-id]').forEach((card) => {
		card.addEventListener('click', () => navTo(`/marketplace/agents/${card.dataset.id}`));
	});
	els.loadMore.hidden = !state.cursor;
}

function renderCard(a) {
	const date = a.published_at ? formatDate(a.published_at) : '';
	const skills = (a.skills || []).length;
	return `<div class="market-card-agent" data-id="${a.id}">
		<div class="head">
			<div class="avatar">${initial(a.name)}</div>
			<div style="min-width:0;flex:1">
				<div class="title">${escapeHtml(a.name || 'Untitled')}</div>
				<div class="author">${escapeHtml(a.category || 'general')}</div>
			</div>
		</div>
		<div class="desc">${escapeHtml(a.description || '')}</div>
		<div class="stats">
			<span class="stat-pill">⊙ ${a.views_count || 0}</span>
			<span class="stat-pill">⑂ ${a.forks_count || 0}</span>
			${skills ? `<span class="stat-pill">▤ ${skills}</span>` : ''}
		</div>
		<div class="footer">
			<span>${date}</span>
			<span class="cat-pill">${CATEGORY_LABELS[a.category] || a.category || ''}</span>
		</div>
	</div>`;
}

// ── Detail view ───────────────────────────────────────────────────────────

let detailState = null;

async function loadDetail(id) {
	els.discovery.hidden = true;
	els.detail.hidden = false;
	els.detail.scrollIntoView({ behavior: 'instant', block: 'start' });

	try {
		const [aR, vR, sR] = await Promise.all([
			fetch(`${API}/agents/${id}`),
			fetch(`${API}/agents/${id}/versions`),
			fetch(`${API}/agents/${id}/similar`),
		]);
		const aJ = await aR.json();
		if (!aR.ok) {
			renderDetailError(aJ?.error_description || 'Agent not found');
			return;
		}
		const a = aJ.data.agent;
		detailState = { agent: a, bookmarked: !!aJ.data.bookmarked };
		renderDetail(a, aJ.data.bookmarked);
		renderVersions((await vR.json())?.data?.versions || []);
		renderSimilar((await sR.json())?.data?.items || []);

		// Fire-and-forget view counter.
		fetch(`${API}/agents/${id}/view`, { method: 'POST' }).catch(() => {});
	} catch (err) {
		console.error('[marketplace] detail', err);
		renderDetailError('Failed to load agent.');
	}
}

function renderDetailError(msg) {
	$('d-name').textContent = msg;
	$('d-author').textContent = '';
	$('d-published').textContent = '';
	$('d-overview').textContent = '';
	$('d-overview-side').textContent = '';
	$('d-greeting').textContent = '';
}

function renderDetail(a, bookmarked) {
	$('d-name').textContent = a.name || 'Untitled';
	$('d-avatar').textContent = initial(a.name);
	$('d-author').textContent = a.author_name || 'Anonymous';
	$('d-published').textContent = a.published_at ? formatDate(a.published_at) : formatDate(a.created_at);
	$('d-category').textContent = CATEGORY_LABELS[a.category] || a.category || 'General';
	$('d-views').textContent = `⊙ ${a.views_count || 0}`;
	$('d-overview').textContent = a.description || '';
	$('d-overview-side').textContent = a.description || '';
	$('d-greeting').textContent = a.greeting || `Hello! I am ${a.name}. How can I help you today?`;
	$('d-profile').textContent = a.system_prompt || '(No profile yet.)';
	$('d-bookmark').classList.toggle('on', bookmarked);
	$('d-bookmark').textContent = bookmarked ? '★' : '☆';

	const forksEl = $('d-forks-pill');
	if (a.forks_count > 0) {
		forksEl.textContent = `⑂ ${a.forks_count} forks`;
		forksEl.hidden = false;
	} else {
		forksEl.hidden = true;
	}

	// Capabilities tab
	const caps = a.capabilities || {};
	const skillsArr = Array.isArray(caps.skills) ? caps.skills : a.skills || [];
	const libraryArr = Array.isArray(caps.library) ? caps.library : [];

	$('d-skills-count').textContent = skillsArr.length;
	$('d-library-count').textContent = libraryArr.length;

	$('d-skills').innerHTML = skillsArr.length
		? skillsArr.map((s) => `<span class="stat-pill">${escapeHtml(typeof s === 'string' ? s : s.name || '')}</span>`).join(' ')
		: '<div>This Agent includes the following Skills to help you complete more tasks.</div>';
	$('d-library').innerHTML = libraryArr.length
		? libraryArr.map((l) => `<span class="stat-pill">${escapeHtml(typeof l === 'string' ? l : l.name || '')}</span>`).join(' ')
		: '<div>This Agent includes the following Libraries to help answer more questions.</div>';

	// Profile capabilities list
	const list = caps.bullets && Array.isArray(caps.bullets) ? caps.bullets : [];
	$('d-capabilities-list').innerHTML = list
		.map((b) => `<li>${escapeHtml(b)}</li>`)
		.join('');
}

function renderVersions(versions) {
	const ul = $('d-versions');
	if (!versions.length) {
		ul.innerHTML = '<li>No published versions yet.</li>';
		return;
	}
	ul.innerHTML = versions
		.map(
			(v) => `<li>
				<span class="v">v${v.version}</span>
				<span class="changelog">${escapeHtml(v.changelog || '(no changelog)')}</span>
				<span class="when">${formatDate(v.created_at)}</span>
			</li>`,
		)
		.join('');
}

function renderSimilar(items) {
	const grid = $('d-similar');
	const side = $('d-related-side');
	if (!items.length) {
		grid.innerHTML = '<div class="market-empty">No related agents.</div>';
		side.innerHTML = '';
		return;
	}
	grid.innerHTML = items.map(renderCard).join('');
	grid.querySelectorAll('[data-id]').forEach((c) => {
		c.addEventListener('click', () => navTo(`/marketplace/agents/${c.dataset.id}`));
	});

	side.innerHTML =
		`<div class="related-side-title">Related Agents <a href="#" id="rel-more">View More ›</a></div>` +
		items
			.slice(0, 4)
			.map(
				(a) => `<div class="related-card" data-id="${a.id}">
					<div class="av">${initial(a.name)}</div>
					<div style="min-width:0">
						<div class="name">${escapeHtml(a.name || '')}</div>
						<div class="desc">${escapeHtml(a.description || '')}</div>
					</div>
				</div>`,
			)
			.join('');
	side.querySelectorAll('[data-id]').forEach((c) => {
		c.addEventListener('click', () => navTo(`/marketplace/agents/${c.dataset.id}`));
	});
}

// ── Tabs ──────────────────────────────────────────────────────────────────

function bindTabs() {
	document.querySelectorAll('.market-tabs button').forEach((btn) => {
		btn.addEventListener('click', () => {
			document.querySelectorAll('.market-tabs button').forEach((b) => b.classList.remove('active'));
			btn.classList.add('active');
			const tab = btn.dataset.tab;
			document.querySelectorAll('.market-panel').forEach((p) => {
				p.classList.toggle('active', p.dataset.panel === tab);
			});
		});
	});
}

// ── Actions ───────────────────────────────────────────────────────────────

async function fork() {
	if (!detailState) return;
	const id = detailState.agent.id;
	try {
		const r = await fetch(`${API}/agents/${id}/fork`, {
			method: 'POST',
			credentials: 'include',
		});
		if (r.status === 401) {
			location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
			return;
		}
		const j = await r.json();
		if (!r.ok) throw new Error(j?.error_description || 'Fork failed');
		// Send the user to chat with their new fork.
		const newId = j?.data?.agent?.id;
		if (newId) location.href = `/agent/${newId}`;
	} catch (err) {
		alert(err.message || 'Fork failed');
	}
}

async function toggleBookmark() {
	if (!detailState) return;
	const id = detailState.agent.id;
	const cur = detailState.bookmarked;
	try {
		const r = await fetch(`${API}/agents/${id}/bookmark`, {
			method: cur ? 'DELETE' : 'POST',
			credentials: 'include',
		});
		if (r.status === 401) {
			location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
			return;
		}
		const j = await r.json();
		detailState.bookmarked = !!j?.data?.bookmarked;
		$('d-bookmark').classList.toggle('on', detailState.bookmarked);
		$('d-bookmark').textContent = detailState.bookmarked ? '★' : '☆';
	} catch (err) {
		console.error('[marketplace] bookmark', err);
	}
}

// ── Wiring ────────────────────────────────────────────────────────────────

function bindEvents() {
	let searchTimer;
	els.search.addEventListener('input', (e) => {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			state.q = e.target.value.trim();
			loadList(true);
		}, 200);
	});
	els.sortSel.addEventListener('change', (e) => {
		state.sort = e.target.value;
		loadList(true);
	});
	els.loadMore.addEventListener('click', () => loadList(false));
	els.back.addEventListener('click', () => navTo('/marketplace'));
	$('d-fork').addEventListener('click', fork);
	$('d-bookmark').addEventListener('click', toggleBookmark);
	bindTabs();
}

// ── Util ──────────────────────────────────────────────────────────────────

function escapeHtml(s) {
	return String(s || '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
	);
}

function initial(name) {
	const s = String(name || '?').trim();
	return s ? s[0].toUpperCase() : '?';
}

function formatDate(iso) {
	if (!iso) return '';
	const d = new Date(iso);
	if (isNaN(d)) return '';
	return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ── Boot ──────────────────────────────────────────────────────────────────

function render() {
	const r = readRoute();
	if (r.view === 'detail') {
		loadDetail(r.id);
	} else {
		els.detail.hidden = true;
		els.discovery.hidden = false;
	}
}

function init() {
	bindEvents();
	loadCategories();
	loadList(true);
	render();
}

init();
