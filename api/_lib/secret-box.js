// Secret box — the single AES-256-GCM encrypt/decrypt primitive for every
// custodial secret the platform stores at rest (agent wallet keys, pump.fun coin
// creator keys). Kept dependency-free (only `env` + webcrypto) so it can be
// imported by lean call sites — a Solana-only CLI or the coin treasury — without
// dragging in ethers/EVM providers.
//
// Key management (v2): the encryption key derives from a DEDICATED secret
// (WALLET_ENCRYPTION_KEY) — independent of JWT_SECRET — with a RANDOM per-record
// salt embedded in each ciphertext. v1 ciphertexts (no version tag, JWT_SECRET +
// constant salt) still decrypt via the legacy branch so older records keep
// working; new writes always use v2. Set WALLET_ENCRYPTION_KEY in every
// environment that holds custodial secrets; until it is set the code falls back
// to JWT_SECRET (with a one-time warning) so deploys don't break.
//
// Decryption is intentionally tolerant: a record is tried against the dedicated
// key, then every retired key in WALLET_ENCRYPTION_KEY_PREVIOUS, then JWT_SECRET.
// That keeps two classes of record readable that would otherwise be lost forever:
// v2 records written under the JWT_SECRET fallback before a dedicated key existed,
// and records written under a key that has since been rotated out. Encryption is
// NOT tolerant: it always uses the current dedicated key (fail-closed in prod), so
// rotation upgrades records as they are rewritten and never depends on JWT_SECRET.

import { webcrypto } from 'node:crypto';
import { env } from './env.js';

const subtle = globalThis.crypto?.subtle || webcrypto.subtle;
const randomBytes = (n) => {
	const b = new Uint8Array(n);
	(globalThis.crypto || webcrypto).getRandomValues(b);
	return b;
};

export const V2_PREFIX = 'v2:';
const LEGACY_SALT = new TextEncoder().encode('agent-wallet-v1');
let _warnedFallback = false;

const IS_PROD =
	env.VERCEL_ENV === 'production' || env.NODE_ENV === 'production';

// Dedicated master secret for at-rest encryption, decoupled from JWT_SECRET.
//
// In production we FAIL CLOSED: a missing/short WALLET_ENCRYPTION_KEY must never
// silently downgrade custodial-secret confidentiality to JWT_SECRET (the most
// widely-handled secret on the platform — a JWT_SECRET leak would then decrypt
// every wallet, and rotating it to invalidate sessions would brick every wallet
// whose ciphertext used the fallback). The JWT_SECRET fallback survives only
// outside production so local/CI/preview keep working without extra setup.
function walletMasterSecret() {
	const dedicated = env.WALLET_ENCRYPTION_KEY;
	if (dedicated && dedicated.length >= 32) return dedicated;
	if (IS_PROD) {
		throw new Error(
			'[secret-box] WALLET_ENCRYPTION_KEY is required in production and must be ' +
				'>=32 chars. Refusing to encrypt/decrypt custodial secrets under the ' +
				'JWT_SECRET fallback. Set a dedicated WALLET_ENCRYPTION_KEY.',
		);
	}
	if (dedicated && dedicated.length >= 16) return dedicated;
	if (!_warnedFallback) {
		_warnedFallback = true;
		console.warn(
			'[secret-box] WALLET_ENCRYPTION_KEY is not set (or too short); falling back to ' +
				'JWT_SECRET for custodial secret encryption. Set a dedicated WALLET_ENCRYPTION_KEY ' +
				'(>=32 chars) so secret confidentiality does not depend on the session secret. ' +
				'(This fallback is disabled in production.)',
		);
	}
	return env.JWT_SECRET;
}

// Retired encryption keys, newest first, from WALLET_ENCRYPTION_KEY_PREVIOUS
// (comma or whitespace separated so several rotations can stack).
//
// Why this exists: a WALLET_ENCRYPTION_KEY rotation used to be a one-way door.
// The Vercel to Cloud Run migration (2026-07) changed the key with no read path
// back to the old one, and every ciphertext written under the retired key became
// permanently unopenable. That is not a degraded mode, it is destroyed custody:
// the wallet's SOL stays visible on chain and can never be signed for again.
// Measured 2026-08-01 by scripts/audit-custodial-key-health.mjs: 8 of 565
// custodial wallets, holding 0.49 SOL, of which 0.35 SOL belongs to CUSTOMERS
// who can no longer withdraw it.
//
// Decrypt therefore accepts retired keys; encrypt never does (see encryptSecret),
// so a rotation upgrades records as they are rewritten and old keys can be
// dropped from the list once nothing opens with them.
function retiredSecrets() {
	return String(env.WALLET_ENCRYPTION_KEY_PREVIOUS || '')
		.split(/[\s,]+/)
		.map((s) => s.trim())
		.filter((s) => s.length >= 16);
}

