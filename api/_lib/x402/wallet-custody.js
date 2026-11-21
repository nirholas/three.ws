// api/_lib/x402/wallet-custody.js
//
// Custody for every wallet the x402 loop creates: the payer pool
// (x402_ring_pool) and the one-shot fresh wallets (x402_fresh_wallets). The rule
// is that no such wallet can ever be lost. That means three things:
//
// 1. Two independent copies of every key.
//      encrypted_secret  secret-box under WALLET_ENCRYPTION_KEY (env-held).
//      backup_secret     Cloud KMS envelope under X402_WALLET_BACKUP_KMS_KEY. The
//                        KMS key cannot be exported, read, or changed by an env
//                        edit, so losing or rotating WALLET_ENCRYPTION_KEY (which
//                        already destroyed 8 custodial wallets in 2026-07) no
//                        longer loses a loop wallet.
//    sealNewWalletKey seals both copies and proves both open to the wallet's
//    own pubkey BEFORE the row is written, so a wallet never holds value with an
//    unrecoverable key. When the backup key is configured and KMS refuses, the
//    mint fails closed.
// 2. Rows can never be deleted or re-keyed. The guard trigger in
//    migrations/20261121120100_x402_wallet_custody.sql refuses it at the database,
//    and archives any replaced ciphertext in x402_wallet_key_history.
// 3. A daily audit (api/cron/x402-wallet-custody-audit.js, and the
//    `npm run x402:wallet-custody` CLI) decrypts both copies of every wallet,
//    checks each opens to the row's pubkey, backfills the KMS copy for wallets
//    minted before it existed, and alerts on anything that does not open.
//
// Nothing here logs or returns key material: results carry pubkeys only.

import { Keypair } from '@solana/web3.js';

import { encryptSecret, decryptSecret } from '../secret-box.js';
import { sealWithKms, openKmsEnvelope, isKmsEnvelope, isKmsKeyName } from '../kms-envelope.js';
import { sql as defaultSql } from '../db.js';

export const CUSTODY_TABLES = Object.freeze(['x402_ring_pool', 'x402_fresh_wallets']);

/** The Cloud KMS key that wraps the backup copy, or null when not configured. */
export function walletBackupKeyName(e = process.env) {
	const name = String(e.X402_WALLET_BACKUP_KMS_KEY ?? '').trim();
	return isKmsKeyName(name) ? name : null;
}

function pubkeyOfSecretB64(secretB64) {
	const raw = Buffer.from(String(secretB64), 'base64');
	if (raw.length !== 64) throw new Error(`expected a 64-byte key, got ${raw.length}`);
	return Keypair.fromSecretKey(Uint8Array.from(raw)).publicKey.toBase58();
}

const defaultDeps = () => ({
	encrypt: encryptSecret,
	decrypt: decryptSecret,
	sealBackup: (plaintext, keyName) => sealWithKms(plaintext, keyName),
	openBackup: (ciphertext) => openKmsEnvelope(ciphertext),
	backupKeyName: walletBackupKeyName(),
});

/**
 * Seal a brand-new keypair two ways and prove both copies open to its pubkey.
 * @param {Keypair} keypair
 * @returns {Promise<{ encrypted: string, backup: string|null }>}
 */
export async function sealNewWalletKey(keypair, deps = defaultDeps()) {
	const pubkey = keypair.publicKey.toBase58();
	const secretB64 = Buffer.from(keypair.secretKey).toString('base64');
	const encrypted = await deps.encrypt(secretB64);
	if (pubkeyOfSecretB64(await deps.decrypt(encrypted)) !== pubkey) {
		throw new Error('wallet custody: primary copy does not reopen to its pubkey');
	}
	if (!deps.backupKeyName) return { encrypted, backup: null };
	const backup = await deps.sealBackup(secretB64, deps.backupKeyName);
	if (pubkeyOfSecretB64(await deps.openBackup(backup)) !== pubkey) {
		throw new Error('wallet custody: backup copy does not reopen to its pubkey');
	}
	return { encrypted, backup };
}

/**
 * Recover a wallet's Keypair from its row: the primary copy first, the KMS
 * backup when the primary no longer opens (lost or rotated env key). Each copy
 * must decode to the row's own pubkey, so a wrong key can never be returned.
 * @param {{ pubkey: string, encrypted_secret: string, backup_secret?: string|null }} row
 * @returns {Promise<Keypair>}
 */
