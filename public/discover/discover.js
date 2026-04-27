/**
 * /discover — ERC-8004 agent marketplace grid.
 *
 * Pulls from GET /api/explore (legacy endpoint name, indexes ERC-8004 directory).
 * Filters + infinite pagination via cursor.
 * Clicking a card opens the on-chain token page on the source chain's
 * explorer; clicking the 3D preview (when present) loads the GLB in the
 * main viewer via /#model=<url>.
 */

const CHAINS = [
	{ id: 8453, name: 'Base' },
	{ id: 42161, name: 'Arbitrum One' },
	{ id: 56, name: 'BNB Chain' },
	{ id: 1, name: 'Ethereum' },
	{ id: 10, name: 'Optimism' },
	{ id: 137, name: 'Polygon' },
	{ id: 43114, name: 'Avalanche' },
	{ id: 100, name: 'Gnosis' },
	{ id: 250, name: 'Fantom' },
	{ id: 42220, name: 'Celo' },
	{ id: 59144, name: 'Linea' },
	{ id: 534352, name: 'Scroll' },
	{ id: 5000, name: 'Mantle' },
	{ id: 324, name: 'zkSync Era' },
	{ id: 1284, name: 'Moonbeam' },
	{ id: 97, name: 'BSC Testnet' },
	{ id: 84532, name: 'Base Sepolia' },
	{ id: 421614, name: 'Arbitrum Sepolia' },
	{ id: 11155111, name: 'Ethereum Sepolia' },
	{ id: 11155420, name: 'Optimism Sepolia' },
	{ id: 80002, name: 'Polygon Amoy' },
	{ id: 43113, name: 'Avalanche Fuji' },
];

const els = {
	search: document.querySelector('[data-role="search"]'),
	filters: document.querySelector('[data-role="filters"]'),
	chain: document.querySelector('[data-role="chain"]'),
	grid: document.querySelector('[data-role="grid"]'),
	status: document.querySelector('[data-role="status"]'),
	loadMore: document.querySelector('[data-role="load-more"]'),
	statAll: document.querySelector('[data-role="stat-all"]'),
	stat3d: document.querySelector('[data-role="stat-3d"]'),
	myAgentsChip: document.querySelector('[data-role="my-agents-chip"]'),
};

// Reveal "View my agents" chip when signed in. Same probe as index.html.
fetch('/api/auth/me', { credentials: 'include' })
	.then((r) => {
		if (r.ok && els.myAgentsChip) els.myAgentsChip.hidden = false;
	})
	.catch(() => {});

// Populate chain dropdown.
for (const c of CHAINS) {
	const opt = document.createElement('option');
	opt.value = String(c.id);
	opt.textContent = c.name;
	els.chain.appendChild(opt);
}

// Hydrate initial state from URL so deep links from register-ui (?q=…) and
// browser back/forward restore the user's filters.
const initialParams = new URLSearchParams(location.search);
const initialFilter = initialParams.get('only3d') === '1' ? '3d' : 'all';
const initialChain = initialParams.get('chain') || '';
const initialQuery = initialParams.get('q') || '';

const state = {
	filter: initialFilter, // 'all' | '3d'
	chainId: initialChain,
	query: initialQuery,
	cursor: null,
	loading: false,
};

// Reflect hydrated state in the controls.
if (initialQuery) els.search.value = initialQuery;
if (initialChain) {
	// Chain dropdown is populated above; pre-select if the option exists.
	const opt = els.chain.querySelector(`option[value="${CSS.escape(initialChain)}"]`);
	if (opt) els.chain.value = initialChain;
	else state.chainId = ''; // unknown chain id — fall back to All
}
if (initialFilter !== 'all') {
	for (const b of els.filters.querySelectorAll('[data-filter]')) {
		b.classList.toggle('active', b.dataset.filter === initialFilter);
	}
}

/** Sync state into URL via replaceState (no history spam). */
function syncUrl() {
	const p = new URLSearchParams();
	if (state.filter === '3d') p.set('only3d', '1');
	if (state.chainId) p.set('chain', state.chainId);
	if (state.query) p.set('q', state.query);
	const qs = p.toString();
	const next = qs ? `${location.pathname}?${qs}` : location.pathname;
	if (next !== location.pathname + location.search) {
		history.replaceState(null, '', next);
	}
}

let searchDebounce;

