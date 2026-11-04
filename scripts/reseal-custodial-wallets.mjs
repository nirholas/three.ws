#!/usr/bin/env node
// Re-seal every secret-box ciphertext in the database under a new, dedicated
// WALLET_ENCRYPTION_KEY, with verification before and after every write.
//
// Why this exists: production's WALLET_ENCRYPTION_KEY and JWT_SECRET currently
// hold the same value (see scripts/audit-custodial-key-health.mjs), so a leaked
// session secret would also open every custodial wallet, and rotating JWT_SECRET
// to invalidate sessions would brick them. Rotating the wallet key safely needs
// every sealed value rewritten under the new key first, provably and reversibly.
// docs/ops/wallet-key-migration.md carries the runbook and the sealed-column
// inventory this script's TARGETS list mirrors.
//
// What it does, per sealed column:
//   1. reads each row, decrypts with the OLD key set (the env's current key,
//      WALLET_ENCRYPTION_KEY_PREVIOUS, JWT_SECRET, plus RESEAL_OLD_KEYS),
//   2. re-encrypts the plaintext under RESEAL_NEW_KEY,
//   3. opens the new ciphertext with the new key ALONE and compares the plaintext,
//   4. derives the public address from the secret and asserts it equals the
//      address stored beside it,
//   5. writes the new ciphertext and a backup row (old and new ciphertext) in ONE
//      atomic statement batch, guarded by compare-and-swap on the old value.
// A row that cannot be opened is reported and never touched. A derivation
// mismatch aborts that table's run before anything in the batch is written.
// Rows already opening under the new key are skipped, which is what makes an
// interrupted run resumable: run it again.
//
// Dry run is the default and is strictly read-only. It never prints a key,
// plaintext or ciphertext: only table names, counts and the (public) row ids of
// rows that need attention.
//
// Usage (keys come from the environment, never argv; see the runbook):
//   export DATABASE_URL="$(node scripts/read-service-env.mjs '^DATABASE_URL$' --raw)"
//   export WALLET_ENCRYPTION_KEY="$(node scripts/read-service-env.mjs '^WALLET_ENCRYPTION_KEY$' --raw)"
//   export JWT_SECRET="$(node scripts/read-service-env.mjs '^JWT_SECRET$' --raw)"
//   node scripts/reseal-custodial-wallets.mjs                       # dry run
//   RESEAL_NEW_KEY=... node scripts/reseal-custodial-wallets.mjs    # dry run incl. what would change
//   RESEAL_NEW_KEY=... node scripts/reseal-custodial-wallets.mjs --apply
//   node scripts/reseal-custodial-wallets.mjs --rollback --apply    # restore the backed-up ciphertexts
//
// Flags: --apply, --json, --rollback, --hold-mismatched (skip, do not abort on, rows whose secret
//        derives a different address than the stored one), --batch-size=N (default 100), --only=<target id>
// Env:   DATABASE_URL, WALLET_ENCRYPTION_KEY, WALLET_ENCRYPTION_KEY_PREVIOUS,
//        JWT_SECRET, RESEAL_NEW_KEY, RESEAL_OLD_KEYS (extra candidates, comma separated)
// Exit:  0 ok (undecryptable rows are reported, not failures), 1 mismatch or failed
//        post-check, 2 bad invocation, 3 no old key configured.

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { openWithKeys, sealWithKey } from '../api/_lib/secret-box.js';

export const BACKUP_TABLE = 'custodial_reseal_backup';

