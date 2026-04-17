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
		id: 'defi',
		emoji: '📈',
		name: 'DeFi Trading Agent',
		description:
			'Automated DeFi yield optimization, liquidity management, and token swaps across protocols.',
	},
	{
		id: 'support',
		emoji: '🎧',
		name: 'Customer Support Bot',
		description:
			'AI-powered support agent for handling tickets, FAQ queries, and multi-language communication.',
	},
	{
		id: 'code',
		emoji: '🔍',
		name: 'Code Review Agent',
		description:
			'Automated code analysis, security auditing, gas optimization, and best practice enforcement.',
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
			'AI content generation for social media, documentation, technical writing, and marketing.',
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

// ───────────────────────────────────────────────────────────────────────────
// RegisterUI
// ───────────────────────────────────────────────────────────────────────────

export class RegisterUI {
	/**
	 * @param {HTMLElement} containerEl
	 * @param {(result: { agentId: number, txHash: string, chainId: number }) => void} [onRegistered]
	 */
	constructor(containerEl, onRegistered) {
		this.container = containerEl;
		this.onRegistered = onRegistered || (() => {});

		// Wallet state
		this.wallet = null; // { address, chainId }

		// Selected chain for reads + writes. Initialized to BSC Testnet; if the
		// wallet is already on a different supported chain, we'll adopt that.
		this.selectedChainId = DEFAULT_CHAIN_ID;

		// Tab state
		this.activeTab = 'create';

		// Wizard state
		this.wizardStep = 1;
		this.form = {
			name: '',
			description: '',
			imageUrl: '',
			glbFile: null,
			services: [], // [{ name, type, endpoint }]
			apiToken: '', // optional Pinata JWT
		};

		// Cache of signed-in user's backend agent id (if any) — linked after deploy
		this._backendAgentId = null;

		this._build();
		this._bind();
		this._fetchBackendAgent(); // fire & forget
	}

	// -----------------------------------------------------------------------
	// Top-level DOM
	// -----------------------------------------------------------------------

	_build() {
		this.el = document.createElement('div');
		this.el.className = 'erc8004-register';
		this.el.innerHTML = `
			<div class="erc8004-shell">
				<header class="erc8004-hero">
					<div class="erc8004-hero-topbar">
						<div class="erc8004-brand">
							<span class="erc8004-brand-badge">8004</span>
							<span class="erc8004-brand-title"><b>ERC-8004</b> Agent Studio</span>
						</div>
						<div class="erc8004-controls">
							<select class="erc8004-chain-select" title="Target chain"></select>
							<button class="erc8004-btn erc8004-btn--wallet" type="button">
								${isPrivyConfigured() ? 'Connect Wallet' : 'Connect MetaMask'}
							</button>
							<button class="erc8004-btn erc8004-btn--close" type="button" title="Close">✕</button>
						</div>
					</div>
					<div class="erc8004-hero-body">
						<div class="erc8004-hero-badge"><span class="erc8004-hero-dot"></span>Live on 20+ EVM Chains</div>
						<h1 class="erc8004-hero-h1">Create <span class="erc8004-hero-accent">Trustless Agents</span><br>on Any Chain</h1>
						<p class="erc8004-hero-sub">Register AI agents on-chain with ERC-8004. Get a portable, censorship-resistant identity backed by an ERC-721 NFT — discoverable across the entire agent economy.</p>
						<div class="erc8004-stats">
							<div class="erc8004-stat"><div class="erc8004-stat-val" data-stat="total">—</div><div class="erc8004-stat-lbl">Agents Registered</div></div>
							<div class="erc8004-stat"><div class="erc8004-stat-val" data-stat="chains">${supportedChainIds().length}</div><div class="erc8004-stat-lbl">Chains Supported</div></div>
							<div class="erc8004-stat"><div class="erc8004-stat-val" data-stat="version">—</div><div class="erc8004-stat-lbl">Registry Version</div></div>
						</div>
					</div>
				</header>

				<div class="erc8004-mainnet-banner" data-role="mainnet-banner" style="display:none"></div>

				<div class="erc8004-card erc8004-card--wide">
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

				<footer class="erc8004-footer">
					<div class="erc8004-footer-links">
						<a href="https://eips.ethereum.org/EIPS/eip-8004" target="_blank" rel="noopener">ERC-8004 Spec</a>
						<a href="https://github.com/erc-8004/erc-8004-contracts" target="_blank" rel="noopener">Contracts</a>
						<a href="https://bnbchaintoolkit.com" target="_blank" rel="noopener">BNB Chain AI Toolkit</a>
						<a href="https://github.com/nirholas/3D" target="_blank" rel="noopener">GitHub</a>
					</div>
					<div class="erc8004-footer-cols">
						<div class="erc8004-footer-col">
							<div class="erc8004-footer-title">Learn</div>
							<a href="https://eips.ethereum.org/EIPS/eip-8004" target="_blank" rel="noopener">What is ERC-8004?</a>
							<a href="/features" target="_blank" rel="noopener">Getting Started</a>
							<a href="https://github.com/nirholas/3D" target="_blank" rel="noopener">FAQ</a>
						</div>
						<div class="erc8004-footer-col">
							<div class="erc8004-footer-title">Build</div>
							<a href="/features">Tutorials</a>
							<a href="https://github.com/nirholas/3D" target="_blank" rel="noopener">Examples</a>
							<a href="/features">Integration Guide</a>
						</div>
						<div class="erc8004-footer-col">
							<div class="erc8004-footer-title">Ecosystem</div>
							<a href="https://github.com/nirholas/3D" target="_blank" rel="noopener">Architecture</a>
							<a href="https://github.com/nirholas/3D" target="_blank" rel="noopener">MCP Server</a>
							<a href="https://github.com/nirholas/3D" target="_blank" rel="noopener">SDKs</a>
						</div>
					</div>
					<p class="erc8004-footer-credit">Built on <a href="https://eips.ethereum.org/EIPS/eip-8004" target="_blank" rel="noopener">ERC-8004</a></p>
				</footer>
			</div>
		`;
		this.container.appendChild(this.el);

		this._populateChainSelect();
		this._renderActiveTab();
		this._refreshStats();
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
		this.el
			.querySelector('.erc8004-btn--close')
			.addEventListener('click', () => this.destroy());

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
			this._refreshStats();
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
			this._refreshStats();
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
			if (total !== null) el('total').textContent = String(total);
			if (version) el('version').textContent = version;
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
			const { agent } = await res.json();
			if (agent && agent.id) this._backendAgentId = agent.id;
		} catch {
			/* anon user or endpoint unavailable — fine */
		}
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
		body.innerHTML = `
			<h3 class="erc8004-h3">Configuration</h3>
			<p class="erc8004-p">Optional: attach a 3D avatar (GLB) so anyone can render your agent in a browser. If provided, it becomes the agent's primary image.</p>

			<label class="erc8004-label">3D Avatar (GLB)
				<div class="erc8004-file-drop" data-role="drop">
					<input type="file" accept=".glb,.gltf" class="erc8004-file-input" />
					<span class="erc8004-file-text">${this.form.glbFile ? esc(this.form.glbFile.name) : 'Drop .glb file or click to browse'}</span>
				</div>
			</label>

			<label class="erc8004-label">IPFS Pinning Token (optional)
				<input class="erc8004-input" type="password" name="apiToken" placeholder="Pinata JWT — leave blank to use built-in R2 storage" value="${esc(this.form.apiToken)}" />
			</label>
			<p class="erc8004-hint">Without a token, uploads go through our backend (R2). Paste a Pinata JWT to pin directly to IPFS.</p>

			<div class="erc8004-wizard-nav">
				<button class="erc8004-btn" data-role="back">← Back</button>
				<button class="erc8004-btn erc8004-btn--primary" data-role="next">Next: Deploy →</button>
			</div>
		`;
		const drop = body.querySelector('[data-role="drop"]');
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

		body.querySelector('[name="apiToken"]').addEventListener(
			'input',
			(e) => (this.form.apiToken = e.target.value),
		);
		body.querySelector('[data-role="back"]').addEventListener('click', () => {
			this.wizardStep = 2;
			this._renderActiveTab();
		});
		body.querySelector('[data-role="next"]').addEventListener('click', () => {
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
				${this.form.glbFile ? `<dt>GLB File</dt>    <dd>${esc(this.form.glbFile.name)} (${(this.form.glbFile.size / 1024).toFixed(1)} KB)</dd>` : ''}
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

	_wireExportOptions(body) {
		const buildJSON = () => {
			const identityAddr = REGISTRY_DEPLOYMENTS[this.selectedChainId].identityRegistry;
			return {
				type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
				name: this.form.name,
				description: this.form.description,
				image: this.form.imageUrl || '',
				services: (this.form.services || []).filter((s) => s.endpoint?.trim()),
				active: true,
				registrations: [
					{
						agentId: 'PENDING',
						agentRegistry: `eip155:${this.selectedChainId}:${identityAddr}`,
					},
				],
			};
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
	 * Wraps agent-registry.registerAgent() with GLB-optional behavior: if the
	 * user uploaded a GLB we use the existing flow; otherwise we go straight
	 * to metadata-JSON pinning + on-chain mint.
	 */
	async _doRegister(say) {
		const { name, description, imageUrl, glbFile, services, apiToken } = this.form;

		// GLB path — use the existing registerAgent flow (pins GLB, mints, updates URI).
		// We extend it by appending user-supplied services to the registration JSON.
		if (glbFile) {
			return await registerAgent({
				glbFile,
				name,
				description,
				apiToken: apiToken || undefined,
				onStatus: say,
				services: services
					.filter((s) => s.endpoint.trim())
					.map((s) => ({
						name: s.name || s.type,
						type: s.type,
						endpoint: s.endpoint,
						version: '1.0',
					})),
			});
		}

		// URI-only path: mirror agent-registry.registerAgent() but without the GLB upload.
		say('Connecting wallet…');
		const { signer, chainId } = await connectWallet();
		const registry = getIdentityRegistry(chainId, signer);

		say('Registering agent on-chain…');
		const seedURI = imageUrl || '';
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

		const registrationJSON = buildRegistrationJSON({
			name,
			description,
			imageUrl: imageUrl || '',
			agentId,
			chainId,
			registryAddr: REGISTRY_DEPLOYMENTS[chainId].identityRegistry,
			services: services
				.filter((s) => s.endpoint.trim())
				.map((s) => ({
					name: s.name || s.type,
					type: s.type,
					endpoint: s.endpoint,
					version: '1.0',
				})),
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
					this._fillAgentCard(card, id, { withQR: true });
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
						</div>
						${description ? `<p class="erc8004-p erc8004-clip">${esc(description)}</p>` : ''}
						<div class="erc8004-agent-card-actions">
							${tokenUrl ? `<a class="erc8004-link" href="${esc(tokenUrl)}" target="_blank" rel="noopener">Details ↗</a>` : ''}
							<a class="erc8004-link" href="#agent=${agentId}">Open in viewer</a>
							${opts.withQR && tokenUrl ? `<button type="button" class="erc8004-link" data-role="qr">QR</button>` : ''}
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
