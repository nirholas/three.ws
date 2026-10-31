// Halloween Weekend 2026 on /play: lobby banner, in-world pill, claim flow and
// a moonlit orange vignette over the world.
//
// Self-attaching, like event-countdown.js: no edits to coincommunities.js. The
// drop (gifts, window, per-viewer claim state) comes from GET /api/seasonal/:id,
// which is the authority; src/shared/seasonal-drops.js only supplies the window
// so the look can switch on before the first network round trip. Claiming POSTs
// the same endpoint the site uses. The wearables land in the account's grant
// ledger, which the /play profile already merges, so they show up in My
// Cosmetics the next time a world is joined.
//
// Outside the window (and for anyone who never claimed) the module mounts
// nothing. Someone who claimed keeps a quiet "worn forever" note in the lobby
// after the weekend, since their gifts stay equippable.

import { celebrateWithConfetti, startHalloweenPageFx } from '../shared/halloween-fx.js';
import { HALLOWEEN_2026, dropPhase, formatCountdown, isHalloweenLive, seasonalLookEnabled, setSeasonalLookEnabled, markClaimedLocally } from '../shared/seasonal-drops.js';

const DROP_URL = `/api/seasonal/${HALLOWEEN_2026.id}`;

function el(tag, attrs = {}, children = []) {
	const n = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (v == null) continue;
		if (k === 'text') n.textContent = v;
		else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
		else n.setAttribute(k, v);
	}
	for (const c of children) if (c) n.appendChild(c);
	return n;
}

const STYLE = `
.hw-banner {
	--hw-orange: #ff7a1a; --hw-ember: #ffb36b; --hw-plum: #1a0b24;
	position: relative; overflow: hidden;
	margin: 14px 0 4px; padding: 14px 16px;
	background: radial-gradient(120% 140% at 0% 0%, rgba(255,122,26,0.18), transparent 60%), var(--hw-plum);
	border: 1px solid rgba(255,122,26,0.55); border-radius: var(--cc-radius, 4px);
	color: #fbeee0; box-shadow: 0 0 22px rgba(255,122,26,0.18);
}
.hw-top { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.hw-copy { flex: 1 1 240px; min-width: 0; }
.hw-kicker { font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--hw-ember); }
.hw-title { font-family: 'Creepster', 'Impact', sans-serif; font-weight: 400; font-size: 28px; letter-spacing: 0.04em; line-height: 1.1; margin-top: 2px; color: var(--hw-orange); text-shadow: 0 0 14px rgba(255,122,26,0.45); }
.hw-sub { font-size: 12.5px; line-height: 1.45; color: #d9c3ad; margin-top: 3px; }
.hw-clock { font-variant-numeric: tabular-nums; font-size: 13px; color: var(--hw-ember); margin-top: 5px; }
.hw-gifts { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; padding: 0; list-style: none; }
.hw-gift { display: flex; align-items: center; gap: 8px; padding: 6px 10px 6px 6px; border: 1px solid rgba(255,179,107,0.28); border-radius: 999px; font-size: 12px; background: rgba(0,0,0,0.25); }
.hw-gift-art { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: rgba(255,122,26,0.16); font-size: 15px; object-fit: cover; }
.hw-btn {
	display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 10px 20px;
	border: 0; border-radius: var(--cc-radius, 4px); background: var(--hw-orange); color: #1a0b24;
	font: 700 13.5px/1 inherit; text-decoration: none; white-space: nowrap; cursor: pointer;
	transition: box-shadow 0.15s ease, transform 0.15s ease, opacity 0.15s ease;
}
.hw-btn:hover { box-shadow: 0 0 18px rgba(255,122,26,0.65); transform: translateY(-1px); }
.hw-btn:active { transform: translateY(0); }
.hw-btn:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.hw-btn[disabled] { opacity: 0.6; cursor: progress; }
.hw-btn--ghost { background: transparent; color: var(--hw-ember); border: 1px solid rgba(255,179,107,0.45); }
.hw-links { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
.hw-msg { margin-top: 10px; font-size: 12.5px; color: var(--hw-ember); }
.hw-msg[data-kind="error"] { color: #ff9b8a; }
.hw-pill {
	position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 21;
	display: flex; align-items: center; gap: 10px; padding: 7px 8px 7px 13px;
	background: rgba(26,11,36,0.88); backdrop-filter: blur(8px);
	border: 1px solid rgba(255,122,26,0.6); border-radius: 999px; color: #fbeee0;
	font-size: 12.5px; font-variant-numeric: tabular-nums; transition: opacity 0.25s ease;
}
.hw-pill[hidden] { display: none; }
.hw-pill a { color: #ffb36b; text-decoration: underline; text-underline-offset: 2px; }
.hw-pill a:hover { color: #fff; }
.hw-pill a:focus-visible, .hw-pill-x:focus-visible { outline: 2px solid #fff; outline-offset: 2px; border-radius: 2px; }
.hw-pill-x { display: grid; place-items: center; width: 22px; height: 22px; border: 0; border-radius: 50%; background: transparent; color: #d9c3ad; font: inherit; font-size: 14px; cursor: pointer; }
.hw-pill-x:hover { background: rgba(255,255,255,0.12); color: #fff; }
.hw-vignette {
	position: fixed; inset: 0; z-index: 2; pointer-events: none;
	background: radial-gradient(ellipse at 50% 55%, transparent 45%, rgba(40,10,60,0.45) 85%, rgba(20,4,30,0.7) 100%);
	mix-blend-mode: multiply;
}
.hw-look { position: fixed; left: 12px; bottom: 12px; z-index: 21; }
body.is-zen .hw-pill, body.is-zen .hw-look { opacity: 0; pointer-events: none; }
@media (max-width: 640px) {
	.hw-title { font-size: 24px; }
	.hw-pill { top: auto; bottom: 196px; max-width: calc(100vw - 24px); }
}
`;

