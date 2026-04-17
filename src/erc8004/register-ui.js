/**
 * ERC-8004 registration UI.
 *
 * Tabbed interface for creating, listing, searching, and auditing ERC-8004
 * agents. Inspired by erc8004.agency but extended with GLB uploads and 3D
 * viewer links specific to 3D-Agent.
 *
 * Tabs:
 *   - Create Agent  (4-step wizard: Identity → Services → Configuration → Deploy)
 *   - My Agents     (owned-by-wallet, current chain)
 *   - Search        (by Agent ID)
 *   - Templates     (pre-fills Create Agent)
 *   - History       (Registered events for the connected wallet)
 *
 * Uses plain DOM — consistent with the rest of the project.
 */

import {
	registerAgent,
	connectWallet,
	pinFile,
	getIdentityRegistry,
	buildRegistrationJSON,
} from './agent-registry.js';
import { glbFileToThumbnail } from './thumbnail.js';
import { isPrivyConfigured } from './privy.js';
import { REGISTRY_DEPLOYMENTS } from './abi.js';
import { renderBatchTab } from './batch-tab.js';
import { renderQRToCanvas } from './qr.js';
import {
	CHAIN_META,
	DEFAULT_CHAIN_ID,
	switchChain,
	addressExplorerUrl,
	tokenExplorerUrl,
	txExplorerUrl,
	supportedChainIds,
} from './chain-meta.js';
import {
	getReadRegistry,
	listAgentsByOwner,
	listRegisteredEvents,
	getAgentOnchain,
	fetchAgentMetadata,
	getRegistryVersion,
	getTotalSupply,
} from './queries.js';

// ───────────────────────────────────────────────────────────────────────────
// Templates (for the Templates tab → prefills Create)
// ───────────────────────────────────────────────────────────────────────────

const TEMPLATES = [
	{
		id: 'companion',
		emoji: '🤝',
		name: 'Virtual Companion',
		description:
			'Always-on digital friend with persistent memory and empathy for daily check-ins and emotional support.',
	},
	{
		id: 'influencer',
		emoji: '🎭',
		name: 'Virtual Influencer',
		description:
			'On-brand 3D persona for social posts, livestreams, and AMAs with a consistent face and voice.',
	},
	{
		id: 'vtuber',
		emoji: '📺',
		name: 'VTuber Co-Host',
		description:
			'Livestream co-host with reactive expressions, chat moderation, superchat shoutouts, and lore memory.',
	},
	{
		id: 'tutor',
		emoji: '🎓',
		name: 'Language Tutor',
		description:
			'One-on-one conversation practice with pronunciation feedback, spaced repetition, and adaptive lessons.',
	},
	{
		id: 'gallery',
		emoji: '🖼️',
		name: 'Gallery Guide',
		description:
			'Embodied docent for 3D galleries, NFT exhibitions, and metaverse rooms with scripted tours and Q&A.',
	},
	{
		id: 'npc',
		emoji: '🎮',
		name: 'Game NPC',
		description:
			'Questgiver and dialog partner for game worlds with persistent lore, per-player memory, and branching scripts.',
	},
	{
		id: 'wellness',
		emoji: '🧘',
		name: 'Wellness Coach',
		description:
			'Breathwork, meditation, and daily mood check-ins with a calm, empathetic embodied presence.',
	},
	{
		id: 'concierge',
		emoji: '🪪',
		name: 'NFT Concierge',
		description:
			'Token-gated holder assistant — perks, drops, private channel access, and holder-specific analytics.',
	},
	{
		id: 'dao',
		emoji: '🏛️',
		name: 'DAO Delegate',
		description:
			'Reads governance proposals, summarizes sentiment, and votes on behalf of delegators within a mandate.',
	},
	{
		id: 'portfolio',
		emoji: '💼',
		name: 'Portfolio Manager',
		description:
			'Tracks wallet positions across chains, alerts on drawdown and risk, and rebalances on schedule.',
	},
	{
		id: 'defi',
		emoji: '📈',
		name: 'DeFi Trading Agent',
		description:
			'Automated DeFi yield optimization, liquidity management, and token swaps across protocols.',
	},
	{
		id: 'support',
		emoji: '🎧',
		name: 'Avatar Support Agent',
		description:
			'Face-of-the-brand support — tickets, FAQ, and multi-language help with a consistent embodied persona.',
	},
	{
		id: 'code',
		emoji: '🔍',
		name: 'Code Review Agent',
		description:
			'Automated code analysis, security auditing, gas optimization, and best-practice enforcement.',
	},
	{
		id: 'data',
		emoji: '📊',
		name: 'Data Analysis Agent',
		description:
			'On-chain and off-chain data analysis, reporting, visualization, and pattern recognition.',
	},
	{
		id: 'content',
		emoji: '✍️',
		name: 'Content Creator',
		description:
			'AI content generation for social posts, documentation, technical writing, and marketing copy.',
	},
	{
		id: 'research',
		emoji: '🔬',
		name: 'Research Assistant',
		description: 'Deep research on protocols, tokens, governance proposals, and market trends.',
	},
];

const SERVICE_TYPES = ['A2A', 'MCP', 'OASF', 'x402', 'web', 'custom'];

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

const esc = (s) =>
	String(s ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
	);
const shortAddr = (a) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '');

/**
 * True if `url` is already a content-addressed or durable public URL that
 * doesn't need to be fetched and re-pinned before referencing in a
 * registration JSON. Avoids wasted uploads for avatars users created
 * earlier (or default avatars shipped on the same domain).
 */
const _isStableUrl = (url) => {
	if (!url || typeof url !== 'string') return false;
	const u = url.trim();
	return (
		u.startsWith('ipfs://') ||
		u.startsWith('ar://') ||
		u.startsWith('https://') ||
		u.startsWith('http://') ||
		u.startsWith('/') // same-origin public asset (e.g. /avatars/cz.glb)
	);
};

// ───────────────────────────────────────────────────────────────────────────
// RegisterUI
// ───────────────────────────────────────────────────────────────────────────

export class RegisterUI {
	/**
	 * @param {HTMLElement} containerEl
	 * @param {(result: { agentId: number, txHash: string, chainId: number }) => void} [onRegistered]
	 * @param {{ initial?: { name?: string, description?: string, imageUrl?: string, glbUrl?: string } }} [opts]
	 */
	constructor(containerEl, onRegistered, opts = {}) {
		this.container = containerEl;
		this.onRegistered = onRegistered || (() => {});
		this.mode = opts.mode === 'page' ? 'page' : 'modal';

		// Wallet state
		this.wallet = null; // { address, chainId }

		// Selected chain for reads + writes. Initialized to BSC Testnet; if the
		// wallet is already on a different supported chain, we'll adopt that.
		this.selectedChainId = DEFAULT_CHAIN_ID;

		// Tab state
		this.activeTab = 'create';

		const initial = opts.initial || {};

		// Wizard state — pre-populate from the user's current avatar/session so
		// the on-chain JSON points to the GLB they just uploaded/created.
		// `avatarSource` drives Step 3 behaviour:
		//   'current' → use `glbUrl` pre-filled from the live SPA viewer
		//   'saved'   → pick one from the signed-in user's saved avatars
		//   'upload'  → user drops a new .glb in the wizard
		//   'skip'    → deploy as a metadata-only agent (no 3D body)
		this.wizardStep = 1;
		this.form = {
			name: initial.name || '',
			description: initial.description || '',
			imageUrl: initial.imageUrl || '',
			glbUrl: initial.glbUrl || '',
			glbFile: null,
			savedAvatar: null, // { id, name, url, thumbnailUrl }
			avatarSource: initial.glbUrl ? 'current' : 'upload',
			services: [], // [{ name, type, endpoint }]
			apiToken: '', // optional Pinata JWT
		};

		// Cache of signed-in user's backend agent id (if any) — linked after deploy
		this._backendAgentId = null;
		this._signedIn = false;
		this._savedAvatars = null; // loaded lazily when user switches source to 'saved'

		this._build();
		this._bind();
		this._fetchBackendAgent(); // fire & forget
	}

	// -----------------------------------------------------------------------
	// Top-level DOM
	// -----------------------------------------------------------------------

