/**
 * /explore — the public on-chain avatar browser.
 *
 * Paste any of the following into the big input and see every matching
 * ERC-8004 registered 3D avatar on every supported chain:
 *
 *   - EVM address         (0x…40 hex)    → all agents owned by that wallet
 *   - ENS name            (vitalik.eth)  → resolved to address then fanned out
 *   - Transaction hash    (0x…64 hex)    → every Registered event in that tx
 *   - Agent ID            (6443)         → same id on every chain (fan-out)
 *   - agent:// URI        (agent://base/123) → precise single lookup
 *
 * Empty query → latest Registered events on Base mainnet (fallback: BSC Testnet).
 *
 * Clicking a card opens /a/<chainId>/<agentId> which renders the 3D avatar via
 * app.js `_loadOnChainAgent`.
 *
 * Lazy-loaded by src/app.js `_showExplorePage`.
 */

import {
	autoResolve,
	detectInputType,
	hydrateAgent,
	INPUT_TYPES,
	DEFAULT_FAN_OUT_CHAINS,
	splitChainsByNet,
} from './resolve-avatar.js';
import { listRegisteredEvents } from './queries.js';
import { CHAIN_META } from './chain-meta.js';
import { resolveURI } from '../ipfs.js';

const RECENT_KEY = '3dagent.explore.recent';
const CHAINS_KEY = '3dagent.explore.chains';
const RECENT_MAX = 8;
const FEATURED_CHAIN_ID = 8453;
const FEATURED_FALLBACK_CHAIN_ID = 97;
const FEATURED_COUNT = 12;
const FEATURED_SCAN_BLOCKS = 250000;

const esc = (s) =>
	String(s ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
	);

const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');

const INPUT_TYPE_LABEL = {
	[INPUT_TYPES.ADDRESS]: 'Wallet address',
	[INPUT_TYPES.ENS]: 'ENS name',
	[INPUT_TYPES.TX_HASH]: 'Transaction hash',
	[INPUT_TYPES.AGENT_ID]: 'Agent ID',
	[INPUT_TYPES.AGENT_URI]: 'agent:// URI',
	[INPUT_TYPES.UNKNOWN]: 'Unrecognized',
};

const EXAMPLES = [
	{ label: 'Agent #1 on Base', value: 'agent://base/1' },
	{ label: 'vitalik.eth', value: 'vitalik.eth' },
	{ label: 'Agent #1', value: '1' },
];

/**
 * Entry point called by app.js `_showExplorePage`.
 * @param {HTMLElement} container
 */
export function renderExplorePage(container) {
	const page = new ExplorePage(container);
	page.mount();
	return page;
}

// ───────────────────────────────────────────────────────────────────────────
// ExplorePage
// ───────────────────────────────────────────────────────────────────────────

class ExplorePage {
	/** @param {HTMLElement} container */
	constructor(container) {
		this.container = container;
		this._chains = loadChainSelection();
		this._results = [];
		this._query = '';
		this._queryType = INPUT_TYPES.UNKNOWN;
		this._resolvedAddress = '';
		this._loading = false;
		this._perChainState = new Map();
		this._filter = 'all';
		this._abortCounter = 0;
		this._onHashChange = () => this._loadFromURL({ replace: false });
	}

	mount() {
		this.container.innerHTML = `
			<div class="explore-shell">
				<header class="explore-hero">
					<div class="explore-hero-inner">
						<div class="explore-eyebrow">ERC-8004 · On-chain avatars</div>
						<h1 class="explore-title">See anyone's 3D self.</h1>
						<p class="explore-subtitle">
							Paste a wallet, ENS name, transaction, or agent ID to resolve every
							on-chain avatar they've minted — across every supported chain.
						</p>
						<form class="explore-form" data-role="form" autocomplete="off">
							<div class="explore-input-wrap">
								<input
									class="explore-input"
									name="q"
									placeholder="0xabc… · vitalik.eth · tx hash · agent ID"
									spellcheck="false"
									autocapitalize="off"
								/>
								<button type="submit" class="explore-btn explore-btn--primary">Resolve</button>
							</div>
							<div class="explore-input-meta" data-role="inputMeta"></div>
						</form>
						<div class="explore-examples" data-role="examples"></div>
					</div>
				</header>

				<section class="explore-controls">
					<div class="explore-controls-row">
						<strong class="explore-controls-lbl">Chains</strong>
						<div class="explore-chain-chips" data-role="chainChips"></div>
						<div class="explore-controls-spacer"></div>
						<div class="explore-progress" data-role="progress" hidden></div>
					</div>
				</section>

				<section class="explore-results" data-role="results"></section>
			</div>
		`;

		this._renderExamples();
		this._renderChainChips();
		this._bindForm();

		window.addEventListener('hashchange', this._onHashChange);
		window.addEventListener('popstate', this._onHashChange);

		this._loadFromURL({ replace: true });
	}

