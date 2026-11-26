// How /pocket addresses an agent's body in its /walk-embed screen.
//
// The screen is framed tighter than a full-bleed walk embed (?zoom) and the
// body is addressed by avatar id whenever the viewer can read it: that route
// streams the GLB through the same-origin proxy, so the console renders
// identically on three.ws and inside somebody else's page, where R2's own CORS
// would refuse the raw model URL. A public agent can wear a private avatar,
// which /api/avatars/:id/glb serves to its owner only, so for anyone else the
// screen resolves the agent server-side instead (its default body) rather than
// requesting a GLB that can only 404.

import { agentBodyReadable } from './shared/agent-body-access.js';

/**
 * The avatar id the screen may load for this agent record, or null when there
 * is none the viewer can read.
 * @param {Parameters<typeof agentBodyReadable>[0]} detail GET /api/agents/:id record
 * @returns {string|null}
 */
export function pocketSwapAvatarId(detail) {
	return agentBodyReadable(detail) ? detail.avatar_id : null;
}

/**
 * @param {{ agentId: string|null, detail: Parameters<typeof agentBodyReadable>[0], env: string }} args
 *   detail is the agent's record when it has been read, else null
 * @returns {string}
 */
export function pocketFrameSrc({ agentId, detail, env }) {
	const q = new URLSearchParams({
		controls: 'none',
		orbit: 'false',
		badge: 'false',
		click: 'false',
		gestures: 'false',
		zoom: '0.74',
		env,
	});
	const avatarId = pocketSwapAvatarId(detail);
	if (avatarId) q.set('avatar', avatarId);
	else if (agentId) q.set('agent', agentId);
	return `/walk-embed?${q.toString()}`;
}
