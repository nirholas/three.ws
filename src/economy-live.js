/**
 * The Agent Economy — live across the network (Pillar 3).
 *
 * The /agent-economy page is a curated two-agent on-chain demo. This is the
 * wide-angle counterpart: the real population of agents earning on three.ws and
 * the paid services they expose over x402. Reads real, keyless endpoints
 * (no mocks):
 *   - GET /api/agents/economy?view=offers — the agent-to-agent service market:
 *     real offers joined to live hire stats (completion counts, ratings, earnings).
 *   - GET /api/marketplace/agents  — published agents with ratings, buyer counts
 *     and on-chain pricing.
 *   - GET /api/agenc/x402-services — the live x402 bazaar: agent/tool endpoints
 *     charging USDC per call, with price, network and capabilities.
 *
 * Every section owns its loading / empty / error state independently so a slow
 * or failing feed never blanks the page.
 */

import { openHirePanel } from './shared/agent-hire.js';
import { sanitizeUrl } from './shared/sanitize-url.js';

const $ = (sel) => /** @type {HTMLElement} */ (document.querySelector(sel));

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtUsd(amountAtomics, decimals) {
	const d = Number.isFinite(decimals) ? decimals : 6;
	const n = Number(amountAtomics) / 10 ** d;
	if (!Number.isFinite(n)) return null;
	if (n === 0) return 'Free';
	if (n < 0.01) return `$${n.toFixed(4)}`;
	return `$${n.toFixed(2)}`;
}

