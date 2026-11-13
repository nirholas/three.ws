// world-access-pass: a short-lived, signed "this account may enter this private
// world" ticket for the realtime room (Silver `worlds.private`).
//
// The multiplayer server identifies players by wallet, but a private world's
// owner and invitees are three.ws account ids, so the room cannot decide on its
// own who may join. The API, which can, mints this pass for the owner or an
// invitee after applying the same canReadWorld rule /api/world/load uses, and the
// room verifies it in onAuth (multiplayer/src/world-access-pass.js, kept in sync
// byte-for-byte):
//
//   pass = base64url(JSON{kind:'world-access', worldId, account, exp})
//          + '.' + base64url(HMAC_SHA256(MULTIPLAYER_SHARED_SECRET, payload))
//
// The room still checks `account` against the world's CURRENT owner and invitee
// list, so a pass that outlives an uninvite opens nothing.

import { env } from './env.js';
import { hmacSha256 } from './crypto.js';

export const WORLD_ACCESS_PASS_TTL_S = 600;

/**
 * Sign a world-access pass.
 * @param {{ worldId: string, account: string, now?: number }} args
 * @returns {Promise<{ pass: string, expiresAt: number }>} expiresAt in unix seconds
 */
export async function signWorldAccessPass({ worldId, account, now = Date.now() }) {
	const exp = Math.floor(now / 1000) + WORLD_ACCESS_PASS_TTL_S;
	const payload = Buffer.from(JSON.stringify({ kind: 'world-access', worldId, account, exp }), 'utf8').toString('base64url');
	const sig = await hmacSha256(env.MULTIPLAYER_SHARED_SECRET, payload);
	return { pass: `${payload}.${sig}`, expiresAt: exp };
}
