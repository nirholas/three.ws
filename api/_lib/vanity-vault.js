// Vanity inventory vault — the single seal/open primitive for pre-ground private
// keys held in `vanity_inventory`.
//
// WHY THIS EXISTS (and why not just secret-box directly):
// The platform's strongest at-rest primitive is api/_lib/secret-box.js —
// AES-256-GCM under a dedicated WALLET_ENCRYPTION_KEY with a random per-record
// salt, fail-closed in production. It already protects agent wallet keys and
// pump.fun creator keys, so it is the correct, consistent default here and IS
// strong enough against a DB dump (keys are unreadable without the env key).
//
// Inventory adds ONE threat secret-box alone does not address: INSIDER ACCESS.
// secret-box's key is an env var — anyone who can read the delivery service's
// environment can decrypt every stored key offline, forever. For a store whose
// entire value is unspent private keys, that is worth defense-in-depth. So this
// vault supports an OPTIONAL GCP-KMS ENVELOPE layer: a fresh 32-byte data-key
// (DEK) encrypts each payload with AES-256-GCM, and the DEK is wrapped by a KMS
// crypto key whose decrypt permission is granted (via IAM) ONLY to the delivery
// service identity. A DB dump then yields nothing; even the env key yields
// nothing without a KMS decrypt call that IAM can revoke and Cloud Audit Logs
// record. When VANITY_KMS_KEY is unset the vault transparently uses secret-box —
// no feature breaks, no plaintext is ever exposed either way.
//
// Both schemes are authenticated (AES-GCM), so a wrong key throws rather than
// returning garbage plaintext. Nothing in this module logs secret material.

import { encryptSecret, decryptSecret } from './secret-box.js';
import { KMS_PREFIX, sealWithKms, openKmsEnvelope } from './kms-envelope.js';

// Scheme tags — persisted in vanity_inventory.secret_scheme and self-described in
// the ciphertext prefix so open() can dispatch even if the column drifts.
export const SCHEME_SECRETBOX = 'aes-256-gcm';
export const SCHEME_KMS_ENVELOPE = 'gcp-kms+aes-256-gcm';

const readEnv = (name) =>
	typeof process !== 'undefined' && process.env?.[name] ? process.env[name].trim() : '';

// The KMS crypto-key resource name:
//   projects/<P>/locations/<L>/keyRings/<R>/cryptoKeys/<K>
// When present (and reachable), sealing uses the envelope scheme.
export function kmsKeyName() {
	return readEnv('VANITY_KMS_KEY');
}

/** True when the KMS envelope layer is configured (does not prove reachability). */
export function kmsConfigured() {
	return Boolean(kmsKeyName());
}

/** The scheme sealSecret() will use given current configuration. */
export function preferredScheme() {
	return kmsConfigured() ? SCHEME_KMS_ENVELOPE : SCHEME_SECRETBOX;
}

// The KMS envelope itself (DEK wrap/unwrap, AES-256-GCM layout) lives in
// api/_lib/kms-envelope.js, shared with the x402 wallet-custody backups.

/**
 * Seal a plaintext secret for at-rest storage in vanity_inventory.
 *
 * @param {string} plaintext - the secret JSON/string (e.g. the 64-byte key + meta).
 * @returns {Promise<{ ciphertext: string, scheme: string }>}
 *
 * Uses the KMS envelope when VANITY_KMS_KEY is set, else secret-box. If the KMS
 * path is configured but the encrypt call fails, sealing FAILS CLOSED (throws) —
 * we never silently downgrade a key the operator asked KMS to protect. (The
 * unconfigured path is the deliberate, documented secret-box default.)
 */
export async function sealSecret(plaintext) {
	if (typeof plaintext !== 'string' || !plaintext) {
		throw new Error('sealSecret: plaintext must be a non-empty string');
	}
	if (kmsConfigured()) {
		const ciphertext = await sealWithKms(plaintext, kmsKeyName());
		return { ciphertext, scheme: SCHEME_KMS_ENVELOPE };
	}
	const ciphertext = await encryptSecret(plaintext);
	return { ciphertext, scheme: SCHEME_SECRETBOX };
}

/**
 * Open a sealed secret. Dispatches on the ciphertext's own prefix first (robust
 * to a drifted scheme column), falling back to the provided scheme hint.
 *
 * @param {string} ciphertext
 * @param {string} [scheme]
 * @returns {Promise<string>} the plaintext secret.
 */
export async function openSecret(ciphertext, scheme) {
	if (typeof ciphertext !== 'string' || !ciphertext) {
		throw new Error('openSecret: missing ciphertext (already destroyed?)');
	}
	const isKms = ciphertext.startsWith(KMS_PREFIX) || scheme === SCHEME_KMS_ENVELOPE;
	if (isKms) {
		if (!ciphertext.startsWith(KMS_PREFIX)) {
			throw new Error('openSecret: scheme says KMS but ciphertext is not a KMS envelope');
		}
		return openKmsEnvelope(ciphertext, { keyName: kmsKeyName() });
	}
	return decryptSecret(ciphertext);
}
