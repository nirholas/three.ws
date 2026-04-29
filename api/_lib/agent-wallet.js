// Agent wallet generation and management.
// Generates a random Ethereum wallet per agent and encrypts the private key
// at rest using AES-256-GCM with the server JWT_SECRET as the key material.

import { webcrypto } from 'node:crypto';
import { env } from './env.js';

const subtle = globalThis.crypto?.subtle || webcrypto.subtle;
const randomBytes = (n) => {
	const b = new Uint8Array(n);
	(globalThis.crypto || webcrypto).getRandomValues(b);
	return b;
};

// ── Key derivation ──────────────────────────────────────────────────────────
// Derive a stable AES-256 key from JWT_SECRET for encrypting agent private keys.
async function deriveKey() {
	const raw = new TextEncoder().encode(env.JWT_SECRET);
	const base = await subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
	return subtle.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: new TextEncoder().encode('agent-wallet-v1'),
			info: new Uint8Array(0),
		},
		base,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt'],
	);
}

// ── Encrypt / decrypt ───────────────────────────────────────────────────────

async function encrypt(plaintext) {
	const key = await deriveKey();
	const iv = randomBytes(12);
	const data = new TextEncoder().encode(plaintext);
	const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
	const buf = new Uint8Array(iv.length + ct.byteLength);
	buf.set(iv, 0);
	buf.set(new Uint8Array(ct), iv.length);
	return Buffer.from(buf).toString('base64');
}

async function decrypt(ciphertext) {
	const key = await deriveKey();
	const raw = Buffer.from(ciphertext, 'base64');
	const iv = raw.subarray(0, 12);
	const ct = raw.subarray(12);
	const plain = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
	return new TextDecoder().decode(plain);
}

// ── Wallet generation ───────────────────────────────────────────────────────

/**
 * Generate a new Ethereum wallet for an agent.
 * Returns { address, encrypted_key } where encrypted_key is the AES-GCM
 * encrypted private key (base64). Store encrypted_key in agent meta.
 */
export async function generateAgentWallet() {
	// Generate 32 random bytes for a private key
	const pk = randomBytes(32);
	const pkHex = '0x' + Array.from(pk, (b) => b.toString(16).padStart(2, '0')).join('');

	// Compute address from private key using ethers
	const { computeAddress } = await import('ethers');
	const address = computeAddress(pkHex);

	const encrypted_key = await encrypt(pkHex);
	return { address, encrypted_key };
}

/**
 * Recover an agent wallet's private key from its encrypted form.
 * Only call this when the agent needs to sign a transaction.
 */
export async function recoverAgentKey(encryptedKey) {
	return decrypt(encryptedKey);
}

// ── Solana wallet ───────────────────────────────────────────────────────────

/**
 * Generate a new Solana keypair for an agent.
 * Returns { address, encrypted_secret } where encrypted_secret is the base64
 * AES-GCM ciphertext of the 64-byte secret key (also base64-encoded inside).
 */
export async function generateSolanaAgentWallet() {
	const { Keypair } = await import('@solana/web3.js');
	const kp = Keypair.generate();
	const secretB64 = Buffer.from(kp.secretKey).toString('base64');
	const encrypted_secret = await encrypt(secretB64);
	return { address: kp.publicKey.toBase58(), encrypted_secret };
}

/**
 * Recover a Solana Keypair from its encrypted form.
 * Only call this when the agent needs to sign a transaction.
 */
export async function recoverSolanaAgentKeypair(encryptedSecret) {
	const { Keypair } = await import('@solana/web3.js');
	const secretB64 = await decrypt(encryptedSecret);
	return Keypair.fromSecretKey(Buffer.from(secretB64, 'base64'));
}