const GIFT_ICON = { cosmetic: '🎃', badge: '🏅', wallpaper: '🌙' };

class HalloweenPlay {
	constructor(drop) {
		this.drop = drop;
		this.banner = null;
		this.pill = null;
		this.vignette = null;
		this.timer = 0;
		this.busy = false;
		this.pillKey = 'hw-pill-dismissed:' + HALLOWEEN_2026.id;
		document.head.appendChild(el('link', { rel: 'stylesheet', href: '/fonts/creepster.css' }));
		document.head.appendChild(el('style', { text: STYLE }));
		this._mountBanner();
		this._mountPill();
		this._syncLook();
		this._tick();
		this.timer = setInterval(() => this._tick(), 1000);
	}

	get claimed() { return !!this.drop.claim?.claimed; }
	get phase() { return dropPhase(HALLOWEEN_2026); }

	_giftRow() {
		return el('ul', { class: 'hw-gifts', 'aria-label': 'Gifts in this drop' },
			this.drop.gifts.map((g) => el('li', { class: 'hw-gift' }, [
				g.thumb
					? el('img', { class: 'hw-gift-art', src: g.thumb, alt: '', width: '28', height: '28', loading: 'lazy' })
					: el('span', { class: 'hw-gift-art', 'aria-hidden': 'true', text: g.swatch ? '✨' : (g.icon || GIFT_ICON[g.kind] || '🎁'), style: g.swatch ? `background:${g.swatch}33` : null }),
				el('span', { text: g.name }),
			])));
	}

