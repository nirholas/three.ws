
/**
 * Agent Marketplace — discovery + detail page controller.
 *
 * Two views in one SPA: list (with category sidebar + search) and detail
 * (5 tabs). Routing is path-based: /marketplace and /marketplace/agents/:id.
 */


const API = '/api';

let purchasedSkills = new Set();

async function fetchUserPurchases() {
	try {
		const r = await fetch(`${API}/users/me/purchased-skills`, { credentials: 'include' });
		if (!r.ok) return;
		const j = await r.json();
		const list = j.data?.purchases || [];
		purchasedSkills = new Set(list.map((p) => `${p.agent_id}:${p.skill}`));
	} catch (err) {
		console.error('[marketplace] purchases', err);
	}
}


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
	blockchain: 'Blockchain',
};

const state = {
	category: null, // null = Discover (all)
	q: '',
	sort: 'recommended',
	filter: 'all', // all | agents | avatars
	cursor: null,
	items: [],
	loading: false,
	publicAvatars: [],
	publicAvatarsLoaded: false,
	featured: [],
	heroIndex: 0,
	heroTimer: null,
	stats: null,
};

const WIP_DISMISS_KEY = 'marketplace_wip_dismissed_v1';

const $ = (id) => document.getElementById(id);
const els = {
	discovery: $('market-discovery'),
	detail: $('market-detail'),
	tools: $('market-tools'),
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
	if (m) return { view: 'detail', id: m[1] };
	const tab = new URLSearchParams(location.search).get('tab');
	if (tab === 'tools') return { view: 'tools' };
	if (tab === 'skills') return { view: 'skills' };
	if (tab === 'mine') return { view: 'mine' };
	if (tab === 'avatars') return { view: 'list', filter: 'avatars' };
	return { view: 'list' };
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
		const r = await fetch(`${API}/marketplace/categories`);
		const j = await r.json();
		renderCategories(j.data);
	} catch (err) {
		console.error('[marketplace] categories', err);
	}
}

function renderCategories(data) {
	const total = data?.total || 0;
	const counts = Object.fromEntries((data?.categories || []).map((cat) => [cat.slug, cat.count]));
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
		const url = new URL(`${API}/marketplace/agents`, location.origin);
		if (state.category) url.searchParams.set('category', state.category);
		if (state.q) url.searchParams.set('q', state.q);
		if (state.sort) url.searchParams.set('sort', state.sort);
		if (state.cursor) url.searchParams.set('cursor', state.cursor);
		const r = await fetch(url);
		const j = await r.json();
		// Real endpoint wraps as { data: { items, next_cursor } }; legacy mock returns a bare array.
		const items = Array.isArray(j) ? j : (j?.data?.items ?? []);
		const nextCursor = Array.isArray(j) ? null : (j?.data?.next_cursor ?? null);
		state.items = reset ? items : [...state.items, ...items];
		state.cursor = nextCursor;
		renderGrid();
	} catch (err) {
		console.error('[marketplace] list', err);
		els.grid.innerHTML = '<div class="market-empty">Failed to load agents.</div>';
	} finally {
		state.loading = false;
	}

	if (reset) {
		loadPublicAvatars();
		loadFeatured();
	}
}

