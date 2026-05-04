/**
 * /my-agents — personal on-chain agent page.
 * Fetches agents owned by the signed-in user's linked wallets and renders them
 * as importable cards.
 */

async function fetchDiscoveredAgents() {
	const res = await fetch('/api/erc8004/hydrate', { method: 'GET', credentials: 'include' });
	if (!res.ok) {
		const error = await res.json().catch(() => ({}));
		throw new Error(error.error_description || `HTTP ${res.status}`);
	}
	const data = await res.json();
	return data.agents || [];
}

async function fetchNormalAgents() {
	const res = await fetch('/api/agents', { method: 'GET', credentials: 'include' });
	if (!res.ok) {
		const error = await res.json().catch(() => ({}));
		throw new Error(error.error_description || `HTTP ${res.status}`);
	}
	const data = await res.json();
	return data.agents || [];
}

async function importAgent({ chainId, agentId }) {
	const res = await fetch('/api/erc8004/import', {
		method: 'POST',
		credentials: 'include',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ chainId, agentId }),
	});
	if (!res.ok) {
		const error = await res.json().catch(() => ({}));
		throw new Error(error.error_description || `HTTP ${res.status}`);
	}
	const data = await res.json();
	return data.agent;
}

/** @type {Record<number, string>} Minimal chain name map to avoid importing chain-meta.js deps. */
const CHAIN_NAMES = {
	1: 'Ethereum',
	10: 'Optimism',
	56: 'BNB Chain',
	97: 'BSC Testnet',
	100: 'Gnosis',
	137: 'Polygon',
	250: 'Fantom',
	324: 'zkSync Era',
	1284: 'Moonbeam',
	5000: 'Mantle',
	8453: 'Base',
	42161: 'Arbitrum',
	42220: 'Celo',
	43113: 'Avalanche Fuji',
	43114: 'Avalanche',
	59144: 'Linea',
	80002: 'Polygon Amoy',
	84532: 'Base Sepolia',
	421614: 'Arb Sepolia',
	534352: 'Scroll',
	11155111: 'Sepolia',
	11155420: 'OP Sepolia',
};

/** @param {number} id */
function chainName(id) {
	return CHAIN_NAMES[id] || `Chain ${id}`;
}

/** @param {string} text @returns {string} */
function escapeHtml(text) {
	if (text == null) return '';
	const d = document.createElement('div');
	d.textContent = String(text);
	return d.innerHTML;
}

// ── Session ──────────────────────────────────────────────────────────────────

/** @returns {Promise<object|null>} */
async function getSession() {
	try {
		const res = await fetch('/api/auth/me', { credentials: 'include' });
		if (!res.ok) return null;
		const { user } = await res.json();
		return user ?? null;
	} catch {
		return null;
	}
}

// ── Rendering helpers ─────────────────────────────────────────────────────────

const grid = /** @type {HTMLElement} */ (document.getElementById('my-agents-grid'));
const errorBanner = /** @type {HTMLElement} */ (document.getElementById('my-agents-error'));

/** Show N skeleton cards in the grid. */
function showSkeletons(n = 6) {
	grid.innerHTML = Array.from(
		{ length: n },
		() => `
		<div class="my-agents-skeleton" aria-hidden="true">
			<div class="my-agents-skeleton__thumb"></div>
			<div class="my-agents-skeleton__body">
				<div class="my-agents-skeleton__line"></div>
				<div class="my-agents-skeleton__line my-agents-skeleton__line--short"></div>
				<div class="my-agents-skeleton__line my-agents-skeleton__line--btn"></div>
			</div>
		</div>`,
	).join('');
}

/**
 * @param {string} icon
 * @param {string} title
 * @param {string} msg
 * @param {{ label: string, href: string }|null} [cta]
 * @param {{ label: string, href: string }|null} [secondary]
 */
function showState(icon, title, msg, cta = null, secondary = null) {
	grid.innerHTML = `
		<div class="my-agents-state" style="grid-column: 1 / -1" role="status">
			<div class="my-agents-state__icon" aria-hidden="true">${icon}</div>
			<p class="my-agents-state__title">${escapeHtml(title)}</p>
			<p class="my-agents-state__msg">${escapeHtml(msg)}</p>
			${cta ? `<a class="my-agents-btn" style="display:inline-block;width:auto;padding:9px 22px" href="${escapeHtml(cta.href)}">${escapeHtml(cta.label)}</a>` : ''}
			${secondary ? `<div><a class="my-agents-secondary" href="${escapeHtml(secondary.href)}">${escapeHtml(secondary.label)}</a></div>` : ''}
		</div>`;
}

