/**
 * Smart-Money panel — the reusable, accessible "who is buying this coin" graph.
 *
 * Renders the wallet-reputation read for a coin: a 0–100 smart-money score, the
 * reputable wallets currently net-buying it (each with a realized track record and
 * a Solscan link), the funder clusters in the book, and a sybil flag when one
 * cluster dominates the demand. Every number traces to real observed buys ⋈ real
 * outcomes — there are no vanity lists or invented trader names.
 *
 * Usage mirrors the Safety panel:
 *   const panel = createSmartMoneyPanel();   // a controller
 *   panel.el                                  // root element to mount
 *   panel.loadForMint({ mint, network });     // fetch + render
 *   panel.setState('idle' | 'loading');       // explicit empty/loading
 *   panel.applyData(result);                  // render data you already have
 *
 * Every state is designed: idle (no coin yet), loading (skeleton), error
 * (actionable retry), zero-data ("not enough on-chain history yet"), and
 * populated. Uses the platform design tokens (CSS vars) with sane fallbacks so it
 * themes correctly inside the wallet hub, the in-world coin modal, and Mission
 * Control alike.
 *
 * $THREE is the only coin three.ws promotes — this assesses whatever runtime mint
 * the host hands it and never names or recommends any token.
 */

import { shortAddress as shortAddr } from './address.js';

const STYLE_ID = 'tw-smartmoney-style';
const STYLE = `
.tw-sm { border: 1px solid var(--stroke, rgba(255,255,255,.1)); border-radius: var(--radius-md, 10px); background: var(--surface-1, rgba(255,255,255,.03)); padding: 12px 13px; display: flex; flex-direction: column; gap: 10px; font-size: var(--text-sm, .8125rem); animation: tw-sm-in var(--duration-base, 220ms) var(--ease-out, ease); }
@keyframes tw-sm-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .tw-sm, .tw-sm-skel { animation: none !important; } }
.tw-sm-head { display: flex; align-items: center; gap: 9px; }
.tw-sm-title { font-weight: 600; color: var(--ink-bright, #fff); }
.tw-sm-score { margin-left: auto; font-variant-numeric: tabular-nums; font-weight: 600; color: var(--ink, #e8e8e8); }
.tw-sm-score small { color: var(--ink-dim, #888); font-weight: 400; }
.tw-sm--strong .tw-sm-score { color: var(--success, #4ade80); }
.tw-sm--mid .tw-sm-score { color: var(--warn, #fbbf24); }
.tw-sm-info { appearance: none; border: none; background: none; cursor: help; color: var(--ink-dim, #888); padding: 0 2px; font-size: .85em; line-height: 1; }
.tw-sm-info:hover, .tw-sm-info:focus-visible { color: var(--ink, #e8e8e8); }
.tw-sm-sybil { display: flex; gap: 7px; align-items: flex-start; font-size: var(--text-2xs, .72rem); color: var(--warn, #fbbf24); line-height: 1.4; }
.tw-sm-sybil::before { content: "⚠"; flex: none; }
.tw-sm-summary { color: var(--ink, #e8e8e8); line-height: 1.4; }
.tw-sm-wallets { list-style: none; margin: 0; padding: 0; display: grid; gap: 5px; }
.tw-sm-wallet { display: flex; align-items: center; gap: 8px; font-size: var(--text-2xs, .72rem); }
.tw-sm-rank { width: 18px; height: 18px; border-radius: 50%; flex: none; display: grid; place-items: center; font-weight: 700; font-size: .62rem; background: var(--surface-2, rgba(255,255,255,.06)); color: var(--ink, #e8e8e8); }
.tw-sm-wallet--proven .tw-sm-rank { background: color-mix(in srgb, var(--success,#4ade80) 22%, transparent); color: var(--success, #4ade80); }
.tw-sm-addr { font-family: var(--font-mono, ui-monospace, monospace); color: var(--accent, #7dd3fc); text-decoration: none; }
.tw-sm-addr:hover, .tw-sm-addr:focus-visible { text-decoration: underline; }
.tw-sm-meta { margin-left: auto; display: flex; gap: 9px; align-items: center; color: var(--ink-dim, #999); font-variant-numeric: tabular-nums; }
.tw-sm-rep { font-weight: 600; color: var(--ink, #e8e8e8); }
.tw-sm-sybtag { font-size: .62rem; padding: 1px 5px; border-radius: 4px; background: color-mix(in srgb, var(--warn,#fbbf24) 18%, transparent); color: var(--warn, #fbbf24); }
.tw-sm-toggle { appearance: none; border: none; background: none; color: var(--ink-dim, #888); cursor: pointer; font: inherit; font-size: var(--text-2xs, .72rem); padding: 2px 0; text-align: left; text-decoration: underline; text-underline-offset: 2px; }
.tw-sm-toggle:hover, .tw-sm-toggle:focus-visible { color: var(--ink, #e8e8e8); }
.tw-sm-clusters { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.tw-sm-cluster { display: flex; align-items: center; gap: 8px; font-size: var(--text-2xs, .72rem); color: var(--ink-dim, #999); }
.tw-sm-bar { flex: 1; height: 5px; border-radius: 3px; background: var(--surface-2, rgba(255,255,255,.06)); overflow: hidden; }
.tw-sm-bar > span { display: block; height: 100%; background: var(--accent, #7dd3fc); border-radius: 3px; }
.tw-sm-cluster--dominant .tw-sm-bar > span { background: var(--warn, #fbbf24); }
.tw-sm-skel { height: 12px; border-radius: 5px; background: var(--surface-2, rgba(255,255,255,.06)); animation: tw-sm-skel 1.3s ease-in-out infinite; }
.tw-sm-skel:nth-child(2) { width: 80%; } .tw-sm-skel:nth-child(3) { width: 55%; }
@keyframes tw-sm-skel { 0%,100% { opacity: .5; } 50% { opacity: 1; } }
.tw-sm-err { color: var(--danger, #f87171); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: var(--text-2xs, .72rem); }
.tw-sm-err button { appearance: none; border: 1px solid currentColor; background: none; color: inherit; font: inherit; font-size: var(--text-2xs,.72rem); border-radius: var(--radius-sm,6px); padding: 2px 9px; cursor: pointer; }
.tw-sm-idle, .tw-sm-empty { color: var(--ink-dim, #888); font-size: var(--text-sm, .8125rem); line-height: 1.4; }
`;

