/**
 * Agent Cards: gift cards and prepaid cards bought from an agent's own wallet.
 *
 * Routes: /agents/:id/cards, plus /agent-cards with an optional ?id=<uuid>
 * (no id: the signed-in owner's agents; one mounts directly, several get a
 * picker). API: /api/v1/agents/:id/cards (docs/agent-cards.md).
 *
 * Flow: search a merchant, pick a product and amount, get a price-locked quote
 * with the confirm table, approve it explicitly, then follow the card to
 * delivery. Delivered cards reveal their secret once, through a modal that
 * drops the secret from the page when it closes.
 */

import './agent-cards.css';
import { consumeCsrfToken } from './api.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const root = document.getElementById('ac-root');
const titleEl = document.querySelector('title');

const STATUS_LABEL = {
	quoted: 'Quoted',
	paying: 'Paying',
	processing: 'Processing',
	delivered: 'Delivered',
	failed: 'Failed',
	refunded: 'Refunded',
	cancelled: 'Cancelled',
	expired: 'Expired',
	needs_verification: 'Needs verification',
};

const EVENT_LABEL = {
	quoted: 'Quote locked',
	purchase_confirmed: 'Purchase confirmed',
	paid: 'Paid',
	status: 'Status changed',
	revealed: 'Secret revealed',
	reveal_refused: 'Reveal refused',
	cancelled: 'Cancelled',
	withdraw_requested: 'Withdrawal requested',
};