	destroy() {
		window.removeEventListener('hashchange', this._onHashChange);
		window.removeEventListener('popstate', this._onHashChange);
	}

	// ── URL ↔ state ───────────────────────────────────────────────────────

	_loadFromURL({ replace }) {
		const { q } = parseURL();
		const input = this.container.querySelector('.explore-input');
		if (q) {
			input.value = q;
			this._query = q;
			this._runResolve(q, { pushHistory: false });
		} else {
			input.value = '';
			this._query = '';
			this._results = [];
			this._showFeatured();
		}
		this._updateInputMeta(input.value);
	}

	_pushURL(q) {
		const url = new URL(location.href);
		if (q) url.searchParams.set('q', q);
		else url.searchParams.delete('q');
		history.pushState({}, '', url.toString());
	}

	// ── Input ─────────────────────────────────────────────────────────────

	_bindForm() {
		const form = this.container.querySelector('[data-role="form"]');
		const input = form.querySelector('.explore-input');
		form.addEventListener('submit', (e) => {
			e.preventDefault();
			const q = input.value.trim();
			if (!q) return;
			this._pushURL(q);
			this._runResolve(q);
		});
		input.addEventListener('input', () => this._updateInputMeta(input.value));
	}

	_updateInputMeta(value) {
		const el = this.container.querySelector('[data-role="inputMeta"]');
		const v = String(value || '').trim();
		if (!v) {
			el.innerHTML = '';
			el.className = 'explore-input-meta';
			return;
		}
		const type = detectInputType(v);
		const label = INPUT_TYPE_LABEL[type];
		const cls = type === INPUT_TYPES.UNKNOWN ? 'explore-inputmeta--warn' : 'explore-inputmeta--ok';
		el.className = `explore-input-meta ${cls}`;
		el.textContent = `Detected: ${label}`;
	}

	_renderExamples() {
		const recent = loadRecent();
		const root = this.container.querySelector('[data-role="examples"]');
		const entries = recent.length ? recent : EXAMPLES;
		root.innerHTML = `
			<span class="explore-examples-lbl">${recent.length ? 'Recent:' : 'Try:'}</span>
			${entries
				.map(
					(e) => `
				<button type="button" class="explore-example" data-q="${esc(e.value || e)}">${esc(e.label || e.value || e)}</button>
			`,
				)
				.join('')}
		`;
		this._wireExampleClicks(root);
	}

	// ── Chain chips ───────────────────────────────────────────────────────

	_renderChainChips() {
		const root = this.container.querySelector('[data-role="chainChips"]');
		const { mainnet, testnet } = splitChainsByNet();
		const chipHTML = (id) => {
			const m = CHAIN_META[id];
			if (!m) return '';
			const active = this._chains.includes(id);
			return `
				<button type="button"
					class="explore-chain-chip ${active ? 'explore-chain-chip--active' : ''} ${m.testnet ? 'explore-chain-chip--testnet' : ''}"
					data-chain="${id}"
					title="${esc(m.name)}"
				>
					<span class="explore-chain-dot"></span>
					${esc(m.shortName || m.name)}
				</button>
			`;
		};
		root.innerHTML = `
			<div class="explore-chain-group">${mainnet.map(chipHTML).join('')}</div>
			<div class="explore-chain-divider">·</div>
			<div class="explore-chain-group explore-chain-group--testnet">
				${testnet.map(chipHTML).join('')}
			</div>
			<button type="button" class="explore-chain-presets-btn" data-role="preset-main">Mainnets</button>
			<button type="button" class="explore-chain-presets-btn" data-role="preset-all">All</button>
		`;
		root.querySelectorAll('.explore-chain-chip').forEach((chip) => {
			chip.addEventListener('click', () => {
				const id = Number(chip.dataset.chain);
				const idx = this._chains.indexOf(id);
				if (idx >= 0) this._chains.splice(idx, 1);
				else this._chains.push(id);
				saveChainSelection(this._chains);
				this._renderChainChips();
				if (this._query) this._runResolve(this._query, { pushHistory: false });
			});
		});
		root.querySelector('[data-role="preset-main"]').addEventListener('click', () => {
			const { mainnet } = splitChainsByNet();
			this._chains = mainnet.slice();
			saveChainSelection(this._chains);
			this._renderChainChips();
			if (this._query) this._runResolve(this._query, { pushHistory: false });
		});
		root.querySelector('[data-role="preset-all"]').addEventListener('click', () => {
			const { mainnet, testnet } = splitChainsByNet();
			this._chains = [...mainnet, ...testnet];
			saveChainSelection(this._chains);
			this._renderChainChips();
			if (this._query) this._runResolve(this._query, { pushHistory: false });
		});
	}

