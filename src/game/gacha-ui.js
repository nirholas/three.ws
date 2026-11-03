// The card gacha pull modal for /play, lazy-loaded when a player walks up to
// the plaza machine (gacha-station.js) and presses E.
//
// Every card is a real, professionally graded trading card vaulted by Collector
// Crypt and minted as a Solana NFT. The flow:
//
//   1. Pick a machine (live price, odds, value ranges, stock, recent pulls,
//      and the actual cards still inside).
//   2. Pull: our server asks Collector Crypt for a pack, decodes the payment
//      transaction it built and checks it is exactly "this wallet pays the
//      machine price in USDC to the gacha treasury" before it reaches here.
//   3. Confirm: the player sees the decoded amount, token, chain and recipient,
//      then approves in their own wallet. Nothing is signed without that.
//   4. Relay, wait for the payment to land, open the pack, reveal the card.
//   5. Optional instant buyback within 72 h, same verify-then-sign path.
//
// "My cards" lists every Collector Crypt card the connected wallet holds (read
// on-chain by GET /api/gacha/cards), opens any of them in the 3D inspector and
// sells it back while its instant-buyback window is open.
//
// A pending pack is remembered in localStorage so a closed tab or a dropped
// connection never strands a paid pull: reopening the machine resumes it.

import './gacha-ui.css';
import { detectSolanaWallet, SOLANA_RPC, solanaTxExplorerUrl } from '../erc8004/solana-deploy.js';
import { openModal, prefersReducedMotion, announce } from './a11y.js';
import { t } from './i18n-play.js';
import {
	gachaApi, gachaNet, cardImageUrl, TIERS, TIER_STYLE, usd, shortAddr, pickFeatured, COLLECTOR_CRYPT_CARD_URL,
} from './gacha-client.js';
import { createCardStage } from './gacha-reveal3d.js';
import { el } from './gacha-dom.js';

const COLLECTOR_CRYPT_MARKET_URL = 'https://collectorcrypt.com/marketplace';
const WALLET_INSTALL = [
	['Phantom', 'https://phantom.com/download'],
	['Solflare', 'https://solflare.com/download'],
	['Backpack', 'https://backpack.app/download'],
];

