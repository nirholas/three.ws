/**
 * ERC-8004 Passport Widget — public, read-only on-chain identity card
 * rendered alongside the 3D avatar canvas.
 *
 * Contract reads run in parallel:
 *   IdentityRegistry.ownerOf(agentId)      → wallet
 *   IdentityRegistry.tokenURI(agentId)     → registration JSON URL
 *   IdentityRegistry.name()/symbol()       → collection label
 *   ReputationRegistry.getReputation(id)   → (total, count) → average
 *   ReputationRegistry event log           → recent feedback (if enabled)
 *   ValidationRegistry.getLatestValidation → optional proof row
 *
 * No wallet connection, no writes, no feedback submission. That's a v2 task.
 */

import { Contract, JsonRpcProvider } from 'ethers';
import {
	IDENTITY_REGISTRY_ABI,
	REPUTATION_REGISTRY_ABI,
	REGISTRY_DEPLOYMENTS,
} from '../erc8004/index.js';
import {
	CHAIN_SLUGS, PUBLIC_RPCS, EXPLORERS,
	resolveChainId, chainLabel,
} from '../widget-types.js';
import { resolveURI, isDecentralizedURI } from '../ipfs.js';

const CACHE_PREFIX = 'erc8004-passport:';
const STALE_TTL_MS = 1000 * 60 * 60 * 24; // 24h hard ceiling on stale cache

/**
 * Mount the passport widget.
 *
 * @param {import('../viewer.js').Viewer} viewer    The three.js viewer instance.
 * @param {object} config                           Passport config (see widget-types.js passport schema).
 * @param {HTMLElement} container                   Root container. The widget takes this over.
 * @param {string} [widgetId]                       Optional cache-busting key.
 * @returns {Promise<{ destroy: () => void }>}
 */
export async function mountPassport(viewer, config, container, widgetId) {
	const state = {
		config,
		widgetId: widgetId || `${config.chain}:${config.agentId}`,
		cacheKey: `${CACHE_PREFIX}${config.chain}:${config.agentId}`,
		chainId: resolveChainId(config.chain),
		data: null,
		lastVerifiedAt: null,
		destroyed: false,
		pollTimer: null,
		visibilityHandler: null,
	};

	_applyTurntable(viewer, config);
	_kioskifyCanvas(viewer, container);

	const panel = document.createElement('div');
	panel.className = `passport-panel passport-layout--${config.layout} passport-badge-size--${config.badgeSize}`;
	container.appendChild(panel);

	const root = container;
	root.classList.add('passport-widget', `passport-root--${config.layout}`);

	_renderLoading(panel, config);

	// Hydrate from cache immediately so the panel has content before RPC responds.
	const cached = _readCache(state.cacheKey);
	if (cached && cached.data) {
		state.data = cached.data;
		state.lastVerifiedAt = cached.savedAt;
		_render(panel, state);
	}

	await _refresh(state, panel);

	if (config.refreshIntervalSec > 0) {
		const tick = () => {
			if (state.destroyed) return;
			if (document.hidden) return;
			_refresh(state, panel).catch(() => { /* keep stale */ });
		};
		state.pollTimer = setInterval(tick, config.refreshIntervalSec * 1000);

		state.visibilityHandler = () => {
			if (!document.hidden) tick();
		};
		document.addEventListener('visibilitychange', state.visibilityHandler);
	}

	return {
		destroy() {
			state.destroyed = true;
			if (state.pollTimer) clearInterval(state.pollTimer);
			if (state.visibilityHandler) {
				document.removeEventListener('visibilitychange', state.visibilityHandler);
			}
			panel.remove();
			root.classList.remove('passport-widget', `passport-root--${config.layout}`);
		},
	};
}

// ---------------------------------------------------------------------------
// RPC + contract reads
// ---------------------------------------------------------------------------

function _pickRpc(config, chainId) {
	if (config.rpcURL) {
		// Require HTTPS per the security spec.
		if (!/^https:\/\//i.test(config.rpcURL)) {
			console.warn('[passport] ignoring non-HTTPS rpcURL');
		} else {
			return config.rpcURL;
		}
	}
	return PUBLIC_RPCS[chainId] || null;
}