	// ── Resolve ───────────────────────────────────────────────────────────

	async _runResolve(rawInput, { pushHistory = true } = {}) {
		const q = String(rawInput || '').trim();
		if (!q) return;

		this._query = q;
		this._queryType = detectInputType(q);
		this._resolvedAddress = '';
		this._perChainState = new Map();
		this._loading = true;
		this._abortCounter++;
		const thisAbort = this._abortCounter;

		pushRecent(q);
		this._renderExamples();

		const chains = this._chains.length ? this._chains.slice() : DEFAULT_FAN_OUT_CHAINS.slice();
		this._renderProgress(chains);
		this._renderResultsSkeleton();

		try {
			const { type, resolvedAddress, results } = await autoResolve({
				input: q,
				chainIds: chains,
				ethProvider: window.ethereum,
				onProgress: (chainId, stage, payload) => {
					if (thisAbort !== this._abortCounter) return;
					this._perChainState.set(chainId, { stage, payload });
					this._renderProgress(chains);
				},
			});
			if (thisAbort !== this._abortCounter) return;

			this._queryType = type;
			this._resolvedAddress = resolvedAddress || '';
			this._results = results || [];
			this._loading = false;
			this._renderResults();
			this._hideProgress();
		} catch (err) {
			if (thisAbort !== this._abortCounter) return;
			this._loading = false;
			this._hideProgress();
			this._renderError(err.message || String(err));
		}
	}

	// ── Progress HUD ──────────────────────────────────────────────────────

	_renderProgress(chains) {
		const root = this.container.querySelector('[data-role="progress"]');
		if (!this._loading) {
			root.hidden = true;
			return;
		}
		root.hidden = false;
		const done = chains.filter((c) => this._perChainState.get(c)?.stage === 'done').length;
		const errored = chains.filter((c) => this._perChainState.get(c)?.stage === 'error').length;
		root.innerHTML = `
			<span class="explore-progress-spinner"></span>
			<span>Resolving ${done}/${chains.length} chains${errored ? ` · ${errored} errored` : ''}</span>
		`;
	}

	_hideProgress() {
		const root = this.container.querySelector('[data-role="progress"]');
		root.hidden = true;
	}

	// ── Results ───────────────────────────────────────────────────────────

	_renderResultsSkeleton() {
		const out = this.container.querySelector('[data-role="results"]');
		const chains = this._chains.length ? this._chains : DEFAULT_FAN_OUT_CHAINS;
		const n = this._queryType === INPUT_TYPES.AGENT_ID ? chains.length : 6;
		out.innerHTML = `
			<div class="explore-grid" aria-busy="true">
				${Array.from({ length: n })
					.map(
						() => `
					<div class="explore-card explore-card--skel">
						<div class="explore-skel-img"></div>
						<div class="explore-skel-line"></div>
						<div class="explore-skel-line explore-skel-line--short"></div>
					</div>
				`,
					)
					.join('')}
			</div>
		`;
	}

	_renderResults() {
		const out = this.container.querySelector('[data-role="results"]');
		const results = this._results;
		const summary = this._renderSummary();

		if (!results.length) {
			out.innerHTML = `
				${summary}
				<div class="explore-empty">
					<div class="explore-empty-art">🫥</div>
					<h3>No on-chain avatars found.</h3>
					<p>${renderNoMatchCopy(this._queryType, this._query)}</p>
					<div class="explore-empty-ideas">
						${EXAMPLES.map(
							(e) => `
							<button type="button" class="explore-example" data-q="${esc(e.value)}">${esc(e.label)}</button>
						`,
						).join('')}
					</div>
				</div>
			`;
			this._wireExampleClicks(out);
			return;
		}

		const filterBar = results.length >= 3 ? this._renderFilterBar() : '';
		const visible = this._applyFilter(results);

		out.innerHTML = `
			${summary}
			${filterBar}
			<div class="explore-grid">
				${visible.map((r) => renderCard(r)).join('')}
			</div>
		`;

		this._wireCards(out);
		if (filterBar) this._wireFilterBar(out);
	}

