// The optional bearer token a developer webhook sends as
// `Authorization: Bearer <token>`, encrypted at rest.
//
// A Grok Bot routine webhook trigger, and other receivers that authenticate
// callers with a static key instead of verifying a signature, accept a
// delivery only when it carries that header. The token belongs to the
// receiver's system, so it is stored AES-256-GCM encrypted with a key derived
// (HKDF) from JWT_SECRET under its own salt, never logged and never returned
// by any API: responses say only whether one is set.

import { webcrypto } from 'node:crypto';
import { env } from './env.js';

const subtle = globalThis.crypto?.subtle || webcrypto.subtle;
const SALT = 'webhook-auth-token-v1';

export const BEARER_TOKEN_MIN = 8;
export const BEARER_TOKEN_MAX = 512;

let keyPromise = null;
function deriveKey() {
	keyPromise ??= (async () => {
		const base = await subtle.importKey('raw', new TextEncoder().encode(env.JWT_SECRET), 'HKDF', false, ['deriveKey']);
		return subtle.deriveKey(
			{ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode(SALT), info: new Uint8Array(0) },
			base,
			{ name: 'AES-GCM', length: 256 },
			false,
			['encrypt', 'decrypt'],
		);
	})().catch((err) => {
		keyPromise = null;
		throw err;
	});
	return keyPromise;
}

/**
 * Normalize a caller-supplied token. Accepts the bare key or a pasted
 * "Bearer <key>" header value. Returns { token } or { error }.
 */
export function parseBearerToken(raw) {
	if (typeof raw !== 'string') return { error: 'bearerToken must be a string.' };
	const token = raw.trim().replace(/^bearer\s+/i, '').trim();
	if (token.length < BEARER_TOKEN_MIN) return { error: `bearerToken must be at least ${BEARER_TOKEN_MIN} characters.` };
	if (token.length > BEARER_TOKEN_MAX) return { error: `bearerToken must be at most ${BEARER_TOKEN_MAX} characters.` };
	// A header value: visible ASCII only. Spaces, CR and LF would let a token
	// split or inject headers.
	if (!/^[\x21-\x7e]+$/.test(token)) return { error: 'bearerToken may contain only visible ASCII characters, with no spaces.' };
	return { token };
}

export async function encryptBearerToken(token) {
	const key = await deriveKey();
	const iv = webcrypto.getRandomValues(new Uint8Array(12));
	const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token)));
	const buf = new Uint8Array(iv.length + ct.length);
	buf.set(iv, 0);
	buf.set(ct, iv.length);
	return Buffer.from(buf).toString('base64');
}

export async function decryptBearerToken(ciphertext) {
	const key = await deriveKey();
	const raw = Buffer.from(ciphertext, 'base64');
	const plain = await subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, key, raw.subarray(12));
	return new TextDecoder().decode(plain);
}

/**
 * The column value for a create or update body: undefined when the body does
 * not mention the token (leave it as is), null to clear it (null or ""), or
 * the encrypted token. Returns { value } or { error }.
 */
export async function bearerTokenColumn(body) {
	const has = (k) => Object.prototype.hasOwnProperty.call(body || {}, k);
	const key = has('bearerToken') ? 'bearerToken' : has('bearer_token') ? 'bearer_token' : null;
	if (!key) return { value: undefined };
	const raw = body[key];
	if (raw === null || raw === '') return { value: null };
	const parsed = parseBearerToken(raw);
	if (parsed.error) return { error: parsed.error };
	return { value: await encryptBearerToken(parsed.token) };
}
