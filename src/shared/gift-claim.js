// Shared "claim your gifts" card for seasonal drops.
//
// One component, mounted wherever a player might look for their gifts: the
// account Settings page, the classic homepage and /play. It talks only to
// GET/POST /api/seasonal/:id (api/seasonal/[id].js), which is the authority on the
// window and on what a claim grants; nothing here decides eligibility.
//
// States, all designed: loading skeleton, load error with retry, upcoming
// (countdown), live and signed out (sign-in link that returns here), live and
// unclaimed (Claim button), claimed (kept gifts, plus a retry when the /play
// wearables have not synced yet), and ended without a claim (closed notice).

import { apiFetch } from '../api.js';
import { formatCountdown, markClaimedLocally } from './seasonal-drops.js';
import { celebrateWithConfetti } from './halloween-fx.js';

export const DEFAULT_DROP_ID = 'halloween-2026';

const CSS = `
.twx-gift{--g-accent:#ff7a1a;box-sizing:border-box;width:100%;max-width:560px;padding:16px 18px;border-radius:14px;
	border:1px solid rgba(255,122,26,.35);background:linear-gradient(160deg,rgba(255,122,26,.12),rgba(127,127,127,.06));
	color:inherit;font:inherit;text-align:left}
.twx-gift *{box-sizing:border-box}
.twx-gift-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.twx-gift-title{margin:0;font-size:1.05em;font-weight:700}
.twx-gift-tag{font-size:.72em;letter-spacing:.12em;text-transform:uppercase;padding:3px 9px;border-radius:999px;
	background:rgba(255,122,26,.18);border:1px solid rgba(255,122,26,.45)}
.twx-gift-tag[data-phase="ended"]{background:rgba(127,127,127,.15);border-color:rgba(127,127,127,.4)}
.twx-gift-msg{margin:10px 0 0;font-size:.9em;opacity:.85;line-height:1.45}
.twx-gift-list{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:8px}
.twx-gift-item{display:flex;align-items:center;gap:12px;padding:8px 10px;border-radius:10px;background:rgba(127,127,127,.1)}
.twx-gift-art{flex:none;width:44px;height:44px;border-radius:9px;display:grid;place-items:center;font-size:24px;
	background:rgba(127,127,127,.14);overflow:hidden}
.twx-gift-art img{width:100%;height:100%;object-fit:cover;display:block}
.twx-gift-name{font-weight:600;font-size:.92em}
.twx-gift-detail{font-size:.8em;opacity:.75;line-height:1.35}
.twx-gift-item[data-owned="true"] .twx-gift-name::after{content:" \\2713";color:#3ecf8e}
.twx-gift-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
.twx-gift-btn{appearance:none;cursor:pointer;font:inherit;font-weight:700;padding:10px 18px;border-radius:10px;
	border:1px solid var(--g-accent);background:var(--g-accent);color:#1a0b00;text-decoration:none;display:inline-block;
	transition:transform .12s ease,filter .12s ease,box-shadow .12s ease}
.twx-gift-btn:hover{filter:brightness(1.08);transform:translateY(-1px)}
.twx-gift-btn:active{transform:translateY(0);filter:brightness(.95)}
.twx-gift-btn:focus-visible{outline:2px solid currentColor;outline-offset:3px}
.twx-gift-btn[disabled]{opacity:.6;cursor:progress;transform:none}
.twx-gift-btn.ghost{background:transparent;color:inherit;border-color:rgba(127,127,127,.5)}
.twx-gift-err{margin:10px 0 0;font-size:.85em;color:#ff6b6b}
.twx-gift-skel{height:12px;border-radius:6px;margin-top:10px;background:linear-gradient(90deg,rgba(127,127,127,.12),rgba(127,127,127,.25),rgba(127,127,127,.12));
	background-size:200% 100%;animation:twx-gift-sk 1.2s linear infinite}
.twx-gift-pop{animation:twx-gift-pop .5s ease-out}
@keyframes twx-gift-sk{to{background-position:-200% 0}}
@keyframes twx-gift-pop{0%{transform:scale(.97);box-shadow:0 0 0 0 rgba(255,122,26,.6)}100%{transform:scale(1);box-shadow:0 0 0 18px rgba(255,122,26,0)}}
@media (prefers-reduced-motion:reduce){.twx-gift-skel,.twx-gift-pop{animation:none}.twx-gift-btn{transition:none}}
`;