const PENDING_KEY = 'threews:gacha:pending';
const PACK_TTL_MS = 2 * 60 * 60 * 1000;
const PAY_WAIT_MS = 120_000;
const OPEN_WAIT_MS = 150_000;
const WINNERS_EVERY_MS = 15_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function b64ToBytes(b64) {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

function bytesToB64(bytes) {
	let s = '';
	for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
	return btoa(s);
}

function timeAgo(iso) {
	const ms = Date.now() - Date.parse(iso);
	if (!Number.isFinite(ms)) return '';
	const s = Math.max(1, Math.round(ms / 1000));
	if (s < 60) return `${s}s ago`;
	if (s < 3600) return `${Math.round(s / 60)}m ago`;
	if (s < 86400) return `${Math.round(s / 3600)}h ago`;
	return `${Math.round(s / 86400)}d ago`;
}

function pct(x) {
	const v = Number(x) * 100;
	return v >= 1 ? `${Math.round(v)}%` : `${v.toFixed(1).replace(/\.0$/, '')}%`;
}

// Card art: resized same-origin proxy first, the original URL if the proxy
// has nothing (an <img> needs no CORS), then a designed blank.
function cardImg(src, { width = 320, alt = '', cls = 'ga-img' } = {}) {
	const img = el('img', { class: cls, alt, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
	const proxied = cardImageUrl(src, width);
	if (!proxied) {
		img.classList.add('is-missing');
		return img;
	}
	let triedDirect = false;
	img.addEventListener('error', () => {
		if (!triedDirect && src) { triedDirect = true; img.src = src; return; }
		img.classList.add('is-missing');
		img.removeAttribute('src');
	});
	img.src = proxied;
	return img;
}

function walletError(err) {
	const msg = String(err?.message || err || '');
	if (/reject|denied|cancel|declin|user/i.test(msg)) return 'Cancelled in your wallet. Nothing was charged.';
	return msg || 'Your wallet could not sign the transaction.';
}

// Collector Crypt builds legacy transactions for some flows and v0 for others.
// A v0 message sets the high bit of the byte right after the signature block;
// a legacy message never does.
async function decodeTx(b64) {
	const { Transaction, VersionedTransaction } = await import('@solana/web3.js');
	const bytes = b64ToBytes(b64);
	const sigCount = bytes[0];
	const versioned = (bytes[1 + sigCount * 64] & 0x80) !== 0;
	return { tx: versioned ? VersionedTransaction.deserialize(bytes) : Transaction.from(bytes), versioned };
}

function serializeSigned(signed, versioned) {
	return bytesToB64(versioned ? signed.serialize() : signed.serialize({ requireAllSignatures: false, verifySignatures: false }));
}

// Pointer-driven tilt and foil position for a card tile (CSS does the drawing).
function bindTilt(node) {
	if (prefersReducedMotion()) return;
	node.addEventListener('pointermove', (e) => {
		if (e.pointerType !== 'mouse') return;
		const r = node.getBoundingClientRect();
		const x = (e.clientX - r.left) / r.width;
		const y = (e.clientY - r.top) / r.height;
		node.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
		node.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
		node.style.setProperty('--rx', `${((0.5 - y) * 14).toFixed(2)}deg`);
		node.style.setProperty('--ry', `${((x - 0.5) * 18).toFixed(2)}deg`);
		node.classList.add('is-tilting');
	});
	node.addEventListener('pointerleave', () => {
		node.classList.remove('is-tilting');
		node.style.removeProperty('--rx');
		node.style.removeProperty('--ry');
	});
}

function readPending() {
	try {
		const p = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
		if (!p?.memo || Date.now() - p.at > PACK_TTL_MS + 30 * 60 * 1000) return null;
		return p;
	} catch {
		return null;
	}
}
function writePending(p) {
	try { if (p) localStorage.setItem(PENDING_KEY, JSON.stringify(p)); else localStorage.removeItem(PENDING_KEY); } catch { /* storage blocked: the pull still completes in this session */ }
}

let _open = null;

/**
 * Open the gacha modal (idempotent: a second call re-shows the live one).
 * @param {{ station?: object, onClose?: () => void }} opts
 */
export function openGacha(opts = {}) {
	if (_open) {
		_open.onClose = opts.onClose || _open.onClose;
		_open.show();
		return _open;
	}
	_open = new GachaUI(opts);
	return _open;
}

class GachaUI {
	constructor({ station, onClose }) {
		this.station = station;
		this.onClose = onClose;
		this.net = gachaNet();
		this.machines = null;
		this.usdcMint = null;
		this.category = 'all';
		this.machine = null;
		this.turbo = false;
		this.wallet = null;
		this.address = null;
		this.balance = null;
		this.pull = null; // the in-flight pull { memo, payment, machine, signature, stage }
		this.result = null;
		this.inFlight = false;
		this._ac = new AbortController();
		this._winnersTimer = null;
		this._poolState = null;
		this._build();
		this.show();
		this._loadMachines();
	}

	// ── shell ──────────────────────────────────────────────────────────────

	_build() {
		const title = t('play.gacha_title', 'Card Gacha');
		this.overlay = el('div', { class: 'ga-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ga-title' });
		this.overlay.addEventListener('click', (e) => { if (e.target === this.overlay) this.close(); });
		this.backBtn = el('button', { class: 'ga-icon-btn ga-back', type: 'button', 'aria-label': 'Back', hidden: true, onclick: () => this._back() }, '←');
		const closeBtn = el('button', { class: 'ga-icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => this.close() }, '×');
		this.cardsBtn = el('button', { class: 'ga-head-btn', type: 'button', onclick: () => this._renderMyCards() }, [
			el('span', { class: 'ga-head-btn-icon', 'aria-hidden': 'true' }),
			'My cards',
		]);
		const badge = this.net === 'devnet' ? el('span', { class: 'ga-net', title: 'Collector Crypt devnet machines, paid in devnet USDC' }, 'DEVNET') : null;
		this.head = el('header', { class: 'ga-head' }, [
			this.backBtn,
			el('div', { class: 'ga-titles' }, [
				el('h2', { id: 'ga-title', class: 'ga-title' }, [title, badge]),
				el('p', { class: 'ga-sub' }, 'Real graded cards, vaulted and minted on Solana by Collector Crypt'),
			]),
			this.cardsBtn,
			closeBtn,
		]);
		this.body = el('div', { class: 'ga-body' });
		this.status = el('div', { class: 'ga-sr', 'aria-live': 'polite' });
		this.card = el('div', { class: 'ga-card' }, [this.head, this.body, this.status]);
		this.overlay.appendChild(this.card);
		this.pill = null;
	}

	show() {
		if (this.pill) { this.pill.remove(); this.pill = null; }
		if (!this.overlay.isConnected) document.body.appendChild(this.overlay);
		this._release?.();
		this._release = openModal(this.card, { close: () => this.close(), initialFocus: this.card.querySelector('.ga-primary') || undefined });
		this._headless = false;
		if (this.view === 'detail') this._startWinners();
		// Closing the panel releases the 3D stage, so a card view is rebuilt.
		if (this.result && (this.view !== 'reveal' || !this._stage)) this._renderReveal();
		else if (this.view === 'owned' && this._owned && !this._stage) this._renderOwnedCard(this._owned);
	}

	focus() {
		this.card.classList.remove('ga-flash');
		void this.card.offsetWidth;
		this.card.classList.add('ga-flash');
	}

	close() {
		this._release?.();
		this._release = null;
		this._stopWinners();
		this._disposeStage();
		this.overlay.remove();
		const cb = this.onClose;
		this.onClose = null;
		cb?.();
		// A paid pull keeps running after the panel closes: the result lands
		// in a small pill instead of being lost.
		if (this.inFlight) {
			this._headless = true;
			this._showPill('Opening your pack…', null);
			return;
		}
		this._dispose();
	}

	_dispose() {
		this._ac.abort();
		this.pill?.remove();
		this.pill = null;
		if (_open === this) _open = null;
	}

	_showPill(text, card) {
		this.pill?.remove();
		const tier = card ? TIER_STYLE[card.tier] : null;
		this.pill = el('div', { class: 'ga-pill', role: 'status', style: tier ? { '--ga-tier': tier.color } : {} }, [
			el('span', { class: 'ga-pill-dot', 'aria-hidden': 'true' }),
			el('span', { class: 'ga-pill-text' }, text),
			el('button', { class: 'ga-pill-btn', type: 'button', onclick: () => this.show() }, card ? 'View card' : 'Show'),
			card ? el('button', { class: 'ga-pill-x', type: 'button', 'aria-label': 'Dismiss', onclick: () => { this.result = null; this._dispose(); } }, '×') : null,
		]);
		document.body.appendChild(this.pill);
	}

	_say(text) {
		this.status.textContent = text;
		announce?.(text);
	}

	_setView(view, nodes, { back = null } = {}) {
		this._disposeStage();
		this.view = view;
		this._backTo = back;
		this.backBtn.hidden = !back;
		// A pull in flight owns the panel until its card lands.
		this.cardsBtn.disabled = this.inFlight;
		this.cardsBtn.classList.toggle('is-on', view === 'cards' || view === 'owned');
		if (view === 'cards' || view === 'owned') this.cardsBtn.setAttribute('aria-current', 'page');
		else this.cardsBtn.removeAttribute('aria-current');
		this.body.replaceChildren(...[].concat(nodes).filter(Boolean));
		this.body.scrollTop = 0;
		if (view !== 'detail') this._stopWinners();
		const first = this.body.querySelector('.ga-primary:not([disabled])') || this.body.querySelector('button:not([disabled]), a[href]');
		if (first && !this._headless) requestAnimationFrame(() => first.focus({ preventScroll: true }));
	}

	_back() {
		if (this._backTo === 'machines') {
			if (this.machines) this._renderMachines();
			else this._loadMachines();
		} else if (this._backTo === 'detail' && this.machine) this._renderDetail(this.machine);
		else if (this._backTo === 'cards') {
			if (this._cards && !this._cardsDirty) this._renderCardsGrid(this._cards);
			else this._renderMyCards();
		}
	}

	// ── 3D card stage ─────────────────────────────────────────────────────

	_disposeStage() {
		this._stage?.dispose();
		this._stage = null;
	}

	/**
	 * Mount the WebGL card stage in `host`, or the CSS flip card when WebGL is
	 * unavailable or its context is lost. `onSettled` runs once, when the card
	 * is face up and the details can show.
	 */
	_mountStage(host, card, { intro, onSettled, controls }) {
		let done = false;
		const settled = () => {
			if (done) return;
			done = true;
			onSettled?.();
		};
		const fallback = () => {
			host.classList.remove('ga-stage-3d');
			host.replaceChildren(this._flipCard(card, { animate: intro }));
			if (controls) controls.hidden = true;
			settled();
		};
		const stage = createCardStage(host, {
			card,
			intro,
			reduced: prefersReducedMotion(),
			onSettled: () => {
				if (controls) controls.hidden = false;
				settled();
			},
			onLost: () => {
				if (this._stage === stage) this._stage = null;
				fallback();
			},
		});
		if (!stage) { fallback(); return null; }
		this._stage = stage;
		return stage;
	}

	// The CSS flip card: the real back of the slab when Collector Crypt has a
	// photo of it, otherwise a designed reverse.
	_flipCard(c, { animate }) {
		const tier = TIER_STYLE[c.tier] || TIER_STYLE.common;
		const reduced = prefersReducedMotion() || !animate;
		const back = c.back
			? el('div', { class: 'ga-face ga-face-back ga-face-photo', 'aria-hidden': 'true' }, cardImg(c.back, { width: 480, alt: '', cls: 'ga-img ga-reveal-img' }))
			: el('div', { class: 'ga-face ga-face-back', 'aria-hidden': 'true' }, [el('span', {}, 'GRADED'), el('span', {}, 'CARD')]);
		const flip = el('div', { class: `ga-flip${reduced ? ' is-flipped' : ''}`, style: { '--ga-tier': tier.color, '--ga-glow': tier.glow } }, [
			back,
			el('div', { class: 'ga-face ga-face-front' }, cardImg(c.image, { width: 480, alt: c.title || c.name || 'Card', cls: 'ga-img ga-reveal-img' })),
		]);
		if (!reduced) requestAnimationFrame(() => requestAnimationFrame(() => flip.classList.add('is-flipped')));
		return flip;
	}

	_stageControls() {
		const controls = el('div', { class: 'ga-stage-controls', hidden: true }, [
			el('button', { class: 'ga-btn ga-btn-sm', type: 'button', onclick: () => this._stage?.flip() }, 'Flip card'),
			el('span', { class: 'ga-dim ga-small' }, window.matchMedia?.('(hover: hover)').matches ? 'Drag to turn it, hover to catch the foil' : 'Drag to turn it, tap to flip'),
		]);
		return controls;
	}

	_nftExplorerUrl(addr) {
		return this.net === 'devnet' ? `https://explorer.solana.com/address/${addr}?cluster=devnet` : `https://solscan.io/token/${addr}`;
	}

	_errorBlock(message, retryLabel, retry) {
		return el('div', { class: 'ga-state ga-state-error', role: 'alert' }, [
			el('div', { class: 'ga-state-icon', 'aria-hidden': 'true' }, '!'),
			el('p', {}, message),
			retry ? el('button', { class: 'ga-btn ga-primary', type: 'button', onclick: retry }, retryLabel || 'Try again') : null,
		]);
	}

	// ── machine picker ────────────────────────────────────────────────────

	async _loadMachines() {
		this._setView('loading', [
			el('div', { class: 'ga-chips ga-skel-row' }, Array.from({ length: 4 }, () => el('span', { class: 'ga-skel ga-skel-chip' }))),
			el('div', { class: 'ga-grid', 'aria-busy': 'true', 'aria-label': 'Loading machines' }, Array.from({ length: 6 }, () => el('div', { class: 'ga-tile ga-tile-skel' }, [
				el('div', { class: 'ga-skel ga-skel-art' }), el('div', { class: 'ga-skel ga-skel-line' }), el('div', { class: 'ga-skel ga-skel-line short' }),
			]))),
		]);
		try {
			const data = await gachaApi('machines', { signal: this._ac.signal });
			this.machines = data.machines || [];
			this.usdcMint = data.usdcMint || null;
		} catch (err) {
			// The player may have opened My cards while the list loaded; leave that view alone.
			if (this._ac.signal.aborted || this.view !== 'loading') return;
			this._setView('error', this._errorBlock(err.message || 'Could not load the machines.', 'Try again', () => this._loadMachines()));
			return;
		}
		if (this.view !== 'loading') return;
		const pending = readPending();
		if (pending && pending.net === this.net) {
			this._renderResume(pending);
			return;
		}
		this._renderMachines();
	}

	_renderMachines() {
		this.machine = null;
		const list = this.machines || [];
		if (!list.length) {
			this._setView('machines', el('div', { class: 'ga-state' }, [
				el('div', { class: 'ga-state-icon', 'aria-hidden': 'true' }, '◌'),
				el('p', { class: 'ga-state-title' }, 'Every machine is closed right now'),
				el('p', {}, 'Collector Crypt restocks and rebalances machines through the day. Check back in a little while.'),
				el('button', { class: 'ga-btn', type: 'button', onclick: () => this._loadMachines() }, 'Check again'),
			]));
			return;
		}
		const cats = ['all', ...new Set(list.map((m) => m.category).filter(Boolean))];
		if (!cats.includes(this.category)) this.category = 'all';
		const chips = el('div', { class: 'ga-chips', role: 'tablist', 'aria-label': 'Machine category' }, cats.map((c) => el('button', {
			class: `ga-chip${c === this.category ? ' is-on' : ''}`,
			type: 'button',
			role: 'tab',
			'aria-selected': String(c === this.category),
			onclick: () => { this.category = c; this._renderMachines(); },
		}, c === 'all' ? 'All' : c)));
		const shown = list.filter((m) => this.category === 'all' || m.category === this.category);
		const featured = pickFeatured(list);
		const grid = el('div', { class: 'ga-grid' }, shown.map((m) => this._machineTile(m, m.code === featured?.code)));
		const foot = el('p', { class: 'ga-foot' }, [
			'Pulls are paid in USDC on Solana and the card is sent straight to your wallet. ',
			el('a', { href: 'https://docs.collectorcrypt.com/gacha', target: '_blank', rel: 'noopener' }, 'How Collector Crypt gacha works'),
		]);
		this._setView('machines', [chips, grid, foot]);
	}

	_machineTile(m, featured) {
		const odds = el('div', { class: 'ga-odds-bar', 'aria-hidden': 'true' }, TIERS.map((tr) => el('span', { style: { flexGrow: String(Math.max(0.002, m.odds[tr] || 0)), background: TIER_STYLE[tr].color } })));
		const art = m.art || m.thumbnail;
		return el('button', {
			class: `ga-tile${m.available ? '' : ' is-empty'}`,
			type: 'button',
			'aria-label': `${m.name}, ${usd(m.price)} per pull, ${pct(m.odds.epic)} epic odds${m.available ? '' : ', out of cards'}`,
			onclick: () => this._renderDetail(m),
		}, [
			featured ? el('span', { class: 'ga-flag' }, 'On the plaza') : null,
			el('div', { class: 'ga-tile-art' }, art ? cardImg(art, { width: 320, alt: '' }) : el('span', { class: 'ga-img is-missing' })),
			el('div', { class: 'ga-tile-name' }, m.name),
			el('div', { class: 'ga-tile-row' }, [
				el('span', { class: 'ga-price' }, usd(m.price)),
				el('span', { class: 'ga-dim' }, m.available ? `${m.totalStock} cards left` : 'Out of cards'),
			]),
			odds,
			el('div', { class: 'ga-tile-row ga-dim' }, [
				el('span', {}, `Epic ${pct(m.odds.epic)}`),
				m.instantBuyback ? el('span', {}, `${m.instantBuyback}% buyback`) : null,
			]),
		]);
	}

	// ── machine detail ────────────────────────────────────────────────────

	_renderDetail(m) {
		this.machine = m;
		this.turbo = this.turbo && m.turboMode;
		const art = m.art || m.thumbnail;

		const oddsRows = TIERS.map((tr) => {
			const r = m.tierRanges?.[tr];
			const range = r && r.start != null ? `${usd(r.start, { cents: false })} to ${usd(r.end, { cents: false })}` : 'n/a';
			return el('tr', {}, [
				el('th', { scope: 'row' }, [el('span', { class: 'ga-dot', style: { background: TIER_STYLE[tr].color } }), TIER_STYLE[tr].label]),
				el('td', {}, pct(m.odds[tr])),
				el('td', {}, range),
				el('td', {}, String(m.stock?.[tr] ?? 0)),
			]);
		});
		const oddsTable = el('table', { class: 'ga-table' }, [
			el('thead', {}, el('tr', {}, [el('th', { scope: 'col' }, 'Tier'), el('th', { scope: 'col' }, 'Odds'), el('th', { scope: 'col' }, 'Card value'), el('th', { scope: 'col' }, 'In stock')])),
			el('tbody', {}, oddsRows),
		]);

		this.winnersBox = el('div', { class: 'ga-winners', 'aria-live': 'off' }, Array.from({ length: 5 }, () => el('div', { class: 'ga-win ga-win-skel' }, [el('div', { class: 'ga-skel ga-skel-card' }), el('div', { class: 'ga-skel ga-skel-line' })])));
		this.poolBox = el('div', { class: 'ga-pool' });
		const poolTabs = el('div', { class: 'ga-chips ga-pool-tabs', role: 'tablist', 'aria-label': 'Cards inside by tier' }, TIERS.map((tr) => el('button', {
			class: 'ga-chip', type: 'button', role: 'tab', 'aria-selected': 'false', 'data-tier': tr, style: { '--ga-tier': TIER_STYLE[tr].color },
			onclick: () => this._loadPool(tr, true),
		}, TIER_STYLE[tr].label)));
		this._poolTabs = poolTabs;

		const left = el('section', { class: 'ga-col' }, [
			el('div', { class: 'ga-hero' }, [
				el('div', { class: 'ga-hero-art' }, art ? cardImg(art, { width: 480, alt: m.name }) : el('span', { class: 'ga-img is-missing' })),
				el('div', {}, [
					el('h3', { class: 'ga-h3' }, m.name),
					el('p', { class: 'ga-dim' }, [m.category, m.ev ? `Expected value ${usd(m.ev)}` : null].filter(Boolean).join(' · ')),
					el('p', { class: 'ga-dim' }, m.available ? `${m.totalStock} cards in the machine` : 'This machine is out of cards right now.'),
				]),
			]),
			oddsTable,
			el('h4', { class: 'ga-h4' }, 'Recent pulls'),
			this.winnersBox,
			el('h4', { class: 'ga-h4' }, "What's inside"),
			poolTabs,
			this.poolBox,
		]);

		this._setView('detail', [el('div', { class: 'ga-detail' }, [left, this._pullPanel(m)])], { back: 'machines' });
		this._startWinners();
		this._loadPool('epic', true);
		this._refreshWallet(false);
	}

	_pullPanel(m) {
		this.walletLine = el('div', { class: 'ga-wallet' });
		this.pullBtn = el('button', { class: 'ga-btn ga-primary ga-pull', type: 'button', onclick: () => this._startPull() });
		this.pullNote = el('p', { class: 'ga-note', role: 'status' });
		const turbo = m.turboMode ? el('label', { class: 'ga-toggle' }, [
			el('input', { type: 'checkbox', checked: this.turbo || null, onchange: (e) => { this.turbo = e.target.checked; this._syncPull(); } }),
			el('span', { class: 'ga-toggle-ui', 'aria-hidden': 'true' }),
			el('span', {}, [el('strong', {}, 'Turbo mode'), el('span', { class: 'ga-dim ga-block' }, `Commons are sold back instantly at ${m.instantBuyback || 85}% and paid to you in USDC.`)]),
		]) : null;
		const facts = el('ul', { class: 'ga-facts' }, [
			el('li', {}, `Paid in USDC on Solana${this.net === 'devnet' ? ' devnet' : ''}. Collector Crypt covers the network fee.`),
			el('li', {}, 'The card NFT is sent straight to your wallet. The physical slab stays insured in the vault and can be redeemed.'),
			m.instantBuyback ? el('li', {}, `Instant buyback at ${m.instantBuyback}% of the card's insured value for 72 hours.`) : null,
			el('li', {}, 'Every pull is provably fair: each reveal links its on-chain randomness proof.'),
		]);
		const panel = el('aside', { class: 'ga-panel' }, [
			el('div', { class: 'ga-panel-price' }, [el('span', { class: 'ga-big' }, usd(m.price)), el('span', { class: 'ga-dim' }, 'USDC per pull')]),
			this.walletLine,
			turbo,
			this.pullBtn,
			this.pullNote,
			facts,
		]);
		this._syncPull();
		return panel;
	}

	_syncPull() {
		const m = this.machine;
		if (!m || !this.pullBtn) return;
		const short = this.balance != null && this.balance < m.price;
		this.pullBtn.disabled = !m.available || this.inFlight;
		this.pullBtn.textContent = !m.available ? 'Out of cards' : this.address ? `Pull for ${usd(m.price)}` : 'Connect wallet to pull';
		this.pullNote.textContent = short ? `Your wallet holds ${usd(this.balance)} USDC. You need ${usd(m.price)} for a pull.` : '';
		this.pullNote.classList.toggle('is-warn', short);
		this.walletLine.replaceChildren(...(this.address ? [
			el('span', { class: 'ga-dot ga-dot-on', 'aria-hidden': 'true' }),
			el('span', {}, shortAddr(this.address)),
			el('span', { class: 'ga-dim' }, this.balance == null ? 'checking USDC…' : `${usd(this.balance)} USDC`),
		] : [
			el('span', { class: 'ga-dot', 'aria-hidden': 'true' }),
			el('span', { class: 'ga-dim' }, detectSolanaWallet() ? 'Wallet not connected' : 'No Solana wallet detected. Install Phantom, Solflare or Backpack to pull.'),
		]));
	}

	async _refreshWallet(connect) {
		const wallet = detectSolanaWallet();
		this.wallet = wallet;
		if (!wallet) { this.address = null; this._syncPull(); return null; }
		let address = wallet.publicKey?.toString?.() || null;
		if (!address && connect) {
			await wallet.connect();
			address = wallet.publicKey?.toString?.() || null;
		} else if (!address) {
			// Already-trusted sites reconnect silently; never pop a prompt here.
			try { await wallet.connect({ onlyIfTrusted: true }); address = wallet.publicKey?.toString?.() || null; } catch { /* not trusted yet */ }
		}
		const changed = address !== this.address;
		this.address = address;
		if (changed) this.balance = null;
		this._syncPull();
		if (address) this._loadBalance(address);
		return address;
	}

	async _loadBalance(owner) {
		if (!this.usdcMint) return;
		try {
			const res = await fetch(SOLANA_RPC[this.net], {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner', params: [owner, { mint: this.usdcMint }, { encoding: 'jsonParsed', commitment: 'confirmed' }] }),
				signal: this._ac.signal,
			});
			const body = await res.json();
			if (!Array.isArray(body?.result?.value)) return;
			const total = body.result.value.reduce((s, a) => s + (Number(a.account?.data?.parsed?.info?.tokenAmount?.uiAmount) || 0), 0);
			if (owner === this.address) { this.balance = total; this._syncPull(); }
		} catch {
			// Balance is a convenience; the wallet and the network still enforce it.
		}
	}

	_startWinners() {
		this._stopWinners();
		const run = async () => {
			if (!this.machine || this.view !== 'detail' || this._headless) return;
			try {
				const { winners } = await gachaApi('winners', { query: { code: this.machine.code }, signal: this._ac.signal });
				if (this.view === 'detail') this._renderWinners(winners || []);
			} catch (err) {
				if (this.view === 'detail' && !this.winnersBox.querySelector('.ga-win:not(.ga-win-skel)')) {
					this.winnersBox.replaceChildren(el('p', { class: 'ga-dim ga-inline-err' }, err.message || 'Recent pulls are unavailable.'));
				}
			}
			this._winnersTimer = setTimeout(run, WINNERS_EVERY_MS);
		};
		run();
	}

	_stopWinners() {
		clearTimeout(this._winnersTimer);
		this._winnersTimer = null;
	}

	_renderWinners(rows) {
		if (!rows.length) {
			this.winnersBox.replaceChildren(el('p', { class: 'ga-dim' }, 'No pulls on this machine yet. Yours could be the first.'));
			return;
		}
		this.winnersBox.replaceChildren(...rows.map((w) => {
			const tier = TIER_STYLE[w.tier] || TIER_STYLE.common;
			return el('a', {
				class: 'ga-win', href: w.address ? COLLECTOR_CRYPT_CARD_URL(w.address) : null, target: '_blank', rel: 'noopener',
				style: { '--ga-tier': tier.color }, title: w.title || w.name,
			}, [
				cardImg(w.image, { width: 160, alt: w.name || 'Card', cls: 'ga-img ga-win-img' }),
				el('span', { class: 'ga-win-tier' }, tier.label),
				el('span', { class: 'ga-win-name' }, w.name || 'Graded card'),
				el('span', { class: 'ga-dim ga-win-meta' }, [w.insuredValue ? usd(w.insuredValue, { cents: false }) : null, w.at ? timeAgo(w.at) : null].filter(Boolean).join(' · ')),
			]);
		}));
	}

	async _loadPool(tier, reset) {
		if (!this.machine) return;
		const code = this.machine.code;
		if (reset) this._poolState = { tier, cursor: null, cards: [], hasMore: false, loading: false };
		const st = this._poolState;
		if (st.loading) return;
		st.loading = true;
		for (const b of this._poolTabs.children) {
			const on = b.dataset.tier === tier;
			b.classList.toggle('is-on', on);
			b.setAttribute('aria-selected', String(on));
		}
		if (reset) this.poolBox.replaceChildren(...Array.from({ length: 6 }, () => el('div', { class: 'ga-pcard' }, el('div', { class: 'ga-skel ga-skel-card' }))));
		try {
			const data = await gachaApi('pool', { query: { code, rarity: tier, ...(st.cursor ? { cursor: st.cursor } : {}) }, signal: this._ac.signal });
			if (this._poolState !== st || this.machine?.code !== code) return;
			st.cards.push(...(data.cards || []));
			st.cursor = data.nextCursor;
			st.hasMore = !!data.hasMore && !!data.nextCursor;
		} catch (err) {
			if (this._poolState !== st) return;
			st.loading = false;
			this.poolBox.replaceChildren(this._errorBlock(err.message || 'Could not load the cards.', 'Try again', () => this._loadPool(tier, true)));
			return;
		}
		st.loading = false;
		this._renderPool();
	}

	_renderPool() {
		const st = this._poolState;
		if (!st.cards.length) {
			this.poolBox.replaceChildren(el('p', { class: 'ga-dim' }, `No ${TIER_STYLE[st.tier].label.toLowerCase()} cards left in this machine.`));
			return;
		}
		const nodes = st.cards.map((c) => el('a', {
			class: 'ga-pcard', href: c.address ? COLLECTOR_CRYPT_CARD_URL(c.address) : null, target: '_blank', rel: 'noopener', title: c.title || c.name,
		}, [
			cardImg(c.image, { width: 200, alt: c.name || 'Card', cls: 'ga-img ga-pcard-img' }),
			el('span', { class: 'ga-pcard-name' }, c.name || 'Graded card'),
			el('span', { class: 'ga-dim' }, [c.grader && c.grade ? `${c.grader} ${c.grade}` : null, c.insuredValue ? usd(c.insuredValue, { cents: false }) : null].filter(Boolean).join(' · ')),
		]));
		if (st.hasMore) nodes.push(el('button', { class: 'ga-btn ga-more', type: 'button', onclick: () => this._loadPool(st.tier, false) }, 'Show more'));
		this.poolBox.replaceChildren(...nodes);
	}

	// ── pull ───────────────────────────────────────────────────────────────

	async _startPull() {
		const m = this.machine;
		if (!m || this.inFlight) return;
		if (!detectSolanaWallet()) {
			this.pullNote.textContent = 'No Solana wallet found. Install Phantom, Solflare or Backpack, then reload.';
			this.pullNote.classList.add('is-warn');
			return;
		}
		this.pullBtn.disabled = true;
		this.pullBtn.textContent = 'Connecting wallet…';
		let player;
		try {
			player = await this._refreshWallet(true);
		} catch (err) {
			this._syncPull();
			this.pullNote.textContent = walletError(err);
			this.pullNote.classList.add('is-warn');
			return;
		}
		if (!player) { this._syncPull(); return; }
		this.pullBtn.textContent = 'Preparing your pack…';
		let prep;
		try {
			prep = await gachaApi('pull', { body: { player, code: m.code, turbo: this.turbo }, signal: this._ac.signal });
		} catch (err) {
			this._syncPull();
			this.pullNote.textContent = err.message;
			this.pullNote.classList.add('is-warn');
			if (err.code === 'machine_empty' || err.code === 'machine_closed') this._refreshMachineList();
			return;
		}
		this._renderConfirm(prep, player);
	}

	async _refreshMachineList() {
		try {
			const data = await gachaApi('machines', { signal: this._ac.signal });
			this.machines = data.machines || [];
		} catch { /* the list stays as it was */ }
	}

	_renderConfirm(prep, player) {
		const m = this.machine;
		const p = prep.payment;
		const netLabel = this.net === 'devnet' ? 'Solana devnet' : 'Solana';
		const acct = (a) => el('a', { href: this.net === 'devnet' ? `https://explorer.solana.com/address/${a}?cluster=devnet` : `https://solscan.io/account/${a}`, target: '_blank', rel: 'noopener', class: 'ga-mono' }, shortAddr(a));
		const rows = [
			['Machine', m.name],
			['You pay', el('strong', { class: 'ga-pay' }, `${p.amountUsdc} USDC`)],
			['Token', ['USDC ', acct(p.mint)]],
			['Chain', netLabel],
			['Recipient', ['Collector Crypt gacha treasury ', acct(p.destination)]],
			['From', acct(player)],
			['Network fee', 'Paid by Collector Crypt'],
			prep.turbo ? ['Turbo', 'On: a common is sold back to you in USDC'] : null,
		].filter(Boolean);
		const table = el('table', { class: 'ga-table ga-confirm-table' }, el('tbody', {}, rows.map(([k, v]) => el('tr', {}, [el('th', { scope: 'row' }, k), el('td', {}, v)]))));
		this.confirmBtn = el('button', { class: 'ga-btn ga-primary', type: 'button', onclick: () => this._signAndSend(prep, player) }, 'Approve in wallet');
		this.confirmNote = el('p', { class: 'ga-note', role: 'status' });
		this._setView('confirm', el('div', { class: 'ga-sheet' }, [
			el('h3', { class: 'ga-h3' }, 'Confirm your pull'),
			el('p', { class: 'ga-dim' }, 'We decoded the transaction Collector Crypt built and checked it pays exactly this, nothing else. Your wallet will show the same.'),
			table,
			el('div', { class: 'ga-actions' }, [
				el('button', { class: 'ga-btn', type: 'button', onclick: () => this._renderDetail(m) }, 'Cancel'),
				this.confirmBtn,
			]),
			this.confirmNote,
			el('p', { class: 'ga-dim ga-small' }, 'Unpaid packs expire after 2 hours. Nothing is charged until you approve.'),
		]), { back: 'detail' });
	}

	async _signAndSend(prep, player) {
		if (this.inFlight) return;
		this.confirmBtn.disabled = true;
		this.confirmBtn.textContent = 'Waiting for your wallet…';
		this.confirmNote.textContent = '';
		const wallet = detectSolanaWallet();
		let signedB64;
		try {
			const { tx, versioned } = await decodeTx(prep.transaction);
			const signed = await wallet.signTransaction(tx);
			signedB64 = serializeSigned(signed, versioned);
		} catch (err) {
			this.confirmBtn.disabled = false;
			this.confirmBtn.textContent = 'Approve in wallet';
			this.confirmNote.textContent = walletError(err);
			this.confirmNote.classList.add('is-warn');
			return;
		}

		this.inFlight = true;
		this.pull = { memo: prep.memo, machine: this.machine, player, payment: prep.payment, signature: null };
		writePending({ memo: prep.memo, net: this.net, code: this.machine.code, name: this.machine.name, player, at: Date.now() });
		this._renderProgress('send');
		try {
			const sub = await gachaApi('submit', { body: { player, signedTransaction: signedB64 }, signal: this._ac.signal });
			this.pull.signature = sub.signature;
			const pend = readPending();
			if (pend?.memo === prep.memo) writePending({ ...pend, signature: sub.signature });
		} catch (err) {
			this.inFlight = false;
			writePending(null);
			this._renderPullError(err.message, { retry: () => this._renderDetail(this.machine), retryLabel: 'Back to the machine' });
			return;
		}
		this.station?.playCrank?.();
		this._awaitPack(prep.memo, this.pull.signature);
	}

	_renderProgress(stage) {
		const steps = [
			['send', 'Sending your payment'],
			['pay', 'Waiting for the payment to land'],
			['open', 'Picking your card'],
		];
		const idx = steps.findIndex(([k]) => k === stage);
		const sig = this.pull?.signature;
		this._setView('progress', el('div', { class: 'ga-sheet ga-progress' }, [
			el('div', { class: 'ga-capsule-anim', 'aria-hidden': 'true' }, [el('span', { class: 'ga-cap-top' }), el('span', { class: 'ga-cap-bot' })]),
			el('ol', { class: 'ga-steps' }, steps.map(([, label], i) => el('li', { class: i < idx ? 'is-done' : i === idx ? 'is-now' : '' }, [
				el('span', { class: 'ga-step-dot', 'aria-hidden': 'true' }), label, i === idx ? el('span', { class: 'ga-sr' }, ' (in progress)') : null,
			]))),
			sig ? el('a', { class: 'ga-link', href: solanaTxExplorerUrl(this.net, sig), target: '_blank', rel: 'noopener' }, 'View payment on the explorer ↗') : null,
			el('p', { class: 'ga-dim ga-small' }, 'You can close this panel. The pull keeps going and your card will be waiting.'),
		]));
		this._say(steps[idx]?.[1] || '');
	}

	async _checkSignature(sig) {
		try {
			const res = await fetch(SOLANA_RPC[this.net], {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSignatureStatuses', params: [[sig], { searchTransactionHistory: true }] }),
				signal: this._ac.signal,
			});
			const st = (await res.json())?.result?.value?.[0];
			if (st?.err) return 'failed';
			if (st?.confirmationStatus === 'confirmed' || st?.confirmationStatus === 'finalized') return 'confirmed';
		} catch { /* the gacha status poll is the authority; this only catches failures early */ }
		return 'pending';
	}

	// Payment landed? Then open. Collector Crypt's openPack answers "waiting"
	// forever on an unpaid memo, so the status check comes first.
	async _awaitPack(memo, signature) {
		this.inFlight = true;
		this._renderProgress('pay');
		const payDeadline = Date.now() + PAY_WAIT_MS;
		let paid = false;
		while (Date.now() < payDeadline && !this._ac.signal.aborted) {
			try {
				const st = await gachaApi('status', { query: { memo }, signal: this._ac.signal });
				if (st.refunded) {
					this._finishWithoutCard('Collector Crypt refunded this pull (the machine could not deliver a card). The USDC is back in your wallet.');
					return;
				}
				if (st.paid || st.delivered) { paid = true; break; }
				if (!st.found) {
					this._finishWithoutCard('This pack no longer exists on Collector Crypt. If you were charged, contact Collector Crypt support with the payment link above.');
					return;
				}
			} catch { /* transient: keep polling until the deadline */ }
			if (signature && (await this._checkSignature(signature)) === 'failed') {
				this._finishWithoutCard('The payment failed on-chain, so nothing was charged. You can pull again.');
				return;
			}
			await sleep(2000);
		}
		if (this._ac.signal.aborted) return;
		if (!paid) {
			this.inFlight = false;
			this._renderPullError('The payment has not landed yet. If your wallet shows it as sent, it is still on its way. Your pack is saved: check again in a moment.', {
				retry: () => this._awaitPack(memo, signature), retryLabel: 'Check again',
			});
			return;
		}

		this._renderProgress('open');
		const openDeadline = Date.now() + OPEN_WAIT_MS;
		while (Date.now() < openDeadline && !this._ac.signal.aborted) {
			try {
				const r = await gachaApi('open', { body: { memo }, signal: this._ac.signal, timeoutMs: 35_000 });
				if (r.state === 'won') { this._won(r, memo); return; }
				if (r.state === 'expired') { this._finishWithoutCard('This pack expired before it was paid. Nothing was charged.'); return; }
			} catch (err) {
				if (err.status && err.status < 500 && err.status !== 429) break;
			}
			await sleep(2500);
		}
		if (this._ac.signal.aborted) return;
		this.inFlight = false;
		this._renderPullError('Your payment is in. Collector Crypt is still picking your card. It is saved: open it again in a moment.', {
			retry: () => this._awaitPack(memo, signature), retryLabel: 'Open my pack',
		});
	}

	_finishWithoutCard(message) {
		this.inFlight = false;
		writePending(null);
		if (this._headless) { this._showPill(message, null); return; }
		this._renderPullError(message, { retry: () => (this.machine ? this._renderDetail(this.machine) : this._renderMachines()), retryLabel: 'Back to the machine' });
	}

	_renderPullError(message, { retry, retryLabel }) {
		this._setView('error', this._errorBlock(message, retryLabel, retry), { back: this.machine ? 'detail' : 'machines' });
		this._say(message);
	}

	_won(r, memo) {
		this.inFlight = false;
		writePending(null);
		this.result = { ...r, memo, machine: this.pull?.machine || this.machine, player: this.pull?.player || this.address };
		this.station?.playReveal?.(r.card);
		const name = r.card?.name || 'a graded card';
		const tier = TIER_STYLE[r.card?.tier]?.label;
		if (this._headless) {
			this._showPill(`You pulled ${name}${tier ? ` (${tier})` : ''}`, r.card);
			return;
		}
		this._renderReveal();
	}

	// ── reveal ─────────────────────────────────────────────────────────────

	_renderReveal() {
		const r = this.result;
		if (!r) return;
		const c = r.card || {};
		const tier = TIER_STYLE[c.tier] || TIER_STYLE.common;
		// The capsule plays once per pull; reopening the panel shows the card.
		const intro = !r.introPlayed && !prefersReducedMotion();
		r.introPlayed = true;

		const facts = [
			c.grader || c.grade ? ['Grade', [c.grader, c.grade].filter(Boolean).join(' ')] : null,
			c.set ? ['Set', c.set] : null,
			c.year ? ['Year', c.year] : null,
			c.insuredValue ? ['Insured value', usd(c.insuredValue)] : null,
			r.roll != null ? ['Roll', String(r.roll)] : null,
			r.points != null ? ['Points earned', String(r.points)] : null,
		].filter(Boolean);
		const links = el('div', { class: 'ga-links' }, [
			r.nftAddress ? el('a', { class: 'ga-link', href: COLLECTOR_CRYPT_CARD_URL(r.nftAddress), target: '_blank', rel: 'noopener' }, 'View on Collector Crypt ↗') : null,
			r.nftAddress ? el('a', { class: 'ga-link', href: this._nftExplorerUrl(r.nftAddress), target: '_blank', rel: 'noopener' }, 'NFT on explorer ↗') : null,
			r.verifyUrl ? el('a', { class: 'ga-link', href: r.verifyUrl, target: '_blank', rel: 'noopener' }, 'Verify fairness ↗') : null,
		]);
		const buybackBox = el('div', { class: 'ga-buyback' });
		const info = el('div', { class: `ga-reveal-info${intro ? ' is-pending' : ''}` }, [
			el('span', { class: 'ga-tier-pill', style: { '--ga-tier': tier.color } }, tier.label),
			el('h3', { class: 'ga-h3 ga-reveal-name' }, c.name || 'Graded card'),
			c.title && c.title !== c.name ? el('p', { class: 'ga-dim' }, c.title) : null,
			el('dl', { class: 'ga-dl' }, facts.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])),
			r.turboSold ? el('p', { class: 'ga-turbo-note' }, `Turbo mode sold this card back for ${r.turboPayout ? `${r.turboPayout} USDC` : 'USDC'}, sent to your wallet.`) : el('p', { class: 'ga-dim ga-small' }, 'The card NFT is in your wallet. The graded slab is insured in the Collector Crypt vault.'),
			buybackBox,
			links,
			el('div', { class: 'ga-actions' }, [
				el('button', { class: 'ga-btn', type: 'button', onclick: () => { this.result = null; this._renderMachines(); } }, 'All machines'),
				el('button', { class: 'ga-btn ga-primary', type: 'button', onclick: () => { const m = this.result?.machine || this.machine; this.result = null; if (m) this._renderDetail(m); else this._renderMachines(); } }, 'Pull again'),
			]),
		]);
		const stageBox = el('div', { class: `ga-stage ga-stage-3d is-${TIER_STYLE[c.tier] ? c.tier : 'common'}`, style: { '--ga-glow': tier.glow, '--ga-tier': tier.color } });
		const controls = this._stageControls();
		const skip = intro ? el('button', { class: 'ga-skip', type: 'button', onclick: () => this._stage?.skip() }, 'Skip') : null;
		this._setView('reveal', el('div', { class: 'ga-reveal' }, [el('div', { class: 'ga-stage-col' }, [stageBox, controls]), info]));
		this._say(`You pulled ${c.name || 'a graded card'}, ${tier.label}.`);
		const settled = () => {
			skip?.remove();
			info.classList.remove('is-pending');
			if (intro && !this._headless) requestAnimationFrame(() => info.querySelector('.ga-primary')?.focus({ preventScroll: true }));
		};
		const stage = this._mountStage(stageBox, c, { intro, onSettled: settled, controls });
		if (stage && skip) {
			stageBox.append(skip);
			if (!this._headless) requestAnimationFrame(() => skip.focus({ preventScroll: true }));
		}
		if (!r.turboSold && r.nftAddress && (r.machine?.instantBuyback ?? 1)) {
			this._loadBuyback({ box: buybackBox, nft: r.nftAddress, player: r.player || this.address, cardName: c.name });
		}
	}

	// ── instant buyback (reveal and My cards share this) ──────────────────

	/**
	 * @param {object} ctx
	 * @param {HTMLElement} ctx.box      where the offer and confirm sheet render
	 * @param {string} ctx.nft           the card's mint / asset address
	 * @param {string} ctx.player        the wallet that holds it
	 * @param {string} [ctx.cardName]
	 * @param {() => Node[]} [ctx.unavailable]  what to show when no offer is open
	 * @param {() => void} [ctx.onSold]
	 */
	async _loadBuyback(ctx) {
		const { box, nft } = ctx;
		box.replaceChildren(el('div', { class: 'ga-skel ga-skel-line ga-skel-btn' }));
		try {
			const q = await gachaApi('buyback-quote', { query: { nft }, signal: this._ac.signal });
			if (!box.isConnected) return;
			if (!q.available) { box.replaceChildren(...(ctx.unavailable?.() || [])); return; }
			const until = q.expiresAt ? new Date(q.expiresAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null;
			const btn = el('button', { class: 'ga-btn ga-buyback-btn', type: 'button', onclick: () => this._confirmBuyback(ctx, q) }, `Sell back for ${q.amountUsdc} USDC`);
			box.replaceChildren(btn, el('span', { class: 'ga-dim ga-small' }, until ? `Instant buyback open until ${until}.` : 'Instant buyback is open for 72 hours after the pull.'));
		} catch (err) {
			if (this._ac.signal.aborted || !box.isConnected) return;
			box.replaceChildren(
				el('span', { class: 'ga-dim ga-small' }, err.message || 'The buyback offer is unavailable right now.'),
				el('button', { class: 'ga-btn ga-btn-sm', type: 'button', onclick: () => this._loadBuyback(ctx) }, 'Check again'),
			);
		}
	}

	async _confirmBuyback(ctx, quote) {
		const { box, nft, player } = ctx;
		box.replaceChildren(el('span', { class: 'ga-dim' }, 'Preparing the buyback…'));
		let prep;
		try {
			prep = await gachaApi('buyback', { body: { player, nft }, signal: this._ac.signal });
		} catch (err) {
			box.replaceChildren(el('p', { class: 'ga-note is-warn' }, err.message), el('button', { class: 'ga-btn', type: 'button', onclick: () => this._loadBuyback(ctx) }, 'Try again'));
			return;
		}
		const amount = prep.refundUsdc || quote.amountUsdc;
		const go = el('button', { class: 'ga-btn ga-primary', type: 'button' }, 'Approve sale in wallet');
		const note = el('p', { class: 'ga-note', role: 'status' });
		go.addEventListener('click', () => this._signBuyback(ctx, prep, amount, go, note));
		box.replaceChildren(el('div', { class: 'ga-sheet ga-sheet-inline' }, [
			el('table', { class: 'ga-table ga-confirm-table' }, el('tbody', {}, [
				['You send', `${ctx.cardName || 'This card'} (NFT ${shortAddr(nft)})`],
				['You receive', el('strong', { class: 'ga-pay' }, `${amount} USDC`)],
				['To', shortAddr(player)],
				['Chain', this.net === 'devnet' ? 'Solana devnet' : 'Solana'],
				['Buyer', 'Collector Crypt buyback program'],
			].map(([k, v]) => el('tr', {}, [el('th', { scope: 'row' }, k), el('td', {}, v)])))),
			el('p', { class: 'ga-dim ga-small' }, 'Selling is final: the card NFT and its vaulted slab go to Collector Crypt.'),
			el('div', { class: 'ga-actions' }, [el('button', { class: 'ga-btn', type: 'button', onclick: () => this._loadBuyback(ctx) }, 'Keep the card'), go]),
			note,
		]));
		go.focus();
	}

	async _signBuyback(ctx, prep, amount, btn, note) {
		const { box, nft, player } = ctx;
		btn.disabled = true;
		btn.textContent = 'Waiting for your wallet…';
		let signedB64;
		try {
			const { tx, versioned } = await decodeTx(prep.transaction);
			const signed = await detectSolanaWallet().signTransaction(tx);
			signedB64 = serializeSigned(signed, versioned);
		} catch (err) {
			btn.disabled = false;
			btn.textContent = 'Approve sale in wallet';
			note.textContent = walletError(err);
			note.classList.add('is-warn');
			return;
		}
		btn.textContent = 'Selling…';
		try {
			const r = await gachaApi('buyback-submit', { body: { player, nft, signedTransaction: signedB64 }, signal: this._ac.signal });
			this._cardsDirty = true;
			(this._sold ||= new Set()).add(nft);
			box.replaceChildren(el('p', { class: 'ga-turbo-note' }, [
				`Sold. ${amount} USDC is on its way to your wallet. `,
				r.signature ? el('a', { class: 'ga-link', href: solanaTxExplorerUrl(this.net, r.signature), target: '_blank', rel: 'noopener' }, 'View ↗') : null,
			]));
			this._say(`Card sold back for ${amount} USDC.`);
			ctx.onSold?.();
		} catch (err) {
			btn.disabled = false;
			btn.textContent = 'Approve sale in wallet';
			note.textContent = err.message;
			note.classList.add('is-warn');
		}
	}

	// ── My cards ──────────────────────────────────────────────────────────

	_cardsBack() {
		return this.machine ? 'detail' : 'machines';
	}

	async _renderMyCards() {
		if (this.inFlight) return;
		this.result = null;
		this._owned = null;
		const back = this._cardsBack();
		if (!detectSolanaWallet()) {
			this._setView('cards', el('div', { class: 'ga-state' }, [
				el('div', { class: 'ga-state-icon', 'aria-hidden': 'true' }, '◇'),
				el('p', { class: 'ga-state-title' }, 'Connect a Solana wallet to see your cards'),
				el('p', {}, 'Your cards live in your own wallet as NFTs. Install one of these, then reload this page.'),
				el('div', { class: 'ga-actions' }, WALLET_INSTALL.map(([name, href]) => el('a', { class: 'ga-btn', href, target: '_blank', rel: 'noopener' }, name))),
			]), { back });
			return;
		}
		const req = {};
		this._cardsReq = req;
		this._setView('cards', [
			el('div', { class: 'ga-cards-sum ga-skel-row', 'aria-hidden': 'true' }, Array.from({ length: 3 }, () => el('div', { class: 'ga-stat' }, [el('span', { class: 'ga-skel ga-skel-stat' }), el('span', { class: 'ga-skel ga-skel-line short' })]))),
			el('div', { class: 'ga-own-grid', 'aria-busy': 'true', 'aria-label': 'Loading your cards' }, Array.from({ length: 8 }, () => el('div', { class: 'ga-own ga-own-skel' }, [
				el('span', { class: 'ga-skel ga-skel-card' }), el('span', { class: 'ga-skel ga-skel-line' }), el('span', { class: 'ga-skel ga-skel-line short' }),
			]))),
		], { back });
		this._say('Reading your cards from Solana');
		const stale = () => this._cardsReq !== req || this.view !== 'cards';

		let owner;
		try {
			owner = await this._refreshWallet(true);
		} catch (err) {
			if (stale()) return;
			const msg = /reject|denied|cancel|declin|user/i.test(String(err?.message || '')) ? 'The wallet connection was cancelled.' : walletError(err);
			this._setView('cards', this._errorBlock(msg, 'Connect wallet', () => this._renderMyCards()), { back });
			return;
		}
		if (stale()) return;
		if (!owner) {
			this._setView('cards', this._errorBlock('Your wallet did not share an address. Unlock it and try again.', 'Connect wallet', () => this._renderMyCards()), { back });
			return;
		}

		this._cardsQ = '';
		let data;
		try {
			data = await this._fetchCardsPage(owner, { offset: 0, fresh: this._cardsDirty });
		} catch (err) {
			if (this._ac.signal.aborted || stale()) return;
			this._setView('cards', this._errorBlock(err.message || 'Your cards could not be read right now.', 'Try again', () => this._renderMyCards()), { back });
			return;
		}
		if (stale()) return;
		this._cardsDirty = false;
		this._cards = this._cardsState(data);
		this._renderCardsGrid(this._cards);
	}

	_fetchCardsPage(owner, { offset = 0, q = this._cardsQ || '', fresh = false } = {}) {
		const query = { owner, ...(offset ? { offset: String(offset) } : {}), ...(q ? { q } : {}), ...(fresh ? { fresh: '1' } : {}) };
		return gachaApi('cards', { query, signal: this._ac.signal, timeoutMs: 60_000 });
	}

	// Everything the cards view shows, accumulated across "Show more" pages.
	_cardsState(data, prev = null) {
		return {
			owner: data.owner,
			q: data.q || '',
			cards: [...(prev?.cards || []), ...(data.cards || [])],
			total: Number(data.total ?? data.count ?? 0),
			walletTotal: Number(data.walletTotal ?? data.total ?? data.count ?? 0),
			pageSize: Number(data.pageSize) || 60,
			nextOffset: data.nextOffset ?? null,
			partial: !!data.partial,
			fetchedAt: data.fetchedAt,
		};
	}

	_renderCardsGrid(st) {
		this._owned = null;
		const back = this._cardsBack();
		const refresh = el('button', { class: 'ga-btn ga-btn-sm', type: 'button', onclick: () => { this._cardsDirty = true; this._renderMyCards(); } }, 'Refresh');
		const walletRow = el('div', { class: 'ga-cards-wallet' }, [
			el('span', { class: 'ga-dot ga-dot-on', 'aria-hidden': 'true' }),
			el('a', { class: 'ga-mono', href: this.net === 'devnet' ? `https://explorer.solana.com/address/${st.owner}?cluster=devnet` : `https://solscan.io/account/${st.owner}`, target: '_blank', rel: 'noopener' }, shortAddr(st.owner)),
			st.fetchedAt ? el('span', { class: 'ga-dim ga-small' }, `read ${timeAgo(st.fetchedAt)}`) : null,
			refresh,
		]);
		const partial = st.partial ? el('p', { class: 'ga-note is-warn', role: 'status' }, 'Solana was busy, so some cards may be missing from this list. Refresh to read the wallet again.') : null;

		if (!st.walletTotal && !st.q) {
			this._setView('cards', [
				walletRow,
				partial,
				el('div', { class: 'ga-state' }, [
					el('div', { class: 'ga-state-icon ga-state-gold', 'aria-hidden': 'true' }, '◎'),
					el('p', { class: 'ga-state-title' }, 'No graded cards in this wallet yet'),
					el('p', {}, 'Every card you pull here lands in this wallet as an NFT and shows up in this list, ready to inspect in 3D or sell back. Cards bought on Collector Crypt appear here too.'),
					el('div', { class: 'ga-actions' }, [
						el('a', { class: 'ga-btn', href: COLLECTOR_CRYPT_MARKET_URL, target: '_blank', rel: 'noopener' }, 'Browse the marketplace ↗'),
						el('button', { class: 'ga-btn ga-primary', type: 'button', onclick: () => (this.machine ? this._renderDetail(this.machine) : this._back()) }, 'Pull your first card'),
					]),
				]),
			], { back });
			return;
		}

		const sum = el('div', { class: 'ga-cards-sum' });
		const results = el('div', { class: 'ga-cards-results' });
		const search = st.walletTotal > st.pageSize || st.q ? this._cardsSearch(st) : null;
		this._cardsUi = { sum, results };
		this._setView('cards', [walletRow, sum, search, partial, results], { back });
		this._fillCards(st);
		if (this._cardsScroll) {
			this.body.scrollTop = this._cardsScroll;
			this._cardsScroll = 0;
		}
	}

	// Stats over what is loaded; the count is always the whole wallet (or every
	// match), so a long collection never reads as smaller than it is.
	_renderCardsSum(st, cards) {
		const all = st.nextOffset == null;
		const stat = (value, label) => el('div', { class: 'ga-stat' }, [el('span', { class: 'ga-stat-v' }, value), el('span', { class: 'ga-stat-l' }, label)]);
		const insured = cards.reduce((s, c) => s + (c.insuredValue || 0), 0);
		const n = st.q ? st.total : st.walletTotal;
		this._cardsUi.sum.replaceChildren(
			stat(n.toLocaleString(), st.q ? (n === 1 ? 'match' : 'matches') : n === 1 ? 'card' : 'cards'),
			stat(insured ? usd(insured, { cents: false }) : 'Unlisted', all ? 'insured value' : `insured, ${cards.length.toLocaleString()} shown`),
			stat(String(cards.filter((c) => c.buyback?.available).length), all ? 'sellable now' : 'sellable, shown'),
		);
	}

	_fillCards(st) {
		// A card sold this session can take a few seconds to leave the wallet
		// on-chain; it never reappears in the list meanwhile.
		const cards = st.cards.filter((c) => !this._sold?.has(c.address));
		this._renderCardsSum(st, cards);
		const { results } = this._cardsUi;
		if (!cards.length) {
			results.replaceChildren(st.q
				? el('div', { class: 'ga-state' }, [
					el('div', { class: 'ga-state-icon', 'aria-hidden': 'true' }, '⌕'),
					el('p', { class: 'ga-state-title' }, `No cards match "${st.q}"`),
					el('p', {}, 'Search looks at every card in this wallet by name, set number, year and grade. Try fewer words, or clear the search.'),
					el('div', { class: 'ga-actions' }, [el('button', { class: 'ga-btn ga-primary', type: 'button', onclick: () => this._searchCards('', { clearInput: true }) }, 'Clear search')]),
				])
				: el('div', { class: 'ga-state' }, [
					el('div', { class: 'ga-state-icon ga-state-gold', 'aria-hidden': 'true' }, '◎'),
					el('p', { class: 'ga-state-title' }, 'Every card on this page was sold back'),
					el('p', {}, 'The USDC is in your wallet. Refresh to read the rest of the wallet again.'),
					el('div', { class: 'ga-actions' }, [el('button', { class: 'ga-btn ga-primary', type: 'button', onclick: () => { this._cardsDirty = true; this._renderMyCards(); } }, 'Refresh')]),
				]));
			return;
		}
		const sellable = cards.filter((c) => c.buyback?.available);
		const sellGrid = el('div', { class: 'ga-own-grid' }, sellable.map((c) => this._ownedTile(c)));
		const sellWrap = el('section', { class: 'ga-cards-sell', 'aria-label': 'Cards you can sell back now', hidden: !sellable.length }, [el('h4', { class: 'ga-h4' }, 'Sellable now'), sellGrid]);
		const allHead = el('h4', { class: 'ga-h4', hidden: !sellable.length }, st.q ? 'Matching cards' : 'All cards');
		const grid = el('div', { class: 'ga-own-grid' }, cards.filter((c) => !c.buyback?.available).map((c) => this._ownedTile(c)));
		const more = el('div', { class: 'ga-cards-more' });
		Object.assign(this._cardsUi, { sellWrap, sellGrid, allHead, grid, more });
		results.replaceChildren(sellWrap, allHead, grid, more);
		this._renderCardsMore(st);
	}

	_renderCardsMore(st, note = null) {
		const { more } = this._cardsUi;
		const shown = st.cards.length;
		if (st.nextOffset == null) {
			more.replaceChildren(shown > st.pageSize ? el('p', { class: 'ga-dim ga-small' }, `All ${st.total.toLocaleString()} ${st.q ? 'matching cards' : 'cards'} shown.`) : null);
			return;
		}
		const next = Math.min(st.pageSize, st.total - shown);
		more.replaceChildren(
			el('button', { class: 'ga-btn ga-more', type: 'button', onclick: (e) => this._loadMoreCards(e.currentTarget) }, `Show ${next} more`),
			el('p', { class: 'ga-dim ga-small' }, `${shown.toLocaleString()} of ${st.total.toLocaleString()} shown`),
			note,
		);
	}

	async _loadMoreCards(btn) {
		const st = this._cards;
		if (!st || st.nextOffset == null || this._cardsMoreBusy) return;
		this._cardsMoreBusy = true;
		const hadFocus = document.activeElement === btn;
		btn.disabled = true;
		btn.textContent = 'Loading cards…';
		btn.setAttribute('aria-busy', 'true');
		const req = this._cardsReq;
		let data;
		try {
			data = await this._fetchCardsPage(st.owner, { offset: st.nextOffset, q: st.q });
		} catch (err) {
			this._cardsMoreBusy = false;
			if (this._ac.signal.aborted || req !== this._cardsReq || this._cards !== st) return;
			this._renderCardsMore(st, el('p', { class: 'ga-note is-warn', role: 'alert' }, `${err.message || 'More cards could not be read right now.'} Press Show more to try again.`));
			return;
		}
		this._cardsMoreBusy = false;
		if (req !== this._cardsReq || this._cards !== st || this.view !== 'cards') return;
		const next = this._cardsState(data, st);
		this._cards = next;
		const fresh = (data.cards || []).filter((c) => !this._sold?.has(c.address));
		const sellable = fresh.filter((c) => c.buyback?.available);
		const { sellWrap, sellGrid, allHead, grid } = this._cardsUi;
		sellGrid.append(...sellable.map((c) => this._ownedTile(c)));
		grid.append(...fresh.filter((c) => !c.buyback?.available).map((c) => this._ownedTile(c)));
		if (sellGrid.children.length) {
			sellWrap.hidden = false;
			allHead.hidden = false;
		}
		this._renderCardsSum(next, next.cards.filter((c) => !this._sold?.has(c.address)));
		this._renderCardsMore(next);
		if (hadFocus) (this._cardsUi.more.querySelector('button') || grid.lastElementChild)?.focus({ preventScroll: true });
		this._say(`${fresh.length} more cards loaded. ${next.cards.length} of ${next.total} shown.`);
	}

	_cardsSearch(st) {
		const input = el('input', {
			class: 'ga-search-input',
			type: 'search',
			value: st.q,
			placeholder: `Search ${st.walletTotal.toLocaleString()} cards by name, year or grade`,
			'aria-label': 'Search your cards',
			maxlength: '80',
			autocomplete: 'off',
			spellcheck: 'false',
			oninput: () => {
				clearTimeout(this._searchTimer);
				this._searchTimer = setTimeout(() => this._searchCards(input.value), 350);
			},
			onkeydown: (e) => {
				if (e.key === 'Enter') {
					clearTimeout(this._searchTimer);
					this._searchCards(input.value);
				}
			},
		});
		this._cardsSearchInput = input;
		return el('div', { class: 'ga-search', role: 'search' }, [el('span', { class: 'ga-search-icon', 'aria-hidden': 'true' }, '⌕'), input]);
	}

	async _searchCards(raw, { clearInput = false, force = false } = {}) {
		const st = this._cards;
		if (!st || this.view !== 'cards') return;
		const q = String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 80);
		if (clearInput && this._cardsSearchInput) this._cardsSearchInput.value = '';
		if (!force && q.toLowerCase() === st.q.toLowerCase()) return;
		this._cardsQ = q;
		const req = {};
		this._cardsReq = req;
		const { results } = this._cardsUi;
		results.setAttribute('aria-busy', 'true');
		results.replaceChildren(el('div', { class: 'ga-own-grid', 'aria-label': 'Searching your cards' }, Array.from({ length: 8 }, () => el('div', { class: 'ga-own ga-own-skel' }, [
			el('span', { class: 'ga-skel ga-skel-card' }), el('span', { class: 'ga-skel ga-skel-line' }), el('span', { class: 'ga-skel ga-skel-line short' }),
		]))));
		let data;
		try {
			data = await this._fetchCardsPage(st.owner, { offset: 0, q });
		} catch (err) {
			if (this._ac.signal.aborted || req !== this._cardsReq || this.view !== 'cards') return;
			results.removeAttribute('aria-busy');
			results.replaceChildren(this._errorBlock(err.message || 'The search could not run right now.', 'Try again', () => this._searchCards(q, { force: true })));
			return;
		}
		if (req !== this._cardsReq || this.view !== 'cards') return;
		results.removeAttribute('aria-busy');
		this._cards = this._cardsState(data);
		this._fillCards(this._cards);
		this._say(q ? `${this._cards.total} cards match ${q}` : `Showing all ${this._cards.walletTotal} cards`);
	}

	_ownedTile(c) {
		const tier = TIER_STYLE[c.tier] || null;
		const meta = [c.grader && c.grade ? `${c.grader} ${c.grade}` : null, c.insuredValue ? usd(c.insuredValue, { cents: false }) : null].filter(Boolean).join(' · ');
		const sell = c.buyback?.available ? `Sell ${c.buyback.amountUsdc} USDC` : null;
		const tile = el('button', {
			class: 'ga-own',
			type: 'button',
			style: tier ? { '--ga-tier': tier.color } : {},
			'aria-label': [c.name || 'Graded card', meta, sell ? `instant buyback ${c.buyback.amountUsdc} USDC` : null].filter(Boolean).join(', '),
			onclick: () => {
				this._cardsScroll = this.body.scrollTop;
				this._renderOwnedCard(c);
			},
		}, [
			el('span', { class: 'ga-own-art' }, [
				cardImg(c.image, { width: 320, alt: '', cls: 'ga-img ga-own-img' }),
				el('span', { class: 'ga-own-foil', 'aria-hidden': 'true' }),
				el('span', { class: 'ga-own-glare', 'aria-hidden': 'true' }),
			]),
			sell ? el('span', { class: 'ga-sell-badge' }, sell) : null,
			el('span', { class: 'ga-own-name' }, c.name || 'Graded card'),
			meta ? el('span', { class: 'ga-dim ga-own-meta' }, meta) : null,
		]);
		bindTilt(tile);
		return tile;
	}

	_renderOwnedCard(c) {
		this._owned = c;
		const tier = TIER_STYLE[c.tier] || null;
		const facts = [
			c.grader || c.grade ? ['Grade', [c.grader, c.grade].filter(Boolean).join(' ')] : null,
			c.set ? ['Set', c.set] : null,
			c.year ? ['Year', c.year] : null,
			c.category ? ['Category', c.category] : null,
			c.insuredValue ? ['Insured value', usd(c.insuredValue)] : null,
			['Standard', c.standard === 'pnft' ? 'Programmable NFT' : 'Metaplex Core'],
			['Mint', el('a', { class: 'ga-mono', href: this._nftExplorerUrl(c.address), target: '_blank', rel: 'noopener' }, shortAddr(c.address))],
		].filter(Boolean);
		const market = () => [
			el('p', { class: 'ga-dim ga-small' }, 'The 72 hour instant buyback for this card has closed. You can still list it for sale, or redeem the physical slab, on Collector Crypt.'),
			el('a', { class: 'ga-btn ga-btn-sm', href: COLLECTOR_CRYPT_CARD_URL(c.address), target: '_blank', rel: 'noopener' }, 'Sell or redeem on Collector Crypt ↗'),
		];
		const sellBox = el('div', { class: 'ga-buyback' });
		const info = el('div', { class: 'ga-reveal-info' }, [
			tier ? el('span', { class: 'ga-tier-pill', style: { '--ga-tier': tier.color } }, tier.label) : null,
			el('h3', { class: 'ga-h3 ga-reveal-name' }, c.name || 'Graded card'),
			c.title && c.title !== c.name ? el('p', { class: 'ga-dim' }, c.title) : null,
			el('dl', { class: 'ga-dl' }, facts.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])),
			el('h4', { class: 'ga-h4' }, 'Sell'),
			sellBox,
			el('div', { class: 'ga-links' }, [
				el('a', { class: 'ga-link', href: COLLECTOR_CRYPT_CARD_URL(c.address), target: '_blank', rel: 'noopener' }, 'View on Collector Crypt ↗'),
				el('a', { class: 'ga-link', href: this._nftExplorerUrl(c.address), target: '_blank', rel: 'noopener' }, 'NFT on explorer ↗'),
			]),
		]);
		const stageBox = el('div', { class: `ga-stage ga-stage-3d is-${tier ? c.tier : 'owned'}`, style: { '--ga-glow': (tier || TIER_STYLE.uncommon).glow, '--ga-tier': (tier || TIER_STYLE.uncommon).color } });
		const controls = this._stageControls();
		this._setView('owned', el('div', { class: 'ga-reveal' }, [el('div', { class: 'ga-stage-col' }, [stageBox, controls]), info]), { back: 'cards' });
		this._mountStage(stageBox, c, { intro: false, controls });

		const onSold = () => {
			sellBox.append(el('button', { class: 'ga-btn ga-btn-sm', type: 'button', onclick: () => this._renderMyCards() }, 'Back to my cards'));
		};
		if (c.buyback?.available === false) sellBox.replaceChildren(...market());
		else this._loadBuyback({ box: sellBox, nft: c.address, player: this._cards?.owner || this.address, cardName: c.name, unavailable: market, onSold });
	}

	// ── resume a pack from an earlier session ─────────────────────────────

	_renderResume(p) {
		const m = (this.machines || []).find((x) => x.code === p.code) || null;
		if (m) this.machine = m;
		this.pull = { memo: p.memo, machine: m, player: p.player, signature: p.signature || null };
		this._setView('resume', el('div', { class: 'ga-state' }, [
			el('div', { class: 'ga-state-icon ga-state-gold', 'aria-hidden': 'true' }, '◎'),
			el('p', { class: 'ga-state-title' }, 'You have an unopened pack'),
			el('p', {}, `From ${p.name || 'a gacha machine'}, started ${timeAgo(new Date(p.at).toISOString())}.`),
			el('div', { class: 'ga-actions' }, [
				el('button', { class: 'ga-btn', type: 'button', onclick: () => { writePending(null); this._renderMachines(); } }, 'Dismiss'),
				el('button', { class: 'ga-btn ga-primary', type: 'button', onclick: () => this._awaitPack(p.memo, p.signature || null) }, 'Open it'),
			]),
		]));
	}
}
