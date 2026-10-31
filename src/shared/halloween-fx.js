// Third-party Halloween effects, loaded on demand so they cost nothing outside
// the weekend.
//
//  - halloween.js (MIT, zero dependencies): corner cobwebs, blinking eyes, a
//    flying witch, a dropping spider and a rising tombstone. It is driven by
//    classes on <body> and by data-halloween-start/end for its own season gate;
//    we add the classes only inside the same server-pinned window as the rest of
//    the seasonal look and only when the visitor has not opted out.
//  - canvas-confetti (ISC): the claim celebration, in the Halloween palette.
//
// Both honor prefers-reduced-motion themselves; the confetti call also sets
// disableForReducedMotion so an explicit claim never animates for someone who
// asked for less motion.

import { HALLOWEEN_2026, isHalloweenLive, seasonalLookEnabled } from './seasonal-drops.js';

export const PALETTE = Object.freeze(['#ff8a2a', '#ffb04d', '#b48ae0', '#6a3fa0', '#f4f0ff']);

// halloween.js takes DD-MM. Derive the days from the drop window so the library's
// own gate can never be wider than ours.
const dayMonth = (iso) => {
	const d = new Date(iso);
	return `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export const FX_CLASSES = Object.freeze([
	'halloween',
	'halloween-screen-left-top',
	'halloween-screen-right-top',
	'halloween-eyes',
	'halloween-witches',
	'halloween-spider-drop',
	'halloween-tombstones',
]);

/**
 * Turn on the halloween.js page effects when the weekend is live and the visitor
 * has not switched the Halloween look off. Returns true when they were started.
 * Safe to call more than once and when the package fails to load (the page just
 * stays as it was).
 */
export async function startHalloweenPageFx(now = Date.now()) {
	if (!isHalloweenLive(now) || !seasonalLookEnabled()) return false;
	const body = document.body;
	if (!body || body.classList.contains('halloween')) return false;
	try {
		await import('halloween.js');
	} catch (err) {
		console.warn('halloween.js did not load:', err?.message || err);
		return false;
	}
	body.dataset.halloweenStart = dayMonth(HALLOWEEN_2026.startsAt);
	body.dataset.halloweenEnd = dayMonth(HALLOWEEN_2026.endsAt);
	body.classList.add(...FX_CLASSES);
	return true;
}

/**
 * Orange and violet confetti from `origin` (an element, or {x, y} in 0..1 of the
 * viewport). Resolves once the burst is launched; never throws, so a celebration
 * can not break the claim flow it decorates.
 */
export async function celebrateWithConfetti(origin) {
	try {
		const { default: confetti } = await import('canvas-confetti');
		let o = { x: 0.5, y: 0.6 };
		if (origin instanceof Element) {
			const r = origin.getBoundingClientRect();
			o = { x: (r.left + r.width / 2) / innerWidth, y: (r.top + r.height / 2) / innerHeight };
		} else if (origin) {
			o = origin;
		}
		const base = { colors: [...PALETTE], origin: o, disableForReducedMotion: true, zIndex: 10000, ticks: 220 };
		confetti({ ...base, particleCount: 90, spread: 70, startVelocity: 48 });
		confetti({ ...base, particleCount: 50, spread: 120, startVelocity: 30, scalar: 0.8, shapes: ['circle'] });
		return true;
	} catch (err) {
		console.warn('canvas-confetti did not load:', err?.message || err);
		return false;
	}
}