/**
 * Every secret a decrypt may try, in priority order: the current dedicated key,
 * then retired keys newest-first, then JWT_SECRET (v2 records written before a
 * dedicated key existed used it, and v1 records always did).
 *
 * Exported so a key-health audit can report WHICH key opened a record without
 * re-deriving this precedence and drifting from it.
 *
 * @returns {string[]} deduped, non-empty candidates
 */
export function secretBoxKeyCandidates() {
	const candidates = [];
	try { candidates.push(walletMasterSecret()); } catch { /* prod w/o dedicated key: retired + JWT below */ }
	candidates.push(...retiredSecrets());
	// env.JWT_SECRET is a REQUIRED accessor: it throws when unset, which made the
	// `if (jwt)` guard below unreachable and turned "no JWT_SECRET" into a hard
	// decrypt failure even for a deployment holding a perfectly good dedicated
	// WALLET_ENCRYPTION_KEY. JWT_SECRET is only ever a legacy fallback candidate
	// here, so its absence must degrade the candidate list, not break decryption.
	let jwt = '';
	try { jwt = env.JWT_SECRET; } catch { /* no session secret configured: skip the legacy candidate */ }
	if (jwt) candidates.push(jwt);
	return [...new Set(candidates.filter(Boolean))];
}

// Derive an AES-256 key from a secret + salt via HKDF-SHA256.
async function deriveKey(secret, salt) {
	const raw = new TextEncoder().encode(secret);
	const base = await subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
	return subtle.deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt, info: new Uint8Array(0) },
		base,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt'],
	);
}

// ── Write-key guard ─────────────────────────────────────────────────────────
//
// Why this exists: 24 custodial wallets in the production database are sealed
// under a key production never held. They were not lost in a rotation. A
// deployment that shared the database but carried its own key (a Vercel-era
// preview in 2026-06, dev and preview servers in 2026-08 and 2026-09) wrote them,
// and non-production code is allowed to encrypt under whatever key it has. The
// first time anyone noticed was a customer who could not withdraw 99.95 USDC.
//
// The guard binds a database to the key that writes into it. The first write
// records an HMAC fingerprint of the key in app_settings; every later write
// compares against it and refuses on a mismatch, so a process holding the wrong
// key fails loudly at provisioning instead of silently minting an unopenable
// wallet. A rotation done by the runbook (outgoing key kept in
// WALLET_ENCRYPTION_KEY_PREVIOUS) moves the fingerprint forward instead of
// refusing. The fingerprint is a one-way HMAC, so storing it reveals nothing.
export const WRITE_KEY_SETTING = 'secret_box_write_key';
const FINGERPRINT_LABEL = new TextEncoder().encode('three.ws/secret-box/write-key-fingerprint/v1');

export async function secretBoxKeyFingerprint(secret) {
	const key = await subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	return Buffer.from(await subtle.sign('HMAC', key, FINGERPRINT_LABEL)).toString('hex');
}

export class SecretBoxKeyMismatchError extends Error {
	constructor() {
		super(
			'[secret-box] refusing to encrypt: this process holds a different encryption key than ' +
				'the one bound to this database, so anything it sealed could never be opened by ' +
				'production. Point it at its own database, or give it the production key.',
		);
		this.name = 'SecretBoxKeyMismatchError';
		this.code = 'secret_box_key_mismatch';
	}
}

/**
 * Bind `sql`'s database to `secret`, or throw SecretBoxKeyMismatchError.
 * Exported for tests and for operator tooling that seeds the binding.
 */
