// /three-launchpad: the $THREE-quoted bonding-curve lane.
//
// Everything on this page is live data from /api/native-launch/*:
//   GET  config        lane economics, quote mint, whether the on-chain config is pinned
//   GET  launches      coins launched on the lane, newest first
//   GET  pool          one curve's progress and the $THREE it holds
//   GET  quote         a buy (three_in) or sell (tokens_in) quote off the live curve
//   POST swap-prep     unsigned buy/sell transaction for the visitor's own wallet
//   POST launch-prep   unsigned create-pool transaction (signed in, wallet linked)
//   POST launch-confirm
// Metadata is pinned through /api/pump/build-metadata, which the pump.fun lane shares.

import './page.css';
import { Keypair, VersionedTransaction } from '@solana/web3.js';
import {
	walletInstalled,
	connectTradingWallet,
	connectLaunchWallet,
	tokenBalance,
	signAndBroadcast,
	waitForConfirmation,
} from '../launch/launch-wallet.js';

const params = new URLSearchParams(location.search);
const NETWORK = params.get('network') === 'devnet' ? 'devnet' : 'mainnet';
const PAGE_SIZE = 24;
const QUOTE_DEBOUNCE_MS = 300;

const state = {
	lane: null,
	launches: null, // null while loading
	launchesError: '',
	hasMore: false,
	pools: new Map(), // mint -> pool state, or { error }
	selected: params.get('mint'),
	side: 'buy',
	amount: '',
	quote: null,
	wallet: null,
	balances: { three: null, coin: null },
	user: undefined, // undefined while loading, null when signed out
	avatars: [],
	busy: false,
};

const root = document.getElementById('three-launchpad-app');
const $ = (sel, el = root) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n, digits = 0) => (Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: digits }) : '');
const compact = (n) => (Number.isFinite(n) ? Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n) : '');
const short = (a) => (a && a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a || '');
const explorerTx = (sig) => `https://solscan.io/tx/${sig}${NETWORK === 'devnet' ? '?cluster=devnet' : ''}`;
const withNetwork = (path) => `${path}${path.includes('?') ? '&' : '?'}network=${NETWORK}`;

