// Wallet custody for the x402 loop (api/_lib/x402/wallet-custody.js plus
// migration 20261121120100) on a real in-process Postgres. The guarantee under
// test: no wallet the loop mints can be lost. Rows cannot be deleted or
// re-keyed, a replaced ciphertext is archived, every new key carries a second
// independent copy, a wallet whose primary key no longer opens is recovered from
// that copy, and the audit backfills and reports. Real secret-box and the real
// KMS envelope code run; only the Cloud KMS wrap/unwrap HTTP call is replaced.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { Keypair } from '@solana/web3.js';

import { createPgliteSql } from './_helpers/pglite-sql.js';

process.env.WALLET_ENCRYPTION_KEY = 'custody-test-key-0123456789abcdef0123456789';

const { encryptSecret, decryptSecret } = await import('../api/_lib/secret-box.js');
const { sealWithKms, openKmsEnvelope } = await import('../api/_lib/kms-envelope.js');
const custody = await import('../api/_lib/x402/wallet-custody.js');

const MIGRATION = readFileSync(new URL('../api/_lib/migrations/20261121120100_x402_wallet_custody.sql', import.meta.url), 'utf8');
const KEY = 'projects/p/locations/us-central1/keyRings/x402-wallet-custody/cryptoKeys/wallet-backup';

// Stand-in for the Cloud KMS encrypt/decrypt call: a reversible transform of the
// DEK, so the envelope code (AES-GCM, format, key naming) runs for real.
const flip = (b) => Buffer.from(b).map((x) => x ^ 0x5a);
const kms = { wraps: 0, down: false };
const wrap = async (dek) => { if (kms.down) throw new Error('KMS 503'); kms.wraps += 1; return flip(dek).toString('base64'); };
const unwrap = async (b64) => { if (kms.down) throw new Error('KMS 503'); return new Uint8Array(flip(Buffer.from(b64, 'base64'))); };

const deps = (over = {}) => ({
	encrypt: encryptSecret,
	decrypt: decryptSecret,
	sealBackup: (p, k) => sealWithKms(p, k, { wrap }),
	openBackup: (c) => openKmsEnvelope(c, { unwrap }),
	backupKeyName: KEY,
	...over,
});

// One PGlite per file; each test gets a clean public schema (DROP SCHEMA fires
// no row or truncate triggers, so the guards do not block the reset).
let pg;
let sql;
beforeAll(async () => {
	pg = new PGlite();
	sql = createPgliteSql({ pg }).sql;
});
beforeEach(async () => {
	kms.wraps = 0;
	kms.down = false;
	await pg.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
	// The two wallet tables as they stood before the custody migration.
	await pg.exec(`
		CREATE TABLE IF NOT EXISTS x402_fresh_wallets (id bigserial PRIMARY KEY, pubkey text NOT NULL UNIQUE, usdc_ata text NOT NULL DEFAULT '',
			encrypted_secret text NOT NULL, state text NOT NULL DEFAULT 'minted', job_kind text NOT NULL DEFAULT 'ring', job_slug text NOT NULL DEFAULT 's',
			updated_at timestamptz NOT NULL DEFAULT now());
		CREATE TABLE IF NOT EXISTS x402_ring_pool (pubkey text PRIMARY KEY, encrypted_secret text NOT NULL, enabled boolean NOT NULL DEFAULT true,
			last_used_at timestamptz, use_count bigint NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());`);
	await pg.exec(MIGRATION);
});

async function insertFresh(kp, { backup = null, encrypted = null } = {}) {
	const enc = encrypted || await encryptSecret(Buffer.from(kp.secretKey).toString('base64'));
	await sql`INSERT INTO x402_fresh_wallets (pubkey, encrypted_secret, backup_secret) VALUES (${kp.publicKey.toBase58()}, ${enc}, ${backup})`;
}

describe('sealNewWalletKey', () => {
	it('returns two copies that each open to the wallet', async () => {
		const kp = Keypair.generate();
		const { encrypted, backup } = await custody.sealNewWalletKey(kp, deps());
		expect(backup.startsWith('kms1:')).toBe(true);
		const fromPrimary = await custody.recoverWalletKeypair({ pubkey: kp.publicKey.toBase58(), encrypted_secret: encrypted }, deps());
		const fromBackup = await custody.recoverWalletKeypair({ pubkey: kp.publicKey.toBase58(), encrypted_secret: 'garbage', backup_secret: backup }, deps());
		expect(fromPrimary.publicKey.equals(kp.publicKey)).toBe(true);
		expect(fromBackup.publicKey.equals(kp.publicKey)).toBe(true);
	});

	it('fails closed when the backup key is configured and KMS refuses', async () => {
		kms.down = true;
		await expect(custody.sealNewWalletKey(Keypair.generate(), deps())).rejects.toThrow(/KMS 503/);
	});

	it('mints with the primary copy only when no backup key is configured', async () => {
		const out = await custody.sealNewWalletKey(Keypair.generate(), deps({ backupKeyName: null }));
		expect(out.backup).toBeNull();
	});
});

