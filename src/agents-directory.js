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

const CACHE_TTL_MS = 60000;
const ITEMS_PER_PAGE = 24;

const PROTOCOL_LABELS = {
	web: 'WEB',
	a2a: 'A2A',
	mcp: 'MCP',
	token: 'TOKEN',
	chart: 'CHART',
	dbc: 'DBC',
	'agent-card': 'CARD',
	avatar: 'AVATAR',
	'avatar-3d': 'AVATAR',
};

function shortAddr(addr) {
	if (!addr) return '';
	const s = String(addr);
	if (s.length <= 10) return s;
	return s.slice(0, 6) + '…' + s.slice(-4);
}

function extractProtocols(metadata) {
	const out = [];
	const seen = new Set();
	const services = Array.isArray(metadata?.services) ? metadata.services : [];
	for (const svc of services) {
		if (!svc || typeof svc !== 'object') continue;
		const raw = String(svc.name || svc.type || '').toLowerCase().trim();
		if (!raw) continue;
		const label = PROTOCOL_LABELS[raw] || raw.toUpperCase();
		if (seen.has(label)) continue;
		seen.add(label);
		out.push({ label, version: svc.version ? String(svc.version) : '' });
	}
	return out;
}

function extractTrust(metadata) {
	const trust = metadata?.trust || metadata?.trustModels || metadata?.supportedTrust;
	if (!trust) return [];
	const arr = Array.isArray(trust) ? trust : [trust];
	return arr
		.map((t) => (typeof t === 'string' ? t : t?.name || t?.type))
		.filter(Boolean)
		.map(String);
}

function isActiveAgent(agent) {
	return Boolean(agent.registeredBlock);
}

export class AgentsDirectory {
	constructor(containerSelector) {
		this.container = document.querySelector(containerSelector);
		if (!this.container) throw new Error(`Container not found: ${containerSelector}`);
		this.agents = [];
		this.displayedAgents = [];
		this.currentPage = 1;
		this.filters = { chain: 'all', search: '', sort: 'newest', activeOnly: false };
		this.cache = new Map();
		this.cardClickHandler = null;
		this.lazyObserver = null;
	}

	/**
	 * @param {object} opts
	 * @param {string} [opts.chain='all']
	 * @param {string} [opts.search='']
	 * @param {string} [opts.sort='newest']
	 * @param {number} [opts.page=1]
	 * @param {boolean} [opts.activeOnly=false]
	 */
	async load({ chain = 'all', search = '', sort = 'newest', page = 1, activeOnly = false } = {}) {
		this.filters = { chain, search, sort, activeOnly };
		this.currentPage = page;

		const cacheKey = `${chain}:${page}:${search}:${sort}:${activeOnly ? 1 : 0}`;
		const cached = this.cache.get(cacheKey);
		if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
			this.displayedAgents = cached.data;
			const totalPages = Math.ceil(this.agents.length / ITEMS_PER_PAGE);
			return { agents: this.displayedAgents, totalPages, total: this.agents.length };
		}

		if (this.agents.length === 0) {
			await this._fetchAllAgents();
		}

		let filtered = this._applyFilters();
		filtered = this._applySorting(filtered);

		const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
		const offset = (page - 1) * ITEMS_PER_PAGE;
		this.displayedAgents = filtered.slice(offset, offset + ITEMS_PER_PAGE);

