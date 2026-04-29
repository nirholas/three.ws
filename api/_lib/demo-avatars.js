/**
 * Demo avatar fixtures for /api/explore.
 * These appear on the discover page when no real public avatars exist yet,
 * using static GLB files already served from /public.
 * IDs prefixed with `avatar_demo_` so they never collide with DB UUIDs.
 */

import { env } from './env.js';

function demoItem({ id, slug, name, description, tags, glbPath, sortDate }) {
	const origin = env.APP_ORIGIN;
	const glbUrl = `${origin}${glbPath}`;
	return {
		kind: 'avatar',
		sortDate,
		avatarId: id,
		slug,
		name,
		description,
		image: null,
		glbUrl,
		has3d: true,
		tags,
		createdAt: sortDate,
		viewerUrl: `/#model=${encodeURIComponent(glbUrl)}`,
	};
}

export const DEMO_AVATARS = [
	demoItem({
		id: 'avatar_demo_cz',
		slug: 'demo-cz',
		name: 'CZ',
		description: 'Humanoid avatar with idle animation support.',
		tags: ['humanoid', 'demo'],
		glbPath: '/avatars/cz.glb',
		sortDate: '2025-01-03T00:00:00Z',
	}),
	demoItem({
		id: 'avatar_demo_robot',
		slug: 'demo-robot',
		name: 'Robot',
		description: 'Expressive robot character with multiple animation clips.',
		tags: ['robot', 'animated', 'demo'],
		glbPath: '/animations/robotexpressive.glb',
		sortDate: '2025-01-02T00:00:00Z',
	}),
	demoItem({
		id: 'avatar_demo_soldier',
		slug: 'demo-soldier',
		name: 'Soldier',
		description: 'Fully rigged soldier model ready for animation.',
		tags: ['humanoid', 'animated', 'demo'],
		glbPath: '/animations/soldier.glb',
		sortDate: '2025-01-01T00:00:00Z',
	}),
];