describe('recoverWalletKeypair', () => {
	it('never returns a key that does not match the row pubkey', async () => {
		const a = Keypair.generate();
		const b = Keypair.generate();
		const encB = await encryptSecret(Buffer.from(b.secretKey).toString('base64'));
		await expect(custody.recoverWalletKeypair({ pubkey: a.publicKey.toBase58(), encrypted_secret: encB }, deps())).rejects.toThrow(/neither key copy/);
	});
});

describe('custody guard triggers', () => {
	it('refuses deleting or truncating a wallet row', async () => {
		await insertFresh(Keypair.generate());
		await expect(pg.exec('DELETE FROM x402_fresh_wallets')).rejects.toThrow(/never deleted/);
		await expect(pg.exec('TRUNCATE x402_fresh_wallets')).rejects.toThrow(/never deleted/);
		await sql`INSERT INTO x402_ring_pool (pubkey, encrypted_secret) VALUES ('p1', 'c1')`;
		await expect(pg.exec('DELETE FROM x402_ring_pool')).rejects.toThrow(/never deleted/);
	});

	it('refuses changing a pubkey or blanking a key', async () => {
		await insertFresh(Keypair.generate(), { backup: 'kms1:x' });
		await expect(pg.exec(`UPDATE x402_fresh_wallets SET pubkey = 'other'`)).rejects.toThrow(/never changes/);
		await expect(pg.exec(`UPDATE x402_fresh_wallets SET encrypted_secret = ''`)).rejects.toThrow(/cannot be blanked/);
		await expect(pg.exec(`UPDATE x402_fresh_wallets SET backup_secret = NULL`)).rejects.toThrow(/backup key cannot be blanked/);
	});

	it('archives the old ciphertext when a key is re-sealed, and the archive is append-only', async () => {
		const kp = Keypair.generate();
		await insertFresh(kp, { encrypted: 'old-cipher' });
		await sql`UPDATE x402_fresh_wallets SET encrypted_secret = 'new-cipher' WHERE pubkey = ${kp.publicKey.toBase58()}`;
		const hist = await sql`SELECT wallet_table, pubkey, column_name, old_ciphertext FROM x402_wallet_key_history`;
		expect(hist).toEqual([{ wallet_table: 'x402_fresh_wallets', pubkey: kp.publicKey.toBase58(), column_name: 'encrypted_secret', old_ciphertext: 'old-cipher' }]);
		await expect(pg.exec('DELETE FROM x402_wallet_key_history')).rejects.toThrow(/append-only/);
		await expect(pg.exec(`UPDATE x402_wallet_key_history SET old_ciphertext = 'x'`)).rejects.toThrow(/append-only/);
	});

	it('lets ordinary lifecycle updates through without touching history', async () => {
		await insertFresh(Keypair.generate());
		await sql`UPDATE x402_fresh_wallets SET state = 'closed'`;
		expect(await sql`SELECT 1 FROM x402_wallet_key_history`).toHaveLength(0);
	});
});