		this.cache.set(cacheKey, { data: this.displayedAgents, time: Date.now() });
		return { agents: this.displayedAgents, totalPages, total: filtered.length };
	}

	onCardClick(fn) {
		this.cardClickHandler = fn;
	}

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
		requestAnimationFrame(() => {
			this.container
				.querySelectorAll('img[data-src]')
				.forEach((img) => this.lazyObserver.observe(img));
		});
	}

	render() {
		const html = this.displayedAgents.map((agent) => this._renderCard(agent)).join('');
		this.container.innerHTML = html;
		this._attachEventListeners();
		this.setupLazyLoad();
	}

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
		const chainId = this._parseChainFilter(this.filters.chain);
		const chains = chainId === 'all' ? Object.keys(CHAIN_META).map(Number) : [chainId];

		// Fan out across chains in parallel; within each chain, fan out across
		// agent enrichment fetches (ownerOf + tokenURI + metadata) in parallel.
		const chainResults = await Promise.all(
			chains.map(async (cid) => {
				try {
					const events = await listRegisteredEvents({ chainId: cid, limit: 500 });
					const enriched = await Promise.all(
						events.map(async (ev) => {
							try {
								const agentId = String(ev.agentId);
								const [onchain, metaResult] = await Promise.all([
									getAgentOnchain({ chainId: cid, agentId }).catch(() => ({})),
									ev.agentURI
										? fetchAgentMetadata(ev.agentURI).catch(() => ({ ok: false }))
										: Promise.resolve({ ok: false }),
								]);
								const metadata = metaResult.ok && metaResult.data ? metaResult.data : {};
								const avatar = findAvatar3D(metadata);
								const imageUrl =
									!avatar && metadata.image && !/\.(glb|gltf)/i.test(metadata.image)
										? metadata.image
										: null;
								return {
									id: agentId,
									chainId: cid,
									name: metadata.name || `Agent #${agentId}`,
									description: metadata.description || '',
									avatar,
									image: imageUrl,
									owner: onchain.owner || ev.owner,
									protocols: extractProtocols(metadata),
									trust: extractTrust(metadata),
									createdAt: ev.blockNumber ? new Date(ev.blockNumber * 12000) : new Date(),
									registeredBlock: ev.blockNumber,
									txHash: ev.txHash,
									metadata,
								};
							} catch (err) {
								console.warn(`Failed to fetch agent ${ev.agentId} on ${cid}:`, err);
								return null;
							}
						}),
					);
					return enriched.filter(Boolean);
				} catch (err) {
					console.warn(`Failed to fetch chain ${cid}:`, err);
					return [];
				}
			}),
		);

		this.agents = chainResults.flat();
	}

	_applyFilters() {
		return this.agents.filter((agent) => {
			if (this.filters.chain !== 'all') {
				const targetChain = Number(this.filters.chain);
				if (agent.chainId !== targetChain) return false;
			}
			if (this.filters.activeOnly && !isActiveAgent(agent)) return false;
			if (this.filters.search.trim()) {
				const term = this.filters.search.toLowerCase();
				if (
					!agent.name.toLowerCase().includes(term) &&
					!agent.id.includes(term) &&
					!agent.description.toLowerCase().includes(term) &&
					!(agent.owner || '').toLowerCase().includes(term)
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
		const cleanName = this._escapeHtml(agent.name);
		const cleanDesc = this._escapeHtml(agent.description.slice(0, 140));
		const ownerShort = shortAddr(agent.owner);
		const ownerFull = this._escapeHtml(agent.owner || '');
		const active = isActiveAgent(agent);
		const thumb = agent.image || agent.avatar || '';

		const protoBadges = (agent.protocols || [])
			.slice(0, 4)
			.map(
				(p) =>
					`<span class="proto-badge proto-${this._escapeHtml(p.label.toLowerCase())}">${this._escapeHtml(p.label)}${p.version ? ` <span class="proto-ver">${this._escapeHtml(p.version)}</span>` : ''}</span>`,
			)
			.join('');
		const overflow = (agent.protocols || []).length > 4
			? `<span class="proto-badge proto-more">+${agent.protocols.length - 4}</span>`
			: '';

		const trustPills = (agent.trust || [])
			.map(
				(t) =>
					`<span class="trust-pill">★ ${this._escapeHtml(t.charAt(0).toUpperCase() + t.slice(1))}</span>`,
			)
			.join('');

		return `
			<div class="agent-card" data-agent-id="${agent.id}" data-chain-id="${agent.chainId}">
				<div class="card-head">
					<div class="card-avatar-sm">
						${
							thumb
								? `<img data-src="${this._escapeHtml(thumb)}" alt="${cleanName}" loading="lazy">`
								: '<div class="avatar-placeholder">▣</div>'
						}
					</div>
					<div class="card-title">
						<div class="card-name-row">
							<h3 class="card-name">${cleanName}</h3>
							${active ? '<span class="active-dot" aria-label="Active"></span>' : ''}
						</div>
						<div class="card-id" title="${this._escapeHtml(String(agent.id))}">#${this._escapeHtml(String(agent.id))}</div>
					</div>
				</div>
				<p class="card-desc">${cleanDesc}${agent.description.length > 140 ? '…' : ''}</p>
				${protoBadges || overflow ? `<div class="card-protos">${protoBadges}${overflow}</div>` : ''}
				${trustPills ? `<div class="card-trust">${trustPills}</div>` : ''}
				${
					ownerShort
						? `<div class="card-owner"><span class="owner-addr" data-copy="${ownerFull}" title="${ownerFull}">${this._escapeHtml(ownerShort)}</span><button class="owner-copy" data-copy="${ownerFull}" aria-label="Copy address">⎘</button></div>`
						: ''
				}
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
			card.addEventListener('click', (e) => {
				const copyTarget = e.target.closest('[data-copy]');
				if (copyTarget) {
					e.stopPropagation();
					const value = copyTarget.dataset.copy;
					if (value && navigator.clipboard) {
						navigator.clipboard.writeText(value).catch(() => {});
						copyTarget.classList.add('copied');
						setTimeout(() => copyTarget.classList.remove('copied'), 900);
					}
					return;
				}
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
