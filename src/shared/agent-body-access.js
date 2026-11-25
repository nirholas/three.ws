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
