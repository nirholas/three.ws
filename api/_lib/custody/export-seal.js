// Transport sealing for a private-key export.
//
// The browser generates an ephemeral ECDH P-256 key pair and sends only the
// public half. The server derives a shared secret with a fresh ephemeral key of
// its own, runs it through HKDF-SHA256 and AES-256-GCM-encrypts the key bytes.
// What goes on the wire is ciphertext only: the plaintext secret never appears
// in a response body, a log line or a proxy cache, and only the browser holding
// the matching private key can open it. The browser then re-encrypts the key to
// a passphrase the user types, which never leaves the page (src/wallet/export.js).
//
// The wrapping parameters are fixed here and mirrored byte for byte in
// src/wallet/export.js; tests/custody-export.test.js round-trips them.

import { createCipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';

export const SEAL_VERSION = 1;
export const SEAL_ALG = 'ECDH-P256+HKDF-SHA256+AES-256-GCM';
const CLIENT_KEY_LEN = 65;

/** The HKDF info string. Binds the sealed key to one agent and one address. */
export function sealInfo(agentId, address) {
	return `three.ws wallet export v${SEAL_VERSION}|${agentId}|${address}`;
}

/**
 * Seal `secret` to the browser's ephemeral public key.
 * @param {Uint8Array} secret              the 64-byte Solana keypair bytes
 * @param {string} clientPublicKeyB64       raw uncompressed P-256 point, base64
 * @param {{ agentId: string, address: string }} ctx
 */
export function sealForClient(secret, clientPublicKeyB64, { agentId, address }) {
	let clientPub;
	try {
		clientPub = Buffer.from(String(clientPublicKeyB64 || ''), 'base64');
	} catch {
		clientPub = Buffer.alloc(0);
	}
	if (clientPub.length !== CLIENT_KEY_LEN || clientPub[0] !== 0x04) {
		throw Object.assign(new Error('client_public_key must be a base64 uncompressed P-256 public key (65 bytes)'), {
			status: 400, code: 'invalid_parameter', expose: true,
		});
	}
	const ecdh = createECDH('prime256v1');
	ecdh.generateKeys();
	let shared;
	try {
		shared = ecdh.computeSecret(clientPub);
	} catch {
		throw Object.assign(new Error('client_public_key is not a valid P-256 point'), { status: 400, code: 'invalid_parameter', expose: true });
	}
	const salt = randomBytes(16);
	const iv = randomBytes(12);
	const key = Buffer.from(hkdfSync('sha256', shared, salt, sealInfo(agentId, address), 32));
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const body = Buffer.concat([cipher.update(secret), cipher.final(), cipher.getAuthTag()]);
	key.fill(0);
	shared.fill(0);
	return {
		v: SEAL_VERSION,
		alg: SEAL_ALG,
		server_public_key: ecdh.getPublicKey().toString('base64'),
		salt: salt.toString('base64'),
		iv: iv.toString('base64'),
		ciphertext: body.toString('base64'),
	};
}

/** Cheap shape check so a bad key is refused before a re-authentication grant is spent. */
export function assertClientPublicKey(clientPublicKeyB64) {
	const raw = Buffer.from(String(clientPublicKeyB64 || ''), 'base64');
	if (raw.length !== CLIENT_KEY_LEN || raw[0] !== 0x04) {
		throw Object.assign(new Error('client_public_key must be a base64 uncompressed P-256 public key (65 bytes)'), {
			status: 400, code: 'invalid_parameter', expose: true,
		});
	}
}
