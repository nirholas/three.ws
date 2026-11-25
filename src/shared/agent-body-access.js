// Whether an agent profile may ask GET /api/avatars/:id for the body the agent
// wears. A public agent can wear a private avatar: GET /api/agents/:id reports
// that as `avatar_visibility: 'private'` and withholds the model URL, and
// /api/avatars/:id answers 404 to everyone but the avatar's owner, so for a
// visitor the request can only fail. The agent's owner (marked by `is_owner`,
// or by `user_id`, which the endpoint sends only to the owner) still reads it.

/** @param {{ avatar_id?: string|null, avatar_visibility?: string|null, is_owner?: boolean, user_id?: string|null } | null} rec */
export function agentBodyReadable(rec) {
	if (!rec?.avatar_id) return false;
	if (rec.avatar_visibility !== 'private') return true;
	return rec.is_owner === true || !!rec.user_id;
}

// Same-origin GLB proxy path for the agent's body, or null when the viewer cannot
// read it (no body, or a private body they do not own). Embeds that resolve
// ?agent=<id> fall back to their default body on null instead of requesting a
// path that can only 404.
/** @param {Parameters<typeof agentBodyReadable>[0]} rec */
export function agentBodyGlbPath(rec) {
	if (!agentBodyReadable(rec)) return null;
	return `/api/avatars/${encodeURIComponent(rec.avatar_id)}/glb`;
}

// Why an agent's body cannot be placed in AR for this viewer: 'none' when the
// agent has no body, 'private' when it wears a body only its owner can read, or
// null when the body is readable.
/** @param {Parameters<typeof agentBodyReadable>[0]} rec */
export function agentBodyArBlocker(rec) {
	if (!rec?.avatar_id) return 'none';
	return agentBodyReadable(rec) ? null : 'private';
}
