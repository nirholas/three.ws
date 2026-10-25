// Confirm tokens for pairing a chat from the site.
//
// A pairing code is typed or followed from a link, so whoever holds one can
// make a signed-in owner bind the chat that printed it. The site therefore
// shows the owner which chat is asking (the preview step) and redeems only
// with the token that step returns. The token is an HMAC over the user, the
// code and an expiry, so it cannot be reused by another account, for another
// code, or after it lapses.

import { hmacSha256, constantTimeEquals } from '../crypto.js';
import { env } from '../env.js';
import { hashPairCode } from './codes.js';

export const PAIR_CONFIRM_TTL_SECONDS = 300;

async function mac(userId, code, exp) {
	return hmacSha256(env.JWT_SECRET, `gateway-pair-confirm:${userId}:${hashPairCode(code)}:${exp}`);
}

export async function signPairConfirm(userId, code, now = Date.now()) {
	const exp = Math.floor(now / 1000) + PAIR_CONFIRM_TTL_SECONDS;
	return `${exp}.${await mac(userId, code, exp)}`;
}

export async function verifyPairConfirm(token, userId, code, now = Date.now()) {
	if (typeof token !== 'string') return false;
	const [expStr, sig, extra] = token.split('.');
	if (extra !== undefined || !sig || !/^\d{1,12}$/.test(expStr)) return false;
	const exp = Number(expStr);
	if (exp < Math.floor(now / 1000)) return false;
	return constantTimeEquals(sig, await mac(userId, code, exp));
}