	_renderSummary() {
		const n = this._results.length;
		if (!this._query) return '';
		const type = this._queryType;
		let title = '';
		let sub = '';

		const with3D = this._results.filter((r) => !!r.avatarUri).length;

		if (type === INPUT_TYPES.ADDRESS || type === INPUT_TYPES.ENS) {
			const who = this._resolvedAddress || this._query;
			title =
				n === 0
					? `No agents owned by ${esc(shortAddr(who))}`
					: `${n} agent${n === 1 ? '' : 's'} owned by ${esc(shortAddr(who))}`;
			if (type === INPUT_TYPES.ENS && this._resolvedAddress) {
				sub = `${esc(this._query)} → <code>${esc(this._resolvedAddress)}</code>`;
			} else if (who) {
				sub = `<code>${esc(who)}</code>`;
			}
		} else if (type === INPUT_TYPES.TX_HASH) {
			title =
				n === 0
					? `No Registered events in this transaction`
					: `${n} agent${n === 1 ? '' : 's'} minted in this transaction`;
			sub = `<code>${esc(this._query)}</code>`;
		} else if (type === INPUT_TYPES.AGENT_ID) {
			title =
				n === 0
					? `Agent #${esc(this._query)} not found on any selected chain`
					: `Agent #${esc(this._query)} on ${n} chain${n === 1 ? '' : 's'}`;
		} else if (type === INPUT_TYPES.AGENT_URI) {
			title = n === 0 ? `Agent not found` : `Agent on ${esc(this._results[0]?.chainName || '?')}`;
			sub = `<code>${esc(this._query)}</code>`;
		}

		return `
			<div class="explore-summary">
				<div class="explore-summary-head">
					<h2 class="explore-summary-title">${title}</h2>
					${n ? `<span class="explore-summary-stat">${with3D} with 3D body · ${n - with3D} metadata-only</span>` : ''}
				</div>
				${sub ? `<div class="explore-summary-sub">${sub}</div>` : ''}
			</div>
		`;
	}

	_renderFilterBar() {
		const filters = [
			{ id: 'all', label: 'All' },
			{ id: '3d', label: '3D body' },
			{ id: 'x402', label: 'x402 💳' },
			{ id: 'a2a', label: 'A2A' },
			{ id: 'mcp', label: 'MCP' },
		];
		return `
			<div class="explore-filterbar" data-role="filterbar">
				${filters
					.map(
						(f) => `
					<button type="button"
						class="explore-filter ${this._filter === f.id ? 'explore-filter--active' : ''}"
						data-filter="${f.id}"
					>${esc(f.label)}</button>
				`,
					)
					.join('')}
			</div>
		`;
	}

	_wireFilterBar(out) {
		out.querySelectorAll('[data-role="filterbar"] .explore-filter').forEach((btn) => {
			btn.addEventListener('click', () => {
				this._filter = btn.dataset.filter;
				this._renderResults();
			});
		});
	}

	_applyFilter(results) {
		switch (this._filter) {
			case '3d':
				return results.filter((r) => !!r.avatarUri);
			case 'x402':
				return results.filter((r) => !!r.x402);
			case 'a2a':
				return results.filter((r) => r.serviceTypes?.includes('A2A'));
			case 'mcp':
				return results.filter((r) => r.serviceTypes?.includes('MCP'));
			default:
				return results;
		}
	}

