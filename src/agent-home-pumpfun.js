/**
 * Pump.fun card on the agent home panel
 * --------------------------------------
 * Two states:
 *
 *   1. Agent has NOT launched a token  → "Launch coin" CTA
 *      Triggers pumpfun-self-launch-from-identity (server-signed).
 *
 *   2. Agent HAS launched a token      → Live status card
 *      Shows mint, market cap, % to graduation, buy/sell links.
 *      Refreshes every 30s by calling pumpfun-watch-curve.
 *
 * Detection: we read the agent's memory for the `pumpfun:launch` tag
 * (written by agent-skills-pumpfun-hooks.js). If absent, we also try
 * /api/agents/:id (in case the launch happened from a different device
 * and was persisted to meta.pumpfun_mint).
 */

const REFRESH_MS = 30_000;

export function mountPumpFunCard({ panel, identity, skills, memory }) {
	if (!panel || !identity?.id) return null;

	const root = document.createElement('section');
	root.className = 'agent-home-pumpfun';
	panel.appendChild(root);

	let state = { mint: null, symbol: null, network: 'mainnet', loading: true };
	let refreshTimer = null;

	const launchCard = () => `
		<div class="pumpfun-card pumpfun-card--cta">
			<div class="pumpfun-card-head">
				<span class="pumpfun-card-icon">◎</span>
				<span class="pumpfun-card-title">Launch coin on pump.fun</span>
			</div>
			<p class="pumpfun-card-sub">Mint a token whose metadata is your 3D avatar. The agent signs from its own wallet.</p>
			<button class="pumpfun-btn pumpfun-btn--primary" id="pf-launch-btn">
				Launch ${deriveSymbol(identity.name)}
			</button>
			<a class="pumpfun-card-foot" href="https://pump.fun" target="_blank" rel="noopener">What is pump.fun?</a>
		</div>
	`;

	const statusCard = (s) => {
		const pct = s.progressPct != null ? `${s.progressPct.toFixed(1)}%` : '—';
		const cap = s.marketCap ? formatLamports(s.marketCap) : '—';
		const explorer = s.network === 'devnet'
			? `https://pump.fun/coin/${s.mint}?cluster=devnet`
			: `https://pump.fun/coin/${s.mint}`;
		const grad = s.graduated;
		return `
			<div class="pumpfun-card ${grad ? 'pumpfun-card--graduated' : ''}">
				<div class="pumpfun-card-head">
					<span class="pumpfun-card-icon">${grad ? '🎓' : '◎'}</span>
					<span class="pumpfun-card-title">${escapeHtml(s.symbol || 'Token')}</span>
					<a class="pumpfun-card-link" href="${explorer}" target="_blank" rel="noopener" title="View on pump.fun">↗</a>
				</div>
				<div class="pumpfun-stats">
					<div class="pumpfun-stat">
						<span class="pumpfun-stat-label">Market cap</span>
						<span class="pumpfun-stat-value">${cap}</span>
					</div>
					<div class="pumpfun-stat">
						<span class="pumpfun-stat-label">${grad ? 'Status' : 'To graduation'}</span>
						<span class="pumpfun-stat-value">${grad ? 'Graduated' : pct}</span>
					</div>
				</div>
				${grad ? '' : `<div class="pumpfun-progress"><div class="pumpfun-progress-bar" style="width:${Math.min(100, s.progressPct || 0)}%"></div></div>`}
				<div class="pumpfun-card-mint" title="${escapeAttr(s.mint)}">${shortMint(s.mint)}</div>
				<div class="pumpfun-card-actions">
					<button class="pumpfun-btn" data-action="buy">Buy</button>
					<button class="pumpfun-btn" data-action="sell">Sell</button>
					<button class="pumpfun-btn pumpfun-btn--ghost" data-action="claim">Claim fees</button>
				</div>
			</div>
		`;
	};

	const skeleton = () => `<div class="pumpfun-card pumpfun-card--skeleton"></div>`;

	const render = () => {
		if (state.loading) {
			root.innerHTML = skeleton();
			return;
		}
		root.innerHTML = state.mint ? statusCard(state) : launchCard();
		bind();
	};

	const bind = () => {
		const launchBtn = root.querySelector('#pf-launch-btn');
		if (launchBtn) {
			launchBtn.addEventListener('click', async () => {
				launchBtn.disabled = true;
				launchBtn.textContent = 'Launching…';
				try {
					const r = await skills?.perform(
						'pumpfun-self-launch-from-identity',
						{ network: state.network },
						{ identity },
					);
					if (r?.success && r.data?.mint) {
						state = { ...state, mint: r.data.mint, symbol: r.data.symbol, loading: true };
						await refresh();
					} else {
						launchBtn.disabled = false;
						launchBtn.textContent = `Retry launch ${deriveSymbol(identity.name)}`;
					}
				} catch {
					launchBtn.disabled = false;
					launchBtn.textContent = 'Launch failed — retry';
				}
			});
		}
		root.querySelectorAll('[data-action]').forEach((btn) => {
			btn.addEventListener('click', () => handleAction(btn.dataset.action));
		});
	};

	const handleAction = async (action) => {
		if (!state.mint || !skills) return;
		if (action === 'claim') {
			await skills.perform('pumpfun-claim-fees', { network: state.network }, { identity });
			return;
		}
		const amount = window.prompt(
			action === 'buy' ? 'Buy how many SOL?' : 'Sell how many tokens (raw units)?',
		);
		if (!amount) return;
		if (action === 'buy') {
			await skills.perform(
				'pumpfun-buy',
				{ mint: state.mint, solAmount: Number(amount), network: state.network },
				{ identity },
			);
		} else {
			await skills.perform(
				'pumpfun-sell',
				{ mint: state.mint, tokenAmount: amount, network: state.network },
				{ identity },
			);
		}
		await refresh();
	};

	const refresh = async () => {
		const found = resolveMintFrom(memory, identity);
		state = { ...state, ...found, loading: false };
		render();
		if (state.mint && skills) {
			try {
				const r = await skills.perform(
					'pumpfun-watch-curve',
					{ mint: state.mint, network: state.network },
					{ identity },
				);
				if (r?.success && r.data) {
					state = { ...state, ...r.data };
					render();
				}
			} catch {
				/* swallow */
			}
		}
	};

	refresh();
	refreshTimer = setInterval(() => state.mint && refresh(), REFRESH_MS);

	return {
		destroy() {
			if (refreshTimer) clearInterval(refreshTimer);
			root.remove();
		},
		refresh,
	};
}

