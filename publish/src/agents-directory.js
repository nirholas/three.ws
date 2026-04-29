/**
 * Public agents directory controller.
 *
 * Manages fetching, caching, filtering, and sorting of registered agents.
 * Uses on-chain data from IdentityRegistry with optional backend metadata.
 */

import {
	listRegisteredEvents,
	getAgentOnchain,
	fetchAgentMetadata,
	findAvatar3D,
} from './erc8004/queries.js';
import { CHAIN_META } from './erc8004/chain-meta.js';
import { REGISTRY_DEPLOYMENTS } from './erc8004/abi.js';

const CACHE_TTL_MS = 60000; // 60s SWR cache
const ITEMS_PER_PAGE = 30;

export class AgentsDirectory {
	constructor(containerSelector) {
		this.container = document.querySelector(containerSelector);
		if (!this.container) throw new Error(`Container not found: ${containerSelector}`);
		this.agents = []; // All loaded agents
		this.displayedAgents = []; // Filtered agents for current page
		this.currentPage = 1;
		this.filters = {
			chain: 'all',
			search: '',
			sort: 'newest',
		};
		this.cache = new Map(); // Per-page caches: `${chain}:${page}` → { data, time }
		this.cardClickHandler = null;
		this.lazyObserver = null;
	}

	/**
	 * Load agents for a given chain, page, and filters.
	 * @param {object} opts
	 * @param {string} [opts.chain='all'] Chain filter: 'all', 'base', 'base-sepolia', etc.
	 * @param {string} [opts.search=''] Search term (name/id)
	 * @param {string} [opts.sort='newest'] Sort key: 'newest', 'name', 'oldest'
	 * @param {number} [opts.page=1] Page number (1-indexed)
	 * @returns {Promise<{ agents: Array, totalPages: number, total: number }>}
	 */
	async load({ chain = 'all', search = '', sort = 'newest', page = 1 } = {}) {
		this.filters = { chain, search, sort };
		this.currentPage = page;

		// Check cache
		const cacheKey = `${chain}:${page}:${search}:${sort}`;
		const cached = this.cache.get(cacheKey);
		if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
			this.displayedAgents = cached.data;
			const totalPages = Math.ceil(this.agents.length / ITEMS_PER_PAGE);
			return { agents: this.displayedAgents, totalPages, total: this.agents.length };
		}

		// Fetch all agents if not already loaded
		if (this.agents.length === 0) {
			await this._fetchAllAgents();
		}

		// Apply filters and sorting
		let filtered = this._applyFilters();
		filtered = this._applySorting(filtered);

		// Paginate
		const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
		const offset = (page - 1) * ITEMS_PER_PAGE;
		this.displayedAgents = filtered.slice(offset, offset + ITEMS_PER_PAGE);

		// Cache result
		this.cache.set(cacheKey, { data: this.displayedAgents, time: Date.now() });