	_mountBanner() {
		const inner = document.querySelector('#cc-lobby .cc-lobby-inner');
		if (!inner) return;
		this.clock = el('div', { class: 'hw-clock', role: 'timer' });
		this.action = el('div', { class: 'hw-action' });
		this.msg = el('div', { class: 'hw-msg', role: 'status', 'aria-live': 'polite', hidden: true });
		this.banner = el('section', { class: 'hw-banner', 'aria-label': HALLOWEEN_2026.name }, [
			el('div', { class: 'hw-top' }, [
				el('div', { class: 'hw-copy' }, [
					el('div', { class: 'hw-kicker', text: 'Limited gifts' }),
					el('div', { class: 'hw-title', text: HALLOWEEN_2026.name }),
					el('div', { class: 'hw-sub', text: 'Claim a Pumpkin Cap and a Witchlight Aura for every /play world. They are yours to keep.' }),
					this.clock,
				]),
				this.action,
			]),
			this._giftRow(),
			el('div', { class: 'hw-links' }, [
				el('a', { class: 'hw-btn hw-btn--ghost', href: '/pumpkin', text: 'Carve a pumpkin' }),
				el('a', { class: 'hw-btn hw-btn--ghost', href: '/halloween', text: 'All gifts' }),
			]),
			this.msg,
		]);
		const head = inner.querySelector('.cc-lobby-head');
		inner.insertBefore(this.banner, head ? head.nextSibling : inner.firstChild);
		this._renderAction();
	}

	_mountPill() {
		let dismissed = false;
		try { dismissed = !!localStorage.getItem(this.pillKey); } catch { /* storage blocked */ }
		if (dismissed) return;
		this.pillText = el('span', { role: 'timer' });
		this.pillLink = el('a', { href: '#', text: 'Claim' });
		this.pillLink.addEventListener('click', (e) => { e.preventDefault(); this._claim(); });
		this.pill = el('div', { class: 'hw-pill', role: 'status', hidden: true }, [
			el('span', { 'aria-hidden': 'true', text: '🎃' }),
			this.pillText,
			this.pillLink,
			el('button', {
				type: 'button', class: 'hw-pill-x', 'aria-label': 'Dismiss Halloween reminder', title: 'Dismiss',
				onclick: () => {
					try { localStorage.setItem(this.pillKey, '1'); } catch { /* storage blocked */ }
					this.pill.remove(); this.pill = null;
				},
			}, [el('span', { 'aria-hidden': 'true', text: '×' })]),
		]);
		document.body.appendChild(this.pill);
	}

	_renderAction() {
		if (!this.action) return;
		const claim = this.drop.claim || {};
		const live = this.phase === 'live';
		let node;
		if (this.claimed) {
			node = el('span', { class: 'hw-kicker', text: 'Claimed. Equip them in My Cosmetics.' });
		} else if (!live) {
			node = null;
		} else if (!claim.signedIn) {
			node = el('a', { class: 'hw-btn', href: `/login?next=${encodeURIComponent('/play')}`, text: 'Sign in to claim' });
		} else {
			node = el('button', { type: 'button', class: 'hw-btn', text: 'Claim gifts', onclick: () => this._claim() });
			this.claimBtn = node;
		}
		this.action.replaceChildren(...(node ? [node] : []));
	}

	_say(text, kind = 'info') {
		if (!this.msg) return;
		this.msg.textContent = text;
		this.msg.dataset.kind = kind;
		this.msg.hidden = !text;
	}

