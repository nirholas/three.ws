/**
 * DeployButton — minimal "Deploy on-chain" UI for an agent's home page.
 *
 * Flow (matches the canonical 3-step pipeline used by /deploy):
 *   1. POST /api/agents/register-prep    — server pins a manifest to IPFS,
 *                                          returns { cid, metadataURI, prepId }.
 *      The prepId is cached in localStorage so retries reuse the same prep
 *      record (idempotency: never pin twice on a flaky network).
 *   2. registry.register(metadataURI)    — user signs the on-chain mint.
 *   3. POST /api/agents/register-confirm — server verifies the receipt against
 *                                          the prep record and upserts
 *                                          agent_identities.{chain_id,
 *                                          erc8004_agent_id, erc8004_registry,
 *                                          registration_cid}.
 *
 * Distinct from register-ui.js (the full multi-tab wizard) — this is the
 * one-click chip surfaced on the agent's profile page for the owner.
 */

import { ensureWallet, getIdentityRegistry } from './agent-registry.js';
import { REGISTRY_DEPLOYMENTS } from './abi.js';
import {
	CHAIN_META,
	DEFAULT_CHAIN_ID,
	supportedChainIdsGrouped,
	switchChain,
	addressExplorerUrl,
} from './chain-meta.js';
import { runSolanaDeploy, solanaTxExplorerUrl, detectSolanaWallet } from './solana-deploy.js';

// Sentinel chain selections for non-EVM targets. The chain dropdown stores
// these as option values; _chainId may be a number (EVM chainId) or one of
// these strings.
const SOLANA_MAINNET = 'solana-mainnet';
const SOLANA_DEVNET = 'solana-devnet';
const SOLANA_LABELS = {
	[SOLANA_MAINNET]: 'Solana',
	[SOLANA_DEVNET]: 'Solana Devnet',
};
function _isSolana(id) {
	return id === SOLANA_MAINNET || id === SOLANA_DEVNET;
}
function _solanaNetwork(id) {
	return id === SOLANA_DEVNET ? 'devnet' : 'mainnet';
}

// Faucet links for testnets where users commonly run out of gas.
const FAUCETS = {
	84532: 'https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet',
	11155111: 'https://sepoliafaucet.com/',
	421614: 'https://www.alchemy.com/faucets/arbitrum-sepolia',
	11155420: 'https://app.optimism.io/faucet',
	80002: 'https://faucet.polygon.technology/',
	43113: 'https://faucet.avax.network/',
	97: 'https://testnet.bnbchain.org/faucet-smart',
};

const WALLET_INSTALL_URL = 'https://metamask.io/download/';

function _hasWallet() {
	return typeof window !== 'undefined' && !!window.ethereum;
}

// localStorage key for caching the active prep record across retries.
function _prepCacheKey(agentId) {
	return `3dagent:deploy-prep:${agentId}`;
}

export class DeployButton {
	/**
	 * @param {object} opts
	 * @param {object} opts.agent              Agent record. Required: id, name.
	 *                                          Optional but recommended for a
	 *                                          richer manifest: avatarId,
	 *                                          description, skills.
	 * @param {HTMLElement} opts.container     Where to mount.
	 * @param {number} [opts.preferredChainId] Defaults to DEFAULT_CHAIN_ID.
	 */
	constructor({ agent, container, preferredChainId = DEFAULT_CHAIN_ID }) {
		this._agent = agent;
		this._container = container;
		this._chainId = preferredChainId;
		this._root = null;
	}

	mount() {
		this._root = document.createElement('div');
		this._root.className = 'deploy-button-root';
		this._container.appendChild(this._root);
		this._render();
	}

	unmount() {
		if (this._root) {
			this._root.remove();
			this._root = null;
		}
	}

	_render() {
		if (!this._root) return;
		const agent = this._agent;

		if (agent.chainId && agent.txHash) {
			this._renderSuccessChip(agent.chainId, agent.txHash, agent.contractAddress);
		} else if (!_isSolana(this._chainId) && !REGISTRY_DEPLOYMENTS[this._chainId]) {
			this._renderDisabled('No registry on this chain');
		} else {
			this._renderDeployButton();
		}
	}

