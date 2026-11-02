// Seasonal looks for the desktop. One season is live at a time:
//
//   • Halloween Weekend 2026 (a drop with gifts): haunted wallpaper, bats, a
//     pumpkin accent, Creepster headings, and a "Halloween Gifts" app placed on
//     the desktop once with one notification pointing at it. The haunted
//     wallpaper stays selectable for accounts that claimed the gifts.
//   • Autumn 2026 (a look only, starting the instant Halloween ends): the
//     harvest wallpaper, falling leaves, an amber accent and warm headings. The
//     harvest wallpaper is a regular built-in, so anyone can keep it afterwards.
//
// While a season is live (windows in src/shared/seasonal-drops.js):
//   • <html data-season="<id>"> themes the boot and lock screens, the accent and
//     the headings (desktop.css). It is set when this module is first imported,
//     which is before the boot screen paints;
//   • the season's wallpaper is shown unless the visitor set their own photo or
//     switched the look off in Settings (their saved choice is never rewritten).
// After the window the theme and its extras disappear on their own.

import {
	AUTUMN_2026,
	HALLOWEEN_2026,
	CLAIMED_FLAG,
	autumnLookEnabled,
	dropPhase,
	isHalloweenLive,
	hasClaimedLocally,
	markClaimedLocally,
	seasonalLookEnabled,
	setAutumnLookEnabled,
	setSeasonalLookEnabled,
} from '../shared/seasonal-drops.js';

export const HAUNTED_WALL = HALLOWEEN_2026.wallpaper;
export const HARVEST_WALL = AUTUMN_2026.wallpaper;
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
 * A live season (`seasonWall`) paints over every built-in wallpaper but never
 * over a personal photo, and only while the visitor has the look switched on. A
 * saved `haunted` choice that is no longer allowed (Halloween over, never
 * claimed) shows `fallback`.
 */
export function pickWall(chosen, { seasonWall = null, live, lookOn, claimed, customId, fallback }) {
	if (chosen === customId) return chosen;
	if (seasonWall && lookOn) return seasonWall;
	if (chosen === HAUNTED_WALL && !canUseHaunted({ live, claimed })) return fallback;
	return chosen;
}

/** The season whose window contains `now`, or null between seasons. */
export function activeSeason(now = Date.now()) {
	return SEASONS.find((s) => dropPhase(s.window, now) === 'live') || null;
}

/**
 * Current seasonal context for pickWall and the Settings pane.
 * `live` and `claimed` are about the Halloween drop (they gate the haunted
 * wallpaper); `season`, `seasonWall` and `lookOn` are about whichever look is on.
 */
export function seasonState(now = Date.now()) {
	const season = activeSeason(now);
	return {
		season,
		seasonWall: season?.wall ?? null,
		lookOn: season ? season.lookEnabled() : false,
		live: isHalloweenLive(now),
		claimed: hasClaimedLocally(),
	};
}

/** Switch the live season's look on or off for this browser. No-op between seasons. */
export function setSeasonLook(on, now = Date.now()) {
	activeSeason(now)?.setLookEnabled(on);
}

/**
 * Put the season attribute on <html> (or take it off) and load the season's
 * display face. Returns the id of the look now showing, or '' for none.
 */
export function applySeasonAttr(now = Date.now()) {
	if (typeof document === 'undefined') return '';
	const season = activeSeason(now);
	const on = season && season.lookEnabled() ? season : null;
	const html = document.documentElement;
	if (on) {
		html.dataset.season = on.id;
		if (on.font && !document.querySelector(`link[data-season-font="${on.id}"]`)) {
			const link = document.createElement('link');
			link.rel = 'stylesheet';
			link.href = on.font;
			link.dataset.seasonFont = on.id;
			document.head.append(link);
		}
	} else if (SEASONS.some((s) => s.id === html.dataset.season)) {
		delete html.dataset.season;
	}
	return on ? on.id : '';
}