const FIELD_LABEL = { code: 'Code', pin: 'PIN', link: 'Redemption link', barcode_value: 'Barcode' };
const COUNTRIES = ['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'ES', 'IT', 'NL', 'JP', 'IN', 'BR', 'MX'];

const state = {
	agent: null,
	provider: null,
	sandbox: false,
	kind: '',
	country: 'US',
	q: '',
	products: [],
	searching: false,
	searchError: null,
	selected: null,
	amount: null,
	quote: null,
	quoteError: null,
	busy: false,
	cards: [],
	cardsLoading: true,
	cardsError: null,
	totals: null,
	nextCursor: null,
};

// ── helpers ──────────────────────────────────────────────────────────────────

function esc(s) {
	return String(s ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
	);
}

function setPageTitle(text) {
	document.title = text;
	titleEl?.setAttribute('data-i18n-owned', '1');
}

function fmtMoney(n, currency) {
	const v = Number(n);
	if (!Number.isFinite(v)) return '';
	try {
		return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(v);
	} catch {
		return `${v.toFixed(2)} ${currency}`;
	}
}

function fmtUsdc(n) {
	const v = Number(n);
	if (!Number.isFinite(v)) return '';
	return `${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDC`;
}

function timeAgo(iso) {
	const t = new Date(iso).getTime();
	if (!Number.isFinite(t)) return '';
	const s = Math.max(0, Math.round((Date.now() - t) / 1000));
	if (s < 60) return 'just now';
	if (s < 3600) return `${Math.floor(s / 60)}m ago`;
	if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
	return new Date(iso).toLocaleDateString();
}

function shortAddr(a) {
	return a && a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a || '';
}

function debounce(fn, ms) {
	let t;
	return (...a) => {
		clearTimeout(t);
		t = setTimeout(() => fn(...a), ms);
	};
}

class ApiFailure extends Error {
	constructor(status, code, message, details) {
		super(message);
		this.status = status;
		this.code = code;
		this.details = details;
	}
}

async function api(path, { method = 'GET', body } = {}) {
	const opts = { method, credentials: 'include', headers: { accept: 'application/json' } };
	if (body !== undefined) {
		opts.headers['content-type'] = 'application/json';
		opts.body = JSON.stringify(body);
	}
	if (method !== 'GET') {
		const token = await consumeCsrfToken();
		if (token) opts.headers['x-csrf-token'] = token;
	}
	let res;
	try {
		res = await fetch(`/api/v1/agents/${encodeURIComponent(state.agent.id)}/cards${path}`, opts);
	} catch {
		throw new ApiFailure(0, 'network_error', 'Could not reach three.ws. Check your connection and try again.');
	}
	let j = null;
	try {
		j = await res.json();
	} catch {
		j = null;
	}
	if (!res.ok) {
		throw new ApiFailure(
			res.status,
			j?.error?.code || 'error',
			j?.error?.message || `Request failed (${res.status}).`,
			j?.error?.details || null,
		);
	}
	return j?.data;
}

// ── page shells ──────────────────────────────────────────────────────────────

function renderLoading(label) {
	root.innerHTML = `
		<div class="ac-skel" aria-busy="true" aria-label="${esc(label)}">
			<div class="ac-skel-bar"></div>
			<div class="ac-skel-grid"><div></div><div></div><div></div></div>
			<div class="ac-skel-card"></div>
		</div>`;
}

function renderMessage({ title, body, actions = [], retry, tone = 'error' }) {
	root.innerHTML = `
		<div class="ac-msg" ${tone === 'error' ? 'role="alert"' : 'role="region" aria-labelledby="ac-msg-h"'}>
			<h1 id="ac-msg-h">${esc(title)}</h1>
			<p>${esc(body)}</p>
			<div class="ac-row ac-row--center">
				${actions.map((a) => `<a class="ac-btn${a.primary ? ' ac-btn--primary' : ''}" href="${esc(a.href)}">${esc(a.label)}</a>`).join('')}
				${retry ? '<button class="ac-btn" type="button" data-act="retry">Try again</button>' : ''}
			</div>
		</div>`;
	root.querySelector('[data-act="retry"]')?.addEventListener('click', () => boot());
}

function renderPicker(agents) {
	root.innerHTML = `
		<section class="ac-pick" aria-labelledby="ac-pick-h">
			<h1 id="ac-pick-h" class="ac-h1">Agent cards</h1>
			<p class="ac-lede">Each agent can buy gift cards and prepaid cards with the USDC in its own Solana wallet. Pick an agent.</p>
			<ul class="ac-pick-list">
				${agents
					.map(
						(a) => `
					<li><a class="ac-pick-row" href="/agents/${encodeURIComponent(a.id)}/cards">
						${a.avatar_thumbnail_url ? `<img class="ac-pick-av" src="${esc(a.avatar_thumbnail_url)}" alt="" loading="lazy" />` : '<span class="ac-pick-av" aria-hidden="true"></span>'}
						<span class="ac-pick-name">${esc(a.name || 'Untitled agent')}</span>
						<span aria-hidden="true">→</span>
					</a></li>`,
					)
					.join('')}
			</ul>
		</section>`;
	setPageTitle('Agent cards · three.ws');
}

// ── main view ────────────────────────────────────────────────────────────────

function renderShell() {
	const a = state.agent;
	const p = state.provider;
	const liveOff = !p?.live_enabled;
	root.innerHTML = `
		<header class="ac-head">
			<div class="ac-head-id">
				${a.avatar_thumbnail_url ? `<img class="ac-head-av" src="${esc(a.avatar_thumbnail_url)}" alt="" />` : '<span class="ac-head-av" aria-hidden="true"></span>'}
				<div>
					<h1 class="ac-h1">${esc(a.name || 'Agent')} cards</h1>
					<p class="ac-sub">Gift cards and prepaid cards paid in USDC on Solana from this agent's wallet${p ? ` · via ${esc(p.label)}` : ''}.</p>
				</div>
			</div>
			<div class="ac-row">
				<a class="ac-btn ac-btn--ghost" href="/agents/${encodeURIComponent(a.id)}/wallet">Wallet</a>
				<a class="ac-btn ac-btn--ghost" href="/docs/agent-cards">Docs</a>
			</div>
		</header>
		<div id="ac-connect"></div>
		<section class="ac-panel" aria-labelledby="ac-buy-h">
			<div class="ac-panel-head">
				<h2 id="ac-buy-h" class="ac-h2">Buy a card</h2>
				<div class="ac-seg" role="radiogroup" aria-label="Catalog">
					<button type="button" role="radio" data-mode="live" aria-checked="${!state.sandbox}" ${liveOff ? 'disabled title="Live purchases are not switched on for this deployment yet"' : ''}>Live</button>
					<button type="button" role="radio" data-mode="sandbox" aria-checked="${state.sandbox}">Sandbox</button>
				</div>
			</div>
			${
				state.sandbox
					? `<p class="ac-note">Sandbox uses the provider's test products. The flow runs for real against the provider, but no funds move and the codes are not redeemable.${liveOff ? ' Live purchases are not switched on for this deployment yet.' : ''}</p>`
					: ''
			}
			<form class="ac-search" role="search" id="ac-search">
				<label class="ac-visually-hidden" for="ac-q">Search merchants</label>
				<input id="ac-q" type="search" placeholder="${state.sandbox ? 'Search test products' : 'Search a merchant: Steam, Uber Eats, prepaid Visa…'}" value="${esc(state.q)}" autocomplete="off" />
				<label class="ac-visually-hidden" for="ac-country">Country</label>
				<select id="ac-country" ${state.sandbox ? 'disabled' : ''}>
					${COUNTRIES.map((c) => `<option value="${c}" ${state.country === c ? 'selected' : ''}>${c}</option>`).join('')}
					<option value="" ${state.country === '' ? 'selected' : ''}>Any country</option>
				</select>
			</form>
			<div class="ac-chips" role="radiogroup" aria-label="Card type">
				${[['', 'All'], ['gift_card', 'Gift cards'], ['prepaid_card', 'Prepaid cards']]
					.map(([k, l]) => `<button type="button" class="ac-chip" role="radio" data-kind="${k}" aria-checked="${state.kind === k}">${l}</button>`)
					.join('')}
			</div>
			<div id="ac-results" aria-live="polite"></div>
			<div id="ac-picker"></div>
		</section>
		<section class="ac-panel" aria-labelledby="ac-list-h">
			<div class="ac-panel-head">
				<h2 id="ac-list-h" class="ac-h2">Cards</h2>
				<div class="ac-row">
					<span class="ac-dim-text" id="ac-totals"></span>
					<button type="button" class="ac-btn ac-btn--ghost" data-act="reload-cards">Refresh</button>
				</div>
			</div>
			<div id="ac-cards" aria-live="polite"></div>
		</section>
		<div id="ac-modal-host"></div>`;
	bindShell();
	renderResults();
	renderPickerPanel();
	renderCards();
}

function bindShell() {
	root.querySelectorAll('[data-mode]').forEach((b) =>
		b.addEventListener('click', () => {
			const sandbox = b.dataset.mode === 'sandbox';
			if (sandbox === state.sandbox) return;
			state.sandbox = sandbox;
			state.selected = null;
			state.quote = null;
			state.quoteError = null;
			state.q = '';
			renderShell();
			search();
		}),
	);
	root.querySelectorAll('[data-kind]').forEach((b) =>
		b.addEventListener('click', () => {
			state.kind = b.dataset.kind;
			root.querySelectorAll('[data-kind]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
			search();
		}),
	);
	const q = root.querySelector('#ac-q');
	const run = debounce(() => {
		state.q = q.value.trim();
		search();
	}, 300);
	q.addEventListener('input', run);
	root.querySelector('#ac-search').addEventListener('submit', (e) => {
		e.preventDefault();
		state.q = q.value.trim();
		search();
	});
	root.querySelector('#ac-country').addEventListener('change', (e) => {
		state.country = e.target.value;
		search();
	});
	root.querySelector('[data-act="reload-cards"]').addEventListener('click', () => loadCards());
}

// ── search ───────────────────────────────────────────────────────────────────

let searchSeq = 0;
async function search() {
	const seq = ++searchSeq;
	state.searching = true;
	state.searchError = null;
	renderResults();
	const params = new URLSearchParams({ limit: '24' });
	if (state.q) params.set('q', state.q);
	if (state.kind) params.set('kind', state.kind);
	if (state.sandbox) params.set('sandbox', 'true');
	else if (state.country) params.set('country', state.country);
	try {
		const data = await api(`/products/search?${params}`);
		if (seq !== searchSeq) return;
		state.products = data?.items || [];
	} catch (e) {
		if (seq !== searchSeq) return;
		state.products = [];
		state.searchError = e;
	}
	state.searching = false;
	renderResults();
}

function productCard(p) {
	const values = p.packages.map((x) => x.value);
	const range = p.range ? `${fmtMoney(p.range.min, p.currency)} to ${fmtMoney(p.range.max, p.currency)}` : null;
	const denoms = values.length
		? values.slice(0, 4).map((v) => fmtMoney(v, p.currency)).join(' · ') + (values.length > 4 ? ' …' : '')
		: range;
	return `
		<li>
			<button type="button" class="ac-prod" data-product="${esc(p.id)}" aria-pressed="${state.selected?.id === p.id}" ${p.in_stock ? '' : 'disabled'}>
				<span class="ac-prod-img">${p.image_url ? `<img src="${esc(p.image_url)}" alt="" loading="lazy" />` : ''}</span>
				<span class="ac-prod-name">${esc(p.name)}</span>
				<span class="ac-prod-meta">${p.kind === 'prepaid_card' ? 'Prepaid card' : 'Gift card'}${p.country_code ? ` · ${esc(p.country_code)}` : ''}</span>
				<span class="ac-prod-denom">${p.in_stock ? esc(denoms || '') : 'Out of stock'}</span>
			</button>
		</li>`;
}

function renderResults() {
	const el = root.querySelector('#ac-results');
	if (!el) return;
	if (state.searching && !state.products.length) {
		el.innerHTML = `<ul class="ac-grid" aria-busy="true">${'<li><div class="ac-prod ac-prod--skel"></div></li>'.repeat(6)}</ul>`;
		return;
	}
	if (state.searchError) {
		const e = state.searchError;
		const msg = e.code === 'not_configured' ? 'Card purchases are not configured on this server yet.' : e.message;
		el.innerHTML = `<div class="ac-inline-err" role="alert"><p>${esc(msg)}</p><button type="button" class="ac-btn" data-act="retry-search">Try again</button></div>`;
		el.querySelector('[data-act="retry-search"]').addEventListener('click', () => search());
		return;
	}
	if (!state.products.length) {
		el.innerHTML = `<div class="ac-empty"><p><strong>No cards match${state.q ? ` "${esc(state.q)}"` : ''}.</strong></p><p>Try a broader name, another country, or switch the card type to All.</p></div>`;
		return;
	}
	el.innerHTML = `<ul class="ac-grid${state.searching ? ' ac-dim' : ''}">${state.products.map(productCard).join('')}</ul>`;
	el.querySelectorAll('[data-product]').forEach((b) =>
		b.addEventListener('click', () => {
			const p = state.products.find((x) => x.id === b.dataset.product);
			state.selected = p;
			state.amount = p.packages[0]?.value ?? p.range?.min ?? null;
			state.quote = null;
			state.quoteError = null;
			el.querySelectorAll('[data-product]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
			renderPickerPanel();
			root.querySelector('#ac-picker')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
		}),
	);
}

// ── picker, quote, confirm ───────────────────────────────────────────────────

let countdownTimer = null;

function renderPickerPanel() {
	const el = root.querySelector('#ac-picker');
	if (!el) return;
	clearInterval(countdownTimer);
	const p = state.selected;
	if (!p) {
		el.innerHTML = '';
		return;
	}
	const chips = p.packages
		.map((pk) => `<button type="button" class="ac-chip" role="radio" data-amount="${pk.value}" aria-checked="${state.amount === pk.value}">${esc(fmtMoney(pk.value, p.currency))}</button>`)
		.join('');
	const rangeInput = p.range
		? `
		<label class="ac-field">
			<span>Or any amount from ${esc(fmtMoney(p.range.min, p.currency))} to ${esc(fmtMoney(p.range.max, p.currency))}</span>
			<input type="number" id="ac-amount" min="${p.range.min}" max="${p.range.max}" step="${p.range.step}" value="${state.amount ?? ''}" inputmode="decimal" />
		</label>`
		: '';
	el.innerHTML = `
		<div class="ac-pickp" role="region" aria-label="${esc(p.name)}">
			<div class="ac-pickp-head">
				<span class="ac-prod-img">${p.image_url ? `<img src="${esc(p.image_url)}" alt="" />` : ''}</span>
				<div>
					<h3 class="ac-h3">${esc(p.name)}</h3>
					<p class="ac-sub">${p.kind === 'prepaid_card' ? 'Prepaid card' : 'Gift card'}${p.country_name ? ` · ${esc(p.country_name)}` : ''} · ${esc(p.currency)}${p.redemption_methods?.length ? ` · redeem ${esc(p.redemption_methods.join(', '))}` : ''}</p>
				</div>
				<button type="button" class="ac-x" data-act="close-picker" aria-label="Close">×</button>
			</div>
			${chips ? `<div class="ac-chips" role="radiogroup" aria-label="Amount">${chips}</div>` : ''}
			${rangeInput}
			${p.terms ? `<details class="ac-terms"><summary>Terms</summary><p>${esc(p.terms)}</p></details>` : ''}
			<div id="ac-quote">${quoteBlock()}</div>
		</div>`;
	el.querySelector('[data-act="close-picker"]').addEventListener('click', () => {
		state.selected = null;
		state.quote = null;
		state.quoteError = null;
		renderPickerPanel();
		root.querySelectorAll('[data-product]').forEach((x) => x.setAttribute('aria-pressed', 'false'));
	});
	el.querySelectorAll('[data-amount]').forEach((b) =>
		b.addEventListener('click', () => {
			state.amount = Number(b.dataset.amount);
			state.quote = null;
			state.quoteError = null;
			el.querySelectorAll('[data-amount]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
			const input = el.querySelector('#ac-amount');
			if (input) input.value = String(state.amount);
			refreshQuoteBlock();
		}),
	);
	el.querySelector('#ac-amount')?.addEventListener('input', (e) => {
		state.amount = Number(e.target.value);
		state.quote = null;
		state.quoteError = null;
		el.querySelectorAll('[data-amount]').forEach((x) => x.setAttribute('aria-checked', String(Number(x.dataset.amount) === state.amount)));
		refreshQuoteBlock();
	});
	bindQuoteBlock();
}

function refreshQuoteBlock() {
	clearInterval(countdownTimer);
	const q = root.querySelector('#ac-quote');
	if (!q) return;
	q.innerHTML = quoteBlock();
	bindQuoteBlock();
}

function agreementLink(e) {
	if (e?.code !== 'agreement_required') return '';
	return `<p><a class="ac-btn ac-btn--primary" href="/legal/agreements?next=${encodeURIComponent(location.pathname)}">Sign the agreements</a></p>`;
}

function quoteBlock() {
	const p = state.selected;
	if (state.quoteError) {
		const e = state.quoteError;
		return `<div class="ac-inline-err" role="alert"><p>${esc(e.message)}</p>${agreementLink(e)}<button type="button" class="ac-btn" data-act="quote">Try again</button></div>`;
	}
	if (!state.quote) {
		const valid = Number.isFinite(state.amount) && state.amount > 0;
		const label = state.busy ? 'Getting a quote…' : `Get a quote for ${valid ? esc(fmtMoney(state.amount, p.currency)) : 'this card'}`;
		return `<button type="button" class="ac-btn ac-btn--primary" data-act="quote" ${valid && !state.busy ? '' : 'disabled'}>${label}</button>`;
	}
	const q = state.quote;
	const c = q.confirm;
	const live = q.mode === 'live';
	return `
		<div class="ac-confirm" role="group" aria-labelledby="ac-confirm-h">
			<h4 id="ac-confirm-h" class="ac-h4">Confirm this purchase</h4>
			<dl class="ac-table">
				<div><dt>Buys</dt><dd>${esc(c.buys)}</dd></div>
				<div><dt>Recipient</dt><dd class="ac-mono" title="${esc(c.recipient)}">${esc(live ? shortAddr(c.recipient) : c.recipient)}</dd></div>
				<div><dt>Amount</dt><dd><strong>${esc(live ? fmtUsdc(q.total_usdc) : '0 USDC')}</strong>${q.fee_usdc > 0 ? ` <span class="ac-dim-text">incl. ${esc(fmtUsdc(q.fee_usdc))} fee</span>` : ''}</dd></div>
				<div><dt>Token</dt><dd>${esc(c.token)}</dd></div>
				<div><dt>Chain</dt><dd>${esc(c.chain)}</dd></div>
				<div><dt>From</dt><dd>${esc(state.agent.name || 'Agent')} wallet</dd></div>
			</dl>
			<p class="ac-expire" id="ac-expire" data-expires="${esc(q.expires_at)}"></p>
			<label class="ac-check">
				<input type="checkbox" id="ac-approve" />
				<span>${
					live
						? `I approve paying ${esc(fmtUsdc(q.total_usdc))} from this agent's wallet. This cannot be undone.`
						: 'I understand this is a sandbox test card: nothing is charged and the code is not redeemable.'
				}</span>
			</label>
			<div class="ac-row">
				<button type="button" class="ac-btn ac-btn--primary" data-act="buy" disabled>${state.busy ? 'Buying…' : live ? `Pay ${esc(fmtUsdc(q.total_usdc))}` : 'Buy test card'}</button>
				<button type="button" class="ac-btn ac-btn--ghost" data-act="requote">New quote</button>
			</div>
		</div>`;
}

function bindQuoteBlock() {
	const el = root.querySelector('#ac-quote');
	if (!el) return;
	el.querySelector('[data-act="quote"]')?.addEventListener('click', getQuote);
	el.querySelector('[data-act="requote"]')?.addEventListener('click', () => {
		state.quote = null;
		getQuote();
	});
	const approve = el.querySelector('#ac-approve');
	const buy = el.querySelector('[data-act="buy"]');
	approve?.addEventListener('change', () => {
		buy.disabled = !approve.checked || state.busy;
	});
	buy?.addEventListener('click', buyCard);
	const exp = el.querySelector('#ac-expire');
	if (!exp) return;
	const tick = () => {
		const ms = new Date(exp.dataset.expires).getTime() - Date.now();
		if (ms <= 0) {
			clearInterval(countdownTimer);
			exp.textContent = 'This quote expired. Get a new one to continue.';
			exp.classList.add('ac-expire--gone');
			if (buy) buy.disabled = true;
			if (approve) approve.disabled = true;
			return;
		}
		const m = Math.floor(ms / 60000);
		const s = Math.floor((ms % 60000) / 1000);
		exp.textContent = `Price locked for ${m}:${String(s).padStart(2, '0')}`;
	};
	tick();
	countdownTimer = setInterval(tick, 1000);
}

async function getQuote() {
	if (state.busy) return;
	state.busy = true;
	state.quoteError = null;
	refreshQuoteBlock();
	try {
		state.quote = await api('/quote', { method: 'POST', body: { product_id: state.selected.id, amount: state.amount } });
	} catch (e) {
		state.quoteError = e;
	}
	state.busy = false;
	refreshQuoteBlock();
}

async function buyCard() {
	if (state.busy || !state.quote) return;
	const quoteId = state.quote.quote_id;
	state.busy = true;
	const buy = root.querySelector('[data-act="buy"]');
	if (buy) {
		buy.disabled = true;
		buy.textContent = 'Buying…';
	}
	try {
		const card = await api('/create', { method: 'POST', body: { quote_id: quoteId, confirm_spend: true } });
		state.quote = null;
		state.selected = null;
		state.busy = false;
		upsertCard(card);
		renderPickerPanel();
		root.querySelectorAll('[data-product]').forEach((x) => x.setAttribute('aria-pressed', 'false'));
		renderCards();
		const label = STATUS_LABEL[card.status]?.toLowerCase() || card.status;
		flash(card.status === 'delivered' ? `${card.merchant} card delivered.` : `${card.merchant} card is ${label}.`);
		root.querySelector(`[data-card="${card.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
	} catch (e) {
		state.quote = null;
		state.quoteError = e;
		state.busy = false;
		refreshQuoteBlock();
		loadCards();
	}
}

