/**
 * Single source of truth for the "deployed on-chain" badge.
 *
 * One agent record → one normalized on-chain descriptor → one pill, rendered
 * identically across the agent profile, character page, marketplace, gallery,
 * home, public profiles, and every dashboard. There is no shared agent-card in
 * this codebase (each surface rolls its own markup), so consistency lives here:
 * import this module wherever an agent is drawn and the badge looks and links
 * the same everywhere.
 *
 * Detection reads the canonical `agent.onchain` block emitted by api/agents.js
 * decorate() (the surfaced mirror of `meta.onchain`), and also accepts the
 * legacy and per-surface shapes still in flight across the platform:
 *   - canonical:   agent.onchain | agent.meta.onchain
 *       { family, chain (caip2), cluster, contract_or_mint, tx_hash, confirmed_at }
 *   - pump.fun:    agent.token | agent.meta.token
 *       { mint, cluster, symbol, pumpfun_url, tx_signature }
 *   - legacy EVM:  agent.is_registered && agent.erc8004_agent_id (+ agent.chain_id)
 *   - marketplace: agent.chainId + agent.agentId (+ chainShortName/chainName)
 *
 * Returns null when the agent is not deployed on-chain — callers render nothing.
 */

// Shared pill class names — the canonical .pill system (B04 / style.css) uses
// the same --badge-onchain-* / --badge-devnet-* tokens, so tws-ocb elements
// double as .pill elements. This keeps the badge in sync with the design system
// without breaking any surface that renders it outside the main style.css scope
// (widgets, embeds, iframes). The isolated injected stylesheet below is the
// authoritative fallback for those out-of-scope contexts.
import { shortAddress as shortAddr } from './address.js';

const PILL_BASE_CLASS = 'pill';
const PILL_ONCHAIN_CLASS = 'pill--onchain';
const PILL_DEVNET_CLASS = 'pill--devnet';
const STYLE_ID = 'tws-onchain-badge-styles';

// Known EVM chains → display name + explorer base. Solana is handled separately
// (cluster-aware). Anything not listed degrades to "Chain <id>" with no link.
const EVM_CHAINS = {
	1: { name: 'Ethereum', short: 'ETH', explorer: 'https://etherscan.io' },
	8453: { name: 'Base', short: 'Base', explorer: 'https://basescan.org' },
	84532: { name: 'Base Sepolia', short: 'Base test', explorer: 'https://sepolia.basescan.org', testnet: true },
	137: { name: 'Polygon', short: 'POL', explorer: 'https://polygonscan.com' },
	10: { name: 'Optimism', short: 'OP', explorer: 'https://optimistic.etherscan.io' },
	42161: { name: 'Arbitrum', short: 'ARB', explorer: 'https://arbiscan.io' },
	42220: { name: 'Celo', short: 'CELO', explorer: 'https://celoscan.io' },
};

// CAIP-2 Solana references → cluster (per chainagnostic.org/CAIPs/caip-2).
const SOLANA_CAIP = {
	'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': 'mainnet',
	EtWTRABZaYq6iMfeYKouRu166VU2xqa1: 'devnet',
};

function esc(s) {
	return String(s == null ? '' : s).replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
	);
}


function evmChainIdFromCaip2(caip2) {
	const m = /^eip155:(\d+)$/.exec(String(caip2 || ''));
	return m ? Number(m[1]) : null;
}

function solanaClusterFromCaip2(caip2) {
	const m = /^solana:(.+)$/.exec(String(caip2 || ''));
	return m ? SOLANA_CAIP[m[1]] || null : null;
}

function solanaExplorer(addr, cluster, { tx = false, token = false } = {}) {
	if (!addr) return null;
	if (cluster === 'devnet') {
		const kind = tx ? 'tx' : 'address';
		return `https://explorer.solana.com/${kind}/${addr}?cluster=devnet`;
	}
	if (tx) return `https://solscan.io/tx/${addr}`;
	return `https://solscan.io/${token ? 'token' : 'account'}/${addr}`;
}

/**
 * Normalize any agent record shape into a single on-chain descriptor, or null.
 * @returns {null | {
 *   deployed: true, family: 'solana'|'evm', caip2: string|null,
 *   cluster: 'mainnet'|'devnet'|null, testnet: boolean,
 *   chainLabel: string, chainShort: string,
 *   address: string|null, txHash: string|null,
 *   explorerUrl: string|null, txExplorerUrl: string|null,
 *   isToken: boolean, tokenSymbol: string|null, pumpfunUrl: string|null,
 *   registry: string|null,
 * }}
 */