	_renderDeployButton() {
		const { mainnets, testnets } = supportedChainIdsGrouped();
		const evmOptionsFor = (ids) =>
			ids
				.map(
					(id) =>
						`<option value="${id}"${id === this._chainId ? ' selected' : ''}>${_esc(
							CHAIN_META[id]?.name || `Chain ${id}`,
						)}</option>`,
				)
				.join('');
		const solanaOptionFor = (id) =>
			`<option value="${id}"${id === this._chainId ? ' selected' : ''}>${_esc(SOLANA_LABELS[id])}</option>`;

		this._root.innerHTML = `
			<div class="deploy-chain-row">
				<select class="deploy-chain-select" title="Choose chain to deploy to" aria-label="Target chain">
					<optgroup label="Mainnets">${evmOptionsFor(mainnets)}</optgroup>
					<optgroup label="Testnets">${evmOptionsFor(testnets)}</optgroup>
					<optgroup label="Solana (beta)">${solanaOptionFor(SOLANA_MAINNET)}${solanaOptionFor(SOLANA_DEVNET)}</optgroup>
				</select>
				<button class="deploy-btn" title="Deploy this agent as an ERC-8004 token on-chain">
					&#x2B22; Deploy on-chain
				</button>
			</div>
		`;

		const select = this._root.querySelector('.deploy-chain-select');
		select.addEventListener('change', async (ev) => {
			const raw = ev.target.value;
			const newChainId = _isSolana(raw) ? raw : Number(raw);
			this._chainId = newChainId;
			if (!_isSolana(newChainId) && _hasWallet()) {
				select.disabled = true;
				try {
					await switchChain(newChainId);
				} catch (err) {
					if (!_isUserRejection(err)) {
						console.warn('[deploy-button] switchChain failed:', err?.message);
					}
				} finally {
					select.disabled = false;
				}
			}
		});

		this._root
			.querySelector('.deploy-btn')
			.addEventListener('click', () => this._startDeploy());
	}

	_renderDisabled(reason) {
		this._root.innerHTML = `
			<button class="deploy-btn deploy-btn--disabled" disabled title="${_esc(reason)}">
				&#x2B22; Deploy on-chain
			</button>
			<span class="deploy-tooltip">${_esc(reason)}</span>
		`;
	}

	_renderSuccessChip(chainId, txHash, contractAddress) {
		let chainName, explorerUrl;
		if (_isSolana(chainId)) {
			const network = _solanaNetwork(chainId);
			chainName = SOLANA_LABELS[chainId];
			explorerUrl = solanaTxExplorerUrl(network, txHash);
		} else {
			const meta = CHAIN_META[chainId];
			chainName = meta ? meta.name : `Chain ${chainId}`;
			// Use the registry contract URL on the explorer — it's the most
			// universally available link, since some chains' explorers don't
			// surface tx hashes for arbitrary contracts.
			explorerUrl = contractAddress ? addressExplorerUrl(chainId, contractAddress) : '#';
		}
		this._root.innerHTML = `
			<a class="deploy-chip deploy-chip--success" href="${_esc(explorerUrl)}" target="_blank" rel="noopener noreferrer"
			   aria-label="View this agent's registry on the ${_esc(chainName)} block explorer">
				&#x2B22; On-chain on ${_esc(chainName)} &middot; view on explorer
			</a>
		`;
	}

	_renderProgress(steps, activeIdx) {
		const labels = steps.map((s, i) => {
			const cls = i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending';
			return `<span class="progress-step progress-step--${cls}">${_esc(s)}</span>`;
		});
		const liveText = activeIdx < steps.length ? `${steps[activeIdx]}…` : 'Done';
		this._root.innerHTML = `
			<div class="deploy-progress" role="status" aria-live="polite" aria-label="Deployment progress">
				${labels.join('<span class="progress-sep" aria-hidden="true">&#x2192;</span>')}
				<span class="visually-hidden">${_esc(liveText)}</span>
			</div>
		`;
	}

