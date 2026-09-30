// Earned card: what an agent has earned, on its public pages.
// ============================================================
// One number a builder can screenshot: lifetime creator fees from the coins the
// agent launched on pump.fun, in SOL with USD beside it, plus its service income
// (x402 skill sales and hires). Below it: claimed vs unclaimed, the per-coin
// breakdown, and every recorded claim with its Solscan link. Every figure comes
// from GET /api/agents/:id/earnings; the card never computes or invents one.
//
// Single source of truth: import mountEarningsCard and call it with a mount
// element and an agent id, never copy it per page. It returns a handle whose
// refresh() re-reads the endpoint and whose destroy() tears the card down.
//
// `onState(state)` reports 'loading' | 'empty' | 'zero' | 'earned' | 'error' so a
// host page can decide whether to show the surrounding card at all.

const STYLE_ID = 'tws-earnings-card-styles';

const esc = (s) =>
	String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const shortAddr = (a) => (a && a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a || '');

export function fmtSol(n) {
	const v = Number(n);
	if (!Number.isFinite(v) || v === 0) return '0 SOL';
	if (v < 0.001) return `${v.toFixed(6)} SOL`;
	if (v < 1) return `${v.toFixed(4)} SOL`;
	if (v < 1000) return `${v.toFixed(3)} SOL`;
	return `${Math.round(v).toLocaleString('en-US')} SOL`;
}

export function fmtUsd(n) {
	const v = Number(n);
	if (n == null || !Number.isFinite(v)) return '';
	if (v === 0) return '$0';
	if (v < 0.01) return '<$0.01';
	if (v < 1000) return `$${v.toFixed(2)}`;
	return `$${Math.round(v).toLocaleString('en-US')}`;
}

export function relTime(iso) {
	if (!iso) return '';
	const d = Date.now() - new Date(iso).getTime();
	if (!Number.isFinite(d)) return '';
	const s = Math.max(0, Math.round(d / 1000));
	if (s < 60) return 'just now';
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h}h ago`;
	const day = Math.round(h / 24);
	if (day < 30) return `${day}d ago`;
	return `${Math.round(day / 30)}mo ago`;
}

function ensureStyles() {
	if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
	const style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = `
