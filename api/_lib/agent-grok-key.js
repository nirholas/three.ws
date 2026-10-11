// Which Grok (xAI) credential serves a given agent's turn.
//
// An agent whose owner saved a Grok key at /api/user/provider-keys bills that
// key, not the platform's GROK_API_KEY, so a visitor talking to someone else's
// agent still gets the owner's chosen brain instead of silently dropping to
// the platform chain. Same lane shape as api/_lib/agent-voice-key.js: owner key
// first, platform key as the fallback rung, decided by the caller.

import { sql } from './db.js';
import { decryptProviderKey } from './provider-keys.js';

/** Provider slug in users.provider_keys for a Grok (xAI) BYOK key. */
export const GROK_PROVIDER = 'grok';

/**
 * Decrypt a user's stored Grok key, if they saved one.
 * A corrupt or undecryptable blob resolves to null rather than throwing: the
 * caller falls through to the server key instead of failing the whole turn.
 * @param {string|null|undefined} userId
 * @returns {Promise<string|null>}
 */
export async function loadOwnerGrokKey(userId) {
	if (!userId) return null;
	const [row] = await sql`SELECT provider_keys FROM users WHERE id = ${userId}`;
	const encrypted = row?.provider_keys?.[GROK_PROVIDER];
	if (typeof encrypted !== 'string' || !encrypted) return null;
	try {
		return (await decryptProviderKey(encrypted)) || null;
	} catch (err) {
		console.warn('[agent-grok-key] could not decrypt stored Grok key:', err?.message || err);
		return null;
	}
}