async function api(path, { method = 'GET', body } = {}) {
	const res = await fetch(path, {
		method,
		credentials: 'include',
		headers: body ? { 'content-type': 'application/json' } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw Object.assign(new Error(data?.error_description || data?.error || `Request failed (${res.status})`), {
			code: data?.error,
			status: res.status,
		});
	}
	return data;
}

const selectedCoin = () => state.launches?.find((c) => c.mint === state.selected) || null;

// ── Shell ──────────────────────────────────────────────────────────────────

function renderShell() {
	const lane = state.lane;
	const open = Boolean(lane?.available);
	root.innerHTML = `
		<p class="tl-eyebrow"><span class="tl-dot" data-state="${open ? 'live' : 'pending'}" aria-hidden="true"></span>${open ? '$THREE launchpad · live' : '$THREE launchpad · opening soon'}</p>
		<h1>Every coin here is bought with <em>$THREE</em>.</h1>
		<p class="tl-sub">Launch a coin for your 3D agent on a bonding curve priced in $THREE. There is no SOL pair to route around it: to buy any coin on this lane you hold $THREE first, creators are paid their fees in $THREE, and when a coin graduates, the $THREE it raised is locked in its pool for good.</p>
		<div class="tl-cta">
			<a class="tl-btn tl-btn--primary" href="#tl-launch">Launch a coin</a>
			<a class="tl-btn" href="#tl-coins">Trade the curve</a>
			<a class="tl-btn" href="/three-token">Get $THREE</a>
		</div>

		<dl class="tl-facts" aria-label="Lane economics">
			<div class="tl-fact"><dt>Priced in</dt><dd>$THREE<small>${esc(short(lane?.quote_mint))}</small></dd></div>
			<div class="tl-fact"><dt>Starts at</dt><dd>${compact(lane?.initial_market_cap_three)} $THREE<small>market cap</small></dd></div>
			<div class="tl-fact"><dt>Graduates at</dt><dd>${compact(lane?.migration_market_cap_three)} $THREE<small>about ${compact(lane?.graduation_three_approx)} $THREE raised</small></dd></div>
			<div class="tl-fact"><dt>Trading fee</dt><dd>${(lane?.trade_fee_bps ?? 0) / 100}%<small>${lane?.fee_split?.creator_percent}% to the creator, in $THREE</small></dd></div>
			<div class="tl-fact"><dt>At graduation</dt><dd>${lane?.lp_locked_percent}% locked<small>liquidity can never be pulled</small></dd></div>
		</dl>

		<ol class="tl-loop" aria-label="How the loop works">
			<li><h3>Buying a coin is buying $THREE</h3><p>The curve only accepts $THREE. Every new buyer of every coin on this lane is a $THREE buyer first.</p></li>
			<li><h3>Creators get paid in $THREE</h3><p>${lane?.fee_split?.creator_percent}% of every trade's fee goes to the agent's creator, in $THREE, for as long as the coin trades.</p></li>
			<li><h3>Graduation locks $THREE away</h3><p>A coin that fills its curve moves to a Meteora pool against $THREE with all of its liquidity locked. Roughly ${compact(lane?.graduation_three_approx)} $THREE per graduate, out of circulation.</p></li>
		</ol>

		<section class="tl-section" id="tl-coins" aria-labelledby="tl-coins-h">
			<div class="tl-section-head"><h2 id="tl-coins-h">Coins on the curve</h2><p class="tl-section-note" id="tl-coins-note"></p></div>
			<div id="tl-coins-body"></div>
			<div id="tl-trade-slot"></div>
		</section>

		<section class="tl-section" id="tl-launch" aria-labelledby="tl-launch-h">
			<div class="tl-section-head"><h2 id="tl-launch-h">Launch a coin</h2><p class="tl-section-note">Supply 1B · metadata can never be changed · mint address carries the 3ws mark</p></div>
			<div id="tl-launch-body"></div>
		</section>
	`;
	renderCoins();
	renderLaunch();
}

function laneClosedNotice() {
	return `<div class="tl-notice" role="status"><div><strong>Opening soon.</strong><p>The $THREE curve is built and has been verified against Solana mainnet. Launching and trading open here as soon as its curve settings are published on-chain. Until then, the best preparation is simple: <a href="/three-token">hold $THREE</a> and have an agent ready.</p></div></div>`;
}

// ── Coins ──────────────────────────────────────────────────────────────────

function coinImage(c) {
	const url = c.agent?.avatar_thumbnail_url;
	return url
		? `<img class="tl-card-img" src="${esc(url)}" alt="" loading="lazy" />`
		: `<span class="tl-card-img tl-card-img--blank" aria-hidden="true">${esc((c.symbol || '?').slice(0, 2).toUpperCase())}</span>`;
}

function renderCoins() {
	const body = $('#tl-coins-body');
	const note = $('#tl-coins-note');
	if (!body) return;
	if (state.launchesError) {
		note.textContent = '';
		body.innerHTML = `<div class="tl-notice" data-tone="error" role="alert"><div><strong>Could not load the coins.</strong><p>${esc(state.launchesError)}</p></div></div><div class="tl-more"><button type="button" class="tl-btn" id="tl-retry">Try again</button></div>`;
		$('#tl-retry').addEventListener('click', () => loadLaunches({ reset: true }));
		return;
	}
	if (state.launches === null) {
		note.textContent = '';
		body.innerHTML = `<div class="tl-grid" aria-busy="true" aria-label="Loading coins">${'<div class="tl-skel"></div>'.repeat(6)}</div>`;
		return;
	}
	if (state.launches.length === 0) {
		note.textContent = '';
		body.innerHTML = state.lane?.available
			? `<div class="tl-empty"><b>No coins yet. The first one is yours.</b>Launch a coin for one of your agents below and it will show up here with its live curve.</div>`
			: `<div class="tl-empty"><b>No coins yet.</b>The first coins appear here, with their live curves, the moment the lane opens.</div>`;
		return;
	}

	const onCurve = state.launches.filter((c) => c.status !== 'migrated').length;
	const held = [...state.pools.values()].reduce((sum, p) => sum + (p?.migrated ? 0 : p?.quote_reserve_three || 0), 0);
	note.textContent = `${state.launches.length} launched · ${onCurve} on the curve${held > 0 ? ` · ${compact(held)} $THREE held in curves` : ''}`;

	body.innerHTML = `<div class="tl-grid">${state.launches
		.map((c) => {
			const pool = state.pools.get(c.mint);
			const pct = pool?.migrated ? 100 : Math.round((pool?.curve_progress || 0) * 100);
			const raised = pool?.error ? 'unavailable' : pool ? `${compact(pool.quote_reserve_three)} $THREE` : 'reading…';
			return `<button type="button" class="tl-card" data-mint="${esc(c.mint)}" aria-pressed="${c.mint === state.selected}">
				<span class="tl-card-top">${coinImage(c)}<span class="tl-card-name"><b>${esc(c.name || 'Unnamed')}</b><span>$${esc(c.symbol || '')}${c.agent?.name ? ` · ${esc(c.agent.name)}` : ''}</span></span></span>
				<span class="tl-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Curve progress"><i style="width:${pct}%"></i></span>
				<span class="tl-card-meta"><span>${pool?.migrated ? 'Graduated' : `${pct}% to graduation`}</span><b>${esc(raised)}</b></span>
			</button>`;
		})
		.join('')}</div>${state.hasMore ? '<div class="tl-more"><button type="button" class="tl-btn" id="tl-more">Show more</button></div>' : ''}`;

	body.querySelectorAll('.tl-card').forEach((el) => el.addEventListener('click', () => selectCoin(el.dataset.mint)));
	$('#tl-more')?.addEventListener('click', () => loadLaunches());
}

async function loadLaunches({ reset = false } = {}) {
	if (reset) {
		state.launches = null;
		state.launchesError = '';
		renderCoins();
	}
	try {
		const offset = reset || !state.launches ? 0 : state.launches.length;
		const { data } = await api(withNetwork(`/api/native-launch/launches?limit=${PAGE_SIZE}&offset=${offset}`));
		state.launches = [...(offset ? state.launches : []), ...data.launches];
		state.hasMore = data.has_more;
		renderCoins();
		await Promise.all(data.launches.map((c) => loadPool(c.mint)));
		renderCoins();
		if (state.selected && selectedCoin()) renderTrade();
	} catch (err) {
		state.launchesError = /failed to fetch/i.test(err.message) ? 'three.ws could not be reached. Check your connection.' : err.message;
		if (!state.launches) state.launches = [];
		renderCoins();
	}
}

async function loadPool(mint) {
	try {
		state.pools.set(mint, await api(withNetwork(`/api/native-launch/pool?mint=${mint}`)));
	} catch (err) {
		state.pools.set(mint, { error: err.message });
	}
}

// ── Trade ──────────────────────────────────────────────────────────────────

function selectCoin(mint) {
	state.selected = state.selected === mint ? null : mint;
	state.amount = '';
	state.quote = null;
	const url = new URL(location.href);
	if (state.selected) url.searchParams.set('mint', state.selected);
	else url.searchParams.delete('mint');
	history.replaceState(null, '', url);
	renderCoins();
	renderTrade();
	if (state.selected) {
		refreshBalances();
		$('#tl-trade-slot').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	}
}

function renderTrade() {
	const slot = $('#tl-trade-slot');
	const coin = selectedCoin();
	if (!slot) return;
	if (!coin) {
		slot.innerHTML = '';
		return;
	}
	const pool = state.pools.get(coin.mint);
	const graduated = Boolean(pool?.migrated);
	const buying = state.side === 'buy';
	const chips = buying
		? [10_000, 50_000, 250_000, 1_000_000].map((v) => `<button type="button" class="tl-chip" data-amount="${v}">${compact(v)}</button>`).join('')
		: [25, 50, 100].map((v) => `<button type="button" class="tl-chip" data-percent="${v}">${v}%</button>`).join('');
	const balance = buying ? state.balances.three : state.balances.coin;

	slot.innerHTML = `<div class="tl-trade">
		<div class="tl-panel">
			<h3>${esc(coin.name || 'Unnamed')} <span style="color:var(--ink-dim);font-weight:500">$${esc(coin.symbol || '')}</span></h3>
			<p class="tl-trade-sub">${esc(coin.mint)}</p>
			<span class="tl-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round((pool?.curve_progress || 0) * 100)}" aria-label="Curve progress"><i style="width:${graduated ? 100 : Math.round((pool?.curve_progress || 0) * 100)}%"></i></span>
			<dl class="tl-kv">
				<dt>$THREE in the curve</dt><dd>${pool?.error ? 'unavailable' : pool ? fmt(pool.quote_reserve_three) : 'reading…'}</dd>
				<dt>Graduates at</dt><dd>${pool?.migration_quote_threshold_three ? `${fmt(pool.migration_quote_threshold_three)} $THREE` : ''}</dd>
				<dt>Creator</dt><dd>${esc(short(pool?.creator))}</dd>
				${coin.agent ? `<dt>Agent</dt><dd><a href="${esc(coin.agent.url)}">${esc(coin.agent.name || 'View agent')}</a></dd>` : ''}
			</dl>
		</div>
		<div class="tl-panel">
			${
				graduated
					? `<div class="tl-notice" role="status"><div><strong>This coin graduated.</strong><p>Its curve is closed and its $THREE is locked in a Meteora pool. It now trades against $THREE on any Solana DEX aggregator.</p></div></div>`
					: `<div class="tl-seg" role="tablist" aria-label="Trade side">
				<button type="button" role="tab" data-side="buy" aria-selected="${buying}">Buy</button>
				<button type="button" role="tab" data-side="sell" aria-selected="${!buying}">Sell</button>
			</div>
			<label class="tl-field"><span><span>${buying ? 'You pay ($THREE)' : `You sell ($${esc(coin.symbol || 'tokens')})`}</span><span id="tl-balance">${balance == null ? '' : `Balance ${fmt(balance, 2)}`}</span></span>
				<input id="tl-amount" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(state.amount)}" aria-describedby="tl-quote" /></label>
			<div class="tl-chips">${chips}</div>
			<p class="tl-quote" id="tl-quote" aria-live="polite"></p>
			<button type="button" class="tl-btn tl-btn--block ${buying ? 'tl-btn--primary' : 'tl-btn--sell'}" id="tl-swap"></button>
			<p class="tl-status" id="tl-trade-status" aria-live="polite"></p>`
			}
		</div>
	</div>`;
	if (graduated) return;

	slot.querySelectorAll('[data-side]').forEach((b) =>
		b.addEventListener('click', () => {
			state.side = b.dataset.side;
			state.amount = '';
			state.quote = null;
			renderTrade();
		}),
	);
	const input = $('#tl-amount');
	input.addEventListener('input', () => {
		state.amount = input.value.replace(/[^0-9.]/g, '');
		scheduleQuote();
	});
	slot.querySelectorAll('[data-amount]').forEach((b) => b.addEventListener('click', () => setAmount(Number(b.dataset.amount))));
	slot.querySelectorAll('[data-percent]').forEach((b) =>
		b.addEventListener('click', () => setAmount(Math.floor(((state.balances.coin || 0) * Number(b.dataset.percent)) / 100))),
	);
	$('#tl-swap').addEventListener('click', onSwapClick);
	renderQuote();
}

