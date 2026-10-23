/**
 * /minted — the public gallery of every generated 3D avatar minted as a
 * Metaplex Core NFT through three.ws (Prompt 08, task 5: surface minted 3D
 * assets in the existing launches pattern — the NFT counterpart of /launches).
 *
 * Data flow:
 *   GET /api/v1/tokenized/launches?network=&offset=&limit=  free, public, paginated
 *
 * Each card renders the GLB live (a <model-viewer>, not a static thumbnail),
 * its network, royalty terms, and — when it's a remix — the royalty payout it
 * routed to the original creator. No synthetic entries: an empty network is
 * shown as an honest, actionable empty state.
 */

import { createLogger } from './shared/log.js';
import { enterStagger, updateValue, liveDot, setLiveDot } from './ui-juice.js';
import { shortAddress } from './shared/address.js';

const log = createLogger('minted');

const PAGE_SIZE = 24;

const state = {
	network: 'mainnet',
	offset: 0,
	hasMore: false,
	loading: false,
	items: [],
	count: 0,
	royaltySum: 0,
	remixPaid: 0,
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function shortAddr(a) { return shortAddress(a, 6, 4); }

function timeAgo(iso) {
	const t = new Date(iso).getTime();
	if (!Number.isFinite(t)) return '';
	const s = Math.max(0, Math.round((Date.now() - t) / 1000));
	if (s < 60) return 'just now';
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.round(h / 24);
	if (d < 30) return `${d}d ago`;
	const mo = Math.round(d / 30);
	if (mo < 12) return `${mo}mo ago`;
	return `${Math.round(mo / 12)}y ago`;
}

function explorerAssetUrl(mint, network) {
	const cluster = network === 'devnet' ? '?cluster=devnet' : '';
	return `https://solscan.io/token/${mint}${cluster}`;
}

// ── counters ──────────────────────────────────────────────────────────────────

function renderCounters() {
	updateValue($('mn-c-total'), state.count, (n) => String(n), { flash: false });
	const avgRoyalty =
		state.count > 0 ? Math.round((state.royaltySum / state.count) * 10) / 10 : 0;
	$('mn-c-royalty').textContent = state.count ? `${avgRoyalty}%` : '—';
	updateValue($('mn-c-remix'), state.remixPaid, (n) => String(n), { flash: false });
	$('mn-c-network').textContent = state.network;
}

// ── cards ─────────────────────────────────────────────────────────────────────

function cardHTML(a) {
	const glbUrl = a.glb_url || '';
	const viewerUrl = a.viewer_url || (glbUrl ? `/app#model=${encodeURIComponent(glbUrl)}` : '#');
	const explorerUrl = explorerAssetUrl(a.mint, a.network);
	const name = a.name || 'three.ws 3D asset';

	const thumb = glbUrl
		? `<model-viewer
				src="${esc(glbUrl)}"
				alt="${esc(name)}"
				class="mn-card-mv"
				reveal="auto"
				loading="lazy"
				disable-zoom
				disable-pan
				disable-tap
				interaction-prompt="none"
				camera-controls="false"
				auto-rotate
				rotation-per-second="16deg"
				environment-image="neutral"
				shadow-intensity="0"
				exposure="1"
				poster="${esc(a.image_url || '')}"
			></model-viewer>`
		: a.image_url
			? `<img src="${esc(a.image_url)}" alt="${esc(name)}" loading="lazy" decoding="async" />`
			: `<div class="mn-card-noglb" aria-hidden="true">3D</div>`;

	const royaltyPct = a.royalty?.percent != null ? `${a.royalty.percent}%` : '—';
	const remix = a.remix_royalty;
	const remixBadge = a.parent_mint
		? remix?.paid
			? `<span class="mn-tag mn-tag--paid" title="Royalty paid to the original creator">remix · royalty paid</span>`
			: `<span class="mn-tag" title="Derived from another creator's mint">remix</span>`
		: '';

	const agentLine = a.agent
		? `<a class="mn-card-agent" href="${esc(a.agent.url)}">${esc(a.agent.name || 'Agent')}</a>`
		: '';

	const promptLine = a.provenance?.prompt
		? `<p class="mn-card-prompt" title="${esc(a.provenance.prompt)}">“${esc(String(a.provenance.prompt).slice(0, 90))}${a.provenance.prompt.length > 90 ? '…' : ''}”</p>`
		: '';

	return (
		`<article class="mn-card" data-mn-id="${esc(a.mint)}">` +
		`<a class="mn-card-thumb" href="${esc(viewerUrl)}" aria-label="View ${esc(name)} in 3D viewer">${thumb}</a>` +
		`<div class="mn-card-body">` +
		`<div class="mn-card-top">` +
		`<span class="mn-card-name">${esc(name)}</span>` +
		`<span class="mn-chip" title="Enforced on-chain creator royalty">${royaltyPct} royalty</span>` +
		`</div>` +
		promptLine +
		`<div class="mn-card-meta">` +
		`<span class="mn-chip mn-chip--net">${esc(a.network)}</span>` +
		remixBadge +
		agentLine +
		`</div>` +
		`<div class="mn-card-foot">` +
		`<a class="mn-card-link" href="${esc(explorerUrl)}" target="_blank" rel="noopener">mint ${esc(shortAddr(a.mint))} ↗</a>` +
		`<span class="mn-time">${esc(timeAgo(a.created_at))}</span>` +
		`</div>` +
		`</div>` +
		`</article>`
	);
}

function skeleton() {
	return Array.from({ length: 8 }).map(() => `<div class="mn-skeleton"></div>`).join('');
}

function renderFeed() {
	const host = $('mn-feed');
	if (!host) return;
	if (!state.items.length) {
		host.innerHTML =
			`<div class="mn-empty"><div class="mn-empty-title">No 3D assets minted on ${esc(state.network)} yet</div>` +
			`<p class="mn-empty-sub">Generate an avatar at <a href="/forge">/forge</a>, then mint it as an NFT with ` +
			`the <code>mint_3d_asset</code> tool. <a href="/agent-identities">Try Agent Identity Studio →</a></p></div>`;
		return;
	}
	host.setAttribute('aria-busy', 'false');
	host.innerHTML = state.items.map(cardHTML).join('');
	enterStagger([...host.children], { step: 24 });
}

function updateCount() {
	const el = $('mn-count');
	if (!el) return;
	el.textContent = state.items.length
		? `${state.items.length} shown${state.hasMore ? ' · more available' : ''}`
		: '';
}

// ── feed ─────────────────────────────────────────────────────────────────────

async function loadFeed(reset) {
	if (state.loading) return;
	state.loading = true;
	if (reset) {
		state.offset = 0;
		state.items = [];
		state.count = 0;
		state.royaltySum = 0;
		state.remixPaid = 0;
	}
	const host = $('mn-feed');
	if (reset && host) {
		host.setAttribute('aria-busy', 'true');
		host.innerHTML = skeleton();
	}
	setFeedLive('connecting');

	try {
		const params = new URLSearchParams({
			network: state.network,
			offset: String(state.offset),
			limit: String(PAGE_SIZE),
		});
		const res = await fetch(`/api/v1/tokenized/launches?${params}`, { headers: { accept: 'application/json' } });
		if (!res.ok) throw new Error(`launches ${res.status}`);
		// The /api/v1 gateway wraps every response in { data: <payload> }.
		const { data } = await res.json();
		const launches = Array.isArray(data?.launches) ? data.launches : [];
		state.items = reset ? launches : state.items.concat(launches);
		state.hasMore = Boolean(data.has_more);
		state.offset += launches.length;
		state.count = state.items.length;
		state.royaltySum = state.items.reduce((s, a) => s + (a.royalty?.percent || 0), 0);
		state.remixPaid = state.items.filter((a) => a.remix_royalty?.paid).length;
		renderFeed();
		renderCounters();
		updateCount();
		setFeedLive(state.items.length ? 'live' : 'idle');
	} catch (e) {
		log.warn('feed failed', e?.message);
		setFeedLive('error');
		if (reset && host) {
			host.setAttribute('aria-busy', 'false');
			host.innerHTML =
				`<div class="mn-error"><div class="mn-empty-title">Couldn’t reach the launch directory</div>` +
				`<p>The gallery is reconnecting. <button type="button" class="mn-retry" id="mn-retry">Retry</button></p></div>`;
			$('mn-retry')?.addEventListener('click', () => loadFeed(true));
		}
	} finally {
		state.loading = false;
		renderLoadMoreSentinel();
	}
}

// Auto-load-more on scroll — no button, matches the gallery's continuous feel.
let observer = null;
function renderLoadMoreSentinel() {
	const footer = $('mn-footer-state');
	if (!footer) return;
	footer.textContent = state.hasMore ? '' : state.items.length ? 'End of the gallery.' : '';
	if (!state.hasMore) {
		observer?.disconnect();
		return;
	}
	if (!observer && 'IntersectionObserver' in window) {
		observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting && !state.loading && state.hasMore) loadFeed(false);
			},
			{ rootMargin: '0px 0px 320px 0px' },
		);
	}
	observer?.observe(footer);
}

function setFeedLive(stateName) {
	const head = document.querySelector('.mn-feed-head .mn-count');
	if (!head) return;
	if (!head.previousElementSibling?.classList?.contains('juice-live')) {
		head.insertAdjacentHTML('beforebegin', liveDot(stateName));
	} else {
		setLiveDot(head.previousElementSibling, stateName, stateName);
	}
}

// ── controls ────────────────────────────────────────────────────────────────

function wireNetworkToggle() {
	for (const btn of document.querySelectorAll('[data-network]')) {
		btn.addEventListener('click', () => {
			const net = btn.dataset.network === 'devnet' ? 'devnet' : 'mainnet';
			if (net === state.network) return;
			state.network = net;
			for (const b of document.querySelectorAll('[data-network]')) {
				const on = b.dataset.network === net;
				b.classList.toggle('active', on);
				b.setAttribute('aria-selected', String(on));
			}
			loadFeed(true);
		});
	}
}

function init() {
	wireNetworkToggle();
	loadFeed(true);
	// Fresh mints land continuously — refresh the top of the feed periodically
	// while the tab is visible, same cadence as the API's own CDN window.
	setInterval(() => {
		if (document.hidden || state.offset > PAGE_SIZE) return;
		loadFeed(true);
	}, 30_000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
