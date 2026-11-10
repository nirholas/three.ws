/**
 * Curated avatar templates — the single source of truth for the "Create from
 * template" experience that appears on every avatar-creation surface
 * (/create, /gallery, /scan, /create/selfie, /forge).
 *
 * Each entry points at a real, shipped GLB already served from /public. These
 * are the same base rigs the agent wizard exposes as "starters" (see
 * src/create-agent.js STARTERS) — kept here so there is exactly one list to
 * maintain. Previews render the GLB directly via <model-viewer>, so no separate
 * thumbnail asset is required.
 *
 * Shape:
 *   id       — stable slug, used in source_meta for analytics + dedupe
 *   name     — display name on the card
 *   tagline  — one-line description
 *   url      — absolute path to the GLB (must resolve from any page)
 *   tags     — short descriptors rendered as chips
 */

export const AVATAR_TEMPLATES = [
	{
		id: 'vern',
		name: 'Vern',
		tagline: 'The friendly humanoid base — a clean starting point for anyone.',
		url: '/avatars/default.glb',
		tags: ['Humanoid', 'Rigged'],
	},
	{
		id: 'max',
		name: 'Max',
		tagline: 'A realistic humanoid with a sharper, distinctive look.',
		url: '/avatars/realistic-male.glb',
		tags: ['Humanoid', 'Realistic'],
	},
	{
		id: 'saga',
		name: 'Saga',
		tagline: 'An expressive robot rig — playful, mobile-friendly, full of character.',
		url: '/animations/robotexpressive.glb',
		tags: ['Robot', 'Expressive'],
	},
	{
		id: 'boss',
		name: 'Boss',
		tagline: 'A grounded soldier rig with full locomotion built in.',
		url: '/animations/soldier.glb',
		tags: ['Humanoid', 'Locomotion'],
	},
];

/** Map from template id → template object for O(1) lookup. */
export const AVATAR_TEMPLATES_BY_ID = Object.fromEntries(
	AVATAR_TEMPLATES.map((t) => [t.id, t]),
);
