// World-access pass verification: the multiplayer half of private worlds
// (Silver `worlds.private`). The API mints the pass (api/_lib/world-access-pass.js
// → POST /api/world/access-pass) only for the owner or an invitee of a private
// world; WalkRoom verifies it here in onAuth and binds the account it carries.
//
// Keep byte-for-byte in sync with the API signer:
//   pass    = base64url(JSON{kind:'world-access', worldId, account, exp})
//             + '.' + base64url(HMAC_SHA256(secret, payload))
//   secret  = MULTIPLAYER_SHARED_SECRET (falls back to HOLDER_PASS_SECRET, then a
//             public dev secret, the same chain the API and persistence.js use).

import crypto from 'node:crypto';

function secret() {
	return (
		process.env.MULTIPLAYER_SHARED_SECRET ||
		process.env.HOLDER_PASS_SECRET ||
		'dev-insecure-multiplayer-secret'
	);
}

function timingSafeEqualStr(a, b) {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	if (ab.length !== bb.length) return false;
	return crypto.timingSafeEqual(ab, bb);
}

/**
 * Verify a world-access pass.
 * @param {unknown} token
 * @returns {{ worldId: string, account: string, exp: number } | null} null when the
 *   signature is wrong, the payload is malformed, or the pass has expired
 */
export function verifyWorldAccessPass(token) {
	if (typeof token !== 'string' || token.length > 2048 || !token.includes('.')) return null;
	const [payload, sig] = token.split('.');
	if (!payload || !sig) return null;
	const expected = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
	if (!timingSafeEqualStr(sig, expected)) return null;
	let data;
	try {
		data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
	} catch {
		return null;
	}
	if (!data || data.kind !== 'world-access') return null;
	if (typeof data.worldId !== 'string' || !data.worldId) return null;
	if (typeof data.account !== 'string' || !data.account) return null;
	if (!Number.isFinite(data.exp) || data.exp < Math.floor(Date.now() / 1000)) return null;
	return { worldId: data.worldId, account: data.account, exp: data.exp };
}
