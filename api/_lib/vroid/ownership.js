// Is the signed-in VRoid Hub account the creator of a character model?
//
// The answer decides whether the creator's own license conditions bind the
// import. It is always derived server-side by comparing the Hub account id
// (GET /api/account, `user_detail.user.id`) with the model's creator id
// (`character.user.id`); nothing the browser sends is trusted. Any lookup
// that fails or any missing id answers false, so the license stays enforced.

import { hubGet, ACCOUNT_PATH } from './client.js';

/** The Hub user id behind this access token, or null when it cannot be read. */
export async function fetchAccountUserId(accessToken) {
	try {
		const account = await hubGet(ACCOUNT_PATH, accessToken);
		const id = account?.user_detail?.user?.id;
		return id == null || id === '' ? null : String(id);
	} catch (err) {
		console.warn('[vroid-hub] account lookup failed, treating import as not authored:', err?.message || err);
		return null;
	}
}

/** True only when both ids are known and equal. */
export function isCharacterCreator(accountUserId, model) {
	const creatorId = model?.character?.user?.id;
	if (accountUserId == null || creatorId == null || creatorId === '') return false;
	return String(accountUserId) === String(creatorId);
}
