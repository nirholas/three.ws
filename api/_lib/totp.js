// TOTP (RFC 6238) on HOTP (RFC 4226): HMAC-SHA1, 6 digits, 30 second steps,
// the parameters every authenticator app (Microsoft Authenticator, Google
// Authenticator, 1Password, Authy) reads from an otpauth:// URI.
//
// Pure functions over node:crypto. Account two-step verification
// (api/_lib/account-mfa.js) builds on these; tests/totp.test.js checks them
// against the RFC 6238 appendix B vectors.

import { createHmac } from 'node:crypto';

export const TOTP_PERIOD = 30;
export const TOTP_DIGITS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 without padding, the form otpauth:// secrets use. */
export function base32Encode(bytes) {
	let bits = 0;
	let value = 0;
	let out = '';
	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			out += B32[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) out += B32[(value << (5 - bits)) & 31];
	return out;
}

/** Decode base32, tolerating lowercase, spaces, dashes and padding. Throws on other characters. */
export function base32Decode(text) {
	const clean = String(text).toUpperCase().replace(/[\s=-]/g, '');
	let bits = 0;
	let value = 0;
	const out = [];
	for (const ch of clean) {
		const idx = B32.indexOf(ch);
		if (idx === -1) throw new TypeError('invalid base32 secret');
		value = (value << 5) | idx;
		bits += 5;
		if (bits >= 8) {
			out.push((value >>> (bits - 8)) & 255);
			bits -= 8;
		}
	}
	return Buffer.from(out);
}

/** HOTP value for `key` (raw bytes) at `counter`, zero-padded to `digits`. */
export function hotp(key, counter, digits = TOTP_DIGITS) {
	const msg = Buffer.alloc(8);
	msg.writeBigUInt64BE(BigInt(counter));
	const mac = createHmac('sha1', key).update(msg).digest();
	const offset = mac[mac.length - 1] & 0x0f;
	const bin = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
	return String(bin).padStart(digits, '0');
}

/** The TOTP code for `key` at `unixSec`. */
export function generateTotp(key, unixSec, digits = TOTP_DIGITS) {
	return hotp(key, Math.floor(unixSec / TOTP_PERIOD), digits);
}

/**
 * The time step `code` matches within +/- `window` steps of now, or null.
 * Steps at or before `afterStep` are refused, so a code that was already
 * accepted once (or any older one) cannot be replayed inside its window.
 */
export function matchTotp(key, code, { nowSec = Math.floor(Date.now() / 1000), window = 1, afterStep = 0 } = {}) {
	if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
	const current = Math.floor(nowSec / TOTP_PERIOD);
	let matched = null;
	// Compare every candidate rather than returning on the first hit, so the
	// time taken does not depend on which step matched.
	for (let delta = -window; delta <= window; delta++) {
		const step = current + delta;
		if (step <= afterStep) continue;
		if (hotp(key, step) === code && matched === null) matched = step;
	}
	return matched;
}

/** otpauth://totp URI an authenticator app enrols from (shown as a QR code). */
export function otpauthUri({ secret, account, issuer = 'three.ws' }) {
	const label = encodeURIComponent(`${issuer}:${account}`);
	const params = new URLSearchParams({
		secret,
		issuer,
		algorithm: 'SHA1',
		digits: String(TOTP_DIGITS),
		period: String(TOTP_PERIOD),
	});
	return `otpauth://totp/${label}?${params}`;
}
