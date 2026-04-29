// Deterministic key derivation + AES-GCM-256 authenticated encryption for memory bundles.
// Uses only crypto.subtle — no polyfills, no bundle weight.

function hexToBytes(hex) {
	const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
	const out = new Uint8Array(clean.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
	return out;
}

export function bytesToBase64(bytes) {
	return btoa(String.fromCharCode(...bytes));
}

export function base64ToBytes(b64) {
	return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/**
 * Derive a non-extractable AES-GCM-256 CryptoKey from a wallet signer.
 * Deterministic for the same (wallet, agentId) pair — memory follows the owner across devices.
 *
 * Canonical message: `agent-3d:memory:v1:{agentId}`
 * Bump the version prefix on any breaking crypto change.
 *
 * @param {import('ethers').Signer} signer
 * @param {string} agentId
 * @returns {Promise<CryptoKey>}
 */
export async function deriveEncryptionKey(signer, agentId) {
	const message = `agent-3d:memory:v1:${agentId}`;
	const signature = await signer.signMessage(message);
	const sigBytes = hexToBytes(signature);
	const hashBuf = await crypto.subtle.digest('SHA-256', sigBytes);
	const baseKey = await crypto.subtle.importKey('raw', hashBuf, 'HKDF', false, ['deriveKey']);
	return crypto.subtle.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: new Uint8Array(32),
			info: new TextEncoder().encode('agent-3d-memory-aes-gcm'),
		},
		baseKey,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt'],
	);
}

/**
 * Encrypt plaintext bytes with AES-GCM-256.
 * A fresh 12-byte nonce is generated per call; the GCM auth tag is appended to ciphertext.
 *
 * @param {Uint8Array} plaintext
 * @param {CryptoKey} key
 * @returns {Promise<{ nonce: Uint8Array, ciphertext: Uint8Array }>}
 */
export async function encryptBlob(plaintext, key) {
	const nonce = crypto.getRandomValues(new Uint8Array(12));
	const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plaintext);
	return { nonce, ciphertext: new Uint8Array(buf) };
}

/**
 * Decrypt an AES-GCM-256 blob.
 * Throws clearly on tampered ciphertext or wrong key — no silent corruption.
 *
 * @param {{ nonce: Uint8Array, ciphertext: Uint8Array }} blob
 * @param {CryptoKey} key
 * @returns {Promise<Uint8Array>}
 */
export async function decryptBlob({ nonce, ciphertext }, key) {
	try {
		const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext);
		return new Uint8Array(buf);
	} catch {
		throw new Error('[memory/crypto] Decryption failed — wrong key or tampered ciphertext');
	}
}