// ── cards list ───────────────────────────────────────────────────────────────

function upsertCard(card) {
	const i = state.cards.findIndex((c) => c.id === card.id);
	if (i >= 0) state.cards[i] = card;
	else state.cards.unshift(card);
}

async function loadCards({ append = false } = {}) {
	if (!append) {
		state.cardsLoading = !state.cards.length;
		state.cardsError = null;
		renderCards();
	}
	try {
		const params = new URLSearchParams({ limit: '25' });
		if (append && state.nextCursor) params.set('cursor', state.nextCursor);
		const data = await api(`?${params}`);
		state.cards = append ? [...state.cards, ...data.items] : data.items;
		state.nextCursor = data.next_cursor;
		state.totals = data.totals;
	} catch (e) {
		state.cardsError = e;
	}
	state.cardsLoading = false;
	renderCards();
	if (state.cards.some((c) => c.status === 'needs_verification')) loadConnect();
}

function cardRow(c) {
	const actions = [];
	if (['paying', 'processing', 'needs_verification'].includes(c.status)) {
		actions.push(`<button type="button" class="ac-btn ac-btn--sm" data-act="refresh" data-id="${c.id}">Check status</button>`);
	}
	if (c.status === 'delivered') {
		actions.push(`<button type="button" class="ac-btn ac-btn--sm ac-btn--primary" data-act="reveal" data-id="${c.id}">${c.reveal_count ? 'Reveal again' : 'Reveal'}</button>`);
	}
	if (c.status === 'quoted') {
		actions.push(`<button type="button" class="ac-btn ac-btn--sm" data-act="cancel" data-id="${c.id}">Cancel</button>`);
	}
	actions.push(`<button type="button" class="ac-btn ac-btn--sm ac-btn--ghost" data-act="details" data-id="${c.id}" aria-expanded="false">Details</button>`);
	let audit = '';
	if (c.revealed_at) audit = `Revealed ${c.reveal_count > 1 ? `${c.reveal_count} times, last ` : ''}${timeAgo(c.revealed_at)}`;
	else if (c.status === 'delivered') audit = 'Not revealed yet';
	const masked = c.masked_number || (c.status === 'delivered' ? 'Revealed' : '•••• ••••');
	return `
		<li class="ac-card" data-card="${c.id}">
			<div class="ac-card-main">
				<span class="ac-prod-img">${c.image_url ? `<img src="${esc(c.image_url)}" alt="" loading="lazy" />` : ''}</span>
				<div class="ac-card-id">
					<span class="ac-card-name">${esc(c.merchant)} <span class="ac-card-face">${esc(fmtMoney(c.face_value, c.currency))}</span>${c.mode === 'sandbox' ? ' <span class="ac-tag">Sandbox</span>' : ''}</span>
					<span class="ac-card-sub"><span class="ac-mono">${esc(masked)}</span> · ${esc(timeAgo(c.created_at))}${audit ? ` · ${esc(audit)}` : ''}</span>
					${c.error_message ? `<span class="ac-card-err">${esc(c.error_message)}</span>` : ''}
				</div>
				<span class="ac-status" data-status="${esc(c.status)}">${esc(STATUS_LABEL[c.status] || c.status)}</span>
			</div>
			<div class="ac-row ac-card-actions">${actions.join('')}</div>
			<div class="ac-card-details" hidden></div>
		</li>`;
}