els.filters.addEventListener('click', (e) => {
	const btn = e.target.closest('[data-filter]');
	if (!btn) return;
	state.filter = btn.dataset.filter;
	for (const b of els.filters.querySelectorAll('[data-filter]')) {
		b.classList.toggle('active', b.dataset.filter === state.filter);
	}
	syncUrl();
	resetAndLoad();
});

els.chain.addEventListener('change', () => {
	state.chainId = els.chain.value;
	syncUrl();
	resetAndLoad();
});

els.search.addEventListener('input', () => {
	clearTimeout(searchDebounce);
	searchDebounce = setTimeout(() => {
		state.query = els.search.value.trim();
		syncUrl();
		resetAndLoad();
	}, 250);
});

els.loadMore.addEventListener('click', () => loadPage());

// Delegated embed-button click — cards can be re-rendered freely
els.grid.addEventListener('click', (e) => {
	const btn = e.target.closest('[data-role="card-embed"]');
	if (!btn) return;
	e.preventDefault();
	e.stopPropagation();
	openEmbedModal({
		chainId: Number(btn.dataset.chainId),
		agentId: btn.dataset.agentId,
		name: btn.dataset.name,
	});
});

function resetAndLoad() {
	state.cursor = null;
	els.grid.innerHTML = '';
	loadPage();
}

async function loadPage() {
	if (state.loading) return;
	state.loading = true;
	els.loadMore.hidden = true;
	els.status.textContent = state.cursor ? 'Loading more…' : 'Loading agents…';

	const params = new URLSearchParams();
	if (state.filter === '3d') params.set('only3d', '1');
	if (state.chainId) params.set('chain', state.chainId);
	if (state.query) params.set('q', state.query);
	if (state.cursor) params.set('cursor', state.cursor);
	params.set('limit', '24');

	const isFirstPage = !state.cursor;
	try {
		const res = await fetch(`/api/explore?${params.toString()}`);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = await res.json();

		// Totals reflect the unfiltered corpus and don't change between pages —
		// only paint them once per filter cycle.
		if (isFirstPage && data.totals) {
			els.statAll.textContent = data.totals.all.toLocaleString();
			els.stat3d.textContent = data.totals.threeD.toLocaleString();
		}

		for (const item of data.items) {
			els.grid.appendChild(renderCard(item));
		}
		state.cursor = data.nextCursor;
		els.loadMore.hidden = !state.cursor;

		if (els.grid.children.length === 0) {
			const filtersActive =
				state.filter !== 'all' || !!state.chainId || !!state.query;
			els.status.innerHTML = filtersActive
				? `<div class="explore-empty">
						No agents match these filters yet.
						<button type="button" class="explore-clear-filters" data-role="clear-filters">Clear filters</button>
					</div>`
				: '<div class="explore-empty">No agents indexed yet.</div>';
		} else {
			els.status.textContent = '';
		}
	} catch (err) {
		els.status.innerHTML = `<div class="explore-error">Failed to load: ${escapeHtml(err.message)}</div>`;
	} finally {
		state.loading = false;
	}
}

// Delegated clear-filters click (status block is re-rendered each load).
els.status.addEventListener('click', (e) => {
	const btn = e.target.closest('[data-role="clear-filters"]');
	if (!btn) return;
	clearAllFilters();
});

function clearAllFilters() {
	state.filter = 'all';
	state.chainId = '';
	state.query = '';
	els.search.value = '';
	els.chain.value = '';
	for (const b of els.filters.querySelectorAll('[data-filter]')) {
		b.classList.toggle('active', b.dataset.filter === 'all');
	}
	syncUrl();
	resetAndLoad();
}

