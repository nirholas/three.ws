// /club door — the line outside the club.
//
// Before the velvet rope drops, you pay the cover via x402 and the bouncer
// checks the paying wallet on-chain (ban list + prior club activity). This
// module owns only the door overlay (#club-door) — the 3D club (src/club.js)
// boots in parallel behind it, so the queue covers the asset load and the
// room is already warm the moment you're admitted.
//
// Flow:  queue → [Pay cover] → x402 modal → checking → admitted | denied
// Each step is mirrored to the doorman in the alley via `club:door-state`.
//
// A paid wallet's pass is cached locally for its lifetime, so a reload within
// the night re-enters without paying again (the cover endpoint mirrors this
// with a SIWX free-re-entry grant for the same wallet).

import { log } from './shared/log.js';
import { isExpressEntry } from './shared/club-express.js';

const COVER_ENDPOINT = '/api/x402/club-cover';
const PASS_KEY = 'club:pass:v1';

// Hard client-side ceiling on a cached pass, independent of the server's
// expiresAt. Even if the cover endpoint ever returns a long-lived (or missing)
// expiry, a device never re-enters free for more than one night. The shorter of
// {server expiresAt, issuedAt + this} wins.
const MAX_PASS_AGE_MS = 24 * 60 * 60 * 1000;

const door = document.getElementById('club-door');
if (door) initDoor(door);

// Logout / wallet switch invalidates the cached cover pass — it is bound to the
// paying wallet, so a disconnect or a different wallet must pay cover again.
// `wallet:changed` fires with detail.address === null on disconnect.
window.addEventListener('wallet:changed', (e) => {
	const addr = e?.detail && Object.prototype.hasOwnProperty.call(e.detail, 'address')
		? e.detail.address
		: undefined;
	// Clear on an explicit disconnect (null) or a wallet switch (different addr).
	if (addr === null || (addr && addr !== readPassWallet())) clearPass();
});

function readPassWallet() {
	try { return JSON.parse(localStorage.getItem(PASS_KEY) || 'null')?.wallet || null; }
	catch { return null; }
}

function initDoor(root) {
	const payBtn = root.querySelector('#club-door-pay');
	const msgEl = root.querySelector('#club-door-msg');
	const tierEl = root.querySelector('#club-door-tier');
	const backBtn = root.querySelector('#club-door-back');

	// Already paid cover tonight? Drop the rope immediately — no double charge.
	const cached = readPass();
	if (cached) {
		openDoor(root, { silent: true });
		return;
	}

	// Express/demo entry (/club?demo): skip the cover charge and drop the rope
	// straight onto the pole stage so the dance-tip flow is reachable for a
	// recording or QA without paying cover first. Deferred one frame so club.js
	// has registered its `club:admitted` listener before openDoor dispatches it.
	if (isExpressEntry()) {
		log.info('[club-gate] express entry — cover skipped (demo flag)');
		requestAnimationFrame(() => openDoor(root, { silent: true }));
		return;
	}

	// The card stays hidden until you walk your avatar up to the door in the
	// alley (src/club-entrance.js → club:enter-door). Backing out (the card's
	// back button or Escape) returns control to the alley.
	setState(root, 'hidden');
	payBtn?.addEventListener('click', () => payCover(root, { payBtn, msgEl, tierEl }));

	window.addEventListener('club:enter-door', () => {
		if (root.dataset.state !== 'hidden') return;
		setState(root, 'queue');
		try { payBtn?.focus({ preventScroll: true }); } catch {}
	});

	const backToAlley = () => {
		setState(root, 'hidden');
		setMsg(msgEl, '', null);
		window.dispatchEvent(new CustomEvent('club:leave-door'));
	};
	backBtn?.addEventListener('click', backToAlley);
	const onKeyDown = (e) => {
		if (e.key === 'Escape' && root.dataset.state === 'queue') backToAlley();
	};
	window.addEventListener('keydown', onKeyDown);
	// Expose cleanup so openDoor can remove the listener when the card is torn down.
	root._removeKeyDown = () => window.removeEventListener('keydown', onKeyDown);
}