	_build() {
		const pageMode = this.mode === 'page';
		this.el = document.createElement('div');
		this.el.className = 'erc8004-register' + (pageMode ? ' erc8004-register--page' : '');
		const closeBtn = pageMode
			? ''
			: `<button class="erc8004-btn erc8004-btn--close" type="button" title="Close">✕</button>`;
		this.el.innerHTML = `
			<div class="erc8004-card erc8004-card--wide">
				<div class="erc8004-header">
					<div class="erc8004-controls">
						<select class="erc8004-chain-select" title="Target chain"></select>
						<button class="erc8004-btn erc8004-btn--wallet" type="button">
							${isPrivyConfigured() ? 'Connect Wallet' : 'Connect MetaMask'}
						</button>
						${closeBtn}
					</div>
				</div>

				<div class="erc8004-mainnet-banner" data-role="mainnet-banner" style="display:none"></div>

				<nav class="erc8004-tabs" role="tablist">
					<button class="erc8004-tab erc8004-tab--active" data-tab="create">Create Agent</button>
					<button class="erc8004-tab" data-tab="my">My Agents</button>
					<button class="erc8004-tab" data-tab="search">Search</button>
					<button class="erc8004-tab" data-tab="templates">Templates</button>
					<button class="erc8004-tab" data-tab="batch">Batch</button>
					<button class="erc8004-tab" data-tab="history">History</button>
				</nav>

				<div class="erc8004-tab-body" data-role="tab-body"></div>
			</div>
		`;
		this.container.appendChild(this.el);

		this._populateChainSelect();
		this._renderActiveTab();
		this._refreshMainnetBanner();
	}

	_refreshMainnetBanner() {
		const banner = this.el.querySelector('[data-role="mainnet-banner"]');
		if (!banner) return;
		const meta = CHAIN_META[this.selectedChainId];
		if (meta && !meta.testnet) {
			banner.style.display = '';
			banner.innerHTML = `⚠️ <strong>Mainnet Mode</strong> — Transactions use real ${esc(
				meta.currency.symbol,
			)}. Test on a testnet first.`;
		} else {
			banner.style.display = 'none';
			banner.innerHTML = '';
		}
	}

	_bind() {
		this.el
			.querySelector('.erc8004-btn--wallet')
			.addEventListener('click', () => this._connectWallet());
		const closeBtn = this.el.querySelector('.erc8004-btn--close');
		if (closeBtn) closeBtn.addEventListener('click', () => this.destroy());

		this.el.querySelector('.erc8004-chain-select').addEventListener('change', async (e) => {
			const newChain = Number(e.target.value);
			this.selectedChainId = newChain;
			// If wallet connected and on the wrong chain, try to switch
			if (this.wallet && this.wallet.chainId !== newChain && window.ethereum) {
				try {
					await switchChain(newChain);
					this.wallet.chainId = newChain;
					this._refreshWalletButton();
				} catch (err) {
					this._toast('Chain switch rejected: ' + err.message, true);
				}
			}
			this._renderActiveTab();
			this._refreshMainnetBanner();
		});

		this.el.querySelectorAll('.erc8004-tab').forEach((btn) => {
			btn.addEventListener('click', () => this._setTab(btn.dataset.tab));
		});
	}

	destroy() {
		this.el.remove();
	}

	// -----------------------------------------------------------------------
	// Wallet & chain
	// -----------------------------------------------------------------------

	async _connectWallet() {
		try {
			const { address, chainId } = await connectWallet();
			this.wallet = { address, chainId: Number(chainId) };

			// Adopt wallet's chain if supported; otherwise keep selected and offer switch
			if (REGISTRY_DEPLOYMENTS[this.wallet.chainId]) {
				this.selectedChainId = this.wallet.chainId;
				const sel = this.el.querySelector('.erc8004-chain-select');
				if (sel) sel.value = String(this.selectedChainId);
			}

			this._refreshWalletButton();
			this._renderActiveTab();
			this._refreshMainnetBanner();
		} catch (err) {
			this._toast('Wallet: ' + err.message, true);
		}
	}

	_refreshWalletButton() {
		const btn = this.el.querySelector('.erc8004-btn--wallet');
		if (!this.wallet) {
			btn.textContent = isPrivyConfigured() ? 'Connect Wallet' : 'Connect MetaMask';
			btn.classList.remove('erc8004-btn--connected');
			return;
		}
		btn.textContent = shortAddr(this.wallet.address);
		btn.classList.add('erc8004-btn--connected');
	}

	_populateChainSelect() {
		const sel = this.el.querySelector('.erc8004-chain-select');
		const ids = supportedChainIds();
		// Testnets first (default-friendly), then mainnets
		const testnets = ids.filter((id) => CHAIN_META[id].testnet);
		const mainnets = ids.filter((id) => !CHAIN_META[id].testnet);
		const groupT = document.createElement('optgroup');
		groupT.label = 'Testnets';
		const groupM = document.createElement('optgroup');
		groupM.label = 'Mainnets';
		for (const id of testnets) {
			const opt = document.createElement('option');
			opt.value = String(id);
			opt.textContent = CHAIN_META[id].name;
			groupT.appendChild(opt);
		}
		for (const id of mainnets) {
			const opt = document.createElement('option');
			opt.value = String(id);
			opt.textContent = CHAIN_META[id].name;
			groupM.appendChild(opt);
		}
		sel.appendChild(groupT);
		sel.appendChild(groupM);
		sel.value = String(this.selectedChainId);
	}

	async _refreshStats() {
		const el = (k) => this.el.querySelector(`[data-stat="${k}"]`);
		try {
			const [total, version] = await Promise.all([
				getTotalSupply(this.selectedChainId).catch(() => null),
				getRegistryVersion(this.selectedChainId).catch(() => null),
			]);
			const totalEl = el('total');
			const versionEl = el('version');
			if (total !== null && totalEl) totalEl.textContent = String(total);
			if (version && versionEl) versionEl.textContent = version;
		} catch {
			/* swallow; stats are cosmetic */
		}
	}

	// -----------------------------------------------------------------------
	// Backend agent link (optional)
	// -----------------------------------------------------------------------

	async _fetchBackendAgent() {
		try {
			const res = await fetch('/api/agents/me', { credentials: 'include' });
			if (!res.ok) return;
			this._signedIn = true;
			const { agent } = await res.json();
			if (agent && agent.id) this._backendAgentId = agent.id;
			// If Step 3 is already rendered (signed-in detection raced with UI),
			// re-render so the "Use a saved avatar" option appears.
			if (this.wizardStep === 3 && this.activeTab === 'create') this._renderActiveTab();
		} catch {
			/* anon user or endpoint unavailable — fine */
		}
	}

	/**
	 * Lazily fetch the signed-in user's saved avatars for the Step 3 picker.
	 * Returns [] on any failure (anonymous, endpoint down, etc) so the UI can
	 * silently fall back to the upload/skip options.
	 */
	async _loadSavedAvatars() {
		if (this._savedAvatars) return this._savedAvatars;
		try {
			const res = await fetch('/api/avatars?limit=50', { credentials: 'include' });
			if (!res.ok) {
				this._savedAvatars = [];
				return this._savedAvatars;
			}
			const payload = await res.json();
			const rows = payload.avatars || payload.data || [];
			this._savedAvatars = rows.map((r) => ({
				id: r.id,
				name: r.name || 'Untitled',
				modelUrl: r.model_url || null, // null for private — resolved on select
				thumbnailUrl: r.thumbnail_url || null,
				visibility: r.visibility,
			}));
		} catch {
			this._savedAvatars = [];
		}
		return this._savedAvatars;
	}

	/**
	 * Resolve a saved avatar's download URL. Public/unlisted expose `model_url`
	 * directly; private avatars require a per-object signed-URL fetch.
	 */
	async _resolveSavedAvatarUrl(avatar) {
		if (avatar.modelUrl) return avatar.modelUrl;
		const res = await fetch(`/api/avatars/${encodeURIComponent(avatar.id)}`, {
			credentials: 'include',
		});
		if (!res.ok) throw new Error(`avatar fetch failed (${res.status})`);
		const { avatar: detail } = await res.json();
		return detail?.url || null;
	}