function renderCards() {
	const el = root.querySelector('#ac-cards');
	if (!el) return;
	const totals = root.querySelector('#ac-totals');
	if (totals && state.totals) {
		totals.textContent = `${state.totals.delivered} delivered${state.totals.spent_usdc ? ` · ${fmtUsdc(state.totals.spent_usdc)} spent` : ''}`;
	}
	if (state.cardsLoading) {
		el.innerHTML = `<ul class="ac-cards" aria-busy="true">${'<li class="ac-card ac-card--skel"></li>'.repeat(3)}</ul>`;
		return;
	}
	if (state.cardsError) {
		el.innerHTML = `<div class="ac-inline-err" role="alert"><p>${esc(state.cardsError.message)}</p><button type="button" class="ac-btn" data-act="retry-cards">Try again</button></div>`;
		el.querySelector('[data-act="retry-cards"]').addEventListener('click', () => loadCards());
		return;
	}
	if (!state.cards.length) {
		el.innerHTML = `
			<div class="ac-empty">
				<p><strong>No cards yet.</strong></p>
				<p>Search a merchant above, pick an amount and get a quote. Want to see the whole flow first? Switch to Sandbox and buy a free test card.</p>
				${state.sandbox ? '' : '<button type="button" class="ac-btn" data-act="go-sandbox">Try the sandbox</button>'}
			</div>`;
		el.querySelector('[data-act="go-sandbox"]')?.addEventListener('click', () => root.querySelector('[data-mode="sandbox"]').click());
		return;
	}
	el.innerHTML = `<ul class="ac-cards">${state.cards.map(cardRow).join('')}</ul>${state.nextCursor ? '<div class="ac-row ac-row--center"><button type="button" class="ac-btn" data-act="more">Load more</button></div>' : ''}`;
	el.querySelector('[data-act="more"]')?.addEventListener('click', () => loadCards({ append: true }));
	el.querySelectorAll('[data-act][data-id]').forEach((b) => {
		const id = b.dataset.id;
		if (b.dataset.act === 'refresh') b.addEventListener('click', () => refreshCard(id, b));
		if (b.dataset.act === 'reveal') b.addEventListener('click', () => openReveal(id));
		if (b.dataset.act === 'cancel') b.addEventListener('click', () => cancelCard(id, b));
		if (b.dataset.act === 'details') b.addEventListener('click', () => toggleDetails(id, b));
	});
}

