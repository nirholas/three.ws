// /halloween: the Halloween Weekend 2026 gift claim.
//
// Everything shown comes from GET /api/drops/halloween-2026 (the gifts, the
// window, the server clock, and this viewer's claim). The countdown runs on the
// server's clock (offset by the measured skew), and the page re-reads the drop
// when a phase boundary passes, so it flips from "closes in" to "closed" by
// itself. The claim is POST /api/drops/halloween-2026; the server alone decides
// whether it lands.

import { HALLOWEEN_2026, formatCountdown, markClaimedLocally } from '../shared/seasonal-drops.js';

const API = `/api/drops/${HALLOWEEN_2026.id}`;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const framed = window.top !== window; // opened as a window inside the desktop

let drop = null;
let skew = 0; // server clock minus local clock, ms
let claiming = false;
let tickT = 0;

const serverNow = () => Date.now() + skew;

function setBusy(on) {
	$('hw-claim').setAttribute('aria-busy', String(on));
	$('hw-claim-skel').hidden = !on;
	$('hw-claim-body').hidden = on;
}

async function load() {
	setBusy(true);
	try {
		const res = await fetch(API, { credentials: 'include', headers: { accept: 'application/json' } });
		const body = await res.json().catch(() => null);
		if (!res.ok || !body) throw new Error(body?.error_description || body?.message || `The server answered ${res.status}.`);
		accept(body);
	} catch (err) {
		renderError('Could not load the gifts', err?.message || 'Check your connection and try again.', load);
	}
}

function accept(body) {
	drop = body;
	skew = Date.parse(body.serverTime) - Date.now();
	if (body.claim?.claimed) markClaimedLocally(body.claim.claimedAt);
	renderGifts();
	renderClaim();
	tick();
}

// ---------- countdown ----------

function tick() {
	clearTimeout(tickT);
	if (!drop) return;
	const now = serverNow();
	const start = Date.parse(drop.startsAt);
	const end = Date.parse(drop.endsAt);
	const phase = now < start ? 'upcoming' : now >= end ? 'ended' : 'live';
	if (phase !== drop.phase) {
		// A boundary just passed: the server is the authority on what that means.
		load();
		return;
	}
	const label = $('hw-clock-label');
	const value = $('hw-clock-value');
	const clock = $('hw-clock');
	clock.dataset.phase = phase;
	if (phase === 'upcoming') {
		label.textContent = 'Claims open in';
		value.textContent = formatCountdown(start - now);
	} else if (phase === 'live') {
		label.textContent = 'Claims close in';
		value.textContent = formatCountdown(end - now);
	} else {
		label.textContent = 'Claims closed';
		value.textContent = new Date(end).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
		return;
	}
	tickT = setTimeout(tick, 1000 - (now % 1000) + 5);
}

// ---------- gifts ----------

function giftMedia(g) {
	if (g.kind === 'cosmetic' && g.model) {
		return `<model-viewer class="hw-media hw-media--model" src="${esc(g.model)}" poster="${esc(g.thumb || '')}" alt="${esc(g.name)}, a 3D model" camera-controls auto-rotate auto-rotate-delay="0" rotation-per-second="24deg" disable-zoom interaction-prompt="none" shadow-intensity="0.6" exposure="1.05" camera-orbit="20deg 70deg auto" loading="lazy"></model-viewer>`;
	}
	if (g.kind === 'cosmetic' && g.swatch) {
		return `<div class="hw-media hw-media--aura" style="--sw:${esc(g.swatch)}" aria-hidden="true"><i></i><b></b></div>`;
	}
	if (g.kind === 'badge') {
		return `<div class="hw-media hw-media--badge" aria-hidden="true"><span class="hw-medal"><span>${esc(g.icon || '')}</span></span></div>`;
	}
	if (g.kind === 'wallpaper') {
		return `<div class="hw-media hw-media--wall" aria-hidden="true"></div>`;
	}
	return '<div class="hw-media" aria-hidden="true"></div>';
}

const KIND_LABEL = { cosmetic: 'Wearable in /play', badge: 'Profile badge', wallpaper: 'Desktop wallpaper' };

function renderGifts() {
	const owned = !!drop.claim?.claimed;
	$('hw-grid').innerHTML = drop.gifts
		.map(
			(g) => `<li class="hw-gift${owned ? ' is-owned' : ''}">
				${giftMedia(g)}
				<div class="hw-gift-text">
					<span class="hw-gift-kind">${esc(KIND_LABEL[g.kind] || g.kind)}</span>
					<h3>${esc(g.name)}</h3>
					<p>${esc(g.detail)}</p>
				</div>
				${owned ? '<span class="hw-owned"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>Yours</span>' : ''}
			</li>`,
		)
		.join('');
}

// ---------- claim panel ----------

function link(href, label, cls = 'hw-btn') {
	return `<a class="${cls}" href="${esc(href)}">${esc(label)}</a>`;
}

function paint(state, heading, text, actionsHtml) {
	setBusy(false);
	const panel = $('hw-claim');
	panel.dataset.state = state;
	$('hw-claim-h').textContent = heading;
	$('hw-claim-p').innerHTML = text;
	$('hw-claim-actions').innerHTML = actionsHtml;
}

