// Whole-agent marketplace UI.
//
//   /marketplace/agents                 browse agents for sale
//   /marketplace/agents/listing/:id     listing detail: bid, buy now, bid history,
//                                       what transfers, settlement progress
//   /marketplace/agents/dashboard       seller and buyer dashboard: listings, bids
//                                       received, bids placed, transfers
//
// Every money-moving action goes through the same flow: POST /preview for the
// confirmation table (recipient, amount, token, chain, fees, what transfers),
// show it, and only on an explicit Confirm send the action with confirm: true.
// Data: /api/v1/marketplace/agents/* (api/v1/marketplace/agents/[...route].js).

import { apiFetch } from './api.js';
import { resizedImageUrl } from './shared/image-url.js';
import { skeletonHTML, emptyStateHTML, errorStateHTML, attachRetry, ensureStateKitStyles } from './shared/state-kit.js';

const API = '/api/v1/marketplace/agents';
const view = document.getElementById('am-view');
const main = document.getElementById('am-main');

// ── Utilities ────────────────────────────────────────────────────────────────

function esc(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function short(addr) {
	return addr && addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr || '';
}

function timeLeft(iso) {
	const ms = new Date(iso).getTime() - Date.now();
	if (ms <= 0) return 'Ended';
	const h = Math.floor(ms / 3_600_000);
	if (h >= 48) return `${Math.floor(h / 24)}d left`;
	if (h >= 1) return `${h}h ${Math.floor((ms % 3_600_000) / 60_000)}m left`;
	return `${Math.max(1, Math.floor(ms / 60_000))}m left`;
}

function when(iso) {
	return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
}

function explorerTx(sig) {
	return `https://solscan.io/tx/${encodeURIComponent(sig)}`;
}

function sigLink(sig) {
	return sig ? `<a class="am-mono" href="${explorerTx(sig)}" target="_blank" rel="noopener">${esc(short(sig))}</a>` : '';
}

function status(s) {
	return `<span class="am-status am-status--${esc(s)}">${esc(String(s).replace(/_/g, ' '))}</span>`;
}

class ApiError extends Error {
	constructor(code, message, status, extra = {}) {
		super(message);
		this.code = code;
		this.status = status;
		Object.assign(this, extra);
	}
}

async function api(path, { method = 'GET', body, anonymous = true } = {}) {
	const res = await apiFetch(`${API}${path}`, {
		method,
		allowAnonymous: anonymous,
		headers: body ? { 'content-type': 'application/json' } : undefined,
		body: body ? JSON.stringify(body) : undefined,
		timeoutMs: method === 'GET' ? undefined : 120_000,
	});
	const json = await res.json().catch(() => null);
	if (!res.ok) {
		throw new ApiError(json?.error || `http_${res.status}`, json?.error_description || `Request failed (${res.status}).`, res.status, json || {});
	}
	return json?.data;
}

let mePromise = null;
function me() {
	if (!mePromise) {
		mePromise = apiFetch('/api/auth/me', { allowAnonymous: true })
			.then((r) => (r.ok ? r.json() : null))
			.then((j) => j?.user || null)
			.catch(() => null);
	}
	return mePromise;
}

function signInHref() {
	return `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
}

function toast(message, kind = 'ok') {
	const el = document.getElementById('am-toast');
	el.textContent = message;
	el.dataset.kind = kind;
	el.hidden = false;
	clearTimeout(toast.t);
	toast.t = setTimeout(() => { el.hidden = true; }, 6000);
}

function friendly(err) {
	if (err?.code === 'risk_ack_required' && err.requirement?.sign_url) {
		return `${err.message} <a href="${esc(err.requirement.sign_url)}">Sign the agreements</a>`;
	}
	return esc(err?.message || 'Something went wrong.');
}

// ── Modal ────────────────────────────────────────────────────────────────────

function openModal({ title, body, actions }) {
	const modal = document.getElementById('am-modal');
	document.getElementById('am-modal-title').textContent = title;
	document.getElementById('am-modal-body').innerHTML = body;
	const bar = document.getElementById('am-modal-actions');
	bar.innerHTML = '';
	const previousFocus = document.activeElement;
	return new Promise((resolve) => {
		const close = (value) => {
			modal.hidden = true;
			document.removeEventListener('keydown', onKey);
			previousFocus?.focus?.();
			resolve(value);
		};
		const onKey = (e) => { if (e.key === 'Escape') close(null); };
		for (const a of actions) {
			const b = document.createElement('button');
			b.type = 'button';
			b.className = `am-btn${a.primary ? ' am-btn--primary' : ''}`;
			b.textContent = a.label;
			b.addEventListener('click', () => close(a.value));
			bar.appendChild(b);
		}
		modal.onclick = (e) => { if (e.target === modal) close(null); };
		document.addEventListener('keydown', onKey);
		modal.hidden = false;
		bar.lastElementChild?.focus();
	});
}

function previewBody(p) {
	const rows = p.table.map((r) => `<tr><th scope="row">${esc(r.label)}</th><td class="am-mono">${esc(r.value)}</td></tr>`).join('');
	const warnings = (p.warnings || []).map((w) => `<div class="am-warn">${esc(w)}</div>`).join('');
	const transfers = p.what_transfers ? `<h3>What transfers</h3>${checklist(p.what_transfers)}` : '';
	return `<table class="am-table"><tbody>${rows}</tbody></table>${warnings}${transfers}
		<p class="am-help">Nothing moves until you press Confirm. This preview expires ${esc(when(p.expires_at))}.</p>`;
}

/**
 * The confirmation flow every money action uses: server preview, show the
 * table, commit only on Confirm. Returns the commit result or null if declined.
 */
async function confirmThenRun(action, params, title, commit) {
	let preview;
	try {
		preview = await api('/preview', { method: 'POST', body: { action, ...params }, anonymous: false });
	} catch (err) {
		await openModal({ title: 'Cannot continue', body: `<div class="am-err">${friendly(err)}</div>`, actions: [{ label: 'Close', value: null }] });
		return null;
	}
	const ok = await openModal({
		title,
		body: previewBody(preview),
		actions: [{ label: 'Cancel', value: false }, { label: 'Confirm', value: true, primary: true }],
	});
	if (!ok) return null;
	return commit();
}

function checklist(items) {
	return `<ul class="am-checklist">${items.map((w) => `
		<li><span class="am-check am-check--${w.transfers ? 'yes' : 'no'}" aria-label="${w.transfers ? 'transfers' : 'does not transfer'}">${w.transfers ? '✓' : '✕'}</span>
		<span>${esc(w.item)}${w.note ? `<span class="am-note">${esc(w.note)}</span>` : ''}</span></li>`).join('')}</ul>`;
}

// ── Wallets (connected-wallet bids) ──────────────────────────────────────────

const WALLETS = [
	{ key: 'phantom', name: 'Phantom', detect: () => window.phantom?.solana || (window.solana?.isPhantom && window.solana) },
	{ key: 'solflare', name: 'Solflare', detect: () => window.solflare },
	{ key: 'backpack', name: 'Backpack', detect: () => window.backpack?.solana || (window.solana?.isBackpack && window.solana) },
	{ key: 'seeker', name: 'Seeker Wallet', detect: () => (window.threeWsWallet?.isThreeWs && window.threeWsWallet) || null },
];
let wallet = null;

function availableWallets() {
	return WALLETS.map((w) => ({ ...w, provider: w.detect() })).filter((w) => w.provider);
}

async function connectWallet(key) {
	const entry = WALLETS.find((w) => w.key === key);
	const provider = entry?.detect();
	if (!provider) throw new Error(`${entry?.name || 'Wallet'} is not installed`);
	const resp = await provider.connect();
	const pk = resp?.publicKey ?? provider.publicKey;
	wallet = { provider, name: entry.name, address: typeof pk === 'string' ? pk : pk.toBase58() };
	return wallet;
}

function b64ToBytes(b64) {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

async function signAndSend(base64Tx) {
	const { VersionedTransaction, Connection } = await import('@solana/web3.js');
	const tx = VersionedTransaction.deserialize(b64ToBytes(base64Tx));
	if (typeof wallet.provider.signAndSendTransaction === 'function') {
		const r = await wallet.provider.signAndSendTransaction(tx);
		return r?.signature ?? r;
	}
	const signed = await wallet.provider.signTransaction(tx);
	return new Connection(`${location.origin}/api/solana-rpc`, 'confirmed').sendRawTransaction(signed.serialize());
}

/** Sign the escrow transfer and poll until the server has verified it. */
async function fundWithWallet(bid, funding, onStatus) {
	onStatus('Approve the escrow transfer in your wallet…');
	let signature;
	try {
		signature = await signAndSend(funding.transaction);
	} catch (err) {
		throw new ApiError('wallet_rejected', err?.message || 'The wallet did not sign the transfer.');
	}
	onStatus('Waiting for the transfer to land on Solana…');
	for (let i = 0; i < 40; i++) {
		const r = await api(`/bids/${bid.id}/confirm`, { method: 'POST', body: { signature }, anonymous: false });
		if (r.funding?.status !== 'not_landed') return r;
		await new Promise((res) => setTimeout(res, 2500));
	}
	throw new ApiError('not_landed', 'The transfer has not landed yet. If it lands later it is recorded automatically; refresh in a minute.');
}

// ── Cards ────────────────────────────────────────────────────────────────────

function thumbHTML(agent, { hero = false } = {}) {
	if (agent.thumbnail_url) {
		const w = hero ? 960 : 480;
		const src = resizedImageUrl(agent.thumbnail_url, w);
		return `<img src="${esc(src)}" alt="${esc(agent.name)}" loading="${hero ? 'eager' : 'lazy'}" decoding="async" />`;
	}
	return `<span class="am-thumb-initial" aria-hidden="true">${esc((agent.name || '?').slice(0, 1).toUpperCase())}</span>`;
}

function priceBlock(l) {
	if (l.ask) return { label: 'Buy now', value: `${l.ask.amount} USDC` };
	if (l.top_bid) return { label: 'Top bid', value: `${l.top_bid.amount} USDC` };
	return { label: 'Min bid', value: `${l.min_bid.amount} USDC` };
}

function cardHTML(l, i) {
	const p = priceBlock(l);
	const balance = l.include_balance && l.wallet_balance
		? `<span class="am-chip am-chip--good">Wallet ${esc(l.wallet_balance.usdc ?? 0)} USDC · ${esc(Number(l.wallet_balance.sol ?? 0).toFixed(3))} SOL</span>`
		: '';
	const rep = l.reputation ? `<span class="am-chip" title="Reputation">${esc(l.reputation.label || l.reputation.tier)} ${esc(l.reputation.score)}</span>` : '';
	const skills = (l.agent.skills || []).slice(0, 3).map((s) => `<span class="am-chip">${esc(s)}</span>`).join('');
	return `<a class="am-card" href="${esc(l.url)}" style="animation-delay:${Math.min(i, 12) * 30}ms">
		<div class="am-thumb">${thumbHTML(l.agent)}
			${l.prior_sales ? `<span class="am-badge">Sold ${l.prior_sales}×</span>` : ''}
			<span class="am-badge am-badge--time">${esc(timeLeft(l.expires_at))}</span>
		</div>
		<div class="am-card-body">
			<h2 class="am-card-title">${esc(l.agent.name)}</h2>
			<p class="am-card-persona">${esc(l.agent.persona_summary || 'No persona summary.')}</p>
			<div class="am-chips">${rep}${balance}${skills}</div>
			<div class="am-card-foot">
				<div><div class="am-price-label">${esc(p.label)}</div><div class="am-price">${esc(p.value)}</div></div>
				<div class="am-meta">${l.bid_count} bid${l.bid_count === 1 ? '' : 's'}${l.top_bid && l.ask ? ` · top ${esc(l.top_bid.amount)}` : ''}</div>
			</div>
		</div>
	</a>`;
}

// ── Browse ───────────────────────────────────────────────────────────────────

async function renderBrowse() {
	const params = new URLSearchParams(location.search);
	const state = { q: params.get('q') || '', sort: params.get('sort') || 'ending', cursor: null, items: [] };
	view.innerHTML = `
		<div class="am-head">
			<div>
				<h1>Agents for sale</h1>
				<p class="am-sub">Buy or bid on whole agents: identity, persona, skills, history and wallet. Bids sit in USDC escrow on Solana, and on a sale the buyer gets a brand-new wallet key while the seller's access is revoked.</p>
			</div>
			<div class="am-row"><a class="am-btn" href="/marketplace/agents/dashboard">My bids &amp; listings</a><a class="am-btn am-btn--primary" href="/marketplace/agents/dashboard#sell">Sell an agent</a></div>
		</div>
		<form class="am-toolbar" id="am-filter" role="search">
			<input class="am-input" type="search" name="q" placeholder="Search by name, persona or skill" value="${esc(state.q)}" aria-label="Search agents for sale" />
			<select class="am-select" name="sort" aria-label="Sort">
				${[['ending', 'Ending soon'], ['newest', 'Newest'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low'], ['most_bids', 'Most bids']]
					.map(([v, t]) => `<option value="${v}"${v === state.sort ? ' selected' : ''}>${t}</option>`).join('')}
			</select>
		</form>
		<div id="am-results" class="am-grid">${skeletonHTML(8, 'card')}</div>
		<div class="am-row" style="justify-content:center;margin-top:24px"><button class="am-btn" id="am-more" hidden>Load more</button></div>`;
	ensureStateKitStyles();

	const results = document.getElementById('am-results');
	const more = document.getElementById('am-more');
	const form = document.getElementById('am-filter');

	async function load(reset) {
		if (reset) { state.cursor = null; state.items = []; results.innerHTML = skeletonHTML(8, 'card'); }
		const qs = new URLSearchParams({ sort: state.sort, limit: '24' });
		if (state.q) qs.set('q', state.q);
		if (state.cursor) qs.set('cursor', state.cursor);
		try {
			more.disabled = true;
			const r = await api(`?${qs}`);
			state.items.push(...r.items);
			state.cursor = r.next_cursor;
			if (!state.items.length) {
				results.innerHTML = `<div style="grid-column:1/-1">${emptyStateHTML({
					title: state.q ? 'No agents match that search' : 'No agents are for sale yet',
					body: state.q ? 'Try a different name or skill, or clear the search.' : 'List one of your agents: set a minimum bid, an optional buy-now price, and choose whether its wallet balance goes with it.',
					actions: [{ label: 'Sell an agent', href: '/marketplace/agents/dashboard#sell', primary: true }, { label: 'Browse all agents', href: '/marketplace' }],
				})}</div>`;
			} else {
				results.innerHTML = state.items.map(cardHTML).join('');
			}
			more.hidden = !state.cursor;
		} catch (err) {
			results.innerHTML = `<div style="grid-column:1/-1">${errorStateHTML({ title: 'Could not load listings', body: friendly(err) })}</div>`;
			attachRetry(results, () => load(true));
		} finally {
			more.disabled = false;
			main.setAttribute('aria-busy', 'false');
		}
	}

	let debounce;
	form.addEventListener('input', () => {
		clearTimeout(debounce);
		debounce = setTimeout(() => {
			state.q = form.q.value.trim();
			state.sort = form.sort.value;
			const next = new URLSearchParams();
			if (state.q) next.set('q', state.q);
			if (state.sort !== 'ending') next.set('sort', state.sort);
			history.replaceState(null, '', `${location.pathname}${next.toString() ? `?${next}` : ''}`);
			load(true);
		}, 250);
	});
	form.addEventListener('submit', (e) => e.preventDefault());
	more.addEventListener('click', () => load(false));
	await load(true);
}

// ── Listing detail ───────────────────────────────────────────────────────────

let pollTimer = null;

function transferPanel(t) {
	const failed = t.status === 'failed';
	return `<section class="am-panel" aria-live="polite">
		<h2>Settlement ${status(t.status)}</h2>
		<p class="am-help">Sale of ${esc(t.amount.amount)} ${esc(t.amount.symbol)}: the seller receives ${esc(t.seller_net.amount)} after a ${esc(t.fee.amount)} platform fee.</p>
		<ol class="am-steps">${t.steps.map((s) => `<li data-state="${s.state}"><span class="am-dot" aria-hidden="true"></span><span>${esc(s.label)}<span class="am-note">${s.state === 'failed' ? 'stopped here' : s.state}</span></span></li>`).join('')}</ol>
		${failed ? `<div class="am-err">${esc(t.last_error || 'A settlement step failed.')} Every step is safe to repeat: nothing is paid twice.</div>
			${t.can_resume ? `<button class="am-btn am-btn--primary" data-resume="${esc(t.id)}">Resume settlement</button>` : ''}` : ''}
		${t.new_wallet_address ? `<p class="am-help">New wallet: <span class="am-mono">${esc(t.new_wallet_address)}</span>${t.old_wallet_address ? ` · old wallet emptied: <span class="am-mono">${esc(short(t.old_wallet_address))}</span>` : ''}</p>` : ''}
		${t.payout_signature ? `<p class="am-help">Seller payout: ${sigLink(t.payout_signature)}${t.fee_signature ? ` · fee: ${sigLink(t.fee_signature)}` : ''}</p>` : ''}
		${t.stranded?.length ? `<div class="am-warn">${t.stranded.length} frozen token account(s) could not move and stayed on the old wallet.</div>` : ''}
		${t.status === 'completed' && t.viewer_role === 'buyer' ? `<div class="am-warn">The agent is yours. Its wallet starts frozen with conservative limits: <a href="/agents/${esc(t.agent_id)}/wallet">open the wallet</a> to review limits and unfreeze.</div>` : ''}
	</section>`;
}

function bidsTable(d, user) {
	const l = d.listing;
	const isSeller = l.seller.is_viewer;
	if (!d.bids.length) {
		return emptyStateHTML({ compact: true, title: 'No bids yet', body: isSeller ? 'Bids appear here the moment their escrow lands. Share the listing to reach buyers.' : `Be the first: the minimum bid is ${esc(l.min_bid.amount)} USDC.` });
	}
	const rows = d.bids.map((b) => {
		const actions = [];
		if (isSeller && b.status === 'open' && l.status === 'active') {
			actions.push(`<button class="am-btn am-btn--sm am-btn--primary" data-accept="${b.id}">Accept</button>`, `<button class="am-btn am-btn--sm" data-reject="${b.id}">Reject</button>`);
		}
		if (user && b.bidder.is_viewer && b.status === 'open') actions.push(`<button class="am-btn am-btn--sm" data-withdraw="${b.id}">Withdraw</button>`);
		return `<tr>
			<td class="num"><b>${esc(b.amount.amount)}</b> ${esc(b.amount.symbol)}${b.kind === 'buy_now' ? ' <span class="am-chip">buy now</span>' : ''}</td>
			<td>${b.bidder.is_viewer ? 'You' : esc(b.bidder.name || short(b.bidder.id))}</td>
			<td>${status(b.status)}${b.refund ? `<span class="am-note">refund ${esc(b.refund.status)} ${sigLink(b.refund.signature)}</span>` : ''}</td>
			<td>${sigLink(b.escrow_signature)}<span class="am-note">${esc(when(b.created_at))}</span></td>
			<td><div class="am-row">${actions.join('')}</div></td>
		</tr>`;
	}).join('');
	return `<div style="overflow-x:auto"><table class="am-table"><thead><tr><th>Amount</th><th>Bidder</th><th>Status</th><th>Escrow</th><th><span hidden>Actions</span></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function historyList(events) {
	if (!events.length) return '<p class="am-help">No events yet.</p>';
	return `<ul class="am-checklist">${events.slice(0, 30).map((e) => `<li><span class="am-check am-check--no" aria-hidden="true">•</span>
		<span>${esc(e.event.replace(/_/g, ' '))}${e.amount ? ` · ${esc(e.amount.amount)} ${esc(e.amount.symbol)}` : ''}${e.meta?.label ? ` · ${esc(e.meta.label)}` : ''}
		<span class="am-note">${esc(when(e.at))} ${sigLink(e.signature)}</span></span></li>`).join('')}</ul>`;
}

async function bidForm(d, user) {
	const l = d.listing;
	if (l.status !== 'active') return '';
	if (!user) {
		return `<section class="am-panel"><h2>Place a bid</h2><p class="am-help">Sign in to bid or buy. Bids are held in escrow and refunded if not accepted.</p><a class="am-btn am-btn--primary" href="${signInHref()}">Sign in to bid</a></section>`;
	}
	if (l.seller.is_viewer) {
		return `<section class="am-panel"><h2>Your listing</h2><p class="am-help">Accept a bid from the table, or take the listing down. Delisting refunds every open bid.</p>
			<div class="am-row"><button class="am-btn am-btn--danger" id="am-delist">Delist</button><a class="am-btn" href="/marketplace/agents/dashboard">Seller dashboard</a></div></section>`;
	}
	let agents = [];
	try { agents = await api('/my-agents', { anonymous: false }); } catch { agents = []; }
	const funders = agents.filter((a) => a.wallet_address && !a.listed && a.id !== l.agent.id);
	const minNext = l.top_bid ? `more than ${l.top_bid.amount}` : `at least ${l.min_bid.amount}`;
	return `<section class="am-panel">
		<h2>${l.ask ? 'Buy or bid' : 'Place a bid'}</h2>
		<form id="am-bid-form">
			<fieldset class="am-field" style="border:0;padding:0;margin:0 0 12px">
				<legend class="am-help" style="font-weight:600">Pay from</legend>
				<label class="am-radio"><input type="radio" name="source" value="agent_wallet" ${funders.length ? 'checked' : 'disabled'} /> One of my agents' wallets</label>
				<select class="am-select" name="funding_agent_id" aria-label="Funding agent" ${funders.length ? '' : 'hidden'}>
					${funders.map((a) => `<option value="${a.id}">${esc(a.name)} · ${esc(a.balance?.usdc ?? '?')} USDC</option>`).join('')}
				</select>
				${funders.length ? '' : '<p class="am-help">None of your agents has a wallet free to fund bids.</p>'}
				<label class="am-radio"><input type="radio" name="source" value="connected_wallet" ${funders.length ? '' : 'checked'} /> A browser wallet (Phantom, Solflare, Backpack)</label>
				<div id="am-wallet-area" class="am-row"></div>
			</fieldset>
			<label class="am-field"><span>Bid amount (USDC), ${esc(minNext)}</span>
				<input class="am-input" name="amount" inputmode="decimal" autocomplete="off" pattern="[0-9]+(\\.[0-9]{1,6})?" placeholder="${esc(l.top_bid ? l.top_bid.amount : l.min_bid.amount)}" /></label>
			<div class="am-row">
				<button class="am-btn am-btn--primary" type="submit">Review bid</button>
				${l.ask ? `<button class="am-btn" type="button" id="am-buy-usdc">Buy now for ${esc(l.ask.amount)} USDC</button>` : ''}
				${l.ask_three ? `<button class="am-btn" type="button" id="am-buy-three">Buy now for ${esc(l.ask_three.amount)} $THREE</button>` : ''}
			</div>
			<p class="am-help" id="am-bid-status" role="status"></p>
		</form>
	</section>`;
}

function wireWalletArea() {
	const area = document.getElementById('am-wallet-area');
	if (!area) return;
	if (wallet) {
		area.innerHTML = `<span class="am-help">Connected ${esc(wallet.name)} <span class="am-mono">${esc(short(wallet.address))}</span></span>`;
		return;
	}
	const list = availableWallets();
	area.innerHTML = list.length
		? list.map((w) => `<button type="button" class="am-btn am-btn--sm" data-wallet="${w.key}">Connect ${esc(w.name)}</button>`).join('')
		: '<span class="am-help">No browser wallet found. Install <a href="https://phantom.app" target="_blank" rel="noopener">Phantom</a> or pay from an agent wallet.</span>';
	area.querySelectorAll('[data-wallet]').forEach((b) => b.addEventListener('click', async () => {
		b.disabled = true;
		try { await connectWallet(b.dataset.wallet); wireWalletArea(); } catch (err) { toast(err.message, 'err'); b.disabled = false; }
	}));
}

function fundingParams(form) {
	const source = form.source.value;
	if (source === 'agent_wallet') return { funding_source: 'agent_wallet', funding_agent_id: form.funding_agent_id.value };
	if (!wallet) throw new ApiError('wallet_required', 'Connect a browser wallet first.');
	return { funding_source: 'connected_wallet', wallet_address: wallet.address };
}

async function submitBid({ listingId, kind, currency, amount, form, refresh }) {
	const statusEl = document.getElementById('am-bid-status');
	const setStatus = (t) => { statusEl.textContent = t; };
	let funding;
	try { funding = fundingParams(form); } catch (err) { toast(err.message, 'err'); return; }
	const params = { listing_id: listingId, ...funding };
	if (kind === 'bid') params.amount_usdc = amount;
	if (kind === 'buy_now' && currency) params.currency = currency;
	const title = kind === 'buy_now' ? 'Confirm purchase' : 'Confirm bid';
	try {
		const result = await confirmThenRun(kind === 'buy_now' ? 'buy_now' : 'place_bid', params, title, async () => {
			setStatus(funding.funding_source === 'agent_wallet' ? 'Moving USDC into escrow…' : 'Preparing the escrow transfer…');
			const body = { ...params, confirm: true };
			const r = await api(`/listings/${listingId}/${kind === 'buy_now' ? 'buy' : 'bids'}`, { method: 'POST', body, anonymous: false });
			if (r.funding?.status === 'awaiting_signature') return fundWithWallet(r.bid, r.funding, setStatus);
			return r;
		});
		if (!result) { setStatus(''); return; }
		setStatus('');
		toast(kind === 'buy_now' ? 'Paid. Settlement is running.' : 'Bid escrowed.', 'ok');
		await refresh();
	} catch (err) {
		setStatus('');
		toast(err.message, 'err');
		await refresh();
	}
}

async function renderListing(id) {
	view.innerHTML = `<div class="am-detail"><div><div class="am-sk am-hero-thumb"></div>${skeletonHTML(3, 'text')}</div><div>${skeletonHTML(4, 'row')}</div></div>`;
	const user = await me();

	async function refresh() {
		clearTimeout(pollTimer);
		let d;
		try {
			d = await api(`/listings/${encodeURIComponent(id)}`);
		} catch (err) {
			view.innerHTML = err.status === 404
				? emptyStateHTML({ title: 'Listing not found', body: 'It may have been removed. Browse what is for sale now.', actions: [{ label: 'Agents for sale', href: '/marketplace/agents', primary: true }] })
				: errorStateHTML({ title: 'Could not load this listing', body: friendly(err) });
			attachRetry(view, refresh);
			main.setAttribute('aria-busy', 'false');
			return;
		}
		const l = d.listing;
		document.title = `${l.agent.name} for sale · three.ws`;
		document.getElementById('am-crumb-sep').hidden = false;
		document.getElementById('am-crumb-here').textContent = l.agent.name;
		const bal = l.wallet_balance;
		view.innerHTML = `<div class="am-detail">
			<div>
				<div class="am-thumb am-hero-thumb">${thumbHTML(l.agent, { hero: true })}<span class="am-badge">${status(l.status)}</span><span class="am-badge am-badge--time">${esc(timeLeft(l.expires_at))}</span></div>
				<div class="am-head" style="margin-bottom:12px"><div><h1>${esc(l.agent.name)}</h1><p class="am-sub">${esc(l.agent.persona_summary || '')}</p></div>
					<a class="am-btn" href="${esc(l.agent.url)}">View agent profile</a></div>
				<section class="am-panel">
					<div class="am-stats">
						<div class="am-stat"><b>${l.ask ? `${esc(l.ask.amount)}` : 'None'}</b><span>Buy now (USDC)</span></div>
						<div class="am-stat"><b>${l.top_bid ? esc(l.top_bid.amount) : esc(l.min_bid.amount)}</b><span>${l.top_bid ? 'Top bid' : 'Minimum bid'} (USDC)</span></div>
						<div class="am-stat"><b>${l.bid_count}</b><span>Bids</span></div>
						<div class="am-stat"><b>${l.reputation ? esc(l.reputation.score) : 'Unscored'}</b><span>Reputation${l.reputation ? ` · ${esc(l.reputation.label || l.reputation.tier)}` : ''}</span></div>
						<div class="am-stat"><b>${l.include_balance && bal ? `${esc(bal.usdc ?? 0)} USDC` : 'Not included'}</b><span>${l.include_balance && bal ? `${esc(Number(bal.sol ?? 0).toFixed(4))} SOL · wallet` : 'Wallet balance'}</span></div>
						<div class="am-stat"><b>${l.trade_history.sales}</b><span>Previous sales${l.trade_history.best_sale ? ` · best ${esc(l.trade_history.best_sale)}` : ''}</span></div>
					</div>
					${(l.agent.skills || []).length ? `<h3>Skills</h3><div class="am-chips">${l.agent.skills.map((s) => `<span class="am-chip">${esc(s)}</span>`).join('')}</div>` : ''}
					${l.note ? `<h3>Seller's note</h3><p class="am-help">${esc(l.note)}</p>` : ''}
					${(l.snapshot?.warnings || []).map((w) => `<div class="am-warn">${esc(w)}</div>`).join('')}
				</section>
				<section class="am-panel"><h2>Bids</h2>${bidsTable(d, user)}</section>
				<section class="am-panel"><h2>History</h2>${historyList(d.history)}</section>
			</div>
			<div>
				${d.transfer ? transferPanel(d.transfer) : ''}
				${await bidForm(d, user)}
				<section class="am-panel"><h2>What transfers</h2>${checklist(l.what_transfers)}
					<p class="am-help">Escrow account <span class="am-mono">${esc(l.escrow_address)}</span> on Solana. Platform fee ${esc(l.fee_bps / 100)}% of the sale, paid from escrow. <a href="/docs/agent-marketplace">How it works</a></p></section>
			</div>
		</div>`;
		main.setAttribute('aria-busy', 'false');
		wireListing(d, refresh);
		if (d.transfer && d.transfer.status === 'in_progress') pollTimer = setTimeout(refresh, 4000);
	}
	await refresh();
}

function wireListing(d, refresh) {
	const l = d.listing;
	wireWalletArea();
	const form = document.getElementById('am-bid-form');
	if (form) {
		const agentSelect = form.funding_agent_id;
		form.addEventListener('change', () => {
			if (agentSelect) agentSelect.hidden = form.source.value !== 'agent_wallet';
			document.getElementById('am-wallet-area').hidden = form.source.value !== 'connected_wallet';
		});
		form.dispatchEvent(new Event('change'));
		form.addEventListener('submit', (e) => {
			e.preventDefault();
			const amount = form.amount.value.trim();
			if (!/^\d+(\.\d{1,6})?$/.test(amount)) { toast('Enter a USDC amount, e.g. 25 or 25.5', 'err'); form.amount.focus(); return; }
			submitBid({ listingId: l.id, kind: 'bid', amount, form, refresh });
		});
		document.getElementById('am-buy-usdc')?.addEventListener('click', () => submitBid({ listingId: l.id, kind: 'buy_now', currency: 'USDC', form, refresh }));
		document.getElementById('am-buy-three')?.addEventListener('click', () => {
			if (form.source.value !== 'connected_wallet') { toast('$THREE payments come from a browser wallet. Choose it above.', 'err'); return; }
			submitBid({ listingId: l.id, kind: 'buy_now', currency: 'THREE', form, refresh });
		});
	}
	document.getElementById('am-delist')?.addEventListener('click', async () => {
		try {
			const r = await confirmThenRun('delist', { listing_id: l.id }, 'Delist this agent?', () => api(`/listings/${l.id}/delist`, { method: 'POST', body: { confirm: true }, anonymous: false }));
			if (r) toast('Delisted. Open bids are being refunded.');
		} catch (err) { toast(err.message, 'err'); }
		refresh();
	});
	view.querySelectorAll('[data-accept]').forEach((b) => b.addEventListener('click', () => acceptBid(b.dataset.accept, refresh)));
	view.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', () => rejectBid(b.dataset.reject, refresh)));
	view.querySelectorAll('[data-withdraw]').forEach((b) => b.addEventListener('click', () => withdrawBid(b.dataset.withdraw, refresh)));
	view.querySelectorAll('[data-resume]').forEach((b) => b.addEventListener('click', () => resumeTransfer(b.dataset.resume, refresh)));
}

async function acceptBid(bidId, refresh) {
	try {
		const r = await confirmThenRun('accept_bid', { bid_id: bidId }, 'Accept this bid and sell the agent?', () =>
			api(`/bids/${bidId}/accept`, { method: 'POST', body: { confirm: true }, anonymous: false }));
		if (r) toast(r.transfer.status === 'completed' ? 'Sold. Proceeds sent to your payout address.' : 'Accepted. Settlement is running.');
	} catch (err) { toast(err.message, 'err'); }
	refresh();
}

async function rejectBid(bidId, refresh) {
	const ok = await openModal({ title: 'Reject this bid?', body: '<p class="am-help">The bidder is refunded from escrow. Your listing stays up.</p>', actions: [{ label: 'Cancel', value: false }, { label: 'Reject', value: true, primary: true }] });
	if (!ok) return;
	try {
		const r = await api(`/bids/${bidId}/reject`, { method: 'POST', body: {}, anonymous: false });
		toast(`Rejected. Refund ${r.refund.status}.`);
	} catch (err) { toast(err.message, 'err'); }
	refresh();
}

async function withdrawBid(bidId, refresh) {
	try {
		const r = await confirmThenRun('withdraw_bid', { bid_id: bidId }, 'Withdraw your bid?', () =>
			api(`/bids/${bidId}/withdraw`, { method: 'POST', body: { confirm: true }, anonymous: false }));
		if (r) toast(`Withdrawn. Refund ${r.refund.status}.`);
	} catch (err) { toast(err.message, 'err'); }
	refresh();
}

async function resumeTransfer(transferId, refresh) {
	try {
		const r = await api(`/transfers/${transferId}/resume`, { method: 'POST', body: {}, anonymous: false });
		toast(r.settlement_error ? `Still blocked: ${r.settlement_error.message}` : 'Settlement resumed.', r.settlement_error ? 'err' : 'ok');
	} catch (err) { toast(err.message, 'err'); }
	refresh();
}

// ── Dashboard ────────────────────────────────────────────────────────────────

const TABS = [
	['sell', 'List an agent'],
	['listings', 'My listings'],
	['received', 'Bids received'],
	['bids', 'My bids'],
	['transfers', 'Transfers'],
];

async function renderDashboard() {
	document.getElementById('am-crumb-sep').hidden = false;
	document.getElementById('am-crumb-here').textContent = 'Dashboard';
	const user = await me();
	if (!user) {
		view.innerHTML = emptyStateHTML({ title: 'Sign in to buy and sell agents', body: 'Your listings, the bids on them, the bids you placed and every transfer live here.', actions: [{ label: 'Sign in', href: signInHref(), primary: true }, { label: 'Browse agents for sale', href: '/marketplace/agents' }] });
		main.setAttribute('aria-busy', 'false');
		return;
	}
	let tab = (location.hash || '#listings').slice(1);
	if (!TABS.some(([k]) => k === tab)) tab = 'listings';
	view.innerHTML = `<div class="am-head"><div><h1>Marketplace dashboard</h1><p class="am-sub">Sell your agents, answer bids, and follow every settlement step by step.</p></div>
		<a class="am-btn" href="/marketplace/agents">Browse agents for sale</a></div>
		<div class="am-tabs" role="tablist">${TABS.map(([k, t]) => `<button class="am-tab" role="tab" data-tab="${k}" aria-selected="${k === tab}">${t}<span class="am-count" data-count="${k}" hidden></span></button>`).join('')}</div>
		<div id="am-tab-body" role="tabpanel">${skeletonHTML(4, 'row')}</div>`;

	const body = document.getElementById('am-tab-body');
	let data = null;
	async function loadData() {
		data = await api('/dashboard', { anonymous: false });
		const counts = {
			listings: data.listings.filter((l) => l.status === 'active').length,
			received: data.received_bids.filter((b) => b.status === 'open').length,
			transfers: data.transfers.filter((t) => t.status !== 'completed').length,
		};
		for (const [k, n] of Object.entries(counts)) {
			const el = view.querySelector(`[data-count="${k}"]`);
			if (el) { el.textContent = n; el.hidden = !n; }
		}
	}
	async function show(next) {
		tab = next;
		history.replaceState(null, '', `#${tab}`);
		view.querySelectorAll('.am-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
		body.innerHTML = skeletonHTML(4, 'row');
		try {
			if (!data) await loadData();
			if (tab === 'sell') await renderSellForm(body);
			else if (tab === 'listings') renderMyListings(body);
			else if (tab === 'received') renderBidRows(body, data.received_bids, 'received', reload);
			else if (tab === 'bids') renderBidRows(body, await api('/bids/mine', { anonymous: false }), 'mine', reload);
			else renderTransfers(body, reload);
		} catch (err) {
			body.innerHTML = errorStateHTML({ title: 'Could not load your dashboard', body: friendly(err) });
			attachRetry(body, () => { data = null; show(tab); });
		}
		main.setAttribute('aria-busy', 'false');
	}
	async function reload() { data = null; await show(tab); }
	function renderMyListings(el) {
		if (!data.listings.length) {
			el.innerHTML = emptyStateHTML({ title: 'You have not listed an agent', body: 'List one with a minimum bid and an optional buy-now price. You choose whether its wallet balance and history go with it.', actions: [{ label: 'List an agent', id: 'go-sell', primary: true }] });
			el.querySelector('[data-sk-action="go-sell"]')?.addEventListener('click', () => show('sell'));
			return;
		}
		el.innerHTML = `<div class="am-grid">${data.listings.map(cardHTML).join('')}</div>`;
	}
	function renderTransfers(el) {
		if (!data.transfers.length) {
			el.innerHTML = emptyStateHTML({ title: 'No transfers yet', body: 'When you buy an agent or accept a bid, its settlement appears here step by step.' });
			return;
		}
		el.innerHTML = data.transfers.map((t) => `${transferPanel(t)}<p class="am-help" style="margin:-8px 0 16px"><a href="/marketplace/agents/listing/${esc(t.listing_id)}">Open the listing</a> · you are the ${esc(t.viewer_role)}</p>`).join('');
		el.querySelectorAll('[data-resume]').forEach((b) => b.addEventListener('click', () => resumeTransfer(b.dataset.resume, reload)));
	}
	view.querySelectorAll('.am-tab').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
	await show(tab);
}

function renderBidRows(el, bids, mode, reload) {
	if (!bids.length) {
		el.innerHTML = emptyStateHTML({
			title: mode === 'received' ? 'No bids on your listings yet' : 'You have not bid on an agent',
			body: mode === 'received' ? 'Bids appear here once their escrow lands.' : 'Find an agent for sale and bid from one of your agents\' wallets or a browser wallet.',
			actions: mode === 'received' ? [] : [{ label: 'Browse agents for sale', href: '/marketplace/agents', primary: true }],
		});
		return;
	}
	el.innerHTML = `<div style="overflow-x:auto"><table class="am-table"><thead><tr><th>Agent</th><th>Amount</th><th>Status</th><th>Placed</th><th><span hidden>Actions</span></th></tr></thead><tbody>
		${bids.map((b) => {
			const acts = [];
			if (mode === 'received' && b.status === 'open' && b.listing_status === 'active') acts.push(`<button class="am-btn am-btn--sm am-btn--primary" data-accept="${b.id}">Accept</button>`, `<button class="am-btn am-btn--sm" data-reject="${b.id}">Reject</button>`);
			if (mode === 'mine' && b.status === 'open') acts.push(`<button class="am-btn am-btn--sm" data-withdraw="${b.id}">Withdraw</button>`);
			return `<tr><td><a href="/marketplace/agents/listing/${esc(b.listing_id)}">${esc(b.agent_name || 'Agent')}</a></td>
				<td class="num"><b>${esc(b.amount.amount)}</b> ${esc(b.amount.symbol)}</td>
				<td>${status(b.status)}${b.refund ? `<span class="am-note">refund ${esc(b.refund.status)} ${sigLink(b.refund.signature)}</span>` : ''}</td>
				<td>${esc(when(b.created_at))}</td><td><div class="am-row">${acts.join('')}</div></td></tr>`;
		}).join('')}</tbody></table></div>`;
	el.querySelectorAll('[data-accept]').forEach((b) => b.addEventListener('click', () => acceptBid(b.dataset.accept, reload)));
	el.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', () => rejectBid(b.dataset.reject, reload)));
	el.querySelectorAll('[data-withdraw]').forEach((b) => b.addEventListener('click', () => withdrawBid(b.dataset.withdraw, reload)));
}

async function renderSellForm(el) {
	const agents = await api('/my-agents', { anonymous: false });
	if (!agents.length) {
		el.innerHTML = emptyStateHTML({ title: 'You have no agents to sell', body: 'Create an agent first; it gets an identity, a 3D body and a wallet.', actions: [{ label: 'Create an agent', href: '/create', primary: true }] });
		return;
	}
	const sellable = agents.filter((a) => !a.listed && !a.funding_bids);
	el.innerHTML = `<section class="am-panel" style="max-width:640px">
		<h2>List an agent for sale</h2>
		<form id="am-sell">
			<label class="am-field"><span>Agent</span><select class="am-select" name="agent_id" required>
				${agents.map((a) => `<option value="${a.id}" ${a.listed || a.funding_bids ? 'disabled' : ''}>${esc(a.name)}${a.listed ? ' (already listed)' : a.funding_bids ? ' (funding open bids)' : ''}${a.balance ? ` · ${esc(a.balance.usdc ?? 0)} USDC, ${esc(Number(a.balance.sol ?? 0).toFixed(3))} SOL` : ''}</option>`).join('')}
			</select></label>
			${sellable.length ? '' : '<div class="am-warn">Every agent is already listed or funding bids.</div>'}
			<div class="am-row" style="align-items:flex-start">
				<label class="am-field" style="flex:1 1 160px"><span>Minimum bid (USDC)</span><input class="am-input" name="min_bid_usdc" inputmode="decimal" required placeholder="10" /></label>
				<label class="am-field" style="flex:1 1 160px"><span>Buy-now price (USDC, optional)</span><input class="am-input" name="ask_usdc" inputmode="decimal" placeholder="50" /></label>
				<label class="am-field" style="flex:1 1 160px"><span>Buy-now in $THREE (optional)</span><input class="am-input" name="ask_three" inputmode="decimal" placeholder="" /></label>
			</div>
			<label class="am-field"><span>Duration</span><select class="am-select" name="duration_hours">
				<option value="24">1 day</option><option value="72">3 days</option><option value="168" selected>7 days</option><option value="336">14 days</option><option value="720">30 days</option></select></label>
			<label class="am-radio"><input type="checkbox" name="include_balance" /> Include the wallet balance (otherwise it is swept to you before the handover)</label>
			<label class="am-radio" style="margin-top:8px"><input type="checkbox" name="include_history" checked /> Include memories and activity history (otherwise deleted before the handover)</label>
			<label class="am-field" style="margin-top:12px"><span>Payout address (Solana)</span><input class="am-input am-mono" name="payout_address" autocomplete="off" placeholder="Defaults to your linked Solana wallet" /></label>
			<label class="am-field"><span>Note to buyers (optional)</span><textarea class="am-input" name="note" maxlength="1000"></textarea></label>
			<p class="am-help">Selling rotates the agent to a new wallet key only the buyer holds, revokes your allowlists, delegations and automations, and keeps your past earnings with you.</p>
			<button class="am-btn am-btn--primary" type="submit" ${sellable.length ? '' : 'disabled'}>Review listing</button>
		</form>
	</section>`;
	document.getElementById('am-sell').addEventListener('submit', async (e) => {
		e.preventDefault();
		const f = e.currentTarget;
		const params = { agent_id: f.agent_id.value, min_bid_usdc: f.min_bid_usdc.value.trim(), duration_hours: Number(f.duration_hours.value), include_balance: f.include_balance.checked, include_history: f.include_history.checked };
		for (const k of ['ask_usdc', 'ask_three', 'payout_address', 'note']) if (f[k].value.trim()) params[k] = f[k].value.trim();
		try {
			const r = await confirmThenRun('create_listing', params, 'Confirm listing', () => api('/listings', { method: 'POST', body: { ...params, confirm: true }, anonymous: false }));
			if (r) location.href = r.listing.url;
		} catch (err) { toast(err.message, 'err'); }
	});
}

// ── Router ───────────────────────────────────────────────────────────────────

async function route() {
	const path = location.pathname.replace(/\/+$/, '');
	const m = path.match(/^\/marketplace\/agents\/listing\/([0-9a-f-]{36})$/i);
	try {
		if (m) await renderListing(m[1]);
		else if (path === '/marketplace/agents/dashboard') await renderDashboard();
		else await renderBrowse();
	} catch (err) {
		view.innerHTML = errorStateHTML({ title: 'Something went wrong', body: friendly(err) });
		attachRetry(view, route);
		main.setAttribute('aria-busy', 'false');
	}
}

route();