function injectStyles() {
	if (document.getElementById('twx-gift-css')) return;
	const s = document.createElement('style');
	s.id = 'twx-gift-css';
	s.textContent = CSS;
	document.head.appendChild(s);
}

function h(tag, attrs = {}, kids = []) {
	const n = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (v == null || v === false) continue;
		if (k === 'text') n.textContent = v;
		else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
		else n.setAttribute(k, v === true ? '' : v);
	}
	for (const c of [].concat(kids)) if (c) n.append(c);
	return n;
}

/** Message for a failed claim response body, never a raw status. */
export function claimErrorMessage(status, data) {
	if (status === 401) return 'Your session expired. Sign in again to claim.';
	if (status === 409) return 'This drop has not opened yet.';
	if (status === 410) return 'This drop has closed. Its gifts were only claimable during the window.';
	if (status === 429) return 'Too many attempts. Wait a moment and try again.';
	return data?.error_description || 'The claim did not go through. Check your connection and try again.';
}

function giftArt(g, owned) {
	const art = h('div', { class: 'twx-gift-art', 'aria-hidden': 'true' });
	if (g.thumb) art.append(h('img', { src: g.thumb, alt: '', loading: 'lazy', width: '44', height: '44' }));
	else if (g.swatch) art.style.background = `radial-gradient(circle,${g.swatch},rgba(0,0,0,.55))`;
	else art.textContent = g.icon || (g.kind === 'wallpaper' ? '🏞' : '🎁');
	return h('li', { class: 'twx-gift-item', 'data-owned': String(!!owned) }, [
		art,
		h('div', {}, [h('div', { class: 'twx-gift-name', text: g.name }), h('div', { class: 'twx-gift-detail', text: g.detail })]),
	]);
}

/**
 * Mount the card into `root`. Returns { refresh, destroy }.
 * `onClaimed(drop)` fires after a claim lands (not on a later re-sync).
 * `onState(drop|null)` fires with each loaded drop (null on load failure).
 * `hideWhenClosed` renders nothing once the window ended and nothing was claimed.
 */