		return { agents: this.displayedAgents, totalPages, total: filtered.length };
	}

	/**
	 * Register a callback for card clicks.
	 * @param {Function} fn Called with agent object when card is clicked
	 */
	onCardClick(fn) {
		this.cardClickHandler = fn;
	}

	/**
	 * Set up lazy loading for avatar thumbnails.
	 */
	setupLazyLoad() {
		if (!('IntersectionObserver' in window)) return;
		this.lazyObserver = new IntersectionObserver((entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				const img = entry.target;
				const src = img.dataset.src;
				if (src) {
					img.src = src;
					img.removeAttribute('data-src');
					this.lazyObserver.unobserve(img);
				}
			}
		});
		// Observe on next render
		requestAnimationFrame(() => {
			this.container
				.querySelectorAll('img[data-src]')
				.forEach((img) => this.lazyObserver.observe(img));
		});
	}

	/**
	 * Render agent cards as HTML. Call after load().
	 */
	render() {
		const html = this.displayedAgents.map((agent) => this._renderCard(agent)).join('');
		this.container.innerHTML = html;
		this._attachEventListeners();
		this.setupLazyLoad();
	}

	/**
	 * Return pagination info for current state.
	 */
	getPaginationInfo() {
		const totalPages = Math.ceil(this._applyFilters().length / ITEMS_PER_PAGE);
		return {
			page: this.currentPage,
			totalPages,
			itemsPerPage: ITEMS_PER_PAGE,
			hasNextPage: this.currentPage < totalPages,
			hasPrevPage: this.currentPage > 1,
		};
	}

	// ─────────────────────────────────────────────────────────────────────────

	async _fetchAllAgents() {
		const agents = [];
		const chainId = this._parseChainFilter(this.filters.chain);
		const chains = chainId === 'all' ? Object.keys(CHAIN_META).map(Number) : [chainId];

		for (const cid of chains) {
			try {
				const events = await listRegisteredEvents({
					chainId: cid,
					limit: 500, // Adjust as needed
				});

				for (const ev of events) {
					try {
						const agentId = String(ev.agentId);
						const onchain = await getAgentOnchain({
							chainId: cid,
							agentId,
						});

						let metadata = {};
						if (ev.agentURI) {
							const result = await fetchAgentMetadata(ev.agentURI);
							if (result.ok && result.data) {
								metadata = result.data;
							}
						}

						const avatar = findAvatar3D(metadata);

						agents.push({
							id: agentId,
							chainId: cid,
							name: metadata.name || `Agent #${agentId}`,
							description: metadata.description || '',
							avatar,
							owner: onchain.owner || ev.owner,
							createdAt: ev.blockNumber
								? new Date(ev.blockNumber * 12000) // Rough estimate
								: new Date(),
							registeredBlock: ev.blockNumber,
							txHash: ev.txHash,
						});
					} catch (err) {
						console.warn(`Failed to fetch agent ${ev.agentId}:`, err);
					}
				}
			} catch (err) {
				console.warn(`Failed to fetch chain ${cid}:`, err);
			}
		}

		this.agents = agents;
	}

	_applyFilters() {
		return this.agents.filter((agent) => {
			// Chain filter
			if (this.filters.chain !== 'all') {
				const targetChain = Number(this.filters.chain);
				if (agent.chainId !== targetChain) return false;
			}

			// Search filter
			if (this.filters.search.trim()) {
				const term = this.filters.search.toLowerCase();
				if (
					!agent.name.toLowerCase().includes(term) &&
					!agent.id.includes(term) &&
					!agent.description.toLowerCase().includes(term)
				) {
					return false;
				}
			}

			return true;
		});
	}

	_applySorting(agents) {
		const sorted = [...agents];
		switch (this.filters.sort) {
			case 'name':
				sorted.sort((a, b) => a.name.localeCompare(b.name));
				break;
			case 'oldest':
				sorted.sort((a, b) => a.createdAt - b.createdAt);
				break;
			case 'newest':
			default:
				sorted.sort((a, b) => b.createdAt - a.createdAt);
		}
		return sorted;
	}

	_renderCard(agent) {
		const avatarUrl = agent.avatar || '';
		const cleanName = this._escapeHtml(agent.name);
		const cleanDesc = this._escapeHtml(agent.description.slice(0, 100));
		const chainName = CHAIN_META[agent.chainId]?.name || `Chain ${agent.chainId}`;

		return `
			<div class="agent-card" data-agent-id="${agent.id}" data-chain-id="${agent.chainId}">
				<div class="card-avatar">
					${
						avatarUrl
							? `<img data-src="${this._escapeHtml(avatarUrl)}" alt="${cleanName}" loading="lazy">`
							: '<div class="avatar-placeholder">👤</div>'
					}
				</div>
				<div class="card-content">
					<h3 class="card-name">${cleanName}</h3>
					<p class="card-desc">${cleanDesc}${agent.description.length > 100 ? '…' : ''}</p>
					<div class="card-meta">
						<span class="chain-badge">${chainName}</span>
						<span class="agent-id">#${agent.id}</span>
					</div>
				</div>
			</div>
		`;
	}

	_escapeHtml(text) {
		const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
		return String(text).replace(/[&<>"']/g, (m) => map[m]);
	}

	_parseChainFilter(filter) {
		if (filter === 'all') return 'all';
		const num = Number(filter);
		return isNaN(num) ? 'all' : num;
	}

	_attachEventListeners() {
		this.container.querySelectorAll('.agent-card').forEach((card) => {
			card.addEventListener('click', () => {
				const agentId = card.dataset.agentId;
				const chainId = card.dataset.chainId;
				const agent = this.agents.find(
					(a) => a.id === agentId && a.chainId === Number(chainId),
				);
				if (agent && this.cardClickHandler) {
					this.cardClickHandler(agent);
				}
			});
		});
	}
}
