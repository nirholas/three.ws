// Small crypto helpers that work in both Node and edge runtimes.

import { webcrypto } from 'node:crypto';

const subtle = globalThis.crypto?.subtle || webcrypto.subtle;
const randomBytes = (n) => {
	const b = new Uint8Array(n);
	(globalThis.crypto || webcrypto).getRandomValues(b);
	return b;
};

export function randomToken(bytes = 32) {
	return base64url(randomBytes(bytes));
}

export async function sha256(input) {
	const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
	const hash = await subtle.digest('SHA-256', data);
	return hex(new Uint8Array(hash));
}

export async function sha256Base64Url(input) {
	const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
	const hash = await subtle.digest('SHA-256', data);
	return base64url(new Uint8Array(hash));
}

export function constantTimeEquals(a, b) {
	if (a.length !== b.length) return false;
	let r = 0;
	for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return r === 0;
}

export async function hmacSha256(secret, message) {
	const key = await subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const sig = await subtle.sign('HMAC', key, new TextEncoder().encode(message));
	return base64url(new Uint8Array(sig));
}

function hex(u8) {
	return Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
}

function base64url(u8) {
	let s = '';
	for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
	return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
