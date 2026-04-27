/**
 * On-chain agent discovery page logic.
 * Fetches agents owned by the signed-in user's linked wallets and renders them
 * as importable cards.
 */

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

const grid = /** @type {HTMLElement} */ (document.getElementById('discover-grid'));
const errorBanner = /** @type {HTMLElement} */ (document.getElementById('discover-error'));

/** Show N skeleton cards in the grid. */
function showSkeletons(n = 6) {
	grid.innerHTML = Array.from(
		{ length: n },
		() => `
		<div class="discover-skeleton" aria-hidden="true">
			<div class="discover-skeleton__thumb"></div>
			<div class="discover-skeleton__body">
				<div class="discover-skeleton__line"></div>
				<div class="discover-skeleton__line discover-skeleton__line--short"></div>
				<div class="discover-skeleton__line discover-skeleton__line--btn"></div>
			</div>
		</div>`,
	).join('');
}

/**
 * @param {string} icon
 * @param {string} title
 * @param {string} msg
 * @param {{ label: string, href: string }|null} [cta]
 */
function showState(icon, title, msg, cta = null) {
	grid.innerHTML = `
		<div class="discover-state" style="grid-column: 1 / -1" role="status">
			<div class="discover-state__icon" aria-hidden="true">${icon}</div>
			<p class="discover-state__title">${escapeHtml(title)}</p>
			<p class="discover-state__msg">${escapeHtml(msg)}</p>
			${cta ? `<a class="discover-btn" style="display:inline-block;width:auto;padding:9px 22px" href="${escapeHtml(cta.href)}">${escapeHtml(cta.label)}</a>` : ''}
		</div>`;
}

/**
 * @param {string} msg
 * @param {boolean} showRetry
 */
function showErrorBanner(msg, showRetry = true) {
	errorBanner.innerHTML = `
		<span class="discover-error-banner__msg">${escapeHtml(msg)}</span>
		${showRetry ? `<button class="discover-btn discover-btn--sec" id="discover-retry" style="width:auto;padding:7px 14px;font-size:12px" aria-label="Retry loading agents">Retry</button>` : ''}`;
	errorBanner.hidden = false;
	if (showRetry) {
		document.getElementById('discover-retry')?.addEventListener('click', () => {
			errorBanner.hidden = true;
			grid.innerHTML = '';
			loadAgents();
		});
	}
}

/**
 * Render one agent card.
 * @param {{ chainId: number, agentId: string, name: string, description: string, image: string|null, glbUrl: string|null, alreadyImported: boolean }} agent
 * @returns {HTMLElement}
 */
function buildCard(agent) {
	const card = document.createElement('article');
	card.className = 'discover-card';
	card.setAttribute('aria-label', `Agent: ${agent.name}`);

	const thumbSrc = agent.glbUrl || agent.image;
	const thumbHtml = thumbSrc
		? `<img src="${escapeHtml(thumbSrc)}" alt="${escapeHtml(agent.name)} preview" loading="lazy" />`
		: `<span aria-hidden="true">🤖</span>`;

	card.innerHTML = `
		<div class="discover-card__thumb">${thumbHtml}</div>
		<div class="discover-card__body">
			<h2 class="discover-card__name" title="${escapeHtml(agent.name)}">${escapeHtml(agent.name)}</h2>
			<div class="discover-card__row">
				<span class="discover-card__chain-pill" title="Chain ID ${escapeHtml(String(agent.chainId))}">${escapeHtml(chainName(agent.chainId))}</span>
			</div>
			${agent.description ? `<p class="discover-card__desc">${escapeHtml(agent.description)}</p>` : ''}
		</div>
		<div class="discover-card__footer">
			<div class="discover-card__action-wrap"></div>
		</div>`;

	const wrap = /** @type {HTMLElement} */ (card.querySelector('.discover-card__action-wrap'));
	_renderCardAction(wrap, agent);
	return card;
}

/**
 * @param {HTMLElement} wrap
 * @param {{ chainId: number, agentId: string, name: string, alreadyImported: boolean }} agent
 * @param {string|null} [importedId]
 */
function _renderCardAction(wrap, agent, importedId = null) {
	if (agent.alreadyImported || importedId) {
		const id = importedId || '';
		wrap.innerHTML = `
			<button class="discover-btn discover-btn--done" disabled aria-label="Agent already in library">Already in library</button>
			${id ? `<a class="discover-card__agent-link" href="/agent/${escapeHtml(id)}">Open agent →</a>` : ''}`;
		return;
	}

	const btn = document.createElement('button');
	btn.className = 'discover-btn';
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
	const prev = wrap.querySelector('.discover-card__inline-err');
	if (prev) prev.remove();

	try {
		const { importAgent } = await import('/src/erc8004/hydrate.js');
		const result = await importAgent({ chainId: agent.chainId, agentId: agent.agentId });
		_renderCardAction(wrap, { ...agent, alreadyImported: true }, result.id);
	} catch (err) {
		btn.disabled = false;
		btn.textContent = 'Import';
		const errEl = document.createElement('span');
		errEl.className = 'discover-card__inline-err';
		errEl.textContent = err.message || 'Import failed';
		errEl.setAttribute('role', 'alert');
		wrap.appendChild(errEl);
	}
}

// ── Main load ─────────────────────────────────────────────────────────────────

async function loadAgents() {
	showSkeletons();

	try {
		const { fetchDiscoveredAgents } = await import('/src/erc8004/hydrate.js');
		const agents = await fetchDiscoveredAgents();

		grid.innerHTML = '';

		if (agents.length === 0) {
			showState(
				'🔭',
				'No on-chain agents yet',
				'No ERC-8004 agents found in your linked wallets.',
				{ label: 'Browse community agents →', href: '/discover' },
			);
			return;
		}

		for (const agent of agents) {
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
			'Sign in to discover your agents',
			'Link a wallet and sign in to see your on-chain agents.',
			{ label: 'Sign in', href: '/login.html' },
		);
		return;
	}

	// Check if user has linked wallets before hitting hydrate
	try {
		const walletsRes = await fetch('/api/auth/wallets', { credentials: 'include' });
		if (walletsRes.ok) {
			const { wallets } = await walletsRes.json();
			if (!wallets || wallets.length === 0) {
				showState(
					'👛',
					'No wallets linked',
					'Link a wallet to see your on-chain agents.',
					{ label: 'Link a wallet', href: '/dashboard/wallets.html' },
				);
				return;
			}
		}
	} catch {
		// If wallet check fails, proceed to hydrate anyway — it will handle empty gracefully
	}

	await loadAgents();
})();