export function getOnchainStatus(agent) {
	if (!agent || typeof agent !== 'object') return null;

	const onchain = agent.onchain || agent.meta?.onchain || null;
	const token = agent.token || agent.meta?.token || null;

	// ── Canonical on-chain block (Solana or EVM via api/agents decorate) ──────
	if (onchain && (onchain.contract_or_mint || onchain.tx_hash || onchain.chain || onchain.family)) {
		const family = onchain.family || (String(onchain.chain || '').startsWith('eip155') ? 'evm' : 'solana');
		const caip2 = onchain.chain || null;
		if (family === 'solana') {
			const cluster = onchain.cluster || solanaClusterFromCaip2(caip2) || 'mainnet';
			const address = onchain.contract_or_mint || token?.mint || onchain.wallet || null;
			const isToken = !!(token && token.mint && token.mint === address);
			return {
				deployed: true,
				family: 'solana',
				caip2,
				cluster,
				testnet: cluster === 'devnet',
				chainLabel: cluster === 'devnet' ? 'Solana Devnet' : 'Solana',
				chainShort: cluster === 'devnet' ? 'Devnet' : 'Solana',
				address,
				txHash: onchain.tx_hash || token?.tx_signature || null,
				explorerUrl: solanaExplorer(address, cluster, { token: isToken }),
				txExplorerUrl: solanaExplorer(onchain.tx_hash, cluster, { tx: true }),
				isToken,
				tokenSymbol: token?.symbol || null,
				pumpfunUrl: token?.pumpfun_url || null,
				registry: onchain.onchain_id ? String(onchain.onchain_id) : null,
			};
		}
		// EVM
		const chainId = evmChainIdFromCaip2(caip2);
		const meta = (chainId != null && EVM_CHAINS[chainId]) || null;
		const address = onchain.contract_or_mint || onchain.wallet || null;
		const explorer = meta?.explorer || null;
		return {
			deployed: true,
			family: 'evm',
			caip2,
			cluster: null,
			testnet: !!meta?.testnet,
			chainLabel: meta?.name || (chainId ? `Chain ${chainId}` : 'EVM'),
			chainShort: meta?.short || (chainId ? `#${chainId}` : 'EVM'),
			address,
			txHash: onchain.tx_hash || null,
			explorerUrl: explorer && address ? `${explorer}/address/${address}` : null,
			txExplorerUrl: explorer && onchain.tx_hash ? `${explorer}/tx/${onchain.tx_hash}` : null,
			isToken: false,
			tokenSymbol: null,
			pumpfunUrl: null,
			registry: onchain.onchain_id ? String(onchain.onchain_id) : null,
		};
	}

	// ── pump.fun token without a separate onchain block (still on-chain) ──────
	if (token && (token.mint || token.contract_address)) {
		const cluster = token.cluster || 'mainnet';
		const address = token.mint || token.contract_address || null;
		return {
			deployed: true,
			family: 'solana',
			caip2: cluster === 'devnet' ? 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' : 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
			cluster,
			testnet: cluster === 'devnet',
			chainLabel: cluster === 'devnet' ? 'Solana Devnet' : 'Solana',
			chainShort: cluster === 'devnet' ? 'Devnet' : 'Solana',
			address,
			txHash: token.tx_signature || null,
			explorerUrl: token.pumpfun_url || solanaExplorer(address, cluster, { token: true }),
			txExplorerUrl: solanaExplorer(token.tx_signature, cluster, { tx: true }),
			isToken: true,
			tokenSymbol: token.symbol || token.name || null,
			pumpfunUrl: token.pumpfun_url || null,
			registry: null,
		};
	}

	// ── Marketplace on-chain card shape (EVM ERC-8004 directory rows) ─────────
	if (agent.agentId != null && agent.chainId != null) {
		const chainId = Number(agent.chainId);
		const meta = EVM_CHAINS[chainId] || null;
		const explorer = meta?.explorer || null;
		const address = agent.contractAddress || agent.owner || null;
		return {
			deployed: true,
			family: 'evm',
			caip2: `eip155:${chainId}`,
			cluster: null,
			testnet: !!meta?.testnet,
			chainLabel: agent.chainName || meta?.name || `Chain ${chainId}`,
			chainShort: agent.chainShortName || meta?.short || `#${chainId}`,
			address,
			txHash: null,
			explorerUrl: agent.tokenExplorerUrl || (explorer && address ? `${explorer}/address/${address}` : null),
			txExplorerUrl: null,
			isToken: false,
			tokenSymbol: null,
			pumpfunUrl: null,
			registry: `ERC-8004 #${agent.agentId}`,
		};
	}

	// ── Generic registry id present (a-me / older list shapes) ────────────────
	// A concrete on-chain/registry id is proof of deployment even when the rich
	// `onchain` block isn't surfaced. A bare `chain_id` (a deploy *target*, not a
	// deployment) is intentionally NOT treated as on-chain here.
	if (agent.onchain_id != null || agent.erc8004_id != null || agent.erc8004_agent_id != null) {
		const chainId = agent.chain_id != null ? Number(agent.chain_id) : null;
		const meta = (chainId != null && EVM_CHAINS[chainId]) || null;
		const regId = agent.erc8004_agent_id ?? agent.erc8004_id ?? null;
		return {
			deployed: true,
			family: 'evm',
			caip2: chainId != null ? `eip155:${chainId}` : null,
			cluster: null,
			testnet: !!meta?.testnet,
			chainLabel: meta?.name || (chainId ? `Chain ${chainId}` : 'On-chain'),
			chainShort: meta?.short || (chainId ? `#${chainId}` : ''),
			address: agent.wallet_address || agent.solana_address || null,
			txHash: null,
			explorerUrl:
				meta?.explorer && agent.wallet_address
					? `${meta.explorer}/address/${agent.wallet_address}`
					: null,
			txExplorerUrl: null,
			isToken: false,
			tokenSymbol: null,
			pumpfunUrl: null,
			registry: regId != null ? `ERC-8004 #${regId}` : null,
		};
	}

	// ── Legacy: registered ERC-8004 agent flagged on the record ───────────────
	if (agent.is_registered === true && (agent.erc8004_agent_id != null || agent.chain_id != null)) {
		const chainId = agent.chain_id != null ? Number(agent.chain_id) : null;
		const meta = (chainId != null && EVM_CHAINS[chainId]) || null;
		return {
			deployed: true,
			family: 'evm',
			caip2: chainId != null ? `eip155:${chainId}` : null,
			cluster: null,
			testnet: !!meta?.testnet,
			chainLabel: meta?.name || (chainId ? `Chain ${chainId}` : 'On-chain'),
			chainShort: meta?.short || (chainId ? `#${chainId}` : ''),
			address: agent.wallet_address || null,
			txHash: null,
			explorerUrl:
				meta?.explorer && agent.wallet_address
					? `${meta.explorer}/address/${agent.wallet_address}`
					: null,
			txExplorerUrl: null,
			isToken: false,
			tokenSymbol: null,
			pumpfunUrl: null,
			registry: agent.erc8004_agent_id != null ? `ERC-8004 #${agent.erc8004_agent_id}` : null,
		};
	}

	return null;
}

