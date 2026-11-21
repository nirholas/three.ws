#!/usr/bin/env node
// Wallet custody audit for every wallet the x402 loop creates (payer pool and
// fresh one-shot wallets). Decrypts both key copies of each wallet and proves
// each opens to the row's pubkey. Prints pubkeys and statuses only, never keys.
//
//   npm run x402:wallet-custody -- --prod-env                    audit (read-only apart from custody_verified_at)
//   npm run x402:wallet-custody -- --prod-env --backfill         also write the Cloud KMS backup copy where missing
//   npm run x402:wallet-custody -- --prod-env --reseal-primary   re-seal primaries that no longer open, from the KMS backup
//   ... --json                                                   machine-readable report
//   ... --limit N                                                rows per table (default 5000)
//
// --prod-env reads DATABASE_URL, WALLET_ENCRYPTION_KEY(_PREVIOUS), JWT_SECRET and
// X402_WALLET_BACKUP_KMS_KEY from the three-ws-api Cloud Run service through the
// operator's own gcloud login (scripts/lib/cloud-run-env.mjs). KMS calls run as
// that same login (gcloud auth print-access-token), so it needs cloudkms.cryptoKeyEncrypterDecrypter on the
// backup key. Exit code 2 when anything needs attention.

import { loadCloudRunEnv } from './lib/cloud-run-env.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => {
	const i = args.indexOf(name);
	return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

if (flag('--help') || flag('-h')) {
	console.log('Usage: npm run x402:wallet-custody -- [--prod-env] [--backfill] [--reseal-primary] [--json] [--limit N]');
	process.exit(0);
}

if (flag('--prod-env')) {
	const n = loadCloudRunEnv({
		wanted: /^(DATABASE_URL|WALLET_ENCRYPTION_KEY|WALLET_ENCRYPTION_KEY_PREVIOUS|JWT_SECRET|X402_WALLET_BACKUP_KMS_KEY)$/,
		required: ['DATABASE_URL', 'WALLET_ENCRYPTION_KEY'],
	});
	if (!flag('--json')) console.error(`loaded ${n} env vars from Cloud Run`);
}
if (!process.env.DATABASE_URL) {
	console.error('x402-wallet-custody: DATABASE_URL is not set (pass --prod-env, or start with the production env)');
	process.exit(1);
}

const { sql } = await import('../api/_lib/db.js');
const { ensurePoolSchema } = await import('../api/_lib/x402/pool.js');
const { ensureFreshSchema } = await import('../api/_lib/x402/fresh-workers/wallets.js');
const custody = await import('../api/_lib/x402/wallet-custody.js');

// KMS as the operator: the gcloud login's token, re-minted well inside its hour.
const { gcloud } = await import('./lib/cloud-run-env.mjs');
const { sealWithKms, openKmsEnvelope, kmsWrap, kmsUnwrap } = await import('../api/_lib/kms-envelope.js');
const { encryptSecret, decryptSecret } = await import('../api/_lib/secret-box.js');
let tokenAt = 0;
let operatorToken = null;
const token = () => {
	if (!operatorToken || Date.now() - tokenAt > 30 * 60_000) {
		operatorToken = gcloud(['auth', 'print-access-token']).trim();
		tokenAt = Date.now();
	}
	return operatorToken;
};
const deps = {
	encrypt: encryptSecret,
	decrypt: decryptSecret,
	sealBackup: (plaintext, keyName) => sealWithKms(plaintext, keyName, { wrap: (dek, k) => kmsWrap(dek, k, { token: token() }) }),
	openBackup: (ciphertext) => openKmsEnvelope(ciphertext, { unwrap: (w, k) => kmsUnwrap(w, k, { token: token() }) }),
	backupKeyName: custody.walletBackupKeyName(),
};

const limit = Math.max(1, Number(opt('--limit', 5000)) || 5000);
await ensurePoolSchema(sql);
await ensureFreshSchema(sql);

let resealed = null;
if (flag('--reseal-primary')) resealed = await custody.resealPrimaryFromBackup({ sql, limit, deps });
const report = await custody.auditWalletCustody({ sql, limit, backfill: flag('--backfill'), deps });
const attention = custody.custodyNeedsAttention(report) || Boolean(resealed?.failed.length);

if (flag('--json')) {
	console.log(JSON.stringify({ report, resealed, needs_attention: attention }, null, 2));
} else {
	console.log(`backup key: ${report.backup_key_configured ? process.env.X402_WALLET_BACKUP_KMS_KEY : 'NOT CONFIGURED (set X402_WALLET_BACKUP_KMS_KEY)'}`);
	for (const [table, t] of Object.entries(report.tables)) {
		console.log(`${table.padEnd(20)} checked ${t.checked}  ok ${t.ok}  backfilled ${t.backfilled}  missing backup ${t.missing_backup}`);
	}
	const section = (title, rows) => {
		if (!rows.length) return;
		console.log(`\n${title} (${rows.length}):`);
		for (const r of rows) console.log(`  ${r.table}  ${r.pubkey}  ${[r.primary && `primary=${r.primary}`, r.backup && `backup=${r.backup}`, r.error].filter(Boolean).join(' ')}`);
	};
	section('UNRECOVERABLE: neither copy opens', report.unrecoverable);
	section('primary copy broken, backup ok', report.primary_broken);
	section('backup copy faults', report.backup_broken);
	if (resealed) {
		section('re-sealed primary from backup', resealed.resealed);
		section('re-seal failed', resealed.failed);
	}
	if (report.backup_key_configured && report.missing_backup && !flag('--backfill')) console.log('\nRun again with --backfill to write the missing KMS copies.');
	console.log(attention ? '\nNEEDS ATTENTION' : '\nall loop wallets recoverable');
}
process.exit(attention ? 2 : 0);