function renderCard(item) {
	const card = document.createElement('article');
	card.className = 'explore-card' + (item.has3d ? ' explore-card--3d' : '');

	const thumb = item.image
		? `<img src="${escapeAttr(item.image)}" alt="" loading="lazy" />`
		: `<div class="explore-card-ph">${item.has3d ? '🎭' : '🤖'}</div>`;

	const badges = [];
	badges.push(
		`<span class="explore-badge explore-badge--chain">${escapeHtml(item.chainName)}</span>`,
	);
	if (item.has3d) badges.push(`<span class="explore-badge explore-badge--3d">3D</span>`);
	if (item.x402Support)
		badges.push(`<span class="explore-badge explore-badge--x402">x402</span>`);

	const serviceChips = (item.services || [])
		.filter((s) => s.name && !['avatar', '3d'].includes(String(s.name).toLowerCase()))
		.slice(0, 3)
		.map((s) => `<span class="explore-svc">${escapeHtml(s.name)}</span>`)
		.join('');

	const primaryHref = item.viewerUrl || item.tokenExplorerUrl || '#';
	const primaryLabel = item.viewerUrl ? 'Load in viewer' : 'View on explorer';
	const primaryTarget = item.viewerUrl ? '_self' : '_blank';

	card.innerHTML = `
		<a class="explore-card-thumb" href="${escapeAttr(primaryHref)}" target="${primaryTarget}" rel="noopener">
			${thumb}
			${item.has3d ? '<span class="explore-card-play">▶</span>' : ''}
		</a>
		<div class="explore-card-body">
			<div class="explore-card-head">
				<h3 class="explore-card-name">${escapeHtml(item.name)}</h3>
				<span class="explore-card-id">#${escapeHtml(item.agentId)}</span>
			</div>
			<div class="explore-card-badges">${badges.join('')}</div>
			${item.description ? `<p class="explore-card-desc">${escapeHtml(item.description)}</p>` : ''}
			${serviceChips ? `<div class="explore-card-svcs">${serviceChips}</div>` : ''}
			<div class="explore-card-foot">
				<a class="explore-card-owner" href="${escapeAttr(item.ownerExplorerUrl || '#')}" target="_blank" rel="noopener" title="${escapeAttr(item.owner)}">
					${escapeHtml(item.ownerShort)}
				</a>
				<div class="explore-card-actions">
					${item.viewerUrl ? `<a class="explore-card-link" href="${escapeAttr(item.viewerUrl)}">View 3D</a>` : ''}
					<a class="explore-card-link" href="${escapeAttr(item.tokenExplorerUrl || '#')}" target="_blank" rel="noopener">On-chain ↗</a>
					<button type="button" class="explore-card-link explore-card-link--ghost" data-role="card-embed"
						data-chain-id="${escapeAttr(String(item.chainId))}"
						data-agent-id="${escapeAttr(String(item.agentId))}"
						data-name="${escapeAttr(item.name || `Agent #${item.agentId}`)}">Embed</button>
				</div>
			</div>
		</div>
	`;
	return card;
}

function escapeHtml(s) {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}
function escapeAttr(s) {
	return escapeHtml(s).replace(/'/g, '&#39;');
}

// ─── Embed modal ──────────────────────────────────────────────────────────
const LIB_CDN_URL = 'https://3dagent.vercel.app/agent-3d/latest/agent-3d.js';

function openEmbedModal({ chainId, agentId, name }) {
	document.querySelector('.embed-modal')?.remove();

	const origin = location.origin;
	const pageUrl = `${origin}/a/${chainId}/${agentId}`;
	const embedUrl = `${origin}/a/${chainId}/${agentId}/embed`;
	const agentUri = `agent://${chainId}/${agentId}`;
	const displayName = name || `Agent #${agentId}`;

	const snippets = {
		webComponent: `<script type="module" src="${LIB_CDN_URL}"></script>\n<agent-3d src="${agentUri}" mode="inline" width="480px" responsive></agent-3d>`,
		iframe: `<iframe src="${embedUrl}" width="480" height="600" style="border:0;border-radius:12px" allow="autoplay; xr-spatial-tracking" sandbox="allow-scripts allow-same-origin allow-popups" title="${displayName}"></iframe>`,
		link: pageUrl,
		markdown: `[![${displayName}](${origin}/api/a-og?chain=${chainId}&id=${agentId})](${pageUrl})`,
		farcaster: pageUrl,
	};

	const modal = document.createElement('div');
	modal.className = 'embed-modal';
	modal.setAttribute('role', 'dialog');
	modal.setAttribute('aria-modal', 'true');
	modal.innerHTML = `
		<div class="embed-modal__backdrop" data-role="close"></div>
		<div class="embed-modal__panel" role="document">
			<header class="embed-modal__head">
				<div>
					<h2 class="embed-modal__title">Embed ${escapeHtml(displayName)}</h2>
					<p class="embed-modal__sub">Drop this anywhere — any site, any doc, any chat.</p>
				</div>
				<button type="button" class="embed-modal__close" data-role="close" aria-label="Close">×</button>
			</header>
			<div class="embed-modal__tabs" role="tablist">
				<button type="button" class="embed-tab is-active" data-tab="webComponent" role="tab" aria-selected="true">Web component</button>
				<button type="button" class="embed-tab" data-tab="iframe" role="tab" aria-selected="false">iframe</button>
				<button type="button" class="embed-tab" data-tab="link" role="tab" aria-selected="false">Link</button>
				<button type="button" class="embed-tab" data-tab="markdown" role="tab" aria-selected="false">Markdown</button>
				<button type="button" class="embed-tab" data-tab="farcaster" role="tab" aria-selected="false">Farcaster</button>
			</div>
			<div class="embed-modal__body">
				<div class="embed-pane is-active" data-pane="webComponent">
					<p class="embed-pane__hint">Full fidelity — avatar, animations, voice, memory. Requires script module.</p>
					<textarea class="embed-snippet" readonly rows="3">${escapeHtml(snippets.webComponent)}</textarea>
					<button type="button" class="embed-copy-btn" data-role="copy" data-key="webComponent">Copy</button>
				</div>
				<div class="embed-pane" data-pane="iframe">
					<p class="embed-pane__hint">Works anywhere that allows iframes: Notion, Substack, Ghost, blogs.</p>
					<textarea class="embed-snippet" readonly rows="3">${escapeHtml(snippets.iframe)}</textarea>
					<button type="button" class="embed-copy-btn" data-role="copy" data-key="iframe">Copy</button>
				</div>
				<div class="embed-pane" data-pane="link">
					<p class="embed-pane__hint">Unfurls in Slack, X, Discord, iMessage with a rich preview card.</p>
					<input class="embed-snippet embed-snippet--input" readonly value="${escapeAttr(snippets.link)}" />
					<button type="button" class="embed-copy-btn" data-role="copy" data-key="link">Copy</button>
				</div>
				<div class="embed-pane" data-pane="markdown">
					<p class="embed-pane__hint">GitHub README, Markdown blog — renders a preview card that links to the viewer.</p>
					<textarea class="embed-snippet" readonly rows="2">${escapeHtml(snippets.markdown)}</textarea>
					<button type="button" class="embed-copy-btn" data-role="copy" data-key="markdown">Copy</button>
				</div>
				<div class="embed-pane" data-pane="farcaster">
					<p class="embed-pane__hint">Cast this link — Warpcast and compatible clients render an interactive Frame with View 3D + Explore buttons.</p>
					<input class="embed-snippet embed-snippet--input" readonly value="${escapeAttr(snippets.farcaster)}" />
					<button type="button" class="embed-copy-btn" data-role="copy" data-key="farcaster">Copy</button>
				</div>
			</div>
			<footer class="embed-modal__foot">
				<a href="${escapeAttr(pageUrl)}" target="_blank" rel="noopener" class="embed-foot-link">Open standalone page ↗</a>
				<a href="${escapeAttr(embedUrl)}" target="_blank" rel="noopener" class="embed-foot-link">Preview iframe ↗</a>
			</footer>
		</div>
	`;
	document.body.appendChild(modal);

	const close = () => {
		modal.remove();
		document.removeEventListener('keydown', onEsc);
	};
	const onEsc = (e) => {
		if (e.key === 'Escape') close();
	};
	document.addEventListener('keydown', onEsc);
	modal
		.querySelectorAll('[data-role="close"]')
		.forEach((el) => el.addEventListener('click', close));

	modal.querySelectorAll('.embed-tab').forEach((tab) => {
		tab.addEventListener('click', () => {
			modal.querySelectorAll('.embed-tab').forEach((t) => {
				t.classList.toggle('is-active', t === tab);
				t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
			});
			modal.querySelectorAll('.embed-pane').forEach((p) => {
				p.classList.toggle('is-active', p.dataset.pane === tab.dataset.tab);
			});
		});
	});

	modal.querySelectorAll('[data-role="copy"]').forEach((btn) => {
		btn.addEventListener('click', () => {
			const key = btn.dataset.key;
			const text = snippets[key];
			if (!text) return;
			const done = (ok) => {
				btn.textContent = ok ? 'Copied ✓' : 'Copy failed';
				setTimeout(() => (btn.textContent = 'Copy'), 1400);
			};
			if (navigator.clipboard?.writeText) {
				navigator.clipboard.writeText(text).then(
					() => done(true),
					() => done(false),
				);
			} else {
				const ta = modal.querySelector(`[data-pane="${key}"] .embed-snippet`);
				ta?.select();
				try {
					document.execCommand('copy');
					done(true);
				} catch {
					done(false);
				}
			}
		});
	});

	setTimeout(() => {
		const first = modal.querySelector('.embed-pane.is-active .embed-snippet');
		first?.focus();
		first?.select?.();
	}, 50);
}

loadPage();