	_renderError(msg, action) {
		const actionHtml = action
			? `<button class="deploy-action-btn">${_esc(action.label)}</button>`
			: '<button class="deploy-action-btn deploy-action-btn--reset">Try again</button>';
		this._root.innerHTML = `
			<div class="deploy-error" role="alert">
				<span class="deploy-error-msg">${_esc(msg)}</span>
				${actionHtml}
			</div>
		`;
		const btn = this._root.querySelector('.deploy-action-btn');
		if (action) {
			btn.addEventListener('click', action.handler);
		} else {
			btn.addEventListener('click', () => this._renderDeployButton());
		}
	}

	// ─── Deploy state machine ──────────────────────────────────────────────

	async _startSolanaDeploy() {
		if (!detectSolanaWallet()) {
			this._renderError('No Solana wallet detected. Install Phantom to continue.', {
				label: 'Install Phantom',
				handler: () => window.open('https://phantom.app', '_blank', 'noopener'),
			});
			return;
		}

		const agent = this._agent;
		if (!agent?.id) {
			this._renderError('This agent is missing an ID — cannot deploy.');
			return;
		}

		const network = _solanaNetwork(this._chainId);
		const steps = ['Connecting wallet', 'Sign tx', 'Confirming on-chain', 'Saving'];
		this._renderProgress(steps, 0);

		let result;
		try {
			this._renderProgress(steps, 1);
			result = await runSolanaDeploy({ agent, network });
			this._renderProgress(steps, 3);
		} catch (err) {
			if (_isUserRejection(err)) return this._renderDeployButton();
			if (err.code === 'forbidden') {
				this._renderError(
					'Your Solana wallet is not linked to this account. Sign in with your Solana wallet first.',
					{
						label: 'Open wallet sign-in',
						handler: () => (window.location.href = '/login.html'),
					},
				);
				return;
			}
			this._renderError(`Solana deploy failed: ${_humanError(err)}`);
			return;
		}

		this._agent.chainId = this._chainId;
		this._agent.txHash = result.txSignature;
		this._agent.contractAddress = result.assetPubkey;
		this._renderSuccessChip(this._chainId, result.txSignature, result.assetPubkey);
	}

