
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
	cursor: null,
	items: [],
	loading: false,
	publicAvatars: [],
	publicAvatarsLoaded: false,
};

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
		const items = j || [];
		state.items = reset ? items : [...state.items, ...items];
		renderGrid();
	} catch (err) {
		console.error('[marketplace] list', err);
		els.grid.innerHTML = '<div class="market-empty">Failed to load agents.</div>';
	} finally {
		state.loading = false;
	}

	if (reset) loadPublicAvatars();
}

async function loadPublicAvatars() {
	try {
		const url = new URL(`${API}/explore`, location.origin);
		url.searchParams.set('source', 'avatar');
		url.searchParams.set('limit', '60');
		if (state.q) url.searchParams.set('q', state.q);
		const r = await fetch(url);
		if (!r.ok) return;
		const j = await r.json();
		const avatars = (j?.items || []).filter((it) => it.kind === 'avatar' && it.glbUrl);
		state.publicAvatars = avatars;
		state.publicAvatarsLoaded = true;
		renderGrid();
	} catch (err) {
		console.error('[marketplace] public avatars', err);
	}
}

function renderGrid() {
	const showAvatars = !state.category;
	const avatars = showAvatars ? state.publicAvatars : [];

	if (!state.items.length && !avatars.length) {
		const msg = state.publicAvatarsLoaded
			? 'No agents yet. Be the first to publish!'
			: 'Loading…';
		els.grid.innerHTML = `<div class="market-empty">${msg}</div>`;
		els.loadMore.hidden = true;
		return;
	}

	let html = '';
	if (state.items.length) {
		html += state.items.map(renderCard).join('');
	}
	if (avatars.length) {
		html += `<div class="market-grid-section-title">Community Avatars <span class="count">${avatars.length} public</span></div>`;
		html += avatars.map(renderAvatarCard).join('');
	}
	els.grid.innerHTML = html;

	els.grid.querySelectorAll('[data-id]').forEach((card) => {
		card.addEventListener('click', () => navTo(`/marketplace/agents/${card.dataset.id}`));
	});
	els.grid.querySelectorAll('[data-avatar-glb]').forEach((card) => {
		card.addEventListener('click', () => {
			const glb = card.dataset.avatarGlb;
			if (glb) location.href = `/#model=${encodeURIComponent(glb)}`;
		});
	});
	els.loadMore.hidden = !state.cursor;
}

function renderAvatarCard(a) {
	const name = escapeHtml(a.name || 'Untitled Avatar');
	const desc = escapeHtml(a.description || '');
	const date = a.createdAt ? formatDate(a.createdAt) : '';
	const thumbStyle = a.image
		? `style="background-image:url('${escapeHtml(a.image)}')"`
		: '';
	const fallback = a.image ? '' : '◉';
	return `<div class="market-card-avatar" data-avatar-glb="${escapeHtml(a.glbUrl || '')}">
		<div class="thumb" ${thumbStyle}>${fallback}</div>
		<div class="body">
			<div class="title">${name}</div>
			<div class="desc">${desc}</div>
			<div class="footer">
				<span>${date}</span>
				<span class="avatar-pill">3D Avatar</span>
			</div>
		</div>
	</div>`;
}

function renderCard(a) {
	const date = a.published ? formatDate(a.published) : '';
	const skills = (a.skills || []).length;
	return `<div class="market-card-agent" data-id="${a.id}">
		<div class="head">
			<div class="avatar">${a.avatar}</div>
			<div style="min-width:0;flex:1">
				<div class="title">${escapeHtml(a.name || 'Untitled')}</div>
				<div class="author">${escapeHtml(a.author || 'Anonymous')}</div>
			</div>
		</div>
		<div class="desc">${escapeHtml(a.description || '')}</div>
		<div class="stats">
			<span class="stat-pill">⊙ ${a.views || 0}</span>
			<span class="stat-pill">⑂ ${a.forks || 0}</span>
			${skills ? `<span class="stat-pill">▤ ${skills}</span>` : ''}
			${Object.keys(a.skill_prices || {}).length > 0 ? `<span class="stat-pill paid-badge">$ Paid</span>` : ''}
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

	const agent = state.items.find(item => item.id === id);
	if (agent) {
		detailState = { agent: agent, bookmarked: false };
		renderDetail(agent, false);

		try {
			const res = await fetch(`/api/users/me/agent-skills/${id}`);
			const { skills: agentSkills } = await res.json();
			unlockedSkills = new Set(agentSkills || []);
		} catch {
			unlockedSkills = new Set();
		}
		renderSkillList(agent);

	} else {
		renderDetailError('Agent not found');
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
	$('d-avatar').textContent = a.avatar;
	$('d-author').textContent = a.author || 'Anonymous';
	$('d-published').textContent = a.published ? formatDate(a.published) : '';
	$('d-category').textContent = CATEGORY_LABELS[a.category] || a.category || 'General';
	$('d-views').textContent = `⊙ ${a.views || 0}`;
	$('d-overview').textContent = a.description || '';
	$('d-overview-side').textContent = a.description || '';
	$('d-greeting').textContent = a.greeting || `Hello! I am ${a.name}. How can I help you today?`;
	$('d-profile').textContent = a.prompt || '(No profile yet.)';
	$('d-bookmark').classList.toggle('on', bookmarked);
	$('d-bookmark').textContent = bookmarked ? '★' : '☆';

	const forksEl = $('d-forks-pill');
	if (a.forks > 0) {
		forksEl.textContent = `⑂ ${a.forks} forks`;
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
			(nav === 'agent' && (r.view === 'list' || r.view === 'detail')) ||
			(nav === 'tools' && r.view === 'tools');
		a.classList.toggle('active', active);
	});

	if (r.view === 'detail') {
		loadDetail(r.id);
		els.discovery.hidden = true;
		els.tools.hidden = true;
	} else if (r.view === 'tools') {
		els.detail.hidden = true;
		els.discovery.hidden = true;
		els.tools.hidden = false;
		if (!pluginState.loaded) loadPlugins(true);
	} else {
		els.detail.hidden = true;
		els.discovery.hidden = false;
		els.tools.hidden = true;
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