const ICON_PLACED = 'tws:season:halloween-2026:icon';
const NOTE_SENT = 'tws:season:halloween-2026:note';
const SYNC_CHECKED = 'tws:season:halloween-2026:synced';
const AUTUMN_NOTE_SENT = 'tws:season:autumn-2026:note';
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

// Leaf shapes for the autumn layer, drawn in a 24x24 box centred on the stem.
const MAPLE = '<svg viewBox="-12 -12 24 24"><path d="M0-11 2-6 5-8 4.5-3 9-4.5 7 0 10 1.5 5 3.5 6 6 1 5 .6 10H-.6L-1 5-6 6-5 3.5-10 1.5-7 0-9-4.5-4.5-3-5-8-2-6Z"/></svg>';
const OVAL = '<svg viewBox="-12 -12 24 24"><path d="M0-11C6-7 8.5-1 6 5 4.4 8.4 1.6 9.6 0 11-1.6 9.6-4.4 8.4-6 5-8.5-1-6-7 0-11Z"/><path d="M0-8V10" fill="none" stroke="rgba(0,0,0,.28)" stroke-width="1"/></svg>';

/** Leaves drifting down over the wallpaper. Decorative, pointer-transparent, off for reduced motion. */
function leafLayer() {
	const layer = document.createElement('div');
	layer.className = 'os-leaves';
	layer.setAttribute('aria-hidden', 'true');
	for (let i = 0; i < 10; i++) {
		const leaf = document.createElement('i');
		leaf.innerHTML = i % 3 === 1 ? OVAL : MAPLE;
		layer.append(leaf);
	}
	return layer;
}

const SEASONS = Object.freeze([
	Object.freeze({
		id: 'halloween',
		window: HALLOWEEN_2026,
		wall: HAUNTED_WALL,
		font: '/fonts/creepster.css',
		label: 'Halloween look',
		desc: 'Haunted wallpaper, pumpkin accent and spooky headings until Sunday night.',
		layer: batLayer,
		lookEnabled: seasonalLookEnabled,
		setLookEnabled: setSeasonalLookEnabled,
	}),
	Object.freeze({
		id: 'autumn',
		window: AUTUMN_2026,
		wall: HARVEST_WALL,
		font: null,
		label: 'Autumn look',
		desc: 'Harvest wallpaper, falling leaves and an amber accent through November.',
		layer: leafLayer,
		lookEnabled: autumnLookEnabled,
		setLookEnabled: setAutumnLookEnabled,
	}),
]);
// Before the boot screen paints (this module is imported ahead of it).
applySeasonAttr();

/**
 * Wire the season into a mounted desktop.
 * @param {{ root: HTMLElement, wall: HTMLElement, store: { get(k: string): string|null, set(k: string, v: string): void },
 *   notify: (n: { title: string, body?: string, app?: string }) => void, toast: (msg: string) => void,
 *   deskIcons: { add(id: string): boolean } | null, onClaimChange: () => void }} ctx
 */
export function mountSeason({ root, wall, store, notify, toast, deskIcons, onClaimChange }) {
	const live = isHalloweenLive();
	const season = activeSeason();
	root.dataset.season = applySeasonAttr();
	// Mounted whenever a season is live (CSS hides it while the look is off), so
	// switching the look back on in Settings brings the motion back with it.
	if (season && !matchMedia('(prefers-reduced-motion: reduce)').matches) wall.append(season.layer());
	if (season?.id === 'autumn' && root.dataset.season === 'autumn' && !store.get(AUTUMN_NOTE_SENT)) {
		store.set(AUTUMN_NOTE_SENT, '1');
		notify({
			title: 'Autumn has arrived',
			body: 'The desktop is in its fall colours through November. Keep the Harvest wallpaper any time, or switch the look off in Settings, Personalization.',
			app: 'settings',
		});
	}

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
		const res = await fetch(`/api/seasonal/${HALLOWEEN_2026.id}`, { credentials: 'include' });
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