function renderClaim() {
	const c = drop.claim || {};
	const when = c.claimedAt ? new Date(c.claimedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';

	if (c.claimed) {
		const profile = c.username ? link(`/u/${encodeURIComponent(c.username)}`, 'See your badge', 'hw-btn hw-btn--ghost') : '';
		const wall = framed
			? ''
			: link('/?app=settings', 'Set the wallpaper', 'hw-btn hw-btn--ghost');
		const syncing = c.wearablesSynced === false;
		paint(
			'claimed',
			'Yours forever',
			`Claimed ${esc(when)}. The Pumpkin Cap and Witchlight aura are in your <a href="/play">/play</a> wardrobe, the badge is on your profile${framed ? ', and the haunted wallpaper is in this desktop’s Settings under Personalization' : ', and the haunted wallpaper is in desktop Settings'}.${
				syncing ? ' <strong class="hw-warn">Your wearables are still syncing to /play.</strong> Press Sync now to try again.' : ''
			}`,
			(syncing ? '<button type="button" class="hw-btn" id="hw-sync">Sync now</button>' : link('/play', 'Wear it in /play')) + profile + wall,
		);
		$('hw-sync')?.addEventListener('click', claim);
		return;
	}

	if (drop.phase === 'upcoming') {
		paint('upcoming', 'Opens Saturday', 'The gifts unlock at midnight on Saturday in the earliest timezone. Come back then, or sign in now so you are ready.', c.signedIn ? '' : link(`/login?next=${encodeURIComponent('/halloween')}`, 'Sign in'));
		return;
	}

	if (drop.phase === 'ended') {
		paint(
			'ended',
			'This drop has closed',
			'These gifts were only claimable on October 31 and November 1, 2026, and only accounts that claimed them that weekend have them. They are never sold.',
			link('/play', 'Visit /play', 'hw-btn hw-btn--ghost'),
		);
		return;
	}

	if (!c.signedIn) {
		paint(
			'signed-out',
			'Sign in to claim',
			'Gifts belong to an account, so they follow you to every world and every device. It takes a few seconds, and it is free.',
			link(`/login?next=${encodeURIComponent('/halloween')}`, 'Sign in to claim') + link(`/register?next=${encodeURIComponent('/halloween')}`, 'Create an account', 'hw-btn hw-btn--ghost'),
		);
		return;
	}

	paint(
		'ready',
		c.username ? `Your gifts are waiting, ${c.username}` : 'Your gifts are waiting',
		'One press claims all four. Nothing to pay, nothing to connect.',
		'<button type="button" class="hw-btn hw-btn--claim" id="hw-claim-btn"><span class="hw-btn-label">Claim all four gifts</span></button>',
	);
	$('hw-claim-btn').addEventListener('click', claim);
}

function renderError(heading, message, retry) {
	paint('error', heading, esc(message), '<button type="button" class="hw-btn" id="hw-retry">Try again</button>');
	$('hw-retry').addEventListener('click', retry);
}

async function claim() {
	if (claiming) return;
	claiming = true;
	const btn = $('hw-claim-btn') || $('hw-sync');
	if (btn) {
		btn.disabled = true;
		btn.classList.add('is-busy');
		btn.querySelector('.hw-btn-label')?.replaceChildren('Claiming');
	}
	try {
		const res = await fetch(API, { method: 'POST', credentials: 'include', headers: { accept: 'application/json' } });
		const body = await res.json().catch(() => null);
		if (res.status === 401) {
			drop.claim = { signedIn: false, claimed: false };
			renderClaim();
			return;
		}
		if (res.status === 409 || res.status === 410) {
			await load();
			return;
		}
		if (res.status === 429) {
			const wait = Number(res.headers.get('retry-after')) || 60;
			renderError('Too many tries', `Wait about ${wait} seconds, then try again.`, renderClaim);
			return;
		}
		if (!res.ok || !body) throw new Error(body?.error_description || body?.message || `The server answered ${res.status}.`);
		const fresh = body.claim?.newlyClaimed;
		accept(body);
		if (fresh) celebrate();
	} catch (err) {
		renderError('The claim did not go through', `${err?.message || 'Network error.'} Nothing was lost: press Try again.`, renderClaim);
	} finally {
		claiming = false;
	}
}

// A short burst of bats and pumpkins from the panel. Pure CSS motion; each
// particle removes itself when its animation ends.
function celebrate() {
	if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
	const host = $('hw-claim');
	const glyphs = ['🎃', '🦇', '👻', '🍬', '🦇', '🎃'];
	for (let i = 0; i < 18; i++) {
		const p = document.createElement('span');
		p.className = 'hw-pop';
		p.textContent = glyphs[i % glyphs.length];
		const angle = (i / 18) * Math.PI * 2;
		const dist = 90 + (i % 3) * 50;
		p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
		p.style.setProperty('--dy', `${Math.sin(angle) * dist * 0.7 - 40}px`);
		p.style.animationDelay = `${(i % 6) * 30}ms`;
		p.addEventListener('animationend', () => p.remove(), { once: true });
		host.append(p);
	}
}

document.addEventListener('visibilitychange', () => {
	if (document.visibilityState === 'visible' && drop) tick();
});

load();