	_wireCards(root) {
		root.querySelectorAll('[data-role="card-copy"]').forEach((btn) => {
			btn.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				const url = new URL(btn.dataset.share, location.origin).href;
				if (navigator.clipboard?.writeText) {
					navigator.clipboard.writeText(url).then(
						() => flashToast('Link copied'),
						() => flashToast('Copy failed', true),
					);
				} else {
					flashToast(url);
				}
			});
		});
	}

	_wireExampleClicks(root) {
		root.querySelectorAll('.explore-example').forEach((btn) => {
			btn.addEventListener('click', () => {
				const q = btn.dataset.q;
				this.container.querySelector('.explore-input').value = q;
				this._updateInputMeta(q);
				this._pushURL(q);
				this._runResolve(q);
			});
		});
	}

	_renderError(message) {
		const out = this.container.querySelector('[data-role="results"]');
		out.innerHTML = `
			<div class="explore-error">
				<strong>Couldn't resolve.</strong>
				<p>${esc(message)}</p>
				<div class="explore-empty-ideas">
					${EXAMPLES.map(
						(e) => `
						<button type="button" class="explore-example" data-q="${esc(e.value)}">${esc(e.label)}</button>
					`,
					).join('')}
				</div>
			</div>
		`;
		this._wireExampleClicks(out);
	}

	// ── Featured (no query) ───────────────────────────────────────────────

	async _showFeatured() {
		const out = this.container.querySelector('[data-role="results"]');
		out.innerHTML = `
			<div class="explore-featured-head">
				<h2>Recently minted on ${esc(CHAIN_META[FEATURED_CHAIN_ID]?.name || 'Base')}</h2>
				<p class="explore-muted">Latest <code>Registered</code> events on the canonical Identity Registry.</p>
			</div>
			<div class="explore-grid" aria-busy="true" data-role="featured">
				${Array.from({ length: FEATURED_COUNT })
					.map(
						() => `
					<div class="explore-card explore-card--skel">
						<div class="explore-skel-img"></div>
						<div class="explore-skel-line"></div>
						<div class="explore-skel-line explore-skel-line--short"></div>
					</div>
				`,
					)
					.join('')}
			</div>
		`;

		const featured = await fetchFeatured();
		const grid = this.container.querySelector('[data-role="featured"]');
		if (!grid) return;

		if (!featured.length) {
			grid.outerHTML = `
				<div class="explore-empty">
					<div class="explore-empty-art">✨</div>
					<h3>No recent Registered events indexed.</h3>
					<p class="explore-muted">Paste an address or agent ID above to look one up.</p>
				</div>
			`;
			return;
		}

		grid.innerHTML = featured.map((r) => renderCard(r)).join('');
		this._wireCards(grid.parentElement || grid);
	}
}

// ───────────────────────────────────────────────────────────────────────────
// Card
// ───────────────────────────────────────────────────────────────────────────

/** @param {import('./resolve-avatar.js').AvatarResult} r */
function renderCard(r) {
	const chainMeta = CHAIN_META[r.chainId];
	const img = r.image ? resolveURI(r.image) : '';
	const chainShort = chainMeta?.shortName || chainMeta?.name || `#${r.chainId}`;
	const chainBadge = `
		<span class="explore-chain-badge ${chainMeta?.testnet ? 'explore-chain-badge--testnet' : ''}" title="${esc(chainMeta?.name || '')}">
			${esc(chainShort)}
		</span>
	`;
	const title = esc(r.name || `Agent #${r.agentId}`);
	const id = `#${esc(r.agentId)}`;
	const ownerLine = r.owner
		? `<a class="explore-owner" href="${esc(r.ownerExplorerUrl)}" target="_blank" rel="noopener" title="${esc(r.owner)}">Owner ${esc(shortAddr(r.owner))} ↗</a>`
		: '';
	const descLine = r.description
		? `<p class="explore-card-desc">${esc(truncate(r.description, 140))}</p>`
		: '';

	const tags = [];
	if (r.avatarUri) tags.push(`<span class="explore-tag explore-tag--3d">3D</span>`);
	if (r.x402) tags.push(`<span class="explore-tag explore-tag--x402">x402 💳</span>`);
	for (const t of r.serviceTypes || []) {
		if (t === 'A2A') tags.push(`<span class="explore-tag">A2A</span>`);
		else if (t === 'MCP') tags.push(`<span class="explore-tag">MCP</span>`);
		else if (t === 'OASF') tags.push(`<span class="explore-tag">OASF</span>`);
	}

	const errLine = r.error ? `<div class="explore-card-err">${esc(r.error)}</div>` : '';
	const viewerUrl = r.viewerUrl;
	const explorerUrl = r.tokenExplorerUrl;

	return `
		<article class="explore-card">
			<a class="explore-card-thumb" href="${esc(viewerUrl)}" aria-label="Open Agent #${esc(r.agentId)} in 3D viewer">
				${img ? `<img src="${esc(img)}" alt="" loading="lazy" />` : `<div class="explore-card-ph">🤖</div>`}
				${chainBadge}
				${r.avatarUri ? `<span class="explore-card-3dpill">▶ 3D</span>` : ''}
			</a>
			<div class="explore-card-body">
				<div class="explore-card-head">
					<a class="explore-card-title" href="${esc(viewerUrl)}">${title}</a>
					<span class="explore-card-id">${id}</span>
				</div>
				${descLine}
				<div class="explore-card-tags">${tags.join('')}</div>
				${ownerLine}
				${errLine}
				<div class="explore-card-actions">
					<a class="explore-btn explore-btn--sm explore-btn--primary" href="${esc(viewerUrl)}">Open 3D ↗</a>
					${explorerUrl ? `<a class="explore-btn explore-btn--sm" href="${esc(explorerUrl)}" target="_blank" rel="noopener">Explorer ↗</a>` : ''}
					<button type="button" class="explore-btn explore-btn--sm explore-btn--ghost"
						data-role="card-copy" data-share="${esc(viewerUrl)}" title="Copy shareable link">Share</button>
				</div>
			</div>
		</article>
	`;
}

