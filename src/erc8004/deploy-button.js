/**
 * DeployButton — self-contained "Deploy on-chain" UI for an agent page.
 *
 * Distinct from register-ui.js (full multi-tab wizard). This is a minimal
 * drop-in chip: shows deploy button if not yet on-chain, success chip if
 * already deployed.
 */

import { connectWallet, getIdentityRegistry } from './agent-registry.js';
import { REGISTRY_DEPLOYMENTS } from './abi.js';
import { CHAIN_META, switchChain, txExplorerUrl } from './chain-meta.js';
import { BrowserProvider } from 'ethers';

const BASE_SEPOLIA = 84532;

// Faucet links per testnet chainId
const FAUCETS = {
	84532: 'https://www.coinbase.com/faucets/base-ethereum-goerli-faucet',
	11155111: 'https://sepoliafaucet.com/',
	421614: 'https://www.alchemy.com/faucets/arbitrum-sepolia',
	11155420: 'https://app.optimism.io/faucet',
	80002: 'https://faucet.polygon.technology/',
	43113: 'https://faucet.avax.network/',
	97: 'https://testnet.bnbchain.org/faucet-smart',
};

export class DeployButton {
	/**
	 * @param {object} opts
	 * @param {object} opts.agent              Agent object (must have .id and optionally .chainId, .txHash, .manifestUrl, .name)
	 * @param {HTMLElement} opts.container     Where to mount
	 * @param {number} [opts.preferredChainId] Defaults to Base Sepolia (84532)
	 */
	constructor({ agent, container, preferredChainId = BASE_SEPOLIA }) {
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
		} else if (!REGISTRY_DEPLOYMENTS[this._chainId]) {
			this._renderDisabled('No registry on this chain');
		} else {
			this._renderDeployButton();
		}
	}

	_renderDeployButton() {
		this._root.innerHTML = `
			<button class="deploy-btn" title="Deploy this agent as an ERC-8004 token on-chain">
				&#x2B22; Deploy on-chain
			</button>
		`;
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
		const meta = CHAIN_META[chainId];
		const chainName = meta ? meta.name : `Chain ${chainId}`;
		const explorerUrl = txExplorerUrl(chainId, txHash);
		this._root.innerHTML = `
			<a class="deploy-chip deploy-chip--success" href="${_esc(explorerUrl)}" target="_blank" rel="noopener noreferrer">
				&#x2B22; On-chain on ${_esc(chainName)} &middot; view on explorer
			</a>
		`;
	}

	_renderProgress(steps, activeIdx) {
		const labels = steps.map((s, i) => {
			const cls = i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending';
			return `<span class="progress-step progress-step--${cls}">${_esc(s)}</span>`;
		});
		this._root.innerHTML = `
			<div class="deploy-progress">
				${labels.join('<span class="progress-sep">&#x2192;</span>')}
			</div>
		`;
	}

	_renderError(msg, action) {
		const actionHtml = action
			? `<button class="deploy-action-btn">${_esc(action.label)}</button>`
			: '<button class="deploy-action-btn deploy-action-btn--reset">Try again</button>';
		this._root.innerHTML = `
			<div class="deploy-error">
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

	async _startDeploy() {
		const steps = ['Estimating gas', 'Sign tx', 'Waiting confirmation', 'Done'];
		this._renderProgress(steps, 0);

		let signer, chainId, provider;

		// ── Connect wallet
		try {
			({ signer, chainId, provider } = await connectWallet({ chainId: this._chainId }));
		} catch (err) {
			if (/rejected|denied/i.test(err.message)) {
				this._renderDeployButton();
				return;
			}
			this._renderError('Wallet connection failed: ' + err.message);
			return;
		}

		// ── Check correct network
		if (chainId !== this._chainId) {
			this._renderError(
				`Wrong network. Please switch to ${CHAIN_META[this._chainId]?.name ?? `chain ${this._chainId}`}.`,
				{
					label: `Switch to ${CHAIN_META[this._chainId]?.name ?? 'correct network'}`,
					handler: async () => {
						try {
							await switchChain(this._chainId);
							this._renderDeployButton();
						} catch (e) {
							this._renderError('Network switch failed: ' + e.message);
						}
					},
				},
			);
			return;
		}

		// ── Check registry exists on chain
		const deployment = REGISTRY_DEPLOYMENTS[chainId];
		if (!deployment?.identityRegistry) {
			this._renderDisabled('No ERC-8004 registry deployed on this chain');
			return;
		}

		// ── Derive agentURI from agent manifest URL
		const agent = this._agent;
		const agentURI =
			agent.manifestUrl ||
			(agent.id ? `${location.origin}/api/agents/${agent.id}/manifest` : '');

		// ── Estimate gas (step 0)
		this._renderProgress(steps, 0);
		const registry = getIdentityRegistry(chainId, signer);
		let gasEstimate;
		try {
			gasEstimate = await registry['register(string)'].estimateGas(agentURI);
			console.log('[deploy-button] gas estimate:', gasEstimate.toString());
		} catch (err) {
			// Insufficient funds surfaces here
			if (/insufficient|fund/i.test(err.message)) {
				const faucetUrl = FAUCETS[chainId];
				this._renderError('Insufficient funds in this wallet.', {
					label: 'Get testnet funds',
					handler: () => faucetUrl && window.open(faucetUrl, '_blank'),
				});
				return;
			}
			console.warn('[deploy-button] gas estimation failed, proceeding anyway:', err.message);
		}

		// ── Sign tx (step 1)
		this._renderProgress(steps, 1);
		let tx;
		try {
			tx = await registry['register(string)'](agentURI);
		} catch (err) {
			if (/rejected|denied/i.test(err.message)) {
				this._renderDeployButton();
				return;
			}
			if (/insufficient|fund/i.test(err.message)) {
				const faucetUrl = FAUCETS[chainId];
				this._renderError('Insufficient funds in this wallet.', {
					label: 'Get testnet funds',
					handler: () => faucetUrl && window.open(faucetUrl, '_blank'),
				});
				return;
			}
			this._renderError('Transaction failed: ' + err.message);
			return;
		}

		// ── Wait confirmation (step 2)
		this._renderProgress(steps, 2);
		let receipt;
		try {
			receipt = await tx.wait();
		} catch (err) {
			this._renderError('Transaction reverted: ' + err.message);
			return;
		}

		// ── Extract agentId from Registered event
		const registeredEvent = receipt.logs
			.map((l) => {
				try {
					return registry.interface.parseLog(l);
				} catch {
					return null;
				}
			})
			.find((e) => e?.name === 'Registered');

		const agentId = registeredEvent ? Number(registeredEvent.args.agentId) : null;
		const contractAddress = deployment.identityRegistry;

		// ── Persist on-chain state to backend (step 3)
		this._renderProgress(steps, 3);
		if (agent.id) {
			try {
				const res = await fetch(`/api/agents/${agent.id}/onchain`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					credentials: 'include',
					body: JSON.stringify({ chainId, txHash: tx.hash, contractAddress, agentId }),
				});
				if (!res.ok) {
					console.warn(
						`[deploy-button] POST /api/agents/${agent.id}/onchain returned ${res.status} — on-chain state is authoritative.`,
					);
				}
			} catch (err) {
				console.warn('[deploy-button] failed to persist on-chain state:', err.message);
			}
		} else {
			console.warn('[deploy-button] agent.id missing — skipping backend persist.');
		}

		// ── Update local agent state + show success
		agent.chainId = chainId;
		agent.txHash = tx.hash;
		agent.contractAddress = contractAddress;
		this._renderSuccessChip(chainId, tx.hash, contractAddress);
	}
}

/** Escape HTML attribute/text content to prevent XSS. */
function _esc(str) {
	return String(str ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}