export async function verifyWriteKey(sql, secret, retired = []) {
	const fingerprint = await secretBoxKeyFingerprint(secret);
	const value = JSON.stringify({ fingerprint, bound_at: new Date().toISOString() });
	await sql`INSERT INTO app_settings (key, value) VALUES (${WRITE_KEY_SETTING}, ${value}::jsonb) ON CONFLICT (key) DO NOTHING`;
	const [row] = await sql`SELECT value FROM app_settings WHERE key = ${WRITE_KEY_SETTING}`;
	const bound = row?.value?.fingerprint;
	if (bound === fingerprint) return { fingerprint, rotated: false };
	const retiredPrints = await Promise.all(retired.map(secretBoxKeyFingerprint));
	if (bound && retiredPrints.includes(bound)) {
		await sql`UPDATE app_settings SET value = ${value}::jsonb WHERE key = ${WRITE_KEY_SETTING} AND value->>'fingerprint' = ${bound}`;
		return { fingerprint, rotated: true };
	}
	throw new SecretBoxKeyMismatchError();
}

let _verifiedWriteKey = null;

// Unit tests encrypt against mocked or absent databases, and a process with no
// database has nowhere to strand a wallet, so both skip the guard. A failed
// check is not cached: a transient database error retries on the next write.
async function guardWriteKey(secret) {
	if (process.env.VITEST || _verifiedWriteKey === secret) return;
	let hasDb = false;
	try { hasDb = Boolean(env.DATABASE_URL); } catch { hasDb = false; }
	if (!hasDb) return;
	const { sql } = await import('./db.js');
	await verifyWriteKey(sql, secret, retiredSecrets());
	_verifiedWriteKey = secret;
}

// v2 layout: "v2:" + base64( salt[16] || iv[12] || ciphertext+tag ).
export async function encryptSecret(plaintext) {
	const salt = randomBytes(16);
	const iv = randomBytes(12);
	const secret = walletMasterSecret();
	await guardWriteKey(secret);
	const key = await deriveKey(secret, salt);
	const data = new TextEncoder().encode(plaintext);
	const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
	const buf = new Uint8Array(salt.length + iv.length + ct.byteLength);
	buf.set(salt, 0);
	buf.set(iv, salt.length);
	buf.set(new Uint8Array(ct), salt.length + iv.length);
	return V2_PREFIX + Buffer.from(buf).toString('base64');
}

export async function decryptSecret(ciphertext) {
	if (typeof ciphertext === 'string' && ciphertext.startsWith(V2_PREFIX)) {
		const raw = Buffer.from(ciphertext.slice(V2_PREFIX.length), 'base64');
		const salt = raw.subarray(0, 16);
		const iv = raw.subarray(16, 28);
		const ct = raw.subarray(28);
		// Try the configured master secret first (the dedicated WALLET_ENCRYPTION_KEY),
		// then fall back to JWT_SECRET. v2 records written *before* a dedicated key
		// existed used the JWT_SECRET fallback and are ONLY decryptable with it — once
		// a dedicated key is introduced they'd otherwise become unreadable, stranding
		// the custodial funds behind them. AES-GCM authenticates every attempt (a wrong
		// key throws, it never returns wrong plaintext), so trying a second candidate is
		// safe. This is a read-only migration affordance: encryptSecret still requires a
		// real dedicated key in production, so NEW writes stay independent of JWT_SECRET.
		// Retire the fallback after a re-encryption migration lifts every record to the
		// dedicated key.
		const candidates = secretBoxKeyCandidates();
		let lastErr;
		for (const secret of candidates) {
			try {
				const key = await deriveKey(secret, salt);
				const plain = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
				return new TextDecoder().decode(plain);
			} catch (e) { lastErr = e; }
		}
		throw lastErr || new Error('[secret-box] v2 decrypt failed: no candidate key available');
	}
	// Legacy v1: constant salt, no version tag. v1 always derived from JWT_SECRET,
	// but a retired JWT_SECRET strands v1 records exactly the way a retired
	// WALLET_ENCRYPTION_KEY strands v2 ones, so the same candidate list applies.
	const raw = Buffer.from(ciphertext, 'base64');
	const iv = raw.subarray(0, 12);
	const ct = raw.subarray(12);
	let lastErr;
	for (const secret of secretBoxKeyCandidates()) {
		try {
			const key = await deriveKey(secret, LEGACY_SALT);
			const plain = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
			return new TextDecoder().decode(plain);
		} catch (e) { lastErr = e; }
	}
	throw lastErr || new Error('[secret-box] v1 decrypt failed: no candidate key available');
}

/** True if a stored value is a v2 ciphertext (vs a legacy plaintext/base64 blob). */
export function isEncryptedSecret(value) {
	return typeof value === 'string' && value.startsWith(V2_PREFIX);
}