async function _refresh(state, panel) {
	const { config, chainId } = state;

	if (!chainId) {
		_renderError(panel, `Unknown chain "${config.chain}".`, state);
		return;
	}
	const deployment = REGISTRY_DEPLOYMENTS[chainId];
	if (!deployment || !deployment.identityRegistry) {
		_renderError(panel, `No ERC-8004 registry deployed on ${chainLabel(chainId)}.`, state);
		return;
	}
	if (!config.agentId) {
		_renderError(panel, 'No agent id configured.', state);
		return;
	}
	if (!/^\d+$/.test(String(config.agentId))) {
		_renderError(panel, 'Invalid agent id.', state);
		return;
	}

	const rpcURL = _pickRpc(config, chainId);
	if (!rpcURL) {
		_renderError(panel, `No RPC available for ${chainLabel(chainId)}.`, state);
		return;
	}

	try {
		const provider = new JsonRpcProvider(rpcURL, chainId, { staticNetwork: true });
		const identity = new Contract(deployment.identityRegistry, IDENTITY_REGISTRY_ABI, provider);
		const reputation = deployment.reputationRegistry
			? new Contract(deployment.reputationRegistry, REPUTATION_REGISTRY_ABI, provider)
			: null;

		const agentId = BigInt(config.agentId);

		// ownerOf will revert for non-existent tokens; catch that specifically.
		const [ownerRes, tokenURIRes, nameRes, symbolRes, repRes] = await Promise.allSettled([
			identity.ownerOf(agentId),
			identity.tokenURI(agentId),
			identity.name(),
			identity.symbol(),
			reputation && config.showReputation
				? reputation.getReputation(agentId)
				: Promise.resolve(null),
		]);

		if (ownerRes.status === 'rejected') {
			_renderError(panel, 'Agent not found on this chain.', state);
			return;
		}

		const wallet = ownerRes.value;
		const tokenURI = tokenURIRes.status === 'fulfilled' ? tokenURIRes.value : '';
		const name = nameRes.status === 'fulfilled' ? nameRes.value : '';
		const symbol = symbolRes.status === 'fulfilled' ? symbolRes.value : '';
		let reputationData = null;
		if (repRes.status === 'fulfilled' && repRes.value) {
			const [total, count] = repRes.value;
			const n = Number(count);
			const t = Number(total);
			reputationData = { total: t, count: n, average: n === 0 ? 0 : t / n };
		}

		let feedback = [];
		if (reputation && config.showRecentFeedback) {
			feedback = await _fetchRecentFeedback(reputation, agentId, provider).catch(() => []);
		}

		let manifest = null;
		if (tokenURI) {
			manifest = await _fetchManifest(tokenURI).catch(() => null);
		}

		state.data = { wallet, tokenURI, name, symbol, reputation: reputationData, feedback, manifest };
		state.lastVerifiedAt = Date.now();

		_writeCache(state.cacheKey, { data: state.data, savedAt: state.lastVerifiedAt });
		_render(panel, state);
	} catch (err) {
		console.warn('[passport] refresh failed:', err.message || err);
		// Leave whatever stale data we had; update the status label.
		_render(panel, state, { staleReason: 'RPC error' });
	}
}

/**
 * Query the last N ReputationSubmitted events for this agent.
 * Scoped to the recent history to avoid full-log scans.
 */
async function _fetchRecentFeedback(contract, agentId, provider) {
	const latest = await provider.getBlockNumber();
	const LOOKBACK = 200_000;
	const fromBlock = Math.max(0, latest - LOOKBACK);
	const filter = contract.filters.ReputationSubmitted(agentId);
	const events = await contract.queryFilter(filter, fromBlock, latest);
	return events
		.slice(-5)
		.reverse()
		.map((ev) => ({
			from: ev.args.submitter,
			score: Number(ev.args.score),
			comment: _sanitizeText(ev.args.comment || ''),
			txHash: ev.transactionHash,
		}));
}

