// Pairing codes for the chat gateways: eight characters from an alphabet with
// no look-alikes (no 0/O, 1/I/L, 5/S, 2/Z), shown as XXXX-XXXX. Only the sha256
// is stored, so a read of gateway_pair_codes cannot pair anything.

import { randomInt, createHash } from 'node:crypto';

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRTUVWXY346789';
export const CODE_LENGTH = 8;
export const CODE_TTL_MINUTES = 10;

export function generatePairCode() {
	let out = '';
	for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
	return out;
}

/** Uppercase, strip spaces and dashes. Returns null unless it can be a code. */
export function normalizePairCode(input) {
	const s = String(input || '').toUpperCase().replace(/[\s-]/g, '');
	if (s.length !== CODE_LENGTH) return null;
	for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null;
	return s;
}

export function formatPairCode(code) {
	return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function hashPairCode(code) {
	return createHash('sha256').update(`gateway-pair:${code}`).digest('hex');
}