	async _claim() {
		if (this.busy) return;
		if (!this.drop.claim?.signedIn) { location.href = `/login?next=${encodeURIComponent('/play')}`; return; }
		this.busy = true;
		if (this.claimBtn) { this.claimBtn.disabled = true; this.claimBtn.textContent = 'Claiming...'; }
		try {
			const res = await fetch(DROP_URL, { method: 'POST', credentials: 'include', headers: { accept: 'application/json' } });
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(body?.error_description || (res.status === 410 ? 'This drop has closed.' : 'Could not claim right now. Try again.'));
			}
			this.drop = body;
			markClaimedLocally(body.claim?.claimedAt);
			const synced = body.claim?.wearablesSynced !== false;
			this._say(synced
				? 'Claimed. Open My Cosmetics in a world to wear your Pumpkin Cap and Witchlight Aura (rejoin if you are already in one).'
				: 'Claimed. Your wearables are still syncing: reload in a minute and they will appear in My Cosmetics.');
			this._renderAction();
			if (body.claim?.newlyClaimed) celebrateWithConfetti({ x: 0.5, y: 0.35 });
		} catch (err) {
			this._say(err.message || 'Could not claim right now. Check your connection and try again.', 'error');
			if (this.claimBtn) { this.claimBtn.disabled = false; this.claimBtn.textContent = 'Claim gifts'; }
		} finally {
			this.busy = false;
		}
	}

	_syncLook() {
		const on = isHalloweenLive() && seasonalLookEnabled();
		if (on && !this.vignette) {
			this.vignette = el('div', { class: 'hw-vignette', 'aria-hidden': 'true' });
			document.body.appendChild(this.vignette);
		} else if (!on && this.vignette) {
			this.vignette.remove(); this.vignette = null;
		}
		document.documentElement.toggleAttribute('data-halloween', on);
		if (on) startHalloweenPageFx();
		if (!this.lookBtn && isHalloweenLive()) {
			this.lookBtn = el('button', {
				type: 'button', class: 'hw-btn hw-btn--ghost hw-look', 'aria-pressed': String(seasonalLookEnabled()),
				text: 'Halloween look', title: 'Toggle the spooky vignette',
				onclick: () => {
					setSeasonalLookEnabled(!seasonalLookEnabled());
					this.lookBtn.setAttribute('aria-pressed', String(seasonalLookEnabled()));
					this._syncLook();
				},
			});
			document.body.appendChild(this.lookBtn);
		}
	}

	_tick() {
		const now = Date.now();
		const phase = dropPhase(HALLOWEEN_2026, now);
		const left = Date.parse(HALLOWEEN_2026.endsAt) - now;
		const toStart = Date.parse(HALLOWEEN_2026.startsAt) - now;
		let line;
		if (phase === 'live') line = `Ends in ${formatCountdown(left)}`;
		else if (phase === 'upcoming') line = `Opens in ${formatCountdown(toStart)}`;
		else line = 'The weekend has ended.';
		if (this.clock) this.clock.textContent = line;

		if (phase === 'ended') {
			// Window over: claimers keep their note in the lobby; everyone else
			// gets nothing, and the live-only pieces (pill, vignette) retire.
			this._syncLook();
			if (this.lookBtn) { this.lookBtn.remove(); this.lookBtn = null; }
			this.pill?.remove(); this.pill = null;
			if (!this.claimed) { this.banner?.remove(); this.banner = null; clearInterval(this.timer); }
			else this._renderAction();
			return;
		}
		if (this.pill) {
			const lobby = document.getElementById('cc-lobby');
			this.pill.hidden = !lobby || !lobby.hidden || this.claimed;
			this.pillText.textContent = `${HALLOWEEN_2026.name} · ${line}`;
		}
	}
}

async function boot() {
	if (dropPhase(HALLOWEEN_2026) === 'ended' && !(await fetchDrop())?.claim?.claimed) return;
	const drop = await fetchDrop();
	if (!drop) return;
	const mount = () => new HalloweenPlay(drop);
	if (document.querySelector('#cc-lobby .cc-lobby-inner')) return mount();
	const obs = new MutationObserver(() => {
		if (!document.querySelector('#cc-lobby .cc-lobby-inner')) return;
		obs.disconnect();
		mount();
	});
	obs.observe(document.body, { childList: true, subtree: true });
}

let _drop = null;
async function fetchDrop() {
	if (_drop) return _drop;
	try {
		const res = await fetch(DROP_URL, { credentials: 'include', headers: { accept: 'application/json' } });
		if (!res.ok) return null;
		_drop = await res.json();
		return _drop;
	} catch {
		return null;
	}
}

boot();
