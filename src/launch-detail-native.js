// /launches/<mint> for a coin launched on the native $THREE bonding-curve lane.
//
// src/launch-detail.js hands a mint here when GET /api/native-launch/launches?mint=
// finds it. Pump coins never reach this file. Everything shown is read live:
//
//   GET  /api/native-launch/launches?mint=  the launch row, its agent and creator
//   GET  /api/native-launch/pool            curve progress, reserve, graduation threshold
//   GET  /api/native-launch/quote           spot price and the $THREE buy / sell quote
//   GET  /api/native-launch/trades          recent swaps parsed from chain
//   GET  /api/native-launch/config          the fee schedule the lane launched under
//   POST /api/native-launch/swap-prep       unsigned buy / sell, from $THREE or from SOL
//
// The visitor's own wallet signs; nothing here holds a key.

import './launch-detail-native.css';
import {
	walletInstalled,
	connectTradingWallet,
	tokenBalance,
	solBalance,
	signAndBroadcast,
	waitForConfirmation,
} from './launch/launch-wallet.js';

const QUOTE_DEBOUNCE_MS = 300;
const PREP_MAX_AGE_MS = 45_000; // a built transaction carries a blockhash that expires
const TRADES_POLL_MS = 15_000;

const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: d }) : '-');
const compact = (n) => (Number.isFinite(n) ? Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n) : '-');
const short = (a) => (a && a.length > 10 ? `${a.slice(0, 4)}...${a.slice(-4)}` : a || '');

function el(tag, props = {}, children = []) {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(props)) {
		if (v == null || v === false) continue;
		if (k === 'class') node.className = v;
		else if (k === 'text') node.textContent = v;
		else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
		else node.setAttribute(k, v === true ? '' : v);
	}
	for (const c of [].concat(children)) {
		if (c == null || c === false) continue;
		node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
	}
	return node;
}