function truncate(s, n) {
	s = String(s || '');
	return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function renderNoMatchCopy(type, query) {
	switch (type) {
		case INPUT_TYPES.ADDRESS:
			return `We scanned the selected chains — this wallet hasn't minted any ERC-8004 agents there yet.`;
		case INPUT_TYPES.ENS:
			return `ENS resolved, but the address owns no ERC-8004 agents on the selected chains.`;
		case INPUT_TYPES.TX_HASH:
			return `This tx has no <code>Registered</code> events from the ERC-8004 Identity Registry on the selected chains.`;
		case INPUT_TYPES.AGENT_ID:
			return `Agent #${esc(query)} isn't minted on any selected chain. Try enabling more chains above.`;
		default:
			return `Nothing resolved. Try an address, ENS name, tx hash, or agent ID.`;
	}
}

// ───────────────────────────────────────────────────────────────────────────
// Toast
// ───────────────────────────────────────────────────────────────────────────

function flashToast(text, isError = false) {
	const toast = document.createElement('div');
	toast.className = 'erc8004-toast' + (isError ? ' erc8004-toast--error' : '');
	toast.textContent = text;
	document.body.appendChild(toast);
	setTimeout(() => toast.remove(), 1800);
}

// ───────────────────────────────────────────────────────────────────────────
// Featured loader
// ───────────────────────────────────────────────────────────────────────────

async function fetchFeatured() {
	const tryChain = async (chainId) => {
		try {
			const events = await listRegisteredEvents({
				chainId,
				blocks: FEATURED_SCAN_BLOCKS,
				limit: FEATURED_COUNT,
				ethProvider: window.ethereum,
			});
			if (!events.length) return [];
			const hydrated = await Promise.all(
				events.map((ev) =>
					hydrateAgent({ chainId, agentId: ev.agentId, ethProvider: window.ethereum }),
				),
			);
			return hydrated;
		} catch {
			return [];
		}
	};
	const primary = await tryChain(FEATURED_CHAIN_ID);
	if (primary.length) return primary;
	return tryChain(FEATURED_FALLBACK_CHAIN_ID);
}

// ───────────────────────────────────────────────────────────────────────────
// Persistence
// ───────────────────────────────────────────────────────────────────────────

function parseURL() {
	const url = new URL(location.href);
	const q = url.searchParams.get('q') || '';
	return { q };
}

function loadRecent() {
	try {
		const raw = localStorage.getItem(RECENT_KEY);
		if (!raw) return [];
		const arr = JSON.parse(raw);
		if (!Array.isArray(arr)) return [];
		return arr.slice(0, RECENT_MAX);
	} catch {
		return [];
	}
}

function pushRecent(value) {
	try {
		const recent = loadRecent();
		const idx = recent.findIndex((r) => (r.value || r) === value);
		if (idx >= 0) recent.splice(idx, 1);
		recent.unshift({ label: value, value });
		localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, RECENT_MAX)));
	} catch {
		/* quota / disabled */
	}
}

function loadChainSelection() {
	try {
		const raw = localStorage.getItem(CHAINS_KEY);
		if (!raw) return DEFAULT_FAN_OUT_CHAINS.slice();
		const arr = JSON.parse(raw);
		if (!Array.isArray(arr) || !arr.length) return DEFAULT_FAN_OUT_CHAINS.slice();
		return arr.map(Number).filter(Boolean);
	} catch {
		return DEFAULT_FAN_OUT_CHAINS.slice();
	}
}

function saveChainSelection(arr) {
	try {
		localStorage.setItem(CHAINS_KEY, JSON.stringify(arr));
	} catch {
		/* quota / disabled */
	}
}