// Every column that stores secret-box ciphertext. `address` is the stored public
// address the decrypted secret must derive; `verify` says how to derive it.
//   solana: base64 64-byte secret key. evm: hex private key. none: opaque payload.
// `path` addresses a value nested in a jsonb column.
export const TARGETS = [
	{ id: 'agent_identities.meta.encrypted_solana_secret', table: 'agent_identities', pk: 'id', column: 'meta', path: ['encrypted_solana_secret'], address: "meta->>'solana_address'", verify: 'solana' },
	{ id: 'agent_identities.meta.encrypted_wallet_key', table: 'agent_identities', pk: 'id', column: 'meta', path: ['encrypted_wallet_key'], address: 'wallet_address', verify: 'evm' },
	{ id: 'agent_identities.meta.hyperliquid.api_wallet.encrypted', table: 'agent_identities', pk: 'id', column: 'meta', path: ['hyperliquid', 'api_wallet', 'encrypted'], address: "meta#>>'{hyperliquid,api_wallet,address}'", verify: 'evm' },
	{ id: 'master_wallets.encrypted_solana_secret', table: 'master_wallets', pk: 'id', column: 'encrypted_solana_secret', address: 'solana_address', verify: 'solana' },
	{ id: 'master_wallets.encrypted_evm_key', table: 'master_wallets', pk: 'id', column: 'encrypted_evm_key', address: 'evm_address', verify: 'evm' },
	{ id: 'x402_ring_pool.encrypted_secret', table: 'x402_ring_pool', pk: 'pubkey', column: 'encrypted_secret', address: 'pubkey', verify: 'solana' },
	{ id: 'x402_fresh_wallets.encrypted_secret', table: 'x402_fresh_wallets', pk: 'id', column: 'encrypted_secret', address: 'pubkey', verify: 'solana' },
	{ id: 'agent_vaults.encrypted_secret', table: 'agent_vaults', pk: 'id', column: 'encrypted_secret', address: 'vault_address', verify: 'solana' },
	{ id: 'irl_drops.escrow_secret_enc', table: 'irl_drops', pk: 'id', column: 'escrow_secret_enc', address: 'escrow_address', verify: 'solana' },
	{ id: 'agent_signers.session_secret_enc', table: 'agent_signers', pk: 'agent_id', column: 'session_secret_enc', address: 'session_pubkey', verify: 'solana' },
	{ id: 'pump_funded_launch_intents.mint_secret', table: 'pump_funded_launch_intents', pk: 'id', column: 'mint_secret', address: 'mint', verify: 'solana' },
	{ id: 'agent_cards.secret_enc', table: 'agent_cards', pk: 'id', column: 'secret_enc', verify: 'none' },
	{ id: 'agent_mcp_connections.credentials_enc', table: 'agent_mcp_connections', pk: 'id', column: 'credentials_enc', verify: 'none' },
	{ id: 'home_satellites.viewer_secret_enc', table: 'home_satellites', pk: 'id', column: 'viewer_secret_enc', verify: 'none' },
	{ id: 'home_connections.access_token_enc', table: 'home_connections', pk: 'id', column: 'access_token_enc', verify: 'none' },
	{ id: 'vanity_inventory.secret_ciphertext', table: 'vanity_inventory', pk: 'id', column: 'secret_ciphertext', verify: 'none', where: "secret_scheme = 'aes-256-gcm'" },
];

const ident = (name) => {
	if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`unsafe identifier in target: ${name}`);
	return name;
};

// Expression yielding the sealed text for a target.
function secretExpr(t) {
	if (!t.path) return ident(t.column);
	return `${ident(t.column)} #>> '{${t.path.map(ident).join(',')}}'`;
}

async function deriveAddress(kind, plaintext) {
	if (kind === 'solana') {
		const { Keypair } = await import('@solana/web3.js');
		return Keypair.fromSecretKey(Buffer.from(plaintext, 'base64')).publicKey.toBase58();
	}
	if (kind === 'evm') {
		const { computeAddress } = await import('ethers');
		return computeAddress(plaintext.startsWith('0x') ? plaintext : `0x${plaintext}`);
	}
	return null;
}

const sameAddress = (kind, a, b) => (kind === 'evm' ? String(a).toLowerCase() === String(b).toLowerCase() : a === b);

/** Throws unless `key` is safe to adopt as the dedicated wallet key. */
export function assertNewKey(key, oldKeys) {
	if (typeof key !== 'string' || key.length < 32) throw new Error('RESEAL_NEW_KEY must be at least 32 characters');
	if (process.env.JWT_SECRET && key === process.env.JWT_SECRET) {
		throw new Error('RESEAL_NEW_KEY equals JWT_SECRET: the point of the re-seal is that they differ');
	}
	if (oldKeys.includes(key)) throw new Error('RESEAL_NEW_KEY is already one of the keys the data is sealed under, so there is nothing to rotate');
}

async function columnExists(db, t) {
	const rows = await db.query(
		'SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2 LIMIT 1',
		[t.table, t.column],
	);
	return rows.length > 0;
}

async function ensureBackupTable(db) {
	await db.query(`
		CREATE TABLE IF NOT EXISTS ${BACKUP_TABLE} (
			id bigserial PRIMARY KEY,
			target text NOT NULL,
			row_id text NOT NULL,
			old_ciphertext text NOT NULL,
			new_ciphertext text NOT NULL,
			created_at timestamptz NOT NULL DEFAULT now(),
			rolled_back_at timestamptz
		)`);
	await db.query(`CREATE INDEX IF NOT EXISTS ${BACKUP_TABLE}_target_row ON ${BACKUP_TABLE} (target, row_id)`);
}