// Mirrors server-side NAME_AUTONAMED_RE in api/explore.js. Client-side filter
// is defense-in-depth: until the server filter ships, the marketplace still
// looks curated by hiding obvious junk locally.
const AVATAR_AUTONAMED_RE =
	/^(Avatar #[0-9a-f]{6}|Avatar \d+\/\d+\/\d{4}.*|mo[a-z0-9]{4,}|draft-[a-z0-9]+|[a-f0-9-]{30,}|new_project_\d+|TEST|test|Untitled.*)$/i;

function isAutoNamedAvatar(name) {
	const n = String(name || '').trim();
	if (!n) return true;
	return AVATAR_AUTONAMED_RE.test(n);
}

async function loadPublicAvatars() {
	try {
		const url = new URL(`${API}/explore`, location.origin);
		url.searchParams.set('source', 'avatar');
		url.searchParams.set('limit', '60');
		url.searchParams.set('quality', 'high');
		if (state.q) url.searchParams.set('q', state.q);
		const r = await fetch(url);
		if (!r.ok) return;
		const j = await r.json();
		const avatars = (j?.items || []).filter(
			(it) => it.kind === 'avatar' && it.glbUrl && !isAutoNamedAvatar(it.name),
		);
		state.publicAvatars = avatars;
		state.publicAvatarsLoaded = true;
		state.stats = j?.totals || state.stats;
		renderGrid();
		renderHeroStats();
	} catch (err) {
		console.error('[marketplace] public avatars', err);
	}
}

// ── Featured hero (rotating 3D showcase) ─────────────────────────────────

async function loadFeatured() {
	if (state.featured.length || state.q || state.category) return;
	try {
		const url = new URL(`${API}/explore`, location.origin);
		url.searchParams.set('source', 'avatar');
		url.searchParams.set('quality', 'high');
		url.searchParams.set('limit', '12');
		const r = await fetch(url);
		if (!r.ok) return;
		const j = await r.json();
		const named = (j?.items || []).filter(
			(it) =>
				it.kind === 'avatar' &&
				it.glbUrl &&
				!isAutoNamedAvatar(it.name) &&
				String(it.name).trim().length > 1,
		);
		state.featured = named.slice(0, 3);
		if (!state.featured.length) {
			// Fall back to any 3 avatars with a GLB so the hero never shows blank.
			state.featured = (j?.items || [])
				.filter((it) => it.kind === 'avatar' && it.glbUrl)
				.slice(0, 3);
		}
		state.heroIndex = 0;
		renderHero();
		startHeroAutoplay();
	} catch (err) {
		console.error('[marketplace] featured', err);
	}
}

function renderHero() {
	const hero = $('market-hero');
	if (!hero) return;
	if (!state.featured.length) {
		hero.hidden = true;
		return;
	}
	hero.hidden = false;
	const stage = $('market-hero-stage');
	const dots = $('market-hero-dots');
	stage.innerHTML = state.featured
		.map(
			(a, i) => `
				<div class="market-hero-slide${i === state.heroIndex ? ' active' : ''}" data-slot="${i}">
					<model-viewer
						src="${escapeHtml(a.glbUrl)}"
						alt="${escapeHtml(a.name || 'Avatar')}"
						auto-rotate
						rotation-per-second="20deg"
						camera-controls
						interaction-prompt="none"
						exposure="1.05"
						shadow-intensity="0.8"
						tone-mapping="aces"
						loading="${i === state.heroIndex ? 'eager' : 'lazy'}"
						reveal="auto"
					></model-viewer>
				</div>`,
		)
		.join('');
	dots.innerHTML = state.featured
		.map(
			(_, i) =>
				`<button class="market-hero-dot${i === state.heroIndex ? ' active' : ''}" data-dot="${i}" aria-label="Slide ${i + 1}"></button>`,
		)
		.join('');
	dots.querySelectorAll('[data-dot]').forEach((btn) => {
		btn.addEventListener('click', () => {
			state.heroIndex = Number(btn.dataset.dot);
			renderHero();
			startHeroAutoplay();
		});
	});
	updateHeroMeta();
}

function updateHeroMeta() {
	const a = state.featured[state.heroIndex];
	if (!a) return;
	$('market-hero-title').textContent = a.name || 'Untitled avatar';
	$('market-hero-desc').textContent =
		a.description ||
		(a.author?.handle
			? `A 3D avatar by ${a.author.handle}.`
			: 'A 3D avatar published to the community.');
	const view = $('market-hero-view');
	if (view) {
		view.onclick = () => {
			location.href = a.avatarId ? `/avatars/${a.avatarId}` : a.viewerUrl || '/';
		};
	}
	renderHeroStats();
}

function renderHeroStats() {
	const el = $('market-hero-stats');
	if (!el) return;
	const totals = state.stats;
	if (!totals) return;
	const items = [];
	if (totals.avatars != null) items.push(`<span><strong>${fmtNumber(totals.avatars)}</strong> avatars</span>`);
	if (totals.onchain != null) items.push(`<span><strong>${fmtNumber(totals.onchain)}</strong> onchain agents</span>`);
	if (totals.threeD != null) items.push(`<span><strong>${fmtNumber(totals.threeD)}</strong> in 3D</span>`);
	el.innerHTML = items.join('<span class="dot">·</span>');
	updateNavCounts();
}

// Update sidebar count badges from current state. Called after the explore
// feed settles so the nav reflects what's actually browsable.
function updateNavCounts() {
	const agentEl = $('nav-count-agent');
	const avatarEl = $('nav-count-avatar');
	const totals = state.stats || {};
	if (agentEl) {
		const n = Number(totals.onchain ?? state.items.length);
		if (Number.isFinite(n) && n > 0) {
			agentEl.textContent = fmtNumber(n);
			agentEl.hidden = false;
		} else {
			agentEl.hidden = true;
		}
	}
	if (avatarEl) {
		const n = Number(totals.avatars ?? state.publicAvatars.length);
		if (Number.isFinite(n) && n > 0) {
			avatarEl.textContent = fmtNumber(n);
			avatarEl.hidden = false;
		} else {
			avatarEl.hidden = true;
		}
	}
}

function startHeroAutoplay() {
	if (state.heroTimer) clearInterval(state.heroTimer);
	if (state.featured.length < 2) return;
	state.heroTimer = setInterval(() => {
		state.heroIndex = (state.heroIndex + 1) % state.featured.length;
		// Cheap update — just toggle active classes + meta, don't re-render model-viewers.
		document.querySelectorAll('.market-hero-slide').forEach((el) => {
			el.classList.toggle('active', Number(el.dataset.slot) === state.heroIndex);
		});
		document.querySelectorAll('.market-hero-dot').forEach((el) => {
			el.classList.toggle('active', Number(el.dataset.dot) === state.heroIndex);
		});
		updateHeroMeta();
	}, 6500);
}

function stopHeroAutoplay() {
	if (state.heroTimer) clearInterval(state.heroTimer);
	state.heroTimer = null;
}

// ── WIP banner dismiss ───────────────────────────────────────────────────

function initWipBanner() {
	const banner = $('market-wip-banner');
	const dismiss = $('market-wip-dismiss');
	if (!banner) return;
	const dismissed = (() => {
		try {
			return localStorage.getItem(WIP_DISMISS_KEY) === '1';
		} catch {
			return false;
		}
	})();
	banner.hidden = dismissed;
	if (dismiss) {
		dismiss.addEventListener('click', () => {
			banner.hidden = true;
			try {
				localStorage.setItem(WIP_DISMISS_KEY, '1');
			} catch {
				// localStorage unavailable — banner stays dismissed only for the session
			}
		});
	}
}

// ── Filter chips (All / Agents / Avatars) ────────────────────────────────

function bindFilterChips() {
	const chips = document.querySelectorAll('#market-filter-chips .market-chip');
	chips.forEach((chip) => {
		chip.addEventListener('click', () => {
			chips.forEach((c) => c.classList.remove('active'));
			chip.classList.add('active');
			state.filter = chip.dataset.filter || 'all';
			// Hero showcases community avatars; hide it when filter is agents-only.
			const hero = $('market-hero');
			if (hero) {
				if (state.filter === 'agents') {
					hero.hidden = true;
					stopHeroAutoplay();
				} else if (state.featured.length) {
					hero.hidden = false;
					startHeroAutoplay();
				}
			}
			renderGrid();
		});
	});
}

function renderGrid() {
	const showAgents = state.filter !== 'avatars';
	const showAvatars = state.filter !== 'agents' && !state.category;
	const agentItems = showAgents ? state.items : [];
	const avatars = showAvatars ? state.publicAvatars : [];

	if (!agentItems.length && !avatars.length) {
		let msg;
		if (!state.publicAvatarsLoaded && !state.items.length) {
			msg = renderSkeletons(8);
		} else if (state.filter === 'agents') {
			msg = '<div class="market-empty">No agents published yet. Be the first.</div>';
		} else if (state.filter === 'avatars') {
			msg = '<div class="market-empty">No public avatars match your search.</div>';
		} else {
			msg = '<div class="market-empty">Nothing here yet — try a different search.</div>';
		}
		els.grid.innerHTML = msg;
		els.loadMore.hidden = true;
		return;
	}

	let html = '';
	if (agentItems.length) {
		if (state.filter === 'all' && avatars.length) {
			html += `<div class="market-grid-section-title">Agents <span class="count">${agentItems.length}</span></div>`;
		}
		html += agentItems.map(renderCard).join('');
	}
	if (avatars.length) {
		if (state.filter === 'all' && agentItems.length) {
			html += `<div class="market-grid-section-title">Community Avatars <span class="count">${avatars.length} public</span></div>`;
		}
		html += avatars.map(renderAvatarCard).join('');
	}
	els.grid.innerHTML = html;

	els.grid.querySelectorAll('[data-id]').forEach((card) => {
		card.addEventListener('click', () => navTo(`/marketplace/agents/${card.dataset.id}`));
	});
	els.grid.querySelectorAll('[data-avatar-id]').forEach((card) => {
		card.addEventListener('click', (e) => {
			// Don't trigger card nav when clicking the embedded author link.
			if (e.target.closest('a')) return;
			const id = card.dataset.avatarId;
			const avatar = state.publicAvatars.find((a) => a.avatarId === id);
			if (avatar) openAvatarModal(avatar);
		});
	});
	els.loadMore.hidden = !state.cursor;
}

// ── Avatar detail modal ──────────────────────────────────────────────────

let activeAvatar = null;

function openAvatarModal(avatar) {
	activeAvatar = avatar;
	const overlay = $('avatar-modal-overlay');
	const stage = $('avatar-modal-stage');
	if (!overlay || !stage) return;

	const closeBtn = stage.querySelector('.avatar-modal-close');
	stage.innerHTML = '';
	if (closeBtn) stage.appendChild(closeBtn);
	const mv = document.createElement('model-viewer');
	mv.setAttribute('src', avatar.glbUrl || '');
	mv.setAttribute('alt', avatar.name || 'Avatar');
	mv.setAttribute('auto-rotate', '');
	mv.setAttribute('rotation-per-second', '18deg');
	mv.setAttribute('camera-controls', '');
	mv.setAttribute('interaction-prompt', 'none');
	mv.setAttribute('exposure', '1.05');
	mv.setAttribute('shadow-intensity', '0.7');
	mv.setAttribute('tone-mapping', 'aces');
	stage.appendChild(mv);

	$('avatar-modal-title').textContent = avatar.name || 'Untitled avatar';
	$('avatar-modal-desc').textContent =
		avatar.description ||
		'A 3D avatar published to the community. You can use it as the visual identity for a new agent.';

	const meta = $('avatar-modal-meta');
	const pills = [];
	if (avatar.createdAt) pills.push(`<span class="stat-pill">${escapeHtml(liveTime(avatar.createdAt))}</span>`);
	if (avatar.has3d !== false) pills.push('<span class="stat-pill">3D · GLB</span>');
	(avatar.tags || []).slice(0, 4).forEach((t) => {
		pills.push(`<span class="stat-pill">#${escapeHtml(t)}</span>`);
	});
	meta.innerHTML = pills.join('');

	const view = $('avatar-modal-view');
	if (view) {
		view.href = avatar.viewerUrl || (avatar.glbUrl ? `/#model=${encodeURIComponent(avatar.glbUrl)}` : '#');
	}
	const dl = $('avatar-modal-download');
	if (dl) {
		dl.href = avatar.glbUrl || '#';
		dl.download = (avatar.slug || avatar.avatarId || 'avatar') + '.glb';
	}

	overlay.hidden = false;
	requestAnimationFrame(() => overlay.classList.add('show'));
}

function closeAvatarModal() {
	const overlay = $('avatar-modal-overlay');
	if (!overlay) return;
	overlay.classList.remove('show');
	setTimeout(() => {
		overlay.hidden = true;
		const stage = $('avatar-modal-stage');
		const closeBtn = stage?.querySelector('.avatar-modal-close');
		if (stage) {
			stage.innerHTML = '';
			if (closeBtn) stage.appendChild(closeBtn);
		}
		activeAvatar = null;
	}, 200);
}

async function startAgentFromAvatar() {
	if (!activeAvatar) return;
	const params = new URLSearchParams({ avatar_id: activeAvatar.avatarId || '' });
	if (activeAvatar.name) params.set('avatar_name', activeAvatar.name);
	if (activeAvatar.glbUrl) params.set('avatar_glb', activeAvatar.glbUrl);
	location.href = `/agent-edit.html?${params.toString()}`;
}

// ── Skills marketplace tab ───────────────────────────────────────────────

const skillsState = {
	loaded: false,
	loading: false,
	skills: [],
	q: '',
	filter: 'all',
};

async function loadSkillsTab(force = false) {
	if (skillsState.loading) return;
	if (skillsState.loaded && !force) {
		renderSkillsGrid();
		return;
	}
	skillsState.loading = true;
	const grid = $('skills-grid');
	if (grid) grid.innerHTML = renderSkeletons(8);

	try {
		const url = new URL(`${API}/marketplace/agents`, location.origin);
		url.searchParams.set('limit', '48');
		const r = await fetch(url);
		const j = await r.json();
		const items = Array.isArray(j) ? j : (j?.data?.items ?? []);

		const flat = [];
		for (const a of items) {
			const skills = Array.isArray(a.skills) ? a.skills : [];
			for (const s of skills) {
				const name = typeof s === 'string' ? s : s?.name;
				if (!name) continue;
				flat.push({
					name: String(name),
					agentId: a.id,
					agentName: a.name || 'Untitled',
					agentAuthor: a.author_name || 'Anonymous',
					agentAvatar: a.thumbnail_url || null,
					paid: !!a.has_paid_skills,
					category: a.category,
				});
			}
		}
		flat.sort((a, b) => Number(b.paid) - Number(a.paid) || a.name.localeCompare(b.name));
		skillsState.skills = flat;
		skillsState.loaded = true;
	} catch (err) {
		console.error('[marketplace] skills load', err);
	} finally {
		skillsState.loading = false;
	}
	renderSkillsGrid();
}

function renderSkillsGrid() {
	const grid = $('skills-grid');
	if (!grid) return;
	const q = skillsState.q.toLowerCase();
	const filtered = skillsState.skills.filter((s) => {
		if (skillsState.filter === 'paid' && !s.paid) return false;
		if (skillsState.filter === 'free' && s.paid) return false;
		if (q && !(s.name.toLowerCase().includes(q) || s.agentName.toLowerCase().includes(q))) return false;
		return true;
	});
	const sub = $('skills-subtitle');
	if (sub) sub.textContent = `${filtered.length} ${filtered.length === 1 ? 'skill' : 'skills'} across the marketplace`;

	if (!filtered.length) {
		const msg = !skillsState.skills.length
			? `<div class="market-empty-cta">
					<h3>No skills published yet</h3>
					<p>Skills appear here once agents are published with capabilities. Be the first to publish.</p>
					<button id="skills-empty-publish">Submit an Agent</button>
				</div>`
			: '<div class="market-empty">No skills match your filter.</div>';
		grid.innerHTML = msg;
		const btn = $('skills-empty-publish');
		if (btn) btn.addEventListener('click', openSubmitModal);
		return;
	}
	grid.innerHTML = filtered.map(renderSkillCard).join('');
	grid.querySelectorAll('[data-agent-id]').forEach((card) => {
		card.addEventListener('click', () => {
			const id = card.dataset.agentId;
			if (id) navTo(`/marketplace/agents/${id}`);
		});
	});
}

function renderSkillCard(s) {
	const av = s.agentAvatar
		? `<span class="av" style="background:url('${escapeHtml(s.agentAvatar)}') center/cover"></span>`
		: `<span class="av">${escapeHtml(initial(s.agentName))}</span>`;
	return `<div class="market-skill-card" data-agent-id="${escapeHtml(s.agentId)}">
		<div class="skill-head">
			<div class="skill-name">${escapeHtml(s.name)}</div>
			<div class="skill-price ${s.paid ? 'paid' : 'free'}">${s.paid ? 'Paid' : 'Free'}</div>
		</div>
		<div class="skill-agent">${av}<span>${escapeHtml(s.agentName)}</span></div>
		<div class="skill-cta ${s.paid ? 'purchase' : ''}">${s.paid ? 'View &amp; purchase →' : 'Open agent →'}</div>
	</div>`;
}

// ── My Agents tab ────────────────────────────────────────────────────────

const mineState = { loaded: false, loading: false, items: [] };

async function loadMine(force = false) {
	if (mineState.loading) return;
	if (mineState.loaded && !force) return renderMineGrid();
	mineState.loading = true;
	const grid = $('mine-grid');
	if (grid) grid.innerHTML = renderSkeletons(4);
	try {
		const r = await fetch(`${API}/marketplace/agents/mine`, { credentials: 'include' });
		if (r.status === 401) {
			grid.innerHTML = `<div class="market-empty-cta">
					<h3>Sign in to see your agents</h3>
					<p>Your published and draft agents will appear here.</p>
					<button id="mine-signin">Sign in</button>
				</div>`;
			$('mine-signin')?.addEventListener('click', () => {
				location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
			});
			mineState.loading = false;
			return;
		}
		const j = await r.json().catch(() => ({}));
		mineState.items = Array.isArray(j) ? j : (j?.data?.items ?? []);
		mineState.loaded = true;
	} catch (err) {
		console.error('[marketplace] mine', err);
	} finally {
		mineState.loading = false;
	}
	renderMineGrid();
}

function renderMineGrid() {
	const grid = $('mine-grid');
	const sub = $('mine-subtitle');
	if (!grid) return;
	if (sub) {
		sub.textContent = mineState.items.length
			? `${mineState.items.length} ${mineState.items.length === 1 ? 'agent' : 'agents'}`
			: '';
	}
	if (!mineState.items.length) {
		grid.innerHTML = `<div class="market-empty-cta">
				<h3>No agents yet</h3>
				<p>Create your first agent — it'll appear here as draft, then publish when you're ready.</p>
				<button id="mine-empty-new">+ New Agent</button>
			</div>`;
		$('mine-empty-new')?.addEventListener('click', () => {
			location.href = '/agent-edit.html';
		});
		return;
	}
	grid.innerHTML = mineState.items.map(renderCard).join('');
	grid.querySelectorAll('[data-id]').forEach((card) => {
		card.addEventListener('click', () => navTo(`/marketplace/agents/${card.dataset.id}`));
	});
}

function renderSkeletons(n) {
	const cards = Array.from({ length: n }, () =>
		`<div class="market-card-skeleton"><div class="sk-thumb"></div><div class="sk-line"></div><div class="sk-line short"></div></div>`,
	).join('');
	return cards;
}

function renderAvatarCard(a) {
	const name = escapeHtml(a.name || 'Untitled avatar');
	const desc = escapeHtml(a.description || '');
	const when = a.createdAt ? liveTime(a.createdAt) : '';
	const author = a.author;
	const authorLine = author?.profileUrl
		? `<a class="card-author" href="${escapeHtml(author.profileUrl)}" rel="author">${escapeHtml(author.displayName || author.handle)}</a>`
		: author?.handle
			? `<span class="card-author">${escapeHtml(author.displayName || author.handle)}</span>`
			: `<span class="card-author muted">Anonymous</span>`;
	const tags = (a.tags || []).slice(0, 3);
	const tagPills = tags.length
		? `<div class="card-tags">${tags.map((t) => `<span class="tag-pill">${escapeHtml(t)}</span>`).join('')}</div>`
		: '';
	const preview = a.image
		? `<img src="${escapeHtml(a.image)}" alt="${name}" loading="lazy" decoding="async" />`
		: a.glbUrl
			? `<model-viewer
					src="${escapeHtml(a.glbUrl)}"
					alt="${name}"
					auto-rotate
					rotation-per-second="14deg"
					interaction-prompt="none"
					disable-zoom
					disable-pan
					disable-tap
					exposure="1"
					shadow-intensity="0.4"
					tone-mapping="aces"
					loading="lazy"
					reveal="auto"
				></model-viewer>`
			: `<div class="thumb-fallback">◉</div>`;
	return `<div class="market-card-avatar" data-avatar-id="${escapeHtml(a.avatarId || '')}">
		<div class="thumb">${preview}</div>
		<div class="body">
			<div class="title">${name}</div>
			<div class="byline">${authorLine}${when ? `<span class="dot">·</span><span class="when">${escapeHtml(when)}</span>` : ''}</div>
			${desc ? `<div class="desc">${desc}</div>` : ''}
			${tagPills}
			<div class="footer">
				<span class="avatar-pill">3D Avatar</span>
				<span class="open-cta">Open →</span>
			</div>
		</div>
	</div>`;
}

function renderCard(a) {
	const published = a.published_at || a.published || a.created_at;
	const date = published ? formatDate(published) : '';
	const skillsCount = (a.skills || []).length;
	const author = a.author_name || a.author || 'Anonymous';
	const views = a.views_count ?? a.views ?? 0;
	const forks = a.forks_count ?? a.forks ?? 0;
	const paid = a.has_paid_skills || Object.keys(a.skill_prices || {}).length > 0;
	const avatarBlock = a.thumbnail_url
		? `<div class="avatar avatar-img" style="background-image:url('${escapeHtml(a.thumbnail_url)}')"></div>`
		: `<div class="avatar">${escapeHtml(initial(a.name))}</div>`;
	return `<div class="market-card-agent" data-id="${a.id}">
		<div class="head">
			${avatarBlock}
			<div style="min-width:0;flex:1">
				<div class="title">${escapeHtml(a.name || 'Untitled')}</div>
				<div class="author">${escapeHtml(author)}</div>
			</div>
		</div>
		<div class="desc">${escapeHtml(a.description || '')}</div>
		<div class="stats">
			<span class="stat-pill">⊙ ${fmtNumber(views)}</span>
			<span class="stat-pill">⑂ ${fmtNumber(forks)}</span>
			${skillsCount ? `<span class="stat-pill">▤ ${skillsCount}</span>` : ''}
			${paid ? `<span class="stat-pill paid-badge">$ Paid</span>` : ''}
		</div>
		<div class="footer">
			<span>${date}</span>
			<span class="cat-pill">${CATEGORY_LABELS[a.category] || a.category || ''}</span>
		</div>
	</div>`;
}

// ── Detail view ───────────────────────────────────────────────────────────

let detailState = null;
let unlockedSkills = new Set(); // In a real app, this would be populated from an API call on load

// --- New function, refactored from renderDetail ---
function renderSkillList(agent) {
    const skillsContainer = $('d-skills');
    if (!skillsContainer) return;

    const skillsArr = Array.isArray(agent.capabilities.skills) ? agent.capabilities.skills : agent.skills || [];
    const skillPrices = agent.skill_prices || {};
    
    skillsContainer.innerHTML = skillsArr.length
        ? skillsArr.map((s) => {
            const name = typeof s === 'string' ? s : (s.name || '');
            const price = skillPrices[name];
            
            let actionButton;
            if (unlockedSkills.has(name)) {
                actionButton = `<button class="skill-btn" disabled>Unlocked</button>`;
            } else if (price) {
                actionButton = `<button class="skill-btn purchase" data-skill-name="${escapeHtml(name)}">Purchase</button>`;
            } else {
                actionButton = `<button class="skill-btn" disabled>Free</button>`;
            }

            const priceDisplay = price ? `<span class="price-paid">${(price.amount / 1e6).toFixed(2)} USDC</span>` : ``;

            return `<div class="skill-row">
                        <span class="skill-name">${escapeHtml(name)} ${priceDisplay}</span>
                        ${actionButton}
                    </div>`;
        }).join('')
        : '<div>This Agent has no skills defined.</div>';
}

async function loadDetail(id) {
	els.discovery.hidden = true;
	els.detail.hidden = false;
	els.detail.scrollIntoView({ behavior: 'instant', block: 'start' });

	// Optimistically render from cached list item if available, then refresh from API.
	const cached = state.items.find((item) => item.id === id);
	if (cached) {
		detailState = { agent: cached, bookmarked: false };
		renderDetail(cached, false);
	} else {
		renderDetailError('Loading…');
	}

	try {
		const r = await fetch(`${API}/marketplace/agents/${id}`, { credentials: 'include' });
		if (!r.ok) {
			if (!cached) renderDetailError('Agent not found');
			return;
		}
		const j = await r.json();
		const agent = j?.data?.agent;
		if (!agent) {
			if (!cached) renderDetailError('Agent not found');
			return;
		}
		detailState = { agent, bookmarked: !!agent.bookmarked };
		renderDetail(agent, !!agent.bookmarked);

		try {
			const res = await fetch(`/api/users/me/agent-skills/${id}`, { credentials: 'include' });
			if (res.ok) {
				const { skills: agentSkills } = await res.json();
				unlockedSkills = new Set(agentSkills || []);
			} else {
				unlockedSkills = new Set();
			}
		} catch {
			unlockedSkills = new Set();
		}
		renderSkillList(agent);

		// Versions + similar (best-effort).
		Promise.all([
			fetch(`${API}/marketplace/agents/${id}/versions`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
			fetch(`${API}/marketplace/agents/${id}/similar`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
		]).then(([versionsRes, similarRes]) => {
			const versions = versionsRes?.data?.items || versionsRes?.data?.versions || [];
			renderVersions(versions);
			const similar = similarRes?.data?.items || similarRes?.data?.similar || [];
			renderSimilar(similar);
		});
	} catch (err) {
		console.error('[marketplace] detail load', err);
		if (!cached) renderDetailError('Failed to load agent.');
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
	const author = a.author_name || a.author || 'Anonymous';
	const published = a.published_at || a.published || a.created_at;
	const views = a.views_count ?? a.views ?? 0;
	const forks = a.forks_count ?? a.forks ?? 0;
	$('d-name').textContent = a.name || 'Untitled';
	const avEl = $('d-avatar');
	if (a.thumbnail_url) {
		avEl.style.backgroundImage = `url('${a.thumbnail_url}')`;
		avEl.style.backgroundSize = 'cover';
		avEl.style.backgroundPosition = 'center';
		avEl.textContent = '';
	} else {
		avEl.style.backgroundImage = '';
		avEl.textContent = initial(a.name);
	}
	$('d-author').textContent = author;
	$('d-published').textContent = published ? formatDate(published) : '';
	$('d-category').textContent = CATEGORY_LABELS[a.category] || a.category || 'General';
	$('d-views').textContent = `⊙ ${fmtNumber(views)}`;
	$('d-overview').textContent = a.description || '';
	$('d-overview-side').textContent = a.description || '';
	$('d-greeting').textContent = a.greeting || `Hello! I am ${a.name}. How can I help you today?`;
	$('d-profile').textContent = a.system_prompt || a.prompt || '(No profile yet.)';
	$('d-bookmark').classList.toggle('on', bookmarked);
	$('d-bookmark').textContent = bookmarked ? '★' : '☆';

	const forksEl = $('d-forks-pill');
	if (forks > 0) {
		forksEl.textContent = `⑂ ${fmtNumber(forks)} forks`;
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

	const skillPrices = a.skill_prices || {};

	$('d-skills').innerHTML = skillsArr.length
		? skillsArr.map((s) => {
				const name = typeof s === 'string' ? s : (s.name || '');
				const price = skillPrices[name];
				const purchaseKey = `${a.id}:${name}`;
				
				let badge;
				if (purchasedSkills.has(purchaseKey)) {
					badge = `<span class="price-badge price-owned">✓ Owned</span>`;
				} else if (price) {
					const priceInUSDC = (price.amount / 1e6).toFixed(2);
					badge = `<span class="price-badge price-paid">${priceInUSDC} USDC</span>` +
									`<button class="purchase-btn" data-skill-name="${escapeHtml(name)}" data-agent-id="${a.id}">Purchase</button>`;
				} else {
					badge = `<span class="price-badge price-free">Free</span>`;
				}
				
				return `<div class="skill-row">
										<span class="skill-name">${escapeHtml(name)}</span>
										${badge}
								</div>`;
		}).join('')
		: '<div>This Agent has no skills defined.</div>';

	$('d-library').innerHTML = libraryArr.length
		? libraryArr
				.map((l) => `<span class="stat-pill">${escapeHtml(typeof l === 'string' ? l : l.name || '')}</span>`)
				.join(' ')
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
	grid.querySelectorAll('[data-id]').forEach((card) => {
		card.addEventListener('click', () => navTo(`/marketplace/agents/${card.dataset.id}`));
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
	side.querySelectorAll('[data-id]').forEach((card) => {
		card.addEventListener('click', () => navTo(`/marketplace/agents/${card.dataset.id}`));
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
		if (newId) location.href = `/agent-detail.html?id=${newId}`;
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
	bindSubmit();
	bindFilterChips();
	initWipBanner();
	// Pause the hero rotation when the page is hidden, resume when it returns —
	// avoids burning GPU on a tab the user isn't even looking at.
	document.addEventListener('visibilitychange', () => {
		if (document.hidden) stopHeroAutoplay();
		else if (state.featured.length) startHeroAutoplay();
	});

	document.body.addEventListener('click', async (e) => {
		if (e.target.matches('.purchase-btn')) {
			const skillName = e.target.dataset.skillName;
			const agentId = e.target.dataset.agentId;
			if (agentId && skillName) await openPurchaseFlow(agentId, skillName);
		}
	});

	$('payment-modal-close')?.addEventListener('click', closePaymentModal);
	$('payment-confirm-btn')?.addEventListener('click', handlePurchase);
	$('payment-modal-overlay')?.addEventListener('click', (e) => {
		if (e.target.id === 'payment-modal-overlay') closePaymentModal();
	});

	// Avatar detail modal
	$('avatar-modal-close')?.addEventListener('click', closeAvatarModal);
	$('avatar-modal-overlay')?.addEventListener('click', (e) => {
		if (e.target.id === 'avatar-modal-overlay') closeAvatarModal();
	});
	$('avatar-modal-use')?.addEventListener('click', startAgentFromAvatar);
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape' && !$('avatar-modal-overlay')?.hidden) closeAvatarModal();
	});

	// Hero CTA — open most recent featured avatar in 3D modal
	$('market-hero-view')?.addEventListener('click', () => {
		const a = state.featured[state.heroIndex];
		if (a) openAvatarModal(a);
	});
	$('market-hero-fork')?.addEventListener('click', () => {
		const a = state.featured[state.heroIndex];
		if (a) {
			activeAvatar = a;
			startAgentFromAvatar();
		}
	});

	// Skills tab controls
	let skillsSearchTimer;
	$('skills-search')?.addEventListener('input', (e) => {
		clearTimeout(skillsSearchTimer);
		skillsSearchTimer = setTimeout(() => {
			skillsState.q = e.target.value.trim();
			renderSkillsGrid();
		}, 150);
	});
	document.querySelectorAll('[data-skill-filter]').forEach((chip) => {
		chip.addEventListener('click', () => {
			document.querySelectorAll('[data-skill-filter]').forEach((c) => c.classList.remove('active'));
			chip.classList.add('active');
			skillsState.filter = chip.dataset.skillFilter;
			renderSkillsGrid();
		});
	});

	// New Agent CTA on Mine tab
	$('market-new-agent-btn')?.addEventListener('click', () => {
		location.href = '/agent-edit.html';
	});

	// Sidebar nav: intercept marketplace links so we route via SPA
	document.querySelectorAll('.market-nav a[data-nav]').forEach((a) => {
		a.addEventListener('click', (e) => {
			const href = a.getAttribute('href') || '';
			if (href.startsWith('/marketplace')) {
				e.preventDefault();
				navTo(href);
			}
		});
	});
}

// ── Submit Modal ──────────────────────────────────────────────────────────

function openSubmitModal() {
	$('market-submit-overlay').hidden = false;
	$('sf-name').focus();
}

function closeSubmitModal() {
	$('market-submit-overlay').hidden = true;
}

function bindSubmit() {
	document.querySelectorAll('.market-submit-btn').forEach(b => b.addEventListener('click', openSubmitModal));
	$('market-submit-close').addEventListener('click', closeSubmitModal);
	$('market-submit-overlay').addEventListener('click', (e) => {
		if (e.target === $('market-submit-overlay')) closeSubmitModal();
	});

	const form = $('market-submit-form');
	const errorEl = $('market-submit-error');
	form.addEventListener('submit', (e) => e.preventDefault());

	$('sf-publish').addEventListener('click', async () => {
		const body = {
			name: $('sf-name').value,
			description: $('sf-description').value,
			system_prompt: $('sf-prompt').value,
			greeting: $('sf-greeting').value,
			category: $('sf-category').value,
			tags: $('sf-tags').value.split(',').map(t => t.trim()).filter(Boolean),
			publish: true,
		};

		try {
			errorEl.hidden = true;
			const r = await fetch(`${API}/marketplace/agents`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify(body),
			});
			const j = await r.json();
			if (!r.ok) throw new Error(j.error_description || 'Submission failed');

			closeSubmitModal();
			loadList(true); // Refresh the list
		} catch (err) {
			errorEl.textContent = err.message;
			errorEl.hidden = false;
		}
	});
}

// ── Util ──────────────────────────────────────────────────────────────────

function escapeHtml(s) {
	return String(s || '').replace(
		/[&<>"']/g,
		(ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
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

function liveTime(iso) {
	if (!iso) return '';
	const d = new Date(iso);
	if (isNaN(d)) return '';
	const sec = (Date.now() - d.getTime()) / 1000;
	if (sec < 60) return 'just now';
	if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
	if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
	if (sec < 604800) return `${Math.floor(sec / 86400)}d ago`;
	if (sec < 2592000) return `${Math.floor(sec / 604800)}w ago`;
	return formatDate(iso);
}

function fmtNumber(n) {
	const num = Number(n);
	if (!Number.isFinite(num)) return String(n ?? '');
	if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(num >= 10_000_000 ? 0 : 1)}M`;
	if (num >= 1_000) return `${(num / 1_000).toFixed(num >= 10_000 ? 0 : 1)}k`;
	return String(num);
}

// ── Purchase Flow ─────────────────────────────────────────────────────────
//
// One-shot Solana Pay purchase: server mints a unique reference Pubkey, the
// buyer's connected Phantom wallet sends USDC + the reference in a single tx,
// the server verifies on-chain via findReference / validateTransfer, and the
// (user, agent, skill) tuple lands in skill_purchases as 'confirmed'.

let solanaConnection;
let wallet;
let solanaWeb3Mod; // lazy-loaded ESM
let splTokenMod;

let activePurchase = null; // { reference, recipient, amount, currency_mint, chain, agent_id, skill }

async function loadSolanaModules() {
	if (!solanaWeb3Mod) solanaWeb3Mod = await import('https://esm.sh/@solana/web3.js@1.95.4');
	if (!splTokenMod) splTokenMod = await import('https://esm.sh/@solana/spl-token@0.4.8');
	return { web3: solanaWeb3Mod, spl: splTokenMod };
}

function initWalletAdapter() {
	try {
		const { Connection, clusterApiUrl } = solanaWeb3;
		const { PhantomWalletAdapter } = solanaWalletAdapterWallets;
		solanaConnection = new Connection(clusterApiUrl('mainnet-beta'), 'confirmed');
		wallet = new PhantomWalletAdapter();
	} catch (err) {
		console.warn('[marketplace] Wallet adapter unavailable:', err.message);
		return;
	}
	wallet.on('connect', updateWalletUI);
	wallet.on('disconnect', updateWalletUI);
}

function updateWalletUI() {
	const walletArea = $('payment-wallet-area');
	const confirmBtn = $('payment-confirm-btn');
	if (!walletArea) return;

	if (!wallet) {
		walletArea.innerHTML = '<p>Wallet adapter not available.</p>';
		if (confirmBtn) confirmBtn.disabled = true;
		return;
	}

	if (wallet.connected) {
		const pubKey = wallet.publicKey.toBase58();
		walletArea.innerHTML = `
			<p>Connected: <strong>${pubKey.slice(0, 4)}…${pubKey.slice(-4)}</strong></p>
			<button class="btn-secondary" id="payment-disconnect-btn">Disconnect</button>
		`;
		$('payment-disconnect-btn').addEventListener('click', () => wallet.disconnect());
		if (confirmBtn) confirmBtn.disabled = false;
	} else {
		walletArea.innerHTML = `
			<button class="btn-primary" id="payment-connect-wallet-btn">Connect Phantom Wallet</button>
		`;
		$('payment-connect-wallet-btn').addEventListener('click', async () => {
			const btn = $('payment-connect-wallet-btn');
			btn.textContent = 'Connecting…';
			btn.disabled = true;
			try {
				await wallet.connect();
			} catch (e) {
				console.error('[marketplace] wallet connect failed', e);
				btn.textContent = 'Connect Phantom Wallet';
				btn.disabled = false;
			}
		});
		if (confirmBtn) confirmBtn.disabled = true;
	}
}

function setStatus(text, kind) {
	const el = $('payment-status');
	if (!el) return;
	el.textContent = text;
	el.className = 'payment-status' + (kind ? ' ' + kind : '');
}

function closePaymentModal() {
	$('payment-modal-overlay').hidden = true;
	activePurchase = null;
}

async function openPurchaseFlow(agentId, skill) {
	if (!detailState?.agent || detailState.agent.id !== agentId) {
		alert('Agent not loaded; refresh and try again.');
		return;
	}
	const price = detailState.agent.skill_prices?.[skill];
	if (!price) {
		alert('No price set for this skill.');
		return;
	}

	$('payment-skill-name').textContent = skill;
	$('payment-agent-name').textContent = detailState.agent.name;
	$('payment-price-display').textContent = `${(Number(price.amount) / 1e6).toFixed(2)} USDC`;
	setStatus('');
	$('payment-modal-overlay').hidden = false;
	updateWalletUI();
}

async function handlePurchase() {
	const confirmBtn = $('payment-confirm-btn');
	if (!wallet?.connected || !wallet.publicKey) {
		setStatus('Connect a wallet first.', 'err');
		return;
	}
	if (!detailState?.agent) return;

	confirmBtn.disabled = true;
	setStatus('Creating purchase…');

	const agentId = detailState.agent.id;
	const skill = $('payment-skill-name').textContent;

	let purchase;
	try {
		const r = await fetch('/api/marketplace/purchase', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({ agent_id: agentId, skill }),
		});
		const j = await r.json();
		if (!r.ok) throw new Error(j.error_description || j.error || 'Failed to create purchase');
		purchase = j.data;

		if (purchase.already_owned) {
			setStatus('Already purchased. Refreshing…', 'ok');
			await fetchUserPurchases();
			loadDetail(agentId);
			setTimeout(closePaymentModal, 1200);
			return;
		}
	} catch (e) {
		console.error('[marketplace] purchase create failed', e);
		setStatus(e.message, 'err');
		confirmBtn.disabled = false;
		return;
	}

	activePurchase = { ...purchase, agent_id: agentId, skill };

	try {
		setStatus('Building transfer…');
		const tx = await buildSplTransferWithReference({
			payer: wallet.publicKey,
			recipient: purchase.recipient,
			mint: purchase.currency_mint,
			amount: BigInt(purchase.amount),
			reference: purchase.reference,
		});

		setStatus('Approve in wallet…');
		const txid = await wallet.sendTransaction(tx, solanaConnection);

		setStatus('Waiting for on-chain confirmation…');
		await solanaConnection.confirmTransaction(txid, 'confirmed');

		setStatus('Verifying with server…');
		const ok = await pollConfirm(purchase.reference);
		if (!ok) throw new Error('Server failed to verify the transaction.');

		setStatus('✓ Skill unlocked.', 'ok');
		await fetchUserPurchases();
		loadDetail(agentId);
		setTimeout(closePaymentModal, 1500);
	} catch (e) {
		console.error('[marketplace] purchase failed', e);
		setStatus(e.message || 'Purchase failed', 'err');
		confirmBtn.disabled = false;
	}
}

async function buildSplTransferWithReference({ payer, recipient, mint, amount, reference }) {
	const { web3, spl } = await loadSolanaModules();
	const { PublicKey, Transaction } = web3;
	const { getAssociatedTokenAddress, createTransferInstruction } = spl;

	const recipientKey = new PublicKey(recipient);
	const mintKey = new PublicKey(mint);
	const referenceKey = new PublicKey(reference);

	const fromAta = await getAssociatedTokenAddress(mintKey, payer);
	const toAta = await getAssociatedTokenAddress(mintKey, recipientKey);

	const ix = createTransferInstruction(fromAta, toAta, payer, amount);
	// Solana Pay: append the reference as a readonly, non-signer key so the
	// server can later locate this tx via getSignaturesForAddress(reference).
	ix.keys.push({ pubkey: referenceKey, isSigner: false, isWritable: false });

	const { blockhash } = await solanaConnection.getLatestBlockhash('confirmed');
	const tx = new Transaction({ feePayer: payer, recentBlockhash: blockhash }).add(ix);
	return tx;
}

// Poll confirm endpoint until status='confirmed' or timeout (~60s).
async function pollConfirm(reference) {
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		const r = await fetch(`/api/marketplace/purchase/${reference}/confirm`, {
			method: 'POST',
			credentials: 'include',
		});
		const j = await r.json().catch(() => ({}));
		if (r.ok && j.data?.status === 'confirmed') return true;
		if (r.status === 409) throw new Error(j.error_description || 'Transaction did not match expected payment');
		await new Promise((res) => setTimeout(res, 2500));
	}
	return false;
}

function render() {
	const r = readRoute();

	document.querySelectorAll('.market-nav a[data-nav]').forEach((a) => {
		const nav = a.dataset.nav;
		const active =
			(nav === 'agent' && r.view === 'list' && r.filter !== 'avatars') ||
			(nav === 'agent' && r.view === 'detail') ||
			(nav === 'avatars' && r.view === 'list' && r.filter === 'avatars') ||
			(nav === 'tools' && r.view === 'tools') ||
			(nav === 'skills' && r.view === 'skills') ||
			(nav === 'mine' && r.view === 'mine');
		a.classList.toggle('active', active);
	});

	// Apply route-driven filter (e.g. ?tab=avatars selects the avatars chip).
	if (r.view === 'list' && r.filter && r.filter !== state.filter) {
		state.filter = r.filter;
		document.querySelectorAll('#market-filter-chips .market-chip').forEach((c) => {
			c.classList.toggle('active', c.dataset.filter === r.filter);
		});
		// Re-render so the grid reflects the new filter without a refetch.
		if (state.publicAvatarsLoaded) renderGrid();
	}

	const skillsSec = $('market-skills-section');
	const mineSec = $('market-mine');
	const discovery = els.discovery;
	const tools = els.tools;
	const detail = els.detail;

	const setHidden = (el, hidden) => { if (el) el.hidden = hidden; };

	if (r.view === 'detail') {
		loadDetail(r.id);
		setHidden(discovery, true);
		setHidden(tools, true);
		setHidden(skillsSec, true);
		setHidden(mineSec, true);
		setHidden(detail, false);
	} else if (r.view === 'tools') {
		setHidden(detail, true);
		setHidden(discovery, true);
		setHidden(skillsSec, true);
		setHidden(mineSec, true);
		setHidden(tools, false);
		if (!pluginState.loaded) loadPlugins(true);
	} else if (r.view === 'skills') {
		setHidden(detail, true);
		setHidden(discovery, true);
		setHidden(tools, true);
		setHidden(mineSec, true);
		setHidden(skillsSec, false);
		loadSkillsTab();
	} else if (r.view === 'mine') {
		setHidden(detail, true);
		setHidden(discovery, true);
		setHidden(tools, true);
		setHidden(skillsSec, true);
		setHidden(mineSec, false);
		loadMine();
	} else {
		setHidden(detail, true);
		setHidden(tools, true);
		setHidden(skillsSec, true);
		setHidden(mineSec, true);
		setHidden(discovery, false);
	}
}

function init() {
	bindEvents();
	loadCategories();
	loadList(true);
	initPlugins();
	initWalletAdapter();
	fetchUserPurchases();
	render();
}

// ── Plugin Marketplace ────────────────────────────────────────────────────────

const PLUGIN_API = '/api/plugins';
const PLUGIN_STORAGE_KEY = 'installed_plugins_v1';

const pluginState = {
	category: null,
	q: '',
	cursor: null,
	items: [],
	loading: false,
	loaded: false,
};

function getInstalledIds() {
	try {
		const raw = localStorage.getItem(PLUGIN_STORAGE_KEY);
		if (!raw) return new Set();
		return new Set(JSON.parse(raw).map((p) => p.identifier));
	} catch {
		return new Set();
	}
}

function saveInstalled(manifest) {
	try {
		const raw = localStorage.getItem(PLUGIN_STORAGE_KEY);
		const arr = raw ? JSON.parse(raw) : [];
		const idx = arr.findIndex((p) => p.identifier === manifest.identifier);
		if (idx >= 0) arr[idx] = manifest;
		else arr.push(manifest);
		localStorage.setItem(PLUGIN_STORAGE_KEY, JSON.stringify(arr));
	} catch {
		// storage full
	}
}

function removeInstalled(identifier) {
	try {
		const raw = localStorage.getItem(PLUGIN_STORAGE_KEY);
		if (!raw) return;
		const arr = JSON.parse(raw).filter((p) => p.identifier !== identifier);
		localStorage.setItem(PLUGIN_STORAGE_KEY, JSON.stringify(arr));
	} catch {}
}

function togglePluginInstall(manifest) {
	const installed = getInstalledIds();
	if (installed.has(manifest.identifier)) {
		removeInstalled(manifest.identifier);
	} else {
		saveInstalled(manifest);
		// fire-and-forget counter update if plugin has a DB id
		if (manifest.id) {
			fetch(`${PLUGIN_API}/${manifest.id}/install`, { method: 'POST' }).catch(() => {});
		}
	}
	renderPluginGrid();
}

async function loadPluginCategories() {
	try {
		const r = await fetch(`${PLUGIN_API}/categories`);
		const j = await r.json();
		renderPluginCats(j?.data?.categories || []);
	} catch {
		// non-fatal
	}
}

function renderPluginCats(cats) {
	const el = $('plugin-cats');
	if (!el) return;
	const all = [{ slug: null, label: 'All', count: null }, ...cats.map((cat) => ({
		slug: cat.slug,
		label: cat.slug.charAt(0).toUpperCase() + cat.slug.slice(1),
		count: cat.count,
	}))];
	el.innerHTML = all.map((cat) => {
		const active = pluginState.category === cat.slug;
		return `<div class="cat-row${active ? ' active' : ''}" data-cat="${cat.slug ?? ''}">
			<span>${escapeHtml(cat.label)}</span>
			${cat.count != null ? `<span class="count">${cat.count}</span>` : ''}
		</div>`;
	}).join('');
	el.querySelectorAll('.cat-row').forEach((row) => {
		row.addEventListener('click', () => {
			pluginState.category = row.dataset.cat || null;
			el.querySelectorAll('.cat-row').forEach((r) => r.classList.remove('active'));
			row.classList.add('active');
			loadPlugins(true);
		});
	});
}

async function loadPlugins(reset = false) {
	if (pluginState.loading) return;
	pluginState.loading = true;
	if (reset) {
		pluginState.items = [];
		pluginState.cursor = null;
		const grid = $('plugin-grid');
		if (grid) grid.innerHTML = '<div class="market-empty">Loading…</div>';
	}
	try {
		const url = new URL(PLUGIN_API + '/list', location.origin);
		if (pluginState.category) url.searchParams.set('category', pluginState.category);
		if (pluginState.q) url.searchParams.set('q', pluginState.q);
		if (pluginState.cursor) url.searchParams.set('cursor', pluginState.cursor);
		const r = await fetch(url);
		const j = await r.json();
		const items = j?.data?.items || [];
		pluginState.items = reset ? items : [...pluginState.items, ...items];
		pluginState.cursor = j?.data?.next_cursor || null;
		pluginState.loaded = true;
		renderPluginGrid();
	} catch {
		const grid = $('plugin-grid');
		if (grid) grid.innerHTML = '<div class="market-empty">Failed to load plugins.</div>';
	} finally {
		pluginState.loading = false;
	}
}

function renderPluginGrid() {
	const grid = $('plugin-grid');
	const more = $('plugin-loadmore');
	if (!grid) return;
	const installed = getInstalledIds();
	if (!pluginState.items.length) {
		grid.innerHTML = '<div class="market-empty">No plugins found.</div>';
		if (more) more.hidden = true;
		return;
	}
	grid.innerHTML = pluginState.items.map((p) => renderPluginCard(p, installed)).join('');
	grid.querySelectorAll('[data-plugin-id]').forEach((btn) => {
		btn.addEventListener('click', () => {
			const id = btn.dataset.pluginId;
			const manifest = pluginState.items.find((p) => p.identifier === id);
			if (manifest) togglePluginInstall(manifest.manifest_json ?? manifest);
		});
	});
	if (more) more.hidden = !pluginState.cursor;
}

function renderPluginCard(p, installed) {
	const manifest = p.manifest_json ?? p;
	const title = escapeHtml(p.name || manifest?.meta?.title || p.identifier || '?');
	const desc = escapeHtml(p.description || manifest?.meta?.description || '');
	const tags = (p.tags || manifest?.meta?.tags || []).slice(0, 3);
	const toolCount = Array.isArray(manifest?.api) ? manifest.api.length : 0;
	const isInstalled = installed.has(p.identifier);
	const cat = escapeHtml(p.category || manifest?.meta?.category || 'general');
	const icon = (p.name || p.identifier || '?')[0].toUpperCase();
	return `<div class="plugin-card">
		<div class="head">
			<div class="avatar">${icon}</div>
			<div style="min-width:0;flex:1">
				<div class="title">${title}</div>
				<div class="author">${toolCount} tool${toolCount !== 1 ? 's' : ''} · ${cat}</div>
			</div>
		</div>
		<div class="desc">${desc}</div>
		<div class="plugin-tags">
			${tags.map((t) => `<span class="tag-pill">${escapeHtml(t)}</span>`).join('')}
		</div>
		<div class="plugin-card-footer">
			<span class="stat-pill">↓ ${p.install_count || 0}</span>
			<button class="plugin-install-btn${isInstalled ? ' installed' : ''}"
				data-plugin-id="${escapeHtml(p.identifier)}">
				${isInstalled ? 'Installed ✓' : 'Add to Agent'}
			</button>
		</div>
	</div>`;
}

// ── Add by URL modal ──────────────────────────────────────────────────────────

function openPluginUrlModal() {
	const modal = $('plugin-url-modal');
	const input = $('plugin-url-input');
	const errEl = $('plugin-url-error');
	const preview = $('plugin-url-preview');
	if (!modal) return;
	input.value = '';
	errEl.hidden = true;
	preview.hidden = true;
	preview.innerHTML = '';
	modal.hidden = false;
	input.focus();
}

function closePluginUrlModal() {
	const modal = $('plugin-url-modal');
	if (modal) modal.hidden = true;
}

async function fetchAndInstallByUrl() {
	const input = $('plugin-url-input');
	const errEl = $('plugin-url-error');
	const preview = $('plugin-url-preview');
	const fetchBtn = $('plugin-url-fetch');
	const url = (input?.value || '').trim();

	errEl.hidden = true;
	preview.hidden = true;

	if (!url) {
		showPluginUrlError('Please enter a URL.');
		return;
	}

	fetchBtn.disabled = true;
	fetchBtn.textContent = 'Fetching…';

	try {
		const r = await fetch(`${PLUGIN_API}/import`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ manifest_url: url }),
		});
		const j = await r.json();
		if (!r.ok) {
			showPluginUrlError(j?.error_description || `Error ${r.status}`);
			return;
		}
		const manifest = j?.data?.manifest;
		if (!manifest) {
			showPluginUrlError('Server returned no manifest.');
			return;
		}

		// Show preview
		const title = escapeHtml(manifest.meta?.title || manifest.identifier || '?');
		const desc = escapeHtml(manifest.meta?.description || '');
		const toolCount = Array.isArray(manifest.api) ? manifest.api.length : 0;
		preview.innerHTML = `<div class="plugin-preview-head">
			<strong>${title}</strong>
			<span class="muted">${toolCount} tool${toolCount !== 1 ? 's' : ''}</span>
		</div>
		${desc ? `<div class="plugin-preview-desc">${desc}</div>` : ''}
		<button class="plugin-modal-btn plugin-modal-btn-primary" id="plugin-url-install">Install Plugin</button>`;
		preview.hidden = false;

		$('plugin-url-install').addEventListener('click', () => {
			saveInstalled(manifest);
			closePluginUrlModal();
			// Refresh grid to show updated install state
			renderPluginGrid();
		});
	} catch (err) {
		showPluginUrlError(err.message || 'Failed to fetch manifest.');
	} finally {
		fetchBtn.disabled = false;
		fetchBtn.textContent = 'Fetch & Validate';
	}
}

function showPluginUrlError(msg) {
	const el = $('plugin-url-error');
	if (!el) return;
	el.textContent = msg;
	el.hidden = false;
}

// ── Plugin init / wiring ──────────────────────────────────────────────────────

function initPlugins() {
	// Add by URL button
	const addBtn = $('plugin-add-url');
	if (addBtn) addBtn.addEventListener('click', openPluginUrlModal);

	// Modal controls
	const cancelBtn = $('plugin-url-cancel');
	if (cancelBtn) cancelBtn.addEventListener('click', closePluginUrlModal);

	const fetchBtn = $('plugin-url-fetch');
	if (fetchBtn) fetchBtn.addEventListener('click', fetchAndInstallByUrl);

	// Close on overlay click
	const overlay = $('plugin-url-modal');
	if (overlay) {
		overlay.addEventListener('click', (e) => {
			if (e.target === overlay) closePluginUrlModal();
		});
	}

	// Plugin search
	let pluginSearchTimer;
	const searchInput = $('plugin-search');
	if (searchInput) {
		searchInput.addEventListener('input', (e) => {
			clearTimeout(pluginSearchTimer);
			pluginSearchTimer = setTimeout(() => {
				pluginState.q = e.target.value.trim();
				loadPlugins(true);
			}, 200);
		});
	}

	// Load more
	const loadMoreBtn = $('plugin-loadmore');
	if (loadMoreBtn) loadMoreBtn.addEventListener('click', () => loadPlugins(false));

	// Load categories (lazy — don't block initial page render)
	loadPluginCategories();
}

init();