async function refreshCard(id, btn) {
	btn.disabled = true;
	btn.textContent = 'Checking…';
	try {
		upsertCard(await api(`/${id}/refresh`, { method: 'POST', body: {} }));
	} catch (e) {
		flash(e.message, true);
	}
	renderCards();
}

async function cancelCard(id, btn) {
	btn.disabled = true;
	try {
		upsertCard(await api(`/${id}/cancel`, { method: 'POST', body: { confirm_cancel: true } }));
		flash('Quote cancelled. Nothing was charged.');
	} catch (e) {
		flash(e.message, true);
	}
	renderCards();
}

async function toggleDetails(id, btn) {
	const li = root.querySelector(`[data-card="${id}"]`);
	const box = li.querySelector('.ac-card-details');
	const open = box.hidden;
	box.hidden = !open;
	btn.setAttribute('aria-expanded', String(open));
	if (!open) return;
	box.innerHTML = '<div class="ac-skel-bar"></div>';
	try {
		const [{ card, events }, bal] = await Promise.all([api(`/${id}`), api(`/${id}/balance`).catch(() => null)]);
		const canWithdraw = state.provider?.capabilities?.withdraw;
		const paid = card.mode === 'live' ? esc(fmtUsdc(card.total_usdc)) : 'Sandbox, free';
		box.innerHTML = `
			<dl class="ac-table ac-table--compact">
				<div><dt>Paid</dt><dd>${paid}${card.pay_explorer ? ` · <a href="${esc(card.pay_explorer)}" target="_blank" rel="noopener">View payment</a>` : ''}</dd></div>
				${bal ? `<div><dt>Balance</dt><dd>${esc(fmtMoney(bal.balance, bal.currency))}${bal.note ? ` <span class="ac-dim-text">${esc(bal.note)}</span>` : ''}</dd></div>` : ''}
				${card.redeem_instructions ? `<div><dt>Redeem</dt><dd>${esc(card.redeem_instructions)}</dd></div>` : ''}
				${card.expires_on ? `<div><dt>Expires</dt><dd>${esc(card.expires_on)}</dd></div>` : ''}
				<div><dt>Withdraw</dt><dd>${canWithdraw ? 'Available through the API' : `${esc(state.provider?.label || 'This provider')} does not support moving a card balance back to USDC.`}</dd></div>
			</dl>
			<ol class="ac-audit" aria-label="Audit trail">
				${events
					.map((ev) => {
						const label = EVENT_LABEL[ev.event] || ev.event;
						const to = ev.to_status && ev.event === 'status' ? `: ${STATUS_LABEL[ev.to_status] || ev.to_status}` : '';
						return `<li><span>${esc(label + to)}</span><span class="ac-dim-text">${esc(ev.actor_kind.replace('_', ' '))} · ${esc(new Date(ev.created_at).toLocaleString())}</span></li>`;
					})
					.join('')}
			</ol>`;
	} catch (e) {
		box.innerHTML = `<p class="ac-card-err">${esc(e.message)}</p>`;
	}
}