function setAmount(value) {
	state.amount = value > 0 ? String(value) : '';
	const input = $('#tl-amount');
	if (input) input.value = state.amount;
	scheduleQuote();
}

let quoteTimer = null;
let quoteSeq = 0;
function scheduleQuote() {
	clearTimeout(quoteTimer);
	state.quote = null;
	renderQuote();
	const amount = Number(state.amount);
	if (!(amount > 0)) return;
	quoteTimer = setTimeout(async () => {
		const seq = ++quoteSeq;
		const key = state.side === 'buy' ? 'three_in' : 'tokens_in';
		try {
			const quote = await api(withNetwork(`/api/native-launch/quote?mint=${state.selected}&${key}=${amount}`));
			if (seq === quoteSeq) state.quote = quote;
		} catch (err) {
			if (seq === quoteSeq) state.quote = { error: err.message };
		}
		if (seq === quoteSeq) renderQuote();
	}, QUOTE_DEBOUNCE_MS);
}

function renderQuote() {
	const el = $('#tl-quote');
	const btn = $('#tl-swap');
	if (!el || !btn) return;
	const coin = selectedCoin();
	const amount = Number(state.amount);
	const buying = state.side === 'buy';
	const q = state.quote;

	if (!(amount > 0)) el.textContent = buying ? 'Enter how much $THREE to spend.' : 'Enter how many tokens to sell.';
	else if (!q) el.textContent = 'Reading the curve…';
	else if (q.error) el.textContent = `No quote: ${q.error}`;
	else if (buying) el.innerHTML = `You receive about <b>${fmt(q.tokens_out, 2)} $${esc(coin.symbol || '')}</b>, at least ${fmt(q.min_tokens_out, 2)} after ${q.slippage_bps / 100}% slippage. Fee ${fmt(q.trading_fee_three, 2)} $THREE.`;
	else el.innerHTML = `You receive about <b>${fmt(q.three_out, 2)} $THREE</b>, at least ${fmt(q.min_three_out, 2)} after ${q.slippage_bps / 100}% slippage. Fee ${fmt(q.trading_fee_three, 2)} $THREE.`;

	const balance = buying ? state.balances.three : state.balances.coin;
	const short_ = state.wallet && balance != null && amount > balance;
	btn.disabled = state.busy || (state.wallet && (!(amount > 0) || !q || Boolean(q.error) || short_));
	if (!walletInstalled()) btn.textContent = 'Install a Solana wallet';
	else if (!state.wallet) btn.textContent = 'Connect wallet';
	else if (state.busy) btn.textContent = 'Working…';
	else if (short_) btn.textContent = buying ? 'Not enough $THREE' : 'Not enough tokens';
	else btn.textContent = buying ? 'Buy with $THREE' : 'Sell for $THREE';

	const status = $('#tl-trade-status');
	if (status && short_ && buying && !state.busy) {
		status.dataset.tone = '';
		status.innerHTML = `This wallet holds ${fmt(balance, 2)} $THREE. <a href="/three-token">Get $THREE</a>, then come back.`;
	}
}

