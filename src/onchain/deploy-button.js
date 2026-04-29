/**
 * OnchainDeployButton — drop-in replacement for src/erc8004/deploy-button.js.
 *
 * Differences:
 *   • Reads chain entries from chain-ref.js registry (CAIP-2 keyed) — Solana,
 *     EVM, and any future family share one dropdown without sentinel strings.
 *   • Delegates everything wallet-shaped to the adapter layer.
 *   • Rehydrates the success chip from `agent.onchain` (the unified shape
 *     returned by /api/agents/:id and persisted by the new confirm endpoint),
 *     so a page reload shows the deployed state regardless of family.
 *
 * Mounting:
 *   const btn = new OnchainDeployButton({ agent, container });
 *   btn.mount();
 */

import { CHAIN_META } from '../erc8004/chain-meta.js';
import { REGISTRY_DEPLOYMENTS } from '../erc8004/abi.js';
import {
	buildRegistry,
	groupRegistry,
	entryByCaip2,
	toCaip2,
	fromCaip2,
	evm,
} from './chain-ref.js';
import { deployAgent } from './deploy.js';
import { isUserRejection } from './adapters/index.js';

const DEFAULT_REF_CAIP2 = 'eip155:8453'; // Base mainnet

const STEP_LABELS = {
	connect: 'Connecting wallet',
	prep: 'Preparing manifest',
	sign: 'Sign tx',
	confirm: 'Confirming on-chain',
	save: 'Saving',
};
const STEP_ORDER = ['connect', 'prep', 'sign', 'confirm', 'save'];

function _esc(s) {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export class OnchainDeployButton {
	/**
	 * @param {object} opts
	 * @param {object} opts.agent
	 * @param {HTMLElement} opts.container
	 * @param {string} [opts.preferredChain]   CAIP-2 string. Defaults to Base mainnet.
	 */
	constructor({ agent, container, preferredChain = DEFAULT_REF_CAIP2 }) {
		this._agent = agent;
		this._container = container;
		this._registry = buildRegistry(CHAIN_META, REGISTRY_DEPLOYMENTS);
		this._refCaip2 = preferredChain;
		this._root = null;
	}

	mount() {
		this._root = document.createElement('div');
		this._root.className = 'deploy-button-root';
		this._container.appendChild(this._root);
		this._render();
	}

	unmount() {
		this._root?.remove();
		this._root = null;
	}

	// ── Render ─────────────────────────────────────────────────────────────

	_render() {
		if (!this._root) return;
		const onchain = this._agent.onchain;
		if (onchain?.txHash && onchain?.chain) {
			const entry = entryByCaip2(this._registry, onchain.chain);
			if (entry) {
				this._renderSuccessChip(entry, onchain.txHash, onchain.contractOrMint);
				return;
			}
		}
		const entry = entryByCaip2(this._registry, this._refCaip2);
		if (!entry) {
			this._renderDisabled('Selected chain is not configured');
			return;
		}
		this._renderDeployButton();
	}

	_renderDeployButton() {
		const { mainnets, testnets } = groupRegistry(this._registry);
		const optsHtml = (entries) =>
			entries
				.map((e) => {
					const c = toCaip2(e.ref);
					return `<option value="${_esc(c)}"${c === this._refCaip2 ? ' selected' : ''}>${_esc(e.name)}</option>`;
				})
				.join('');

		this._root.innerHTML = `
			<div class="deploy-chain-row">
				<select class="deploy-chain-select" aria-label="Target chain">
					<optgroup label="Mainnets">${optsHtml(mainnets)}</optgroup>
					<optgroup label="Testnets">${optsHtml(testnets)}</optgroup>
				</select>
				<button class="deploy-btn" title="Deploy this agent on-chain">
					&#x2B22; Deploy on-chain
				</button>
			</div>
		`;
		const sel = this._root.querySelector('.deploy-chain-select');
		sel.addEventListener('change', (ev) => {
			this._refCaip2 = ev.target.value;
		});
		this._root.querySelector('.deploy-btn').addEventListener('click', () => this._start());
	}

	_renderDisabled(msg) {
		this._root.innerHTML = `
			<button class="deploy-btn deploy-btn--disabled" disabled title="${_esc(msg)}">
				&#x2B22; Deploy on-chain
			</button>
			<span class="deploy-tooltip">${_esc(msg)}</span>
		`;
	}

	_renderProgress(activeStep) {
		const idx = STEP_ORDER.indexOf(activeStep);
		const html = STEP_ORDER.map((s, i) => {
			const cls = i < idx ? 'done' : i === idx ? 'active' : 'pending';
			return `<span class="progress-step progress-step--${cls}">${_esc(STEP_LABELS[s])}</span>`;
		}).join('<span class="progress-sep" aria-hidden="true">&#x2192;</span>');
		this._root.innerHTML = `
			<div class="deploy-progress" role="status" aria-live="polite">
				${html}
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
		btn.addEventListener('click', action ? action.handler : () => this._renderDeployButton());
	}

	_renderSuccessChip(entry, txHash, contractOrMint) {
		// Prefer the tx explorer link — it survives across chains and works for
		// both EVM (tx hash) and Solana (signature).
		const url = entry.explorerTx(txHash);
		this._root.innerHTML = `
			<a class="deploy-chip deploy-chip--success" href="${_esc(url)}" target="_blank" rel="noopener noreferrer"
			   aria-label="View on ${_esc(entry.name)} explorer">
				&#x2B22; On-chain on ${_esc(entry.name)} &middot; view on explorer
			</a>
		`;
	}

	// ── Drive ──────────────────────────────────────────────────────────────

	async _start() {
		let ref;
		try {
			ref = fromCaip2(this._refCaip2);
		} catch (e) {
			this._renderError(`Invalid chain: ${e.message}`);
			return;
		}

		try {
			const result = await deployAgent({
				agent: this._agent,
				ref,
				onProgress: (step) => this._renderProgress(step),
			});
			this._agent.onchain = {
				chain: toCaip2(result.ref),
				txHash: result.txHash,
				onchainId: result.onchainId,
				contractOrMint: result.contractOrMint,
			};
			const entry = entryByCaip2(this._registry, this._refCaip2);
			this._renderSuccessChip(entry, result.txHash, result.contractOrMint);
		} catch (err) {
			if (isUserRejection(err)) return this._renderDeployButton();
			if (err.code === 'NO_PROVIDER') {
				this._renderError(err.message, {
					label: 'Install wallet',
					handler: () => window.open(err.installUrl, '_blank', 'noopener'),
				});
				return;
			}
			this._renderError(err.message || 'Deploy failed.');
		}
	}
}

// Re-export building blocks for callers that want to compose differently.
export { evm, fromCaip2, toCaip2 } from './chain-ref.js';
export { deployAgent } from './deploy.js';