export async function recoverWalletKeypair(row, deps = defaultDeps()) {
	const tryOpen = async (open, ciphertext) => {
		if (!ciphertext) return null;
		try {
			const raw = Buffer.from(String(await open(ciphertext)), 'base64');
			if (raw.length !== 64) return null;
			const kp = Keypair.fromSecretKey(Uint8Array.from(raw));
			return !row.pubkey || kp.publicKey.toBase58() === row.pubkey ? kp : null;
		} catch {
			return null;
		}
	};
	const primary = await tryOpen(deps.decrypt, row.encrypted_secret);
	if (primary) return primary;
	const backup = isKmsEnvelope(row.backup_secret) ? await tryOpen(deps.openBackup, row.backup_secret) : null;
	if (backup) return backup;
	throw new Error(`wallet custody: neither key copy opens for ${row.pubkey || 'wallet'}`);
}

async function checkCopy(open, ciphertext, pubkey) {
	try {
		return pubkeyOfSecretB64(await open(ciphertext)) === pubkey ? 'ok' : 'mismatch';
	} catch {
		return 'unopenable';
	}
}

/**
 * Check one row's two copies. Returns the recovered secret only to the caller in
 * this process (for a backfill), never in the report.
 */
export async function verifyCustodyRow(row, deps = defaultDeps()) {
	let secretB64 = null;
	let primary;
	try {
		secretB64 = await deps.decrypt(row.encrypted_secret);
		primary = pubkeyOfSecretB64(secretB64) === row.pubkey ? 'ok' : 'mismatch';
	} catch {
		primary = 'unopenable';
	}
	let backup;
	if (!row.backup_secret) backup = 'missing';
	else if (!isKmsEnvelope(row.backup_secret)) backup = 'malformed';
	else backup = await checkCopy(deps.openBackup, row.backup_secret, row.pubkey);
	// The backup alone can restore a row whose primary no longer opens.
	if (primary !== 'ok' && backup === 'ok') {
		try { secretB64 = await deps.openBackup(row.backup_secret); } catch { secretB64 = null; }
	}
	return { pubkey: row.pubkey, primary, backup, secretB64: primary === 'ok' || backup === 'ok' ? secretB64 : null };
}

/**
 * Audit custody across the loop's wallet tables, least recently verified first.
 * With `backfill`, a wallet whose primary opens but has no KMS copy gets one.
 * `concurrency` rows run at once; past `deadlineAt` (epoch ms) the audit stops,
 * sets `truncated`, and the untouched rows lead the next run.
 *
 * @param {{ sql?: Function, tables?: string[], limit?: number, backfill?: boolean, deps?: object, deadlineAt?: number, concurrency?: number }} opts
 */
export async function auditWalletCustody({
	sql = defaultSql, tables = CUSTODY_TABLES, limit = 500, backfill = true, deps = defaultDeps(),
	deadlineAt = Infinity, concurrency = 8,
} = {}) {
	const report = {
		checked: 0, ok: 0, backfilled: 0, backup_key_configured: Boolean(deps.backupKeyName),
		missing_backup: 0, unrecoverable: [], primary_broken: [], backup_broken: [], tables: {}, truncated: false,
	};
	for (const table of tables) {
		if (!CUSTODY_TABLES.includes(table)) throw new Error(`wallet custody: unknown table ${table}`);
		const rows = table === 'x402_ring_pool'
			? await sql`SELECT pubkey, encrypted_secret, backup_secret FROM x402_ring_pool
			             ORDER BY custody_verified_at NULLS FIRST, pubkey LIMIT ${limit}`
			: await sql`SELECT pubkey, encrypted_secret, backup_secret FROM x402_fresh_wallets
			             ORDER BY custody_verified_at NULLS FIRST, id LIMIT ${limit}`;
		const t = { checked: 0, ok: 0, backfilled: 0, missing_backup: 0 };
		const auditRow = async (row) => {
			t.checked += 1;
			const v = await verifyCustodyRow(row, deps);
			if (v.primary !== 'ok' && v.backup !== 'ok') report.unrecoverable.push({ table, pubkey: v.pubkey, primary: v.primary, backup: v.backup });
			else if (v.primary !== 'ok') report.primary_broken.push({ table, pubkey: v.pubkey, primary: v.primary });
			if (v.backup === 'mismatch' || v.backup === 'unopenable' || v.backup === 'malformed') {
				report.backup_broken.push({ table, pubkey: v.pubkey, backup: v.backup });
			}

			let backupOk = v.backup === 'ok';
			if (v.backup === 'missing' && v.primary === 'ok' && backfill && deps.backupKeyName && v.secretB64) {
				try {
					const sealed = await deps.sealBackup(v.secretB64, deps.backupKeyName);
					if (pubkeyOfSecretB64(await deps.openBackup(sealed)) === v.pubkey) {
						const updated = table === 'x402_ring_pool'
							? await sql`UPDATE x402_ring_pool SET backup_secret = ${sealed}
							             WHERE pubkey = ${v.pubkey} AND backup_secret IS NULL RETURNING pubkey`
							: await sql`UPDATE x402_fresh_wallets SET backup_secret = ${sealed}
							             WHERE pubkey = ${v.pubkey} AND backup_secret IS NULL RETURNING pubkey`;
						if (updated.length) { t.backfilled += 1; backupOk = true; }
					}
				} catch (err) {
					report.backup_broken.push({ table, pubkey: v.pubkey, backup: 'backfill_failed', error: String(err?.message || err).slice(0, 200) });
				}
			}
			if (!backupOk && v.backup === 'missing') t.missing_backup += 1;

			const fullyOk = v.primary === 'ok' && (backupOk || !deps.backupKeyName);
			if (fullyOk) {
				t.ok += 1;
				if (table === 'x402_ring_pool') await sql`UPDATE x402_ring_pool SET custody_verified_at = now() WHERE pubkey = ${v.pubkey}`;
				else await sql`UPDATE x402_fresh_wallets SET custody_verified_at = now() WHERE pubkey = ${v.pubkey}`;
			}
		};
		// Rows are independent; a few KMS round trips in flight at once keep a
		// daily run inside the cron's time limit. Past the deadline the rest wait:
		// they are still unverified, so the next run takes them first.
		for (let i = 0; i < rows.length; i += Math.max(1, concurrency)) {
			if (Date.now() >= deadlineAt) { report.truncated = true; break; }
			await Promise.all(rows.slice(i, i + Math.max(1, concurrency)).map(auditRow));
		}
		report.tables[table] = t;
		report.checked += t.checked;
		report.ok += t.ok;
		report.backfilled += t.backfilled;
		report.missing_backup += t.missing_backup;
	}
	return report;
}

