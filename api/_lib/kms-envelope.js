// Cloud KMS envelope encryption: the shared seal/open primitive for secrets that
// must not depend on an env-held key alone.
//
// A fresh 32-byte data key (DEK) encrypts the payload with AES-256-GCM, and the
// DEK is wrapped by a Cloud KMS crypto key. Decrypting needs a KMS call that IAM
// grants per service account and Cloud Audit Logs record, and the KMS key itself
// can never be exported or read. A database dump plus every env var on the
// service still yields nothing.
//
// The envelope names its own KMS key (`k`), so a record opens against the key it
// was sealed with even after the configured key moves to a new one.
//
// Callers:
//   api/_lib/vanity-vault.js           pre-ground vanity keys (VANITY_KMS_KEY)
//   api/_lib/x402/wallet-custody.js    backup copy of every x402 loop wallet key
//                                      (X402_WALLET_BACKUP_KMS_KEY)
//
// Nothing in this module logs secret material.

import { webcrypto } from 'node:crypto';
import { getGcpAccessToken } from './gcp-auth.js';
import { fetchUpstream } from './upstream-fetch.js';

// KMS encrypt/decrypt are idempotent (same DEK in, same wrap out), so a
// transient failure is retried behind one breaker for the KMS host.
const KMS_FETCH_OPTS = { name: 'gcp-kms', timeoutMs: 10_000, attempts: 3, okWhen: () => true };

export const KMS_PREFIX = 'kms1:';

const subtle = globalThis.crypto?.subtle || webcrypto.subtle;
const randomBytes = (n) => {
	const b = new Uint8Array(n);
	(globalThis.crypto || webcrypto).getRandomValues(b);
	return b;
};

const KEY_NAME = /^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+$/;

/** True when `name` is a full Cloud KMS crypto-key resource name. */
export function isKmsKeyName(name) {
	return typeof name === 'string' && KEY_NAME.test(name);
}

/** True when the ciphertext is a KMS envelope written by sealWithKms. */
export function isKmsEnvelope(ciphertext) {
	return typeof ciphertext === 'string' && ciphertext.startsWith(KMS_PREFIX);
}

// `token` lets an operator CLI call KMS as the operator's own gcloud login
// (a workstation's metadata token may lack the cloudkms scope); the server
// always mints its own.
async function kmsCall(keyName, op, payload, token = null) {
	if (!isKmsKeyName(keyName)) throw new Error(`KMS ${op}: not a crypto-key resource name`);
	if (!token) token = await getGcpAccessToken();
	const res = await fetchUpstream(`https://cloudkms.googleapis.com/v1/${keyName}:${op}`, {
		method: 'POST',
		headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
		body: JSON.stringify(payload),
	}, KMS_FETCH_OPTS);
	if (!res.ok) {
		const detail = await res.text().catch(() => res.status);
		throw new Error(`KMS ${op} failed (${res.status}): ${String(detail).slice(0, 300)}`);
	}
	return res.json();
}

/** Wrap a raw 32-byte DEK under `keyName`. Returns the base64 wrapped DEK. */
export async function kmsWrap(dek, keyName, { token = null } = {}) {
	const data = await kmsCall(keyName, 'encrypt', { plaintext: Buffer.from(dek).toString('base64') }, token);
	return data.ciphertext;
}

/** Unwrap a base64 wrapped DEK under `keyName`. Returns the raw DEK bytes. */
export async function kmsUnwrap(wrappedDekB64, keyName, { token = null } = {}) {
	const data = await kmsCall(keyName, 'decrypt', { ciphertext: wrappedDekB64 }, token);
	return new Uint8Array(Buffer.from(data.plaintext, 'base64'));
}

// AES-256-GCM under a raw 32-byte DEK.
async function aesGcmEncryptRaw(dek, plaintext) {
	const key = await subtle.importKey('raw', dek, { name: 'AES-GCM' }, false, ['encrypt']);
	const iv = randomBytes(12);
	const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
	return { iv: Buffer.from(iv).toString('base64'), ct: Buffer.from(new Uint8Array(ct)).toString('base64') };
}

async function aesGcmDecryptRaw(dek, ivB64, ctB64) {
	const key = await subtle.importKey('raw', dek, { name: 'AES-GCM' }, false, ['decrypt']);
	const iv = new Uint8Array(Buffer.from(ivB64, 'base64'));
	const ct = new Uint8Array(Buffer.from(ctB64, 'base64'));
	const plain = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
	return new TextDecoder().decode(plain);
}

/**
 * Seal a plaintext under a Cloud KMS key. Throws when KMS refuses: a caller that
 * asked for KMS protection never gets a silently weaker ciphertext.
 * @param {string} plaintext
 * @param {string} keyName projects/<P>/locations/<L>/keyRings/<R>/cryptoKeys/<K>
 * @param {{ wrap?: typeof kmsWrap }} [deps] injectable for tests
 */
export async function sealWithKms(plaintext, keyName, { wrap = kmsWrap } = {}) {
	if (typeof plaintext !== 'string' || !plaintext) throw new Error('sealWithKms: plaintext must be a non-empty string');
	const dek = randomBytes(32);
	try {
		const { iv, ct } = await aesGcmEncryptRaw(dek, plaintext);
		const wrappedDek = await wrap(dek, keyName);
		const envelope = { v: 1, k: keyName, dek: wrappedDek, iv, ct };
		return KMS_PREFIX + Buffer.from(JSON.stringify(envelope)).toString('base64');
	} finally {
		dek.fill(0);
	}
}

/**
 * Open a KMS envelope. Uses the key named inside the envelope unless the caller
 * passes `keyName` (the vanity vault pins its configured key).
 * @param {string} ciphertext
 * @param {{ keyName?: string, unwrap?: typeof kmsUnwrap }} [opts]
 */
export async function openKmsEnvelope(ciphertext, { keyName = null, unwrap = kmsUnwrap } = {}) {
	if (!isKmsEnvelope(ciphertext)) throw new Error('openKmsEnvelope: not a KMS envelope');
	const envelope = JSON.parse(Buffer.from(ciphertext.slice(KMS_PREFIX.length), 'base64').toString('utf8'));
	const dek = await unwrap(envelope.dek, keyName || envelope.k);
	try {
		return await aesGcmDecryptRaw(dek, envelope.iv, envelope.ct);
	} finally {
		dek.fill(0);
	}
}