/**
 * @param {string} msg
 * @param {boolean | (() => void)} retry  true → default loadAgents; function → custom; false → no button
 */
function showErrorBanner(msg, retry = true) {
	const showRetry = retry !== false;
	errorBanner.innerHTML = `
		<span class="my-agents-error-banner__msg">${escapeHtml(msg)}</span>
		${showRetry ? `<button class="my-agents-btn my-agents-btn--sec" id="my-agents-retry" style="width:auto;padding:7px 14px;font-size:12px" aria-label="Retry loading agents">Retry</button>` : ''}`;
	errorBanner.hidden = false;
	if (showRetry) {
		const handler = typeof retry === 'function' ? retry : () => loadAgents();
		document.getElementById('my-agents-retry')?.addEventListener('click', () => {
			errorBanner.hidden = true;
			grid.innerHTML = '';
			handler();
		});
	}
}

/**
 * Render one agent card.
 * @param {{ chainId: number, agentId: string, name: string, description: string, image: string|null, glbUrl: string|null, alreadyImported?: boolean, isNormal?: boolean, onChain?: boolean }} agent
 * @returns {HTMLElement}
 */
function buildCard(agent) {
	const card = document.createElement('article');
	card.className = 'my-agents-card';
	card.setAttribute('aria-label', `Agent: ${agent.name}`);

	const thumbSrc = agent.glbUrl || agent.image;
	const thumbHtml = thumbSrc
		? `<img src="${escapeHtml(thumbSrc)}" alt="${escapeHtml(agent.name)} preview" loading="lazy" />`
		: `<span aria-hidden="true">${agent.isNormal ? '◎' : '🤖'}</span>`;

	card.innerHTML = `
		<div class="my-agents-card__thumb">${thumbHtml}</div>
		<div class="my-agents-card__body">
			<h2 class="my-agents-card__name" title="${escapeHtml(agent.name)}">${escapeHtml(agent.name)}</h2>
			<div class="my-agents-card__row">
				${agent.chainId ? `<span class="my-agents-card__chain-pill" title="Chain ID ${escapeHtml(String(agent.chainId))}">${escapeHtml(chainName(agent.chainId))}</span>` : ''}
			</div>
			${agent.description ? `<p class="my-agents-card__desc">${escapeHtml(agent.description)}</p>` : ''}
		</div>
		<div class="my-agents-card__footer">
			<div class="my-agents-card__action-wrap"></div>
		</div>`;

	const wrap = /** @type {HTMLElement} */ (card.querySelector('.my-agents-card__action-wrap'));
	_renderCardAction(wrap, agent);
	return card;
}

/**
 * @param {HTMLElement} wrap
 * @param {{ chainId: number, agentId: string, name: string, alreadyImported?: boolean, isNormal?: boolean }} agent
 * @param {string|null} [importedId]
 */
function _renderCardAction(wrap, agent, importedId = null) {
	if (agent.isNormal) {
		wrap.innerHTML = `<a class="my-agents-btn" href="/agent/${escapeHtml(agent.agentId)}">Open</a>`;
		return;
	}

	if (agent.alreadyImported || importedId) {
		const id = importedId || '';
		wrap.innerHTML = `
			<button class="my-agents-btn my-agents-btn--done" disabled aria-label="Agent already in library">Already in library</button>
			${id ? `<a class="my-agents-card__agent-link" href="/agent/${escapeHtml(id)}">Open agent →</a>` : ''}`;
		return;
	}

	const btn = document.createElement('button');
	btn.className = 'my-agents-btn';
	btn.textContent = 'Import';
	btn.setAttribute('aria-label', `Import ${agent.name}`);
	btn.addEventListener('click', () => _handleImport(btn, wrap, agent));
	wrap.appendChild(btn);
}

/**
 * @param {HTMLButtonElement} btn
 * @param {HTMLElement} wrap
 * @param {{ chainId: number, agentId: string, name: string }} agent
 */
