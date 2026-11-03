// Browser half of the private-key export (api/_lib/custody/export-seal.js).
//
//   1. beginKeyExport()          make an ephemeral ECDH key pair; send the public half
//   2. openSealedKey(...)        open the server's sealed response with the private half
//   3. encryptKeyToPassphrase()  re-encrypt the key to a passphrase typed in this page
//
// The passphrase and the plaintext key never leave the browser. decryptKeyEnvelope
// reverses step 3 so a user can recover the key later; scripts/decrypt-wallet-export.mjs
// runs the same function from a terminal.

const SEAL_VERSION = 1;
export const ENVELOPE_FORMAT = 'three.ws-wallet-export';
export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSPHRASE_LENGTH = 12;

const enc = new TextEncoder();

function webcrypto() {
	const c = globalThis.crypto;
	if (!c?.subtle) throw new Error('This browser has no WebCrypto support, so a key export cannot be encrypted here.');
	return c;
}

function toB64(bytes) {
	let s = '';
	const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
	return btoa(s);
}

function fromB64(b64) {
	const bin = atob(String(b64));
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

/** Rate a passphrase before it is used to encrypt a key. */
export function passphraseProblem(passphrase) {
	if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE_LENGTH) {
		return `Use at least ${MIN_PASSPHRASE_LENGTH} characters.`;
	}
	if (new Set(passphrase).size < 5) return 'Use a passphrase with more variety.';
	return null;
}

/** Step 1: an ephemeral key pair. Send `publicKey` (base64) to the server. */
export async function beginKeyExport() {
	const { subtle } = webcrypto();
	const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
	const raw = await subtle.exportKey('raw', pair.publicKey);
	return { privateKey: pair.privateKey, publicKey: toB64(raw) };
}

/**
 * Step 2: open the server's sealed key. Returns the 64-byte Solana keypair bytes.
 * @param {{ server_public_key: string, salt: string, iv: string, ciphertext: string, v: number }} sealed
 */
export async function openSealedKey(sealed, privateKey, { agentId, address }) {
	if (!sealed || sealed.v !== SEAL_VERSION) throw new Error('The server answered with an export format this page does not understand.');
	const { subtle } = webcrypto();
	const serverKey = await subtle.importKey('raw', fromB64(sealed.server_public_key), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
	const shared = await subtle.deriveBits({ name: 'ECDH', public: serverKey }, privateKey, 256);
	const hkdfKey = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
	const aes = await subtle.deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt: fromB64(sealed.salt), info: enc.encode(`three.ws wallet export v${SEAL_VERSION}|${agentId}|${address}`) },
		hkdfKey,
		{ name: 'AES-GCM', length: 256 },
		false,
		['decrypt'],
	);
	const plain = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(sealed.iv) }, aes, fromB64(sealed.ciphertext));
	return new Uint8Array(plain);
}

async function passphraseKey(passphrase, salt, iterations, usage) {
	const { subtle } = webcrypto();
	const base = await subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
	return subtle.deriveKey(
		{ name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
		base,
		{ name: 'AES-GCM', length: 256 },
		false,
		[usage],
	);
}

/**
 * Step 3: encrypt the key to a passphrase. Returns the envelope the user keeps.
 * @param {Uint8Array} secret
 */
export async function encryptKeyToPassphrase(secret, passphrase, { address, agentId = null }) {
	const problem = passphraseProblem(passphrase);
	if (problem) throw new Error(problem);
	const c = webcrypto();
	const salt = c.getRandomValues(new Uint8Array(16));
	const iv = c.getRandomValues(new Uint8Array(12));
	const key = await passphraseKey(passphrase, salt, PBKDF2_ITERATIONS, 'encrypt');
	const ciphertext = await c.subtle.encrypt({ name: 'AES-GCM', iv }, key, secret);
	return {
		format: ENVELOPE_FORMAT,
		v: 1,
		address,
		agent_id: agentId,
		created_at: new Date().toISOString(),
		kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, salt: toB64(salt) },
		cipher: { name: 'AES-GCM', iv: toB64(iv) },
		ciphertext: toB64(ciphertext),
	};
}

/** Recover the 64-byte key from an envelope and its passphrase. */
export async function decryptKeyEnvelope(envelope, passphrase) {
	if (!envelope || envelope.format !== ENVELOPE_FORMAT || envelope.v !== 1) throw new Error('This is not a three.ws wallet export.');
	const { subtle } = webcrypto();
	const iterations = Number(envelope.kdf?.iterations);
	if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 5_000_000) throw new Error('The export has an unsupported key-derivation setting.');
	const key = await passphraseKey(String(passphrase), fromB64(envelope.kdf.salt), iterations, 'decrypt');
	try {
		const plain = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(envelope.cipher.iv) }, key, fromB64(envelope.ciphertext));
		return new Uint8Array(plain);
	} catch {
		throw new Error('Wrong passphrase, or the export file was altered.');
	}
}