function resolveMintFrom(memory, identity) {
	try {
		if (memory?.recall) {
			const hits = memory.recall('pumpfun:launch') || [];
			const latest = hits.sort((a, b) => (b.context?.launchedAt || 0) - (a.context?.launchedAt || 0))[0];
			if (latest?.context?.mint) {
				return {
					mint: latest.context.mint,
					symbol: latest.context.symbol,
					network: latest.context.network || 'mainnet',
				};
			}
		}
	} catch {
		/* ignore */
	}
	const meta = identity?.meta || {};
	if (meta.pumpfun_mint) {
		return {
			mint: meta.pumpfun_mint,
			symbol: meta.pumpfun_symbol,
			network: meta.pumpfun_network || 'mainnet',
		};
	}
	return { mint: null, symbol: null };
}

function deriveSymbol(name) {
	return (
		String(name || 'AGENT')
			.toUpperCase()
			.replace(/[^A-Z0-9]/g, '')
			.slice(0, 10) || 'AGENT'
	);
}

function shortMint(m) {
	if (!m) return '';
	return `${m.slice(0, 6)}…${m.slice(-4)}`;
}

function formatLamports(lamports) {
	const n = Number(lamports) / 1e9;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}K SOL`;
	if (n >= 1) return `${n.toFixed(2)} SOL`;
	return `${n.toFixed(4)} SOL`;
}

function escapeHtml(s) {
	return String(s || '').replace(/[&<>"']/g, (c) => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#39;',
	})[c]);
}

function escapeAttr(s) {
	return escapeHtml(s);
}