function updateStatement(t, rowId, oldCt, newCt) {
	const tbl = ident(t.table);
	const pk = ident(t.pk);
	if (t.path) {
		const p = `{${t.path.map(ident).join(',')}}`;
		return [
			`UPDATE ${tbl} SET ${ident(t.column)} = jsonb_set(${ident(t.column)}, '${p}', to_jsonb($1::text)) WHERE ${pk}::text = $2 AND ${ident(t.column)} #>> '${p}' = $3`,
			[newCt, rowId, oldCt],
		];
	}
	return [`UPDATE ${tbl} SET ${ident(t.column)} = $1 WHERE ${pk}::text = $2 AND ${ident(t.column)} = $3`, [newCt, rowId, oldCt]];
}

async function* pages(db, t, batchSize) {
	const tbl = ident(t.table);
	const pk = ident(t.pk);
	const expr = secretExpr(t);
	const addr = t.address ? t.address : 'NULL';
	const where = t.where ? ` AND (${t.where})` : '';
	let cursor = '';
	for (;;) {
		const rows = await db.query(
			`SELECT ${pk}::text AS row_id, (${expr}) AS secret, (${addr}) AS address FROM ${tbl} WHERE (${expr}) IS NOT NULL AND (${expr}) <> ''${where} AND ${pk}::text > $1 ORDER BY ${pk}::text LIMIT ${Number(batchSize)}`,
			[cursor],
		);
		if (rows.length === 0) return;
		yield rows;
		cursor = rows[rows.length - 1].row_id;
		if (rows.length < batchSize) return;
	}
}

async function resealTarget({ db, t, oldKeys, newKey, apply, batchSize, holdMismatched }) {
	const out = {
		id: t.id, status: 'ok', rows: 0, current: 0, resealable: 0, undecryptable: 0, mismatch: 0, unverified: 0, written: 0,
		undecryptable_ids: [], mismatch_ids: [], aborted: false, postcheck_failed: 0,
	};
	const [{ present }] = await db.query('SELECT to_regclass($1) IS NOT NULL AS present', [t.table]);
	if (!present) return { ...out, status: 'table_absent' };
	if (!(await columnExists(db, t))) return { ...out, status: 'column_absent' };

	for await (const batch of pages(db, t, batchSize)) {
		const writes = [];
		let batchMismatch = false;
		for (const row of batch) {
			out.rows++;
			if (newKey && (await openWithKeys(row.secret, [newKey]))) {
				out.current++;
				continue;
			}
			const opened = await openWithKeys(row.secret, oldKeys);
			if (!opened) {
				out.undecryptable++;
				out.undecryptable_ids.push(row.row_id);
				continue;
			}
			if (t.verify !== 'none') {
				let derived = null;
				try {
					derived = await deriveAddress(t.verify, opened.plaintext);
				} catch {
					derived = null;
				}
				if (row.address == null || row.address === '') {
					out.unverified++;
				} else if (derived == null || !sameAddress(t.verify, derived, row.address)) {
					out.mismatch++;
					out.mismatch_ids.push(row.row_id);
					batchMismatch = true;
					continue;
				}
			}
			out.resealable++;
			if (!newKey || !apply) continue;
			const fresh = await sealWithKey(opened.plaintext, newKey);
			const back = await openWithKeys(fresh, [newKey]);
			if (!back || back.plaintext !== opened.plaintext) {
				throw new Error(`re-encrypted value for ${t.id} row ${row.row_id} did not round-trip under the new key`);
			}
			writes.push({ row, fresh });
		}
		if (batchMismatch && apply && !holdMismatched) {
			out.aborted = true;
			out.status = 'aborted_on_mismatch';
			return out;
		}
		if (!apply || writes.length === 0) continue;

		const statements = [];
		for (const { row, fresh } of writes) {
			statements.push([
				`INSERT INTO ${BACKUP_TABLE} (target, row_id, old_ciphertext, new_ciphertext) VALUES ($1, $2, $3, $4)`,
				[t.id, row.row_id, row.secret, fresh],
			]);
			statements.push(updateStatement(t, row.row_id, row.secret, fresh));
		}
		await db.batch(statements);

		// Post-check from the database itself: the stored value must now open under
		// the new key alone and still derive the stored address.
		const ids = writes.map((w) => w.row.row_id);
		const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
		const expr = secretExpr(t);
		const after = await db.query(
			`SELECT ${ident(t.pk)}::text AS row_id, (${expr}) AS secret, (${t.address || 'NULL'}) AS address FROM ${ident(t.table)} WHERE ${ident(t.pk)}::text IN (${placeholders})`,
			ids,
		);
		const byId = new Map(after.map((r) => [r.row_id, r]));
		for (const { row, fresh } of writes) {
			const now = byId.get(row.row_id);
			if (!now || now.secret !== fresh) continue; // changed underneath us (CAS missed): left for the next run
			const opened = await openWithKeys(now.secret, [newKey]);
			let good = Boolean(opened);
			if (good && t.verify !== 'none' && now.address) {
				try {
					good = sameAddress(t.verify, await deriveAddress(t.verify, opened.plaintext), now.address);
				} catch {
					good = false;
				}
			}
			if (good) out.written++;
			else out.postcheck_failed++;
		}
	}
	if (out.postcheck_failed > 0) out.status = 'postcheck_failed';
	return out;
}