	async _startDeploy() {
		if (_isSolana(this._chainId)) return this._startSolanaDeploy();

		if (!_hasWallet()) {
			this._renderError('No wallet detected. Install one to deploy on-chain.', {
				label: 'Install MetaMask',
				handler: () => window.open(WALLET_INSTALL_URL, '_blank', 'noopener'),
			});
			return;
		}

		const agent = this._agent;
		if (!agent?.id) {
			this._renderError('This agent is missing an ID — cannot deploy.');
			return;
		}
		if (!agent.avatarId && !agent.avatar_id) {
			this._renderError('This agent has no avatar attached. Add a body before deploying.', {
				label: 'Open editor',
				handler: () =>
					(window.location.href = `/app?agent=${encodeURIComponent(agent.id)}`),
			});
			return;
		}

		const steps = ['Preparing manifest', 'Sign tx', 'Confirming on-chain', 'Saving'];
		this._renderProgress(steps, 0);

		// ── Step 0: prep + IPFS pin ────────────────────────────────────────
		// Reuse a recent prep record so retries don't re-pin and don't waste
		// time. Server expires prep records after 1h.
		let prep;
		try {
			prep = await this._getOrCreatePrep();
		} catch (err) {
			this._renderError(`Could not prepare manifest: ${err.message}`);
			return;
		}

		// ── Connect wallet on the selected chain ───────────────────────────
		let signer, walletChainId;
		try {
			({ signer, chainId: walletChainId } = await ensureWallet());
		} catch (err) {
			if (_isUserRejection(err)) return this._renderDeployButton();
			this._renderError(`Wallet connection failed: ${_humanError(err)}`);
			return;
		}

		if (walletChainId !== this._chainId) {
			const targetName = CHAIN_META[this._chainId]?.name || `chain ${this._chainId}`;
			this._renderError(`Wallet is on a different network. Switch to ${targetName}.`, {
				label: `Switch to ${targetName}`,
				handler: async () => {
					try {
						await switchChain(this._chainId);
						this._renderDeployButton();
					} catch (e) {
						if (_isUserRejection(e)) return this._renderDeployButton();
						this._renderError(`Network switch failed: ${_humanError(e)}`);
					}
				},
			});
			return;
		}

		const deployment = REGISTRY_DEPLOYMENTS[walletChainId];
		if (!deployment?.identityRegistry) {
			this._renderDisabled('No ERC-8004 registry deployed on this chain');
			return;
		}

		// ── Step 1: sign tx ────────────────────────────────────────────────
		this._renderProgress(steps, 1);
		const registry = getIdentityRegistry(walletChainId, signer);
		let tx;
		try {
			tx = await registry['register(string)'](prep.metadataURI);
		} catch (err) {
			this._handleSignError(err, walletChainId);
			return;
		}

		// ── Step 2: wait for confirmation ──────────────────────────────────
		this._renderProgress(steps, 2);
		let receipt;
		try {
			receipt = await tx.wait();
		} catch (err) {
			this._renderError(`Transaction reverted: ${_humanError(err)}`);
			return;
		}
		if (receipt?.status !== 1) {
			this._renderError('Transaction failed on-chain.');
			return;
		}

		// Pull the agentId out of the Registered event so the confirm call
		// can cross-check it against the on-chain receipt server-side.
		const onchainAgentId = _parseRegisteredAgentId(receipt, registry);
		if (onchainAgentId == null) {
			this._renderError(
				'Could not parse Registered event from the receipt. The tx is on-chain — please retry "Save".',
				{
					label: 'Retry save',
					handler: () =>
						this._confirmAndFinish(prep, walletChainId, tx, null, deployment),
				},
			);
			return;
		}

		// ── Step 3: server-side confirm (verify + upsert) ──────────────────
		this._renderProgress(steps, 3);
		await this._confirmAndFinish(prep, walletChainId, tx, onchainAgentId, deployment);
	}

	/**
	 * Cache layer for register-prep so retries reuse the same IPFS pin
	 * (idempotent across reloads / network blips).
	 */
	async _getOrCreatePrep() {
		const agent = this._agent;
		const cacheKey = _prepCacheKey(agent.id);

		try {
			const raw = localStorage.getItem(cacheKey);
			if (raw) {
				const cached = JSON.parse(raw);
				if (cached?.prepId && cached?.metadataURI && cached?.expiresAt > Date.now()) {
					return cached;
				}
			}
		} catch {
			/* fall through to a fresh prep */
		}

		const body = {
			name: agent.name || 'Agent',
			description: agent.description || '',
			avatarId: agent.avatarId || agent.avatar_id,
			...(Array.isArray(agent.skills) && agent.skills.length > 0
				? { skills: agent.skills }
				: {}),
		};

		const resp = await fetch('/api/agents/register-prep', {
			method: 'POST',
			credentials: 'include',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
		});
		if (!resp.ok) {
			const data = await resp.json().catch(() => ({}));
			throw new Error(data.error_description || `register-prep returned ${resp.status}`);
		}
		const prep = await resp.json();
		const cached = {
			prepId: prep.prepId,
			cid: prep.cid,
			metadataURI: prep.metadataURI,
			expiresAt: Date.now() + 50 * 60 * 1000, // server keeps prep 1h, expire ours at 50m
		};
		try {
			localStorage.setItem(cacheKey, JSON.stringify(cached));
		} catch {
			/* quota or disabled storage — fine, we just lose retry caching */
		}
		return cached;
	}