function esc(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Facilitator listings report the network as a CAIP-2 id ("eip155:8453"), which
// the page used to print raw because the old substring test only matched the
// friendly names. Resolve the chain id first, then fall back to the name.
const EVM_CHAIN_NAMES = {
	1: 'Ethereum',
	10: 'Optimism',
	56: 'BNB Chain',
	137: 'Polygon',
	8453: 'Base',
	42161: 'Arbitrum',
	43114: 'Avalanche',
	84532: 'Base Sepolia',
	196: 'X Layer',
};

function chainLabel(chain) {
	const c = String(chain || '').toLowerCase();
	if (!c) return '';
	const eip155 = c.match(/^eip155:(\d+)$/);
	if (eip155) return EVM_CHAIN_NAMES[Number(eip155[1])] || `EVM chain ${eip155[1]}`;
	if (c.startsWith('solana')) return c.includes('devnet') || c.includes('etwtrabzayq') ? 'Solana devnet' : 'Solana';
	if (c.includes('sol')) return 'Solana';
	if (c.includes('base')) return 'Base';
	if (c.includes('eth')) return 'Ethereum';
	return chain || '';
}

function stars(avg, count) {
	if (!count) return '<span class="ae-muted">No ratings yet</span>';
	const a = Math.round((Number(avg) || 0) * 10) / 10;
	return `<span class="ae-stars" aria-label="${a} out of 5">★ ${a.toFixed(1)}</span> <span class="ae-muted">(${count})</span>`;
}

// ── State rendering ───────────────────────────────────────────────────────────

function skeleton(host, n, kind) {
	host.innerHTML = '';
	for (let i = 0; i < n; i++) {
		const s = document.createElement('div');
		s.className = `ae-skel ae-skel-${kind}`;
		host.appendChild(s);
	}
}

// An empty feed is a real state, so it says what the visitor can do next rather
// than only that there is nothing here. `action` is an internal path.
function emptyState(host, title, hint, action) {
	const cta = action
		? `<p class="ae-empty-cta"><a href="${esc(action.href)}">${esc(action.label)}</a></p>`
		: '';
	host.innerHTML = `<div class="ae-empty"><p class="ae-empty-title">${esc(title)}</p><p class="ae-muted">${esc(hint)}</p>${cta}</div>`;
}

function errorState(host, retryFn) {
	host.innerHTML = '';
	const box = document.createElement('div');
	box.className = 'ae-error';
	box.innerHTML = `<p>Couldn't load this feed.</p>`;
	const btn = document.createElement('button');
	btn.className = 'ae-retry';
	btn.type = 'button';
	btn.textContent = 'Retry';
	btn.addEventListener('click', retryFn);
	box.appendChild(btn);
	host.appendChild(box);
}

// ── Section: earning agents ───────────────────────────────────────────────────

function agentCard(a) {
	const thumb = a.thumbnail_url || '';
	const price = a.price ? fmtUsd(a.price.amount, a.price.mint_decimals) : null;
	const priceChip = price
		? `<span class="ae-chip ae-chip-price">${esc(price)}${a.price?.chain ? ` · ${esc(chainLabel(a.price.chain))}` : ''}</span>`
		: a.has_paid_skills ? '<span class="ae-chip">Paid skills</span>' : '<span class="ae-chip ae-chip-free">Free</span>';
	const buyers = Number(a.buyers_total) || 0;
	const buyers24 = Number(a.buyers_24h) || 0;
	return `
		<a class="ae-card" href="/agents/${encodeURIComponent(a.id)}">
			<div class="ae-card-top">
				<div class="ae-avatar">${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy" />` : `<span class="ae-avatar-fallback">${esc((a.name || '?').slice(0, 1).toUpperCase())}</span>`}</div>
				<div class="ae-card-head">
					<span class="ae-card-name">${esc(a.name || 'Untitled agent')}</span>
					<span class="ae-muted ae-card-cat">${esc(a.category || 'general')}</span>
				</div>
			</div>
			<p class="ae-card-desc">${esc((a.description || '').slice(0, 110))}</p>
			<div class="ae-card-foot">
				<span class="ae-rating">${stars(a.rating_avg, a.rating_count)}</span>
				${priceChip}
			</div>
			<div class="ae-card-metrics">
				<span title="Total buyers"><strong>${buyers.toLocaleString()}</strong> buyers</span>
				${buyers24 > 0 ? `<span class="ae-up" title="Buyers in the last 24h">▲ ${buyers24.toLocaleString()} / 24h</span>` : ''}
			</div>
		</a>`;
}

// Changing the sort twice inside one round trip can land the older response
// last and paint a list the select no longer says. Only the newest request may
// write.
let _agentsRequest = 0;

async function loadAgents({ quiet = false } = {}) {
	const host = $('#ae-agents');
	if (!host) return;
	if (!quiet) skeleton(host, 6, 'card');
	const token = ++_agentsRequest;
	try {
		const sort = $('#ae-sort')?.value || 'top_rated';
		const params = new URLSearchParams({ sort, limit: '24' });
		const r = await fetch(`/api/marketplace/agents?${params}`, { credentials: 'include' });
		if (!r.ok) throw new Error(`status ${r.status}`);
		const j = await r.json();
		if (token !== _agentsRequest) return;
		const items = j?.data?.items || j?.items || [];
		if (!items.length) {
			emptyState(host, 'No published agents yet', 'Nobody has published an agent to the marketplace yet.', {
				href: '/create-agent',
				label: 'Build the first one',
			});
			setStat('#ae-stat-agents', '0');
			setStat('#ae-stat-earning', '0');
			return;
		}
		host.innerHTML = items.map(agentCard).join('');
		setStat('#ae-stat-agents', items.length >= 24 ? '24+' : String(items.length));
		const earners = items.filter((a) => (Number(a.buyers_total) || 0) > 0).length;
		setStat('#ae-stat-earning', String(earners));
	} catch (err) {
		if (token === _agentsRequest) errorState(host, () => loadAgents());
		// eslint-disable-next-line no-console
		console.error('[economy-live] agents', err);
	}
}

// ── Section: live x402 services ──────────────────────────────────

// A path segment a facilitator publishes as a placeholder rather than a value:
// "/inboxes/:inbox_id/messages", "/block/{number}". An endpoint carrying one is
// a template, not a fetchable page, so the row never links to it.
function isTemplateSegment(seg) {
	return /^[:{<]/.test(seg) || /^%7B/i.test(seg);
}

function parseEndpoint(resource) {
	try {
		const u = new URL(String(resource || ''));
		return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
	} catch {
		return null;
	}
}

// "erc20-balance" -> "Erc20 balance", "html-to-json" -> "Html to json".
function humanizeSegment(seg) {
	let out = seg;
	try {
		out = decodeURIComponent(seg);
	} catch {
		out = seg;
	}
	return out
		.replace(/\.[a-z0-9]{1,5}$/i, '')
		.replace(/[-_+]+/g, ' ')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.trim()
		.replace(/^./, (c) => c.toUpperCase());
}

// Every listing on the live catalog today reaches us with an empty serviceName:
// most facilitators simply do not collect one. Rendering the fallback made the
// whole section ninety identical rows called "Service", so derive a readable
// label from the one field every listing does have, its endpoint URL.
const GENERIC_PATH_SEGMENTS = new Set(['api', 'rest', 'public', 'x402', 'v', 'endpoint', 'endpoints']);

export function deriveServiceLabel(resource) {
	const u = parseEndpoint(resource);
	if (!u) return 'Service';
	const segs = u.pathname
		.split('/')
		.filter(Boolean)
		.filter((seg) => !isTemplateSegment(seg) && !/^v\d+(\.\d+)?$/i.test(seg) && !GENERIC_PATH_SEGMENTS.has(seg.toLowerCase()));
	if (!segs.length) return u.hostname.replace(/^www\./, '');
	const tail = segs.slice(-2).map(humanizeSegment);
	const label = tail.length > 1 && tail[1].length < 14 ? tail.join(' ') : tail[tail.length - 1];
	return label.length > 46 ? `${label.slice(0, 45)}\u2026` : label;
}

// The endpoint itself, shown under the name: it is what a buyer actually pays,
// and it is what tells two rows named "Inboxes messages" apart.
export function endpointText(resource) {
	const u = parseEndpoint(resource);
	if (!u) return '';
	const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
	return `${u.host}${path}`;
}

// "0.1 USDC" from the facilitator already carries the symbol; the old row
// appended `price.currency` after it, which is the token CONTRACT ADDRESS, so
// every price read "0.1 USDC 0x833589...". Free is free.
export function servicePriceLabel(price) {
	if (!price) return 'Free';
	if (price.amountAtomic != null && /^0+$/.test(String(price.amountAtomic))) return 'Free';
	const label = String(price.amountLabel || '').trim();
	if (!label) return 'Free';
	return /^0(\.0+)?( |$)/.test(label) ? 'Free' : label;
}

function serviceRow(t) {
	const price = servicePriceLabel(t.price);
	const free = price === 'Free';
	const net = t.price?.network ? chainLabel(t.price.network) : '';
	const method = t.method ? `<span class="ae-svc-method">${esc(t.method)}</span>` : '';
	const name = t.serviceName || t.toolName || deriveServiceLabel(t.resource);
	const endpoint = endpointText(t.resource);
	const templated = endpoint.split('/').some(isTemplateSegment);
	const tags = (t.tags || []).slice(0, 3).map((x) => `<span class="ae-tag">${esc(x)}</span>`).join('');
	// t.resource is an x402 endpoint URL sourced from third-party facilitator
	// discovery listings (PayAI / Coinbase CDP / etc.). Any operator can register
	// one, so it is untrusted external input. esc() only guards attribute
	// breakout; sanitizeUrl() gates the scheme so a malicious `javascript:` or
	// `data:` listing cannot execute when clicked.
	const href = sanitizeUrl(t.resource || '');
	// A template endpoint 404s and a rejected scheme collapses to "#", and both
	// are dead links. Those rows render as plain rows instead: the endpoint is
	// still readable and copyable, it just is not pretending to be a page.
	const linkable = !templated && href !== '#';
	const body = `
			<div class="ae-svc-main">
				<span class="ae-svc-name">${method}${esc(name)}</span>
				${endpoint ? `<span class="ae-svc-ep" title="${esc(endpoint)}">${esc(endpoint)}</span>` : ''}
				<span class="ae-svc-desc ae-muted">${esc((t.description || '').slice(0, 140))}</span>
				<span class="ae-svc-tags">${tags}${templated ? '<span class="ae-tag" title="This endpoint takes path parameters, so there is no page to open">path template</span>' : ''}</span>
			</div>
			<div class="ae-svc-price">
				<span class="ae-chip ${free ? 'ae-chip-free' : 'ae-chip-price'}">${esc(price)}</span>
				${net ? `<span class="ae-muted ae-svc-net">${esc(net)}</span>` : ''}
			</div>`;
	return linkable
		? `<a class="ae-svc" href="${esc(href)}" rel="noopener noreferrer" target="_blank" title="Open ${esc(endpoint)} in a new tab">${body}</a>`
		: `<div class="ae-svc ae-svc-static">${body}</div>`;
}

// The catalog runs to about ninety live endpoints. Rendering all of them made a
// page fourteen thousand pixels tall, so show a first screenful and let the
// visitor open the rest.
const SERVICES_PREVIEW = 24;
let _services = [];
let _servicesExpanded = false;

function renderServices() {
	const host = $('#ae-services');
	const more = $('#ae-services-more');
	if (!host) return;
	if (!_services.length) {
		emptyState(
			host,
			'No live x402 services right now',
			'Agents publish pay-per-call endpoints here as they come online.',
			{ href: '/docs/x402', label: 'Read how to publish one' },
		);
		if (more) more.hidden = true;
		setStat('#ae-stat-services', '0');
		return;
	}
	const shown = _servicesExpanded ? _services : _services.slice(0, SERVICES_PREVIEW);
	host.innerHTML = shown.map(serviceRow).join('');
	setStat('#ae-stat-services', String(_services.length));
	if (!more) return;
	const hidden = _services.length - shown.length;
	more.hidden = _services.length <= SERVICES_PREVIEW;
	more.textContent = _servicesExpanded ? 'Show fewer services' : `Show all ${_services.length} services`;
	more.setAttribute('aria-expanded', _servicesExpanded ? 'true' : 'false');
	more.title = _servicesExpanded ? `Collapse back to ${SERVICES_PREVIEW}` : `${hidden} more live endpoints`;
}

async function loadServices({ quiet = false } = {}) {
	const host = $('#ae-services');
	if (!host) return;
	if (!quiet && !_services.length) skeleton(host, 5, 'row');
	try {
		const params = new URLSearchParams({ type: 'http', maxItems: '40' });
		const r = await fetch(`/api/agenc/x402-services?${params}`);
		if (!r.ok) throw new Error(`status ${r.status}`);
		const j = await r.json();
		_services = Array.isArray(j?.tasks) ? j.tasks : [];
		renderServices();
	} catch (err) {
		if (!_services.length) {
			errorState(host, () => loadServices());
			const more = $('#ae-services-more');
			if (more) more.hidden = true;
		}
		// eslint-disable-next-line no-console
		console.error('[economy-live] services', err);
	}
}

// ── Section: agents hiring agents (the A2A service market) ────────────────────

let _offers = [];

function offerAvatar(offer) {
	const url = offer?.provider?.avatar_thumbnail_url || '';
	if (url) return `<span class="ae-offer-av"><img src="${esc(url)}" alt="" loading="lazy" /></span>`;
	const letter = (offer?.provider?.name || offer?.name || '?').slice(0, 1).toUpperCase();
	return `<span class="ae-offer-av"><span class="ae-offer-av-fallback">${esc(letter)}</span></span>`;
}

function offerStatsLine(st) {
	if (!st) return '';
	const bits = [];
	const completed = Number(st.completion_count) || 0;
	bits.push(`<span><strong>${completed.toLocaleString()}</strong> hire${completed === 1 ? '' : 's'}</span>`);
	if (st.rating_count > 0 && st.avg_rating != null) {
		bits.push(`<span class="ae-stars" aria-label="${Number(st.avg_rating).toFixed(1)} out of 5">★ ${Number(st.avg_rating).toFixed(1)} <span class="ae-muted">(${st.rating_count})</span></span>`);
	}
	if (st.success_rate != null && st.total_hires > 0) {
		bits.push(`<span title="Completed vs disputed/failed/refunded"><strong>${Math.round(st.success_rate * 100)}%</strong> success</span>`);
	}
	if (Number(st.throughput_24h) > 0) {
		bits.push(`<span class="ae-fresh" title="Hires in the last 24h">▲ ${Number(st.throughput_24h)} / 24h</span>`);
	}
	if (Number(st.earned_usdc) > 0) {
		bits.push(`<span title="Lifetime earned to the provider's wallet">$${Number(st.earned_usdc).toLocaleString(undefined, { maximumFractionDigits: 2 })} earned</span>`);
	}
	return bits.join('');
}

function priceUsd(offer) {
	if (offer?.price_usdc != null) return Number(offer.price_usdc);
	return Number(offer?.price_atomics || 0) / 1e6;
}

function fmtPrice(n) {
	const v = Number(n);
	if (!Number.isFinite(v) || v === 0) return 'Free';
	if (v < 0.01) return `$${v.toFixed(4)}`;
	return `$${v.toFixed(2)}`;
}

function offerCard(offer) {
	const prov = offer.provider || {};
	const provHref = prov.id ? `/agents/${encodeURIComponent(prov.id)}` : null;
	const provLabel = provHref
		? `<a href="${esc(provHref)}">${esc(prov.name || 'Agent')}</a>`
		: esc(prov.name || 'Agent');
	return `
		<article class="ae-offer" data-slug="${esc(offer.slug)}">
			<div class="ae-offer-top">
				${offerAvatar(offer)}
				<div class="ae-offer-id">
					<div class="ae-offer-name" title="${esc(offer.name)}">${esc(offer.name || 'Service')}</div>
					<div class="ae-offer-prov">by ${provLabel} · ${esc(chainLabel(offer.network) || 'Solana')}</div>
				</div>
				<div class="ae-offer-price">${esc(fmtPrice(priceUsd(offer)))}</div>
			</div>
			<p class="ae-offer-desc">${esc(offer.description || 'A paid skill another agent can hire.')}</p>
			<div class="ae-offer-stats">${offerStatsLine(offer.stats)}</div>
			<div class="ae-offer-foot">
				<button class="ae-hire-btn" type="button" data-hire="${esc(offer.slug)}">Hire this agent</button>
				${provHref ? `<a class="ae-offer-link" href="${esc(provHref)}">Provider →</a>` : ''}
			</div>
		</article>`;
}

function sortOffers(offers, mode) {
	const arr = offers.slice();
	if (mode === 'new') {
		arr.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
	} else {
		arr.sort((a, b) => (Number(b.stats?.completion_count) || 0) - (Number(a.stats?.completion_count) || 0));
	}
	return arr;
}

function renderOffers() {
	const host = $('#ae-offers');
	if (!host) return;
	if (!_offers.length) {
		emptyState(
			host,
			'No agent services listed yet',
			'When an owner prices one of their agent\'s skills, it appears here for other agents to hire.',
			{ href: '/agents', label: 'Open your agents and price a skill' },
		);
		setStat('#ae-stat-hires', '0');
		return;
	}
	const mode = $('#ae-offer-sort')?.value || 'proven';
	host.innerHTML = sortOffers(_offers, mode).map(offerCard).join('');
	for (const btn of host.querySelectorAll('[data-hire]')) {
		btn.addEventListener('click', () => {
			const offer = _offers.find((o) => o.slug === btn.getAttribute('data-hire'));
			if (offer) openHirePanel(offer, { onComplete: () => loadOffers({ quiet: true }) });
		});
	}
	const totalHires = _offers.reduce((sum, o) => sum + (Number(o.stats?.completion_count) || 0), 0);
	setStat('#ae-stat-hires', totalHires >= 1000 ? `${(totalHires / 1000).toFixed(1)}k` : String(totalHires));
}

async function loadOffers({ quiet = false } = {}) {
	const host = $('#ae-offers');
	if (!host) return;
	if (!quiet && !_offers.length) {
		host.innerHTML = '';
		for (let i = 0; i < 6; i++) {
			const s = document.createElement('div');
			s.className = 'ae-skel ae-skel-offer';
			host.appendChild(s);
		}
	}
	try {
		const r = await fetch('/api/agents/economy?view=offers&limit=60', { credentials: 'include' });
		if (!r.ok) throw new Error(`status ${r.status}`);
		const j = await r.json();
		_offers = j?.data?.offers || [];
		renderOffers();
	} catch (err) {
		if (!_offers.length) errorState(host, () => loadOffers());
		// eslint-disable-next-line no-console
		console.error('[economy-live] offers', err);
	}
}

function setStat(sel, value) {
	const el = $(sel);
	if (el) el.textContent = value;
}

const REFRESH_MS = 45000;
let _refreshTimer = 0;

function scheduleRefresh() {
	clearInterval(_refreshTimer);
	_refreshTimer = window.setInterval(() => {
		if (document.hidden) return; // don't poll a backgrounded tab
		loadOffers({ quiet: true });
		loadAgents({ quiet: true });
		loadServices({ quiet: true });
		pulseLive();
	}, REFRESH_MS);
}

function pulseLive() {
	const live = $('#ae-live');
	if (!live) return;
	live.hidden = false;
	const label = $('#ae-live-label');
	if (label) {
		label.textContent = 'Updated just now';
		setTimeout(() => { label.textContent = 'Live'; }, 2500);
	}
}

export function initEconomyLive() {
	loadOffers().then(() => pulseLive());
	loadAgents();
	loadServices();
	const sortEl = $('#ae-sort');
	if (sortEl) sortEl.addEventListener('change', () => loadAgents());
	const offerSortEl = $('#ae-offer-sort');
	if (offerSortEl) offerSortEl.addEventListener('change', () => renderOffers());
	const moreEl = $('#ae-services-more');
	if (moreEl) {
		moreEl.addEventListener('click', () => {
			_servicesExpanded = !_servicesExpanded;
			renderServices();
			if (!_servicesExpanded) moreEl.scrollIntoView({ block: 'nearest' });
		});
	}
	scheduleRefresh();
}

if (typeof document !== 'undefined') {
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initEconomyLive, { once: true });
	} else {
		initEconomyLive();
	}
}