function setStatus(id, html, tone = '') {
	const el = $(id);
	if (!el) return;
	el.dataset.tone = tone;
	el.innerHTML = html;
}

async function refreshBalances() {
	if (!state.wallet || !state.lane?.quote_mint) return;
	const mint = state.selected;
	try {
		const [three, coin] = await Promise.all([
			tokenBalance(state.wallet.address, state.lane.quote_mint),
			mint ? tokenBalance(state.wallet.address, mint) : Promise.resolve(null),
		]);
		if (mint !== state.selected) return;
		state.balances = { three, coin };
	} catch {
		state.balances = { three: null, coin: null };
	}
	const el = $('#tl-balance');
	const balance = state.side === 'buy' ? state.balances.three : state.balances.coin;
	if (el) el.textContent = balance == null ? '' : `Balance ${fmt(balance, 2)}`;
	renderQuote();
}

async function onSwapClick() {
	if (!walletInstalled()) {
		window.open('https://phantom.com/download', '_blank', 'noopener');
		return;
	}
	if (!state.wallet) {
		try {
			state.wallet = await connectTradingWallet();
			await refreshBalances();
		} catch (err) {
			setStatus('#tl-trade-status', esc(err.message), 'error');
		}
		renderQuote();
		return;
	}
	const mint = state.selected;
	const side = state.side;
	state.busy = true;
	renderQuote();
	setStatus('#tl-trade-status', 'Building the transaction…');
	try {
		const prep = await api('/api/native-launch/swap-prep', {
			method: 'POST',
			body: { mint, wallet_address: state.wallet.address, side, amount: Number(state.amount), network: NETWORK },
		});
		setStatus('#tl-trade-status', 'Approve it in your wallet…');
		const signature = await signAndBroadcast({ txBase64: prep.tx_base64, version: 0, address: state.wallet.address });
		setStatus('#tl-trade-status', `Sent. Waiting for confirmation… <a href="${explorerTx(signature)}" target="_blank" rel="noopener">view</a>`);
		const confirmed = await waitForConfirmation(signature);
		setStatus(
			'#tl-trade-status',
			`${confirmed ? (side === 'buy' ? 'Bought.' : 'Sold.') : 'Sent, still confirming.'} <a href="${explorerTx(signature)}" target="_blank" rel="noopener">View transaction</a>`,
			confirmed ? 'ok' : '',
		);
		state.amount = '';
		state.quote = null;
		const input = $('#tl-amount');
		if (input) input.value = '';
		await Promise.all([loadPool(mint), refreshBalances()]);
		renderCoins();
	} catch (err) {
		setStatus('#tl-trade-status', esc(err.code === 'USER_REJECTED' ? 'You cancelled the signature. Nothing was sent.' : err.message), 'error');
	} finally {
		state.busy = false;
		renderQuote();
	}
}

