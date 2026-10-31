// Seasonal look for the desktop: the Halloween Weekend 2026 theme and its gifts.
//
// While the drop is live (src/shared/seasonal-drops.js, mirrored from the server):
//   • <html data-season="halloween"> themes the boot and lock screens, the
//     accent, and the headings (desktop.css). It is set when this module is first
//     imported, which is before the boot screen paints.
//   • the haunted wallpaper is shown unless the visitor set their own photo or
//     switched the look off in Settings (their saved choice is never rewritten);
//   • a "Halloween Gifts" app links to /halloween, placed on the desktop once,
//     with one notification pointing at it.
// After the window the theme, the app and the icon disappear on their own. The
// haunted wallpaper stays selectable for accounts that claimed the gifts.

import {
	HALLOWEEN_2026,
	CLAIMED_FLAG,
	isHalloweenLive,
	hasClaimedLocally,
	markClaimedLocally,
	seasonalLookEnabled,
} from '../shared/seasonal-drops.js';

export const HAUNTED_WALL = HALLOWEEN_2026.wallpaper;
export const SEASON_APP_ID = 'halloween';

export const HALLOWEEN_APP = Object.freeze({
	id: SEASON_APP_ID,
	title: 'Halloween Gifts',
	href: HALLOWEEN_2026.claimPath,
	hue: 24,
	icon: 'pumpkin',
	size: { w: 980, h: 760 },
	desktop: true,
	// Temporary by design: not in the static crawlable list in pages/desktop.html.
	seasonal: true,
	desc: 'Free gifts, claimable this weekend only. Claim once, keep forever.',
	keywords: ['halloween', 'gift', 'gifts', 'free', 'claim', 'pumpkin', 'drop', 'spooky', 'wallpaper', 'badge'],
});

/** The apps that exist right now because a season is on. */
export function seasonalApps(now = Date.now()) {
	return isHalloweenLive(now) ? [HALLOWEEN_APP] : [];
}

/** Whether the haunted wallpaper can be chosen: anyone this weekend, claimers forever. */
export function canUseHaunted({ live, claimed }) {
	return live || claimed;
}

/**
 * The wallpaper to show, given the saved choice. Pure.
 * A season paints over every built-in wallpaper but never over a personal photo,
 * and only while the visitor has the look switched on. A saved `haunted` choice
 * that is no longer allowed (window over, never claimed) shows `fallback`.
 */
export function pickWall(chosen, { live, lookOn, claimed, customId, fallback }) {
	if (chosen === customId) return chosen;
	if (live && lookOn) return HAUNTED_WALL;
	if (chosen === HAUNTED_WALL && !canUseHaunted({ live, claimed })) return fallback;
	return chosen;
}

/** Current seasonal context for pickWall and the Settings grid. */
export function seasonState(now = Date.now()) {
	return { live: isHalloweenLive(now), lookOn: seasonalLookEnabled(), claimed: hasClaimedLocally() };
}

/** Put the season attribute on <html> (or take it off) and load the display face. */
export function applySeasonAttr(now = Date.now()) {
	if (typeof document === 'undefined') return false;
	const on = isHalloweenLive(now) && seasonalLookEnabled();
	const html = document.documentElement;
	if (on) {
		html.dataset.season = 'halloween';
		if (!document.querySelector('link[data-season-font]')) {
			const link = document.createElement('link');
			link.rel = 'stylesheet';
			link.href = '/fonts/creepster.css';
			link.dataset.seasonFont = '1';
			document.head.append(link);
		}
	} else if (html.dataset.season === 'halloween') {
		delete html.dataset.season;
	}
	return on;
}
applySeasonAttr();

const ICON_PLACED = 'tws:season:halloween-2026:icon';
const NOTE_SENT = 'tws:season:halloween-2026:note';
const SYNC_CHECKED = 'tws:season:halloween-2026:synced';
// Keep asking the server about a claim made on another device for a while after
// the window, so a claimer who never opened the desktop on this browser during
// the weekend still finds the wallpaper kept for them.
const SYNC_UNTIL = Date.parse('2027-01-31T00:00:00Z');

/** A few bats crossing the wallpaper. Decorative, pointer-transparent, off for reduced motion. */
function batLayer() {
	const layer = document.createElement('div');
	layer.className = 'os-bats';
	layer.setAttribute('aria-hidden', 'true');
	const bat = '<svg viewBox="-26 -10 52 20"><path d="M0 0C-6-8-16-10-26-4c6 0 8 4 6 8 6-3 11-2 14 2 2-4 4-5 6-4 2-1 4 0 6 4 3-4 8-5 14-2-2-4 0-8 6-8C16-10 6-8 0 0Z"/></svg>';
	for (let i = 0; i < 4; i++) {
		const b = document.createElement('i');
		b.innerHTML = bat;
		layer.append(b);
	}
	return layer;
}

/**
 * Wire the season into a mounted desktop.
 * @param {{ root: HTMLElement, wall: HTMLElement, store: { get(k: string): string|null, set(k: string, v: string): void },
 *   notify: (n: { title: string, body?: string, app?: string }) => void, toast: (msg: string) => void,
 *   deskIcons: { add(id: string): boolean } | null, onClaimChange: () => void }} ctx
 */
export function mountSeason({ root, wall, store, notify, toast, deskIcons, onClaimChange }) {
	const live = isHalloweenLive();
	const lookOn = applySeasonAttr();
	root.dataset.season = lookOn ? 'halloween' : '';
	if (lookOn && !matchMedia('(prefers-reduced-motion: reduce)').matches) wall.append(batLayer());

	if (live) {
		if (!store.get(ICON_PLACED) && deskIcons) {
			deskIcons.add(SEASON_APP_ID);
			store.set(ICON_PLACED, '1');
		}
		if (!store.get(NOTE_SENT) && !hasClaimedLocally()) {
			store.set(NOTE_SENT, '1');
			notify({
				title: 'Free Halloween gifts this weekend',
				body: 'A Pumpkin Cap, the Witchlight aura, a profile badge and this haunted wallpaper. Claim them by Sunday night and they are yours forever.',
				app: SEASON_APP_ID,
			});
		}
	}

	// A claim made in the /halloween window (or another tab) lands here too.
	addEventListener('storage', (e) => {
		if (e.key !== CLAIMED_FLAG || !e.newValue) return;
		toast('The haunted wallpaper is yours to keep. Find it in Settings, Personalization.');
		onClaimChange();
	});

	syncClaim(store).then((changed) => changed && onClaimChange());
}

// Learn about a claim made from another browser. Signed-out visitors and the
// already-known case cost nothing; a signed-in non-claimer is asked once per day.
async function syncClaim(store) {
	if (hasClaimedLocally() || Date.now() > SYNC_UNTIL) return false;
	const day = new Date().toISOString().slice(0, 10);
	if (store.get(SYNC_CHECKED) === day) return false;
	try {
		const res = await fetch(`/api/drops/${HALLOWEEN_2026.id}`, { credentials: 'include' });
		if (!res.ok) return false;
		const body = await res.json();
		if (body?.claim?.signedIn) store.set(SYNC_CHECKED, day);
		if (body?.claim?.claimed) {
			markClaimedLocally(body.claim.claimedAt);
			return true;
		}
	} catch {
		/* offline: the next boot asks again */
	}
	return false;
}
