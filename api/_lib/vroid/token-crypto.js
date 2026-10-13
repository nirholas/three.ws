// Encryption for stored VRoid Hub OAuth tokens. Same HKDF-SHA256-from-
// JWT_SECRET derivation as api/_lib/github-token.js, with its own fixed salt
// so the two token stores can never decrypt each other's ciphertext and a
// rotated JWT_SECRET invalidates both independently (the user reconnects
// rather than the token decrypting into garbage).

import { webcrypto } from 'node:crypto';
import { env } from '../env.js';

const subtle = globalThis.crypto?.subtle || webcrypto.subtle;
const IV_BYTES = 12;

async function deriveKey(usages) {
	const raw = new TextEncoder().encode(env.JWT_SECRET);
	const base = await subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
	return subtle.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: new TextEncoder().encode('vroid-hub-token'),
			info: new Uint8Array(0),
		},
		base,
		{ name: 'AES-GCM', length: 256 },
		false,
		usages,
	);
}

export async function encryptVroidToken(plaintext) {
	const key = await deriveKey(['encrypt', 'decrypt']);
	const iv = new Uint8Array(IV_BYTES);
	(globalThis.crypto || webcrypto).getRandomValues(iv);
	const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
	const buf = new Uint8Array(iv.length + ct.byteLength);
	buf.set(iv, 0);
	buf.set(new Uint8Array(ct), iv.length);
	return Buffer.from(buf).toString('base64');
}

export async function decryptVroidToken(ciphertext) {
	const key = await deriveKey(['decrypt']);
	const buf = Buffer.from(ciphertext, 'base64');
	const iv = buf.subarray(0, IV_BYTES);
	const ct = buf.subarray(IV_BYTES);
	const plain = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
	return new TextDecoder().decode(plain);
}