// ── reveal modal ─────────────────────────────────────────────────────────────

let lastFocus = null;

function closeModal() {
	// Clearing the host removes the secret from the DOM entirely.
	const host = root.querySelector('#ac-modal-host');
	if (host) host.innerHTML = '';
	document.removeEventListener('keydown', onModalKey);
	lastFocus?.focus?.();
}

function onModalKey(e) {
	if (e.key === 'Escape') {
		closeModal();
		return;
	}
	if (e.key !== 'Tab') return;
	const f = [...root.querySelectorAll('#ac-modal-host button, #ac-modal-host input, #ac-modal-host a')].filter((x) => !x.disabled);
	if (!f.length) return;
	const first = f[0];
	const last = f[f.length - 1];
	if (e.shiftKey && document.activeElement === first) {
		e.preventDefault();
		last.focus();
	} else if (!e.shiftKey && document.activeElement === last) {
		e.preventDefault();
		first.focus();
	}
}

function modal(inner) {
	const host = root.querySelector('#ac-modal-host');
	host.innerHTML = `
		<div class="ac-modal-back"></div>
		<div class="ac-modal" role="dialog" aria-modal="true" aria-labelledby="ac-modal-h">${inner}</div>`;
	host.querySelector('.ac-modal-back').addEventListener('click', closeModal);
	document.addEventListener('keydown', onModalKey);
	return host.querySelector('.ac-modal');
}

