// Time-boxed holder windows for scarce supply: generative drops (Gold, drops.early)
// and rare *.threews.sol names (Genesis, names.first_dibs). Pure functions with an
// injectable clock so the window edges are testable without sleeping.

const MAX_EARLY_MINUTES = 7 * 24 * 60;

/** Default window a drop gets when its creator does not choose one. */
export function defaultEarlyMinutes(env = process.env) {
	const raw = env.DROPS_EARLY_DEFAULT_MINUTES;
	if (raw === undefined || raw === '') return 15;
	return clampEarlyMinutes(raw, 15);
}

/** Clamp a requested window to 0..7 days; a non-number falls back to `fallback`. */
export function clampEarlyMinutes(value, fallback = 15) {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(Math.max(Math.floor(n), 0), MAX_EARLY_MINUTES);
}

/** Is a drop still inside its holder-only window at `now`? */
export function dropEarlyWindowOpen(row, now = Date.now()) {
	if (!row?.public_opens_at) return false;
	const opens = new Date(row.public_opens_at).getTime();
	return Number.isFinite(opens) && now < opens;
}

/** The instant the public may reveal, given the moment of publishing. */
export function publicOpensAt(earlyMinutes, now = Date.now()) {
	const minutes = Number(earlyMinutes) || 0;
	return new Date(now + minutes * 60_000);
}

/**
 * Genesis-only window for non-common names. Active while
 * THREEWS_RARE_NAMES_PUBLIC_AT is a valid future ISO instant; unset (or past)
 * means rare names are open to everyone, as before.
 */
export function rareNameWindowOpen(env = process.env, now = Date.now()) {
	const raw = env.THREEWS_RARE_NAMES_PUBLIC_AT;
	if (!raw) return false;
	const at = new Date(raw).getTime();
	return Number.isFinite(at) && now < at;
}
