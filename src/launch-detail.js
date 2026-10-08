// ════════════════════════════════════════════════════════════════════════════
// /launches/<mint> — the rich, addressable profile for one coin.
//
// Every other launch surface bounces traders out to pump.fun. This page keeps
// them on three.ws and answers every question a trader actually has, in one
// place, from real on-chain data:
//
//   · WHAT is it        — live name / symbol / logo / price / market cap /
//                         graduation, streamed from /api/pump/coin
//   · THE NUMBERS      : per-timeframe volume, buys, sells, net buy, holders,
//                         dev share, authorities, curve progress, liquidity,
//                         from /api/pump/token-stats; launch-window counts from
//                         /api/pump/launch-detail
//   · WHERE IS IT GOING — the live price chart (/api/pump/price-history) and
//                         the live trade tape (/api/pump/trades-stream, SSE)
//   · WHO HOLDS IT     : holder count + top holders (/api/pump/token-stats)
//   · WHO MADE IT      : the agent behind the mint and its public track
//                         record, deep-linked to /trader & /agents
//   · WHY HOLD          — buyback-and-burn economics for agent-payment coins
//   · WHAT CAN I DO     — buy, view in 3D, enter the coin's world, watch, share
//
// Neutrality contract: the page never scores, grades, or labels a coin. It shows
// facts and leaves the judgment to the reader, because a score on a user's
// launch reads as investment advice or as FUD. A value we could not read
// renders as "-", never as 0. A coin we never observed still renders, and the page
// degrades to whatever is real for that mint and tells the user what's missing.
// ════════════════════════════════════════════════════════════════════════════

import {
	escapeHtml,
	compact,
	fmtSol,
	fmtUsd,
	fmtPct,
	pnlClass,
	shortAddr,
	relTime,
	verifiedBadge,
} from './trader-format.js';
import { walletChipEl } from './shared/agent-wallet-chip.js';
import { proxiedImageURL } from './ipfs.js';
import { agentAvatarGlb, hasCustomAvatar, seeInWorldHref } from './shared/agent-3d.js';
import { resolveDevR2Url } from './shared/dev-r2-proxy.js';
import { terminalLinks, dextoolsTokenUrl } from './shared/trading-terminals.js';
import { CHART_EMBEDS, chartEmbedUrls, resolveChartPool } from './shared/chart-embeds.js';
import { socialBoostCard } from './shared/dextools-boost.js';
import { watchEmbed, embedFallbackNode, DEFAULT_EMBED_TIMEOUT_MS } from './shared/embed-guard.js';
import { mountPriceChart } from './mission-control/chart.js';
import { flashValue, rippleOnce, liveDot, setLiveDot } from './ui-juice.js';

const GRADUATION_CAP_USD = 69_000; // pump.fun bonding-curve graduation threshold
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const SOL_MINT = 'So11111111111111111111111111111111111111112';

const state = {
	mint: null,
	network: 'mainnet',
	detail: null,
	coin: null,
	tape: null, // EventSource handle
	chartInterval: '15m',
	chartView: 'native', // a CHART_VIEWS id; hydrated from localStorage in boot()
	chartSeq: 0, // bumps on every chart render so a stale async load never paints
	chartTeardown: null, // cancels the active view's watchdog, stream or chart
	chartPools: {}, // provider id → { pool, indexed } once resolved for this mint
	priceTimer: 0,
	statsPromise: null, // shared /api/pump/token-stats read (stats + holders panels)
	statsWindow: '1h', // selected timeframe tab in the stats panel
};

// The chart-source choice is a viewing preference, not coin-specific: persist it
// so a trader who prefers one chart keeps it across coins.
const CHART_VIEW_KEY = 'ld_chart_view';

function readChartView() {
	try {
		const v = localStorage.getItem(CHART_VIEW_KEY);
		return CHART_VIEWS.some((view) => view.id === v) ? v : 'native';
	} catch {
		return 'native';
	}
}

function writeChartView(view) {
	try {
		localStorage.setItem(CHART_VIEW_KEY, view);
	} catch {
		/* storage full / blocked — non-fatal, the in-memory state still switches */
	}
}

// ── Jupiter Terminal lazy loader ─────────────────────────────────────────────
// We load the Jupiter Terminal script only when the user clicks Buy, so it
// never slows down cold page loads. The script self-registers as window.Jupiter.

let _jupState = 'idle'; // idle | loading | ready | error
const _jupCallbacks = [];

function loadJupiter() {
	if (_jupState === 'ready') return Promise.resolve();
	if (_jupState === 'error') return Promise.reject(new Error('Jupiter Terminal failed to load'));
	return new Promise((resolve, reject) => {
		_jupCallbacks.push({ resolve, reject });
		if (_jupState === 'loading') return;
		_jupState = 'loading';
		const s = document.createElement('script');
		s.src = 'https://terminal.jup.ag/main-v3.js';
		s.onload = () => {
			_jupState = 'ready';
			_jupCallbacks.splice(0).forEach((cb) => cb.resolve());
		};
		s.onerror = () => {
			_jupState = 'error';
			_jupCallbacks.splice(0).forEach((cb) => cb.reject(new Error('Jupiter Terminal failed to load')));
		};
		document.head.appendChild(s);
	});
}

function openSwapModal(mint, symbol) {
	// Remove any pre-existing modal (guard against double-click race).
	document.getElementById('ld-swap-overlay')?.remove();

	const containerId = 'jup-terminal-container';
	const title = `Buy ${symbol ? `$${symbol}` : 'this token'}`;

	const closeModal = () => {
		overlay.remove();
		// Destroy the terminal instance so it doesn't leak event listeners.
		try { window.Jupiter?.close?.(); } catch { /* fine */ }
	};

	const loader = el('div', { class: 'ld-swap-loading' }, [
		el('div', { class: 'ld-skel', style: 'height:420px;border-radius:var(--radius-md)' }),
	]);
	const container = el('div', { id: containerId, class: 'ld-swap-terminal' });

	const modal = el('div', { class: 'ld-swap-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
		el('div', { class: 'ld-swap-head' }, [
			el('span', { class: 'ld-swap-title', text: title }),
			el('button', {
				class: 'ld-swap-close',
				type: 'button',
				'aria-label': 'Close swap',
				text: '✕',
				onclick: closeModal,
			}),
		]),
		loader,
		container,
	]);

	const overlay = el('div', { id: 'ld-swap-overlay', class: 'ld-swap-overlay' });
	overlay.appendChild(modal);
	document.body.appendChild(overlay);

	// Close on backdrop click or Escape.
	overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
	const escListener = (e) => { if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', escListener); } };
	document.addEventListener('keydown', escListener);

	loadJupiter()
		.then(() => {
			loader.style.display = 'none';
			// Route RPC through our proxy — it rotates Helius → Alchemy → public
			// endpoints server-side, so blockhash fetch and tx submission survive
			// any single provider being down or rate-limiting the browser.
			window.Jupiter.init({
				displayMode: 'integrated',
				integratedTargetId: containerId,
				endpoint: `${location.origin}/api/solana-rpc`,
				formProps: {
					initialInputMint: SOL_MINT,
					initialOutputMint: mint,
					swapMode: 'ExactIn',
					fixedOutputMint: true,
				},
				containerStyles: {
					borderRadius: '12px',
					overflow: 'hidden',
					background: 'var(--bg-0, #0a0a0a)',
				},
			});
		})
		.catch(() => {
			loader.replaceChildren(
				el('div', { class: 'ld-swap-error' }, [
					el('p', { text: 'Could not load the swap terminal.' }),
					el('a', {
						class: 'ld-btn ld-btn-primary',
						href: `https://pump.fun/${mint}`,
						target: '_blank',
						rel: 'noopener noreferrer',
						text: `Trade on pump.fun ↗`,
					}),
				]),
			);
		});
}

// ── DOM helpers ──────────────────────────────────────────────────────────────

function el(tag, props = {}, children = []) {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(props)) {
		if (v == null || v === false) continue;
		if (k === 'class') node.className = v;
		else if (k === 'html') node.innerHTML = v;
		else if (k === 'text') node.textContent = v;
		else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
		else node.setAttribute(k, v);
	}
	for (const c of [].concat(children || [])) {
		if (c == null || c === false) continue;
		node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
	}
	return node;
}

const $ = (id) => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';

// Update or create a <meta> tag by property or name attribute.
function setMeta(prop, content) {
	let el = document.querySelector(`meta[property="${prop}"]`) ||
	         document.querySelector(`meta[name="${prop}"]`);
	if (!el) {
		el = document.createElement('meta');
		el.setAttribute(prop.startsWith('og:') || prop.startsWith('twitter:') ? 'property' : 'name', prop);
		document.head.appendChild(el);
	}
	el.setAttribute('content', content);
}

function svg(tag, attrs) {
	const node = document.createElementNS(SVG_NS, tag);
	for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
	return node;
}

function section(target, title, body, { tag = null } = {}) {
	const head = el('div', { class: 'ld-sec-head' }, [
		el('h2', { class: 'ld-sec-title', text: title }),
		tag ? el('span', { class: 'ld-sec-tag', text: tag }) : null,
	]);
	target.replaceChildren(head, body);
	target.classList.add('ld-revealed');
}

// ── formatting ───────────────────────────────────────────────────────────────

function fmtMcap(n) {
	if (!Number.isFinite(n)) return '—';
	if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
	if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
	if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
	return `$${n.toFixed(0)}`;
}

function fmtPrice(n) {
	if (!Number.isFinite(n) || n <= 0) return '—';
	if (n >= 1) return `$${n.toFixed(2)}`;
	if (n >= 0.001) return `$${n.toFixed(5)}`;
	return `$${n.toExponential(2)}`;
}

// ── mint resolution ──────────────────────────────────────────────────────────

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function resolveMint() {
	const parts = location.pathname.split('/').filter(Boolean);
	const fromPath = parts[0] === 'launches' ? parts[1] : null;
	const qs = new URLSearchParams(location.search);
	const fromQuery = qs.get('mint');
	const candidate = (fromPath || fromQuery || '').trim();
	state.network = qs.get('network') === 'devnet' ? 'devnet' : 'mainnet';
	return MINT_RE.test(candidate) ? candidate : null;
}

// ── data ─────────────────────────────────────────────────────────────────────