const WHAT_THIS_MEANS =
	'three.ws scores every wallet by its realized track record across launches it bought — its hit-rate and how high those coins ran. The smart-money score (0–100) is the net-buy-weighted reputation of the proven wallets currently holding this coin. A “sybil” warning means one funder cluster controls most of the buying, so the demand may be one entity across many wallets rather than independent traders. Every number is computed from real on-chain buys and real outcomes, not a curated list.';

function injectStyle() {
	if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
	const tag = document.createElement('style');
	tag.id = STYLE_ID;
	tag.textContent = STYLE;
	document.head.appendChild(tag);
}


function solscanUrl(address, network) {
	const cluster = network === 'devnet' ? '?cluster=devnet' : '';
	return `https://solscan.io/account/${encodeURIComponent(address)}${cluster}`;
}

/**
 * Create a Smart-Money panel controller.
 * @param {object} [opts]
 * @param {(data: object|null) => void} [opts.onData] called whenever the data changes.
 * @param {boolean} [opts.startExpanded] show the cluster breakdown by default.
 */
export function createSmartMoneyPanel({ onData = () => {}, startExpanded = false } = {}) {
	injectStyle();
	const root = document.createElement('div');
	root.className = 'tw-sm';
	root.setAttribute('role', 'region');
	root.setAttribute('aria-label', 'Smart money');

	let expanded = startExpanded;
	let lastReq = 0;
	let current = null;
	let lastArgs = null;

	function setIdle(message) {
		current = null;
		root.className = 'tw-sm';
		root.removeAttribute('aria-busy');
		root.innerHTML = `<div class="tw-sm-idle">${escapeHtml(message || 'Select a coin to see who is buying it.')}</div>`;
		onData(null);
	}

	function setLoading() {
		root.className = 'tw-sm';
		root.setAttribute('aria-busy', 'true');
		root.innerHTML = `
			<div class="tw-sm-head"><span class="tw-sm-title">Reading smart money…</span></div>
			<div class="tw-sm-skel"></div><div class="tw-sm-skel"></div><div class="tw-sm-skel"></div>`;
	}

	function setError(retryFn) {
		root.removeAttribute('aria-busy');
		root.className = 'tw-sm';
		root.innerHTML = '';
		const wrap = document.createElement('div');
		wrap.className = 'tw-sm-err';
		wrap.setAttribute('role', 'alert');
		wrap.append(document.createTextNode('Couldn’t read smart money.'));
		if (retryFn) {
			const b = document.createElement('button');
			b.type = 'button';
			b.textContent = 'Retry';
			b.addEventListener('click', retryFn);
			wrap.appendChild(b);
		}
		root.appendChild(wrap);
		onData(null);
	}

	function applyData(d) {
		if (!d || typeof d !== 'object') { setIdle(); return; }
		current = d;
		root.removeAttribute('aria-busy');

		// Honest zero-data state: the graph hasn't observed enough history for this coin.
		if (d.computed === false || (d.count === 0 && (!d.clusters || d.clusters.length === 0))) {
			root.className = 'tw-sm';
			root.innerHTML = `
				<div class="tw-sm-head">
					<span class="tw-sm-title">Smart money</span>
					<button type="button" class="tw-sm-info" aria-label="What this means" title="${escapeHtml(WHAT_THIS_MEANS)}">ⓘ</button>
				</div>
				<div class="tw-sm-empty">Not enough on-chain history yet — no proven wallets have a track record in this coin. The graph keeps learning as buys and outcomes accrue.</div>`;
			onData(d);
			return;
		}

		const score = Number.isFinite(Number(d.smart_money_score)) ? Math.round(Number(d.smart_money_score)) : 0;
		const tier = score >= 65 ? 'strong' : score >= 35 ? 'mid' : 'low';
		const wallets = Array.isArray(d.wallets) ? d.wallets : [];
		const clusters = Array.isArray(d.clusters) ? d.clusters : [];
		const count = Number(d.count) || wallets.length;
		const network = d.network === 'devnet' ? 'devnet' : 'mainnet';

		const summary = count > 0
			? `${count} proven wallet${count === 1 ? '' : 's'} net-buying${Number(d.total_buyers) > count ? ` of ${d.total_buyers} total` : ''}.`
			: 'No proven wallets are net-buying right now.';

		root.className = `tw-sm tw-sm--${tier}`;
		root.innerHTML = `
			<div class="tw-sm-head">
				<span class="tw-sm-title">Smart money</span>
				<button type="button" class="tw-sm-info" aria-label="What this means" title="${escapeHtml(WHAT_THIS_MEANS)}">ⓘ</button>
				<span class="tw-sm-score">${score}<small>/100</small></span>
			</div>
			${d.sybil_flag ? `<div class="tw-sm-sybil">Demand is dominated by one funder cluster (${Math.round((Number(d.sybil_share) || 0) * 100)}% of net buys) — likely one entity across many wallets, not organic.</div>` : ''}
			<div class="tw-sm-summary">${escapeHtml(summary)}</div>
			${wallets.length ? `<ul class="tw-sm-wallets">${wallets.slice(0, 6).map((w, i) => {
				const rep = Math.round(Number(w.realized_score) || 0);
				const proven = rep >= 70;
				const wr = Number(w.win_rate);
				const wrTxt = Number.isFinite(wr) ? `${Math.round(wr * 100)}% win` : '';
				return `<li class="tw-sm-wallet ${proven ? 'tw-sm-wallet--proven' : ''}">
					<span class="tw-sm-rank" aria-hidden="true">${i + 1}</span>
					<a class="tw-sm-addr" href="${escapeHtml(solscanUrl(w.address, network))}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(w.address || '')}">${escapeHtml(shortAddr(w.address))}</a>
					${w.sybil ? '<span class="tw-sm-sybtag">cluster</span>' : ''}
					<span class="tw-sm-meta">${wrTxt ? `<span>${escapeHtml(wrTxt)}</span>` : ''}<span class="tw-sm-rep">${rep}</span></span>
				</li>`;
			}).join('')}</ul>` : ''}
			${clusters.length ? `<button type="button" class="tw-sm-toggle" aria-expanded="${expanded}">${expanded ? 'Hide' : 'Show'} ${clusters.length} funder cluster${clusters.length === 1 ? '' : 's'}</button>` : ''}
			<ul class="tw-sm-clusters" ${expanded ? '' : 'hidden'}>
				${clusters.map((c) => {
					const pct = Math.round((Number(c.share) || 0) * 100);
					const dominant = d.sybil_flag && pct >= 50;
					return `<li class="tw-sm-cluster ${dominant ? 'tw-sm-cluster--dominant' : ''}">
						<span>${c.buyers || 0} wallet${(c.buyers || 0) === 1 ? '' : 's'}</span>
						<span class="tw-sm-bar"><span style="width:${pct}%"></span></span>
						<span>${pct}%</span>
					</li>`;
				}).join('')}
			</ul>`;

		const info = root.querySelector('.tw-sm-info');
		if (info) info.addEventListener('click', () => info.focus());
		const toggle = root.querySelector('.tw-sm-toggle');
		if (toggle) {
			toggle.addEventListener('click', () => {
				expanded = !expanded;
				const list = root.querySelector('.tw-sm-clusters');
				if (list) list.hidden = !expanded;
				toggle.textContent = `${expanded ? 'Hide' : 'Show'} ${clusters.length} funder cluster${clusters.length === 1 ? '' : 's'}`;
				toggle.setAttribute('aria-expanded', String(expanded));
			});
		}
		onData(d);
	}

	/**
	 * Fetch the smart-money read for a mint and render it.
	 * @param {{ mint: string, network?: string }} args
	 */
	async function loadForMint(args) {
		lastArgs = args;
		const mint = args?.mint;
		if (!mint) { setIdle(); return; }
		const seq = ++lastReq;
		setLoading();
		try {
			const u = new URLSearchParams({ mint, network: args.network || 'mainnet' });
			const r = await fetch(`/api/intel/smart-money?${u.toString()}`, { headers: { accept: 'application/json' } });
			if (seq !== lastReq) return;
			if (!r.ok) { setError(() => loadForMint(lastArgs)); return; }
			const data = await r.json();
			if (seq !== lastReq) return;
			applyData(data);
		} catch {
			if (seq !== lastReq) return;
			setError(() => loadForMint(lastArgs));
		}
	}

	function setState(s) {
		if (s === 'idle') setIdle();
		else if (s === 'loading') setLoading();
	}

	setIdle();

	return {
		el: root,
		loadForMint,
		applyData,
		setState,
		getData: () => current,
		destroy() { lastReq = -1; root.remove(); },
	};
}

// Minimal HTML escape — the panel never injects untrusted markup.
function escapeHtml(s) {
	return String(s == null ? '' : s)
		.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