describe('auditWalletCustody', () => {
	it('backfills the KMS copy for wallets minted before it existed, then marks them verified', async () => {
		const kp = Keypair.generate();
		await insertFresh(kp);
		const poolKp = Keypair.generate();
		await sql`INSERT INTO x402_ring_pool (pubkey, encrypted_secret) VALUES (${poolKp.publicKey.toBase58()}, ${await encryptSecret(Buffer.from(poolKp.secretKey).toString('base64'))})`;

		const report = await custody.auditWalletCustody({ sql, deps: deps() });
		expect(report).toMatchObject({ checked: 2, ok: 2, backfilled: 2, missing_backup: 0, unrecoverable: [], primary_broken: [], backup_broken: [] });
		expect(custody.custodyNeedsAttention(report)).toBe(false);

		const [row] = await sql`SELECT backup_secret, custody_verified_at FROM x402_fresh_wallets`;
		expect(row.custody_verified_at).not.toBeNull();
		const recovered = await custody.recoverWalletKeypair({ pubkey: kp.publicKey.toBase58(), encrypted_secret: 'lost', backup_secret: row.backup_secret }, deps());
		expect(recovered.publicKey.equals(kp.publicKey)).toBe(true);
	});

	it('reports a wallet whose primary key no longer opens but stays recoverable from the backup', async () => {
		const kp = Keypair.generate();
		const { backup } = await custody.sealNewWalletKey(kp, deps());
		await insertFresh(kp, { encrypted: 'sealed-under-a-lost-env-key', backup });
		const report = await custody.auditWalletCustody({ sql, deps: deps() });
		expect(report.unrecoverable).toEqual([]);
		expect(report.primary_broken).toEqual([{ table: 'x402_fresh_wallets', pubkey: kp.publicKey.toBase58(), primary: 'unopenable' }]);
		expect(custody.custodyNeedsAttention(report)).toBe(true);
	});

	it('reports pubkeys only, never key material, for an unrecoverable wallet', async () => {
		const kp = Keypair.generate();
		await insertFresh(kp, { encrypted: 'nothing-opens-this' });
		const report = await custody.auditWalletCustody({ sql, deps: deps({ backupKeyName: null }) });
		expect(report.unrecoverable).toEqual([{ table: 'x402_fresh_wallets', pubkey: kp.publicKey.toBase58(), primary: 'unopenable', backup: 'missing' }]);
		expect(JSON.stringify(report)).not.toContain(Buffer.from(kp.secretKey).toString('base64'));
	});

	it('counts a missing backup as needing attention once the backup key is configured', async () => {
		await insertFresh(Keypair.generate());
		const report = await custody.auditWalletCustody({ sql, backfill: false, deps: deps() });
		expect(report.missing_backup).toBe(1);
		expect(report.ok).toBe(0);
		expect(custody.custodyNeedsAttention(report)).toBe(true);
	});

	it('records a backfill failure when KMS is down and leaves the row unverified', async () => {
		await insertFresh(Keypair.generate());
		const d = deps();
		d.sealBackup = async () => { throw new Error('KMS 503'); };
		const report = await custody.auditWalletCustody({ sql, deps: d });
		expect(report.backup_broken[0].backup).toBe('backfill_failed');
		// The operator has to see why, or a fleet-wide failure is undiagnosable.
		expect(report.backup_broken[0].error).toBe('KMS 503');
		const [row] = await sql`SELECT custody_verified_at FROM x402_fresh_wallets`;
		expect(row.custody_verified_at).toBeNull();
	});
});

describe('resealPrimaryFromBackup', () => {
	it('re-seals a primary that no longer opens from the KMS backup, archiving the old ciphertext', async () => {
		const kp = Keypair.generate();
		const healthy = Keypair.generate();
		const { backup } = await custody.sealNewWalletKey(kp, deps());
		await insertFresh(kp, { encrypted: 'sealed-under-a-rotated-key', backup });
		const h = await custody.sealNewWalletKey(healthy, deps());
		await insertFresh(healthy, { encrypted: h.encrypted, backup: h.backup });

		const out = await custody.resealPrimaryFromBackup({ sql, deps: deps() });
		expect(out).toEqual({ resealed: [{ table: 'x402_fresh_wallets', pubkey: kp.publicKey.toBase58() }], failed: [] });
		const [row] = await sql`SELECT encrypted_secret FROM x402_fresh_wallets WHERE pubkey = ${kp.publicKey.toBase58()}`;
		const back = await custody.recoverWalletKeypair({ pubkey: kp.publicKey.toBase58(), encrypted_secret: row.encrypted_secret }, deps());
		expect(back.publicKey.equals(kp.publicKey)).toBe(true);
		const hist = await sql`SELECT old_ciphertext FROM x402_wallet_key_history`;
		expect(hist).toEqual([{ old_ciphertext: 'sealed-under-a-rotated-key' }]);

		const report = await custody.auditWalletCustody({ sql, deps: deps() });
		expect(custody.custodyNeedsAttention(report)).toBe(false);
	});
});

describe('walletBackupKeyName', () => {
	it('accepts only a full crypto-key resource name', () => {
		expect(custody.walletBackupKeyName({ X402_WALLET_BACKUP_KMS_KEY: KEY })).toBe(KEY);
		expect(custody.walletBackupKeyName({ X402_WALLET_BACKUP_KMS_KEY: 'wallet-backup' })).toBeNull();
		expect(custody.walletBackupKeyName({})).toBeNull();
	});
});