async function _handleImport(btn, wrap, agent) {
	btn.disabled = true;
	btn.textContent = 'Importing…';

	// Clear any previous inline error
	const prev = wrap.querySelector('.my-agents-card__inline-err');
	if (prev) prev.remove();

	try {
		const result = await importAgent({ chainId: agent.chainId, agentId: agent.agentId });
		_renderCardAction(wrap, { ...agent, alreadyImported: true }, result.id);
	} catch (err) {
		btn.disabled = false;
		btn.textContent = 'Import';
		const errEl = document.createElement('span');
		errEl.className = 'my-agents-card__inline-err';
		errEl.textContent = err.message || 'Import failed';
		errEl.setAttribute('role', 'alert');
		wrap.appendChild(errEl);
	}
}

// ── Main load ─────────────────────────────────────────────────────────────────

async function loadAgents() {
	showSkeletons();

	try {
		const [onChainAgents, normalAgents] = await Promise.all([
			fetchDiscoveredAgents().catch(e => { console.error("Error fetching on-chain agents:", e); return []; }),
			fetchNormalAgents().catch(e => { console.error("Error fetching normal agents:", e); return []; })
		]);

		const onChainAgentsMap = new Map();
		for (const agent of onChainAgents) {
			onChainAgentsMap.set(`${agent.chainId}:${agent.agentId}`, agent);
		}

		const allAgents = [];
		const processedOnChain = new Set();

		// Add normal agents, and if they are on-chain, merge info
		for (const agent of normalAgents) {
			const onChainKey = `${agent.chain_id}:${agent.erc8004_agent_id}`;
			const onChainData = onChainAgentsMap.get(onChainKey);

			const cardData = {
				chainId: agent.chain_id,
				agentId: agent.id, // Internal UUID
				name: agent.name,
				description: agent.description,
				image: agent.avatar_id ? `/api/avatars/${agent.avatar_id}/thumbnail` : (onChainData ? onChainData.image : null),
				glbUrl: onChainData ? onChainData.glbUrl : null,
				isNormal: true,
				onChain: !!onChainData
			};
			allAgents.push(cardData);

			if (onChainData) {
				processedOnChain.add(onChainKey);
			}
		}

		// Add on-chain agents that haven't been imported yet
		for (const agent of onChainAgents) {
			const onChainKey = `${agent.chainId}:${agent.agentId}`;
			if (!processedOnChain.has(onChainKey)) {
				allAgents.push({
					...agent, // has name, description, image, glbUrl
					isNormal: false,
					onChain: true
				});
			}
		}

		grid.innerHTML = '';

		if (allAgents.length === 0) {
			showState(
				'🔭',
				'No agents yet',
				'No agents found. Link a wallet or create a new agent.',
				{ label: 'Create an agent', href: '/create' },
				{ label: 'Browse community agents →', href: '/discover' },
			);
			return;
		}

		document.querySelector('.my-agents-title').textContent = 'My Agents';
		document.querySelector('.my-agents-subtitle').textContent = 'Agents from your account and linked wallets';

		for (const agent of allAgents) {
			grid.appendChild(buildCard(agent));
		}

	} catch (err) {
		grid.innerHTML = '';
		const msg = err.message || '';
		if (msg.includes('429') || /too many/i.test(msg)) {
			showErrorBanner('Too many requests. Try again in a minute.', true);
		} else {
			showErrorBanner(msg || 'Failed to load agents.', true);
		}
	}
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

(async () => {
	const user = await getSession();

	if (!user) {
		showState(
			'🔐',
			'Sign in to see your agents',
			'Link a wallet and sign in to see your on-chain agents.',
			{ label: 'Sign in', href: '/login.html' },
			{ label: 'Or browse community agents →', href: '/discover' },
		);
		return;
	}

	// Check if user has linked wallets before hitting hydrate. If the wallets API
	// itself fails, surface a retry instead of silently falling through to hydrate
	// (which would render a misleading "Failed to load agents" for a no-wallet user).
	let wallets = null;
	try {
		const walletsRes = await fetch('/api/auth/wallets', { credentials: 'include' });
		if (walletsRes.ok) {
			({ wallets } = await walletsRes.json());
		} else {
			throw new Error(`wallets ${walletsRes.status}`);
		}
	} catch {
		showErrorBanner('Could not check linked wallets. Tap retry.', () => location.reload());
		return;
	}

	if (!wallets || wallets.length === 0) {
		showState(
			'👛',
			'No wallets linked',
			'Link a wallet to see your on-chain agents.',
			{ label: 'Link a wallet', href: '/dashboard/wallets.html' },
			{ label: 'Or browse community agents →', href: '/discover' },
		);
		return;
	}

	await loadAgents();
})();
