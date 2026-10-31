// Client mirror of the seasonal-drop windows in api/_lib/seasonal-drops.js.
//
// The server is the authority on whether a claim lands; this module only lets
// the UI theme itself and count down to the same instants without a round trip.
// tests/seasonal-drops.test.js pins these timestamps to the server's (and to the
// copy inside the classic IIFE public/seasonal.js), so they cannot drift apart.

export const HALLOWEEN_2026 = Object.freeze({
	id: 'halloween-2026',
	name: 'Halloween Weekend 2026',
	startsAt: '2026-10-30T10:00:00Z',
	endsAt: '2026-11-02T12:00:00Z',
	claimPath: '/halloween',
	wallpaper: 'haunted',
});

// localStorage flag set when this browser's account claims the drop, so the
// desktop can offer the kept wallpaper without an auth round trip at boot. It is
// a convenience only: the badge row on the server is the real record, and the
// desktop re-checks /api/seasonal/:id when the flag is missing.
export const CLAIMED_FLAG = 'twx_drop_claimed:halloween-2026';
// Opt-out for the seasonal look ("Halloween look" toggle in desktop Settings).
export const LOOK_OFF_FLAG = 'twx_season_off:halloween-2026';

/** 'upcoming' | 'live' | 'ended' for `drop` at epoch-ms `now`. */
export function dropPhase(drop, now = Date.now()) {
	if (now < Date.parse(drop.startsAt)) return 'upcoming';
	if (now >= Date.parse(drop.endsAt)) return 'ended';
	return 'live';
}

/** True while the Halloween weekend is on (the seasonal look's window). */
export function isHalloweenLive(now = Date.now()) {
	return dropPhase(HALLOWEEN_2026, now) === 'live';
}

/** Milliseconds as a short countdown: "1d 4h 12m", "4h 12m 9s", "9s". */
export function formatCountdown(ms) {
	const s = Math.max(0, Math.floor(ms / 1000));
	const d = Math.floor(s / 86400);
	const h = Math.floor((s % 86400) / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	if (d) return `${d}d ${h}h ${m}m`;
	if (h) return `${h}h ${m}m ${sec}s`;
	if (m) return `${m}m ${sec}s`;
	return `${sec}s`;
}

function readFlag(key) {
	try { return localStorage.getItem(key); } catch { return null; }
}
function writeFlag(key, value) {
	try {
		if (value == null) localStorage.removeItem(key);
		else localStorage.setItem(key, value);
	} catch { /* storage blocked: the setting simply does not persist */ }
}

export const hasClaimedLocally = () => readFlag(CLAIMED_FLAG) != null;
export const markClaimedLocally = (iso) => writeFlag(CLAIMED_FLAG, iso || new Date().toISOString());
export const seasonalLookEnabled = () => readFlag(LOOK_OFF_FLAG) == null;
export const setSeasonalLookEnabled = (on) => writeFlag(LOOK_OFF_FLAG, on ? null : '1');