	async _confirmAndFinish(prep, chainId, tx, onchainAgentId, deployment) {
		try {
			const resp = await fetch('/api/agents/register-confirm', {
				method: 'POST',
				credentials: 'include',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					prepId: prep.prepId,
					chainId,
					agentId: String(onchainAgentId ?? 0),
					txHash: tx.hash,
				}),
			});
			if (!resp.ok) {
				const data = await resp.json().catch(() => ({}));
				throw new Error(
					data.error_description || `register-confirm returned ${resp.status}`,
				);
			}
		} catch (err) {
			this._renderError(
				`Mint succeeded on-chain but server save failed: ${err.message}. Reload the page to retry — your tx is at ${tx.hash.slice(0, 10)}…`,
			);
			return;
		}

		// Clear the prep cache — it's been consumed server-side.
		try {
			localStorage.removeItem(_prepCacheKey(this._agent.id));
		} catch {
			/* ignore */
		}

		// Reflect in local agent state and flip to the success chip.
		this._agent.chainId = chainId;
		this._agent.txHash = tx.hash;
		this._agent.contractAddress = deployment.identityRegistry;
		this._agent.erc8004AgentId = onchainAgentId;
		this._renderSuccessChip(chainId, tx.hash, deployment.identityRegistry);
	}

	// ─── Error classification ──────────────────────────────────────────────

	_handleSignError(err, chainId) {
		if (_isUserRejection(err)) {
			this._renderDeployButton();
			return;
		}
		if (_isInsufficientFunds(err)) {
			const faucetUrl = FAUCETS[chainId];
			this._renderError('Insufficient funds in this wallet.', {
				label: faucetUrl ? 'Get testnet funds' : 'Try again',
				handler: () => {
					if (faucetUrl) window.open(faucetUrl, '_blank');
					else this._renderDeployButton();
				},
			});
			return;
		}
		if (_isReplacementUnderpriced(err)) {
			this._renderError(
				'A pending transaction from this wallet is blocking the new one. Cancel it in your wallet and try again.',
			);
			return;
		}
		this._renderError(`Transaction failed: ${_humanError(err)}`);
	}
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * EIP-1193 user-rejection detection.
 * Spec: error code 4001 = user rejected request.
 * ethers also wraps errors with `code: 'ACTION_REJECTED'`.
 */
function _isUserRejection(err) {
	if (!err) return false;
	if (err.code === 4001) return true;
	if (err.code === 'ACTION_REJECTED') return true;
	if (err?.info?.error?.code === 4001) return true;
	return /user rejected|user denied|rejected by user|user cancel/i.test(err.message || '');
}

function _isInsufficientFunds(err) {
	if (!err) return false;
	if (err.code === 'INSUFFICIENT_FUNDS') return true;
	if (err?.info?.error?.code === -32000) {
		// Some RPCs surface insufficient funds via -32000 + body text.
		return /insufficient funds/i.test(err?.info?.error?.message || '');
	}
	return /insufficient funds|insufficient balance|not enough.*funds/i.test(err.message || '');
}

function _isReplacementUnderpriced(err) {
	if (!err) return false;
	if (err.code === 'REPLACEMENT_UNDERPRICED') return true;
	return /replacement.*underpriced|already known|nonce too low/i.test(err.message || '');
}

/** Pull a human-readable string from a ProviderError / ethers error. */
function _humanError(err) {
	if (!err) return 'unknown error';
	const inner = err?.info?.error?.message || err?.shortMessage || err?.message;
	return String(inner || 'unknown error')
		.replace(/\s+/g, ' ')
		.slice(0, 240);
}

/** Decode the Registered event's agentId from a confirmed receipt. */
function _parseRegisteredAgentId(receipt, registry) {
	if (!receipt?.logs) return null;
	for (const log of receipt.logs) {
		try {
			const parsed = registry.interface.parseLog(log);
			if (parsed?.name === 'Registered') {
				return Number(parsed.args.agentId);
			}
		} catch {
			/* not our event */
		}
	}
	return null;
}

/** Escape HTML attribute/text content to prevent XSS. */
function _esc(str) {
	return String(str ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}
