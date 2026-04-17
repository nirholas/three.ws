/**
 * Agent Home orphan mounts: SharePanel + DeployButton.
 *
 * Call mountOrphans() after the agent identity is ready. Handles:
 *  - Share button (all visitors)
 *  - Deploy chip (owner only, conditionally on-chain state)
 *
 * @module agent-home-orphans
 */

import { SharePanel } from './share-panel.js';
import { DeployButton } from './erc8004/deploy-button.js';
import './erc8004/deploy-button.css';
import { getCurrentUser } from './wallet-auth.js';
import { CHAIN_META, addressExplorerUrl } from './erc8004/chain-meta.js';

/**
 * Mount the share button and (if owner) the deploy chip.
 *
 * @param {{ agentId: string, identity: import('./agent-identity.js').AgentIdentity, shareMount: HTMLElement }} opts
 * @returns {Promise<void>}
 */
export async function mountOrphans({ agentId, identity, shareMount }) {
	_mountShareButton(shareMount, identity);

	// Ownership resolution: rawAgent.user_id is only returned to the owner
	const [user, rawAgent] = await Promise.all([getCurrentUser(), _fetchRawAgent(agentId)]);

	if (!user || !rawAgent || rawAgent.user_id !== user.id) return;

	const chipMount = _createChipMount();

	if (rawAgent.chain_id) {
		// Already on-chain: show pill (API doesn't store tx_hash, link to registry contract)
		_renderSuccessChip(chipMount, rawAgent.chain_id, rawAgent.erc8004_registry);
	} else {
		// Not yet deployed: mount the deploy button
		const agentObj = {
			id: rawAgent.id,
			name: rawAgent.name,
			chainId: null,
			txHash: null,
			contractAddress: rawAgent.erc8004_registry || null,
		};
		const btn = new DeployButton({ agent: agentObj, container: chipMount });
		btn.mount();
		_watchForDeploy(chipMount, agentObj);
	}
}

// ── Private helpers ────────────────────────────────────────────────────────────

/**
 * @param {HTMLElement} mount
 * @param {import('./agent-identity.js').AgentIdentity} identity
 */
function _mountShareButton(mount, identity) {
	const btn = document.createElement('button');
	btn.className = 'agent-share-btn';
	btn.setAttribute('aria-label', 'Share agent');
	btn.setAttribute('aria-haspopup', 'dialog');
	btn.innerHTML =
		`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"` +
		` stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
		`<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>` +
		`<line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>` +
		`<line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>` +
		`</svg>Share`;

	let panel = null;
	btn.addEventListener('click', () => {
		if (!panel) {
			panel = new SharePanel({
				agent: { id: identity.id, name: identity.name },
				container: document.body,
			});
		}
		panel.open();
	});

	mount.appendChild(btn);
}

/** Insert a chip mount span inline after the agent name heading. */
function _createChipMount() {
	const titleEl = document.getElementById('page-agent-name');
	if (!titleEl) {
		const fallback = document.createElement('div');
		document.body.appendChild(fallback);
		return fallback;
	}

	// Wrap h1 + chip in a flex row so the chip sits inline at 12px gap
	const wrapper = document.createElement('div');
	wrapper.className = 'agent-title-row';
	titleEl.parentNode.insertBefore(wrapper, titleEl);
	wrapper.appendChild(titleEl);

	const chipMount = document.createElement('div');
	chipMount.className = 'agent-deploy-chip-mount';
	wrapper.appendChild(chipMount);
	return chipMount;
}

/**
 * @param {HTMLElement} mount
 * @param {number} chainId
 * @param {string|null} registryAddress
 */
function _renderSuccessChip(mount, chainId, registryAddress) {
	const meta = CHAIN_META[chainId];
	const chainName = meta?.name ?? `Chain ${chainId}`;
	const explorerUrl = registryAddress ? addressExplorerUrl(chainId, registryAddress) : '#';
	mount.innerHTML =
		`<a class="deploy-chip deploy-chip--success"` +
		` href="${_esc(explorerUrl)}" target="_blank" rel="noopener noreferrer">` +
		`&#x2B22; On ${_esc(chainName)}` +
		`</a>`;
}

/** Watch for deploy-chip--success appearing → show a brief toast. */
function _watchForDeploy(mount, agentObj) {
	const obs = new MutationObserver(() => {
		if (!mount.querySelector('.deploy-chip--success')) return;
		obs.disconnect();
		const chainName = CHAIN_META[agentObj.chainId]?.name ?? 'chain';
		_showToast(`Agent registered on ${chainName}`);
	});
	obs.observe(mount, { childList: true, subtree: true });
}

/** @param {string} msg */
function _showToast(msg) {
	const toast = document.createElement('div');
	toast.className = 'agent-deploy-toast';
	toast.textContent = msg;
	document.body.appendChild(toast);
	requestAnimationFrame(() => toast.classList.add('agent-deploy-toast--visible'));
	setTimeout(() => {
		toast.classList.remove('agent-deploy-toast--visible');
		setTimeout(() => toast.remove(), 300);
	}, 3000);
}

/**
 * @param {string} agentId
 * @returns {Promise<object|null>}
 */
async function _fetchRawAgent(agentId) {
	try {
		const res = await fetch(`/api/agents/${agentId}`, { credentials: 'include' });
		if (!res.ok) return null;
		const { agent } = await res.json();
		return agent ?? null;
	} catch {
		return null;
	}
}

/** @param {unknown} str */
function _esc(str) {
	return String(str ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}