export function mountGiftClaim(root, { dropId = DEFAULT_DROP_ID, onClaimed, onState, hideWhenClosed = false } = {}) {
	injectStyles();
	let timer = 0;
	let destroyed = false;

	const stopTimer = () => { if (timer) clearInterval(timer); timer = 0; };

	function skeleton() {
		stopTimer();
		root.replaceChildren(h('section', { class: 'twx-gift', 'aria-busy': 'true', 'aria-label': 'Loading gifts' }, [
			h('div', { class: 'twx-gift-skel', style: 'width:55%' }),
			h('div', { class: 'twx-gift-skel', style: 'width:90%' }),
			h('div', { class: 'twx-gift-skel', style: 'width:75%' }),
		]));
	}

	function failure(message) {
		stopTimer();
		onState?.(null);
		root.replaceChildren(h('section', { class: 'twx-gift', role: 'alert' }, [
			h('h3', { class: 'twx-gift-title', text: 'Could not load your gifts' }),
			h('p', { class: 'twx-gift-err', text: message }),
			h('div', { class: 'twx-gift-actions' }, [h('button', { class: 'twx-gift-btn', type: 'button', text: 'Try again', onclick: load })]),
		]));
	}

	function render(drop, { justClaimed = false, error = '' } = {}) {
		stopTimer();
		const claim = drop.claim || {};
		const claimed = !!claim.claimed;
		const phase = drop.phase;
		onState?.(drop);
		if (hideWhenClosed && phase === 'ended' && !claimed) return root.replaceChildren();
		const offset = Date.parse(drop.serverTime) - Date.now();
		const card = h('section', { class: 'twx-gift' + (justClaimed ? ' twx-gift-pop' : ''), 'aria-label': `${drop.name} gifts` });
		const tagText = claimed ? 'Claimed' : phase === 'live' ? 'Live now' : phase === 'upcoming' ? 'Coming soon' : 'Closed';
		card.append(h('div', { class: 'twx-gift-head' }, [
			h('h3', { class: 'twx-gift-title', text: `${drop.name} gifts` }),
			h('span', { class: 'twx-gift-tag', 'data-phase': claimed ? 'live' : phase, text: tagText }),
		]));

		const msg = h('p', { class: 'twx-gift-msg' });
		const actions = h('div', { class: 'twx-gift-actions' });
		const setMsg = () => {
			const now = Date.now() + offset;
			if (claimed) {
				msg.textContent = claim.wearablesSynced === false
					? 'Your badge is saved. Your /play wearables are still syncing: press Retry sync.'
					: 'These are yours for good. Open the wardrobe in /play to wear them, and find the wallpaper in desktop Settings.';
			} else if (phase === 'live') {
				const left = Date.parse(drop.endsAt) - now;
				msg.textContent = claim.signedIn
					? `Free for every account. Closes in ${formatCountdown(left)}.`
					: `Sign in to claim. Closes in ${formatCountdown(left)}.`;
			} else if (phase === 'upcoming') {
				msg.textContent = `Opens in ${formatCountdown(Date.parse(drop.startsAt) - now)}.`;
			} else {
				msg.textContent = 'The claim window has ended. These gifts were only available during the weekend.';
			}
		};
		setMsg();
		card.append(msg);
		if (error) card.append(h('p', { class: 'twx-gift-err', role: 'alert', text: error }));

		card.append(h('ul', { class: 'twx-gift-list' }, drop.gifts.map((g) => giftArt(g, claimed))));

		if (claimed && claim.wearablesSynced === false) {
			actions.append(h('button', { class: 'twx-gift-btn', type: 'button', text: 'Retry sync', onclick: (e) => doClaim(e.currentTarget) }));
		} else if (!claimed && phase === 'live') {
			if (claim.signedIn) {
				actions.append(h('button', { class: 'twx-gift-btn', type: 'button', text: 'Claim all gifts', onclick: (e) => doClaim(e.currentTarget) }));
			} else {
				const next = encodeURIComponent(location.pathname + location.search + location.hash);
				actions.append(h('a', { class: 'twx-gift-btn', href: `/login?next=${next}`, text: 'Sign in to claim' }));
			}
		}
		if (actions.childNodes.length) card.append(actions);
		root.replaceChildren(card);

		if (!claimed && (phase === 'live' || phase === 'upcoming')) {
			timer = setInterval(() => {
				if (destroyed || !card.isConnected) return stopTimer();
				const now = Date.now() + offset;
				const edge = Date.parse(phase === 'live' ? drop.endsAt : drop.startsAt);
				if (now >= edge) { stopTimer(); load(); } else setMsg();
			}, 1000);
		}
	}

	async function doClaim(btn) {
		btn.disabled = true;
		btn.textContent = 'Claiming...';
		try {
			const res = await apiFetch(`/api/seasonal/${encodeURIComponent(dropId)}`, { method: 'POST' });
			const data = await res.json().catch(() => null);
			if (!res.ok) {
				const cur = await fetchDrop().catch(() => null);
				return cur ? render(cur, { error: claimErrorMessage(res.status, data) }) : failure(claimErrorMessage(res.status, data));
			}
			markClaimedLocally(data.claim?.claimedAt);
			render(data, { justClaimed: !!data.claim?.newlyClaimed });
			if (data.claim?.newlyClaimed) {
				celebrateWithConfetti(root.querySelector('.twx-gift'));
				onClaimed?.(data);
			}
		} catch (err) {
			btn.disabled = false;
			btn.textContent = 'Try again';
			root.querySelector('.twx-gift')?.append(h('p', { class: 'twx-gift-err', role: 'alert', text: claimErrorMessage(0, null) }));
		}
	}

	async function fetchDrop() {
		const res = await fetch(`/api/seasonal/${encodeURIComponent(dropId)}`, { credentials: 'include', headers: { accept: 'application/json' } });
		if (!res.ok) throw new Error(`The gifts service answered ${res.status}.`);
		return res.json();
	}

	async function load() {
		skeleton();
		try {
			const drop = await fetchDrop();
			if (destroyed) return;
			if (drop.claim?.claimed) markClaimedLocally(drop.claim.claimedAt);
			render(drop);
		} catch (err) {
			if (!destroyed) failure(err?.message || 'Could not reach the gifts service.');
		}
	}

	load();
	return { refresh: load, destroy() { destroyed = true; stopTimer(); root.replaceChildren(); } };
}