/** True when the agent has been deployed on-chain. */
export function isOnchain(agent) {
	return getOnchainStatus(agent) != null;
}

/** Inject the shared badge stylesheet once. Idempotent and SSR-safe. */
export function ensureOnchainBadgeStyles() {
	if (typeof document === 'undefined') return;
	if (document.getElementById(STYLE_ID)) return;
	const style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = `
.tws-ocb{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:999px;
	font:600 11px/1 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:.01em;
	color:#34d399;background:rgba(16,185,129,.12);border:1px solid rgba(16,185,129,.32);
	text-decoration:none;white-space:nowrap;vertical-align:middle;max-width:100%;
	transition:background .15s ease,border-color .15s ease,transform .15s ease;cursor:default;}
a.tws-ocb{cursor:pointer;}
a.tws-ocb:hover{background:rgba(16,185,129,.2);border-color:rgba(16,185,129,.55);transform:translateY(-1px);}
a.tws-ocb:active{transform:translateY(0);}
a.tws-ocb:focus-visible{outline:2px solid rgba(16,185,129,.7);outline-offset:2px;}
.tws-ocb-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none;
	box-shadow:0 0 0 0 rgba(52,211,153,.55);animation:tws-ocb-pulse 2.4s ease-out infinite;}
.tws-ocb-label{overflow:hidden;text-overflow:ellipsis;}
.tws-ocb-chain{opacity:.7;font-weight:500;overflow:hidden;text-overflow:ellipsis;}
.tws-ocb-chain::before{content:"·";margin-right:5px;opacity:.55;font-weight:600;}
.tws-ocb--md{padding:4px 11px;font-size:12px;gap:7px;}
.tws-ocb--md .tws-ocb-dot{width:7px;height:7px;}
.tws-ocb--devnet{color:#fbbf24;background:rgba(251,191,36,.12);border-color:rgba(251,191,36,.32);}
a.tws-ocb--devnet:hover{background:rgba(251,191,36,.2);border-color:rgba(251,191,36,.55);}
.tws-ocb--devnet .tws-ocb-dot{box-shadow:0 0 0 0 rgba(251,191,36,.55);animation-name:tws-ocb-pulse-amber;}
@keyframes tws-ocb-pulse{0%{box-shadow:0 0 0 0 rgba(52,211,153,.5)}70%{box-shadow:0 0 0 5px rgba(52,211,153,0)}100%{box-shadow:0 0 0 0 rgba(52,211,153,0)}}
@keyframes tws-ocb-pulse-amber{0%{box-shadow:0 0 0 0 rgba(251,191,36,.5)}70%{box-shadow:0 0 0 5px rgba(251,191,36,0)}100%{box-shadow:0 0 0 0 rgba(251,191,36,0)}}
@media (prefers-reduced-motion: reduce){.tws-ocb-dot{animation:none;}}
`;
	(document.head || document.documentElement).appendChild(style);
}

