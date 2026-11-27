/**
 * Small, pure checks and repairs for a clip that came back from the
 * text-to-motion lane, before /pose plays it (src/animation-library.js).
 *
 * - rootTravel / pinRootInPlace: a generated walk really travels (5.7 m for "a
 *   person walks forward in a circle", measured live 2026-11-27), which carries
 *   the figure out of the camera and snaps it back on every loop. Pinning keeps
 *   the height and every rotation and drops only the horizontal travel, the way
 *   an "in place" export works in any animation library.
 * - generatedClipProblem: a clip that cannot play gets one plain sentence
 *   instead of a figure that freezes.
 * - normalizeClipTiming: a clip keyed in frame numbers would play 30 times too
 *   slowly; the reported frame rate turns it back into seconds.
 *
 * Works on clip JSON and on three.js AnimationClip alike: both carry `tracks`
 * with `name`, `times` and `values`.
 */

/** Travel, in metres, above which a generated motion opens with "In place" on. */
export const IN_PLACE_TRAVEL_M = 0.6;

/** Shortest clip worth playing: anything shorter is a single pose. */
const MIN_DURATION_S = 0.2;

const ROOT_TRACK = 'Hips.position';

function rootTrack(clip) {
	return (clip?.tracks ?? []).find((t) => t?.name === ROOT_TRACK) ?? null;
}

/**
 * Largest horizontal distance (x/z) the root reaches from its first frame.
 * @returns {number} 0 when the clip has no root position track
 */
export function rootTravel(clip) {
	const track = rootTrack(clip);
	const v = track?.values;
	if (!v || v.length < 3) return 0;
	const x0 = v[0];
	const z0 = v[2];
	let worst = 0;
	for (let i = 3; i + 2 < v.length; i += 3) worst = Math.max(worst, Math.hypot(v[i] - x0, v[i + 2] - z0));
	return worst;
}

function cloneTrack(track) {
	if (typeof track.clone === 'function') return track.clone();
	return { ...track, times: Array.from(track.times ?? []), values: Array.from(track.values ?? []) };
}

/**
 * The same clip with the root held at its first frame's x/z. Height and every
 * rotation are unchanged; the input is never modified.
 */
export function pinRootInPlace(clip) {
	const track = rootTrack(clip);
	if (!track || (track.values?.length ?? 0) < 6) return clip;
	const pinned = cloneTrack(track);
	const v = pinned.values;
	const x0 = v[0];
	const z0 = v[2];
	for (let i = 3; i + 2 < v.length; i += 3) {
		v[i] = x0;
		v[i + 2] = z0;
	}
	const tracks = clip.tracks.map((t) => (t === track ? pinned : t));
	if (typeof clip.clone === 'function') {
		const out = clip.clone();
		out.tracks = tracks;
		out.name = clip.name;
		out.userData = clip.userData;
		return out;
	}
	return { ...clip, tracks };
}

function lastTime(clip) {
	let end = 0;
	for (const t of clip?.tracks ?? []) {
		const times = t?.times;
		if (times?.length) end = Math.max(end, Number(times[times.length - 1]) || 0);
	}
	return end;
}

/**
 * Why a generated clip cannot play, in words for the person, or null when it
 * can.
 * @returns {string|null}
 */
export function generatedClipProblem(clip) {
	const tracks = Array.isArray(clip?.tracks) ? clip.tracks : [];
	if (tracks.length === 0) return 'The motion came back with no motion in it. Try again, or describe it differently.';
	if (!tracks.some((t) => String(t?.name || '').endsWith('.quaternion'))) {
		return 'The motion came back with no bone rotations, so nothing would move. Try again.';
	}
	for (const t of tracks) {
		for (const v of t?.values ?? []) {
			if (!Number.isFinite(v)) return 'The motion came back with broken values. Try again.';
		}
	}
	if (Math.max(Number(clip.duration) || 0, lastTime(clip)) < MIN_DURATION_S) {
		return 'The motion came back too short to play. Try again, or describe a longer movement.';
	}
	return null;
}

/**
 * Seconds-keyed copy of a clip that was keyed in frame numbers, and a duration
 * that covers its last key. A clip that is already right is returned as is.
 *
 * @param {any} clip clip JSON
 * @param {{ fps?: number, frames?: number }} timing what the job reported
 */
export function normalizeClipTiming(clip, { fps, frames } = {}) {
	if (!Array.isArray(clip?.tracks)) return clip;
	const end = lastTime(clip);
	const rate = Number(fps);
	// Keyed in frames: the last key sits at a frame number, far past what the
	// reported rate and frame count allow in seconds.
	const expectedEnd = Number(frames) > 1 && rate > 0 ? (Number(frames) - 1) / rate : null;
	const inFrames = rate > 0 && expectedEnd != null && end > expectedEnd * 1.5 && Math.abs(end - (Number(frames) - 1)) < 1.5;
	if (inFrames) {
		const tracks = clip.tracks.map((t) => ({ ...t, times: Array.from(t.times ?? [], (x) => x / rate) }));
		return { ...clip, tracks, duration: end / rate };
	}
	// A duration past the last key is a held end pose and is kept; one that is
	// missing or cuts the keys short is not.
	const duration = Number(clip.duration);
	if (end > 0 && !(duration >= end - 1e-6)) return { ...clip, duration: end };
	return clip;
}