/**
 * Re-seal (or, with apply false, measure) every target.
 * @param {object} p
 * @param {{ query: Function, batch: Function }} p.db
 * @param {string[]} p.oldKeys candidate secrets that may open existing values
 * @param {string|null} p.newKey
 */
export async function resealAll({ db, oldKeys, newKey = null, apply = false, batchSize = 100, targets = TARGETS, holdMismatched = false }) {
	if (apply) {
		if (!newKey) throw new Error('--apply needs RESEAL_NEW_KEY');
		assertNewKey(newKey, oldKeys);
		await ensureBackupTable(db);
	}
	const results = [];
	for (const t of targets) {
		const r = await resealTarget({ db, t, oldKeys, newKey, apply, batchSize, holdMismatched });
		results.push(r);
		if (r.aborted) break;
	}
	// A dry run only measures, so a mismatch is a finding to read, not a failure.
	// An apply run fails on a mismatch unless the operator chose to hold those rows
	// (they stay sealed under the old key, which _PREVIOUS keeps readable).
	const mismatched = results.reduce((n, r) => n + r.mismatch, 0);
	const ok = results.every((r) => r.postcheck_failed === 0 && r.status !== 'aborted_on_mismatch' && r.status !== 'postcheck_failed') && (!apply || holdMismatched || mismatched === 0);
	return { checked_at: new Date().toISOString(), mode: apply ? 'apply' : 'dry-run', new_key_supplied: Boolean(newKey), hold_mismatched: holdMismatched, ok, targets: results };
}

/** Restore the pre-reseal ciphertext wherever the row still holds the resealed one. */
export async function rollbackReseal({ db, targets = TARGETS, apply = true }) {
	const [{ present }] = await db.query('SELECT to_regclass($1) IS NOT NULL AS present', [BACKUP_TABLE]);
	if (!present) return { restored: 0, skipped: 0, pending: 0 };
	let restored = 0;
	let skipped = 0;
	let pending = 0;
	for (const t of targets) {
		const backups = await db.query(
			`SELECT id, row_id, old_ciphertext, new_ciphertext FROM ${BACKUP_TABLE} WHERE target = $1 AND rolled_back_at IS NULL ORDER BY id DESC`,
			[t.id],
		);
		for (const b of backups) {
			const [stmt, params] = updateStatement(t, b.row_id, b.new_ciphertext, b.old_ciphertext).slice(0, 2);
			const probe = await db.query(
				`SELECT 1 FROM ${ident(t.table)} WHERE ${ident(t.pk)}::text = $1 AND (${secretExpr(t)}) = $2`,
				[b.row_id, b.new_ciphertext],
			);
			if (probe.length === 0) {
				skipped++;
				continue;
			}
			pending++;
			if (!apply) continue;
			await db.batch([[stmt, params], [`UPDATE ${BACKUP_TABLE} SET rolled_back_at = now() WHERE id = $1`, [b.id]]]);
			restored++;
		}
	}
	return { restored, skipped, pending };
}

