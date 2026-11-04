// Per-avatar animation identity: the one place that turns an avatar's saved
// `appearance.animation` into the clip a runtime should play.
//
// The record shape is { idle, walk, gestureIntensity (0..1), moodBlend (0..1),
// emotes: string[] (max 8) }, every key optional, clip ids naming entries of
// /animations/manifest.json (specs/AVATAR_PARAMETERS.md). The Studio preview,
// /walk, the <agent-3d> element and the agent stage all call resolveClip()
// instead of hard-coding clip names, so a saved personality is honored the
// same way everywhere. Dependency-free: it runs in a worker, a test or the
// browser alike, and never throws on a malformed record.

/** Platform defaults used when an avatar sets nothing, or sets something unusable. */
export const PLATFORM_DEFAULTS = Object.freeze({
	idle: 'idle',
	walk: 'av-walk-feminine',
	gesture: 'wave',
});

export const MAX_EMOTES = 8;
export const DEFAULT_INTENSITY = 0.5;

const CLIP_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMOTE_INTENT_RE = /^emote:(\d+)$/;

/** @param {unknown} id */
function isClipId(id) {
	return typeof id === 'string' && id.length <= 64 && CLIP_ID_RE.test(id);
}

function clamp01(n, fallback) {
	if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
	return Math.min(1, Math.max(0, n));
}

/** Whether `clip` may be played, given an optional availability check. */
function usable(clip, known) {
	if (!isClipId(clip)) return false;
	if (!known) return true;
	return typeof known === 'function' ? !!known(clip) : known.has(clip);
}

/**
 * Clean a stored animation record: drop everything that is not a well-formed
 * field, cap the emote loadout, clamp the numbers. Always returns an object.
 *
 * @param {unknown} raw
 * @param {Set<string> | ((clip: string) => boolean)} [known] clips the runtime can play
 */
export function normalizeAnimation(raw, known) {
	const out = {};
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
	if (usable(raw.idle, known)) out.idle = raw.idle;
	if (usable(raw.walk, known)) out.walk = raw.walk;
	if (typeof raw.gestureIntensity === 'number') {
		out.gestureIntensity = clamp01(raw.gestureIntensity, DEFAULT_INTENSITY);
	}
	if (typeof raw.moodBlend === 'number') out.moodBlend = clamp01(raw.moodBlend, 0);
	if (Array.isArray(raw.emotes)) {
		const seen = new Set();
		const emotes = [];
		for (const id of raw.emotes) {
			if (emotes.length >= MAX_EMOTES) break;
			if (!usable(id, known) || seen.has(id)) continue;
			seen.add(id);
			emotes.push(id);
		}
		if (emotes.length) out.emotes = emotes;
	}
	return out;
}

/**
 * Playback speed for a gesture or emote at `intensity`: 0 plays at 0.6x, the
 * 0.5 default at 1x, 1 at 1.4x. Monotonic and bounded, so a stored value can
 * never stall a clip or run it away.
 */
export function intensityTimeScale(intensity) {
	return 0.6 + 0.8 * clamp01(intensity, DEFAULT_INTENSITY);
}

/**
 * Resolve an intent to the clip to play.
 *
 * Intents: `idle`, `walk`, `gesture`, `emote:<n>` (n indexes the saved loadout).
 * Anything unset, malformed, unknown to the runtime (`opts.known`), or out of
 * range falls back to the platform default for that intent.
 *
 * @param {{ animation?: unknown } | null | undefined} appearance
 * @param {string} intent
 * @param {{ known?: Set<string> | ((clip: string) => boolean) }} [opts]
 * @returns {{ clip: string, timeScale: number, source: 'avatar' | 'default' }}
 */
export function resolveClip(appearance, intent, opts = {}) {
	const anim = normalizeAnimation(appearance?.animation, opts.known);
	const scale = intensityTimeScale(anim.gestureIntensity);
	const pick = (saved, fallback, timeScale = 1) =>
		saved && usable(saved, opts.known)
			? { clip: saved, timeScale, source: 'avatar' }
			: { clip: fallback, timeScale, source: 'default' };

	if (intent === 'idle') return pick(anim.idle, PLATFORM_DEFAULTS.idle);
	if (intent === 'walk') return pick(anim.walk, PLATFORM_DEFAULTS.walk);
	if (intent === 'gesture') return pick(anim.emotes?.[0], PLATFORM_DEFAULTS.gesture, scale);
	const m = typeof intent === 'string' ? EMOTE_INTENT_RE.exec(intent) : null;
	if (m) return pick(anim.emotes?.[Number(m[1])], PLATFORM_DEFAULTS.gesture, scale);
	return pick(undefined, PLATFORM_DEFAULTS.idle);
}

/** Every clip an avatar's identity may ask a runtime to load, defaults included. */
export function clipsToPreload(appearance, opts = {}) {
	const anim = normalizeAnimation(appearance?.animation, opts.known);
	const set = new Set([PLATFORM_DEFAULTS.idle, PLATFORM_DEFAULTS.walk]);
	if (anim.idle) set.add(anim.idle);
	if (anim.walk) set.add(anim.walk);
	return [...set];
}