function modalNotice(m, title, body) {
	m.innerHTML = `<h2 id="ac-modal-h" class="ac-h3">${esc(title)}</h2><p>${esc(body)}</p><div class="ac-row"><button type="button" class="ac-btn" data-act="close">Close</button></div>`;
	const close = m.querySelector('[data-act="close"]');
	close.addEventListener('click', closeModal);
	close.focus();
}

async function openReveal(id) {
	lastFocus = document.activeElement;
	const m = modal('<h2 id="ac-modal-h" class="ac-h3">Preparing reveal…</h2><div class="ac-skel-bar"></div>');
	let data;
	try {
		data = await api(`/${id}/data`, { method: 'POST', body: {} });
	} catch (e) {
		modalNotice(m, "Can't reveal this card", e.message);
		return;
	}
	const c = data.card;
	const fields = data.fields.map((f) => FIELD_LABEL[f] || f.replace('extra_', '')).join(', ') || 'redemption data';
	m.innerHTML = `
		<h2 id="ac-modal-h" class="ac-h3">Reveal ${esc(c.merchant)} ${esc(fmtMoney(c.face_value, c.currency))}</h2>
		<p>This shows the card's ${esc(fields)} once. Anyone who sees it can spend the card.</p>
		<p class="ac-dim-text">${c.reveal_count ? `Revealed ${c.reveal_count} time${c.reveal_count > 1 ? 's' : ''} before. ` : ''}Every reveal is logged with who did it and when, and three.ws deletes its stored copy when you reveal.</p>
		<label class="ac-check"><input type="checkbox" id="ac-reveal-ok" /><span>Reveal the secret now</span></label>
		<div class="ac-row">
			<button type="button" class="ac-btn ac-btn--primary" data-act="do-reveal" disabled>Reveal</button>
			<button type="button" class="ac-btn ac-btn--ghost" data-act="close">Cancel</button>
		</div>`;
	const ok = m.querySelector('#ac-reveal-ok');
	const go = m.querySelector('[data-act="do-reveal"]');
	ok.addEventListener('change', () => {
		go.disabled = !ok.checked;
	});
	m.querySelector('[data-act="close"]').addEventListener('click', closeModal);
	ok.focus();
	go.addEventListener('click', async () => {
		go.disabled = true;
		go.textContent = 'Revealing…';
		try {
			const r = await api(`/${id}/reveal`, { method: 'POST', body: { preview_id: data.preview_id, confirm_reveal: true } });
			showSecret(m, r);
			loadCards();
		} catch (e) {
			modalNotice(m, 'Reveal refused', e.message);
		}
	});
}

function showSecret(m, r) {
	const entries = Object.entries(r.secret || {});
	const rows = entries
		.map(
			([k, v], i) => `
		<div class="ac-secret-row">
			<span class="ac-secret-k">${esc(FIELD_LABEL[k] || k.replace('extra_', ''))}</span>
			<code class="ac-secret-v">${esc(v)}</code>
			<button type="button" class="ac-btn ac-btn--sm" data-copy="${i}">Copy</button>
		</div>`,
		)
		.join('');
	m.innerHTML = `
		<h2 id="ac-modal-h" class="ac-h3">${esc(r.merchant)} ${esc(fmtMoney(r.face_value, r.currency))}</h2>
		<div class="ac-secret">${rows}</div>
		${r.instructions ? `<p class="ac-dim-text">${esc(r.instructions)}</p>` : ''}
		<p class="ac-warn">${esc(r.notice)}</p>
		<div class="ac-row"><button type="button" class="ac-btn ac-btn--primary" data-act="close">I saved it</button></div>`;
	m.querySelectorAll('[data-copy]').forEach((b) =>
		b.addEventListener('click', async () => {
			try {
				await navigator.clipboard.writeText(entries[Number(b.dataset.copy)][1]);
				b.textContent = 'Copied';
			} catch {
				b.textContent = 'Select and copy';
			}
		}),
	);
	const close = m.querySelector('[data-act="close"]');
	close.addEventListener('click', closeModal);
	close.focus();
}