.ern { display: flex; flex-direction: column; gap: var(--space-md, 1rem); font-family: var(--font-body, Inter, sans-serif); color: var(--ink, #e8e8e8); min-width: 0; }
.ern-sk { border-radius: var(--radius-md, 10px); background: linear-gradient(100deg, var(--skeleton-base, rgba(255,255,255,.04)) 30%, var(--skeleton-sheen, rgba(255,255,255,.09)) 50%, var(--skeleton-base, rgba(255,255,255,.04)) 70%); background-size: 200% 100%; animation: ern-shimmer 1.4s linear infinite; }
@keyframes ern-shimmer { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .ern-sk { animation: none; } }
.ern-sk-hero { height: 44px; width: 62%; }
.ern-sk-row { height: 14px; width: 100%; }
.ern-sk-row.short { width: 45%; }
.ern-hero { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.ern-total { font-family: var(--font-display, 'Space Grotesk', sans-serif); font-size: clamp(1.6rem, 5vw, 2.1rem); font-weight: 700; letter-spacing: -.02em; line-height: 1.05; color: var(--ink-bright, #fff); font-variant-numeric: tabular-nums; }
.ern-usd { font-family: var(--font-mono, 'JetBrains Mono', monospace); font-size: var(--text-md, .8125rem); color: var(--ink-dim, #999); }
.ern-rank { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; font-size: var(--text-xs, .72rem); font-weight: 600; color: var(--accent, #c4b5fd); background: var(--accent-soft, rgba(139,92,246,.12)); border: 1px solid var(--stroke, rgba(255,255,255,.1)); border-radius: var(--radius-pill, 999px); padding: 3px 10px; text-decoration: none; transition: border-color var(--duration-fast, .14s) var(--ease-standard, ease), transform var(--duration-fast, .14s) var(--ease-standard, ease); }
.ern-rank:hover { border-color: var(--stroke-strong, rgba(255,255,255,.25)); transform: translateY(-1px); }
.ern-rank:active { transform: translateY(0); }
.ern-sub { margin: -6px 0 0; font-size: var(--text-sm, .78rem); color: var(--ink-dim, #999); }
.ern-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; }
.ern-stat { border: 1px solid var(--stroke, rgba(255,255,255,.08)); background: var(--surface-1, rgba(255,255,255,.03)); border-radius: var(--radius-md, 10px); padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ern-stat-k { font-size: var(--text-2xs, .6875rem); text-transform: uppercase; letter-spacing: .06em; color: var(--ink-faint, #777); }
.ern-stat-v { font-family: var(--font-mono, monospace); font-size: var(--text-md, .8125rem); color: var(--ink, #e8e8e8); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.ern-stat-s { font-size: var(--text-2xs, .6875rem); color: var(--ink-dim, #999); }
.ern-h { margin: 0; font-size: var(--text-2xs, .6875rem); text-transform: uppercase; letter-spacing: .08em; color: var(--ink-faint, #777); font-weight: 600; }
.ern-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.ern-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--stroke, rgba(255,255,255,.08)); border-radius: var(--radius-md, 10px); background: var(--surface-1, rgba(255,255,255,.03)); min-width: 0; }
a.ern-row { color: inherit; text-decoration: none; transition: border-color var(--duration-fast, .14s) var(--ease-standard, ease), background var(--duration-fast, .14s) var(--ease-standard, ease); }
a.ern-row:hover { border-color: var(--stroke-strong, rgba(255,255,255,.22)); background: var(--surface-2, rgba(255,255,255,.05)); }
a.ern-row:active { background: var(--surface-3, rgba(255,255,255,.08)); }
.ern-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ern-row-t { font-weight: 600; font-size: var(--text-md, .8125rem); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ern-row-d { font-size: var(--text-2xs, .6875rem); color: var(--ink-dim, #999); overflow-wrap: anywhere; }
.ern-row-v { font-family: var(--font-mono, monospace); font-size: var(--text-sm, .78rem); text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.ern-row-v small { display: block; color: var(--ink-dim, #999); font-size: var(--text-2xs, .6875rem); }
.ern-pill { display: inline-block; font-size: 10px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; padding: 1px 6px; border-radius: var(--radius-pill, 999px); border: 1px solid var(--stroke, rgba(255,255,255,.12)); color: var(--ink-dim, #999); margin-left: 6px; vertical-align: 1px; }
.ern-pill.ok { color: var(--success, #34d399); border-color: color-mix(in srgb, var(--success, #34d399) 40%, transparent); }
.ern-foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: var(--text-2xs, .6875rem); color: var(--ink-faint, #777); }
.ern-foot.stale { color: var(--warn, #f59e0b); }
.ern-how summary { cursor: pointer; color: var(--ink-dim, #999); text-decoration: underline; text-underline-offset: 2px; border-radius: 4px; }
.ern-how summary:hover { color: var(--ink, #e8e8e8); }
.ern-how summary:focus-visible, .ern a:focus-visible, .ern button:focus-visible { outline: var(--focus-ring-width, 2px) solid var(--focus-ring-color, #a78bfa); outline-offset: var(--focus-ring-offset, 2px); }
.ern-how p { margin: 6px 0 0; line-height: 1.5; color: var(--ink-dim, #999); font-size: var(--text-xs, .72rem); }
.ern-empty { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; padding: 4px 0; }
.ern-empty p { margin: 0; font-size: var(--text-sm, .78rem); color: var(--ink-dim, #999); line-height: 1.5; }
.ern-btn { display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: var(--text-sm, .78rem); font-weight: 600; color: var(--ink-bright, #fff); background: var(--surface-2, rgba(255,255,255,.06)); border: 1px solid var(--stroke-strong, rgba(255,255,255,.18)); border-radius: var(--radius-pill, 999px); padding: 6px 14px; cursor: pointer; text-decoration: none; transition: background var(--duration-fast, .14s) var(--ease-standard, ease), transform var(--duration-fast, .14s) var(--ease-standard, ease); }
.ern-btn:hover { background: var(--surface-3, rgba(255,255,255,.1)); transform: translateY(-1px); }
.ern-btn:active { transform: translateY(0); }
.ern-err { color: var(--danger, #f87171); }
.ern-fade { animation: ern-in var(--duration-base, .24s) var(--ease-emphasized, cubic-bezier(.22,1,.36,1)) both; }
@keyframes ern-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .ern-fade { animation: none; } }
`;
	(document.head || document.documentElement).appendChild(style);
}

function skeleton() {
	return `<div class="ern" aria-busy="true" aria-label="Loading earnings">
		<div class="ern-sk ern-sk-hero"></div>
		<div class="ern-sk ern-sk-row"></div>
		<div class="ern-sk ern-sk-row short"></div>
	</div>`;
}

const COIN_STATUS = {
	counted: null,
	other_wallet: 'not counted',
	not_reported: 'not reported',
};

function coinRow(c) {
	const label = c.symbol ? `$${c.symbol}` : c.name || shortAddr(c.mint);
	let detail;
	let value;
	if (c.status === 'not_reported') {
		detail = c.error ? 'pump.fun has not reported fees for this coin yet' : 'Waiting for the first earnings snapshot';
		value = '<span>not reported</span>';
	} else {
		const shared = Number(c.wallet_coin_count) > 1 ? ` · combined for ${c.wallet_coin_count} coins from the same wallet` : '';
		detail =
			c.status === 'other_wallet'
				? `Fees go to ${esc(shortAddr(c.creator))}, not this agent's wallet${shared}`
				: `Unclaimed ${esc(fmtSol(c.unclaimed_sol))}${shared}`;
		value = `${esc(fmtSol(c.earned_sol))}${c.earned_usd != null ? `<small>${esc(fmtUsd(c.earned_usd))}</small>` : ''}`;
	}
	const pill = COIN_STATUS[c.status] ? `<span class="ern-pill">${COIN_STATUS[c.status]}</span>` : '';
	return `<li><a class="ern-row" href="${esc(c.url)}" aria-label="${esc(label)} coin page">
		<span class="ern-row-main">
			<span class="ern-row-t">${esc(label)}${pill}</span>
			<span class="ern-row-d">${detail}</span>
		</span>
		<span class="ern-row-v">${value}</span>
	</a></li>`;
}

function claimRow(c) {
	const who = c.source === 'autonomous' ? 'Autonomous claim' : 'Claimed by owner';
	return `<li><a class="ern-row" href="${esc(c.explorer)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(who)} on Solscan">
		<span class="ern-row-main">
			<span class="ern-row-t">${esc(who)}</span>
			<span class="ern-row-d">${esc(relTime(c.at))} · ${esc(shortAddr(c.signature))} · Solscan ↗</span>
		</span>
		<span class="ern-row-v">${c.sol != null ? esc(fmtSol(c.sol)) : 'swept'}</span>
	</a></li>`;
}

function footer(d) {
	const updated = d.refreshed_at ? `Updated ${esc(relTime(d.refreshed_at))}` : '';
	return `<div class="ern-foot${d.stale ? ' stale' : ''}">
		${updated ? `<span>${d.stale ? 'Figures may be out of date. ' : ''}${updated}</span>` : ''}
		<details class="ern-how"><summary>How it's calculated</summary><p>${esc(d.method)}</p></details>
	</div>`;
}

function subline(zero, coins, service) {
	if (!zero) return `Lifetime creator fees from its coins${service.usd ? ' plus service income' : ''}.`;
	if (coins.length && coins.every((c) => c.status === 'other_wallet')) {
		return 'None counted for this agent: its coins pay creator fees to a wallet that is not its own, listed below.';
	}
	if (coins.length && coins.every((c) => c.status === 'not_reported')) {
		return 'pump.fun has not reported creator fees for its coins yet.';
	}
	return 'Nothing earned yet. Creator fees accrue with every trade of this agent’s coin.';
}

function render(d) {
	const lifetime = d.lifetime_creator_fees || {};
	const service = d.service_income || {};
	const totalSol = Number(lifetime.earned_sol || 0) + Number(service.sol || 0);
	const totalUsd =
		lifetime.earned_usd != null || service.usd
			? Number(lifetime.earned_usd || 0) + Number(service.usd || 0)
			: null;
	const rank = d.rank
		? `<a class="ern-rank" href="${esc(d.rank.url)}" title="Rank on the earnings leaderboard">#${d.rank.position} ${d.rank.window === '7d' ? 'this week' : d.rank.window === '24h' ? 'today' : d.rank.window === '30d' ? 'this month' : 'all time'}</a>`
		: '';

	if (!d.has_coins && !service.usd) {
		return {
			state: 'empty',
			html: `<div class="ern ern-fade"><div class="ern-empty">
				<p>No coin launched yet. When this agent launches a coin on pump.fun, every trade pays it a creator fee and the total shows up here.</p>
				<a class="ern-btn" href="/launch">Launch a coin →</a>
			</div>${footer({ ...d, refreshed_at: null, stale: false })}</div>`,
		};
	}

	const coins = d.coins || [];
	const claims = d.claims || [];
	const zero = totalSol === 0;
	const stats = [
		['Claimed', fmtSol(lifetime.claimed_sol), fmtUsd(lifetime.claimed_usd)],
		['Unclaimed', fmtSol(lifetime.unclaimed_sol), fmtUsd(lifetime.unclaimed_usd)],
	];
	if (service.usd) {
		stats.push([
			'Service income',
			fmtUsd(service.usd),
			`${service.skill_sales_count} sales · ${service.hires_count} hires`,
		]);
	}
	const html = `<div class="ern ern-fade">
		<div class="ern-hero">
			<span class="ern-total">${esc(fmtSol(totalSol))}</span>
			${totalUsd != null ? `<span class="ern-usd">${esc(fmtUsd(totalUsd))}</span>` : ''}
			${rank}
		</div>
		<p class="ern-sub">${esc(subline(zero, coins, service))}</p>
		<div class="ern-stats">${stats
			.map(
				([k, v, s]) =>
					`<div class="ern-stat"><span class="ern-stat-k">${esc(k)}</span><span class="ern-stat-v">${esc(v)}</span>${s ? `<span class="ern-stat-s">${esc(s)}</span>` : ''}</div>`,
			)
			.join('')}</div>
		${coins.length ? `<h4 class="ern-h">Per coin</h4><ul class="ern-list">${coins.map(coinRow).join('')}</ul>` : ''}
		${claims.length ? `<h4 class="ern-h">Claims</h4><ul class="ern-list">${claims.map(claimRow).join('')}</ul>` : ''}
		${footer(d)}
	</div>`;
	return { state: zero ? 'zero' : 'earned', html };
}

/**
 * Mount the Earned card for one agent.
 * @param {{ mount: HTMLElement, agentId: string, onState?: (state: string, data?: object) => void }} opts
 */
export function mountEarningsCard({ mount, agentId, onState = () => {} }) {
	ensureStyles();
	let ctrl = null;
	let destroyed = false;

	async function load() {
		ctrl?.abort();
		ctrl = new AbortController();
		mount.innerHTML = skeleton();
		onState('loading');
		try {
			const r = await fetch(`/api/agents/${encodeURIComponent(agentId)}/earnings`, {
				credentials: 'include',
				signal: ctrl.signal,
			});
			if (!r.ok) throw new Error(r.status === 404 ? 'not_found' : `HTTP ${r.status}`);
			const data = await r.json();
			if (destroyed) return;
			const { state, html } = render(data);
			mount.innerHTML = html;
			onState(state, data);
		} catch (err) {
			if (destroyed || err?.name === 'AbortError') return;
			mount.innerHTML = `<div class="ern ern-fade"><div class="ern-empty">
				<p class="ern-err">Couldn't load earnings${err?.message === 'not_found' ? ': this agent is private or no longer exists.' : '. The earnings service did not answer.'}</p>
				<button type="button" class="ern-btn" data-ern-retry>Try again</button>
			</div></div>`;
			mount.querySelector('[data-ern-retry]')?.addEventListener('click', load);
			onState('error');
		}
	}

	load();
	return {
		refresh: load,
		destroy() {
			destroyed = true;
			ctrl?.abort();
			mount.innerHTML = '';
		},
	};
}
