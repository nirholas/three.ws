// Short codes that move a moment from the Meta Ray-Ban Display lens to a phone.
//
// The lens has no keyboard and a 600x600 view, so the handoff is a code the
// wearer can read off the lens and a QR the phone can scan. Two kinds share one
// store:
//
//   handoff  maps a code to one IRL pin, so three.ws/g/<code> opens that pin's
//            card on the phone (`/irl?pin=<id>&from=glass`).
//   pair     starts a lens session that a signed-in phone claims, so the lens
//            can show who it is paired with.
//
// Codes live only in the shared cache (Upstash, in memory in dev) and expire on
// their own, so there is no table to migrate and nothing to clean up. Neither
// kind carries a coordinate or a transcript; a handoff holds a pin id, a pairing
// holds a user id once claimed.

import { cacheGet, cacheSet, cacheDel } from './cache.js';

// 31 symbols: no 0/O, 1/I/L, so a code read off a lens cannot be mistyped.
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 6;
export const HANDOFF_TTL_SEC = 600;
export const PAIR_TTL_SEC = 300;

const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);
const PIN_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A fresh random code from the platform CSPRNG, uniform over the alphabet. */
export function newCode(randomValues = (a) => globalThis.crypto.getRandomValues(a)) {
	// 248 is the largest multiple of 31 under 256, so rejecting above it keeps
	// the modulo unbiased.
	const limit = 256 - (256 % CODE_ALPHABET.length);
	let out = '';
	while (out.length < CODE_LENGTH) {
		const bytes = randomValues(new Uint8Array(CODE_LENGTH * 2));
		for (const b of bytes) {
			if (b >= limit) continue;
			out += CODE_ALPHABET[b % CODE_ALPHABET.length];
			if (out.length === CODE_LENGTH) break;
		}
	}
	return out;
}

/** Upper-cases and strips separators, then returns the code or null if malformed. */
export function normalizeCode(raw) {
	const code = String(raw ?? '').toUpperCase().replace(/[\s-]/g, '');
	return CODE_RE.test(code) ? code : null;
}

export function isPinId(v) {
	return typeof v === 'string' && PIN_ID_RE.test(v);
}

const hKey = (code) => `glass:h:${code}`;
const pKey = (code) => `glass:p:${code}`;

/** Store a pin handoff under a fresh code; retries on the (rare) live collision. */
export async function mintHandoff(pinId, { now = Date.now() } = {}) {
	for (let attempt = 0; attempt < 5; attempt++) {
		const code = newCode();
		if (await cacheGet(hKey(code))) continue;
		await cacheSet(hKey(code), { pinId, exp: now + HANDOFF_TTL_SEC * 1000 }, HANDOFF_TTL_SEC);
		return { code, expires_in: HANDOFF_TTL_SEC };
	}
	throw new Error('could not allocate a handoff code');
}

/** The pin a code points at, or null when unknown or expired. */
export async function resolveHandoff(raw, { now = Date.now() } = {}) {
	const code = normalizeCode(raw);
	if (!code) return null;
	const row = await cacheGet(hKey(code));
	if (!row || !isPinId(row.pinId) || (row.exp && row.exp <= now)) return null;
	return { code, pinId: row.pinId };
}

/** Start a pairing: the lens shows the code, a signed-in phone claims it. */
export async function startPairing({ now = Date.now() } = {}) {
	for (let attempt = 0; attempt < 5; attempt++) {
		const code = newCode();
		if (await cacheGet(pKey(code))) continue;
		await cacheSet(pKey(code), { userId: null, name: null, exp: now + PAIR_TTL_SEC * 1000 }, PAIR_TTL_SEC);
		return { code, expires_in: PAIR_TTL_SEC };
	}
	throw new Error('could not allocate a pairing code');
}

/** Phone side: bind a signed-in user to a waiting pairing. */
export async function claimPairing(raw, user, { now = Date.now() } = {}) {
	const code = normalizeCode(raw);
	if (!code) return { ok: false, reason: 'malformed' };
	const row = await cacheGet(pKey(code));
	if (!row || (row.exp && row.exp <= now)) return { ok: false, reason: 'unknown' };
	if (row.userId && row.userId !== user.id) return { ok: false, reason: 'taken' };
	const remaining = Math.max(1, Math.ceil((row.exp - now) / 1000));
	await cacheSet(pKey(code), { ...row, userId: user.id, name: user.display_name || user.username || 'Your account' }, remaining);
	return { ok: true, name: user.display_name || user.username || 'Your account' };
}

/** Lens side: has a phone claimed this pairing yet? */
export async function pairingStatus(raw, { now = Date.now() } = {}) {
	const code = normalizeCode(raw);
	if (!code) return { state: 'malformed' };
	const row = await cacheGet(pKey(code));
	if (!row || (row.exp && row.exp <= now)) return { state: 'expired' };
	if (!row.userId) return { state: 'waiting', expires_in: Math.max(1, Math.ceil((row.exp - now) / 1000)) };
	return { state: 'paired', name: row.name };
}

/** Forget a pairing once the lens has seen it claimed. */
export async function endPairing(raw) {
	const code = normalizeCode(raw);
	if (code) await cacheDel(pKey(code));
}
