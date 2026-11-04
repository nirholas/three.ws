// The house default avatar every demo surface stages, in one place.
//
// A first-time visitor's first look at a 3D surface is usually this avatar, so
// two rules hold everywhere it is used:
//
//   1. It never stands in bind pose. DEFAULT_STAGE_AVATAR_URL carries the Idle
//      Breath clip baked in (scripts/bake-default-idle-avatar.mjs), so a viewer
//      that only plays a model's own clips (<model-viewer autoplay>,
//      <three-ws-viewer autoplay>, AR Quick Look) idles with no runtime
//      retargeting. Surfaces that drive the library clips themselves (an
//      AnimationManager, a game rig) load DEFAULT_STAGE_RIG_URL, the same body
//      without an embedded clip, and start DEFAULT_IDLE_CLIP_URL on it.
//   2. It is nobody's likeness. The body is the house stylized humanoid, not a
//      scan or caricature of a real person.
//
// STAGE_CAST adds two more bodies on the identical 67-joint rig, for scenes that
// need several distinct people on stage at once (a buyer and a seller, a crowd).

export const DEFAULT_STAGE_AVATAR_URL = '/avatars/default-idle.glb';
export const DEFAULT_STAGE_RIG_URL = '/avatars/default.glb';
export const DEFAULT_STAGE_AVATAR_POSTER = '/avatars/default-poster.webp';
export const DEFAULT_STAGE_AVATAR_THUMB = '/avatars/thumbs/default.png';
export const DEFAULT_STAGE_AVATAR_NAME = 'Default';
export const DEFAULT_IDLE_CLIP_URL = '/animations/clips/av-idle-breath.json';

/** Distinct, non-likeness bodies that all share the default's skeleton. */
export const STAGE_CAST = Object.freeze([
	Object.freeze({ id: 'default', name: DEFAULT_STAGE_AVATAR_NAME, url: DEFAULT_STAGE_RIG_URL }),
	Object.freeze({ id: 'realistic-male', name: 'Realistic M', url: '/avatars/realistic-male.glb' }),
	Object.freeze({ id: 'realistic-female', name: 'Realistic F', url: '/avatars/realistic-female.glb' }),
]);

/** True for either spelling of the house default (with or without its baked idle). */
export function isDefaultStageAvatar(url) {
	if (!url) return false;
	const path = String(url).split(/[?#]/)[0].replace(/^https?:\/\/[^/]+/, '');
	return path === DEFAULT_STAGE_AVATAR_URL || path === DEFAULT_STAGE_RIG_URL;
}