// ── Launch ─────────────────────────────────────────────────────────────────

function renderLaunch() {
	const body = $('#tl-launch-body');
	if (!body) return;
	if (!state.lane?.available) {
		body.innerHTML = laneClosedNotice();
		return;
	}
	if (state.user === undefined) {
		body.innerHTML = '<div class="tl-skel" aria-busy="true"></div>';
		return;
	}
	const next = encodeURIComponent(`${location.pathname}${location.search}#tl-launch`);
	if (!state.user) {
		body.innerHTML = `<div class="tl-empty"><b>Sign in to launch.</b>Every coin on three.ws belongs to a 3D agent, so launching starts from your account.<div class="tl-cta" style="justify-content:center"><a class="tl-btn tl-btn--primary" href="/login?next=${next}">Sign in</a><a class="tl-btn" href="/create-agent">Create an agent</a></div></div>`;
		return;
	}
	if (state.avatars.length === 0) {
		body.innerHTML = `<div class="tl-empty"><b>You need an agent first.</b>A coin here is tied to one of your 3D agents. Creating one takes about a minute.<div class="tl-cta" style="justify-content:center"><a class="tl-btn tl-btn--primary" href="/create-agent">Create an agent</a></div></div>`;
		return;
	}
	body.innerHTML = `<form class="tl-panel tl-form" id="tl-form" novalidate>
		<label class="tl-field tl-span"><span><span>Agent</span></span><select name="avatar" required>${state.avatars.map((a) => `<option value="${esc(a.id)}">${esc(a.name || a.slug || 'Untitled agent')}</option>`).join('')}</select></label>
		<label class="tl-field"><span><span>Coin name</span><span>max 32</span></span><input name="name" maxlength="32" required autocomplete="off" placeholder="Nova" /></label>
		<label class="tl-field"><span><span>Ticker</span><span>max 10</span></span><input name="symbol" maxlength="10" required autocomplete="off" placeholder="NOVA" /></label>
		<label class="tl-field tl-span"><span><span>Description</span><span>optional</span></span><textarea name="description" maxlength="500" placeholder="What this agent does and why its coin exists."></textarea></label>
		<label class="tl-field tl-span"><span><span>Your first buy, in $THREE</span><span>optional, fills the start of your own curve</span></span><input name="buy" inputmode="decimal" autocomplete="off" placeholder="0" /></label>
		<div class="tl-span" style="margin-top:18px"><button type="submit" class="tl-btn tl-btn--primary tl-btn--block" id="tl-launch-btn">Launch on the $THREE curve</button><p class="tl-status" id="tl-launch-status" aria-live="polite"></p></div>
	</form>`;
	const form = $('#tl-form');
	form.symbol.addEventListener('input', () => (form.symbol.value = form.symbol.value.toUpperCase().replace(/[^A-Z0-9]/g, '')));
	form.buy.addEventListener('input', () => (form.buy.value = form.buy.value.replace(/[^0-9.]/g, '')));
	form.addEventListener('submit', onLaunchSubmit);
}