export function renderReport(report) {
	const lines = [`custodial reseal  ${report.mode}  (${report.checked_at})`];
	lines.push(`  new key supplied    ${report.new_key_supplied ? 'yes' : 'no (counts only reflect the old key set)'}`);
	lines.push('');
	const pad = (v, n) => String(v).padStart(n);
	lines.push(`  ${'target'.padEnd(54)} ${pad('rows', 6)} ${pad('current', 8)} ${pad('reseal', 7)} ${pad('stuck', 6)} ${pad('mism', 5)} ${pad('written', 8)}`);
	for (const t of report.targets) {
		if (t.status === 'table_absent' || t.status === 'column_absent') {
			lines.push(`  ${t.id.padEnd(54)} ${t.status}`);
			continue;
		}
		lines.push(`  ${t.id.padEnd(54)} ${pad(t.rows, 6)} ${pad(t.current, 8)} ${pad(t.resealable, 7)} ${pad(t.undecryptable, 6)} ${pad(t.mismatch, 5)} ${pad(t.written, 8)}${t.status === 'ok' ? '' : '  ' + t.status}`);
	}
	const stuck = report.targets.flatMap((t) => t.undecryptable_ids.map((id) => `${t.id} ${id}`));
	if (stuck.length) {
		lines.push('', `  undecryptable (left untouched, sealed under a key production never held): ${stuck.length}`);
		for (const s of stuck.slice(0, 50)) lines.push(`    ${s}`);
		if (stuck.length > 50) lines.push(`    ... ${stuck.length - 50} more (use --json)`);
	}
	const bad = report.targets.flatMap((t) => t.mismatch_ids.map((id) => `${t.id} ${id}`));
	if (bad.length) {
		lines.push('', report.mode === 'apply' && !report.hold_mismatched
			? `  ADDRESS MISMATCH, run aborted before writing that batch: ${bad.length}`
			: `  ADDRESS MISMATCH, secret does not derive the stored address (never resealed${report.mode === 'apply' ? ', held' : ': --apply aborts unless --hold-mismatched'}): ${bad.length}`);
		for (const s of bad) lines.push(`    ${s}`);
	}
	lines.push('', report.ok ? '  result: ok' : '  result: FAILED, see the mismatch / post-check lines above');
	return lines.join('\n');
}

function productionDb(url) {
	return import('@neondatabase/serverless').then(({ neon }) => {
		const raw = neon(url);
		return {
			query: (text, params = []) => raw.query(text, params),
			batch: (statements) => raw.transaction(statements.map(([text, params]) => raw.query(text, params))),
		};
	});
}

async function main() {
	const argv = process.argv.slice(2);
	const has = (f) => argv.includes(f);
	const val = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
	const apply = has('--apply');
	const asJson = has('--json');
	const batchSize = Number(val('batch-size') || 100);
	const only = val('only');
	if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
		console.error('--batch-size must be an integer from 1 to 1000');
		process.exit(2);
	}
	for (const bad of argv.filter((a) => /^--(new|old)-?key/.test(a))) {
		console.error(`${bad.split('=')[0]}: keys are read from the environment, never argv`);
		process.exit(2);
	}
	const targets = only ? TARGETS.filter((t) => t.id === only) : TARGETS;
	if (targets.length === 0) {
		console.error(`--only: no such target. Known: ${TARGETS.map((t) => t.id).join(', ')}`);
		process.exit(2);
	}
	if (!process.env.DATABASE_URL) {
		console.error('DATABASE_URL is not set (see the usage block at the top of this file)');
		process.exit(2);
	}

	const { secretBoxKeyCandidates } = await import('../api/_lib/secret-box.js');
	const extra = String(process.env.RESEAL_OLD_KEYS || '').split(/[\s,]+/).filter(Boolean);
	const oldKeys = [...new Set([...secretBoxKeyCandidates(), ...extra])];
	if (oldKeys.length === 0) {
		console.error('No old key configured: export WALLET_ENCRYPTION_KEY (and JWT_SECRET) from the live service first.');
		process.exit(3);
	}
	const newKey = process.env.RESEAL_NEW_KEY || null;
	if (newKey) {
		try {
			assertNewKey(newKey, oldKeys);
		} catch (err) {
			console.error(err.message);
			process.exit(2);
		}
	}

	const db = await productionDb(process.env.DATABASE_URL);
	if (has('--rollback')) {
		const result = await rollbackReseal({ db, targets, apply });
		console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...result }));
		return;
	}
	const report = await resealAll({ db, oldKeys, newKey, apply, batchSize, targets, holdMismatched: has('--hold-mismatched') });
	console.log(asJson ? JSON.stringify(report, null, 2) : renderReport(report));
	process.exit(report.ok ? 0 : 1);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	main().catch((err) => {
		console.error(err?.message || err);
		process.exit(1);
	});
}
