/**
 * Service identity key for the provably-fair vanity grinder.
 *
 * The verifiable-grind endpoint signs every receipt with a long-lived Ed25519
 * key so a buyer can prove the receipt really came from three.ws. The SECRET
 * seed is custodial: it never leaves the server, never appears in a log, and is
 * stored encrypted at rest via secret-box.js. The PUBLIC key is published at
 * /.well-known/three-vanity.json and pinned in the SDK + verifier.
 *
 * Configuration (`VANITY_SERVICE_KEY`) accepts either:
 *   • a secret-box v2 ciphertext ("v2:…") wrapping a 32-byte seed (hex/Base58), or
 *   • a raw 32-byte Ed25519 seed in hex (64 chars) or Base58.
 *
 * When unset, a deterministic dev seed is derived from JWT_SECRET (HKDF, with a
 * one-time warning) so local/CI works without extra setup — production must set
 * a dedicated value so the published public key is stable and not session-bound.
 */

import bs58 from 'bs58';
import { ed25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

import { env } from './env.js';
import { decryptSecret, isEncryptedSecret } from './secret-box.js';

const SEED_BYTES = 32;
const DEV_INFO = new TextEncoder().encode('three-vanity/dev-service-key/v1');

let _cached = null;
let _warnedDev = false;

function seedFromString(value, label) {
	const s = String(value).trim();
	if (/^[0-9a-fA-F]{64}$/.test(s)) return hexToBytes(s);
	const decoded = bs58.decode(s);
	if (decoded.length !== SEED_BYTES) {
		throw new Error(`${label} must decode to a 32-byte Ed25519 seed (got ${decoded.length})`);
	}
	return decoded;
}

async function loadSeed() {
	const configured = env.VANITY_SERVICE_KEY;
	if (configured) {
		const raw = isEncryptedSecret(configured) ? await decryptSecret(configured) : configured;
		return seedFromString(raw, 'VANITY_SERVICE_KEY');
	}
	// Deterministic dev key derived from JWT_SECRET. Stable per-deployment so the
	// published public key and signed receipts stay consistent within an env.
	if (!_warnedDev) {
		_warnedDev = true;
		console.warn(
			'[vanity-service-key] VANITY_SERVICE_KEY is not set; deriving a deterministic dev ' +
				'signing key from JWT_SECRET. Set a dedicated VANITY_SERVICE_KEY in production so ' +
				'the published service public key is stable and independent of the session secret.',
		);
	}
	const ikm = new TextEncoder().encode(env.JWT_SECRET);
	return hkdf(sha256, ikm, sha256(DEV_INFO), DEV_INFO, SEED_BYTES);
}

/**
 * Stable, rotation-aware key id derived from the public key itself, so the
 * issuer, the published well-known keyring, and any verifier always agree on the
 * id without separate configuration — rotating the seed rotates the id for free.
 * @param {string} publicKeyHex
 * @returns {string}
 */
export function keyIdForPublicKey(publicKeyHex) {
	return `pog-${String(publicKeyHex).slice(0, 16)}`;
}

/**
 * Resolve the service signing identity. Cached after first load.
 * @returns {Promise<{ seed: Uint8Array, publicKey: Uint8Array, publicKeyBase58: string, publicKeyHex: string, keyId: string }>}
 */
export async function getServiceIdentity() {
	if (_cached) return _cached;
	const seed = await loadSeed();
	const publicKey = ed25519.getPublicKey(seed);
	const publicKeyHex = bytesToHex(publicKey);
	_cached = {
		seed,
		publicKey,
		publicKeyBase58: bs58.encode(publicKey),
		publicKeyHex,
		keyId: keyIdForPublicKey(publicKeyHex),
	};
	return _cached;
}

/** The signing seed only — for signReceipt(). Never log or return this. */
export async function getServiceSigningSeed() {
	return (await getServiceIdentity()).seed;
}

/** The public key (Base58) — safe to publish/pin. */
export async function getServicePublicKeyBase58() {
	return (await getServiceIdentity()).publicKeyBase58;
}