function fromBase64(b64) {
	return Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
}
function toBase64(bytes) {
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin);
}

async function onLaunchSubmit(event) {
	event.preventDefault();
	const form = event.currentTarget;
	const name = form.name.value.trim();
	const symbol = form.symbol.value.trim();
	if (!name || !symbol) {
		setStatus('#tl-launch-status', 'Give the coin a name and a ticker.', 'error');
		(name ? form.symbol : form.name).focus();
		return;
	}
	const avatar = state.avatars.find((a) => a.id === form.avatar.value);
	const threeBuyIn = Number(form.buy.value) || 0;
	const btn = $('#tl-launch-btn');
	btn.disabled = true;
	const say = (text, tone) => setStatus('#tl-launch-status', text, tone);
	try {
		say('Connecting your wallet…');
		const wallet = await connectLaunchWallet();
		state.wallet = { address: wallet.address, name: wallet.name };
		if (threeBuyIn > 0) {
			const held = await tokenBalance(wallet.address, state.lane.quote_mint);
			if (held < threeBuyIn) {
				say(`This wallet holds ${fmt(held, 2)} $THREE, less than your ${fmt(threeBuyIn)} $THREE first buy. <a href="/three-token">Get $THREE</a> or lower the first buy.`, 'error');
				return;
			}
		}
		say('Pinning the coin metadata…');
		const meta = await api('/api/pump/build-metadata', {
			method: 'POST',
			body: {
				name,
				symbol,
				description: form.description.value.trim(),
				avatar_id: avatar.id,
				...(avatar.agent_id ? { agent_id: avatar.agent_id } : {}),
			},
		});
		say('Building the launch transaction…');
		const prep = await api('/api/native-launch/launch-prep', {
			method: 'POST',
			body: {
				avatar_id: avatar.id,
				...(avatar.agent_id ? { agent_id: avatar.agent_id } : {}),
				wallet_address: wallet.address,
				name,
				symbol,
				uri: meta.metadata_url,
				network: NETWORK,
				three_buy_in: threeBuyIn,
			},
		});
		// The new mint has to sign its own creation. The server ground its address and
		// handed back the key for exactly this; the wallet signs after it.
		const tx = VersionedTransaction.deserialize(fromBase64(prep.tx_base64));
		tx.sign([Keypair.fromSecretKey(fromBase64(prep.mint_secret_key_b64))]);
		say('Approve the launch in your wallet…');
		const signature = await signAndBroadcast({ txBase64: toBase64(tx.serialize()), version: 0, address: wallet.address });
		say(`Sent. Waiting for confirmation… <a href="${explorerTx(signature)}" target="_blank" rel="noopener">view</a>`);
		await waitForConfirmation(signature);
		await api('/api/native-launch/launch-confirm', { method: 'POST', body: { prep_id: prep.prep_id, tx_signature: signature } });
		say(`Launched. <a href="${explorerTx(signature)}" target="_blank" rel="noopener">View transaction</a>`, 'ok');
		form.reset();
		state.selected = prep.mint;
		await loadLaunches({ reset: true });
		renderTrade();
		$('#tl-coins').scrollIntoView({ behavior: 'smooth' });
	} catch (err) {
		say(esc(err.code === 'USER_REJECTED' ? 'You cancelled the signature. Nothing was launched.' : err.message), 'error');
	} finally {
		btn.disabled = false;
	}
}

async function loadIdentity() {
	try {
		const me = await fetch('/api/auth/me', { credentials: 'include' });
		state.user = me.ok ? (await me.json()).user || null : null;
		if (state.user) state.avatars = (await api('/api/avatars?limit=100')).avatars || [];
	} catch {
		state.user = null;
	}
	renderLaunch();
}

// ── Boot ───────────────────────────────────────────────────────────────────

async function boot() {
	try {
		state.lane = await api(withNetwork('/api/native-launch/config'));
	} catch (err) {
		root.innerHTML = `<div class="tl-notice" data-tone="error" role="alert"><div><strong>The launchpad could not load.</strong><p>${esc(err.message)}</p></div></div><div class="tl-more"><button type="button" class="tl-btn" id="tl-reload">Try again</button></div>`;
		$('#tl-reload').addEventListener('click', boot);
		return;
	}
	renderShell();
	loadLaunches({ reset: true });
	loadIdentity();
	connectTradingWallet({ silent: true }).then((wallet) => {
		if (!wallet) return;
		state.wallet = wallet;
		refreshBalances();
	});
}

boot();