// Time-bounded on every call: the coin page paints skeletons for the chart,
// safety and trades panels before these resolve, and an edge that never
// answers used to leave all three spinning forever. The per-call deadline
// composes with the caller's own signal (a stale request being abandoned)
// instead of replacing it, so both cancellation reasons still work.
async function fetchJson(url, { signal, timeout = 8000 } = {}) {
	const deadline = AbortSignal.timeout(timeout);
	const r = await fetch(url, { signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
	if (!r.ok) {
		// Carry the status and the API's machine-readable code so callers can tell
		// an honest empty state ("this coin has no market yet") apart from an
		// outage, and offer Retry only where retrying can actually help.
		const err = new Error(`${url} → ${r.status}`);
		err.status = r.status;
		err.code = await r.clone().json().then((b) => b?.error).catch(() => null);
		throw err;
	}
	return r.json();
}

async function loadDetail() {
	const params = new URLSearchParams({ mint: state.mint, network: state.network });
	return fetchJson(`/api/pump/launch-detail?${params}`);
}

async function loadCoin() {
	// Live pump.fun market — mainnet only (devnet has no pump.fun market data).
	if (state.network !== 'mainnet') return null;
	try {
		return await fetchJson(`/api/pump/coin?mint=${encodeURIComponent(state.mint)}`);
	} catch {
		return null;
	}
}

// ════════════════════════════════════════════════════════════════════════════
// HERO
// ════════════════════════════════════════════════════════════════════════════

function graduationRing(pct, size = 76) {
	const value = Math.max(0, Math.min(100, Number(pct) || 0));
	const r = size / 2 - 6;
	const c = 2 * Math.PI * r;
	const dash = (value / 100) * c;
	const node = svg('svg', { viewBox: `0 0 ${size} ${size}`, class: 'ld-ring', role: 'img', 'aria-label': `${Math.round(value)}% to graduation` });
	node.append(
		svg('circle', { cx: size / 2, cy: size / 2, r, class: 'ld-ring-track' }),
		svg('circle', {
			cx: size / 2,
			cy: size / 2,
			r,
			class: 'ld-ring-arc',
			'stroke-dasharray': `${dash.toFixed(1)} ${(c - dash).toFixed(1)}`,
			transform: `rotate(-90 ${size / 2} ${size / 2})`,
		}),
	);
	return node;
}

function outcomeBadge(outcome) {
	// Only graduation is a plain on-chain fact. Engine labels such as "rugged" or
	// "faded" are judgments about someone's coin, so they never render here.
	if (!outcome?.graduated) return null;
	return el('span', { class: 'ld-outcome ld-outcome-good', title: 'This coin completed its bonding curve and moved to an AMM pool.' }, [
		el('span', { text: 'Graduated' }),
	]);
}

function socialLinks(socials, intel) {
	const links = [];
	const s = socials || {};
	if (s.twitter) links.push(['𝕏', s.twitter, 'X / Twitter']);
	if (s.telegram) links.push(['Telegram', s.telegram, 'Telegram']);
	if (s.website) links.push(['Website', s.website, 'Website']);
	if (!links.length) return null;
	return el(
		'div',
		{ class: 'ld-socials' },
		links.map(([label, href, aria]) =>
			el('a', { class: 'ld-social', href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': aria, text: label }),
		),
	);
}

function copyButton(value, label) {
	const btn = el('button', {
		class: 'ld-copy',
		type: 'button',
		'aria-label': `Copy ${label}`,
		title: `Copy ${label}`,
		onclick: async () => {
			try {
				await navigator.clipboard.writeText(value);
				const old = btn.textContent;
				btn.textContent = 'Copied';
				btn.classList.add('ld-copied');
				setTimeout(() => {
					btn.textContent = old;
					btn.classList.remove('ld-copied');
				}, 1400);
			} catch {
				/* clipboard blocked — selection fallback */
				const r = document.createRange();
				r.selectNodeContents(btn);
				window.getSelection()?.removeAllRanges();
				window.getSelection()?.addRange(r);
			}
		},
		text: shortAddr(value, 5, 5),
	});
	return btn;
}

function renderHero() {
	const target = $('ld-hero');
	const { detail, coin } = state;
	const intel = detail.intel;
	const reg = detail.registry;

	// Identity, with graceful fallback precedence: live market → registry → intel.
	const name = coin?.name || reg?.name || intel?.name || 'Unknown coin';
	const symbol = (coin?.symbol || reg?.symbol || intel?.symbol || '').toUpperCase();
	// Coin art arrives as whatever URL the launch's metadata carried: usually a
	// public IPFS gateway, which now rate-limits our reads and leaves a no-cors
	// <img> with nothing to render. /api/img fetches it server-side across
	// gateways at the 72 px this avatar paints, and answers a placeholder rather
	// than an error when every one of them is down.
	const image = proxiedImageURL(coin?.image_uri || coin?.image || intel?.image_uri || '', state.mint || '', { width: 192 });

	document.title = `${symbol ? `$${symbol} · ` : ''}${name} · three.ws`;

	const mcap = Number(coin?.usd_market_cap);
	const supplyAtomic = Number(coin?.total_supply);
	const supply = Number.isFinite(supplyAtomic) && supplyAtomic > 0 ? supplyAtomic / 1e6 : null;
	const price = supply && Number.isFinite(mcap) ? mcap / supply : null;
	const graduated = coin?.complete === true;
	const gradPct = graduated ? 100 : Number.isFinite(mcap) ? Math.max(0, Math.min(100, (mcap / GRADUATION_CAP_USD) * 100)) : null;

	const avatar = el('div', { class: 'ld-coin-avatar' }, [
		image
			? el('img', { src: image, alt: '', loading: 'eager', referrerpolicy: 'no-referrer', onerror: function () { this.style.display = 'none'; } })
			: el('span', { class: 'ld-avatar-glyph', text: (symbol || name)[0] || '?' }),
	]);

	const idBlock = el('div', { class: 'ld-id' }, [
		el('div', { class: 'ld-id-line' }, [
			el('h1', { class: 'ld-name', text: name }),
			symbol ? el('span', { class: 'ld-symbol', text: `$${symbol}` }) : null,
			outcomeBadge(detail.outcome),
		]),
		el('div', { class: 'ld-id-meta' }, [
			detail.found ? el('span', { class: 'ld-chip ld-chip-launch', title: 'Launched by a three.ws agent', text: 'three.ws launch' }) : null,
			state.network === 'devnet' ? el('span', { class: 'ld-chip', text: 'Devnet' }) : null,
			intel?.category ? el('span', { class: 'ld-chip', text: intel.category }) : null,
			copyButton(state.mint, 'mint address'),
		]),
		socialLinks(intel?.socials, intel),
	]);

	// Live market stat strip.
	const stat = (label, value, cls = '') =>
		el('div', { class: `ld-stat ${cls}` }, [
			el('dt', { text: label }),
			el('dd', { text: value }),
		]);

	const stats = el('dl', { class: 'ld-hero-stats' }, [
		stat('Price', fmtPrice(price), 'ld-stat-price'),
		stat('Market cap', fmtMcap(mcap), 'ld-stat-mcap'),
		stat('24h volume', fmtMcap(Number(coin?.volume_24h ?? coin?.volume24h))),
		stat('Total supply', supply != null ? compact(supply) : '—'),
		stat('Launched', reg?.created_at || intel?.created_at ? relTime(reg?.created_at || intel?.created_at) : '—'),
	]);

	const gradWrap = gradPct != null
		? el('div', { class: 'ld-grad', title: graduated ? 'Graduated to AMM' : `${Math.round(gradPct)}% to graduation` }, [
				graduationRing(gradPct),
				el('div', { class: 'ld-grad-cap' }, [
					el('span', { class: 'ld-grad-pct', text: graduated ? 'Graduated' : `${Math.round(gradPct)}%` }),
					el('span', { class: 'ld-grad-sub', text: graduated ? 'on AMM' : 'to graduation' }),
				]),
			])
		: null;

	target.replaceChildren(
		el('div', { class: 'ld-hero-top' }, [avatar, idBlock, gradWrap]),
		stats,
	);
	target.classList.add('ld-revealed');
}

// ════════════════════════════════════════════════════════════════════════════
// TOKEN STATS: the neutral fact sheet a trading terminal leads with
// ════════════════════════════════════════════════════════════════════════════
//
// Facts, never a verdict. Nothing on this page scores, grades, or labels a coin:
// a score on someone's launch reads as investment advice when it is high and as
// FUD when it is low. Instead every panel shows the raw numbers a trader looks
// up on GMGN or DEX Screener (volume, buys vs sells, holders, dev share, mint
// and freeze authority, curve progress, liquidity) and leaves the judgment to
// the reader. One aggregate read (/api/pump/token-stats) feeds this panel and
// the holders panel, so the two can never disagree.

const TF_KEYS = ['5m', '1h', '6h', '24h'];

function loadStats() {
	if (!state.statsPromise) {
		state.statsPromise = fetchJson(`/api/pump/token-stats?mint=${encodeURIComponent(state.mint)}`, { timeout: 20000 });
		// A failed read must not poison later retries.
		state.statsPromise.catch(() => { state.statsPromise = null; });
	}
	return state.statsPromise;
}

const usd = (n) => (n == null ? '-' : fmtUsd(n, { sign: false }));
const share = (v) => {
	if (v == null) return '-';
	// Dust balances would otherwise print as a misleading flat 0.000%.
	if (v > 0 && v < 0.00001) return '<0.001%';
	return fmtPct(v * 100, { dp: v < 0.001 && v > 0 ? 3 : v < 0.1 ? 2 : 1 });
};

function statCell(label, value, { cls = '', title = null } = {}) {
	return el('div', { class: 'ld-ts-cell', title }, [
		el('span', { class: 'ld-ts-k', text: label }),
		el('span', { class: `ld-ts-v ${cls}`, text: value }),
	]);
}

function windowPanel(windows, key) {
	const w = windows?.[key];
	if (!w) return el('p', { class: 'ld-mtf-empty', text: 'No trade history for this window.' });
	const buyShare = w.buys + w.sells > 0 ? (w.buys / (w.buys + w.sells)) * 100 : null;
	return el('div', { class: 'ld-ts-window' }, [
		el('div', { class: 'ld-ts-grid' }, [
			statCell('Volume', usd(w.volume_usd)),
			statCell('Buys', `${compact(w.buys)} / ${usd(w.buy_usd)}`, { cls: 'lb-pos' }),
			statCell('Sells', `${compact(w.sells)} / ${usd(w.sell_usd)}`, { cls: 'lb-neg' }),
			statCell('Net buy', fmtUsd(w.net_buy_usd), { cls: pnlClass(w.net_buy_usd) }),
			statCell('Traders', compact(w.traders)),
			statCell('Price', w.price_change_pct == null ? '-' : fmtPct(w.price_change_pct, { sign: true, dp: 2 }), { cls: pnlClass(w.price_change_pct) }),
		]),
		buyShare == null
			? null
			: el('div', { class: 'ld-ts-split', role: 'img', 'aria-label': `${Math.round(buyShare)}% of trades were buys` }, [
					el('div', { class: 'ld-ts-split-buy', style: `width:${buyShare}%` }),
				]),
		w.partial
			? el('p', { class: 'ld-ts-note', text: 'This coin trades heavily, so this window covers the most recent 1,500 trades.' })
			: null,
	]);
}

function renderWindowTabs(host, windows) {
	const panel = el('div', { class: 'ld-ts-panel', role: 'tabpanel' });
	const tabs = TF_KEYS.map((key) => {
		const w = windows?.[key];
		const btn = el('button', {
			class: 'ld-ts-tab',
			type: 'button',
			role: 'tab',
			'aria-selected': 'false',
			onclick: () => select(key),
		}, [
			el('span', { class: 'ld-ts-tab-k', text: key }),
			el('span', {
				class: `ld-ts-tab-v ${w?.price_change_pct == null ? 'lb-muted' : pnlClass(w.price_change_pct)}`,
				text: w?.price_change_pct == null ? '-' : fmtPct(w.price_change_pct, { sign: true }),
			}),
		]);
		btn.dataset.key = key;
		return btn;
	});
	const select = (key) => {
		state.statsWindow = key;
		for (const t of tabs) {
			const on = t.dataset.key === key;
			t.classList.toggle('active', on);
			t.setAttribute('aria-selected', String(on));
		}
		panel.replaceChildren(windowPanel(windows, key));
	};
	host.replaceChildren(el('div', { class: 'ld-ts-tabs', role: 'tablist', 'aria-label': 'Timeframe' }, tabs), panel);
	select(state.statsWindow || '1h');
}

function authorityText(addr) {
	return addr ? 'Enabled' : 'Disabled';
}

function factsGrid(stats) {
	const h = stats.holders;
	const a = stats.authorities;
	const c = stats.curve;
	const m = stats.market || {};
	const dev = stats.dev;
	return el('div', { class: 'ld-ts-grid ld-ts-facts' }, [
		statCell('Holders', h?.count != null ? compact(h.count) : '-'),
		statCell('Top 10', h ? share(h.top10_pct) : '-', { title: 'Supply held by the ten largest wallets, excluding the bonding curve and AMM pool.' }),
		statCell('Dev holds', h ? share(h.dev_pct) : '-', { title: 'Supply held by the creator wallet.' }),
		statCell('Early buyers', h?.early_buyers_pct != null ? `${share(h.early_buyers_pct)} · ${compact(h.early_buyers)}` : '-', {
			title: 'Supply still held by wallets that bought within 5 seconds of launch, and how many there were.',
		}),
		statCell('Mint authority', a ? authorityText(a.mint_authority) : '-', { title: 'Whether any account can still mint new supply.' }),
		statCell('Freeze authority', a ? authorityText(a.freeze_authority) : '-', { title: 'Whether any account can still freeze token accounts.' }),
		statCell('Bonding curve', c ? (c.graduated ? 'Graduated' : fmtPct(c.progress_pct, { dp: 2 })) : '-', { title: 'Share of the bonding curve bought out. At 100% the coin moves to an AMM pool.' }),
		statCell('Liquidity', usd(m.liquidity_usd)),
		statCell('ATH market cap', usd(m.ath_market_cap_usd)),
		statCell('Dev trades', dev ? `${dev.bought} buys · ${dev.sold} sells` : '-', { title: 'Creator wallet trades in the fetched history.' }),
		statCell('DEX Screener', m.dex_paid == null ? '-' : m.dex_paid ? 'Profile paid' : 'Not paid', { title: 'Whether an enhanced token profile was paid for on DEX Screener.' }),
		statCell('Creator', dev ? shortAddr(dev.wallet, 4, 4) : '-', { title: dev?.wallet || null }),
	]);
}

function renderMetrics() {
	const target = $('ld-metrics');
	if (!target) return;
	if (state.network !== 'mainnet') {
		section(target, 'Token stats', el('div', { class: 'ld-empty ld-empty-sm' }, [
			el('p', { text: 'Live trading stats are mainnet-only.' }),
		]));
		return;
	}
	const body = el('div', { class: 'ld-ts' }, [el('div', { class: 'ld-skel ld-skel-strip' }), el('div', { class: 'ld-skel', style: 'height:120px' })]);
	section(target, 'Token stats', body, { tag: 'live · on-chain' });

	loadStats()
		.then((stats) => {
			const tfHost = el('div', { class: 'ld-ts-windows' });
			body.replaceChildren(tfHost, factsGrid(stats));
			if (stats.windows) renderWindowTabs(tfHost, stats.windows);
			else tfHost.replaceChildren(el('p', { class: 'ld-mtf-empty', text: 'Trade history is unavailable right now.' }));
		})
		.catch(() => {
			body.replaceChildren(
				el('div', { class: 'ld-mtf-empty' }, [
					el('span', { text: 'Token stats are unavailable right now.' }),
					el('button', { class: 'ld-btn ld-btn-ghost', type: 'button', text: 'Retry', onclick: () => renderMetrics() }),
				]),
			);
		});
}

// ════════════════════════════════════════════════════════════════════════════
// LAUNCH ACTIVITY: what happened in the first ~90 seconds, as raw counts
// ════════════════════════════════════════════════════════════════════════════

function renderVerdict() {
	const target = $('ld-verdict');
	const intel = state.detail.intel;

	// Nothing observed means nothing to show; the stats panel above already covers
	// the live market, so an empty explainer here would only be noise.
	if (!intel) {
		target.hidden = true;
		return;
	}

	const kv = (label, value, title) =>
		value == null ? null : statCell(label, value, { title });
	const pct01 = (v) => (v == null ? null : fmtPct(v * 100, { dp: 0 }));

	const cells = [
		kv('Buys', intel.buy_count != null ? compact(intel.buy_count) : null),
		kv('Sells', intel.sell_count != null ? compact(intel.sell_count) : null),
		kv('Unique buyers', intel.unique_buyers != null ? compact(intel.unique_buyers) : null),
		kv('Unique sellers', intel.unique_sellers != null ? compact(intel.unique_sellers) : null),
		kv('Buy volume', intel.buy_volume_sol != null ? fmtSol(intel.buy_volume_sol, { sign: false }) : null),
		kv('Sell volume', intel.sell_volume_sol != null ? fmtSol(intel.sell_volume_sol, { sign: false }) : null),
		kv('Dev buy', intel.dev_buy_sol != null ? fmtSol(intel.dev_buy_sol, { sign: false }) : null),
		kv('Largest buy', intel.largest_buy_sol != null ? fmtSol(intel.largest_buy_sol, { sign: false }) : null),
		kv('Dev sold', intel.dev_sold == null ? null : intel.dev_sold ? 'Yes' : 'No'),
		kv('Opening-second volume', pct01(intel.snipe_ratio), 'Share of buy volume that landed in the first seconds after launch.'),
		kv('Top 10 at launch', pct01(intel.concentration_top10), 'Share of bought supply held by the ten largest early buyers.'),
		kv('New wallets', pct01(intel.fresh_wallet_ratio), 'Share of early buyers whose wallets had no prior history.'),
	].filter(Boolean);

	if (!cells.length) {
		target.hidden = true;
		return;
	}
	const span = intel.observation_seconds != null ? `first ${intel.observation_seconds}s` : 'at launch';
	section(target, 'Launch activity', el('div', { class: 'ld-ts-grid ld-ts-facts' }, cells), { tag: span });
}

// ════════════════════════════════════════════════════════════════════════════
// NOTABLE WALLETS: wallets with a public track record that bought this coin
// ════════════════════════════════════════════════════════════════════════════
//
// Shows who bought and their public record, with no score for the coin itself.
// Hidden when no such wallet has touched the coin: an empty "nobody notable"
// panel on someone's launch reads as a knock, not information.

const WALLET_LABEL = {
	smart_money: { label: 'Graduated picks', tip: 'This wallet has a record of buying coins that went on to graduate.' },
	sniper: { label: 'Early buyer', tip: 'This wallet often buys in the first moments of a launch.' },
	fresh: { label: 'New wallet', tip: 'This wallet has little on-chain history.' },
};

function walletRow(w) {
	const meta = WALLET_LABEL[w.label] || null;
	const winPct = w.win_rate != null ? Math.round(w.win_rate * 100) : null;
	return el(
		'a',
		{
			class: 'ld-sm-row',
			href: `https://solscan.io/account/${w.wallet}`,
			target: '_blank',
			rel: 'noopener noreferrer',
			'aria-label': `Wallet ${shortAddr(w.wallet)}, bought ${fmtSol(w.buy_sol, { sign: false })}`,
		},
		[
			el('span', { class: 'ld-sm-dot ld-fill-muted', 'aria-hidden': 'true' }),
			el('div', { class: 'ld-sm-who' }, [
				el('span', { class: 'ld-sm-addr', text: shortAddr(w.wallet, 4, 4) }),
				meta ? el('span', { class: 'ld-sm-label ld-muted', title: meta.tip, text: meta.label }) : null,
			]),
			el('div', { class: 'ld-sm-rec' }, [
				winPct != null ? el('span', { class: 'ld-sm-win', text: `${winPct}% graduated` }) : null,
			]),
			el('span', { class: 'ld-sm-buy', text: fmtSol(w.buy_sol, { sign: false }) }),
		],
	);
}

async function renderSmartMoney() {
	const target = $('ld-smart');
	target.hidden = true;
	if (state.network !== 'mainnet') return;

	let data = null;
	try {
		data = await fetchJson(`/api/pump/smart-money?mint=${encodeURIComponent(state.mint)}`);
	} catch {
		return;
	}
	const notable = (data?.notable || [])
		.filter((w) => w && w.wallet)
		.sort((a, b) => Number(b.buy_sol || 0) - Number(a.buy_sol || 0));
	if (!notable.length) return;

	target.hidden = false;
	section(
		target,
		'Notable wallets',
		el('div', { class: 'ld-sm' }, [
			el('div', { class: 'ld-sm-list' }, [
				el('div', { class: 'ld-sm-list-head' }, [
					el('span', { text: 'Wallet' }),
					el('span', { text: 'Record' }),
					el('span', { text: 'Bought' }),
				]),
				...notable.slice(0, 8).map(walletRow),
			]),
		]),
		{ tag: 'public track records' },
	);
}
// ════════════════════════════════════════════════════════════════════════════
// PRICE CHART
// ════════════════════════════════════════════════════════════════════════════

const INTERVALS = [
	['5m', '5m'],
	['15m', '15m'],
	['1H', '1h'],
	['4H', '4h'],
	['1D', '1d'],
];
const WINDOW_HOURS = { '5m': 12, '15m': 36, '1h': 96, '4h': 480, '1d': 2160 };

function areaChart(points) {
	// points: [{t,o,h,l,c,v}] ascending. Pure SVG, theme-aware via currentColor.
	// Volume bars rendered in a 40px panel at the bottom, price line above.
	const w = 720;
	const h = 270;
	const volH = 40;  // height of volume bar panel
	const priceH = h - volH;
	const pad = { t: 14, r: 8, b: 4, l: 8 };
	const closes = points.map((p) => p.c);
	const vols = points.map((p) => p.v || 0);
	const min = Math.min(...closes);
	const max = Math.max(...closes);
	const span = max - min || max || 1;
	const maxVol = Math.max(...vols) || 1;
	const innerW = w - pad.l - pad.r;
	const innerH = priceH - pad.t - pad.b;
	const x = (i) => pad.l + (i / Math.max(1, points.length - 1)) * innerW;
	const y = (v) => pad.t + innerH - ((v - min) / span) * innerH;

	const up = points.length > 1 && closes[closes.length - 1] >= closes[0];
	const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.c).toFixed(1)}`).join(' ');
	const area = `${line} L${x(points.length - 1).toFixed(1)} ${(priceH - pad.b).toFixed(1)} L${x(0).toFixed(1)} ${(priceH - pad.b).toFixed(1)} Z`;

	// Volume bars — each candle gets a bar in the lower panel. Buy-dominant
	// candles (close > open) are tinted green, sell-dominant tinted red.
	const barW = Math.max(1, (innerW / points.length) * 0.65);
	const volBars = points.map((p, i) => {
		const barH = (p.v / maxVol) * (volH - 6);
		const isUp = p.c >= p.o;
		const bx = x(i) - barW / 2;
		const by = h - barH - 2;
		return svg('rect', {
			x: bx.toFixed(1),
			y: by.toFixed(1),
			width: barW.toFixed(1),
			height: Math.max(1, barH).toFixed(1),
			class: `ld-vol-bar ${isUp ? 'ld-vol-up' : 'ld-vol-dn'}`,
			rx: '1',
		});
	});

	const node = svg('svg', { viewBox: `0 0 ${w} ${h}`, class: `ld-chart-svg ${up ? 'ld-chart-up' : 'ld-chart-down'}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Price history chart with volume' });
	const gradId = 'ldchartgrad';
	const defs = svg('defs', {});
	const grad = svg('linearGradient', { id: gradId, x1: '0', y1: '0', x2: '0', y2: '1' });
	grad.append(
		svg('stop', { offset: '0%', 'stop-color': 'currentColor', 'stop-opacity': '0.28' }),
		svg('stop', { offset: '100%', 'stop-color': 'currentColor', 'stop-opacity': '0' }),
	);
	defs.append(grad);
	// Divider between price and volume panels.
	const divider = svg('line', { x1: pad.l, y1: priceH, x2: w - pad.r, y2: priceH, class: 'ld-vol-divider' });
	node.append(defs, ...volBars, divider);
	node.append(
		svg('path', { d: area, fill: `url(#${gradId})`, stroke: 'none' }),
		svg('path', { d: line, fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
	);
	return node;
}

function chartIntervalBar() {
	return el(
		'div',
		{ class: 'ld-chart-bar', role: 'tablist', 'aria-label': 'Chart interval' },
		INTERVALS.map(([label, value]) =>
			el('button', {
				class: `ld-int-btn${state.chartInterval === value ? ' active' : ''}`,
				type: 'button',
				role: 'tab',
				'aria-selected': String(state.chartInterval === value),
				text: label,
				onclick: () => {
					if (state.chartInterval === value) return;
					state.chartInterval = value;
					renderChart();
				},
			}),
		),
	);
}

// Chart source switch. Every chart a viewer might trust, free and keyless:
//   · three.ws     the fast native area chart over /api/pump/price-history
//   · TradingView  TradingView's charting engine (lightweight-charts) drawing
//                  real candles from the same OHLCV, ticked live by the trade
//                  stream. Shared with Mission Control and /trades.
//   · DexScreener, Birdeye, GMGN, DEXTools, GeckoTerminal: each provider's
//                  own chart, embedded. URL shapes live in
//                  src/shared/chart-embeds.js.
// Only the chosen view loads, so the default stays light.
const CHART_VIEWS = [
	{ id: 'native', label: 'three.ws', kind: 'native' },
	{ id: 'tradingview', label: 'TradingView', kind: 'tradingview' },
	...CHART_EMBEDS.map((p) => ({ id: p.id, label: p.label, kind: 'embed', provider: p })),
];

const OHLCV_SOURCE_LABEL = { birdeye: 'Birdeye OHLCV', gecko: 'GeckoTerminal OHLCV', pumpfun: 'pump.fun OHLCV' };

function setChartView(id) {
	if (state.chartView === id) return;
	state.chartView = id;
	writeChartView(id);
	renderChart();
}

function chartViewBar() {
	const buttons = CHART_VIEWS.map((view) =>
		el('button', {
			class: `ld-int-btn${state.chartView === view.id ? ' active' : ''}`,
			type: 'button',
			role: 'tab',
			'data-view': view.id,
			'aria-selected': String(state.chartView === view.id),
			tabindex: state.chartView === view.id ? '0' : '-1',
			text: view.label,
			onclick: () => setChartView(view.id),
		}),
	);
	// Roving tabindex: arrow keys move between sources, Home/End jump to the ends.
	const onkeydown = (e) => {
		const i = buttons.indexOf(document.activeElement);
		if (i < 0) return;
		const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: buttons.length - 1 }[e.key];
		if (next == null) return;
		e.preventDefault();
		const id = CHART_VIEWS[(next + buttons.length) % buttons.length].id;
		setChartView(id);
		$('ld-chart').querySelector(`[data-view="${id}"]`)?.focus();
	};
	return el('div', { class: 'ld-chart-views', role: 'tablist', 'aria-label': 'Chart source', onkeydown }, buttons);
}

function currentTheme() {
	return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function openLink(href, label) {
	return el('a', { class: 'ld-chart-open', href, target: '_blank', rel: 'noopener', text: `Open in ${label} ↗` });
}

// A chart is not a place to fill an order. Every coin page also offers the
// trading terminals people actually execute on, straight to this mint. Sourced
// from src/shared/trading-terminals.js so the links (and the GMGN referral baked
// into its deep link) stay identical across the product.
function terminalLinksEl() {
	return el(
		'div',
		{ class: 'ld-chart-terminals' },
		terminalLinks(state.mint, { from: 'launch-detail' }).map((t) =>
			el('a', {
				class: 'ld-chart-terminal',
				href: t.url,
				target: '_blank',
				rel: 'noopener',
				title: `Trade this coin on ${t.label}`,
				text: t.label,
			}),
		),
	);
}

function embedFrame(wrap, { src, title, name, page, label }) {
	const fail = () => {
		cancel();
		wrap.replaceChildren(
			embedFallbackNode({
				name,
				href: page,
				label: `Open in ${label}`,
				onRetry: () => renderChart(),
				className: 'ld-empty ld-empty-sm ld-embed-fallback',
				buttonClassName: 'ld-btn ld-btn-ghost',
			}),
		);
	};
	const iframe = el('iframe', {
		class: 'ld-dex-frame',
		src,
		title,
		loading: 'lazy',
		allow: 'clipboard-write; fullscreen',
		referrerpolicy: 'strict-origin-when-cross-origin',
		onload: () => {
			cancel();
			wrap.classList.add('ld-dex-ready');
		},
		// An outright refusal (blocked host, DNS failure) is knowable immediately.
		onerror: fail,
	});
	// The watchdog clock starts once the frame is on screen, so a chart below the
	// fold is never reported dead before it began loading.
	const cancel = watchEmbed(wrap, { timeoutMs: DEFAULT_EMBED_TIMEOUT_MS, onTimeout: fail });
	wrap.replaceChildren(el('div', { class: 'ld-skel ld-skel-chart' }), iframe);
	return cancel;
}

async function renderEmbedChart(target, view, seq) {
	const { provider } = view;
	const wrap = el('div', { class: 'ld-dex-wrap' }, [el('div', { class: 'ld-skel ld-skel-chart' })]);
	const openSlot = el('span', { class: 'ld-chart-open-slot' });
	const controls = el('div', { class: 'ld-chart-controls' }, [chartViewBar(), terminalLinksEl(), openSlot]);
	section(target, 'Price', el('div', { class: 'ld-chart' }, [controls, wrap]), { tag: `${provider.label} · live` });

	let pool = null;
	if (provider.needs === 'pool') {
		try {
			state.chartPools[provider.id] ||= await resolveChartPool(provider.id, 'solana', state.mint, {
				signal: AbortSignal.timeout(10_000),
			});
		} catch {
			if (seq !== state.chartSeq) return;
			wrap.replaceChildren(
				el('div', { class: 'ld-empty ld-empty-sm ld-embed-fallback' }, [
					el('p', { text: `We could not look up this coin's trading pool for ${provider.label}.` }),
					el('button', { class: 'ld-btn ld-btn-ghost', type: 'button', text: 'Try again', onclick: () => renderChart() }),
				]),
			);
			return;
		}
		if (seq !== state.chartSeq) return;
		const resolved = state.chartPools[provider.id];
		if (!resolved.indexed) {
			// A pool provider cannot draw a coin whose pool it does not know:
			// GeckoTerminal lists a pump.fun coin only once it has traded enough
			// (its embed is a 404 page until then), and DEXTools needs a pair to
			// exist at all. Say so and point at charts that already cover the coin.
			wrap.replaceChildren(
				el('div', { class: 'ld-empty ld-empty-sm ld-embed-fallback' }, [
					el('p', { class: 'ld-empty-title', text: `${provider.label} cannot chart this coin yet.` }),
					el('p', { text: 'It picks up new pump.fun coins once they build trading history. Birdeye, GMGN and DexScreener chart it from the first trade.' }),
					el('div', { class: 'ld-dex-fallback-actions' }, [
						el('button', { class: 'ld-btn ld-btn-ghost', type: 'button', text: 'Show Birdeye', onclick: () => setChartView('birdeye') }),
						el('button', { class: 'ld-btn ld-btn-ghost', type: 'button', text: 'Check again', onclick: () => { delete state.chartPools[provider.id]; renderChart(); } }),
					]),
				]),
			);
			return;
		}
		pool = resolved.pool;
	}

	const urls = chartEmbedUrls(provider.id, { chain: 'solana', token: state.mint, pool, theme: currentTheme() });
	openSlot.replaceChildren(openLink(urls.page, provider.label));
	state.chartTeardown = embedFrame(wrap, {
		src: urls.embed,
		title: `${provider.label} live chart`,
		name: `The ${provider.label} chart`,
		page: urls.page,
		label: provider.label,
	});
}

function renderTradingViewChart(target) {
	const host = el('div', { class: 'ld-tv' });
	const controls = el('div', { class: 'ld-chart-controls' }, [chartViewBar(), terminalLinksEl()]);
	section(target, 'Price', el('div', { class: 'ld-chart' }, [controls, host]), { tag: 'TradingView · live candles' });
	const chart = mountPriceChart({ host, mint: state.mint });
	state.chartTeardown = () => chart.destroy();
}

// The iframe providers bake the theme in at load, so a live theme switch reloads
// whichever embed is showing. Registered once per page.
let chartThemeObserver = null;
function watchChartTheme() {
	if (chartThemeObserver) return;
	chartThemeObserver = new MutationObserver(() => {
		const view = CHART_VIEWS.find((v) => v.id === state.chartView);
		if (view?.kind === 'embed') renderChart();
	});
	chartThemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

async function renderChart() {
	const target = $('ld-chart');
	const seq = ++state.chartSeq;
	state.chartTeardown?.();
	state.chartTeardown = null;
	if (state.network !== 'mainnet') {
		section(target, 'Price', el('div', { class: 'ld-empty' }, [el('p', { text: 'No price history for devnet coins.' })]));
		return;
	}
	watchChartTheme();
	const view = CHART_VIEWS.find((v) => v.id === state.chartView) || CHART_VIEWS[0];
	if (view.kind === 'tradingview') {
		renderTradingViewChart(target);
		return;
	}
	if (view.kind === 'embed') {
		await renderEmbedChart(target, view, seq);
		return;
	}
	const controls = el('div', { class: 'ld-chart-controls' }, [chartViewBar(), chartIntervalBar()]);
	const canvas = el('div', { class: 'ld-chart-canvas' }, [el('div', { class: 'ld-skel ld-skel-chart' })]);
	section(target, 'Price', el('div', { class: 'ld-chart' }, [controls, canvas]), { tag: 'On-chain OHLCV' });

	const interval = state.chartInterval;
	const to = Math.floor(Date.now() / 1000);
	const from = to - (WINDOW_HOURS[interval] || 36) * 3600;
	try {
		const body = await fetchJson(
			`/api/pump/price-history?mint=${encodeURIComponent(state.mint)}&interval=${interval}&from=${from}&to=${to}`,
		);
		if (seq !== state.chartSeq) return;
		const tag = target.querySelector('.ld-sec-tag');
		if (tag && OHLCV_SOURCE_LABEL[body.source]) tag.textContent = OHLCV_SOURCE_LABEL[body.source];
		const pts = (body.data || []).filter((p) => Number.isFinite(p.c));
		if (pts.length < 2) {
			canvas.replaceChildren(
				el('div', { class: 'ld-empty ld-empty-sm' }, [
					el('p', { text: 'Not enough trade history at this interval for a line yet.' }),
					el('div', { class: 'ld-dex-fallback-actions' }, [
						el('button', { class: 'ld-btn ld-btn-ghost', type: 'button', text: 'Show live candles', onclick: () => setChartView('tradingview') }),
					]),
				]),
			);
			return;
		}
		const first = pts[0].c;
		const last = pts[pts.length - 1].c;
		const changePct = first ? ((last - first) / first) * 100 : 0;
		const readout = [
			el('span', { class: 'ld-chart-price', text: fmtPrice(last) }),
			el('span', { class: `ld-chart-change ${pnlClass(changePct)}`, text: fmtPct(changePct, { sign: true }) }),
		];
		// The API serves its last real candles when both price sources are briefly
		// unreachable. Say so rather than passing off old prices as live.
		if (body.stale) {
			readout.push(
				el('span', {
					class: 'ld-chart-stale',
					text: 'delayed',
					title: 'The live price feed is briefly unreachable — showing the most recent candles we hold.',
				}),
			);
		}
		canvas.replaceChildren(el('div', { class: 'ld-chart-readout' }, readout), areaChart(pts));
	} catch (err) {
		if (seq !== state.chartSeq) return;
		// A coin with no liquidity pool has no chart to draw — that is an answer,
		// not a failure, so it gets its own copy and no Retry button.
		if (err?.status === 404 && err?.code === 'no_market') {
			canvas.replaceChildren(
				el('div', { class: 'ld-empty ld-empty-sm' }, [
					el('p', { text: 'No liquidity pool yet — this coin has no price history to chart.' }),
				]),
			);
			return;
		}
		canvas.replaceChildren(
			el('div', { class: 'ld-empty ld-empty-sm' }, [
				el('p', { text: 'Price history is unavailable right now.' }),
				el('button', { class: 'ld-btn ld-btn-ghost', type: 'button', text: 'Retry', onclick: () => renderChart() }),
			]),
		);
	}
}

// ════════════════════════════════════════════════════════════════════════════
// HOLDER DISTRIBUTION
// ════════════════════════════════════════════════════════════════════════════

async function renderDistribution() {
	const target = $('ld-distribution');
	if (state.network !== 'mainnet') {
		target.hidden = true;
		return;
	}
	target.replaceChildren(el('div', { class: 'ld-skel', style: 'height:180px' }));

	let stats = null;
	try {
		stats = await loadStats();
	} catch {
		/* rendered as the unavailable state below */
	}
	const h = stats?.holders;
	if (!h) {
		section(
			target,
			'Holders',
			el('div', { class: 'ld-empty ld-empty-sm' }, [
				el('p', { text: stats ? 'Holder data is not indexed for this coin yet.' : 'Holder data is unavailable right now.' }),
				stats ? null : el('button', { class: 'ld-btn ld-btn-ghost', type: 'button', text: 'Retry', onclick: () => renderDistribution() }),
			]),
		);
		return;
	}

	const metric = (k, v) =>
		el('div', { class: 'ld-metric' }, [
			el('span', { class: 'ld-metric-label', text: k }),
			el('span', { class: 'ld-metric-val', text: v }),
		]);
	const metrics = el('div', { class: 'ld-metrics' }, [
		metric('Holders', h.count != null ? compact(h.count) : '-'),
		metric('Top holder', share(h.top1_pct)),
		metric('Top 10', share(h.top10_pct)),
		metric('Dev', share(h.dev_pct)),
		h.pool_pct ? metric('AMM pool', share(h.pool_pct)) : metric('Bonding curve', share(h.curve_pct)),
	]);

	const rows = (h.top || []).map((row, i) =>
		el('a', {
			class: 'ld-holder',
			href: `https://solscan.io/account/${row.wallet}`,
			target: '_blank',
			rel: 'noopener noreferrer',
			'aria-label': `Holder ${i + 1}, ${shortAddr(row.wallet)}, ${share(row.pct)} of supply`,
		}, [
			el('span', { class: 'ld-holder-rank', text: String(i + 1) }),
			el('span', { class: 'ld-holder-addr', text: shortAddr(row.wallet, 4, 4) }),
			row.is_dev ? el('span', { class: 'ld-holder-tag', text: 'Dev' }) : null,
			el('span', { class: 'ld-holder-bar', 'aria-hidden': 'true' }, [
				el('span', { style: `width:${Math.min(100, (row.pct || 0) * 100)}%` }),
			]),
			el('span', { class: 'ld-holder-pct', text: share(row.pct) }),
		]),
	);

	section(
		target,
		'Holders',
		el('div', { class: 'ld-dist' }, [
			metrics,
			rows.length ? el('div', { class: 'ld-holders' }, rows) : null,
			el('p', {
				class: 'ld-ts-note',
				text: h.complete === false
					? 'Shares are of total supply, read from the 20 largest accounts while the full holder index is unavailable, so the holder count is not shown. The bonding curve and AMM pool are liquidity, not holders, and are left out of the ranking.'
					: 'Shares are of total supply. The bonding curve and AMM pool are liquidity, not holders, so they are left out of the ranking.',
			}),
		]),
		{ tag: h.complete === false ? 'live · largest accounts' : 'live · all holders' },
	);
}
// ════════════════════════════════════════════════════════════════════════════
// BUYBACK / BURN ECONOMICS
// ════════════════════════════════════════════════════════════════════════════

function renderEconomics() {
	const target = $('ld-economics');
	const econ = state.detail.economics;
	const reg = state.detail.registry;
	const buybackBps = Number(reg?.buyback_bps || 0);

	if (!state.detail.found) {
		target.hidden = true;
		return;
	}

	const creatorFees = econ?.creator_fees;
	// Present whenever the earnings snapshot (or the live fallback) reported this
	// coin, zero included: "earned 0 SOL so far" is a real, useful answer.
	const hasCreatorFees = !!creatorFees && creatorFees.earned_sol != null;

	if (buybackBps <= 0 && (!econ || econ.confirmed_payments === 0) && !hasCreatorFees) {
		section(
			target,
			'Economics',
			el('div', { class: 'ld-empty ld-empty-sm' }, [
				el('p', { text: 'This launch has no buyback-and-burn loop configured.' }),
				el('a', { class: 'ld-btn ld-btn-ghost', href: '/launchpad', text: 'How buyback coins work →' }),
			]),
		);
		return;
	}

	const burned = Number(econ?.burns?.total_burned || 0);
	const metric = (k, v, sub = null) =>
		el('div', { class: 'ld-econ-metric' }, [
			el('span', { class: 'ld-econ-val', text: v }),
			el('span', { class: 'ld-econ-label', text: k }),
			sub ? el('span', { class: 'ld-econ-sub', text: sub }) : null,
		]);

	const body = el('div', { class: 'ld-econ' }, [
		buybackBps > 0
			? el('p', { class: 'ld-econ-lede', text: `Every agent payment routes ${(buybackBps / 100).toFixed(1)}% into an automated buyback that burns supply, so paying users fund a deflationary loop.` })
			: el('p', { class: 'ld-econ-lede', text: 'Every trade of this coin pays its creator a fee. Here is what it has earned, claimed and left to claim.' }),
		el('div', { class: 'ld-econ-grid' }, [
			buybackBps > 0 ? metric('Buyback rate', `${(buybackBps / 100).toFixed(1)}%`) : null,
			buybackBps > 0 || econ?.confirmed_payments
				? metric('Paid calls', compact(econ?.confirmed_payments || 0), `${compact(econ?.unique_payers || 0)} payers`)
				: null,
			buybackBps > 0 ? metric('Burn runs', compact(econ?.burns?.runs || 0)) : null,
			burned > 0 ? metric('Supply burned', compact(burned / 1e6)) : null,
			hasCreatorFees
				? metric(
						'Creator earned',
						fmtSol(Number(creatorFees.earned_sol), { sign: false }),
						creatorFees.earned_usd != null ? fmtUsd(Number(creatorFees.earned_usd), { sign: false }) : null,
					)
				: null,
			hasCreatorFees && creatorFees.claimed_sol != null
				? metric('Claimed', fmtSol(Number(creatorFees.claimed_sol), { sign: false }))
				: null,
			hasCreatorFees && creatorFees.unclaimed_sol != null
				? metric('Unclaimed', fmtSol(Number(creatorFees.unclaimed_sol), { sign: false }))
				: null,
		]),
	]);
	if (hasCreatorFees) body.appendChild(creatorFeesNote(creatorFees));

	// Recent burn proofs — each links to its Solana transaction.
	const feed = (econ?.burns_feed || []).slice(0, 5);
	if (feed.length) {
		body.appendChild(
			el('div', { class: 'ld-burn-feed' }, [
				el('span', { class: 'ld-burn-feed-title', text: 'Recent burns' }),
				...feed.map((b) => {
					const cells = [
						el('span', { class: 'ld-burn-amt', text: `🔥 ${compact(Number(b.burn_amount || 0) / 1e6)}` }),
						el('span', { class: 'ld-burn-time', text: relTime(b.created_at) }),
					];
					// Only render a clickable tx link when the burn has a signature —
					// otherwise show a plain, non-linking row (no dead href="#").
					if (b.tx_signature) {
						cells.push(el('span', { class: 'ld-burn-link', text: 'tx ↗' }));
						return el('a', {
							class: 'ld-burn-row',
							href: `https://solscan.io/tx/${b.tx_signature}`,
							target: '_blank',
							rel: 'noopener noreferrer',
						}, cells);
					}
					return el('div', { class: 'ld-burn-row' }, cells);
				}),
			]),
		);
	}

	section(target, 'Economics', body, { tag: 'on-chain' });
}

// Where the creator-fee figures come from, how fresh they are, and (when
// pump.fun reports one figure for a wallet that created several coins) that
// the number is shared. Links to the agent's full earnings on its own page.
function creatorFeesNote(fees) {
	const parts = [];
	if (Number(fees.wallet_coin_count) > 1) {
		parts.push(`Combined for ${fees.wallet_coin_count} coins created by the same wallet.`);
	}
	parts.push(
		fees.refreshed_at
			? `Creator fees from pump.fun, updated ${relTime(fees.refreshed_at)}.`
			: 'Creator fees from pump.fun.',
	);
	const agent = state.detail.agent;
	return el('p', { class: 'ld-econ-note' }, [
		el('span', { text: parts.join(' ') + ' ' }),
		agent?.id && agent.is_public
			? el('a', { href: `/agents/${encodeURIComponent(agent.id)}#av-earned`, text: 'See everything this agent earned →' })
			: null,
	]);
}

// ════════════════════════════════════════════════════════════════════════════
// AGENT BEHIND THE COIN
// ════════════════════════════════════════════════════════════════════════════

// Lazy-load the first-party <agent-3d> web component. Tries the CDN, then the
// same-origin mirror, then the dev bundle — robust across prod and local dev.
// Resolved once and shared, so a second mount never re-imports.
let agent3DLibPromise = null;
function ensureAgent3DLib() {
	if (customElements.get('agent-3d')) return Promise.resolve(true);
	if (agent3DLibPromise) return agent3DLibPromise;
	const candidates = [
		'https://three.ws/agent-3d/latest/agent-3d.js',
		'/agent-3d/latest/agent-3d.js',
		'/dist-lib/agent-3d.js',
	];
	agent3DLibPromise = (async () => {
		for (const url of candidates) {
			try {
				await import(/* @vite-ignore */ url);
				if (customElements.get('agent-3d')) return true;
			} catch {
				/* try next candidate */
			}
		}
		return false;
	})();
	return agent3DLibPromise;
}

// The launching agent rendered as its real, interactive 3D avatar. Every agent
// resolves to a loadable model — its own GLB when public, else the shared
// mannequin (agentAvatarGlb) — so the stage is never an empty hole. The WebGL
// context is paid only once the card scrolls into view, and a failed/slow load
// degrades to the labelled fallback instead of a blank canvas.
function buildAgentStage(agent) {
	// resolveDevR2Url is a no-op in production; on localhost / Codespaces it
	// rewrites the r2.dev GLB to the same-origin Vite proxy so the cross-origin
	// fetch isn't blocked by CORS. The mannequin fallback is a local path, so it
	// passes through untouched either way.
	const glb = resolveDevR2Url(agentAvatarGlb(agent));
	const custom = hasCustomAvatar(agent);
	const label = `${agent.name || 'Agent'} — interactive 3D avatar`;

	const stage = el('div', {
		class: 'ld-agent-stage',
		'data-state': 'idle',
		role: 'img',
		'aria-label': label,
	});

	// A blurred thumbnail backdrop fills the stage while the model streams in, so
	// the loading state reads as "this avatar, arriving" rather than an empty box.
	// It fades out once the GLB is framed. Falls back to the CSS gradient alone
	// when the agent has no thumbnail.
	// The poster is a blurred backdrop behind the 3D stage, so it never needs the
	// full-size thumbnail; the proxy also keeps a retired art host from leaving
	// the stage flat.
	const posterUrl = proxiedImageURL(agent.avatar_thumbnail_url || '', agent.id || '', { width: 480 });
	if (posterUrl) {
		stage.appendChild(
			el('div', {
				class: 'ld-agent-stage-poster',
				'aria-hidden': 'true',
				style: `background-image:url('${encodeURI(posterUrl)}')`,
			}),
		);
	}

	const loadEl = el('div', { class: 'ld-agent-stage-load' }, [
		el('span', { class: 'ld-agent-stage-spin', 'aria-hidden': 'true' }),
		el('span', { class: 'ld-agent-stage-msg', text: 'Loading 3D…' }),
	]);
	stage.appendChild(loadEl);

	const setMsg = (text) => {
		const m = stage.querySelector('.ld-agent-stage-msg');
		if (m) m.textContent = text;
	};

	let mounted = false;
	const mount = async () => {
		if (mounted) return;
		mounted = true;
		const ok = await ensureAgent3DLib();
		if (!ok) {
			stage.dataset.state = 'error';
			setMsg("Couldn't load the 3D viewer.");
			return;
		}
		const a3d = el('agent-3d', { class: 'ld-agent-3d', alt: label });
		a3d.setAttribute('controls', 'orbit');
		a3d.setAttribute('src', glb);
		// A slow R2/CDN read shouldn't leave the spinner spinning forever with no
		// explanation — after 15s, tell the user it's a big model or slow link.
		const slowTimer = setTimeout(() => {
			if (stage.dataset.state === 'idle') setMsg('Still loading — large model or slow connection.');
		}, 15_000);
		a3d.addEventListener('load', () => {
			clearTimeout(slowTimer);
			stage.dataset.state = 'ready';
			loadEl.remove();
		}, { once: true });
		a3d.addEventListener('error', () => {
			clearTimeout(slowTimer);
			stage.dataset.state = 'error';
			setMsg("Couldn't load the 3D model.");
		}, { once: true });
		stage.appendChild(a3d);
		stage.appendChild(
			el('div', { class: 'ld-agent-stage-bar' }, [
				el('span', { class: 'ld-agent-stage-hint', text: custom ? 'Drag to orbit · scroll to zoom' : 'Base avatar · drag to orbit' }),
				el('a', {
					class: 'ld-agent-stage-world',
					href: seeInWorldHref(agent),
					text: 'See in world →',
					'aria-label': `See ${agent.name || 'this agent'} in the $THREE world`,
				}),
			]),
		);
	};

	// Pay for the WebGL context only when the card is actually near the viewport,
	// and tear the observer down once mounted so it can't fire twice.
	if ('IntersectionObserver' in window) {
		const io = new IntersectionObserver((entries) => {
			for (const e of entries) {
				if (e.isIntersecting) {
					io.disconnect();
					mount();
				}
			}
		}, { rootMargin: '240px' });
		io.observe(stage);
	} else {
		mount();
	}

	return stage;
}

function renderAgent() {
	const target = $('ld-agent');
	const agent = state.detail.agent;
	const trader = state.detail.trader;

	if (!agent) {
		target.hidden = true;
		return;
	}

	const head = el('a', { class: 'ld-agent-head', href: agent.url, 'aria-label': `View agent ${agent.name}` }, [
		el('div', { class: 'ld-agent-id' }, [
			el('span', { class: 'ld-agent-name', text: agent.name || 'Agent' }),
			el('span', { class: 'ld-agent-role', text: 'Launching agent' }),
		]),
		el('span', { class: 'ld-agent-go', text: '→' }),
	]);

	const body = el('div', { class: 'ld-agent-body' }, [buildAgentStage(agent), head]);

	// The launching agent's custodial Solana wallet — vanity-aware, copyable,
	// read-only for visitors. agent_authority (the on-chain signer) backstops the
	// agent record's own solana_address. Owner-only actions live in the wallet hub.
	const walletChip = walletChipEl(
		{
			...agent,
			id: agent.id,
			solana_address:
				agent.solana_address || agent.meta?.solana_address || state.detail.agent_authority || null,
		},
		{ isOwner: false, showPending: false, link: true },
	);
	if (walletChip) body.appendChild(walletChip);

	if (agent.description) {
		body.appendChild(el('p', { class: 'ld-agent-desc', text: agent.description }));
	}

	if (trader) {
		const scoreEl = el('div', { class: 'ld-trader' }, [
			el('div', { class: 'ld-trader-stats' }, [
				trader.verified ? el('span', { class: 'ld-verified', html: verifiedBadge(true) }) : null,
				el('div', { class: 'ld-trader-row' }, [
					el('span', { class: 'ld-tl', text: 'Realized P&L' }),
					el('span', { class: `ld-tv ${pnlClass(trader.realized_pnl_sol)}`, text: fmtSol(trader.realized_pnl_sol) }),
				]),
				el('div', { class: 'ld-trader-row' }, [
					el('span', { class: 'ld-tl', text: 'Win rate' }),
					el('span', { class: 'ld-tv', text: trader.win_rate != null ? fmtPct(trader.win_rate * 100) : '—' }),
				]),
				el('div', { class: 'ld-trader-row' }, [
					el('span', { class: 'ld-tl', text: 'Closed trades' }),
					el('span', { class: 'ld-tv', text: compact(trader.closed_count || 0) }),
				]),
			]),
		]);
		body.appendChild(scoreEl);
		const ctaRow = el('div', { class: 'ld-agent-ctas' }, [
			el('a', { class: 'ld-btn ld-btn-ghost ld-btn-sm', href: `/trader/${agent.id}`, text: 'Track record →' }),
			el('a', { class: 'ld-btn ld-btn-accent ld-btn-sm', href: `/trader/${agent.id}#tp-copy-panel`, text: 'Copy trades ⚡' }),
		]);
		body.appendChild(ctaRow);
	} else {
		body.appendChild(
			el('p', { class: 'ld-agent-note', text: 'No public trading track record yet for this agent.' }),
		);
	}

	section(target, 'The agent', body);
}

// ════════════════════════════════════════════════════════════════════════════
// LIVE TRADE TAPE  (SSE with a polling fallback)
// ════════════════════════════════════════════════════════════════════════════

function tapeRow(t) {
	const isBuy = t.is_buy ?? (String(t.txType || t.type || '').toLowerCase() === 'buy');
	const sol = Number(t.sol_amount ?? (t.lamports != null ? t.lamports / 1e9 : t.solAmount));
	const who = t.user || t.buyer || t.seller || t.traderPublicKey || null;
	return el('div', { class: `ld-trade ${isBuy ? 'ld-buy' : 'ld-sell'}` }, [
		el('span', { class: 'ld-trade-side', text: isBuy ? 'BUY' : 'SELL' }),
		el('span', { class: 'ld-trade-amt', text: Number.isFinite(sol) ? fmtSol(sol, { sign: false }) : '—' }),
		el('span', { class: 'ld-trade-who', text: who ? shortAddr(who) : '' }),
	]);
}

function pushTrade(listEl, t) {
	const row = tapeRow(t);
	if (!REDUCED_MOTION) row.classList.add('ld-trade-in');
	listEl.insertBefore(row, listEl.firstChild);
	// Directional tint pulse on the freshest trade — buys read success-green, sells
	// danger-red, matching the swarms feed vocabulary on top of the slide-in.
	flashValue(row, row.classList.contains('ld-buy') ? 'up' : 'down');
	while (listEl.children.length > 24) listEl.removeChild(listEl.lastChild);
}

async function seedTape(listEl) {
	try {
		const body = await fetchJson(`/api/pump/coin-trades?mint=${encodeURIComponent(state.mint)}&limit=20`);
		const trades = body.trades || [];
		if (!trades.length) {
			listEl.appendChild(el('div', { class: 'ld-tape-empty', text: 'Waiting for the next trade…' }));
			return;
		}
		trades.forEach((t) => listEl.appendChild(tapeRow(t)));
	} catch {
		listEl.appendChild(el('div', { class: 'ld-tape-empty', text: 'Trade feed is quiet right now.' }));
	}
}

function startTape(listEl, dot) {
	// Live SSE stream caps at 90s server-side; reconnect transparently so the
	// tape stays live for as long as the page is open and visible.
	let es = null;
	let pollTimer = 0;
	let closed = false;

	const setLive = (live) => {
		setLiveDot(dot, live ? 'live' : 'connecting', live ? 'live' : 'reconnecting');
	};

	const connect = () => {
		if (closed || document.hidden) return;
		try {
			es = new EventSource(`/api/pump/trades-stream?mint=${encodeURIComponent(state.mint)}`);
		} catch {
			startPolling();
			return;
		}
		const onTrade = (e) => {
			setLive(true);
			try {
				const d = JSON.parse(e.data);
				if (d && (d.mint === state.mint || !d.mint)) {
					const empty = listEl.querySelector('.ld-tape-empty');
					if (empty) empty.remove();
					pushTrade(listEl, d);
				}
			} catch {
				/* ignore malformed frame */
			}
		};
		es.addEventListener('open', () => setLive(true));
		es.addEventListener('buy', onTrade);
		es.addEventListener('sell', onTrade);
		es.addEventListener('trade', onTrade);
		es.addEventListener('close', () => {
			es?.close();
			if (!closed) setTimeout(connect, 600); // server hit its duration cap — reconnect
		});
		es.onerror = () => {
			setLive(false);
			es?.close();
			if (!closed) setTimeout(connect, 2500);
		};
	};

	const startPolling = () => {
		// Last-resort fallback if EventSource is unavailable.
		setLive(false);
		const seen = new Set();
		const tick = async () => {
			if (closed || document.hidden) return;
			try {
				const body = await fetchJson(`/api/pump/coin-trades?mint=${encodeURIComponent(state.mint)}&limit=10`);
				for (const t of (body.trades || []).reverse()) {
					if (t.tx && !seen.has(t.tx)) {
						seen.add(t.tx);
						const empty = listEl.querySelector('.ld-tape-empty');
						if (empty) empty.remove();
						pushTrade(listEl, t);
					}
				}
			} catch {
				/* keep polling */
			}
		};
		pollTimer = setInterval(tick, 5000);
	};

	if ('EventSource' in window) connect();
	else startPolling();

	document.addEventListener('visibilitychange', () => {
		if (document.hidden) {
			es?.close();
			clearInterval(pollTimer);
		} else if (!closed) {
			if ('EventSource' in window) connect();
		}
	});

	return {
		destroy() {
			closed = true;
			es?.close();
			clearInterval(pollTimer);
		},
	};
}

async function renderTape() {
	const target = $('ld-tape');
	if (state.network !== 'mainnet') {
		target.hidden = true;
		return;
	}
	// Shared live-state indicator (connecting → live) for the SSE trade tape.
	const dot = el('span', { class: 'ld-tape-live', html: liveDot('connecting', { label: 'live' }) });
	const list = el('div', { class: 'ld-tape-list' });
	const head = el('div', { class: 'ld-sec-head' }, [
		el('h2', { class: 'ld-sec-title' }, [el('span', { text: 'Live trades' }), dot]),
	]);
	target.replaceChildren(head, list);
	target.classList.add('ld-revealed');

	await seedTape(list);
	state.tape = startTape(list, dot);
}

// ════════════════════════════════════════════════════════════════════════════
// COMMUNITY
// ════════════════════════════════════════════════════════════════════════════

async function renderCommunity() {
	const target = $('ld-community');
	if (state.network !== 'mainnet') {
		target.hidden = true;
		return;
	}
	const symbol = (state.coin?.symbol || state.detail.registry?.symbol || '').toUpperCase();

	const sentWrap = el('div', { class: 'ld-sentiment-wrap' }, [
		el('div', { class: 'ld-skel', style: 'height:64px;margin-bottom:10px' }),
	]);

	const body = el('div', { class: 'ld-community' }, [
		sentWrap,
		el('p', { style: 'font-size:12.5px;color:var(--ld-muted)', text: `Every coin gets a live chat and a walkable 3D world. Meet the holders of ${symbol ? `$${symbol}` : 'this coin'}.` }),
		el('div', { class: 'ld-community-ctas', style: 'margin-top:10px' }, [
			el('a', { class: 'ld-btn ld-btn-ghost', href: `/communities/${state.mint}`, text: 'Open chat & world →' }),
		]),
	]);
	section(target, 'Community', body, { tag: 'pump.fun sentiment' });

	// Async: fetch pump.fun comment sentiment
	try {
		const res = await fetch('/api/social/sentiment-pulse', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ token: state.mint }),
			signal: AbortSignal.timeout(10000),
		});
		if (!res.ok) { sentWrap.replaceChildren(); return; }
		const d = await res.json();
		if (!d.ok || !d.overall || d.overall.count < 3) { sentWrap.replaceChildren(); return; }
		const o = d.overall;

		const bars = [
			['Positive', Math.round(o.posPct), 'var(--ld-good)'],
			['Negative', Math.round(o.negPct), 'var(--ld-bad)'],
			['Neutral',  Math.round(o.neuPct), 'var(--ld-muted)'],
		].map(([label, pct, color]) =>
			el('div', { class: 'ld-oracle-pillar' }, [
				el('span', { class: 'ld-oracle-pillar-label', text: label }),
				el('div', { class: 'ld-oracle-pillar-bar' }, [
					el('div', { class: 'ld-oracle-pillar-fill', style: `width:${pct}%;background:${color}` }),
				]),
				el('span', { class: 'ld-oracle-pillar-val', text: `${pct}%` }),
			])
		);

		const examples = (o.examples || []).slice(0, 1).map((ex) =>
			el('p', { class: 'ld-sent-example', style: 'font-size:11px;color:var(--ld-muted);margin-top:6px;font-style:italic;line-height:1.5' }, [
				document.createTextNode(`"${ex}"`)
			])
		);

		sentWrap.replaceChildren(
			el('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px' }, [
				el('span', { style: 'font:600 12px var(--font-mono,monospace);color:var(--ld-muted)' }, [document.createTextNode(`${o.count} recent comments`)]),
			]),
			el('div', { class: 'ld-oracle-pillars' }, bars),
			...examples,
		);
	} catch {
		sentWrap.replaceChildren();
	}
}

// ════════════════════════════════════════════════════════════════════════════
// ACTIONS  (buy / 3D / watch / share)
// ════════════════════════════════════════════════════════════════════════════

const WATCH_KEY = 'ld_watchlist';

function readWatchlist() {
	try {
		return JSON.parse(localStorage.getItem(WATCH_KEY) || '[]');
	} catch {
		return [];
	}
}

function isWatched() {
	return readWatchlist().includes(state.mint);
}

function toggleWatch(btn) {
	const list = readWatchlist();
	const i = list.indexOf(state.mint);
	if (i >= 0) list.splice(i, 1);
	else list.unshift(state.mint);
	try {
		localStorage.setItem(WATCH_KEY, JSON.stringify(list.slice(0, 200)));
	} catch {
		/* storage full / blocked — non-fatal */
	}
	paintWatch(btn);
}

function paintWatch(btn) {
	const on = isWatched();
	btn.classList.toggle('ld-watch-on', on);
	btn.setAttribute('aria-pressed', String(on));
	btn.replaceChildren(
		el('span', { text: on ? '★' : '☆' }),
		el('span', { text: on ? 'Watching' : 'Watch' }),
	);
}

function renderActions() {
	const target = $('ld-actions');
	const isDevnet = state.network === 'devnet';
	const symbol = (state.coin?.symbol || state.detail.registry?.symbol || '').toUpperCase();
	const mint = state.mint;

	const watchBtn = el('button', { class: 'ld-btn ld-watch', type: 'button', 'aria-pressed': 'false' });
	paintWatch(watchBtn);
	watchBtn.addEventListener('click', () => toggleWatch(watchBtn));

	const shareBtn = el('button', {
		class: 'ld-btn ld-btn-ghost',
		type: 'button',
		text: 'Share',
		onclick: async (e) => {
			const url = `${location.origin}/launches/${mint}`;
			const title = `${symbol ? `$${symbol}` : 'This coin'} on three.ws`;
			if (navigator.share) {
				try {
					await navigator.share({ title, url });
					return;
				} catch {
					/* user cancelled or unsupported — fall through to copy */
				}
			}
			try {
				await navigator.clipboard.writeText(url);
				const btn = e.currentTarget;
				const old = btn.textContent;
				btn.textContent = 'Link copied';
				setTimeout(() => (btn.textContent = old), 1400);
			} catch {
				window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`, '_blank', 'noopener');
			}
		},
	});

	const buttons = [];

	if (isDevnet) {
		buttons.push(
			el('a', { class: 'ld-btn ld-btn-primary', href: `https://explorer.solana.com/address/${mint}?cluster=devnet`, target: '_blank', rel: 'noopener noreferrer', text: 'View on explorer ↗' }),
		);
	} else {
		// Primary: in-platform Jupiter Terminal swap — keeps traders on three.ws.
		buttons.push(
			el('button', {
				class: 'ld-btn ld-btn-primary ld-btn-buy',
				type: 'button',
				text: `Buy ${symbol ? `$${symbol}` : 'token'}`,
				onclick: () => openSwapModal(mint, symbol),
			}),
		);
		// Secondary: pump.fun direct link for power users who prefer it.
		buttons.push(
			el('a', { class: 'ld-btn ld-btn-ghost', href: `https://pump.fun/${mint}`, target: '_blank', rel: 'noopener noreferrer', text: 'pump.fun ↗' }),
		);
		buttons.push(el('a', { class: 'ld-btn ld-btn-ghost', href: `/coin3d?mint=${encodeURIComponent(mint)}`, text: 'View in 3D' }));
	}

	buttons.push(watchBtn, shareBtn);

	const body = el('div', { class: 'ld-action-grid' }, buttons);
	const foot = el('a', { class: 'ld-actions-foot', href: '/watchlist', text: 'View your watchlist →' });
	// Social Boost credits a specific pair page, so link the pool the DEXTools
	// chart already resolved when there is one. Otherwise go through the counted
	// /api/coin/dextools redirect, which resolves the top pool and attributes
	// the visit to this page.
	const dtPool = state.chartPools.dextools?.indexed ? state.chartPools.dextools.pool : null;
	const boost = isDevnet
		? null
		: socialBoostCard({
				mint,
				pair: dtPool,
				href: dtPool ? undefined : dextoolsTokenUrl(mint, { from: 'launch-detail-boost' }),
				symbol,
				buttonClass: 'ld-btn ld-btn-ghost',
				primaryClass: 'ld-btn ld-btn-primary',
			});
	section(target, 'Take action', el('div', {}, [body, boost, foot]));
}

// ════════════════════════════════════════════════════════════════════════════
// AMBIENT FIELD  (shared visual language with /launches)
// ════════════════════════════════════════════════════════════════════════════

function startParticleField() {
	const canvas = $('ld-field');
	if (!canvas) return;
	const ctx = canvas.getContext('2d');
	if (!ctx) return;
	let width = 0;
	let height = 0;
	let particles = [];
	let inkRGB = '232,232,232';
	let raf = 0;

	const readInk = () => {
		const scheme = getComputedStyle(document.documentElement).getPropertyValue('color-scheme');
		inkRGB = scheme.includes('light') ? '20,24,34' : '232,232,232';
	};
	const resize = () => {
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		width = window.innerWidth;
		height = window.innerHeight;
		canvas.width = width * dpr;
		canvas.height = height * dpr;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		const target = Math.min(70, Math.floor((width * height) / 30000));
		particles = Array.from({ length: target }, () => ({
			x: Math.random() * width,
			y: Math.random() * height,
			vx: (Math.random() - 0.5) * 0.1,
			vy: (Math.random() - 0.5) * 0.1,
			r: 0.6 + Math.random() * 1,
		}));
	};
	const draw = () => {
		ctx.clearRect(0, 0, width, height);
		for (const p of particles) {
			p.x += p.vx;
			p.y += p.vy;
			if (p.x < -10) p.x = width + 10;
			if (p.x > width + 10) p.x = -10;
			if (p.y < -10) p.y = height + 10;
			if (p.y > height + 10) p.y = -10;
			ctx.beginPath();
			ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
			ctx.fillStyle = `rgba(${inkRGB},0.14)`;
			ctx.fill();
		}
		for (let i = 0; i < particles.length; i++) {
			for (let j = i + 1; j < particles.length; j++) {
				const a = particles[i];
				const b = particles[j];
				const dx = a.x - b.x;
				const dy = a.y - b.y;
				const d2 = dx * dx + dy * dy;
				if (d2 < 12100) {
					const alpha = 0.045 * (1 - Math.sqrt(d2) / 110);
					ctx.beginPath();
					ctx.moveTo(a.x, a.y);
					ctx.lineTo(b.x, b.y);
					ctx.strokeStyle = `rgba(${inkRGB},${alpha.toFixed(3)})`;
					ctx.lineWidth = 0.6;
					ctx.stroke();
				}
			}
		}
	};
	const loop = () => {
		draw();
		raf = requestAnimationFrame(loop);
	};
	readInk();
	resize();
	window.addEventListener('resize', resize, { passive: true });
	new MutationObserver(readInk).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
	if (REDUCED_MOTION) {
		draw();
		return;
	}
	loop();
	document.addEventListener('visibilitychange', () => {
		if (document.hidden) cancelAnimationFrame(raf);
		else loop();
	});
}

// ════════════════════════════════════════════════════════════════════════════
// STATES
// ════════════════════════════════════════════════════════════════════════════

function renderSkeleton() {
	$('ld-hero').replaceChildren(
		el('div', { class: 'ld-hero-top' }, [
			el('div', { class: 'ld-skel ld-skel-avatar' }),
			el('div', { class: 'ld-skel-stack' }, [
				el('div', { class: 'ld-skel', style: 'width:55%;height:26px' }),
				el('div', { class: 'ld-skel', style: 'width:35%;height:16px' }),
			]),
		]),
		el('div', { class: 'ld-hero-stats' }, Array.from({ length: 4 }, () => el('div', { class: 'ld-skel', style: 'height:46px' }))),
	);
	for (const id of ['ld-metrics', 'ld-chart', 'ld-agent']) {
		$(id).replaceChildren(el('div', { class: 'ld-skel', style: 'height:120px' }));
	}
}

function renderFatal(message) {
	const shell = $('ld-shell');
	shell.setAttribute('aria-busy', 'false');
	shell.querySelectorAll('.ld-section, .ld-hero, .ld-body').forEach((n) => (n.hidden = true));
	$('ld-state').replaceChildren(
		el('div', { class: 'ld-fatal' }, [
			el('h1', { text: message.title }),
			el('p', { text: message.body }),
			el('div', { class: 'ld-fatal-ctas' }, [
				el('a', { class: 'ld-btn ld-btn-primary', href: '/launches', text: 'Browse all launches' }),
				message.retry ? el('button', { class: 'ld-btn ld-btn-ghost', type: 'button', text: 'Retry', onclick: () => location.reload() }) : null,
			]),
		]),
	);
}

// ── Launch Copilot — autonomous market-maker panel ──────────────────────────
// Only coins launched through three.ws (which have an agent wallet) can run a
// market-maker, so the panel renders for those. The copilot handles owner vs.
// public (read-only, transparent) views itself.
let _copilot = null;
function renderCopilot() {
	const target = $('ld-copilot');
	if (!target) return;
	if (!state.detail?.found) { target.remove(); return; }
	const reg = state.detail.registry || {};
	const intel = state.detail.intel || {};
	import('./launch-copilot.js')
		.then(({ mountLaunchCopilot }) => {
			if (_copilot) _copilot.destroy();
			_copilot = mountLaunchCopilot(target, {
				mint: state.mint,
				network: state.network,
				symbol: (reg.symbol || intel.symbol || '').toUpperCase(),
				coinName: reg.name || intel.name || '',
			});
		})
		.catch(() => { target.remove(); });
}

// ════════════════════════════════════════════════════════════════════════════
// BOOT
// ════════════════════════════════════════════════════════════════════════════

async function boot() {
	startParticleField();

	state.chartView = readChartView();
	state.mint = resolveMint();
	if (!state.mint) {
		renderFatal({
			title: 'No coin selected',
			body: 'This page needs a Solana mint address. Pick a coin from the launch feed to see its full profile.',
		});
		return;
	}

	renderSkeleton();

	let detail;
	try {
		detail = await loadDetail();
	} catch {
		renderFatal({
			title: "Couldn't load this coin",
			body: 'The launch API did not respond. Check your connection and try again.',
			retry: true,
		});
		return;
	}
	state.detail = detail;
	state.coin = await loadCoin();

	// Update page-level meta tags so JS-capable crawlers (X, Telegram, Discord)
	// see coin-specific OG data instead of the static placeholder in HTML.
	const regName = detail.registry?.name || detail.intel?.name || '';
	const regSym = detail.registry?.symbol || detail.intel?.symbol || '';
	const pageTitle = [regSym ? `$${regSym}` : '', regName, 'three.ws'].filter(Boolean).join(' · ');
	const pageDesc = `${regSym ? `$${regSym} ` : ''}on three.ws: live price, volume, holders, and trade history.`;
	const ogImg = `https://three.ws/api/pump/launch-og?mint=${state.mint}`;
	document.title = pageTitle;
	setMeta('og:title', pageTitle);
	setMeta('og:description', pageDesc);
	setMeta('og:image', ogImg);
	setMeta('twitter:title', pageTitle);
	setMeta('twitter:description', pageDesc);
	setMeta('twitter:image', ogImg);

	$('ld-shell').setAttribute('aria-busy', 'false');

	// Paint everything. Each section owns its own empty/error state, so one
	// missing data source never blanks the page.
	renderHero();
	renderMetrics();
	renderVerdict();
	renderSmartMoney();
	renderChart();
	renderDistribution();
	renderEconomics();
	renderAgent();
	renderTape();
	renderCommunity();
	renderActions();
	renderCopilot();

	// Refresh the live market every 30s so price / mcap / graduation stay fresh.
	state.priceTimer = setInterval(async () => {
		if (document.hidden) return;
		const prev = state.coin;
		const fresh = await loadCoin();
		if (fresh) {
			state.coin = fresh;
			renderHero();
			// Real-value deltas across the 30s poll drive the game-feel beats: tint the
			// market-cap stat in the direction it moved, and fire a single ripple the
			// moment a coin graduates — a genuine "it shipped" milestone, not a timer.
			const prevMcap = Number(prev?.usd_market_cap);
			const nextMcap = Number(fresh?.usd_market_cap);
			if (Number.isFinite(prevMcap) && Number.isFinite(nextMcap) && nextMcap !== prevMcap) {
				flashValue($('ld-hero')?.querySelector('.ld-stat-mcap dd'), nextMcap > prevMcap ? 'up' : 'down');
			}
			if (prev && prev.complete !== true && fresh.complete === true) {
				rippleOnce($('ld-hero')?.querySelector('.ld-grad'));
			}
		}
	}, 30_000);
}

window.addEventListener('beforeunload', () => {
	state.tape?.destroy?.();
	clearInterval(state.priceTimer);
});

boot();