async function api(path, { method = 'GET', body } = {}) {
	const res = await fetch(path, {
		method,
		credentials: 'include',
		headers: body ? { 'content-type': 'application/json' } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw Object.assign(new Error(data.error_description || data.message || `Request failed (${res.status})`), { code: data.error });
	}
	return data;
}

export function mountNativeCoin({ mint, network, launch }) {
	const shell = document.getElementById('ld-shell');
	shell.querySelectorAll('.ld-section, .ld-hero, .ld-body').forEach((n) => (n.hidden = true));
	document.getElementById('ld-state')?.replaceChildren();
	document.title = `$${launch.symbol} ${launch.name} · three.ws`;
	const qn = (p) => `${p}${p.includes('?') ? '&' : '?'}network=${network}`;
	const explorer = (sig) => `https://solscan.io/tx/${sig}${network === 'devnet' ? '?cluster=devnet' : ''}`;

	const s = {
		lane: null,
		pool: null,
		price: null, // $THREE per token, from the live buy quote
		trades: null, // null while loading
		tradesError: '',
		side: 'buy',
		payWith: network === 'devnet' ? 'three' : 'sol',
		amount: '',
		quote: null, // /quote answer for the $THREE path, or a SOL prep
		quoteAt: 0,
		wallet: null,
		balances: { sol: null, three: null, coin: null },
		busy: false,
	};

	const root = el('div', { class: 'ldn', id: 'ldn-root' });
	shell.appendChild(root);

	const hero = el('section', { class: 'ld-hero ld-revealed ldn-hero', 'aria-label': 'Coin overview' });
	const curve = el('section', { class: 'ld-section ld-revealed ldn-panel', 'aria-label': 'Bonding curve' });
	const tradesSec = el('section', { class: 'ld-section ld-revealed ldn-panel', 'aria-label': 'Recent trades' });
	const tradeSec = el('section', { class: 'ld-section ld-revealed ldn-panel', 'aria-label': 'Trade' });
	const agentSec = el('section', { class: 'ld-section ld-revealed ldn-panel', 'aria-label': 'The agent behind this coin' });
	const feesSec = el('section', { class: 'ld-section ld-revealed ldn-panel', 'aria-label': 'Fees' });
	root.append(
		hero,
		el('div', { class: 'ldn-grid' }, [
			el('div', { class: 'ldn-col' }, [curve, tradesSec]),
			el('div', { class: 'ldn-col' }, [tradeSec, agentSec, feesSec]),
		]),
	);

	// ── hero ────────────────────────────────────────────────────────────────
	function skeleton(h) {
		return el('div', { class: 'ld-skel', style: `height:${h}px`, 'aria-hidden': 'true' });
	}

	function renderHero() {
		const mcap = s.price != null ? s.price * (s.lane?.total_supply ?? 0) : null;
		const thumb = launch.agent?.avatar_thumbnail_url;
		hero.replaceChildren(
			el('div', { class: 'ldn-id' }, [
				thumb
					? el('img', { class: 'ldn-thumb', src: thumb, alt: '', width: '72', height: '72' })
					: el('div', { class: 'ldn-thumb ldn-thumb--empty', 'aria-hidden': 'true', text: (launch.symbol || '?').slice(0, 1) }),
				el('div', {}, [
					el('h1', { class: 'ldn-title', text: launch.name }),
					el('p', { class: 'ldn-sub' }, [
						el('span', { class: 'ldn-sym', text: `$${launch.symbol}` }),
						el('span', { class: 'ldn-tag', text: network === 'devnet' ? 'Devnet' : 'Native curve' }),
						launch.status === 'migrated' || s.pool?.migrated ? el('span', { class: 'ldn-tag ldn-tag--ok', text: 'Graduated' }) : null,
					]),
				]),
			]),
			el('dl', { class: 'ldn-stats' }, [
				stat('Price', s.price != null ? `${fmt(s.price, 6)} $THREE` : null),
				stat('Market cap', mcap != null ? `${compact(mcap)} $THREE` : null),
				stat('Curve filled', s.pool ? `${fmt(s.pool.curve_progress * 100, 1)}%` : null),
				stat('$THREE in curve', s.pool ? compact(s.pool.quote_reserve_three) : null),
			]),
			el('div', { class: 'ldn-links' }, [
				el('a', { class: 'ld-btn ld-btn-sm ld-btn-ghost', href: `https://solscan.io/token/${mint}${network === 'devnet' ? '?cluster=devnet' : ''}`, target: '_blank', rel: 'noopener', text: 'Explorer' }),
				el('button', { class: 'ld-btn ld-btn-sm ld-btn-ghost', type: 'button', text: 'Copy mint', onclick: copyMint }),
				el('a', { class: 'ld-btn ld-btn-sm ld-btn-ghost', href: '/three-launchpad', text: 'Launchpad' }),
			]),
		);
	}

	function stat(label, value) {
		return el('div', { class: 'ldn-stat' }, [
			el('dt', { text: label }),
			value == null ? el('dd', {}, [skeleton(20)]) : el('dd', { text: value }),
		]);
	}

	async function copyMint(e) {
		const btn = e.currentTarget;
		try {
			await navigator.clipboard.writeText(mint);
			btn.textContent = 'Copied';
		} catch {
			btn.textContent = short(mint);
		}
		setTimeout(() => (btn.textContent = 'Copy mint'), 1600);
	}

	// ── curve ───────────────────────────────────────────────────────────────
	function renderCurve() {
		const p = s.pool;
		if (p?.error) {
			curve.replaceChildren(sectionHead('Bonding curve'), errorBlock(p.error, loadPool));
			return;
		}
		if (!p) {
			curve.replaceChildren(sectionHead('Bonding curve'), skeleton(14), skeleton(64));
			return;
		}
		const pct = Math.max(0, Math.min(1, p.curve_progress)) * 100;
		curve.replaceChildren(
			sectionHead('Bonding curve'),
			el('div', { class: 'ldn-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(pct)), 'aria-label': 'Progress toward graduation' }, [
				el('div', { class: 'ldn-bar-fill', style: `width:${pct}%` }),
			]),
			el('p', { class: 'ldn-note' }, [
				p.migrated
					? 'This coin graduated. Trading continues on its Meteora pool against $THREE.'
					: `${fmt(pct, 1)}% of the way to graduation. At ${compact(p.migration_quote_threshold_three)} $THREE in the curve it moves to a Meteora pool with the liquidity locked.`,
			]),
		);
	}

	function sectionHead(title, right) {
		return el('div', { class: 'ld-sec-head' }, [el('h2', { class: 'ld-sec-title', text: title }), right || null]);
	}

	function errorBlock(message, retry) {
		return el('div', { class: 'ldn-error', role: 'alert' }, [
			el('p', { text: message }),
			el('button', { class: 'ld-btn ld-btn-sm', type: 'button', text: 'Retry', onclick: retry }),
		]);
	}

	// ── agent + fees ────────────────────────────────────────────────────────
	function renderAgent() {
		const a = launch.agent;
		agentSec.replaceChildren(
			sectionHead('The agent'),
			a
				? el('div', { class: 'ldn-agent' }, [
						a.avatar_thumbnail_url ? el('img', { class: 'ldn-thumb ldn-thumb--sm', src: a.avatar_thumbnail_url, alt: '', width: '48', height: '48' }) : null,
						el('div', {}, [
							el('a', { class: 'ldn-agent-name', href: a.url, text: a.name || 'Agent' }),
							launch.creator_address ? el('p', { class: 'ldn-note', text: `Creator ${short(launch.creator_address)}` }) : null,
						]),
					])
				: el('p', { class: 'ldn-note', text: 'No agent is linked to this coin.' }),
		);
	}

	function renderFees() {
		const lane = s.lane;
		if (!lane) {
			feesSec.replaceChildren(sectionHead('Fees'), skeleton(60));
			return;
		}
		feesSec.replaceChildren(
			sectionHead('Fees'),
			el('p', { class: 'ldn-note', text: lane.fee_schedule_preview || `${lane.trade_fee_bps / 100}% per trade.` }),
			el('p', { class: 'ldn-note', text: `${lane.fee_split.creator_percent}% of the trading fee goes to the coin's creator, ${lane.fee_split.platform_percent}% to three.ws.` }),
		);
	}

	// ── trades ──────────────────────────────────────────────────────────────
	function renderTrades() {
		const head = sectionHead('Recent trades', el('button', { class: 'ld-btn ld-btn-sm ld-btn-ghost', type: 'button', text: 'Refresh', onclick: loadTrades }));
		if (s.tradesError) {
			tradesSec.replaceChildren(head, errorBlock(s.tradesError, loadTrades));
			return;
		}
		if (s.trades == null) {
			tradesSec.replaceChildren(head, skeleton(28), skeleton(28), skeleton(28));
			return;
		}
		if (!s.trades.length) {
			tradesSec.replaceChildren(
				head,
				el('div', { class: 'ld-empty' }, [
					el('p', { class: 'ld-empty-title', text: 'No trades yet' }),
					el('p', { text: 'Be the first to buy. The first trade sets the price on the curve.' }),
					el('button', { class: 'ld-btn ld-btn-primary', type: 'button', text: 'Buy now', onclick: () => document.getElementById('ldn-amount')?.focus() }),
				]),
			);
			return;
		}
		const rows = s.trades.map((t) =>
			el('li', { class: `ldn-trade ldn-trade--${t.side}` }, [
				el('span', { class: 'ldn-trade-side', text: t.side === 'buy' ? 'Buy' : 'Sell' }),
				el('span', { class: 'ldn-trade-amt', text: `${compact(t.tokens)} $${launch.symbol}` }),
				el('span', { class: 'ldn-trade-three', text: `${fmt(t.three)} $THREE` }),
				el('a', { class: 'ldn-trade-time', href: explorer(t.signature), target: '_blank', rel: 'noopener', text: ago(t.time) }),
			]),
		);
		tradesSec.replaceChildren(head, el('ul', { class: 'ldn-trades' }, rows));
	}

	function ago(unix) {
		if (!unix) return 'view';
		const sec = Math.max(0, Math.round(Date.now() / 1000 - unix));
		if (sec < 60) return `${sec}s ago`;
		if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
		if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
		return `${Math.floor(sec / 86400)}d ago`;
	}

	// ── trade panel ─────────────────────────────────────────────────────────
	const inputUnit = () => (s.side === 'sell' ? `$${launch.symbol}` : s.payWith === 'sol' ? 'SOL' : '$THREE');

	function renderTrade() {
		if (s.lane && !s.lane.available) {
			tradeSec.replaceChildren(
				sectionHead('Trade'),
				el('p', { class: 'ldn-note', text: `The native launchpad is not deployed on ${network} yet, so this coin cannot be traded here.` }),
			);
			return;
		}
		const buying = s.side === 'buy';
		const tab = (side, label) =>
			el('button', { class: 'ldn-tab', type: 'button', role: 'tab', 'aria-selected': String(s.side === side), text: label, onclick: () => setSide(side) });
		const pay = (id, label) =>
			el('button', { class: 'ldn-chip', type: 'button', 'aria-pressed': String(s.payWith === id), text: label, onclick: () => setPay(id) });

		const input = el('input', {
			id: 'ldn-amount',
			class: 'ldn-input',
			inputmode: 'decimal',
			autocomplete: 'off',
			placeholder: '0',
			value: s.amount,
			'aria-label': `Amount in ${inputUnit()}`,
			oninput: (e) => {
				s.amount = e.target.value.replace(/[^0-9.]/g, '');
				scheduleQuote();
			},
		});
		tradeSec.replaceChildren(
			sectionHead('Trade'),
			el('div', { class: 'ldn-tabs', role: 'tablist' }, [tab('buy', 'Buy'), tab('sell', 'Sell')]),
			buying && network === 'mainnet' ? el('div', { class: 'ldn-chips', role: 'group', 'aria-label': 'Pay with' }, [pay('sol', 'Pay with SOL'), pay('three', 'Pay with $THREE')]) : null,
			el('label', { class: 'ldn-field' }, [
				el('span', { class: 'ldn-field-row' }, [el('span', { text: `You ${buying ? 'pay' : 'sell'} (${inputUnit()})` }), el('span', { id: 'ldn-balance', class: 'ldn-balance' })]),
				input,
			]),
			el('div', { id: 'ldn-quote', class: 'ldn-quote', 'aria-live': 'polite' }),
			el('button', { id: 'ldn-go', class: 'ld-btn ld-btn-primary ld-btn-block', type: 'button', onclick: onGo }),
			el('p', { id: 'ldn-status', class: 'ldn-status', 'aria-live': 'polite' }),
		);
		paintBalance();
		paintQuote();
	}

	function setSide(side) {
		if (s.side === side) return;
		s.side = side;
		s.amount = '';
		s.quote = null;
		renderTrade();
	}

	function setPay(id) {
		if (s.payWith === id) return;
		s.payWith = id;
		s.amount = '';
		s.quote = null;
		renderTrade();
	}

	let quoteTimer = 0;
	let quoteSeq = 0;
	function scheduleQuote() {
		clearTimeout(quoteTimer);
		s.quote = null;
		paintQuote();
		const amount = Number(s.amount);
		if (!(amount > 0)) return;
		const solPath = s.side === 'buy' && s.payWith === 'sol';
		if (solPath && !s.wallet) return;
		quoteTimer = setTimeout(async () => {
			const seq = ++quoteSeq;
			try {
				const q = solPath
					? await api('/api/native-launch/swap-prep', {
							method: 'POST',
							body: { mint, wallet_address: s.wallet.address, side: 'buy', pay_with: 'sol', amount, network },
						})
					: await api(qn(`/api/native-launch/quote?mint=${mint}&${s.side === 'buy' ? 'three_in' : 'tokens_in'}=${amount}`));
				if (seq === quoteSeq) {
					s.quote = q;
					s.quoteAt = Date.now();
				}
			} catch (err) {
				if (seq === quoteSeq) s.quote = { error: err.message };
			}
			if (seq === quoteSeq) paintQuote();
		}, QUOTE_DEBOUNCE_MS);
	}

	function paintBalance() {
		const el_ = document.getElementById('ldn-balance');
		if (!el_) return;
		const v = s.side === 'sell' ? s.balances.coin : s.payWith === 'sol' ? s.balances.sol : s.balances.three;
		el_.textContent = v == null ? '' : `Balance ${fmt(v, 4)}`;
	}

	function currentBalance() {
		return s.side === 'sell' ? s.balances.coin : s.payWith === 'sol' ? s.balances.sol : s.balances.three;
	}

	function paintQuote() {
		const box = document.getElementById('ldn-quote');
		const btn = document.getElementById('ldn-go');
		if (!box || !btn) return;
		const q = s.quote;
		const amount = Number(s.amount);
		const buying = s.side === 'buy';
		const solPath = buying && s.payWith === 'sol';
		box.replaceChildren();
		const line = (k, v) => box.appendChild(el('div', { class: 'ldn-line' }, [el('span', { text: k }), el('b', { text: v })]));
		if (!(amount > 0)) box.appendChild(el('p', { class: 'ldn-note', text: buying ? `Enter how much ${inputUnit()} to spend.` : 'Enter how many tokens to sell.' }));
		else if (solPath && !s.wallet) box.appendChild(el('p', { class: 'ldn-note', text: 'Connect a wallet to see your exact total.' }));
		else if (!q) box.appendChild(skeleton(72));
		else if (q.error) box.appendChild(errorBlock(q.error, scheduleQuote));
		else if (solPath) {
			line('You pay', `${fmt(q.sol_in, 4)} SOL`);
			line('Swapped to about', `${fmt(q.three_expected)} $THREE`);
			line('You receive about', `${fmt(q.expected_out)} $${launch.symbol}`);
			line(`At least (${(q.slippage_bps ?? 100) / 100}% slippage)`, `${fmt(q.min_out)} $${launch.symbol}`);
			box.appendChild(el('p', { class: 'ldn-note', text: 'One transaction: SOL to $THREE through Jupiter, then $THREE into the curve. Fees: Jupiter route cost plus the curve trading fee.' }));
		} else if (buying) {
			line('You receive about', `${fmt(q.tokens_out)} $${launch.symbol}`);
			line(`At least (${q.slippage_bps / 100}% slippage)`, `${fmt(q.min_tokens_out)} $${launch.symbol}`);
			line('Curve fee', `${fmt(q.trading_fee_three)} $THREE`);
		} else {
			line('You receive about', `${fmt(q.three_out)} $THREE`);
			line(`At least (${q.slippage_bps / 100}% slippage)`, `${fmt(q.min_three_out)} $THREE`);
			line('Curve fee', `${fmt(q.trading_fee_three)} $THREE`);
		}

		const bal = currentBalance();
		const short_ = s.wallet && bal != null && amount > bal;
		btn.disabled = s.busy || Boolean(s.wallet && (!(amount > 0) || !q || Boolean(q.error) || short_));
		if (!walletInstalled()) btn.textContent = 'Install a Solana wallet';
		else if (!s.wallet) btn.textContent = 'Connect wallet';
		else if (s.busy) btn.textContent = 'Working...';
		else if (short_) btn.textContent = `Not enough ${inputUnit()}`;
		else btn.textContent = buying ? `Buy $${launch.symbol}` : `Sell $${launch.symbol}`;
	}

	function status(html, tone = '') {
		const n = document.getElementById('ldn-status');
		if (!n) return;
		n.dataset.tone = tone;
		n.replaceChildren(...html);
	}
	const linkTo = (sig, text) => el('a', { href: explorer(sig), target: '_blank', rel: 'noopener', text });

	async function refreshBalances() {
		if (!s.wallet) return;
		const results = await Promise.allSettled([
			network === 'mainnet' ? solBalance(s.wallet.address) : Promise.resolve(null),
			s.lane?.quote_mint ? tokenBalance(s.wallet.address, s.lane.quote_mint) : Promise.resolve(null),
			tokenBalance(s.wallet.address, mint),
		]);
		const val = (r) => (r.status === 'fulfilled' ? r.value : null);
		s.balances = { sol: val(results[0]), three: val(results[1]), coin: val(results[2]) };
		paintBalance();
		paintQuote();
	}

	async function onGo() {
		if (!walletInstalled()) {
			window.open('https://phantom.com/download', '_blank', 'noopener');
			return;
		}
		if (!s.wallet) {
			try {
				s.wallet = await connectTradingWallet();
				await refreshBalances();
				scheduleQuote();
			} catch (err) {
				status([err.message], 'error');
			}
			paintQuote();
			return;
		}
		s.busy = true;
		paintQuote();
		status(['Building the transaction...']);
		try {
			const solPath = s.side === 'buy' && s.payWith === 'sol';
			const fresh = solPath && s.quote?.tx_base64 && Date.now() - s.quoteAt < PREP_MAX_AGE_MS;
			const prep = fresh
				? s.quote
				: await api('/api/native-launch/swap-prep', {
						method: 'POST',
						body: { mint, wallet_address: s.wallet.address, side: s.side, pay_with: solPath ? 'sol' : 'three', amount: Number(s.amount), network },
					});
			status(['Approve it in your wallet...']);
			const signature = await signAndBroadcast({ txBase64: prep.tx_base64, version: 0, address: s.wallet.address });
			status(['Sent. Waiting for confirmation... ', linkTo(signature, 'view')]);
			const confirmed = await waitForConfirmation(signature);
			status([confirmed ? (s.side === 'buy' ? 'Bought. ' : 'Sold. ') : 'Sent, still confirming. ', linkTo(signature, 'View transaction')], confirmed ? 'ok' : '');
			s.amount = '';
			s.quote = null;
			const input = document.getElementById('ldn-amount');
			if (input) input.value = '';
			await Promise.all([loadPool(), loadTrades(), refreshBalances(), loadPrice()]);
		} catch (err) {
			status([err.code === 'USER_REJECTED' ? 'You cancelled the signature. Nothing was sent.' : err.message], 'error');
		} finally {
			s.busy = false;
			paintQuote();
		}
	}

	// ── loaders ─────────────────────────────────────────────────────────────
	async function loadPool() {
		try {
			s.pool = await api(qn(`/api/native-launch/pool?mint=${mint}`));
		} catch (err) {
			s.pool = { error: `Could not read the curve: ${err.message}` };
		}
		renderCurve();
		renderHero();
	}

	async function loadPrice() {
		try {
			const q = await api(qn(`/api/native-launch/quote?mint=${mint}&three_in=1000`));
			s.price = q.tokens_out > 0 ? 1000 / q.tokens_out : null;
		} catch {
			s.price = null;
		}
		renderHero();
	}

	async function loadTrades() {
		s.tradesError = '';
		try {
			s.trades = (await api(qn(`/api/native-launch/trades?mint=${mint}&limit=20`))).data.trades;
		} catch (err) {
			s.tradesError = `Could not read recent trades: ${err.message}`;
		}
		renderTrades();
	}

	async function loadLane() {
		try {
			s.lane = await api(qn('/api/native-launch/config'));
		} catch {
			s.lane = null;
		}
		renderFees();
		renderTrade();
	}

	renderHero();
	renderCurve();
	renderTrades();
	renderAgent();
	renderFees();
	renderTrade();
	loadLane().then(() => {
		if (s.lane) {
			renderHero();
		}
	});
	loadPool();
	loadPrice();
	loadTrades();
	connectTradingWallet({ silent: true }).then((w) => {
		if (!w) return;
		s.wallet = w;
		refreshBalances();
		paintQuote();
	});
	const timer = setInterval(() => {
		if (!document.hidden) {
			loadTrades();
			loadPool();
		}
	}, TRADES_POLL_MS);
	window.addEventListener('beforeunload', () => clearInterval(timer));
}