async function _fetchManifest(tokenURI) {
	const resolved = isDecentralizedURI(tokenURI) ? resolveURI(tokenURI) : tokenURI;
	if (!/^https?:\/\//i.test(resolved)) return null;
	const res = await fetch(resolved, { mode: 'cors' });
	if (!res.ok) throw new Error(`manifest fetch ${res.status}`);
	const ct = res.headers.get('content-type') || '';
	if (!ct.includes('json') && !resolved.endsWith('.json')) {
		// Only fetch JSON — never render tokenURI HTML.
		return null;
	}
	const json = await res.json();
	return _pickManifestFields(json);
}

/** Allow-list the fields we render. Drop everything else. */
function _pickManifestFields(raw) {
	if (!raw || typeof raw !== 'object') return null;
	return {
		name:         typeof raw.name === 'string'        ? raw.name.slice(0, 120)        : '',
		description:  typeof raw.description === 'string' ? raw.description.slice(0, 500) : '',
		image:        typeof raw.image === 'string'       ? raw.image                     : '',
		agentRegistry: typeof raw.agentRegistry === 'string' ? raw.agentRegistry.slice(0, 200) : '',
	};
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function _renderLoading(panel, config) {
	panel.innerHTML = `
		<div class="passport-card" role="status">
			<div class="passport-skeleton">
				<div class="passport-skeleton-row"></div>
				<div class="passport-skeleton-row short"></div>
				<div class="passport-skeleton-row"></div>
			</div>
			<span class="passport-loading-label">Loading on-chain identity…</span>
		</div>
		${config.showPoweredBy ? _poweredByHTML(config) : ''}
	`;
}

function _renderError(panel, message, state) {
	const { config } = state;
	panel.innerHTML = `
		<div class="passport-card passport-card--error" role="alert">
			<div class="passport-error-icon" aria-hidden="true">!</div>
			<div class="passport-error-msg">${_escapeHTML(message)}</div>
		</div>
		${config.showPoweredBy ? _poweredByHTML(config) : ''}
	`;
}

function _render(panel, state, opts = {}) {
	const { config, chainId, data, lastVerifiedAt } = state;
	if (!data) {
		// No data and no error path yet — leave whatever's up.
		return;
	}

	const explorer = EXPLORERS[chainId] || '';
	const walletShort = _shortAddr(data.wallet);
	const agentName = data.manifest?.name || data.name || `Agent #${config.agentId}`;
	const verifiedISO = lastVerifiedAt ? new Date(lastVerifiedAt).toISOString() : '';
	const verifiedRel = lastVerifiedAt ? _relativeTime(lastVerifiedAt) : '';
	const stale = Boolean(opts.staleReason);

	const repBlock = (config.showReputation && data.reputation) ? `
		<div class="passport-row passport-row--reputation">
			<span class="passport-star" aria-hidden="true">★</span>
			<span class="passport-rep-avg">${data.reputation.count === 0 ? '—' : data.reputation.average.toFixed(2)}</span>
			<span class="passport-rep-count">(${data.reputation.count} ${data.reputation.count === 1 ? 'review' : 'reviews'})</span>
		</div>
	` : '';

	const feedbackBlock = (config.showRecentFeedback && data.feedback && data.feedback.length) ? `
		<div class="passport-section passport-section--feedback">
			<div class="passport-section-title">Recent feedback</div>
			<ul class="passport-feedback-list">
				${data.feedback.map((f) => `
					<li class="passport-feedback-item">
						<span class="passport-feedback-comment">${_escapeHTML(f.comment || '—')}</span>
						<span class="passport-feedback-meta">${_shortAddr(f.from)} · ${f.score}★</span>
					</li>
				`).join('')}
			</ul>
		</div>
	` : '';

	const jsonBlock = (config.showRegistrationJSON && data.tokenURI) ? `
		<div class="passport-section passport-section--json">
			<a class="passport-json-link" href="${_escapeAttr(_resolveForLink(data.tokenURI))}" target="_blank" rel="noopener noreferrer">
				View passport JSON ↗
			</a>
		</div>
	` : '';

	const explorerLink = explorer ? `
		<a class="passport-explorer-link" href="${_escapeAttr(`${explorer}/address/${data.wallet}`)}" target="_blank" rel="noopener noreferrer" title="View on explorer">↗</a>
	` : '';

	const chainSlug = chainLabel(chainId);

	const staleBanner = stale ? `
		<div class="passport-stale">Offline · last verified ${_escapeHTML(verifiedRel)}</div>
	` : '';

	if (config.layout === 'badge') {
		panel.innerHTML = `
			<div class="passport-badge" role="group" aria-label="ERC-8004 Passport">
				<div class="passport-badge-name" title="${_escapeAttr(agentName)}">${_escapeHTML(agentName)}</div>
				<div class="passport-badge-line">
					<span class="passport-badge-id">#${_escapeHTML(String(config.agentId))}</span>
					<span class="passport-badge-sep">·</span>
					<span class="passport-badge-chain">${_escapeHTML(chainSlug)}</span>
					<span class="passport-badge-check" aria-label="Registered on-chain">✓</span>
				</div>
				${config.showReputation && data.reputation ? `
					<div class="passport-badge-rep">
						<span class="passport-star" aria-hidden="true">★</span>
						${data.reputation.count === 0 ? '—' : data.reputation.average.toFixed(2)}
					</div>
				` : ''}
				${staleBanner}
			</div>
			${config.showPoweredBy ? _poweredByHTML(config) : ''}
		`;
		return;
	}

	panel.innerHTML = `
		<div class="passport-card">
			<div class="passport-header">
				<div class="passport-name">${_escapeHTML(agentName)}</div>
				<div class="passport-check" aria-label="Registered on-chain" title="Registered on-chain">✓</div>
			</div>
			<div class="passport-subhead">
				<span class="passport-id">Agent #${_escapeHTML(String(config.agentId))}</span>
				<span class="passport-sep">·</span>
				<span class="passport-chain">${_escapeHTML(chainSlug)}</span>
			</div>
			<div class="passport-wallet-row">
				<button type="button" class="passport-wallet" data-copy="${_escapeAttr(data.wallet)}" title="Copy ${_escapeAttr(data.wallet)}">
					${_escapeHTML(walletShort)}
				</button>
				${explorerLink}
			</div>
			${repBlock}
			${feedbackBlock}
			${jsonBlock}
			${lastVerifiedAt ? `
				<div class="passport-verified" title="${_escapeAttr(verifiedISO)}">
					${stale ? 'Last verified' : 'Verified'} ${_escapeHTML(verifiedRel)}
				</div>
			` : ''}
		</div>
		${config.showPoweredBy ? _poweredByHTML(config) : ''}
	`;

	const copyBtn = panel.querySelector('.passport-wallet[data-copy]');
	if (copyBtn) {
		copyBtn.addEventListener('click', () => {
			const addr = copyBtn.dataset.copy;
			if (!addr) return;
			navigator.clipboard?.writeText(addr).then(() => {
				copyBtn.classList.add('passport-wallet--copied');
				setTimeout(() => copyBtn.classList.remove('passport-wallet--copied'), 1200);
			}).catch(() => { /* ignore */ });
		});
	}
}

function _poweredByHTML(_config) {
	return `
		<a class="passport-powered-by" href="https://3dagent.vercel.app" target="_blank" rel="noopener noreferrer">
			3dagent
		</a>
	`;
}

// ---------------------------------------------------------------------------
// Viewer setup
// ---------------------------------------------------------------------------

function _applyTurntable(viewer, config) {
	if (!viewer || !viewer.controls) return;
	if (config.autoRotate === false) return;
	viewer.state.autoRotate = true;
	viewer.controls.autoRotate = true;
	viewer.controls.autoRotateSpeed = (config.rotationSpeed ?? 0.6) * 4;
	viewer.invalidate?.();
}

function _kioskifyCanvas(_viewer, container) {
	// Reduce viewer chrome for embed contexts.
	const validator = document.querySelector('.validator-toggle');
	if (validator) validator.style.display = 'none';
	const header = document.querySelector('header');
	if (header) header.style.display = 'none';
	container.classList.add('passport-canvas-host');
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

function _readCache(key) {
	try {
		const raw = localStorage.getItem(key);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (!parsed?.savedAt) return null;
		if (Date.now() - parsed.savedAt > STALE_TTL_MS) return null;
		return parsed;
	} catch { return null; }
}

function _writeCache(key, payload) {
	try {
		// Wallet & tokenURI are strings. Only persist serialisable fields.
		const safe = {
			savedAt: payload.savedAt,
			data: {
				wallet:     payload.data.wallet,
				tokenURI:   payload.data.tokenURI,
				name:       payload.data.name,
				symbol:     payload.data.symbol,
				reputation: payload.data.reputation,
				feedback:   payload.data.feedback,
				manifest:   payload.data.manifest,
			},
		};
		localStorage.setItem(key, JSON.stringify(safe));
	} catch { /* quota / privacy mode — ignore */ }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function _shortAddr(addr) {
	if (!addr || typeof addr !== 'string') return '';
	if (addr.length < 12) return addr;
	return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function _escapeHTML(s) {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function _escapeAttr(s) {
	return _escapeHTML(s);
}

function _sanitizeText(s) {
	// Strip anything that looks like a tag. Feedback is plain text.
	return String(s ?? '').replace(/<[^>]*>/g, '').slice(0, 500);
}

function _relativeTime(ts) {
	const diff = Date.now() - ts;
	const sec = Math.floor(diff / 1000);
	if (sec < 60) return 'just now';
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m ago`;
	const hr = Math.floor(min / 60);
	if (hr < 24) return `${hr}h ago`;
	const day = Math.floor(hr / 24);
	return `${day}d ago`;
}

function _resolveForLink(uri) {
	return isDecentralizedURI(uri) ? resolveURI(uri) : uri;
}

// Re-export for Studio later.
export { CHAIN_SLUGS };