/** True when the report holds anything an operator must act on. */
export function custodyNeedsAttention(report) {
	return report.unrecoverable.length > 0 || report.primary_broken.length > 0 || report.backup_broken.length > 0
		|| (report.backup_key_configured && report.missing_backup > 0);
}

/**
 * Re-seal the primary copy of every wallet whose primary no longer opens but
 * whose KMS backup does, under the current WALLET_ENCRYPTION_KEY. Use after the
 * env key was rotated or lost. The replaced ciphertext is archived by the guard
 * trigger in x402_wallet_key_history, so this is reversible.
 * @returns {Promise<{ resealed: Array<{ table: string, pubkey: string }>, failed: Array<{ table: string, pubkey: string, error: string }> }>}
 */
export async function resealPrimaryFromBackup({ sql = defaultSql, tables = CUSTODY_TABLES, limit = 2000, deps = defaultDeps() } = {}) {
	const out = { resealed: [], failed: [] };
	for (const table of tables) {
		if (!CUSTODY_TABLES.includes(table)) throw new Error(`wallet custody: unknown table ${table}`);
		const rows = table === 'x402_ring_pool'
			? await sql`SELECT pubkey, encrypted_secret, backup_secret FROM x402_ring_pool WHERE backup_secret IS NOT NULL ORDER BY pubkey LIMIT ${limit}`
			: await sql`SELECT pubkey, encrypted_secret, backup_secret FROM x402_fresh_wallets WHERE backup_secret IS NOT NULL ORDER BY id LIMIT ${limit}`;
		for (const row of rows) {
			const v = await verifyCustodyRow(row, deps);
			if (v.primary === 'ok' || v.backup !== 'ok' || !v.secretB64) continue;
			try {
				const sealed = await deps.encrypt(v.secretB64);
				if (pubkeyOfSecretB64(await deps.decrypt(sealed)) !== v.pubkey) throw new Error('re-sealed primary does not reopen to its pubkey');
				if (table === 'x402_ring_pool') await sql`UPDATE x402_ring_pool SET encrypted_secret = ${sealed}, custody_verified_at = now() WHERE pubkey = ${v.pubkey}`;
				else await sql`UPDATE x402_fresh_wallets SET encrypted_secret = ${sealed}, custody_verified_at = now() WHERE pubkey = ${v.pubkey}`;
				out.resealed.push({ table, pubkey: v.pubkey });
			} catch (err) {
				out.failed.push({ table, pubkey: v.pubkey, error: String(err?.message || err).slice(0, 200) });
			}
		}
	}
	return out;
}