// ── provider verification ────────────────────────────────────────────────────

async function loadConnect() {
	const el = root.querySelector('#ac-connect');
	if (!el) return;
	try {
		const c = await api('/connect');
		if (!c.required) {
			el.innerHTML =
				'<div class="ac-banner" role="status"><p><strong>The provider is holding a card for review.</strong> Check its status in a few minutes. A card that fails review is refunded to the agent wallet.</p></div>';
			return;
		}
		el.innerHTML =
			'<div class="ac-banner" role="status"><p><strong>The card provider needs you to verify your identity</strong> before it releases cards.</p><button type="button" class="ac-btn ac-btn--primary" data-act="connect">Open verification</button></div>';
		el.querySelector('[data-act="connect"]').addEventListener('click', async () => {
			try {
				const link = await api('/connect-link');
				window.open(link.url, '_blank', 'noopener');
			} catch (e) {
				flash(e.message, true);
			}
		});
	} catch {
		el.innerHTML = '';
	}
}

// ── toast ────────────────────────────────────────────────────────────────────

let toastTimer = null;
function flash(text, isError = false) {
	let t = document.getElementById('ac-toast');
	if (!t) {
		t = document.createElement('div');
		t.id = 'ac-toast';
		t.className = 'ac-toast';
		t.setAttribute('role', 'status');
		document.body.appendChild(t);
	}
	t.textContent = text;
	t.dataset.tone = isError ? 'error' : 'ok';
	t.classList.add('ac-toast--on');
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => t.classList.remove('ac-toast--on'), 3200);
}

// ── boot ─────────────────────────────────────────────────────────────────────

function resolveAgentId() {
	const fromQuery = new URLSearchParams(location.search).get('id');
	if (fromQuery) return fromQuery;
	const m = location.pathname.match(/\/agents\/([^/]+)\/cards/);
	return m ? decodeURIComponent(m[1]) : null;
}

async function currentUser() {
	const me = await fetch('/api/auth/me', { credentials: 'include', headers: { accept: 'application/json' } });
	if (!me.ok) throw new Error(`HTTP ${me.status}`);
	const j = await me.json();
	return j?.user?.id ? j.user : null;
}

async function mountAgent(agentId) {
	renderLoading('Loading agent cards');
	const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, { credentials: 'include', headers: { accept: 'application/json' } });
	if (res.status === 404) {
		renderMessage({
			title: 'Agent not found',
			body: 'This agent does not exist or was deleted by its owner.',
			actions: [{ href: '/agent-cards', label: 'Your agents', primary: true }],
		});
		setPageTitle('Agent not found · three.ws');
		return;
	}
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const { agent } = await res.json();
	if (!agent?.is_owner) {
		renderMessage({
			title: 'Only the owner can open these cards',
			body: "An agent's cards are private to its owner. Open your own agents to buy cards for them.",
			actions: [
				{ href: '/agent-cards', label: 'Your agents', primary: true },
				{ href: `/agents/${encodeURIComponent(agentId)}`, label: 'View this agent' },
			],
			tone: 'info',
		});
		return;
	}
	state.agent = agent;
	setPageTitle(`${agent.name || 'Agent'} cards · three.ws`);
	try {
		state.provider = await api('/provider');
	} catch {
		state.provider = null;
	}
	state.sandbox = !state.provider?.live_enabled;
	renderShell();
	search();
	loadCards();
}

async function boot() {
	renderLoading('Loading');
	try {
		const user = await currentUser();
		const agentId = resolveAgentId();
		if (!user) {
			const next = encodeURIComponent(location.pathname + location.search);
			renderMessage({
				title: 'Sign in to buy agent cards',
				body: 'Agents buy gift cards and prepaid cards with the USDC in their own wallet. Sign in to open your agents.',
				actions: [
					{ href: `/login?next=${next}`, label: 'Sign in', primary: true },
					{ href: '/register', label: 'Create account' },
				],
				tone: 'info',
			});
			return;
		}
		if (agentId) {
			if (!UUID_RE.test(agentId)) {
				renderMessage({
					title: 'That agent link is not valid',
					body: 'Open cards from one of your agents.',
					actions: [{ href: '/agent-cards', label: 'Your agents', primary: true }],
				});
				return;
			}
			await mountAgent(agentId);
			return;
		}
		const r = await fetch('/api/agents', { credentials: 'include', headers: { accept: 'application/json' } });
		if (!r.ok) throw new Error(`HTTP ${r.status}`);
		const agents = (await r.json())?.agents || [];
		if (!agents.length) {
			renderMessage({
				title: 'No agents yet',
				body: 'Create an agent first. Every agent gets its own Solana wallet it can buy cards from.',
				actions: [{ href: '/create-agent', label: 'Create an agent', primary: true }],
				tone: 'info',
			});
			return;
		}
		if (agents.length === 1) {
			history.replaceState(null, '', `/agents/${encodeURIComponent(agents[0].id)}/cards`);
			await mountAgent(agents[0].id);
			return;
		}
		renderPicker(agents);
	} catch {
		renderMessage({
			title: "Couldn't load agent cards",
			body: 'We could not reach three.ws. This is usually temporary; check your connection and try again.',
			retry: true,
		});
	}
}

boot();