async function payCover(root, { payBtn, msgEl, tierEl }) {
	if (!window.X402?.pay) {
		setMsg(msgEl, 'Wallet widget still loading — try again in a second.', 'warn');
		return;
	}

	setMsg(msgEl, '', null);
	setState(root, 'paying');
	payBtn.disabled = true;
	const originalLabel = payBtn.textContent;
	payBtn.textContent = 'Open wallet…';

	try {
		const out = await window.X402.pay({
			endpoint: COVER_ENDPOINT,
			method: 'GET',
			merchant: 'three.ws Pole Club',
			action: 'Cover charge — enter the club',
			// Skip the checkout's wallet-picker when one wallet is detected — the
			// SIWX free-re-entry choice and the install/pick cases still surface.
			autoConnect: true,
			// Dismiss the checkout the instant cover settles — the door renders its
			// own admit beat and drops the rope, so the modal must not park on a
			// "Payment confirmed / Done" screen on top of the club it just unlocked.
			autoClose: true,
		});
		const pass = out?.result;
		if (!pass?.ok) throw new Error(pass?.error || 'cover did not settle');

		// Bouncer beat — give the "checking the list" state a moment to read.
		setState(root, 'checking');
		await wait(900);

		if (pass.admitted === false || pass.banned) {
			const reason = pass.reason || 'Not on the list tonight.';
			setState(root, 'denied', { reason });
			const reasonEl = root.querySelector('#club-door-reason');
			if (reasonEl) reasonEl.textContent = reason;
			return;
		}

		// In. Cache the pass and announce the tier, then drop the rope.
		writePass(pass);
		if (tierEl) tierEl.textContent = welcomeFor(pass);
		setState(root, 'admitted', { tier: pass.tier, visits: pass.visits });
		await wait(1100);
		openDoor(root);
	} catch (err) {
		// Cancelled wallet flow returns quietly to the queue; real errors show.
		if (err?.code === 'cancelled') {
			setState(root, 'queue');
			setMsg(msgEl, 'Cover not paid — you stayed in line.', 'info');
		} else {
			setState(root, 'queue');
			setMsg(msgEl, err?.message || 'Cover failed — try again.', 'error');
			log.warn('[club-gate] cover failed', err);
		}
	} finally {
		payBtn.disabled = false;
		payBtn.textContent = originalLabel;
	}
}

// Drop the velvet rope: fade the overlay out, then remove it so the club
// behind takes pointer + keyboard focus. `silent` skips the reveal beat for a
// cached pass on reload.
function openDoor(root, { silent = false } = {}) {
	root.classList.add('is-open');
	root.setAttribute('aria-hidden', 'true');
	// transitionend and the failsafe timer both call remove(); guard so the room
	// is torn down — and `club:admitted` dispatched — exactly once.
	let removed = false;
	let failsafe = null;
	const remove = () => {
		if (removed) return;
		removed = true;
		if (failsafe) clearTimeout(failsafe);
		try { root._removeKeyDown?.(); } catch {}
		root.remove();
		// Send focus into the room.
		try { document.getElementById('club-stage')?.focus?.({ preventScroll: true }); } catch {}
		window.dispatchEvent(new CustomEvent('club:admitted'));
	};
	if (silent) {
		remove();
	} else {
		root.addEventListener('transitionend', remove, { once: true });
		// Failsafe if transitionend never fires (reduced-motion / display swap).
		failsafe = setTimeout(remove, 900);
	}
}

// Every state change is also announced on `club:door-state`, so the 3D bouncer
// in the alley (src/club-bouncer.js) acts out the same beat the card shows.
function setState(root, state, detail = {}) {
	root.dataset.state = state;
	window.dispatchEvent(new CustomEvent('club:door-state', { detail: { ...detail, state } }));
}

function setMsg(el, text, kind) {
	if (!el) return;
	el.textContent = text || '';
	el.hidden = !text;
	if (kind) el.dataset.kind = kind;
	else delete el.dataset.kind;
}

function welcomeFor(pass) {
	const v = Number(pass.visits || 0);
	if (pass.tier === 'vip') return `VIP in the house — ${v} nights and counting. Welcome back.`;
	if (pass.tier === 'regular') return `Good to see you again — welcome back.`;
	return `First time? Welcome to the club.`;
}

// ── Local pass cache (per device, until the pass expires) ─────────────────
// A cached pass is valid only while BOTH the server's expiresAt and the local
// 24h ceiling (issuedAt + MAX_PASS_AGE_MS) are still in the future. A pass with
// no usable timestamp is discarded rather than trusted forever.
function readPass() {
	try {
		const raw = localStorage.getItem(PASS_KEY);
		if (!raw) return null;
		const pass = JSON.parse(raw);
		const now = Date.now();

		const serverExpiry = pass?.expiresAt ? Date.parse(pass.expiresAt) : NaN;
		const issuedAt = pass?.issuedAt ? Date.parse(pass.issuedAt) : NaN;
		const localExpiry = Number.isFinite(issuedAt) ? issuedAt + MAX_PASS_AGE_MS : NaN;

		// Need at least one valid expiry boundary; otherwise the pass is untrusted.
		if (!Number.isFinite(serverExpiry) && !Number.isFinite(localExpiry)) {
			clearPass();
			return null;
		}

		// Earliest of the available boundaries is the effective expiry.
		const effectiveExpiry = Math.min(
			Number.isFinite(serverExpiry) ? serverExpiry : Infinity,
			Number.isFinite(localExpiry) ? localExpiry : Infinity,
		);
		if (effectiveExpiry <= now) {
			clearPass();
			return null;
		}
		return pass;
	} catch {
		return null;
	}
}

function writePass(pass) {
	try {
		localStorage.setItem(PASS_KEY, JSON.stringify({
			passId: pass.passId,
			tier: pass.tier,
			visits: pass.visits,
			expiresAt: pass.expiresAt,
			// Bind the cache to the paying wallet so a wallet switch invalidates it.
			wallet: pass.payer || null,
			// Stamp the moment of caching so the 24h client ceiling is enforceable
			// even when the server omits or over-extends expiresAt.
			issuedAt: new Date().toISOString(),
		}));
	} catch {}
}

function clearPass() {
	try { localStorage.removeItem(PASS_KEY); } catch {}
}

function wait(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
