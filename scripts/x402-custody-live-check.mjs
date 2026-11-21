#!/usr/bin/env node
// Live check for x402 wallet custody: the real mint paths, the real custody
// audit, and the REAL Cloud KMS backup key, on a throwaway in-process Postgres
// (scripts/lib/isolated-db.mjs) so production rows are never touched.
//
//   node scripts/x402-custody-live-check.mjs
//
// It mints fresh and pool wallets the way the loop does before the backup key
// existed, then proves: the audit reports the missing copy, the backfill writes
// a KMS copy that opens, a wallet whose primary copy is destroyed still signs
// from the KMS copy, the re-seal restores the primary, the old ciphertext is
// archived, and the database refuses to delete a wallet. KMS runs as your gcloud
// login, which needs cloudkms.cryptoKeyEncrypterDecrypter on the key. Exits 1 on
// any failed step.

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { useIsolatedDb } from './lib/isolated-db.mjs';

const KEY = process.env.X402_WALLET_BACKUP_KMS_KEY
	|| 'projects/aerial-vehicle-466722-p5/locations/us-central1/keyRings/x402-wallet-custody/cryptoKeys/wallet-backup';

process.env.DATABASE_URL = 'postgres://isolated/pglite';
process.env.WALLET_ENCRYPTION_KEY = `live-check-${Date.now()}-0123456789abcdef0123456789`;
process.env.X402_RING_POOL_MAX_GENERATE = '10';
delete process.env.X402_WALLET_BACKUP_KMS_KEY;

const { sql } = await useIsolatedDb();
const { Keypair, PublicKey } = await import('@solana/web3.js');
const { mintWallet, ensureFreshSchema } = await import('../api/_lib/x402/fresh-workers/wallets.js');
const { generatePoolWallets, ensurePoolSchema } = await import('../api/_lib/x402/pool.js');
const custody = await import('../api/_lib/x402/wallet-custody.js');
const { sealWithKms, openKmsEnvelope, kmsWrap, kmsUnwrap } = await import('../api/_lib/kms-envelope.js');
const { encryptSecret, decryptSecret } = await import('../api/_lib/secret-box.js');

let failures = 0;
const check = (label, ok, detail = '') => {
	if (!ok) failures += 1;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
};

// 1. Legacy wallets: minted through the real paths with no backup key.
await ensureFreshSchema(sql);
await ensurePoolSchema(sql);
const mint = new PublicKey('FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump');
for (let i = 0; i < 3; i++) await mintWallet({ sql, job: { kind: 'ring', slug: 'live-check', title: 'custody live check' }, mint, runId: randomUUID() });
await generatePoolWallets({ count: 2, sql });

const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
const deps = {
	encrypt: encryptSecret,
	decrypt: decryptSecret,
	backupKeyName: KEY,
	sealBackup: (p, k) => sealWithKms(p, k, { wrap: (d, kk) => kmsWrap(d, kk, { token }) }),
	openBackup: (c) => openKmsEnvelope(c, { unwrap: (w, kk) => kmsUnwrap(w, kk, { token }) }),
};

const before = await custody.auditWalletCustody({ sql, backfill: false, deps });
check('audit sees 5 wallets missing the KMS copy', before.checked === 5 && before.missing_backup === 5 && custody.custodyNeedsAttention(before), JSON.stringify({ checked: before.checked, missing: before.missing_backup }));

const filled = await custody.auditWalletCustody({ sql, deps });
check('backfill writes a real KMS copy for every wallet', filled.backfilled === 5 && filled.ok === 5 && !custody.custodyNeedsAttention(filled), JSON.stringify({ backfilled: filled.backfilled, ok: filled.ok }));

// 2. A new wallet minted with the key configured gets both copies at birth.
process.env.X402_WALLET_BACKUP_KMS_KEY = KEY;
const born = Keypair.generate();
const sealed = await custody.sealNewWalletKey(born, deps);
check('a new wallet is sealed twice at mint', sealed.backup?.startsWith('kms1:') === true);

// 3. Destroy one primary copy: the wallet still signs from the KMS copy.
const [victim] = await sql`SELECT pubkey FROM x402_fresh_wallets ORDER BY id LIMIT 1`;
const lost = await encryptSecret(Buffer.from(Keypair.generate().secretKey).toString('base64'));
await sql`UPDATE x402_fresh_wallets SET encrypted_secret = ${lost} WHERE pubkey = ${victim.pubkey}`;
const broken = await custody.auditWalletCustody({ sql, deps });
check('audit flags the broken primary as recoverable', broken.primary_broken.length === 1 && broken.unrecoverable.length === 0);
const [row] = await sql`SELECT pubkey, encrypted_secret, backup_secret FROM x402_fresh_wallets WHERE pubkey = ${victim.pubkey}`;
const kp = await custody.recoverWalletKeypair(row, deps);
check('the wallet signs from the KMS copy alone', kp.publicKey.toBase58() === victim.pubkey);

// 4. Re-seal the primary from the KMS copy; the replaced ciphertext is archived.
const resealed = await custody.resealPrimaryFromBackup({ sql, deps });
check('re-seal restores the primary', resealed.resealed.length === 1 && resealed.failed.length === 0);
const after = await custody.auditWalletCustody({ sql, deps });
check('final audit is clean', !custody.custodyNeedsAttention(after) && after.ok === 5);
const [hist] = await sql`SELECT count(*)::int AS n FROM x402_wallet_key_history`;
check('both replaced ciphertexts are archived', hist.n === 2, `history rows ${hist.n}`);

// 5. The database refuses to lose a wallet.
let refused = false;
try { await sql`DELETE FROM x402_fresh_wallets`; } catch { refused = true; }
check('DELETE on the wallet table is refused', refused);

console.log(failures ? `\n${failures} step(s) failed` : '\nall custody steps passed against the real KMS key');
process.exit(failures ? 1 : 0);