	async _linkAgentToAccount({ agentId, chainId, txHash }) {
		if (!this._backendAgentId || !this.wallet) return;
		try {
			await fetch(`/api/agents/${encodeURIComponent(this._backendAgentId)}/wallet`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					wallet_address: this.wallet.address,
					chain_id: chainId,
					erc8004_agent_id: agentId,
					tx_hash: txHash,
				}),
			});
		} catch (err) {
			console.warn('[erc8004] Failed to link on-chain agentId to account:', err.message);
		}
	}

	// -----------------------------------------------------------------------
	// Tabs
	// -----------------------------------------------------------------------

	_setTab(tab) {
		this.activeTab = tab;
		this.el.querySelectorAll('.erc8004-tab').forEach((btn) => {
			btn.classList.toggle('erc8004-tab--active', btn.dataset.tab === tab);
		});
		this._renderActiveTab();
	}

	_renderActiveTab() {
		const body = this.el.querySelector('[data-role="tab-body"]');
		body.innerHTML = '';
		switch (this.activeTab) {
			case 'create':
				this._renderCreate(body);
				break;
			case 'my':
				this._renderMyAgents(body);
				break;
			case 'search':
				this._renderSearch(body);
				break;
			case 'templates':
				this._renderTemplates(body);
				break;
			case 'batch':
				this._renderBatch(body);
				break;
			case 'history':
				this._renderHistory(body);
				break;
		}
	}

	_renderBatch(body) {
		renderBatchTab(body, {
			getWallet: () => this.wallet,
			getChainId: () => this.selectedChainId,
			toast: (msg, err) => this._toast(msg, err),
		});
	}

	// -----------------------------------------------------------------------
	// Tab: Create Agent (4-step wizard)
	// -----------------------------------------------------------------------

	_renderCreate(body) {
		const step = this.wizardStep;
		body.innerHTML = `
			<div class="erc8004-wizard">
				<ol class="erc8004-steps">
					${[1, 2, 3, 4]
						.map(
							(n) => `
						<li class="erc8004-step ${n === step ? 'erc8004-step--active' : ''} ${n < step ? 'erc8004-step--done' : ''}">
							<span class="erc8004-step-num">${n}</span>
							<span class="erc8004-step-lbl">${['Identity', 'Services', 'Configuration', 'Deploy'][n - 1]}</span>
						</li>
					`,
						)
						.join('')}
				</ol>
				<div class="erc8004-wizard-body" data-role="wizard-body"></div>
			</div>
		`;
		const wbody = body.querySelector('[data-role="wizard-body"]');
		if (step === 1) this._renderStepIdentity(wbody);
		else if (step === 2) this._renderStepServices(wbody);
		else if (step === 3) this._renderStepConfig(wbody);
		else this._renderStepDeploy(wbody);
	}

	_renderStepIdentity(body) {
		body.innerHTML = `
			<h3 class="erc8004-h3">Agent Identity</h3>
			<p class="erc8004-p">Define your agent's core identity — name, description, and image.</p>

			<label class="erc8004-label">Agent Name <span class="erc8004-req">*</span>
				<input class="erc8004-input" name="name" maxlength="100" placeholder="e.g., DeFi Yield Optimizer" value="${esc(this.form.name)}" />
			</label>
			<p class="erc8004-hint">A short, memorable name (max 100 chars)</p>

			<label class="erc8004-label">Description <span class="erc8004-req">*</span>
				<textarea class="erc8004-input erc8004-textarea" name="description" maxlength="1000" rows="4" placeholder="Describe what your agent does, capabilities, pricing…">${esc(this.form.description)}</textarea>
			</label>
			<p class="erc8004-hint">Clear description (max 1000 chars)</p>

			<label class="erc8004-label">Image URL
				<input class="erc8004-input" name="imageUrl" placeholder="https://example.com/avatar.png or ipfs://…" value="${esc(this.form.imageUrl)}" />
			</label>
			<p class="erc8004-hint">Avatar or logo for your agent NFT</p>

			<div class="erc8004-wizard-nav">
				<span></span>
				<button class="erc8004-btn erc8004-btn--primary" data-role="next">Next: Services →</button>
			</div>
		`;
		body.querySelector('[name="name"]').addEventListener(
			'input',
			(e) => (this.form.name = e.target.value),
		);
		body.querySelector('[name="description"]').addEventListener(
			'input',
			(e) => (this.form.description = e.target.value),
		);
		body.querySelector('[name="imageUrl"]').addEventListener(
			'input',
			(e) => (this.form.imageUrl = e.target.value),
		);
		body.querySelector('[data-role="next"]').addEventListener('click', () => {
			if (!this.form.name.trim() || !this.form.description.trim()) {
				this._toast('Name and description are required.', true);
				return;
			}
			this.wizardStep = 2;
			this._renderActiveTab();
		});
	}

	_renderStepServices(body) {
		body.innerHTML = `
			<h3 class="erc8004-h3">Service Endpoints</h3>
			<p class="erc8004-p">Add one or more endpoints so other agents can discover and talk to yours. Optional but recommended.</p>

			<div class="erc8004-services" data-role="list"></div>

			<button class="erc8004-btn erc8004-btn--ghost" data-role="add">+ Add endpoint</button>

			<div class="erc8004-wizard-nav">
				<button class="erc8004-btn" data-role="back">← Back</button>
				<button class="erc8004-btn erc8004-btn--primary" data-role="next">Next: Configuration →</button>
			</div>
		`;
		const list = body.querySelector('[data-role="list"]');
		const renderList = () => {
			list.innerHTML = this.form.services
				.map(
					(svc, i) => `
				<div class="erc8004-svc-row" data-i="${i}">
					<select class="erc8004-input erc8004-input--tight" data-field="type">
						${SERVICE_TYPES.map((t) => `<option value="${t}" ${svc.type === t ? 'selected' : ''}>${t}</option>`).join('')}
					</select>
					<input class="erc8004-input" data-field="name" placeholder="Name" value="${esc(svc.name)}" />
					<input class="erc8004-input" data-field="endpoint" placeholder="https://… or ipfs://…" value="${esc(svc.endpoint)}" />
					<button class="erc8004-btn erc8004-btn--ghost erc8004-btn--x" data-role="rm" title="Remove">✕</button>
				</div>
			`,
				)
				.join('');

			list.querySelectorAll('.erc8004-svc-row').forEach((row) => {
				const i = Number(row.dataset.i);
				row.querySelectorAll('[data-field]').forEach((input) => {
					input.addEventListener('input', (e) => {
						this.form.services[i][e.target.dataset.field] = e.target.value;
					});
				});
				row.querySelector('[data-role="rm"]').addEventListener('click', () => {
					this.form.services.splice(i, 1);
					renderList();
				});
			});
		};
		renderList();

		body.querySelector('[data-role="add"]').addEventListener('click', () => {
			this.form.services.push({ type: 'A2A', name: '', endpoint: '' });
			renderList();
		});
		body.querySelector('[data-role="back"]').addEventListener('click', () => {
			this.wizardStep = 1;
			this._renderActiveTab();
		});
		body.querySelector('[data-role="next"]').addEventListener('click', () => {
			this.wizardStep = 3;
			this._renderActiveTab();
		});
	}

	_renderStepConfig(body) {
		const hasCurrent = !!this.form.glbUrl;
		const canPickSaved = this._signedIn;
		const src = this.form.avatarSource;
		const radio = (value, label, hint, disabled = false) => `
			<label class="erc8004-avatar-source ${src === value ? 'erc8004-avatar-source--active' : ''} ${disabled ? 'erc8004-avatar-source--disabled' : ''}">
				<input type="radio" name="avatarSource" value="${value}" ${src === value ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
				<div>
					<div class="erc8004-avatar-source-title">${label}</div>
					<div class="erc8004-avatar-source-hint">${hint}</div>
				</div>
			</label>
		`;

		body.innerHTML = `
			<h3 class="erc8004-h3">3D Avatar</h3>
			<p class="erc8004-p">Attach a GLB so any 3D-aware client can render your agent's body, or deploy as metadata-only. ERC-8004 doesn't require a 3D avatar — a 2D <code>image</code> works too.</p>

			<div class="erc8004-avatar-sources" data-role="sources">
				${hasCurrent ? radio('current', 'Use current avatar', `From your active session — <code>${esc(this.form.glbUrl)}</code>`) : ''}
				${radio('saved', 'Use a saved avatar', canPickSaved ? 'Pick one from your account library.' : 'Sign in to pick from your saved avatars.', !canPickSaved)}
				${radio('upload', 'Upload a new GLB', 'Drop or browse a .glb / .gltf file from your machine.')}
				${radio('skip', 'Skip — no 3D body', 'Deploy as a metadata-only agent. You can attach an avatar later via setAgentURI.')}
			</div>

			<div class="erc8004-avatar-panel" data-role="panel"></div>

			<label class="erc8004-label">IPFS Pinning Token (optional)
				<input class="erc8004-input" type="password" name="apiToken" placeholder="Pinata JWT — leave blank to use built-in R2 storage" value="${esc(this.form.apiToken)}" />
			</label>
			<p class="erc8004-hint">Without a token, uploads go through our backend (R2). Paste a Pinata JWT to pin directly to IPFS.</p>

			<div class="erc8004-wizard-nav">
				<button class="erc8004-btn" data-role="back">← Back</button>
				<button class="erc8004-btn erc8004-btn--primary" data-role="next">Next: Deploy →</button>
			</div>
		`;

		const panel = body.querySelector('[data-role="panel"]');

		const renderPanel = () => {
			const s = this.form.avatarSource;
			if (s === 'current') {
				panel.innerHTML = `
					<div class="erc8004-avatar-summary">
						<span class="erc8004-avatar-summary-badge">✓</span>
						<div>
							<div>Using your current avatar.</div>
							<div class="erc8004-hint"><code>${esc(this.form.glbUrl)}</code></div>
						</div>
					</div>
				`;
			} else if (s === 'saved') {
				panel.innerHTML = `<div class="erc8004-saved-grid" data-role="grid"><div class="erc8004-muted">Loading your avatars…</div></div>`;
				this._loadSavedAvatars().then((list) => {
					const grid = panel.querySelector('[data-role="grid"]');
					if (!grid) return;
					if (!list.length) {
						grid.innerHTML = `<div class="erc8004-muted">No saved avatars yet. <a href="/create" class="erc8004-link">Create one</a> or choose another option above.</div>`;
						return;
					}
					grid.innerHTML = list
						.map(
							(a) => `
								<button type="button" class="erc8004-saved-card ${this.form.savedAvatar?.id === a.id ? 'erc8004-saved-card--active' : ''}" data-id="${esc(a.id)}">
									${a.thumbnailUrl ? `<img src="${esc(a.thumbnailUrl)}" alt="" loading="lazy" />` : `<div class="erc8004-saved-card-ph">GLB</div>`}
									<div class="erc8004-saved-card-name">${esc(a.name)}</div>
								</button>
							`,
						)
						.join('');
					grid.querySelectorAll('.erc8004-saved-card').forEach((btn) => {
						btn.addEventListener('click', () => {
							const id = btn.dataset.id;
							const picked = list.find((x) => x.id === id);
							this.form.savedAvatar = picked || null;
							renderPanel();
						});
					});
				});
			} else if (s === 'upload') {
				panel.innerHTML = `
					<div class="erc8004-file-drop" data-role="drop">
						<input type="file" accept=".glb,.gltf" class="erc8004-file-input" />
						<span class="erc8004-file-text">${this.form.glbFile ? esc(this.form.glbFile.name) : 'Drop .glb file or click to browse'}</span>
					</div>
				`;
				const drop = panel.querySelector('[data-role="drop"]');
				const input = drop.querySelector('.erc8004-file-input');
				const label = drop.querySelector('.erc8004-file-text');
				const setFile = (f) => {
					if (!f) return;
					if (!/\.(glb|gltf)$/i.test(f.name)) {
						this._toast('Must be a .glb or .gltf file', true);
						return;
					}
					this.form.glbFile = f;
					label.textContent = f.name;
				};
				input.addEventListener('change', (e) => setFile(e.target.files[0]));
				drop.addEventListener('dragover', (e) => {
					e.preventDefault();
					drop.classList.add('erc8004-file-drop--active');
				});
				drop.addEventListener('dragleave', () =>
					drop.classList.remove('erc8004-file-drop--active'),
				);
				drop.addEventListener('drop', (e) => {
					e.preventDefault();
					drop.classList.remove('erc8004-file-drop--active');
					setFile(e.dataTransfer.files[0]);
				});
			} else if (s === 'skip') {
				panel.innerHTML = `
					<div class="erc8004-avatar-summary">
						<span class="erc8004-avatar-summary-badge erc8004-avatar-summary-badge--muted">∅</span>
						<div>
							<div>Deploying as a metadata-only agent.</div>
							<div class="erc8004-hint">Your registration JSON will include <code>image</code> (from Step 1) and services but no GLB. You can attach an avatar later from My Agents → Edit.</div>
						</div>
					</div>
				`;
			}
		};

		renderPanel();

		body.querySelectorAll('input[name="avatarSource"]').forEach((r) => {
			r.addEventListener('change', (e) => {
				this.form.avatarSource = e.target.value;
				this._renderActiveTab(); // re-render to update active-class + panel
			});
		});

		body.querySelector('[name="apiToken"]').addEventListener(
			'input',
			(e) => (this.form.apiToken = e.target.value),
		);
		body.querySelector('[data-role="back"]').addEventListener('click', () => {
			this.wizardStep = 2;
			this._renderActiveTab();
		});
		body.querySelector('[data-role="next"]').addEventListener('click', () => {
			// Validate the selected source before advancing.
			const s = this.form.avatarSource;
			if (s === 'saved' && !this.form.savedAvatar) {
				this._toast('Pick one of your saved avatars, or choose another option.', true);
				return;
			}
			if (s === 'upload' && !this.form.glbFile) {
				this._toast('Drop a .glb file, or choose another option.', true);
				return;
			}
			this.wizardStep = 4;
			this._renderActiveTab();
		});
	}

	_renderStepDeploy(body) {
		const meta = CHAIN_META[this.selectedChainId];
		const walletOk = !!this.wallet;
		const chainOk = walletOk && this.wallet.chainId === this.selectedChainId;
		body.innerHTML = `
			<h3 class="erc8004-h3">Review &amp; Deploy</h3>
			<p class="erc8004-p">Your agent will be minted as an ERC-721 NFT on <b>${esc(meta.name)}</b>. This is the only step that costs gas.</p>

			<dl class="erc8004-summary">
				<dt>Name</dt>        <dd>${esc(this.form.name)}</dd>
				<dt>Description</dt> <dd>${esc(this.form.description)}</dd>
				${this.form.imageUrl ? `<dt>Image</dt>      <dd>${esc(this.form.imageUrl)}</dd>` : ''}
				<dt>Avatar</dt>      <dd>${this._avatarSummary()}</dd>
				<dt>Services</dt>    <dd>${this.form.services.length ? this.form.services.map((s) => `${esc(s.type)}: ${esc(s.endpoint || '—')}`).join('<br>') : '<span class="erc8004-muted">none</span>'}</dd>
				<dt>Chain</dt>       <dd>${esc(meta.name)} (chainId ${this.selectedChainId})</dd>
				<dt>Registry</dt>    <dd><code>${esc(REGISTRY_DEPLOYMENTS[this.selectedChainId].identityRegistry)}</code></dd>
			</dl>

			${!walletOk ? `<div class="erc8004-alert">Connect a wallet before deploying.</div>` : ''}
			${walletOk && !chainOk ? `<div class="erc8004-alert">Your wallet is on chain ${this.wallet.chainId}. <button class="erc8004-link" data-role="switch">Switch to ${esc(meta.name)}</button></div>` : ''}

			<details class="erc8004-accordion">
				<summary class="erc8004-accordion-head">📦 Export Options</summary>
				<div class="erc8004-accordion-body">
					<div class="erc8004-export-grid">
						<button type="button" class="erc8004-export-opt" data-role="exp-json">
							<div class="erc8004-export-emoji">📄</div>
							<div class="erc8004-export-title">Export JSON</div>
							<div class="erc8004-export-sub">Raw registration config</div>
						</button>
						<button type="button" class="erc8004-export-opt" data-role="exp-cast">
							<div class="erc8004-export-emoji">⌨️</div>
							<div class="erc8004-export-title">cast / forge</div>
							<div class="erc8004-export-sub">Copy shell command</div>
						</button>
						<button type="button" class="erc8004-export-opt" data-role="exp-viem">
							<div class="erc8004-export-emoji">🧩</div>
							<div class="erc8004-export-title">viem snippet</div>
							<div class="erc8004-export-sub">Copy TS snippet</div>
						</button>
						<button type="button" class="erc8004-export-opt" data-role="exp-curl">
							<div class="erc8004-export-emoji">🌐</div>
							<div class="erc8004-export-title">curl</div>
							<div class="erc8004-export-sub">Graph query stub</div>
						</button>
					</div>
				</div>
			</details>

			<div class="erc8004-log" data-role="log"></div>

			<div class="erc8004-result" data-role="result" style="display:none">
				<h4 class="erc8004-h4">✓ Agent registered</h4>
				<dl class="erc8004-result-dl">
					<dt>Agent ID</dt> <dd data-role="res-id"></dd>
					<dt>Metadata</dt> <dd data-role="res-uri"></dd>
					<dt>Tx Hash</dt>  <dd data-role="res-tx"></dd>
				</dl>
				<div class="erc8004-row">
					<button class="erc8004-btn" data-role="view-3d">View in 3D</button>
					<a class="erc8004-btn" data-role="view-explorer" target="_blank" rel="noopener">View on explorer ↗</a>
				</div>
			</div>

			<div class="erc8004-wizard-nav">
				<button class="erc8004-btn" data-role="back">← Back</button>
				<button class="erc8004-btn erc8004-btn--primary" data-role="deploy" ${walletOk ? '' : 'disabled'}>🚀 Register Agent On-Chain</button>
			</div>
		`;
		body.querySelector('[data-role="back"]').addEventListener('click', () => {
			this.wizardStep = 3;
			this._renderActiveTab();
		});

		const switchBtn = body.querySelector('[data-role="switch"]');
		if (switchBtn) {
			switchBtn.addEventListener('click', async () => {
				try {
					await switchChain(this.selectedChainId);
					if (this.wallet) this.wallet.chainId = this.selectedChainId;
					this._renderActiveTab();
				} catch (err) {
					this._toast('Switch failed: ' + err.message, true);
				}
			});
		}

		body.querySelector('[data-role="deploy"]').addEventListener('click', () =>
			this._doDeploy(body),
		);

		this._wireExportOptions(body);
	}

	/**
	 * One-line summary of the user's Step 3 avatar choice, shown on the Deploy
	 * review screen.
	 */
	_avatarSummary() {
		const s = this.form.avatarSource;
		if (s === 'current' && this.form.glbUrl) {
			return `Current session avatar — <code>${esc(this.form.glbUrl)}</code>`;
		}
		if (s === 'saved' && this.form.savedAvatar) {
			return `Saved: ${esc(this.form.savedAvatar.name)}`;
		}
		if (s === 'upload' && this.form.glbFile) {
			return `Uploaded: ${esc(this.form.glbFile.name)} (${(this.form.glbFile.size / 1024).toFixed(1)} KB)`;
		}
		if (s === 'skip') return `<span class="erc8004-muted">None — metadata-only</span>`;
		return `<span class="erc8004-muted">Not selected</span>`;
	}

	_wireExportOptions(body) {
		const buildJSON = () => {
			const identityAddr = REGISTRY_DEPLOYMENTS[this.selectedChainId].identityRegistry;
			// Preview JSON should match the shape `_doRegister` actually mints so
			// users export what they're about to deploy.
			const extra = (this.form.services || [])
				.filter((s) => s.endpoint?.trim())
				.map((s) => ({
					name: s.name || s.type,
					type: s.type,
					endpoint: s.endpoint,
					version: '1.0',
				}));
			// Best-effort glbUrl preview: 'current' uses pre-fill; 'saved' uses the
			// picked avatar's known URL; 'upload' is unknown until pin; 'skip' is
			// omitted entirely.
			let glbUrl = null;
			if (this.form.avatarSource === 'current') glbUrl = this.form.glbUrl || null;
			else if (this.form.avatarSource === 'saved')
				glbUrl = this.form.savedAvatar?.modelUrl || null;
			else if (this.form.avatarSource === 'upload' && this.form.glbFile)
				glbUrl = `<pending-upload:${this.form.glbFile.name}>`;

			return buildRegistrationJSON({
				name: this.form.name,
				description: this.form.description,
				imageUrl: this.form.imageUrl || glbUrl || '',
				glbUrl: glbUrl || undefined,
				agentId: 'PENDING',
				chainId: this.selectedChainId,
				registryAddr: identityAddr,
				services: extra,
			});
		};
		const download = (text, filename, mime = 'application/json') => {
			const blob = new Blob([text], { type: mime });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = filename;
			a.click();
			setTimeout(() => URL.revokeObjectURL(url), 2000);
		};
		const copy = async (text) => {
			try {
				await navigator.clipboard.writeText(text);
				this._toast('Copied to clipboard');
			} catch {
				this._toast('Copy failed', true);
			}
		};

		const jsonBtn = body.querySelector('[data-role="exp-json"]');
		const castBtn = body.querySelector('[data-role="exp-cast"]');
		const viemBtn = body.querySelector('[data-role="exp-viem"]');
		const curlBtn = body.querySelector('[data-role="exp-curl"]');
		if (!jsonBtn) return;

		jsonBtn.addEventListener('click', () => {
			download(JSON.stringify(buildJSON(), null, 2), 'agent-registration.json');
			this._toast('JSON downloaded');
		});
		castBtn.addEventListener('click', () => {
			const identityAddr = REGISTRY_DEPLOYMENTS[this.selectedChainId].identityRegistry;
			const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(buildJSON()))));
			const uri = `data:application/json;base64,${b64}`;
			const cmd = `cast send ${identityAddr} "register(string)" '${uri}' \\\n  --rpc-url ${CHAIN_META[this.selectedChainId].rpcUrl} \\\n  --private-key $PRIVATE_KEY`;
			copy(cmd);
		});
		viemBtn.addEventListener('click', () => {
			const identityAddr = REGISTRY_DEPLOYMENTS[this.selectedChainId].identityRegistry;
			const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(buildJSON()))));
			const uri = `data:application/json;base64,${b64}`;
			const snippet = `import { createWalletClient, http, parseAbi } from 'viem';\nimport { privateKeyToAccount } from 'viem/accounts';\n\nconst account = privateKeyToAccount(process.env.PRIVATE_KEY);\nconst client = createWalletClient({ account, transport: http('${CHAIN_META[this.selectedChainId].rpcUrl}') });\n\nawait client.writeContract({\n  address: '${identityAddr}',\n  abi: parseAbi(['function register(string) external returns (uint256)']),\n  functionName: 'register',\n  args: ['${uri}'],\n});`;
			copy(snippet);
		});
		curlBtn.addEventListener('click', () => {
			const identityAddr = REGISTRY_DEPLOYMENTS[this.selectedChainId].identityRegistry;
			const query = `query { agents(where: { registry: "${identityAddr.toLowerCase()}" }, first: 5) { id agentId agentURI owner } }`;
			const cmd = `curl -X POST https://api.thegraph.com/subgraphs/name/erc-8004/registry \\\n  -H 'content-type: application/json' \\\n  -d '${JSON.stringify({ query })}'`;
			copy(cmd);
		});
	}

	async _doDeploy(body) {
		const log = body.querySelector('[data-role="log"]');
		const say = (msg, err = false) => {
			const line = document.createElement('div');
			line.className = 'erc8004-log-line' + (err ? ' erc8004-log-error' : '');
			line.textContent = msg;
			log.appendChild(line);
			log.scrollTop = log.scrollHeight;
		};
		const deployBtn = body.querySelector('[data-role="deploy"]');
		deployBtn.disabled = true;

		try {
			// Ensure we're on the target chain
			if (this.wallet && this.wallet.chainId !== this.selectedChainId) {
				say(`Switching to ${CHAIN_META[this.selectedChainId].name}…`);
				await switchChain(this.selectedChainId);
				this.wallet.chainId = this.selectedChainId;
			}

			const result = await this._doRegister(say);

			body.querySelector('[data-role="result"]').style.display = '';
			body.querySelector('[data-role="res-id"]').textContent = String(result.agentId);
			body.querySelector('[data-role="res-uri"]').textContent = result.registrationUrl;
			body.querySelector('[data-role="res-tx"]').textContent = result.txHash;

			const view3D = body.querySelector('[data-role="view-3d"]');
			view3D.addEventListener('click', () => {
				// Jump to the viewer with this model loaded
				window.location.hash = `agent=${result.agentId}`;
				window.location.reload();
			});
			body.querySelector('[data-role="view-explorer"]').href = txExplorerUrl(
				this.selectedChainId,
				result.txHash,
			);

			this.onRegistered({ ...result, chainId: this.selectedChainId });
			await this._linkAgentToAccount({
				agentId: result.agentId,
				chainId: this.selectedChainId,
				txHash: result.txHash,
			});
			this._refreshStats();
		} catch (err) {
			say('Registration failed: ' + (err.shortMessage || err.message || String(err)), true);
			deployBtn.disabled = false;
		}
	}

	/**
	 * Unified deploy flow covering all avatar scenarios:
	 *   - 'upload'  → pin the dropped File
	 *   - 'current' → reference existing stable URL (ipfs/https) without re-pinning,
	 *                 or fetch+pin if it's a blob:/data: URL
	 *   - 'saved'   → same bypass logic for stable saved-avatar URLs
	 *   - 'skip'    → no GLB, metadata-only agent
	 *
	 * If a GLB is present but no 2D `imageUrl` was supplied, auto-render a
	 * 512×512 PNG thumbnail from the GLB and pin it so ERC-721 marketplaces
	 * have a valid value for the `image` field.
	 */
	async _doRegister(say) {
		const {
			name,
			description,
			imageUrl: userImageUrl,
			services,
			apiToken,
			avatarSource,
		} = this.form;
		const extraServices = services
			.filter((s) => s.endpoint.trim())
			.map((s) => ({
				name: s.name || s.type,
				type: s.type,
				endpoint: s.endpoint,
				version: '1.0',
			}));

		// ── 1. Resolve GLB source: File to pin, or stable URL to reference as-is.
		let glbFile = null;
		let glbUrl = null;

		if (avatarSource === 'upload') {
			glbFile = this.form.glbFile;
		} else if (avatarSource === 'current' && this.form.glbUrl) {
			if (_isStableUrl(this.form.glbUrl)) {
				glbUrl = this.form.glbUrl;
				say(`Reusing existing avatar URL (no re-upload): ${glbUrl}`);
			} else {
				glbFile = await this._fetchUrlAsFile(this.form.glbUrl, say, 'current avatar');
			}
		} else if (avatarSource === 'saved' && this.form.savedAvatar) {
			try {
				say(`Resolving saved avatar: ${this.form.savedAvatar.name}…`);
				const url = await this._resolveSavedAvatarUrl(this.form.savedAvatar);
				if (!url) throw new Error('no download URL');
				if (_isStableUrl(url)) {
					glbUrl = url;
					say(`Reusing saved avatar URL (no re-upload): ${url}`);
				} else {
					glbFile = await this._fetchUrlAsFile(url, say, this.form.savedAvatar.name);
				}
			} catch (err) {
				say(
					`Could not load saved avatar (${err.message}) — deploying metadata-only.`,
					true,
				);
			}
		}

		// ── 2. Pin GLB if we have a File (stable URLs skip this step).
		if (glbFile && !glbUrl) {
			say('Uploading 3D model…');
			glbUrl = await pinFile(glbFile, apiToken || undefined);
			say(`Model uploaded: ${glbUrl}`);
		}

		// ── 3. Auto-generate 2D thumbnail when user has a GLB but no 2D poster.
		//       Spec `image` must be PNG/JPG for ERC-721 marketplace compat.
		let imageUrl = userImageUrl || '';
		if (!imageUrl && glbFile) {
			try {
				say('Rendering 2D thumbnail from GLB…');
				const thumb = await glbFileToThumbnail(glbFile);
				imageUrl = await pinFile(thumb, apiToken || undefined);
				say(`Thumbnail uploaded: ${imageUrl}`);
			} catch (err) {
				say(`Thumbnail render failed (${err.message}) — continuing without 2D image.`);
			}
		}

		// ── 4. Mint on-chain. Seed URI carries useful metadata in the Registered
		//       event in case setAgentURI fails later.
		say('Connecting wallet…');
		const { signer, chainId } = await connectWallet();
		const registry = getIdentityRegistry(chainId, signer);

		say('Registering agent on-chain…');
		const seedURI = glbUrl || imageUrl || '';
		const tx = seedURI
			? await registry['register(string)'](seedURI)
			: await registry['register()']();
		say(`Transaction submitted: ${tx.hash}`);
		const receipt = await tx.wait();

		const registeredEvent = receipt.logs
			.map((l) => {
				try {
					return registry.interface.parseLog(l);
				} catch {
					return null;
				}
			})
			.find((e) => e && e.name === 'Registered');
		if (!registeredEvent) throw new Error('Registered event not found in receipt');
		const agentId = Number(registeredEvent.args.agentId);
		say(`Agent minted! agentId = ${agentId}`);

		// ── 5. Build + pin the full registration JSON, then setAgentURI.
		const registrationJSON = buildRegistrationJSON({
			name,
			description,
			imageUrl,
			glbUrl: glbUrl || undefined,
			agentId,
			chainId,
			registryAddr: REGISTRY_DEPLOYMENTS[chainId].identityRegistry,
			services: extraServices,
		});

		say('Uploading registration metadata…');
		const jsonBlob = new Blob([JSON.stringify(registrationJSON, null, 2)], {
			type: 'application/json',
		});
		const registrationUrl = await pinFile(jsonBlob, apiToken || undefined);
		say(`Registration metadata: ${registrationUrl}`);

		say('Updating agentURI on-chain…');
		const updateTx = await registry.setAgentURI(agentId, registrationUrl);
		await updateTx.wait();

		return { agentId, registrationUrl, txHash: tx.hash };
	}

	/**
	 * Fetch a URL and wrap the response as a File for the pinning pipeline.
	 * Returns null on failure (after logging via `say`).
	 */
	async _fetchUrlAsFile(url, say, label = 'avatar') {
		try {
			say(`Fetching ${label}…`);
			const res = await fetch(url, { credentials: 'include' });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const blob = await res.blob();
			const fileName = url.split('/').pop()?.split('?')[0] || 'avatar.glb';
			return new File([blob], fileName, { type: blob.type || 'model/gltf-binary' });
		} catch (err) {
			say(`Could not fetch ${label} (${err.message}) — continuing without GLB.`, true);
			return null;
		}
	}

	// -----------------------------------------------------------------------
	// Tab: My Agents
	// -----------------------------------------------------------------------

	_renderMyAgents(body) {
		body.innerHTML = `
			<h3 class="erc8004-h3">Your Registered Agents</h3>
			${
				this.wallet
					? `<p class="erc8004-p">Connected as <code>${esc(this.wallet.address)}</code> on <b>${esc(CHAIN_META[this.selectedChainId]?.name || '?')}</b>.</p>`
					: `<p class="erc8004-p erc8004-muted">Connect a wallet to see agents you own.</p>`
			}
			<div data-role="list"></div>
		`;
		if (!this.wallet) return;

		const list = body.querySelector('[data-role="list"]');
		list.innerHTML = `<div class="erc8004-muted">Scanning…</div>`;

		listAgentsByOwner({
			chainId: this.selectedChainId,
			owner: this.wallet.address,
			ethProvider: window.ethereum,
		})
			.then(async (res) => {
				if (res.count === 0) {
					list.innerHTML = `<div class="erc8004-muted">No agents registered on this chain yet. <a class="erc8004-link" data-role="goto-create">Create one →</a></div>`;
					list.querySelector('[data-role="goto-create"]').addEventListener(
						'click',
						(e) => {
							e.preventDefault();
							this._setTab('create');
						},
					);
					return;
				}
				if (res.ids.length === 0 && res.partial) {
					const explorer = addressExplorerUrl(this.selectedChainId, this.wallet.address);
					list.innerHTML = `
					<div class="erc8004-muted">
						You own ${res.count} agent(s) but details could not be loaded from recent blocks.
						<a href="${esc(explorer)}" target="_blank" rel="noopener" class="erc8004-link">Check explorer ↗</a>
					</div>`;
					return;
				}
				list.innerHTML = '';
				for (const id of res.ids) {
					const card = document.createElement('div');
					card.className = 'erc8004-agent-card';
					card.innerHTML = `<div class="erc8004-muted">Loading #${id}…</div>`;
					list.appendChild(card);
					this._fillAgentCard(card, id, { withQR: true, withEdit: true });
				}
				if (res.partial) {
					const note = document.createElement('div');
					note.className = 'erc8004-muted';
					note.textContent = `Showing ${res.ids.length} of ${res.count} agents — older mints may be outside the scanned block window.`;
					list.appendChild(note);
				}
			})
			.catch((err) => {
				list.innerHTML = `<div class="erc8004-log-error">Query failed: ${esc(err.message)}</div>`;
			});
	}

	async _fillAgentCard(card, agentId, opts = {}) {
		try {
			const { uri, owner } = await getAgentOnchain({
				chainId: this.selectedChainId,
				agentId,
				ethProvider: window.ethereum,
			});
			const meta = uri ? await fetchAgentMetadata(uri) : { ok: false, error: 'no uri' };
			const registryAddr = REGISTRY_DEPLOYMENTS[this.selectedChainId].identityRegistry;
			const tokenUrl = tokenExplorerUrl(this.selectedChainId, registryAddr, agentId);

			const name = meta.ok ? meta.data.name || `Agent #${agentId}` : `Agent #${agentId}`;
			const description = meta.ok ? meta.data.description : '';
			const image = meta.ok ? meta.data.image : '';
			const hasX402 = meta.ok && (meta.data.x402Support || meta.data.x402);
			card._meta = meta.ok ? meta.data : null;
			card._owner = owner;

			const isOwner =
				this.wallet && owner && this.wallet.address.toLowerCase() === owner.toLowerCase();
			const showLink = isOwner && this._signedIn && this._backendAgentId;

			card.innerHTML = `
				<div class="erc8004-agent-card-inner">
					<div class="erc8004-agent-card-img">
						${image ? `<img src="${esc(resolveGateway(image))}" alt="" loading="lazy" />` : `<div class="erc8004-agent-card-ph">🤖</div>`}
					</div>
					<div class="erc8004-agent-card-body">
						<div class="erc8004-agent-card-head">
							<strong>${esc(name)}</strong>
							<span class="erc8004-tag">#${agentId}</span>
							${hasX402 ? `<span class="erc8004-tag erc8004-tag--x402">x402 💳</span>` : ''}
							${isOwner ? `<span class="erc8004-tag erc8004-tag--owner">You own this</span>` : ''}
						</div>
						${description ? `<p class="erc8004-p erc8004-clip">${esc(description)}</p>` : ''}
						<div class="erc8004-agent-card-actions">
							${tokenUrl ? `<a class="erc8004-link" href="${esc(tokenUrl)}" target="_blank" rel="noopener">Details ↗</a>` : ''}
							<a class="erc8004-link" href="#agent=${agentId}">Open in viewer</a>
							${opts.withQR && tokenUrl ? `<button type="button" class="erc8004-link" data-role="qr">QR</button>` : ''}
							${opts.withEdit ? `<button type="button" class="erc8004-link" data-role="edit">Edit on-chain ✏️</button>` : ''}
							${showLink ? `<button type="button" class="erc8004-link" data-role="link">Link to my account 🔗</button>` : ''}
						</div>
					</div>
				</div>
			`;

			if (opts.withQR && tokenUrl) {
				const qrBtn = card.querySelector('[data-role="qr"]');
				if (qrBtn)
					qrBtn.addEventListener('click', () =>
						this._openQRModal({ agentId, url: tokenUrl }),
					);
			}
			if (opts.withEdit) {
				const editBtn = card.querySelector('[data-role="edit"]');
				if (editBtn)
					editBtn.addEventListener('click', () =>
						this._openEditModal({ agentId, currentMeta: card._meta, card }),
					);
			}
			const linkBtn = card.querySelector('[data-role="link"]');
			if (linkBtn)
				linkBtn.addEventListener('click', async () => {
					linkBtn.disabled = true;
					linkBtn.textContent = 'Linking…';
					try {
						await this._linkAgentToAccount({
							agentId: Number(agentId),
							chainId: this.selectedChainId,
						});
						linkBtn.textContent = 'Linked ✓';
						this._toast('Agent linked to your account');
					} catch (err) {
						linkBtn.disabled = false;
						linkBtn.textContent = 'Link to my account 🔗';
						this._toast(`Link failed: ${err.message}`, true);
					}
				});
		} catch (err) {
			card.innerHTML = `<div class="erc8004-log-error">Agent #${agentId}: ${esc(err.message)}</div>`;
		}
	}

	_openQRModal({ agentId, url }) {
		const chainName = CHAIN_META[this.selectedChainId]?.name || '?';
		const modal = document.createElement('div');
		modal.className = 'erc8004-modal';
		modal.innerHTML = `
			<div class="erc8004-modal-card">
				<div class="erc8004-modal-head">
					<div class="erc8004-h4" style="margin:0">Agent QR Code</div>
					<button class="erc8004-btn erc8004-btn--x" data-role="close" title="Close">✕</button>
				</div>
				<p class="erc8004-muted erc8004-small">Agent #${String(agentId)} on ${esc(chainName)}</p>
				<div class="erc8004-qr-canvas-wrap" data-role="canvas"></div>
				<p class="erc8004-muted erc8004-small erc8004-qr-url">${esc(url)}</p>
				<div class="erc8004-row" style="justify-content:center">
					<button class="erc8004-btn erc8004-btn--primary" data-role="download">Download PNG</button>
					<button class="erc8004-btn" data-role="copy">Copy Link</button>
				</div>
			</div>
		`;
		this.el.appendChild(modal);

		let canvas;
		try {
			canvas = renderQRToCanvas(url, { scale: 6, margin: 2 });
			modal.querySelector('[data-role="canvas"]').appendChild(canvas);
		} catch (err) {
			modal.querySelector('[data-role="canvas"]').innerHTML =
				`<div class="erc8004-log-error">QR error: ${esc(err.message)}</div>`;
		}

		const close = () => modal.remove();
		modal.addEventListener('click', (e) => {
			if (e.target === modal) close();
		});
		modal.querySelector('[data-role="close"]').addEventListener('click', close);
		modal.querySelector('[data-role="download"]').addEventListener('click', () => {
			if (!canvas) return;
			const a = document.createElement('a');
			a.href = canvas.toDataURL('image/png');
			a.download = `agent-${String(agentId)}-qr.png`;
			a.click();
		});
		modal.querySelector('[data-role="copy"]').addEventListener('click', async () => {
			try {
				await navigator.clipboard.writeText(url);
				this._toast('Link copied!');
			} catch {
				this._toast('Copy failed', true);
			}
		});
	}

	/**
	 * Edit modal for an existing on-chain agent. Lets the owner update
	 * name / description / 2D image / 3D body, then pins a new registration
	 * JSON and calls setAgentURI(agentId, newURI). Preserves unrelated
	 * fields from the current metadata (services, registrations, trust, etc.).
	 */
	_openEditModal({ agentId, currentMeta, card }) {
		const meta = currentMeta || {};
		const modal = document.createElement('div');
		modal.className = 'erc8004-modal';
		modal.innerHTML = `
			<div class="erc8004-modal-card">
				<div class="erc8004-modal-head">
					<div class="erc8004-h4" style="margin:0">Edit Agent #${String(agentId)}</div>
					<button class="erc8004-btn erc8004-btn--x" data-role="close" title="Close">✕</button>
				</div>
				<p class="erc8004-muted erc8004-small">Updates are written on-chain via <code>setAgentURI()</code>. Re-pins the registration JSON and points <code>agentURI</code> at the new CID.</p>

				<label class="erc8004-label">Name
					<input class="erc8004-input" name="name" value="${esc(meta.name || '')}" />
				</label>
				<label class="erc8004-label">Description
					<textarea class="erc8004-input" name="description" rows="3">${esc(meta.description || '')}</textarea>
				</label>
				<label class="erc8004-label">Image URL (2D — for marketplaces)
					<input class="erc8004-input" name="imageUrl" value="${esc(meta.image || '')}" placeholder="https://… or ipfs://…" />
				</label>
				<label class="erc8004-label">3D Avatar (GLB) — optional, replaces existing body
					<input type="file" accept=".glb,.gltf" class="erc8004-file-input" name="glb" />
				</label>
				<label class="erc8004-label">Pinata JWT (optional)
					<input class="erc8004-input" name="apiToken" placeholder="leave blank for R2 backend" />
				</label>

				<div class="erc8004-log" data-role="log"></div>

				<div class="erc8004-row" style="justify-content:flex-end">
					<button class="erc8004-btn" data-role="cancel">Cancel</button>
					<button class="erc8004-btn erc8004-btn--primary" data-role="save">Save on-chain</button>
				</div>
			</div>
		`;
		this.el.appendChild(modal);

		const close = () => modal.remove();
		modal.addEventListener('click', (e) => {
			if (e.target === modal) close();
		});
		modal.querySelector('[data-role="close"]').addEventListener('click', close);
		modal.querySelector('[data-role="cancel"]').addEventListener('click', close);

		modal.querySelector('[data-role="save"]').addEventListener('click', async () => {
			const saveBtn = modal.querySelector('[data-role="save"]');
			const log = modal.querySelector('[data-role="log"]');
			const say = (msg, err = false) => {
				const line = document.createElement('div');
				line.className = 'erc8004-log-line' + (err ? ' erc8004-log-error' : '');
				line.textContent = msg;
				log.appendChild(line);
				log.scrollTop = log.scrollHeight;
			};
			saveBtn.disabled = true;
			try {
				const name = modal.querySelector('[name="name"]').value.trim();
				const description = modal.querySelector('[name="description"]').value.trim();
				const imageUrlInput = modal.querySelector('[name="imageUrl"]').value.trim();
				const apiToken = modal.querySelector('[name="apiToken"]').value.trim() || undefined;
				const fileInput = modal.querySelector('[name="glb"]');
				const glbFile = fileInput.files?.[0] || null;

				await this._doUpdateAgent({
					agentId,
					name,
					description,
					imageUrl: imageUrlInput,
					glbFile,
					apiToken,
					currentMeta: meta,
					say,
				});

				this._toast('Agent updated on-chain');
				close();
				if (card) this._fillAgentCard(card, agentId, { withQR: true, withEdit: true });
			} catch (err) {
				say('Update failed: ' + (err.shortMessage || err.message || String(err)), true);
				saveBtn.disabled = false;
			}
		});
	}

	/**
	 * Build + pin a new registration JSON and call setAgentURI on-chain.
	 * Preserves `services`, `registrations`, `supportedTrust`, `x402Support`
	 * from the existing metadata; only touches the fields the user edited.
	 */
	async _doUpdateAgent({
		agentId,
		name,
		description,
		imageUrl,
		glbFile,
		apiToken,
		currentMeta,
		say,
	}) {
		// Find the current GLB URL from the metadata (it lives in services[name=avatar]).
		const existingGlbUrl = (currentMeta?.services || []).find(
			(s) => s?.name === 'avatar' && s?.endpoint,
		)?.endpoint;

		let glbUrl = existingGlbUrl || undefined;
		let newImageUrl = imageUrl;

		// If user uploaded a new GLB, pin it and re-render thumbnail when image is empty.
		if (glbFile) {
			say('Uploading new 3D model…');
			glbUrl = await pinFile(glbFile, apiToken);
			say(`Model uploaded: ${glbUrl}`);
			if (!newImageUrl) {
				try {
					say('Rendering 2D thumbnail from new GLB…');
					const thumb = await glbFileToThumbnail(glbFile);
					newImageUrl = await pinFile(thumb, apiToken);
					say(`Thumbnail uploaded: ${newImageUrl}`);
				} catch (err) {
					say(`Thumbnail render failed (${err.message}) — keeping existing image.`);
					newImageUrl = currentMeta?.image || '';
				}
			}
		}

		// Preserve non-avatar services (user-added A2A/MCP/etc.) and other fields.
		const preservedServices = (currentMeta?.services || []).filter(
			(s) => s?.name !== 'avatar' && s?.name !== '3D',
		);

		say('Connecting wallet…');
		const { signer, chainId } = await connectWallet();
		const registry = getIdentityRegistry(chainId, signer);
		const registryAddr = REGISTRY_DEPLOYMENTS[chainId].identityRegistry;

		const registrationJSON = buildRegistrationJSON({
			name,
			description,
			imageUrl: newImageUrl || '',
			glbUrl,
			agentId,
			chainId,
			registryAddr,
			services: preservedServices,
			x402Support: !!(currentMeta?.x402Support || currentMeta?.x402),
		});

		say('Uploading new registration metadata…');
		const jsonBlob = new Blob([JSON.stringify(registrationJSON, null, 2)], {
			type: 'application/json',
		});
		const newUri = await pinFile(jsonBlob, apiToken);
		say(`New metadata: ${newUri}`);

		say('Calling setAgentURI on-chain…');
		const tx = await registry.setAgentURI(agentId, newUri);
		say(`Transaction submitted: ${tx.hash}`);
		await tx.wait();
		say('Agent URI updated ✓');
	}

	// -----------------------------------------------------------------------
	// Tab: Search
	// -----------------------------------------------------------------------

	_renderSearch(body) {
		if (!this._searchFilter) this._searchFilter = 'all';
		body.innerHTML = `
			<h3 class="erc8004-h3">Agent Search</h3>
			<p class="erc8004-p">Find a registered agent by its on-chain ID on <b>${esc(CHAIN_META[this.selectedChainId]?.name)}</b>.</p>
			<div class="erc8004-row">
				<input class="erc8004-input" name="q" placeholder="Agent ID (e.g., 6443)" />
				<button class="erc8004-btn erc8004-btn--primary" data-role="go">Search</button>
			</div>
			<div class="erc8004-filter-chips" data-role="chips">
				<button class="erc8004-chip ${this._searchFilter === 'all' ? 'erc8004-chip--active' : ''}" data-filter="all">All</button>
				<button class="erc8004-chip ${this._searchFilter === 'A2A' ? 'erc8004-chip--active' : ''}" data-filter="A2A">A2A</button>
				<button class="erc8004-chip ${this._searchFilter === 'MCP' ? 'erc8004-chip--active' : ''}" data-filter="MCP">MCP</button>
				<button class="erc8004-chip ${this._searchFilter === 'OASF' ? 'erc8004-chip--active' : ''}" data-filter="OASF">OASF</button>
				<button class="erc8004-chip ${this._searchFilter === 'x402' ? 'erc8004-chip--active' : ''}" data-filter="x402">x402 💳</button>
			</div>
			<div data-role="result" style="margin-top:14px"></div>
		`;
		const q = body.querySelector('[name="q"]');
		const out = body.querySelector('[data-role="result"]');

		body.querySelectorAll('[data-role="chips"] .erc8004-chip').forEach((chip) => {
			chip.addEventListener('click', () => {
				this._searchFilter = chip.dataset.filter;
				body.querySelectorAll('[data-role="chips"] .erc8004-chip').forEach((c) => {
					c.classList.toggle(
						'erc8004-chip--active',
						c.dataset.filter === this._searchFilter,
					);
				});
				this._applySearchFilter(out);
			});
		});

		const go = async () => {
			const id = q.value.trim();
			if (!/^\d+$/.test(id)) {
				out.innerHTML = `<div class="erc8004-log-error">Enter a numeric Agent ID.</div>`;
				return;
			}
			out.innerHTML = `<div class="erc8004-muted">Loading #${id}…</div>`;
			try {
				const card = document.createElement('div');
				card.className = 'erc8004-agent-card';
				out.innerHTML = '';
				out.appendChild(card);
				await this._fillAgentCard(card, BigInt(id), { withQR: true });
				this._applySearchFilter(out);
			} catch (err) {
				out.innerHTML = `<div class="erc8004-log-error">${esc(err.message)}</div>`;
			}
		};
		body.querySelector('[data-role="go"]').addEventListener('click', go);
		q.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') go();
		});
	}

	_applySearchFilter(out) {
		const filter = this._searchFilter || 'all';
		out.querySelectorAll('.erc8004-agent-card').forEach((card) => {
			if (filter === 'all') {
				card.style.display = '';
				return;
			}
			const meta = card._meta;
			if (!meta) {
				card.style.display = '';
				return;
			}
			const services = Array.isArray(meta.services) ? meta.services : [];
			const types = services.map((s) => String(s.type || s.name || '').toUpperCase());
			const hasX402 = !!meta.x402Support || !!meta.x402;
			let match = false;
			if (filter === 'x402') match = hasX402;
			else match = types.includes(filter.toUpperCase());
			card.style.display = match ? '' : 'none';
		});
	}

	// -----------------------------------------------------------------------
	// Tab: Templates
	// -----------------------------------------------------------------------

	_renderTemplates(body) {
		body.innerHTML = `
			<h3 class="erc8004-h3">Agent Templates</h3>
			<p class="erc8004-p">Pre-built configurations — one click to prefill the Create Agent wizard.</p>
			<div class="erc8004-template-grid">
				${TEMPLATES.map(
					(t) => `
					<button class="erc8004-template" data-id="${t.id}">
						<div class="erc8004-template-emoji">${t.emoji}</div>
						<div class="erc8004-template-name">${esc(t.name)}</div>
						<div class="erc8004-template-desc">${esc(t.description)}</div>
					</button>
				`,
				).join('')}
			</div>
		`;
		body.querySelectorAll('.erc8004-template').forEach((btn) => {
			btn.addEventListener('click', () => {
				const t = TEMPLATES.find((x) => x.id === btn.dataset.id);
				if (!t) return;
				this.form.name = t.name;
				this.form.description = t.description;
				this.wizardStep = 1;
				this._setTab('create');
			});
		});
	}

	// -----------------------------------------------------------------------
	// Tab: History
	// -----------------------------------------------------------------------

	_renderHistory(body) {
		body.innerHTML = `
			<h3 class="erc8004-h3">Transaction History</h3>
			<p class="erc8004-p">Recent <code>Registered</code> events on <b>${esc(CHAIN_META[this.selectedChainId]?.name)}</b>${this.wallet ? ` for <code>${esc(this.wallet.address)}</code>` : ''}.</p>
			<div data-role="list"></div>
		`;
		const list = body.querySelector('[data-role="list"]');
		list.innerHTML = `<div class="erc8004-muted">Loading…</div>`;

		listRegisteredEvents({
			chainId: this.selectedChainId,
			owner: this.wallet?.address,
			ethProvider: window.ethereum,
			limit: 50,
		})
			.then((events) => {
				if (events.length === 0) {
					list.innerHTML = `<div class="erc8004-muted">No events in the scanned window.</div>`;
					return;
				}
				list.innerHTML = events
					.map(
						(ev) => `
				<div class="erc8004-history-row">
					<div class="erc8004-history-main">
						<div><strong>Agent #${ev.agentId}</strong> <span class="erc8004-muted">by ${esc(shortAddr(ev.owner))}</span></div>
						<div class="erc8004-muted erc8004-small">Block ${ev.blockNumber} · <code>${esc(ev.agentURI).slice(0, 60)}${ev.agentURI.length > 60 ? '…' : ''}</code></div>
					</div>
					<a class="erc8004-link" href="${esc(txExplorerUrl(this.selectedChainId, ev.txHash))}" target="_blank" rel="noopener">tx ↗</a>
				</div>
			`,
					)
					.join('');
			})
			.catch((err) => {
				list.innerHTML = `<div class="erc8004-log-error">Failed to load: ${esc(err.message)}</div>`;
			});
	}

	// -----------------------------------------------------------------------
	// Toast
	// -----------------------------------------------------------------------

	_toast(msg, isError = false) {
		const t = document.createElement('div');
		t.className = 'erc8004-toast' + (isError ? ' erc8004-toast--error' : '');
		t.textContent = msg;
		this.el.appendChild(t);
		setTimeout(() => t.remove(), 4000);
	}
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

function resolveGateway(uri) {
	if (!uri) return '';
	if (uri.startsWith('ipfs://')) return 'https://ipfs.io/ipfs/' + uri.slice(7);
	if (uri.startsWith('ar://')) return 'https://arweave.net/' + uri.slice(5);
	return uri;
}