/**
 * Render the on-chain badge as an HTML string for template-string render sites.
 * Returns '' when the agent is not deployed on-chain.
 *
 * @param {object} agent  Any supported agent record shape.
 * @param {object} [opts]
 * @param {'sm'|'md'} [opts.size='sm']
 * @param {boolean} [opts.link=true]   Link to the block explorer when a URL exists.
 * @param {boolean} [opts.showChain=true]  Append the chain name (e.g. "· Solana").
 * @param {string} [opts.label='On-chain']
 */
export function onchainBadgeHTML(agent, opts = {}) {
	const status = getOnchainStatus(agent);
	if (!status) return '';
	ensureOnchainBadgeStyles();

	const { size = 'sm', link = true, showChain = true, label = 'On-chain' } = opts;
	// tws-ocb — isolated injected styles (works in iframes/embeds/widgets)
	// pill / pill--onchain — canonical B04 .pill system (in scope when style.css is loaded)
	const classes = ['tws-ocb', PILL_BASE_CLASS, status.testnet ? PILL_DEVNET_CLASS : PILL_ONCHAIN_CLASS];
	if (size === 'md') classes.push('tws-ocb--md', 'pill--md');
	if (status.testnet) classes.push('tws-ocb--devnet');

	const chainHtml = showChain ? `<span class="tws-ocb-chain">${esc(status.chainShort)}</span>` : '';
	const titleBits = [
		`Deployed on-chain · ${status.chainLabel}`,
		status.address ? shortAddr(status.address) : null,
		status.registry,
		status.explorerUrl ? 'View on explorer →' : null,
	].filter(Boolean);
	const title = esc(titleBits.join(' · '));
	const aria = `Deployed on-chain on ${status.chainLabel}`;

	const inner = `<span class="tws-ocb-dot pill__dot" aria-hidden="true"></span><span class="tws-ocb-label">${esc(label)}</span>${chainHtml}`;

	if (link && status.explorerUrl) {
		return `<a class="${classes.join(' ')}" href="${esc(status.explorerUrl)}" target="_blank" rel="noopener noreferrer" title="${title}" aria-label="${esc(aria)} — view on explorer">${inner}</a>`;
	}
	return `<span class="${classes.join(' ')}" title="${title}" role="img" aria-label="${esc(aria)}">${inner}</span>`;
}

/**
 * Render the on-chain badge as a DOM node for element-building render sites.
 * Returns null when the agent is not deployed on-chain. Clicking a linked badge
 * inside a clickable card does not bubble up to the card handler.
 */
export function onchainBadgeEl(agent, opts = {}) {
	const html = onchainBadgeHTML(agent, opts);
	if (!html) return null;
	const tpl = document.createElement('template');
	tpl.innerHTML = html.trim();
	const node = tpl.content.firstElementChild;
	if (node && node.tagName === 'A') {
		node.addEventListener('click', (e) => e.stopPropagation());
	}
	return node;
}

if (typeof window !== 'undefined') {
	// Convenience handle for any classic (non-module) script that needs the badge.
	window.twsOnchainBadge = { getOnchainStatus, isOnchain, onchainBadgeHTML, onchainBadgeEl, ensureOnchainBadgeStyles };
}
